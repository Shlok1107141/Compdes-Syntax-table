/*
 * ==============================================================================
 * DenseSym: Ultra-Compact Embedded Compiler Symbol Table & Static Analyzer
 * Target: ESP32 (Xtensa 32-bit LX6 @ 240MHz, Arduino Framework / PlatformIO)
 * ==============================================================================
 * Features:
 *   1. Pure Embedded C11 Patricia Radix Trie in a Flat 16-bit Arena (10 B / node)
 *   2. Contiguous Character Edge-Pool (interning & prefix-compaction)
 *   3. Atomic 32-bit Metadata Word Packing (type:4b | scope:8b | storage:4b | offset:16b)
 *   4. Sub-microsecond hardware profiling via esp_timer_get_time()
 *   5. Real physical SRAM heap monitoring via esp_get_free_heap_size()
 *   6. Bidirectional USB-UART Serial JSON interface at 115,200 baud
 * ==============================================================================
 */

#include <Arduino.h>
#include <stdint.h>
#include <string.h>
#include <esp_system.h>
#include <esp_timer.h>

#define LED_PIN 2           // On-board status LED (GPIO 2 on most ESP32 DevKits)
#define SERIAL_BAUD 115200  // Fast USB-UART communication
#define NIL 0xFFFF
#define MAX_ITEMS 512       // Maximum symbols & nodes in embedded arena
#define MAX_CHARS 2048      // Character pool capacity in SRAM

// ---------- Symbol Structure ----------
typedef struct {
    char name[48];
    uint8_t type;           // 0=int, 1=float, 2=char, 3=double, 4=void, 5=ptr, 6=struct
    uint8_t scope;          // lexical nesting depth (0=global)
    uint8_t storage_class;  // 0=auto, 1=static, 2=extern, 3=register
    uint16_t offset;        // byte offset in stack/data section
} EmbeddedSymbol;

// ---------- 10-Byte Flat Arena Trie Node ----------
typedef struct {
    uint16_t first_child;
    uint16_t next_sibling;
    uint16_t edge_offset;
    uint8_t  edge_len;
    uint8_t  is_leaf;
    uint16_t symbol_id;     // Index into meta_pool when is_leaf
} TrieNode;

// ---------- Redeclaration Shadow Record ----------
typedef struct {
    uint16_t node;
    uint16_t older_meta;
} ShadowRecord;

// ---------- Global Arena Storage in ESP32 Internal SRAM ----------
static TrieNode     node_pool[MAX_ITEMS];
static uint16_t     node_count = 0;

static char         char_pool[MAX_CHARS];
static uint16_t     char_used = 0;

static uint32_t     meta_pool[MAX_ITEMS];   // Packed: 4b type | 8b scope | 4b storage | 16b offset
static uint16_t     meta_count = 0;

static ShadowRecord shadow_pool[MAX_ITEMS];
static uint16_t     shadow_count = 0;

static EmbeddedSymbol parsed_symbols[MAX_ITEMS];
static uint16_t     parsed_symbol_count = 0;

// ---------- Bit-Packing Helper Functions ----------
static inline uint32_t pack_metadata(uint8_t type, uint8_t scope, uint8_t sc, uint16_t off) {
    return ((uint32_t)(type & 0x0F) << 28) |
           ((uint32_t)(scope & 0xFF) << 20) |
           ((uint32_t)(sc & 0x0F) << 16) |
           (uint32_t)(off & 0xFFFF);
}

static inline void unpack_metadata(uint32_t m, uint8_t *type, uint8_t *scope, uint8_t *sc, uint16_t *off) {
    *type  = (uint8_t)((m >> 28) & 0x0F);
    *scope = (uint8_t)((m >> 20) & 0xFF);
    *sc    = (uint8_t)((m >> 16) & 0x0F);
    *off   = (uint16_t)(m & 0xFFFF);
}

static inline const char *type_to_str(uint8_t t) {
    switch (t) {
        case 0: return "int";
        case 1: return "float";
        case 2: return "char";
        case 3: return "double";
        case 4: return "void";
        case 5: return "pointer";
        case 6: return "struct";
        default: return "int";
    }
}

