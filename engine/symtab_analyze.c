/*
 * symtab_analyze.c
 * ------------------------------------------------------------
 * Real front end for the compressed symbol table.
 *
 * Reads C source text on stdin, tokenizes it, tracks scopes, and
 * builds a symbol table from the declarations it finds -- instead
 * of the hardcoded TEST_SYMBOLS[] array used by symtab_demo.c.
 *
 * Both structures from the prototype are built from those symbols:
 *   BASELINE  : textbook hash table w/ separate chaining, one
 *               malloc per node + one per name, unpacked fields.
 *   COMPRESSED: radix (Patricia) trie + flat arena arrays addressed
 *               by 16-bit indices + metadata bit-packed into one
 *               uint32_t (type 4b | scope 8b | storage 4b | offset 16b).
 *
 * Every symbol is looked up in both structures before any number is
 * printed; if a round-trip fails the program reports an error instead
 * of reporting memory figures (a benchmark from unverified code does
 * not count).
 *
 * Output is a single JSON object on stdout, consumed by backend/.
 * The input is never executed -- only parsed.
 *
 * Exit codes: 0 ok, 2 input rejected, 3 internal verification failure.
 * ------------------------------------------------------------
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#if defined(__has_feature)
#  if __has_feature(address_sanitizer)
#    define SYMTAB_SANITIZED 1
#  endif
#endif
#if defined(__SANITIZE_ADDRESS__)
#  define SYMTAB_SANITIZED 1
#endif

/* Self-imposed resource limits: the process caps its own address space and
 * CPU time before it looks at untrusted input, so a pathological input
 * cannot turn into a runaway process. Skipped under AddressSanitizer,
 * which reserves a huge virtual address space by design. */
#if !defined(_WIN32) && !defined(SYMTAB_SANITIZED)
#  include <sys/resource.h>
#  define SYMTAB_SELF_LIMIT 1
#endif

/* ============================================================
 * Limits (all inputs are untrusted; every bound is enforced)
 * ============================================================ */

#define MAX_SOURCE_BYTES  (1u << 20)   /* 1 MiB of source text        */
#define MAX_TOKENS        200000u
#define MAX_DECLS         8192u
#define MAX_IDENT_LEN     255u         /* trie edge_len is uint8_t    */

#define MALLOC_OVERHEAD   16           /* same estimate as the prototype */

/* Symbol attribute codes. Widths are what the bit-packing allows:
 * type 4 bits, scope 8 bits, storage_class 4 bits, offset 16 bits. */
enum {
    T_INT = 0, T_CHAR, T_SHORT, T_LONG, T_FLOAT, T_DOUBLE, T_VOID,
    T_POINTER, T_ARRAY, T_STRUCT, T_UNION, T_ENUM, T_FUNCTION, T_BOOL,
    T_TYPEDEF_NAME, T_UNKNOWN
};

static const char *TYPE_NAMES[16] = {
    "int", "char", "short", "long", "float", "double", "void",
    "pointer", "array", "struct", "union", "enum", "function", "bool",
    "typedef_name", "unknown"
};

enum {
    SC_LOCAL = 0, SC_GLOBAL, SC_STATIC, SC_PARAM, SC_EXTERN,
    SC_REGISTER, SC_TYPEDEF, SC_MEMBER
};

static const char *STORAGE_NAMES[16] = {
    "local", "global", "static", "param", "extern",
    "register", "typedef", "member",
    "?", "?", "?", "?", "?", "?", "?", "?"
};

/* ============================================================
 * Error reporting: any failure is a JSON object, never a crash
 * ============================================================ */

static void json_escape(const char *s, size_t len);

static void fail(int code, const char *msg) {
    printf("{\"error\":\"");
    json_escape(msg, strlen(msg));
    printf("\"}\n");
    exit(code);
}

/* ============================================================
 * Source + lexer
 * ============================================================ */

static char  *src = NULL;
static size_t src_len = 0;

enum { TK_EOF = 0, TK_IDENT, TK_NUM, TK_PUNCT, TK_LITERAL };

typedef struct {
    uint8_t  kind;
    uint32_t pos;
    uint16_t len;
} Token;

static Token  toks[MAX_TOKENS];
static size_t ntok = 0;

static int is_id_start(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}
static int is_digit(char c) { return c >= '0' && c <= '9'; }
static int is_id_char(char c) { return is_id_start(c) || is_digit(c); }
static int is_space(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v';
}

static void push_token(uint8_t kind, size_t pos, size_t len) {
    if (ntok >= MAX_TOKENS) fail(2, "input has too many tokens");
    toks[ntok].kind = kind;
    toks[ntok].pos = (uint32_t)pos;
    toks[ntok].len = (uint16_t)len;
    ntok++;
}

/* Skips to just past the end of the current line, honouring backslash-newline
 * continuations (used for preprocessor directives, which carry no symbols). */
static size_t skip_logical_line(size_t i) {
    while (i < src_len) {
        if (src[i] == '\\' && i + 1 < src_len) {
            if (src[i + 1] == '\n') { i += 2; continue; }
            if (src[i + 1] == '\r' && i + 2 < src_len && src[i + 2] == '\n') { i += 3; continue; }
        }
        if (src[i] == '\n') return i + 1;
        i++;
    }
    return i;
}

static size_t skip_quoted(size_t i, char quote) {
    i++; /* opening quote */
    while (i < src_len && src[i] != quote) {
        if (src[i] == '\\' && i + 1 < src_len) { i += 2; continue; }
        if (src[i] == '\n') break; /* unterminated literal: stop at the line end */
        i++;
    }
    if (i < src_len && src[i] == quote) i++;
    return i;
}

static void lex(void) {
    size_t i = 0;
    int at_line_start = 1;

    while (i < src_len) {
        char c = src[i];

        if (c == '\n') { at_line_start = 1; i++; continue; }
        if (is_space(c)) { i++; continue; }

        if (c == '#' && at_line_start) { i = skip_logical_line(i); at_line_start = 1; continue; }
        at_line_start = 0;

        if (c == '/' && i + 1 < src_len && src[i + 1] == '/') { i = skip_logical_line(i); at_line_start = 1; continue; }
        if (c == '/' && i + 1 < src_len && src[i + 1] == '*') {
            i += 2;
            while (i + 1 < src_len && !(src[i] == '*' && src[i + 1] == '/')) i++;
            i = (i + 1 < src_len) ? i + 2 : src_len;
            continue;
        }

        if (c == '"' || c == '\'') {
            size_t start = i;
            i = skip_quoted(i, c);
            push_token(TK_LITERAL, start, i - start > 0xFFFF ? 0xFFFF : i - start);
            continue;
        }

        if (is_id_start(c)) {
            size_t start = i;
            while (i < src_len && is_id_char(src[i])) i++;
            if (i - start > MAX_IDENT_LEN) fail(2, "identifier longer than 255 characters");
            push_token(TK_IDENT, start, i - start);
            continue;
        }

        if (is_digit(c)) {
            size_t start = i;
            while (i < src_len && (is_id_char(src[i]) || src[i] == '.')) {
                /* exponent sign is part of the number, not an operator */
                if ((src[i] == 'e' || src[i] == 'E' || src[i] == 'p' || src[i] == 'P') &&
                    i + 1 < src_len && (src[i + 1] == '+' || src[i + 1] == '-')) {
                    i += 2;
                    continue;
                }
                i++;
            }
            push_token(TK_NUM, start, i - start);
            continue;
        }

        push_token(TK_PUNCT, i, 1);
        i++;
    }
    push_token(TK_EOF, src_len, 0);
}

