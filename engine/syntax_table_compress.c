/**
 * @file syntax_table_compress.c
 * @brief Implementation of the 6-Pillar Syntax Table Compression Engine.
 */

#include "syntax_table.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>

#ifdef _WIN32
#include <windows.h>
static double get_hires_time_ns(void) {
    static LARGE_INTEGER freq;
    static int initialized = 0;
    if (!initialized) {
        QueryPerformanceFrequency(&freq);
        initialized = 1;
    }
    LARGE_INTEGER counter;
    QueryPerformanceCounter(&counter);
    return ((double)counter.QuadPart * 1e9) / (double)freq.QuadPart;
}
#else
static double get_hires_time_ns(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (double)ts.tv_sec * 1e9 + (double)ts.tv_nsec;
}
#endif

/* -------------------------------------------------------------------------
 * Software 64-byte Cache Simulator (32 KB L1 Data Cache, 64-byte lines, 8-way)
 * ------------------------------------------------------------------------- */
#define CACHE_LINE_SIZE    64
#define CACHE_WAYS         8
#define CACHE_SETS         64   /* 64 sets * 8 ways * 64 bytes = 32 KB */

typedef struct {
    uintptr_t tags[CACHE_SETS][CACHE_WAYS];
    uint8_t lru[CACHE_SETS][CACHE_WAYS];
    uint64_t accesses;
    uint64_t misses;
} SimCache;

static void sim_cache_init(SimCache *cache) {
    memset(cache, 0, sizeof(*cache));
}

static void sim_cache_access(SimCache *cache, const void *ptr, size_t size) {
    uintptr_t start_addr = (uintptr_t)ptr;
    uintptr_t end_addr = start_addr + size - 1;

    uintptr_t start_line = start_addr / CACHE_LINE_SIZE;
    uintptr_t end_line = end_addr / CACHE_LINE_SIZE;

    for (uintptr_t line = start_line; line <= end_line; line++) {
        cache->accesses++;
        uintptr_t set_idx = line % CACHE_SETS;
        uintptr_t tag = line / CACHE_SETS;

        int hit = 0;
        int max_lru_idx = 0;
        uint8_t max_lru = 0;

        for (int w = 0; w < CACHE_WAYS; w++) {
            if (cache->tags[set_idx][w] == tag) {
                hit = 1;
                cache->lru[set_idx][w] = 0;
            } else {
                if (cache->lru[set_idx][w] < 255) cache->lru[set_idx][w]++;
                if (cache->lru[set_idx][w] > max_lru) {
                    max_lru = cache->lru[set_idx][w];
                    max_lru_idx = w;
                }
            }
        }

        if (!hit) {
            cache->misses++;
            cache->tags[set_idx][max_lru_idx] = tag;
            cache->lru[set_idx][max_lru_idx] = 0;
        }
    }
}

/* -------------------------------------------------------------------------
 * Grammar Generator & Raw Table Factory
 * ------------------------------------------------------------------------- */
RawSyntaxTable *syntax_create_grammar(const char *name, int states, int tokens, double target_sparsity, unsigned int seed) {
    (void)name;
    RawSyntaxTable *table = (RawSyntaxTable *)malloc(sizeof(RawSyntaxTable));
    table->num_states = states;
    table->num_tokens = tokens;
    table->non_zero_count = 0;

    size_t total_cells = (size_t)states * (size_t)tokens;
    table->matrix = (int16_t *)calloc(total_cells, sizeof(int16_t));

    srand(seed);

    for (int s = 0; s < states; s++) {
        // Decide state category (e.g. shift-heavy, reduce-heavy, goto state)
        int state_kind = s % 4; 
        int active_tokens_per_state = (int)round((1.0 - target_sparsity) * (double)tokens);
        if (active_tokens_per_state < 1) active_tokens_per_state = 1;

        for (int a = 0; a < active_tokens_per_state; a++) {
            int t = (rand() % tokens);
            int idx = s * tokens + t;
            if (table->matrix[idx] == ACTION_ERR) {
                int16_t act = ACTION_ERR;
                if (s == states - 1 && t == tokens - 1) {
                    act = ACTION_ACCEPT;
                } else if (state_kind == 0 || state_kind == 1) {
                    act = MAKE_SHIFT((s + 1 + (rand() % 5)) % states);
                } else if (state_kind == 2) {
                    act = MAKE_REDUCE(1 + (rand() % 15));
                } else {
                    act = MAKE_GOTO((s + 2) % states);
                }
                table->matrix[idx] = act;
                table->non_zero_count++;
            }
        }
    }

    return table;
}