// ---------- DenseSym Arena Core Operations ----------
static void trie_init(void) {
    node_count = 0;
    char_used = 0;
    meta_count = 0;
    shadow_count = 0;
    parsed_symbol_count = 0;

    // Root node (index 0)
    node_pool[0].first_child = NIL;
    node_pool[0].next_sibling = NIL;
    node_pool[0].edge_offset = 0;
    node_pool[0].edge_len = 0;
    node_pool[0].is_leaf = 0;
    node_pool[0].symbol_id = NIL;
    node_count = 1;
}

static uint16_t new_node(void) {
    if (node_count >= MAX_ITEMS) return NIL;
    uint16_t id = node_count++;
    node_pool[id].first_child = NIL;
    node_pool[id].next_sibling = NIL;
    node_pool[id].edge_offset = 0;
    node_pool[id].edge_len = 0;
    node_pool[id].is_leaf = 0;
    node_pool[id].symbol_id = NIL;
    return id;
}

static uint16_t store_chars(const char *src, size_t len) {
    if ((size_t)char_used + len > MAX_CHARS) return NIL;
    uint16_t off = char_used;
    memcpy(&char_pool[off], src, len);
    char_used += (uint16_t)len;
    return off;
}

static uint16_t *find_child_slot(uint16_t parent, char c) {
    uint16_t *slot = &node_pool[parent].first_child;
    while (*slot != NIL && char_pool[node_pool[*slot].edge_offset] != c) {
        slot = &node_pool[*slot].next_sibling;
    }
    return slot;
}

static int trie_insert(const EmbeddedSymbol *sym) {
    const char *key = sym->name;
    size_t len = strlen(key);
    size_t pos = 0;
    uint16_t cur = 0; // ROOT

    if (node_count + 2 >= MAX_ITEMS || char_used + len >= MAX_CHARS || meta_count >= MAX_ITEMS) {
        return -1; // Arena limit reached
    }

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);

        if (*slot == NIL) {
            uint16_t leaf = new_node();
            if (leaf == NIL) return -1;
            uint16_t off = store_chars(key + pos, len - pos);
            if (off == NIL) return -1;
            node_pool[leaf].edge_offset = off;
            node_pool[leaf].edge_len = (uint8_t)(len - pos);

            meta_pool[meta_count] = pack_metadata(sym->type, sym->scope, sym->storage_class, sym->offset);
            node_pool[leaf].is_leaf = 1;
            node_pool[leaf].symbol_id = meta_count++;
            *slot = leaf;
            return 0;
        }

        uint16_t child = *slot;
        uint16_t edge_off = node_pool[child].edge_offset;
        uint8_t  edge_len = node_pool[child].edge_len;

        size_t match = 0;
        while (match < edge_len && (pos + match) < len &&
               char_pool[edge_off + match] == key[pos + match]) {
            match++;
        }

        if (match == edge_len) {
            pos += match;
            cur = child;
            continue;
        }

        // Branching split: create internal split node
        uint16_t split = new_node();
        if (split == NIL) return -1;
        split_node_setup:
        node_pool[split].first_child = child;
        node_pool[split].next_sibling = node_pool[child].next_sibling;
        node_pool[split].edge_offset = edge_off;
        node_pool[split].edge_len = (uint8_t)match;
        node_pool[split].is_leaf = 0;
        node_pool[split].symbol_id = NIL;

        node_pool[child].edge_offset = (uint16_t)(edge_off + match);
        node_pool[child].edge_len = (uint8_t)(edge_len - match);
        node_pool[child].next_sibling = NIL;
        *slot = split;

        pos += match;
        if (pos == len) {
            meta_pool[meta_count] = pack_metadata(sym->type, sym->scope, sym->storage_class, sym->offset);
            node_pool[split].is_leaf = 1;
            node_pool[split].symbol_id = meta_count++;
            return 0;
        } else {
            uint16_t leaf = new_node();
            if (leaf == NIL) return -1;
            uint16_t off = store_chars(key + pos, len - pos);
            if (off == NIL) return -1;
            node_pool[leaf].edge_offset = off;
            node_pool[leaf].edge_len = (uint8_t)(len - pos);

            meta_pool[meta_count] = pack_metadata(sym->type, sym->scope, sym->storage_class, sym->offset);
            node_pool[leaf].is_leaf = 1;
            node_pool[leaf].symbol_id = meta_count++;

            node_pool[child].next_sibling = leaf;
            return 0;
        }
    }

    // Exact key matches existing node: shadow redeclaration
    if (node_pool[cur].is_leaf) {
        shadow_pool[shadow_count].node = cur;
        shadow_pool[shadow_count].older_meta = node_pool[cur].symbol_id;
        shadow_count++;
    }
    meta_pool[meta_count] = pack_metadata(sym->type, sym->scope, sym->storage_class, sym->offset);
    node_pool[cur].is_leaf = 1;
    node_pool[cur].symbol_id = meta_count++;
    return 0;
}