/* ============================================================
 * Token helpers
 * ============================================================ */

static int tok_eq(size_t i, const char *s) {
    size_t n = strlen(s);
    if (i >= ntok) return 0;
    return toks[i].len == n && memcmp(src + toks[i].pos, s, n) == 0;
}

static int tok_is_ident(size_t i) { return i < ntok && toks[i].kind == TK_IDENT; }

static const char *KEYWORDS[] = {
    "auto", "break", "case", "char", "const", "continue", "default", "do",
    "double", "else", "enum", "extern", "float", "for", "goto", "if",
    "inline", "int", "long", "register", "restrict", "return", "short",
    "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
    "unsigned", "void", "volatile", "while", "_Bool", "_Atomic", "_Noreturn"
};
#define NUM_KEYWORDS (sizeof(KEYWORDS) / sizeof(KEYWORDS[0]))

static int tok_is_keyword(size_t i) {
    for (size_t k = 0; k < NUM_KEYWORDS; k++)
        if (tok_eq(i, KEYWORDS[k])) return 1;
    return 0;
}

static int is_qualifier(size_t i) {
    return tok_eq(i, "const") || tok_eq(i, "volatile") || tok_eq(i, "restrict") ||
           tok_eq(i, "inline") || tok_eq(i, "_Atomic") || tok_eq(i, "_Noreturn");
}

/* Advance past a balanced (...) or [...] group starting at i. */
static size_t skip_group(size_t i, const char *open, const char *close) {
    if (!tok_eq(i, open)) return i;
    int depth = 0;
    while (i < ntok && toks[i].kind != TK_EOF) {
        if (tok_eq(i, open)) depth++;
        else if (tok_eq(i, close)) {
            depth--;
            if (depth == 0) return i + 1;
        }
        i++;
    }
    return i;
}

/* From '=', skip an initializer up to the next top-level ',' or ';'. */
static size_t skip_initializer(size_t i) {
    int depth = 0;
    while (i < ntok && toks[i].kind != TK_EOF) {
        if (tok_eq(i, "(") || tok_eq(i, "[") || tok_eq(i, "{")) depth++;
        else if (tok_eq(i, ")") || tok_eq(i, "]") || tok_eq(i, "}")) {
            if (depth == 0) return i;
            depth--;
        } else if (depth == 0 && (tok_eq(i, ",") || tok_eq(i, ";"))) {
            return i;
        }
        i++;
    }
    return i;
}

/* ============================================================
 * Type name tables (typedefs and struct/union tags)
 * ============================================================ */

typedef struct {
    char     name[64];
    uint8_t  type;
    uint32_t size;
} NamedType;

static const NamedType BUILTIN_TYPEDEFS[] = {
    {"size_t", T_LONG, 8},   {"ssize_t", T_LONG, 8},  {"ptrdiff_t", T_LONG, 8},
    {"uint8_t", T_CHAR, 1},  {"int8_t", T_CHAR, 1},   {"uint16_t", T_SHORT, 2},
    {"int16_t", T_SHORT, 2}, {"uint32_t", T_INT, 4},  {"int32_t", T_INT, 4},
    {"uint64_t", T_LONG, 8}, {"int64_t", T_LONG, 8},  {"bool", T_BOOL, 1},
    {"FILE", T_STRUCT, 0},   {"va_list", T_POINTER, 8}
};
#define NUM_BUILTIN_TYPEDEFS (sizeof(BUILTIN_TYPEDEFS) / sizeof(BUILTIN_TYPEDEFS[0]))

static NamedType user_typedefs[256];
static size_t    n_user_typedefs = 0;

static NamedType tags[128];
static size_t    n_tags = 0;

static int name_eq_tok(const char *name, size_t i) {
    size_t n = strlen(name);
    return toks[i].len == n && memcmp(src + toks[i].pos, name, n) == 0;
}

static const NamedType *find_typedef(size_t i) {
    if (!tok_is_ident(i)) return NULL;
    for (size_t k = 0; k < n_user_typedefs; k++)
        if (name_eq_tok(user_typedefs[k].name, i)) return &user_typedefs[k];
    for (size_t k = 0; k < NUM_BUILTIN_TYPEDEFS; k++)
        if (name_eq_tok(BUILTIN_TYPEDEFS[k].name, i)) return &BUILTIN_TYPEDEFS[k];
    return NULL;
}

static void copy_tok_name(char *dst, size_t cap, size_t i) {
    size_t n = toks[i].len;
    if (n > cap - 1) n = cap - 1;
    memcpy(dst, src + toks[i].pos, n);
    dst[n] = '\0';
}

static void add_typedef(size_t name_tok, uint8_t type, uint32_t size) {
    if (n_user_typedefs >= sizeof(user_typedefs) / sizeof(user_typedefs[0])) return;
    copy_tok_name(user_typedefs[n_user_typedefs].name, 64, name_tok);
    user_typedefs[n_user_typedefs].type = type;
    user_typedefs[n_user_typedefs].size = size;
    n_user_typedefs++;
}

static NamedType *find_tag(size_t i) {
    for (size_t k = 0; k < n_tags; k++)
        if (name_eq_tok(tags[k].name, i)) return &tags[k];
    return NULL;
}

static void add_tag(size_t name_tok, uint32_t size) {
    NamedType *existing = find_tag(name_tok);
    if (existing) { existing->size = size; return; }
    if (n_tags >= sizeof(tags) / sizeof(tags[0])) return;
    copy_tok_name(tags[n_tags].name, 64, name_tok);
    tags[n_tags].size = size;
    n_tags++;
}

/* ============================================================
 * Declarations found by the parser
 * ============================================================ */

typedef struct {
    char     name[MAX_IDENT_LEN + 1];
    uint8_t  type;
    uint8_t  scope;
    uint8_t  storage_class;
    uint16_t offset;
} Decl;