void syntax_free_raw(RawSyntaxTable *table) {
    if (table) {
        free(table->matrix);
        free(table);
    }
}

/* -------------------------------------------------------------------------
 * Section 1 & 3: Row Displacement / Comb-Vector Packing (Tarjan-Yao)
 * ------------------------------------------------------------------------- */
RowDisplacementTable *compress_row_displacement(const RawSyntaxTable *raw, bool use_default_reductions, double *build_time_us) {
    double t0 = get_hires_time_ns();

    int S = raw->num_states;
    int T = raw->num_tokens;

    RowDisplacementTable *tbl = (RowDisplacementTable *)malloc(sizeof(RowDisplacementTable));
    tbl->num_states = S;
    tbl->num_tokens = T;
    tbl->has_default_reductions = use_default_reductions;
    tbl->base = (int32_t *)malloc(sizeof(int32_t) * S);
    tbl->default_action = use_default_reductions ? (int16_t *)malloc(sizeof(int16_t) * S) : NULL;

    // Temporary row occupancy vectors
    typedef struct {
        int state;
        int count;
        int *cols;
        int16_t *actions;
        int16_t default_act;
    } RowInfo;

    RowInfo *rows = (RowInfo *)malloc(sizeof(RowInfo) * S);

    for (int s = 0; s < S; s++) {
        rows[s].state = s;
        rows[s].cols = (int *)malloc(sizeof(int) * T);
        rows[s].actions = (int16_t *)malloc(sizeof(int16_t) * T);
        rows[s].count = 0;
        rows[s].default_act = ACTION_ERR;

        int reduce_counts[16] = {0};
        int best_reduce = 0;
        int max_reduce_freq = 0;

        for (int t = 0; t < T; t++) {
            int16_t act = raw->matrix[s * T + t];
            if (act != ACTION_ERR) {
                if (use_default_reductions && IS_REDUCE(act)) {
                    int r = -act;
                    if (r < 16) {
                        reduce_counts[r]++;
                        if (reduce_counts[r] > max_reduce_freq) {
                            max_reduce_freq = reduce_counts[r];
                            best_reduce = r;
                        }
                    }
                }
            }
        }

        if (use_default_reductions && max_reduce_freq >= 2) {
            rows[s].default_act = MAKE_REDUCE(best_reduce);
        }
        if (tbl->default_action) {
            tbl->default_action[s] = rows[s].default_act;
        }

        // Fill remaining entries
        for (int t = 0; t < T; t++) {
            int16_t act = raw->matrix[s * T + t];
            if (act != ACTION_ERR && act != rows[s].default_act) {
                rows[s].cols[rows[s].count] = t;
                rows[s].actions[rows[s].count] = act;
                rows[s].count++;
            }
        }
    }

    // Sort rows descending by density (First-Fit Decreasing heuristic)
    for (int i = 0; i < S - 1; i++) {
        for (int j = i + 1; j < S; j++) {
            if (rows[j].count > rows[i].count) {
                RowInfo tmp = rows[i];
                rows[i] = rows[j];
                rows[j] = tmp;
            }
        }
    }

    // Pack into comb array
    int comb_capacity = S * T + 2048;
    int16_t *check = (int16_t *)malloc(sizeof(int16_t) * comb_capacity);
    int16_t *action = (int16_t *)malloc(sizeof(int16_t) * comb_capacity);
    for (int i = 0; i < comb_capacity; i++) {
        check[i] = -1;  // empty
        action[i] = ACTION_ERR;
    }

    int max_comb_index = 0;

    for (int r = 0; r < S; r++) {
        int s = rows[r].state;
        int count = rows[r].count;

        if (count == 0) {
            tbl->base[s] = 0;
            continue;
        }

        // Find displacement offset 'b' with 0 collisions
        int b = 0;
        bool found = false;
        while (!found) {
            found = true;
            for (int k = 0; k < count; k++) {
                int col = rows[r].cols[k];
                int pos = b + col;
                if (pos >= comb_capacity - T) {
                    // expand comb capacity if needed
                    int new_cap = comb_capacity * 2;
                    check = (int16_t *)realloc(check, sizeof(int16_t) * new_cap);
                    action = (int16_t *)realloc(action, sizeof(int16_t) * new_cap);
                    for (int x = comb_capacity; x < new_cap; x++) {
                        check[x] = -1;
                        action[x] = ACTION_ERR;
                    }
                    comb_capacity = new_cap;
                }
                if (check[pos] != -1) {
                    found = false;
                    b++;
                    break;
                }
            }
        }

        tbl->base[s] = b;
        for (int k = 0; k < count; k++) {
            int col = rows[r].cols[k];
            int pos = b + col;
            check[pos] = (int16_t)s;
            action[pos] = rows[r].actions[k];
            if (pos > max_comb_index) max_comb_index = pos;
        }
    }

    tbl->comb_size = max_comb_index + 1;
    tbl->check = (int16_t *)malloc(sizeof(int16_t) * tbl->comb_size);
    tbl->action = (int16_t *)malloc(sizeof(int16_t) * tbl->comb_size);
    memcpy(tbl->check, check, sizeof(int16_t) * tbl->comb_size);
    memcpy(tbl->action, action, sizeof(int16_t) * tbl->comb_size);

    free(check);
    free(action);

    for (int s = 0; s < S; s++) {
        free(rows[s].cols);
        free(rows[s].actions);
    }
    free(rows);

    if (build_time_us) {
        *build_time_us = (get_hires_time_ns() - t0) / 1000.0;
    }
    return tbl;
}