// ---------- Lightweight C Lexer for Embedded Code Analysis ----------
static void tokenize_and_parse_c(const char *code) {
    trie_init();
    size_t i = 0, n = strlen(code);
    uint8_t current_scope = 0;
    uint16_t offset_counter = 0;

    char current_type_str[16] = "int";
    uint8_t current_type_id = 0;

    while (i < n) {
        // Skip whitespace
        while (i < n && (code[i] == ' ' || code[i] == '\t' || code[i] == '\r' || code[i] == '\n')) {
            i++;
        }
        if (i >= n) break;

        // Skip line comments
        if (code[i] == '/' && i + 1 < n && code[i + 1] == '/') {
            while (i < n && code[i] != '\n') i++;
            continue;
        }

        // Scope tracking
        if (code[i] == '{') {
            current_scope++;
            i++;
            continue;
        }
        if (code[i] == '}') {
            if (current_scope > 0) current_scope--;
            i++;
            continue;
        }

        // Scan identifier or keyword
        if ((code[i] >= 'a' && code[i] <= 'z') || (code[i] >= 'A' && code[i] <= 'Z') || code[i] == '_') {
            size_t start = i;
            while (i < n && ((code[i] >= 'a' && code[i] <= 'z') || (code[i] >= 'A' && code[i] <= 'Z') ||
                             (code[i] >= '0' && code[i] <= '9') || code[i] == '_')) {
                i++;
            }
            size_t token_len = i - start;
            char token[48];
            if (token_len >= sizeof(token)) token_len = sizeof(token) - 1;
            strncpy(token, &code[start], token_len);
            token[token_len] = '\0';

            // Check if it's a type keyword
            if (strcmp(token, "int") == 0) { current_type_id = 0; strcpy(current_type_str, "int"); continue; }
            if (strcmp(token, "float") == 0) { current_type_id = 1; strcpy(current_type_str, "float"); continue; }
            if (strcmp(token, "char") == 0) { current_type_id = 2; strcpy(current_type_str, "char"); continue; }
            if (strcmp(token, "double") == 0) { current_type_id = 3; strcpy(current_type_str, "double"); continue; }
            if (strcmp(token, "void") == 0) { current_type_id = 4; strcpy(current_type_str, "void"); continue; }
            if (strcmp(token, "struct") == 0) { current_type_id = 6; strcpy(current_type_str, "struct"); continue; }
            if (strcmp(token, "uint8_t") == 0 || strcmp(token, "uint16_t") == 0 || strcmp(token, "uint32_t") == 0) {
                current_type_id = 0; strcpy(current_type_str, token); continue;
            }

            // Skip control flow keywords
            if (strcmp(token, "if") == 0 || strcmp(token, "else") == 0 || strcmp(token, "while") == 0 ||
                strcmp(token, "for") == 0 || strcmp(token, "return") == 0 || strcmp(token, "switch") == 0 ||
                strcmp(token, "case") == 0 || strcmp(token, "break") == 0 || strcmp(token, "continue") == 0) {
                continue;
            }

            // Lookahead for declaration pattern: identifier followed by ';', '=', ',', or ')'
            size_t peek = i;
            while (peek < n && (code[peek] == ' ' || code[peek] == '\t')) peek++;
            if (peek < n && (code[peek] == ';' || code[peek] == '=' || code[peek] == ',' || code[peek] == '[' || code[peek] == '(')) {
                if (code[peek] != '(' || current_scope == 0) {
                    if (parsed_symbol_count < MAX_ITEMS) {
                        EmbeddedSymbol *s = &parsed_symbols[parsed_symbol_count++];
                        strncpy(s->name, token, sizeof(s->name) - 1);
                        s->name[sizeof(s->name) - 1] = '\0';
                        s->type = current_type_id;
                        s->scope = current_scope;
                        s->storage_class = (current_scope == 0) ? 1 : 0; // static/global vs auto
                        s->offset = offset_counter;
                        offset_counter += 4;

                        trie_insert(s);
                    }
                }
            }
            continue;
        }

        i++;
    }
}