static Decl   decls[MAX_DECLS];
static size_t ndecl = 0;

static uint32_t data_offset = 0;   /* running offset in the data segment  */
static uint32_t frame_offset = 0;  /* running offset in the current frame */

static void obj_set_add(size_t decl_index);

static void record_decl(size_t name_tok, uint8_t type, uint8_t scope,
                        uint8_t storage_class, uint32_t offset) {
    if (ndecl >= MAX_DECLS) fail(2, "input declares more than 8192 symbols");
    Decl *d = &decls[ndecl++];
    copy_tok_name(d->name, sizeof(d->name), name_tok);
    d->type = type;
    d->scope = scope;
    d->storage_class = storage_class;
    /* offset is a 16-bit field: past 64 KiB it saturates rather than wrapping */
    d->offset = offset > 0xFFFF ? 0xFFFF : (uint16_t)offset;
    if (storage_class != SC_TYPEDEF) obj_set_add(ndecl - 1);
}

/* Set of names already declared as objects (not type names), so the check
 * below stays O(1) per token instead of scanning every declaration. */
#define OBJ_SLOTS 16384u
static uint16_t obj_slots[OBJ_SLOTS];   /* decl index + 1; 0 means empty */

static uint32_t name_hash(const char *s, size_t len) {
    uint32_t h = 5381;
    for (size_t i = 0; i < len; i++) h = ((h << 5) + h) + (unsigned char)s[i];
    return h;
}

static void obj_set_add(size_t decl_index) {
    const char *name = decls[decl_index].name;
    uint32_t slot = name_hash(name, strlen(name)) % OBJ_SLOTS;
    for (uint32_t probe = 0; probe < OBJ_SLOTS; probe++) {
        uint32_t s = (slot + probe) % OBJ_SLOTS;
        if (obj_slots[s] == 0) { obj_slots[s] = (uint16_t)(decl_index + 1); return; }
        if (strcmp(decls[obj_slots[s] - 1].name, name) == 0) return;   /* already present */
    }
}

/* Has this name already been declared as an object (not a type name)?
 * Used to keep `a * b;` from being misread as a pointer declaration. */
static int declared_as_object(size_t i) {
    uint32_t slot = name_hash(src + toks[i].pos, toks[i].len) % OBJ_SLOTS;
    for (uint32_t probe = 0; probe < OBJ_SLOTS; probe++) {
        uint32_t s = (slot + probe) % OBJ_SLOTS;
        if (obj_slots[s] == 0) return 0;
        if (name_eq_tok(decls[obj_slots[s] - 1].name, i)) return 1;
    }
    return 0;
}

/* A function declared by a prototype and then defined is the same symbol. */
static int function_already_declared(size_t i, uint8_t scope) {
    for (size_t k = 0; k < ndecl; k++)
        if (decls[k].type == T_FUNCTION && decls[k].scope == scope && name_eq_tok(decls[k].name, i))
            return 1;
    return 0;
}

static uint32_t align_up(uint32_t off, uint32_t size) {
    uint32_t a = size >= 8 ? 8 : (size >= 4 ? 4 : (size >= 2 ? 2 : 1));
    if (a == 0) a = 1;
    uint32_t rem = off % a;
    return rem ? off + (a - rem) : off;
}

/* ============================================================
 * Parser: declarations + scope tracking
 * ============================================================ */

typedef struct {
    uint8_t   depth;
    uint8_t   default_storage;
    uint32_t *offset_ctr;
    int       union_mode;
} DeclCtx;

typedef struct {
    uint8_t  type;
    uint32_t size;
    int      have;
} TypeSpec;

static size_t parse_declaration(size_t i, DeclCtx ctx);

static uint8_t clamp_depth(int d) { return d > 255 ? 255 : (uint8_t)(d < 0 ? 0 : d); }

/* struct/union/enum specifier, including an inline body whose members
 * become symbols of their own at the next scope depth. */
static size_t parse_tag_specifier(size_t i, DeclCtx ctx, TypeSpec *ts) {
    int is_struct = tok_eq(i, "struct");
    int is_union = tok_eq(i, "union");
    i++;

    size_t tag_tok = 0;
    int have_tag = 0;
    if (tok_is_ident(i) && !tok_is_keyword(i)) { tag_tok = i; have_tag = 1; i++; }

    ts->have = 1;
    ts->type = is_struct ? T_STRUCT : (is_union ? T_UNION : T_ENUM);
    ts->size = is_struct || is_union ? 0 : 4;

    if (tok_eq(i, "{")) {
        if (!is_struct && !is_union) {          /* enum body: no symbols of interest */
            i = skip_group(i, "{", "}");
            ts->size = 4;
        } else {
            i++;                                /* past '{' */
            uint32_t body_size = 0;
            DeclCtx mctx;
            mctx.depth = clamp_depth(ctx.depth + 1);
            mctx.default_storage = SC_MEMBER;
            mctx.offset_ctr = &body_size;
            mctx.union_mode = is_union;

            while (i < ntok && toks[i].kind != TK_EOF && !tok_eq(i, "}")) {
                size_t next = parse_declaration(i, mctx);
                if (next == (size_t)-1 || next == i) {
                    /* not parseable as a member declaration: skip to the next ';' */
                    while (i < ntok && toks[i].kind != TK_EOF &&
                           !tok_eq(i, ";") && !tok_eq(i, "}")) i++;
                    if (tok_eq(i, ";")) i++;
                } else {
                    i = next;
                }
            }
            if (tok_eq(i, "}")) i++;
            ts->size = align_up(body_size, 8) == body_size ? body_size : align_up(body_size, 8);
            if (ts->size == 0) ts->size = 1;
            if (have_tag) add_tag(tag_tok, ts->size);
        }
    } else if (have_tag) {
        NamedType *t = find_tag(tag_tok);
        ts->size = t ? t->size : 0;
    }
    return i;
}

/* Parse declaration specifiers. Returns the index of the first declarator
 * token, or (size_t)-1 if what follows is not a declaration at all. */