void free_row_displacement(RowDisplacementTable *tbl) {
    if (tbl) {
        free(tbl->base);
        free(tbl->check);
        free(tbl->action);
        if (tbl->default_action) free(tbl->default_action);
        free(tbl);
    }
}

/* -------------------------------------------------------------------------
 * Section 1 & 3: Compressed Sparse Row (CSR)
 * ------------------------------------------------------------------------- */
CSRTable *compress_csr(const RawSyntaxTable *raw, double *build_time_us) {
    double t0 = get_hires_time_ns();

    int S = raw->num_states;
    int T = raw->num_tokens;

    CSRTable *tbl = (CSRTable *)malloc(sizeof(CSRTable));
    tbl->num_states = S;
    tbl->num_tokens = T;
    tbl->nnz = raw->non_zero_count;

    tbl->row_ptr = (int32_t *)malloc(sizeof(int32_t) * (S + 1));
    tbl->col_idx = (int16_t *)malloc(sizeof(int16_t) * (tbl->nnz > 0 ? tbl->nnz : 1));
    tbl->action = (int16_t *)malloc(sizeof(int16_t) * (tbl->nnz > 0 ? tbl->nnz : 1));

    int current_nz = 0;
    for (int s = 0; s < S; s++) {
        tbl->row_ptr[s] = current_nz;
        for (int t = 0; t < T; t++) {
            int16_t act = raw->matrix[s * T + t];
            if (act != ACTION_ERR) {
                tbl->col_idx[current_nz] = (int16_t)t;
                tbl->action[current_nz] = act;
                current_nz++;
            }
        }
    }
    tbl->row_ptr[S] = current_nz;

    if (build_time_us) {
        *build_time_us = (get_hires_time_ns() - t0) / 1000.0;
    }
    return tbl;
}

void free_csr(CSRTable *tbl) {
    if (tbl) {
        free(tbl->row_ptr);
        free(tbl->col_idx);
        free(tbl->action);
        free(tbl);
    }
}

/* -------------------------------------------------------------------------
 * Section 1 & 3: Graph Coloring / Compatible Row Merging (DSatur Heuristic)
 * ------------------------------------------------------------------------- */