// ---------- Standard Embedded Sensor Benchmark (Corpus from MANUSCRIPT.md) ----------
static void load_sensor_preset(void) {
    const char *sensor_code = 
        "int sensor_reading = 0;\n"
        "int sensor_threshold = 100;\n"
        "float sensor_calibration = 1.05;\n"
        "uint16_t sensor_offset = 12;\n"
        "uint8_t channel_status = 1;\n"
        "uint8_t channel_mask = 0xFF;\n"
        "int channel_config = 4;\n"
        "int channel_advocate = 0;\n"
        "float filter_alpha = 0.85;\n"
        "float filter_beta = 0.15;\n"
        "int filter_window = 16;\n"
        "int adc_raw_value = 512;\n"
        "int adc_scaled_val = 250;\n"
        "int adc_buffer_head = 0;\n"
        "int adc_buffer_tail = 0;\n"
        "void process_frame() {\n"
        "    int sensor_reading = 42;\n"
        "    int local_error = 0;\n"
        "    int channel_status = 2;\n"
        "    float local_variance = 0.04;\n"
        "    {\n"
        "        int sensor_reading = 99;\n"
        "        int temp_scratch = 1;\n"
        "        int loop_counter = 0;\n"
        "    }\n"
        "}\n";
    tokenize_and_parse_c(sensor_code);
}