static size_t parse_specifiers(size_t i, DeclCtx ctx, TypeSpec *ts, uint8_t *storage,
                               int *is_typedef) {
    int longs = 0;
    ts->have = 0;
    ts->type = T_INT;
    ts->size = 4;
    *storage = ctx.default_storage;
    *is_typedef = 0;

    for (;;) {
        if (i >= ntok || toks[i].kind == TK_EOF) break;

        if (tok_eq(i, "static"))        { *storage = SC_STATIC;   i++; continue; }
        if (tok_eq(i, "extern"))        { *storage = SC_EXTERN;   i++; continue; }
        if (tok_eq(i, "register"))      { *storage = SC_REGISTER; i++; continue; }
        if (tok_eq(i, "typedef"))       { *is_typedef = 1;        i++; continue; }
        if (tok_eq(i, "auto"))          { i++; continue; }
        if (is_qualifier(i))            { i++; continue; }

        if (tok_eq(i, "signed") || tok_eq(i, "unsigned")) { ts->have = 1; i++; continue; }
        if (tok_eq(i, "void"))   { ts->have = 1; ts->type = T_VOID;   ts->size = 1; i++; continue; }
        if (tok_eq(i, "char"))   { ts->have = 1; ts->type = T_CHAR;   ts->size = 1; i++; continue; }
        if (tok_eq(i, "short"))  { ts->have = 1; ts->type = T_SHORT;  ts->size = 2; i++; continue; }
        if (tok_eq(i, "_Bool"))  { ts->have = 1; ts->type = T_BOOL;   ts->size = 1; i++; continue; }
        if (tok_eq(i, "float"))  { ts->have = 1; ts->type = T_FLOAT;  ts->size = 4; i++; continue; }
        if (tok_eq(i, "double")) { ts->have = 1; ts->type = T_DOUBLE; ts->size = 8; i++; continue; }
        if (tok_eq(i, "int")) {
            ts->have = 1;
            if (ts->type != T_SHORT && ts->type != T_LONG) { ts->type = T_INT; ts->size = 4; }
            i++;
            continue;
        }
        if (tok_eq(i, "long")) {
            ts->have = 1; longs++;
            if (ts->type != T_DOUBLE) { ts->type = T_LONG; ts->size = 8; }
            i++;
            continue;
        }
        if (tok_eq(i, "struct") || tok_eq(i, "union") || tok_eq(i, "enum")) {
            i = parse_tag_specifier(i, ctx, ts);
            continue;
        }

        if (!ts->have && tok_is_ident(i) && !tok_is_keyword(i)) {
            const NamedType *td = find_typedef(i);
            if (td) { ts->have = 1; ts->type = td->type; ts->size = td->size ? td->size : 4; i++; continue; }

            /* An unknown type name: only treated as one when the shape says so
             * (`Foo bar`, or `Foo *bar` where Foo is not a known object). */
            int next_is_ident = tok_is_ident(i + 1) && !tok_is_keyword(i + 1);
            int next_is_star = tok_eq(i + 1, "*");
            if ((next_is_ident || next_is_star) && !declared_as_object(i)) {
                ts->have = 1; ts->type = T_UNKNOWN; ts->size = 4;
                i++;
                continue;
            }
        }
        break;
    }

    (void)longs;
    return ts->have ? i : (size_t)-1;
}

/* Parameters of a function definition become symbols in the function's scope. */
static void parse_params(size_t from, size_t to, uint8_t depth) {
    size_t i = from;
    while (i < to) {
        size_t seg_start = i;
        int depth_paren = 0;
        while (i < to && !(depth_paren == 0 && tok_eq(i, ","))) {
            if (tok_eq(i, "(") || tok_eq(i, "[")) depth_paren++;
            else if (tok_eq(i, ")") || tok_eq(i, "]")) depth_paren--;
            i++;
        }
        size_t seg_end = i;      /* exclusive */
        if (i < to) i++;         /* past ',' */

        if (seg_end <= seg_start) continue;
        if (seg_end - seg_start == 1 && tok_eq(seg_start, "void")) continue;
        if (tok_eq(seg_start, ".")) continue;   /* ... */

        /* Type from the specifiers, name from the last identifier in the segment. */
        TypeSpec ts = {T_UNKNOWN, 4, 0};
        int ptr = 0, array = 0;
        size_t name_tok = 0;
        int have_name = 0;

        for (size_t k = seg_start; k < seg_end; k++) {
            if (tok_eq(k, "*")) { ptr++; continue; }
            if (tok_eq(k, "[")) { array = 1; continue; }
            if (tok_eq(k, "void"))   { ts.type = T_VOID;   ts.size = 1; ts.have = 1; continue; }
            if (tok_eq(k, "char"))   { ts.type = T_CHAR;   ts.size = 1; ts.have = 1; continue; }
            if (tok_eq(k, "short"))  { ts.type = T_SHORT;  ts.size = 2; ts.have = 1; continue; }
            if (tok_eq(k, "int"))    { if (!ts.have) { ts.type = T_INT; ts.size = 4; } ts.have = 1; continue; }
            if (tok_eq(k, "long"))   { ts.type = T_LONG;   ts.size = 8; ts.have = 1; continue; }
            if (tok_eq(k, "float"))  { ts.type = T_FLOAT;  ts.size = 4; ts.have = 1; continue; }
            if (tok_eq(k, "double")) { ts.type = T_DOUBLE; ts.size = 8; ts.have = 1; continue; }
            if (tok_eq(k, "_Bool"))  { ts.type = T_BOOL;   ts.size = 1; ts.have = 1; continue; }
            if (tok_eq(k, "struct") || tok_eq(k, "union")) { ts.type = T_STRUCT; ts.have = 1; continue; }
            if (tok_eq(k, "enum"))   { ts.type = T_ENUM; ts.size = 4; ts.have = 1; continue; }
            if (tok_is_keyword(k)) continue;
            if (!tok_is_ident(k)) continue;

            const NamedType *td = find_typedef(k);
            if (td && !ts.have) { ts.type = td->type; ts.size = td->size ? td->size : 4; ts.have = 1; continue; }
            name_tok = k;
            have_name = 1;
        }

        if (!have_name) continue;   /* abstract parameter, e.g. a prototype's `int` */

        uint8_t type = ptr || array ? T_POINTER : ts.type;
        uint32_t size = ptr || array ? 8 : (ts.size ? ts.size : 4);
        frame_offset = align_up(frame_offset, size);
        record_decl(name_tok, type, depth, SC_PARAM, frame_offset);
        frame_offset += size;
    }
}

/* Parse one declaration (possibly declaring several names) starting at i.
 * Returns the index just past it, or (size_t)-1 if this is not a declaration.
 * For a function definition it returns the index of the body's '{', leaving
 * the scope bookkeeping to the main loop. */