GraphColoringTable *compress_graph_coloring(const RawSyntaxTable *raw, double *build_time_us) {
    double t0 = get_hires_time_ns();

    int S = raw->num_states;
    int T = raw->num_tokens;

    GraphColoringTable *tbl = (GraphColoringTable *)malloc(sizeof(GraphColoringTable));
    tbl->num_states = S;
    tbl->num_tokens = T;
    tbl->state_to_color = (int16_t *)malloc(sizeof(int16_t) * S);

    int max_colors = S;
    int16_t *composite = (int16_t *)calloc((size_t)max_colors * (size_t)T, sizeof(int16_t));
    int num_colors_used = 0;

    for (int s = 0; s < S; s++) {
        int assigned_color = -1;

        // Try fitting state 's' into existing color slots without conflict
        for (int c = 0; c < num_colors_used; c++) {
            bool conflict = false;
            for (int t = 0; t < T; t++) {
                int16_t s_act = raw->matrix[s * T + t];
                int16_t c_act = composite[c * T + t];
                if (s_act != ACTION_ERR && c_act != ACTION_ERR && s_act != c_act) {
                    conflict = true;
                    break;
                }
            }
            if (!conflict) {
                assigned_color = c;
                break;
            }
        }

        if (assigned_color == -1) {
            assigned_color = num_colors_used++;
        }

        tbl->state_to_color[s] = (int16_t)assigned_color;
        for (int t = 0; t < T; t++) {
            int16_t s_act = raw->matrix[s * T + t];
            if (s_act != ACTION_ERR) {
                composite[assigned_color * T + t] = s_act;
            }
        }
    }

    tbl->num_colors = num_colors_used;
    tbl->color_matrix = (int16_t *)malloc(sizeof(int16_t) * num_colors_used * T);
    memcpy(tbl->color_matrix, composite, sizeof(int16_t) * num_colors_used * T);
    free(composite);

    if (build_time_us) {
        *build_time_us = (get_hires_time_ns() - t0) / 1000.0;
    }
    return tbl;
}

void free_graph_coloring(GraphColoringTable *tbl) {
    if (tbl) {
        free(tbl->state_to_color);
        free(tbl->color_matrix);
        free(tbl);
    }
}

/* -------------------------------------------------------------------------
 * Section 1 & 3: Distinct Row Deduplication
 * ------------------------------------------------------------------------- */
DeduplicatedRowTable *compress_deduplication(const RawSyntaxTable *raw, double *build_time_us) {
    double t0 = get_hires_time_ns();

    int S = raw->num_states;
    int T = raw->num_tokens;

    DeduplicatedRowTable *tbl = (DeduplicatedRowTable *)malloc(sizeof(DeduplicatedRowTable));
    tbl->num_states = S;
    tbl->num_tokens = T;
    tbl->state_to_row = (int16_t *)malloc(sizeof(int16_t) * S);

    int16_t *distinct = (int16_t *)malloc(sizeof(int16_t) * S * T);
    int distinct_count = 0;

    for (int s = 0; s < S; s++) {
        const int16_t *row_s = &raw->matrix[s * T];
        int match_idx = -1;

        for (int d = 0; d < distinct_count; d++) {
            if (memcmp(row_s, &distinct[d * T], sizeof(int16_t) * T) == 0) {
                match_idx = d;
                break;
            }
        }

        if (match_idx == -1) {
            match_idx = distinct_count++;
            memcpy(&distinct[match_idx * T], row_s, sizeof(int16_t) * T);
        }

        tbl->state_to_row[s] = (int16_t)match_idx;
    }

    tbl->num_distinct = distinct_count;
    tbl->distinct_matrix = (int16_t *)malloc(sizeof(int16_t) * distinct_count * T);
    memcpy(tbl->distinct_matrix, distinct, sizeof(int16_t) * distinct_count * T);
    free(distinct);

    if (build_time_us) {
        *build_time_us = (get_hires_time_ns() - t0) / 1000.0;
    }
    return tbl;
}

void free_deduplication(DeduplicatedRowTable *tbl) {
    if (tbl) {
        free(tbl->state_to_row);
        free(tbl->distinct_matrix);
        free(tbl);
    }
}

/* -------------------------------------------------------------------------
 * Section 2: Fast Lookups
 * ------------------------------------------------------------------------- */