// ---------- Benchmark Execution & Telemetry Serializer ----------
static void execute_and_stream_telemetry(const char *source_code, const char *mode_label) {
    digitalWrite(LED_PIN, HIGH); // Turn LED ON during analysis

    uint32_t heap_before = esp_get_free_heap_size();
    int64_t t_start = esp_timer_get_time();

    if (source_code != NULL && strlen(source_code) > 0) {
        tokenize_and_parse_c(source_code);
    } else {
        load_sensor_preset();
    }

    int64_t t_end = esp_timer_get_time();
    uint32_t heap_after = esp_get_free_heap_size();
    uint32_t exec_us = (uint32_t)(t_end - t_start);

    digitalWrite(LED_PIN, LOW); // Turn LED OFF

    // Memory Accounting Calculations
    // 1. DenseSym Compressed: TrieNode array (10B/node) + Char pool bytes + Meta words (4B/word) + Shadows (4B)
    size_t compressed_bytes = (node_count * sizeof(TrieNode)) + char_used + 
                              (meta_count * sizeof(uint32_t)) + (shadow_count * sizeof(ShadowRecord));

    // 2. Textbook Baseline: 64 bucket pointers (4B each) + Node structs (24B) + Malloc chunk headers (8B) + Name strings + chunk headers
    size_t base_names_len = 0;
    for (uint16_t s = 0; s < parsed_symbol_count; s++) {
        base_names_len += (strlen(parsed_symbols[s].name) + 1 + 8); // string + malloc header
    }
    size_t baseline_bytes = (64 * sizeof(void *)) + (parsed_symbol_count * (24 + 8)) + base_names_len;

    double savings_pct = 0.0;
    if (baseline_bytes > 0) {
        savings_pct = (1.0 - ((double)compressed_bytes / (double)baseline_bytes)) * 100.0;
    }

    // Stream formatted JSON response directly to USB-UART Serial
    Serial.println("{");
    Serial.printf("  \"status\": \"OK\",\n");
    Serial.printf("  \"hardware\": {\n");
    Serial.printf("    \"board\": \"ESP32 DevKit\",\n");
    Serial.printf("    \"soc\": \"Xtensa Dual-Core 32-bit LX6\",\n");
    Serial.printf("    \"cpu_mhz\": %u,\n", getCpuFrequencyMhz());
    Serial.printf("    \"free_heap_bytes\": %u,\n", heap_after);
    Serial.printf("    \"heap_delta_bytes\": %d\n", (int)(heap_before - heap_after));
    Serial.printf("  },\n");
    Serial.printf("  \"metrics\": {\n");
    Serial.printf("    \"mode\": \"%s\",\n", mode_label);
    Serial.printf("    \"symbol_count\": %u,\n", parsed_symbol_count);
    Serial.printf("    \"trie_nodes\": %u,\n", node_count);
    Serial.printf("    \"char_pool_bytes\": %u,\n", char_used);
    Serial.printf("    \"compressed_bytes\": %u,\n", (unsigned int)compressed_bytes);
    Serial.printf("    \"baseline_bytes\": %u,\n", (unsigned int)baseline_bytes);
    Serial.printf("    \"savings_pct\": %.2f,\n", savings_pct);
    Serial.printf("    \"exec_time_us\": %u\n", exec_us);
    Serial.printf("  },\n");
    Serial.printf("  \"symbols\": [\n");

    for (uint16_t s = 0; s < parsed_symbol_count; s++) {
        uint32_t packed_word = pack_metadata(parsed_symbols[s].type, parsed_symbols[s].scope,
                                             parsed_symbols[s].storage_class, parsed_symbols[s].offset);
        Serial.printf("    {\"name\": \"%s\", \"type\": \"%s\", \"scope\": %u, \"offset\": %u, \"packed_word\": \"0x%08X\"}%s\n",
                      parsed_symbols[s].name,
                      type_to_str(parsed_symbols[s].type),
                      parsed_symbols[s].scope,
                      parsed_symbols[s].offset,
                      packed_word,
                      (s + 1 < parsed_symbol_count) ? "," : "");
    }

    Serial.println("  ]");
    Serial.println("}");
}

// ---------- Arduino Lifecycle Functions ----------
void setup() {
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    Serial.begin(SERIAL_BAUD);
    while (!Serial && millis() < 2000); // Wait for serial console

    delay(200);

    // Initial Ready Beacon
    Serial.println();
    Serial.println("=================================================");
    Serial.println("DenseSym ESP32 Bare-Metal Static Analyzer Ready");
    Serial.printf("CPU Frequency: %u MHz | Free Heap: %u bytes\n", getCpuFrequencyMhz(), esp_get_free_heap_size());
    Serial.println("Commands: PING | DEMO | ANALYZE <source code>");
    Serial.println("=================================================");
}

static String incoming_buffer = "";

void loop() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();

        if (c == '\n' || c == '\r') {
            incoming_buffer.trim();
            if (incoming_buffer.length() == 0) continue;

            if (incoming_buffer.equalsIgnoreCase("PING")) {
                Serial.printf("{\"status\": \"PONG\", \"board\": \"ESP32\", \"clock_mhz\": %u, \"free_heap\": %u}\n",
                              getCpuFrequencyMhz(), esp_get_free_heap_size());
            } else if (incoming_buffer.equalsIgnoreCase("DEMO")) {
                execute_and_stream_telemetry(NULL, "Built-in Sensor Corpus");
            } else if (incoming_buffer.startsWith("ANALYZE ")) {
                String code = incoming_buffer.substring(8);
                execute_and_stream_telemetry(code.c_str(), "Custom Source Stream");
            } else {
                // If raw code was piped directly
                execute_and_stream_telemetry(incoming_buffer.c_str(), "Direct Raw Stream");
            }

            incoming_buffer = "";
        } else {
            incoming_buffer += c;
        }
    }
}