static size_t parse_declaration(size_t i, DeclCtx ctx) {
    TypeSpec ts;
    uint8_t storage;
    int is_typedef;

    size_t after_spec = parse_specifiers(i, ctx, &ts, &storage, &is_typedef);
    if (after_spec == (size_t)-1) return (size_t)-1;
    i = after_spec;

    for (;;) {
        if (i >= ntok || toks[i].kind == TK_EOF) break;
        if (tok_eq(i, ";")) break;

        int ptr = 0;
        while (tok_eq(i, "*") || is_qualifier(i)) {
            if (tok_eq(i, "*")) ptr++;
            i++;
        }

        uint8_t type = ptr ? T_POINTER : ts.type;
        uint32_t size = ptr ? 8 : (ts.size ? ts.size : 4);

        size_t name_tok;
        int is_func_ptr = 0;

        if (tok_eq(i, "(") && tok_eq(i + 1, "*")) {       /* int (*fp)(void) */
            size_t j = i + 2;
            while (tok_eq(j, "*")) j++;
            if (!tok_is_ident(j)) return (size_t)-1;
            name_tok = j;
            i = skip_group(i, "(", ")");
            if (tok_eq(i, "(")) i = skip_group(i, "(", ")");
            type = T_POINTER;
            size = 8;
            is_func_ptr = 1;
        } else if (tok_is_ident(i) && !tok_is_keyword(i)) {
            name_tok = i;
            i++;
        } else {
            break;   /* abstract declarator or something we do not model */
        }

        int is_func = 0;
        if (!is_func_ptr) {
            while (i < ntok && toks[i].kind != TK_EOF) {
                if (tok_eq(i, "[")) {
                    uint32_t count = 0;
                    if (i + 1 < ntok && toks[i + 1].kind == TK_NUM) {
                        char buf[32];
                        size_t n = toks[i + 1].len < sizeof(buf) - 1 ? toks[i + 1].len : sizeof(buf) - 1;
                        memcpy(buf, src + toks[i + 1].pos, n);
                        buf[n] = '\0';
                        count = (uint32_t)strtoul(buf, NULL, 0);
                    }
                    i = skip_group(i, "[", "]");
                    type = T_ARRAY;
                    if (count && size && count < 0x10000000u / (size ? size : 1)) size *= count;
                    continue;
                }
                if (tok_eq(i, "(")) { is_func = 1; }
                break;
            }
        }

        if (is_func) {
            uint8_t fn_storage = storage;
            if (fn_storage == SC_LOCAL) fn_storage = SC_GLOBAL;
            if (is_typedef) fn_storage = SC_TYPEDEF;

            size_t params_open = i;
            size_t after_params = skip_group(i, "(", ")");

            if (is_typedef) {
                add_typedef(name_tok, T_POINTER, 8);
                record_decl(name_tok, T_FUNCTION, ctx.depth, SC_TYPEDEF, 0);
            } else if (!function_already_declared(name_tok, ctx.depth)) {
                /* a prototype and its definition are one symbol, not two */
                record_decl(name_tok, T_FUNCTION, ctx.depth, fn_storage, 0);
            }

            if (tok_eq(after_params, "{")) {          /* definition: parameters are symbols */
                frame_offset = 0;
                parse_params(params_open + 1, after_params - 1, clamp_depth(ctx.depth + 1));
                return after_params;                  /* leave '{' for the main loop */
            }
            i = after_params;                         /* prototype */
        } else {
            if (is_typedef) {
                add_typedef(name_tok, type, size);
                record_decl(name_tok, type, ctx.depth, SC_TYPEDEF, 0);
            } else {
                uint32_t off;
                if (ctx.union_mode) {
                    off = 0;
                    if (size > *ctx.offset_ctr) *ctx.offset_ctr = size;
                } else {
                    *ctx.offset_ctr = align_up(*ctx.offset_ctr, size);
                    off = *ctx.offset_ctr;
                    *ctx.offset_ctr += size ? size : 1;
                }
                record_decl(name_tok, type, ctx.depth, storage, off);
            }
        }

        if (tok_eq(i, ":")) {          /* bit-field width */
            i++;
            if (i < ntok && toks[i].kind == TK_NUM) i++;
        }
        if (tok_eq(i, "=")) i = skip_initializer(i);
        if (tok_eq(i, ",")) { i++; continue; }
        break;
    }

    if (tok_eq(i, ";")) i++;
    return i;
}

/* Does a declaration plausibly start here? Cheap pre-filter so ordinary
 * statements are not run through the declaration parser. */
static int looks_like_decl(size_t i) {
    if (i >= ntok || toks[i].kind == TK_EOF) return 0;
    if (tok_eq(i, "return") || tok_eq(i, "if") || tok_eq(i, "while") ||
        tok_eq(i, "for") || tok_eq(i, "switch") || tok_eq(i, "case") ||
        tok_eq(i, "do") || tok_eq(i, "else") || tok_eq(i, "goto") ||
        tok_eq(i, "break") || tok_eq(i, "continue") || tok_eq(i, "default") ||
        tok_eq(i, "sizeof")) return 0;

    if (tok_is_keyword(i)) return 1;           /* a type or storage keyword */
    if (!tok_is_ident(i)) return 0;
    if (find_typedef(i)) return 1;
    if (declared_as_object(i)) return 0;
    if (tok_is_ident(i + 1) && !tok_is_keyword(i + 1)) return 1;
    if (tok_eq(i + 1, "*") && tok_is_ident(i + 2)) return 1;
    return 0;
}

static void parse_translation_unit(void) {
    size_t i = 0;
    int depth = 0;
    int stmt_start = 1;

    while (i < ntok && toks[i].kind != TK_EOF) {
        if (tok_eq(i, "{")) { depth++; i++; stmt_start = 1; continue; }
        if (tok_eq(i, "}")) { if (depth > 0) depth--; i++; stmt_start = 1; continue; }
        if (tok_eq(i, ";")) { i++; stmt_start = 1; continue; }

        if (stmt_start && tok_eq(i, "for") && tok_eq(i + 1, "(")) {
            DeclCtx c;
            c.depth = clamp_depth(depth + 1);
            c.default_storage = SC_LOCAL;
            c.offset_ctr = &frame_offset;
            c.union_mode = 0;
            if (looks_like_decl(i + 2)) {
                size_t next = parse_declaration(i + 2, c);
                if (next != (size_t)-1 && next > i) { i = next; stmt_start = 0; continue; }
            }
            i += 2;
            stmt_start = 0;
            continue;
        }

        /* A type or storage keyword starts a declaration wherever it appears,
         * so stray tokens before it do not hide the declarations after them.
         * In an expression (a cast, `sizeof(int)`) the declarator parse finds
         * no name and records nothing. */
        if ((stmt_start || tok_is_keyword(i)) && looks_like_decl(i)) {
            DeclCtx c;
            c.depth = clamp_depth(depth);
            c.default_storage = depth == 0 ? SC_GLOBAL : SC_LOCAL;
            c.offset_ctr = depth == 0 ? &data_offset : &frame_offset;
            c.union_mode = 0;
            size_t next = parse_declaration(i, c);
            if (next != (size_t)-1 && next > i) { i = next; stmt_start = 1; continue; }
        }

        stmt_start = 0;
        i++;
    }
}