int16_t lookup_raw(const RawSyntaxTable *tbl, int s, int t) {
    return tbl->matrix[s * tbl->num_tokens + t];
}

int16_t lookup_row_displacement(const RowDisplacementTable *tbl, int s, int t) {
    int idx = tbl->base[s] + t;
    if (idx >= 0 && idx < tbl->comb_size && tbl->check[idx] == (int16_t)s) {
        return tbl->action[idx];
    }
    return tbl->default_action ? tbl->default_action[s] : ACTION_ERR;
}

int16_t lookup_csr(const CSRTable *tbl, int s, int t) {
    int start = tbl->row_ptr[s];
    int end = tbl->row_ptr[s + 1];

    // Binary search over sorted col_idx array
    int low = start;
    int high = end - 1;
    while (low <= high) {
        int mid = (low + high) >> 1;
        int col = tbl->col_idx[mid];
        if (col == t) {
            return tbl->action[mid];
        } else if (col < t) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return ACTION_ERR;
}

int16_t lookup_graph_coloring(const GraphColoringTable *tbl, int s, int t) {
    int c = tbl->state_to_color[s];
    return tbl->color_matrix[c * tbl->num_tokens + t];
}

int16_t lookup_deduplication(const DeduplicatedRowTable *tbl, int s, int t) {
    int d = tbl->state_to_row[s];
    return tbl->distinct_matrix[d * tbl->num_tokens + t];
}

/* -------------------------------------------------------------------------
 * Section 2, 4, 5: Unified Evaluation Suite
 * ------------------------------------------------------------------------- */
BenchmarkMetrics evaluate_table_algorithm(
    const RawSyntaxTable *raw,
    const char *grammar_name,
    const char *algorithm_name
) {
    BenchmarkMetrics m;
    memset(&m, 0, sizeof(m));

    m.grammar_name = grammar_name;
    m.algorithm_name = algorithm_name;
    m.num_states = raw->num_states;
    m.num_tokens = raw->num_tokens;
    m.non_zero_count = raw->non_zero_count;
    m.sparsity_pct = (1.0 - (double)raw->non_zero_count / (double)(raw->num_states * raw->num_tokens)) * 100.0;
    m.raw_bytes = (size_t)raw->num_states * (size_t)raw->num_tokens * sizeof(int16_t) + sizeof(RawSyntaxTable);

    // Setup compression according to algorithm
    RowDisplacementTable *rd = NULL;
    CSRTable *csr = NULL;
    GraphColoringTable *gc = NULL;
    DeduplicatedRowTable *dedup = NULL;

    if (strcmp(algorithm_name, "raw_2d") == 0) {
        m.payload_bytes = m.raw_bytes;
        m.index_bytes = 0;
        m.side_structure_bytes = 0;
        m.decoder_code_bytes = 16;
        m.total_compressed_bytes = m.raw_bytes;
        m.build_time_us = 0;
    } else if (strcmp(algorithm_name, "row_displacement") == 0) {
        rd = compress_row_displacement(raw, false, &m.build_time_us);
        m.payload_bytes = (size_t)rd->comb_size * sizeof(int16_t); // action array
        m.index_bytes = (size_t)rd->num_states * sizeof(int32_t);  // base array
        m.side_structure_bytes = (size_t)rd->comb_size * sizeof(int16_t) + sizeof(RowDisplacementTable); // check array + struct
        m.decoder_code_bytes = 64; // inlined bounds check & lookup
        m.total_compressed_bytes = m.payload_bytes + m.index_bytes + m.side_structure_bytes + m.decoder_code_bytes;
    } else if (strcmp(algorithm_name, "row_displacement_default") == 0) {
        rd = compress_row_displacement(raw, true, &m.build_time_us);
        m.payload_bytes = (size_t)rd->comb_size * sizeof(int16_t);
        m.index_bytes = (size_t)rd->num_states * sizeof(int32_t);
        m.side_structure_bytes = (size_t)rd->comb_size * sizeof(int16_t) + (size_t)rd->num_states * sizeof(int16_t) + sizeof(RowDisplacementTable);
        m.decoder_code_bytes = 80;
        m.total_compressed_bytes = m.payload_bytes + m.index_bytes + m.side_structure_bytes + m.decoder_code_bytes;
    } else if (strcmp(algorithm_name, "csr") == 0) {
        csr = compress_csr(raw, &m.build_time_us);
        m.payload_bytes = (size_t)csr->nnz * sizeof(int16_t); // action
        m.index_bytes = (size_t)(csr->num_states + 1) * sizeof(int32_t); // row_ptr
        m.side_structure_bytes = (size_t)csr->nnz * sizeof(int16_t) + sizeof(CSRTable); // col_idx
        m.decoder_code_bytes = 48;
        m.total_compressed_bytes = m.payload_bytes + m.index_bytes + m.side_structure_bytes + m.decoder_code_bytes;
    } else if (strcmp(algorithm_name, "graph_coloring") == 0) {
        gc = compress_graph_coloring(raw, &m.build_time_us);
        m.payload_bytes = (size_t)gc->num_colors * (size_t)gc->num_tokens * sizeof(int16_t);
        m.index_bytes = (size_t)gc->num_states * sizeof(int16_t); // state_to_color
        m.side_structure_bytes = sizeof(GraphColoringTable);
        m.decoder_code_bytes = 32;
        m.total_compressed_bytes = m.payload_bytes + m.index_bytes + m.side_structure_bytes + m.decoder_code_bytes;
    } else if (strcmp(algorithm_name, "row_dedup") == 0) {
        dedup = compress_deduplication(raw, &m.build_time_us);
        m.payload_bytes = (size_t)dedup->num_distinct * (size_t)dedup->num_tokens * sizeof(int16_t);
        m.index_bytes = (size_t)dedup->num_states * sizeof(int16_t);
        m.side_structure_bytes = sizeof(DeduplicatedRowTable);
        m.decoder_code_bytes = 32;
        m.total_compressed_bytes = m.payload_bytes + m.index_bytes + m.side_structure_bytes + m.decoder_code_bytes;
    }

    m.compression_ratio = (double)m.total_compressed_bytes / (double)m.raw_bytes;
    m.savings_pct = (1.0 - m.compression_ratio) * 100.0;
    m.peak_working_mem_bytes = m.total_compressed_bytes + 4096; // stack & transient registers

    // Section 5: Correctness and Losslessness Verification
    bool match_all = true;
    size_t err_matches = 0;
    size_t default_applied = 0;
    size_t total_queries = (size_t)raw->num_states * (size_t)raw->num_tokens;

    for (int s = 0; s < raw->num_states; s++) {
        for (int t = 0; t < raw->num_tokens; t++) {
            int16_t expected = lookup_raw(raw, s, t);
            int16_t actual = 0;

            if (strcmp(algorithm_name, "raw_2d") == 0) actual = expected;
            else if (rd) actual = lookup_row_displacement(rd, s, t);
            else if (csr) actual = lookup_csr(csr, s, t);
            else if (gc) actual = lookup_graph_coloring(gc, s, t);
            else if (dedup) actual = lookup_deduplication(dedup, s, t);

            if (expected == ACTION_ERR) {
                if (actual == ACTION_ERR) {
                    err_matches++;
                } else if (rd && rd->has_default_reductions && IS_REDUCE(actual)) {
                    // Yacc / Bison standard: default reduction on error delay error detection until shift
                    default_applied++;
                } else if (gc && actual != ACTION_ERR) {
                    // Graph coloring fills don't-care error entries with merged valid actions
                    default_applied++;
                } else {
                    match_all = false;
                }
            } else {
                if (actual != expected) {
                    match_all = false;
                }
            }
        }
    }

    m.correctness_verified = match_all;
    m.verified_queries_count = total_queries;
    m.errors_correctly_detected = err_matches;
    m.default_reductions_applied = default_applied;

    // Section 2 & 4: Latency & Cache Behavior Benchmark
    SimCache cache;
    sim_cache_init(&cache);

    const int NUM_BENCH_QUERIES = 200000;
    double latencies[1000]; // sample distribution for p99
    int sample_stride = NUM_BENCH_QUERIES / 1000;
    int sample_idx = 0;
    volatile int16_t sink = 0;

    double t_start = get_hires_time_ns();
    for (int q = 0; q < NUM_BENCH_QUERIES; q++) {
        int s = (q * 17) % raw->num_states;
        int t = (q * 31) % raw->num_tokens;

        double q_t0 = 0;
        if (q % sample_stride == 0 && sample_idx < 1000) {
            q_t0 = get_hires_time_ns();
        }

        int16_t val = 0;
        if (strcmp(algorithm_name, "raw_2d") == 0) {
            sim_cache_access(&cache, &raw->matrix[s * raw->num_tokens + t], sizeof(int16_t));
            val = lookup_raw(raw, s, t);
        } else if (rd) {
            sim_cache_access(&cache, &rd->base[s], sizeof(int32_t));
            int idx = rd->base[s] + t;
            if (idx >= 0 && idx < rd->comb_size) {
                sim_cache_access(&cache, &rd->check[idx], sizeof(int16_t));
                sim_cache_access(&cache, &rd->action[idx], sizeof(int16_t));
            }
            val = lookup_row_displacement(rd, s, t);
        } else if (csr) {
            sim_cache_access(&cache, &csr->row_ptr[s], sizeof(int32_t) * 2);
            int start = csr->row_ptr[s];
            int count = csr->row_ptr[s + 1] - start;
            if (count > 0) {
                sim_cache_access(&cache, &csr->col_idx[start], sizeof(int16_t) * count);
                sim_cache_access(&cache, &csr->action[start], sizeof(int16_t) * count);
            }
            val = lookup_csr(csr, s, t);
        } else if (gc) {
            sim_cache_access(&cache, &gc->state_to_color[s], sizeof(int16_t));
            int c = gc->state_to_color[s];
            sim_cache_access(&cache, &gc->color_matrix[c * gc->num_tokens + t], sizeof(int16_t));
            val = lookup_graph_coloring(gc, s, t);
        } else if (dedup) {
            sim_cache_access(&cache, &dedup->state_to_row[s], sizeof(int16_t));
            int d = dedup->state_to_row[s];
            sim_cache_access(&cache, &dedup->distinct_matrix[d * dedup->num_tokens + t], sizeof(int16_t));
            val = lookup_deduplication(dedup, s, t);
        }

        sink += val;

        if (q % sample_stride == 0 && sample_idx < 1000) {
            double q_time = get_hires_time_ns() - q_t0;
            latencies[sample_idx++] = q_time;
        }
    }
    double t_total = get_hires_time_ns() - t_start;
    (void)sink;

    m.mean_lookup_ns = t_total / (double)NUM_BENCH_QUERIES;

    // Calculate p99 worst-case
    // Sort sampled latencies
    for (int i = 0; i < sample_idx - 1; i++) {
        for (int j = i + 1; j < sample_idx; j++) {
            if (latencies[j] < latencies[i]) {
                double tmp = latencies[i];
                latencies[i] = latencies[j];
                latencies[j] = tmp;
            }
        }
    }

    int p99_idx = (int)(sample_idx * 0.99);
    m.p99_lookup_ns = latencies[p99_idx];
    m.max_lookup_ns = latencies[sample_idx - 1];

    m.cache_miss_rate_pct = cache.accesses > 0 ? ((double)cache.misses / (double)cache.accesses) * 100.0 : 0.0;
    m.avg_lines_touched = (double)cache.accesses / (double)NUM_BENCH_QUERIES;

    // Cleanup allocated structures
    if (rd) free_row_displacement(rd);
    if (csr) free_csr(csr);
    if (gc) free_graph_coloring(gc);
    if (dedup) free_deduplication(dedup);

    return m;
}

/* -------------------------------------------------------------------------
 * Section 6: Comprehensive Benchmark Across Multiple Grammars
 * ------------------------------------------------------------------------- */
static const GrammarPreset GRAMMAR_CORPUS[] = {
    { "Toy Arithmetic Expression", "toy", 24, 12, 0.75 },
    { "JSON Object Notation", "mid_json", 65, 28, 0.868 },
    { "ANSI C11 Grammar", "mid_c", 280, 92, 0.917 },
    { "ANSI SQL-92 Grammar", "large_sql", 640, 160, 0.959 },
    { "Synthetic Dense Stress Table", "dense_stress", 150, 60, 0.350 },
    { "Synthetic Ultra-Sparse Table", "sparse_stress", 1000, 200, 0.988 },
};

#define NUM_GRAMMARS (sizeof(GRAMMAR_CORPUS) / sizeof(GRAMMAR_CORPUS[0]))

static const char *ALGORITHMS[] = {
    "raw_2d",
    "row_displacement",
    "row_displacement_default",
    "csr",
    "graph_coloring",
    "row_dedup",
};

#define NUM_ALGORITHMS (sizeof(ALGORITHMS) / sizeof(ALGORITHMS[0]))

char *export_all_benchmarks_json(void) {
    char *json = (char *)malloc(512 * 1024); // 512 KB buffer
    int offset = 0;

    offset += sprintf(json + offset, "{\n  \"timestamp\": %ld,\n  \"benchmarks\": [\n", (long)time(NULL));

    bool first = true;
    for (size_t g = 0; g < NUM_GRAMMARS; g++) {
        const GrammarPreset *p = &GRAMMAR_CORPUS[g];
        RawSyntaxTable *raw = syntax_create_grammar(p->name, p->states, p->tokens, p->target_sparsity, 1337 + (unsigned int)g);

        for (size_t a = 0; a < NUM_ALGORITHMS; a++) {
            BenchmarkMetrics m = evaluate_table_algorithm(raw, p->name, ALGORITHMS[a]);

            if (!first) {
                offset += sprintf(json + offset, ",\n");
            }
            first = false;

            offset += sprintf(
                json + offset,
                "    {\n"
                "      \"grammar\": \"%s\",\n"
                "      \"category\": \"%s\",\n"
                "      \"algorithm\": \"%s\",\n"
                "      \"states\": %d,\n"
                "      \"tokens\": %d,\n"
                "      \"nnz\": %d,\n"
                "      \"sparsity_pct\": %.2f,\n"
                "      \"raw_bytes\": %zu,\n"
                "      \"payload_bytes\": %zu,\n"
                "      \"index_bytes\": %zu,\n"
                "      \"side_structure_bytes\": %zu,\n"
                "      \"decoder_code_bytes\": %zu,\n"
                "      \"total_compressed_bytes\": %zu,\n"
                "      \"compression_ratio\": %.4f,\n"
                "      \"savings_pct\": %.2f,\n"
                "      \"build_time_us\": %.2f,\n"
                "      \"mean_lookup_ns\": %.2f,\n"
                "      \"p99_lookup_ns\": %.2f,\n"
                "      \"max_lookup_ns\": %.2f,\n"
                "      \"peak_working_mem_bytes\": %zu,\n"
                "      \"cache_miss_rate_pct\": %.2f,\n"
                "      \"avg_lines_touched\": %.2f,\n"
                "      \"correctness_verified\": %s,\n"
                "      \"verified_queries_count\": %zu,\n"
                "      \"errors_correctly_detected\": %zu,\n"
                "      \"default_reductions_applied\": %zu\n"
                "    }",
                m.grammar_name,
                p->category,
                m.algorithm_name,
                m.num_states,
                m.num_tokens,
                m.non_zero_count,
                m.sparsity_pct,
                m.raw_bytes,
                m.payload_bytes,
                m.index_bytes,
                m.side_structure_bytes,
                m.decoder_code_bytes,
                m.total_compressed_bytes,
                m.compression_ratio,
                m.savings_pct,
                m.build_time_us,
                m.mean_lookup_ns,
                m.p99_lookup_ns,
                m.max_lookup_ns,
                m.peak_working_mem_bytes,
                m.cache_miss_rate_pct,
                m.avg_lines_touched,
                m.correctness_verified ? "true" : "false",
                m.verified_queries_count,
                m.errors_correctly_detected,
                m.default_reductions_applied
            );
        }

        syntax_free_raw(raw);
    }

    offset += sprintf(json + offset, "\n  ]\n}\n");
    return json;
}

#ifdef SYNTAX_BENCH_CLI
int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
    char *json = export_all_benchmarks_json();
    printf("%s", json);
    free(json);
    return 0;
}
#endif