/* ============================================================
 * BASELINE: hash table with separate chaining (textbook layout)
 * ============================================================ */

typedef struct HNode {
    char         *name;
    struct HNode *next;
    int type;
    int scope;
    int storage_class;
    int offset;
} HNode;

#define HASH_BUCKETS 64
static HNode *baseline_buckets[HASH_BUCKETS];
static size_t baseline_bytes = 0;

static unsigned hash_str(const char *s) {
    unsigned h = 5381;
    while (*s) h = ((h << 5) + h) + (unsigned char)(*s++);
    return h % HASH_BUCKETS;
}

static void *counting_malloc(size_t n) {
    void *p = malloc(n);
    if (!p) fail(2, "out of memory building baseline table");
    baseline_bytes += n + MALLOC_OVERHEAD;
    return p;
}

static void baseline_insert(const Decl *d) {
    HNode *n = counting_malloc(sizeof(HNode));
    n->name = counting_malloc(strlen(d->name) + 1);
    strcpy(n->name, d->name);
    n->type = d->type;
    n->scope = d->scope;
    n->storage_class = d->storage_class;
    n->offset = d->offset;
    unsigned b = hash_str(d->name);
    n->next = baseline_buckets[b];
    baseline_buckets[b] = n;
}

static int baseline_contains(const Decl *d) {
    for (HNode *n = baseline_buckets[hash_str(d->name)]; n; n = n->next)
        if (strcmp(n->name, d->name) == 0 && n->type == d->type && n->scope == d->scope &&
            n->storage_class == d->storage_class && n->offset == d->offset)
            return 1;
    return 0;
}

static int baseline_has_name(const char *name) {
    for (HNode *n = baseline_buckets[hash_str(name)]; n; n = n->next)
        if (strcmp(n->name, name) == 0) return 1;
    return 0;
}

static void baseline_free(void) {
    for (int b = 0; b < HASH_BUCKETS; b++) {
        HNode *n = baseline_buckets[b];
        while (n) { HNode *next = n->next; free(n->name); free(n); n = next; }
        baseline_buckets[b] = NULL;
    }
}

/* ============================================================
 * COMPRESSED: radix trie + arena + bit-packed metadata
 * ============================================================ */

#define MAX_NODES  60000u
#define MAX_CHARS  60000u
#define MAX_SYMS   MAX_DECLS
#define NIL        0xFFFF
#define ROOT       0

typedef struct {
    uint16_t first_child;
    uint16_t next_sibling;
    uint16_t edge_offset;
    uint8_t  edge_len;
    uint8_t  is_leaf;
    uint16_t symbol_id;
} TrieNode;

static TrieNode      node_pool[MAX_NODES];
static uint16_t      node_count = 0;
static unsigned char char_pool[MAX_CHARS];
static uint16_t      char_used = 0;
static uint32_t      meta_pool[MAX_SYMS];
static uint16_t      meta_count = 0;
static uint16_t      edge_stores = 0;   /* how many separate edge strings exist */

/* A name declared twice (shadowed in an inner scope, or re-declared) needs a
 * second metadata word. The leaf points at the newest; older ones hang off
 * this side table, so the common case -- unique names -- costs nothing. */
typedef struct { uint16_t newer; uint16_t older; } ShadowLink;
static ShadowLink shadow_links[MAX_SYMS];
static uint16_t   shadow_count = 0;

static uint16_t new_node(void) {
    if (node_count >= MAX_NODES) fail(2, "input exceeds the trie node arena");
    uint16_t id = node_count++;
    node_pool[id].first_child = NIL;
    node_pool[id].next_sibling = NIL;
    node_pool[id].is_leaf = 0;
    node_pool[id].symbol_id = NIL;
    return id;
}

/* Static arrays start zeroed, and 0 is a valid node index (root's own), not
 * the NIL sentinel -- without this the root points at itself and the sibling
 * walk never terminates. */
static void trie_init(void) {
    node_pool[ROOT].first_child = NIL;
    node_pool[ROOT].next_sibling = NIL;
    node_pool[ROOT].is_leaf = 0;
    node_pool[ROOT].symbol_id = NIL;
    node_count = 1;
}

static uint16_t pool_store(const char *chars, uint8_t len) {
    if ((uint32_t)char_used + len > MAX_CHARS) fail(2, "input exceeds the character arena");
    uint16_t off = char_used;
    memcpy(&char_pool[off], chars, len);
    char_used = (uint16_t)(char_used + len);
    edge_stores++;
    return off;
}

static uint32_t pack_meta(uint8_t type, uint8_t scope, uint8_t storage_class, uint16_t offset) {
    /* 4 bits type | 8 bits scope | 4 bits storage_class | 16 bits offset */
    return ((uint32_t)(type & 0xF) << 28)
         | ((uint32_t)scope << 20)
         | ((uint32_t)(storage_class & 0xF) << 16)
         | (uint32_t)offset;
}

static void unpack_meta(uint32_t m, uint8_t *type, uint8_t *scope,
                        uint8_t *storage_class, uint16_t *offset) {
    *type          = (m >> 28) & 0xF;
    *scope         = (m >> 20) & 0xFF;
    *storage_class = (m >> 16) & 0xF;
    *offset        = m & 0xFFFF;
}

static uint16_t store_metadata(uint32_t packed) {
    if (meta_count >= MAX_SYMS) fail(2, "input exceeds the metadata arena");
    meta_pool[meta_count] = packed;
    return meta_count++;
}

static uint16_t *find_child_slot(uint16_t parent, char c) {
    uint16_t *slot = &node_pool[parent].first_child;
    while (*slot != NIL && char_pool[node_pool[*slot].edge_offset] != (unsigned char)c)
        slot = &node_pool[*slot].next_sibling;
    return slot;
}

/* Insert key and return the node that terminates it, splitting edges as
 * needed. Metadata is attached by the caller. */
static uint16_t trie_insert_node(const char *key) {
    size_t len = strlen(key);
    uint16_t cur = ROOT;
    size_t pos = 0;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);

        if (*slot == NIL) {
            uint16_t leaf = new_node();
            node_pool[leaf].edge_offset = pool_store(key + pos, (uint8_t)(len - pos));
            node_pool[leaf].edge_len = (uint8_t)(len - pos);
            *slot = leaf;
            return leaf;
        }

        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;

        size_t cp = 0;
        while (cp < e_len && pos + cp < len && char_pool[e_off + cp] == (unsigned char)key[pos + cp]) cp++;

        if (cp == e_len) {
            pos += cp;
            cur = child;
            if (pos == len) return cur;
            continue;
        }

        /* Partial match: split this edge at cp. */
        uint16_t mid = new_node();
        node_pool[mid].edge_offset = e_off;
        node_pool[mid].edge_len = (uint8_t)cp;
        node_pool[mid].next_sibling = node_pool[child].next_sibling;

        node_pool[child].edge_offset = (uint16_t)(e_off + cp);
        node_pool[child].edge_len = (uint8_t)(e_len - cp);
        node_pool[child].next_sibling = NIL;
        node_pool[mid].first_child = child;

        *slot = mid;   /* mid takes child's place in the parent's sibling list */

        size_t remaining = len - (pos + cp);
        if (remaining == 0) return mid;

        uint16_t leaf = new_node();
        node_pool[leaf].edge_offset = pool_store(key + pos + cp, (uint8_t)remaining);
        node_pool[leaf].edge_len = (uint8_t)remaining;
        node_pool[child].next_sibling = leaf;
        return leaf;
    }
    return ROOT;   /* empty key */
}

static uint16_t trie_lookup(const char *key) {
    size_t len = strlen(key);
    uint16_t cur = ROOT;
    size_t pos = 0;

    while (pos < len) {
        uint16_t *slot = find_child_slot(cur, key[pos]);
        if (*slot == NIL) return NIL;
        uint16_t child = *slot;
        uint16_t e_off = node_pool[child].edge_offset;
        uint8_t  e_len = node_pool[child].edge_len;
        if (e_len > len - pos) return NIL;
        if (memcmp(&char_pool[e_off], key + pos, e_len) != 0) return NIL;
        pos += e_len;
        cur = child;
    }
    if (!node_pool[cur].is_leaf) return NIL;
    return node_pool[cur].symbol_id;
}

static void trie_add_symbol(const Decl *d) {
    uint16_t leaf = trie_insert_node(d->name);
    uint16_t id = store_metadata(pack_meta(d->type, d->scope, d->storage_class, d->offset));
    if (node_pool[leaf].is_leaf && node_pool[leaf].symbol_id != NIL) {
        if (shadow_count >= MAX_SYMS) fail(2, "too many shadowed declarations");
        shadow_links[shadow_count].newer = id;
        shadow_links[shadow_count].older = node_pool[leaf].symbol_id;
        shadow_count++;
    }
    node_pool[leaf].is_leaf = 1;
    node_pool[leaf].symbol_id = id;
}

/* Links are appended as metadata ids grow, so `newer` is sorted: binary
 * search keeps chain walks off a quadratic path on shadow-heavy input. */
static uint16_t shadow_older(uint16_t newer) {
    uint16_t lo = 0, hi = shadow_count;
    while (lo < hi) {
        uint16_t mid = (uint16_t)(lo + (hi - lo) / 2);
        if (shadow_links[mid].newer == newer) return shadow_links[mid].older;
        if (shadow_links[mid].newer < newer) lo = (uint16_t)(mid + 1);
        else hi = mid;
    }
    return NIL;
}

/* Walk a name's metadata chain (newest first) looking for this declaration.
 * Compares unpacked fields, so this also proves the pack/unpack round-trip. */
static int trie_contains(const Decl *d) {
    uint16_t id = trie_lookup(d->name);
    int guard = 0;
    while (id != NIL && guard++ <= (int)meta_count) {
        uint8_t type, scope, storage_class;
        uint16_t offset;
        unpack_meta(meta_pool[id], &type, &scope, &storage_class, &offset);
        if (type == d->type && scope == d->scope &&
            storage_class == d->storage_class && offset == d->offset) return 1;
        id = shadow_older(id);
    }
    return 0;
}

/* ============================================================
 * Memory accounting, including the ablation variants
 *
 * Three techniques, each independently on or off:
 *   storage : hash table  vs  radix trie
 *   alloc   : malloc + pointers  vs  flat arena + 16-bit indices
 *   metadata: four ints  vs  one bit-packed uint32
 *
 * The structures' *shape* (symbol count, name bytes, trie node and edge
 * counts) is measured from the real build above; only the per-record
 * layout changes between variants, and each layout below is a real struct
 * so the compiler -- not a hand calculation -- decides its size.
 * ============================================================ */

typedef struct HNodeP  { char *name; struct HNodeP *next; uint32_t meta; } HNodeP;
typedef struct { uint16_t name_off; uint16_t next; int type, scope, storage_class, offset; } HNodeArenaU;
typedef struct { uint16_t name_off; uint16_t next; uint32_t meta; } HNodeArenaP;
typedef struct { int type, scope, storage_class, offset; } MetaUnpacked;
typedef struct TrieU { struct TrieU *first_child, *next_sibling; char *edge;
                       uint8_t edge_len, is_leaf; MetaUnpacked *meta; } TrieNodePtrU;
typedef struct TrieB { struct TrieB *first_child, *next_sibling; char *edge;
                       uint8_t edge_len, is_leaf; uint32_t meta; } TrieNodePtrP;

typedef struct {
    size_t n_syms;       /* declarations recorded                        */
    size_t name_bytes;   /* sum of strlen(name)+1 over declarations      */
    size_t nodes;        /* trie nodes actually used                     */
    size_t edge_bytes;   /* characters held in the trie's edge storage   */
    size_t edge_allocs;  /* separately allocated edge strings            */
    size_t shadows;      /* redeclarations needing a chain link          */
} Shape;

static size_t hash_malloc_bytes(const Shape *s, size_t node_size, size_t meta_extra) {
    return HASH_BUCKETS * sizeof(void *)
         + s->n_syms * (node_size + MALLOC_OVERHEAD)
         + s->name_bytes + s->n_syms * MALLOC_OVERHEAD
         + meta_extra;
}

static size_t hash_arena_bytes(const Shape *s, size_t node_size) {
    return HASH_BUCKETS * sizeof(uint16_t)
         + s->n_syms * node_size
         + s->name_bytes;
}

static size_t trie_malloc_bytes(const Shape *s, size_t node_size, int meta_separate) {
    size_t total = s->nodes * (node_size + MALLOC_OVERHEAD)
                 + s->edge_bytes + s->edge_allocs * MALLOC_OVERHEAD;
    if (meta_separate)
        total += s->n_syms * (sizeof(MetaUnpacked) + MALLOC_OVERHEAD);
    total += s->shadows * (sizeof(void *) + MALLOC_OVERHEAD);
    return total;
}

static size_t trie_arena_bytes(const Shape *s, size_t meta_size) {
    return s->nodes * sizeof(TrieNode)
         + s->edge_bytes
         + s->n_syms * meta_size
         + s->shadows * sizeof(ShadowLink);
}

/* ============================================================
 * JSON output
 * ============================================================ */

static void json_escape(const char *s, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        switch (c) {
            case '"':  fputs("\\\"", stdout); break;
            case '\\': fputs("\\\\", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            default:
                if (c < 0x20) printf("\\u%04x", c);
                else putchar((int)c);
        }
    }
}

static void print_json(const Shape *shape, size_t baseline_total, size_t compressed_total,
                       const size_t ablation[6]) {
    static const char *ABLATION_KEYS[6] = {
        "trie_only", "arena_only", "bitpack_only",
        "trie_arena", "trie_bitpack", "arena_bitpack"
    };

    double savings = baseline_total
        ? 100.0 * (1.0 - (double)compressed_total / (double)baseline_total)
        : 0.0;

    printf("{\"baseline_bytes\":%zu,\"compressed_bytes\":%zu,\"savings_pct\":%.2f,",
           baseline_total, compressed_total, savings);

    printf("\"symbol_table\":[");
    for (size_t i = 0; i < ndecl; i++) {
        const Decl *d = &decls[i];
        if (i) putchar(',');
        printf("{\"name\":\"");
        json_escape(d->name, strlen(d->name));
        printf("\",\"type\":\"%s\",\"scope\":%u,\"storage_class\":\"%s\",\"offset\":%u}",
               TYPE_NAMES[d->type & 0xF], (unsigned)d->scope,
               STORAGE_NAMES[d->storage_class & 0xF], (unsigned)d->offset);
    }
    printf("],");

    printf("\"ablation\":{");
    for (size_t i = 0; i < 6; i++)
        printf("%s\"%s\":%zu", i ? "," : "", ABLATION_KEYS[i], ablation[i]);
    printf("},");

    printf("\"stats\":{\"symbols\":%zu,\"trie_nodes\":%zu,\"char_pool_bytes\":%zu,"
           "\"name_bytes\":%zu,\"shadowed\":%zu,\"source_bytes\":%zu}}\n",
           shape->n_syms, shape->nodes, shape->edge_bytes,
           shape->name_bytes, shape->shadows, src_len);
}

/* ============================================================
 * main
 * ============================================================ */

#ifdef SYMTAB_SELF_LIMIT
static void self_limit(void) {
    struct rlimit r;
    r.rlim_cur = r.rlim_max = 256u * 1024u * 1024u;   /* 256 MiB address space */
    setrlimit(RLIMIT_AS, &r);
    r.rlim_cur = r.rlim_max = 5;                      /* 5 seconds of CPU      */
    setrlimit(RLIMIT_CPU, &r);
    r.rlim_cur = r.rlim_max = 0;                      /* no core dumps         */
    setrlimit(RLIMIT_CORE, &r);
}
#endif

static void read_stdin(void) {
    size_t cap = 65536, len = 0;
    char *buf = malloc(cap);
    if (!buf) fail(2, "out of memory reading input");

    for (;;) {
        if (len == cap) {
            if (cap >= MAX_SOURCE_BYTES) {
                size_t extra = fread(buf, 1, 1, stdin);
                if (extra) { free(buf); fail(2, "source larger than 1 MiB"); }
                break;
            }
            cap *= 2;
            char *grown = realloc(buf, cap);
            if (!grown) { free(buf); fail(2, "out of memory reading input"); }
            buf = grown;
        }
        size_t got = fread(buf + len, 1, cap - len, stdin);
        len += got;
        if (got == 0) break;
    }
    if (len > MAX_SOURCE_BYTES) { free(buf); fail(2, "source larger than 1 MiB"); }

    src = buf;
    src_len = len;
}

int main(void) {
#ifdef SYMTAB_SELF_LIMIT
    self_limit();
#endif

    read_stdin();
    lex();
    parse_translation_unit();

    trie_init();
    for (size_t i = 0; i < ndecl; i++) {
        baseline_insert(&decls[i]);
        trie_add_symbol(&decls[i]);
    }

    /* Verify before measuring: every declaration must round-trip through both
     * structures, and neither may invent a symbol that was never inserted. */
    for (size_t i = 0; i < ndecl; i++) {
        if (!baseline_contains(&decls[i])) { baseline_free(); fail(3, "baseline lookup mismatch"); }
        if (!trie_contains(&decls[i]))     { baseline_free(); fail(3, "trie lookup mismatch"); }
    }
    if (baseline_has_name("__symtab_absent__")) { baseline_free(); fail(3, "baseline false positive"); }
    if (trie_lookup("__symtab_absent__") != NIL) { baseline_free(); fail(3, "trie false positive"); }

    Shape shape;
    shape.n_syms = ndecl;
    shape.name_bytes = 0;
    for (size_t i = 0; i < ndecl; i++) shape.name_bytes += strlen(decls[i].name) + 1;
    shape.nodes = node_count;
    shape.edge_bytes = char_used;
    shape.edge_allocs = edge_stores;
    shape.shadows = shadow_count;

    size_t baseline_total = baseline_bytes + sizeof(baseline_buckets);
    size_t compressed_total = (size_t)node_count * sizeof(TrieNode)
                            + (size_t)char_used
                            + (size_t)meta_count * sizeof(uint32_t)
                            + (size_t)shadow_count * sizeof(ShadowLink);

    /* Cross-check the accounting model against the structure actually built:
     * the all-three variant must equal what the real build measured. */
    if (trie_arena_bytes(&shape, sizeof(uint32_t)) != compressed_total) {
        baseline_free();
        fail(3, "compressed accounting disagrees with the built structure");
    }
    if (hash_malloc_bytes(&shape, sizeof(HNode), 0) != baseline_total) {
        baseline_free();
        fail(3, "baseline accounting disagrees with the built structure");
    }

    size_t ablation[6];
    ablation[0] = trie_malloc_bytes(&shape, sizeof(TrieNodePtrU), 1);   /* trie_only     */
    ablation[1] = hash_arena_bytes(&shape, sizeof(HNodeArenaU));        /* arena_only    */
    ablation[2] = hash_malloc_bytes(&shape, sizeof(HNodeP), 0);         /* bitpack_only  */
    ablation[3] = trie_arena_bytes(&shape, sizeof(MetaUnpacked));       /* trie_arena    */
    ablation[4] = trie_malloc_bytes(&shape, sizeof(TrieNodePtrP), 0);   /* trie_bitpack  */
    ablation[5] = hash_arena_bytes(&shape, sizeof(HNodeArenaP));        /* arena_bitpack */

    print_json(&shape, baseline_total, compressed_total, ablation);

    baseline_free();
    free(src);
    return 0;
}
