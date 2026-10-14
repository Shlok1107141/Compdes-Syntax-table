/**
 * @file syntax_table.h
 * @brief Comprehensive Syntax Table (LR/LALR Action & Goto Matrix) Compression Suite.
 *
 * Implements 6-pillar evaluation:
 * 1. Compressed size with total auxiliary overhead accounting.
 * 2. Lookup decode latency (Mean and p99 worst-case).
 * 3. Compression build/generation time.
 * 4. Runtime memory footprint and 64-byte cache line behavior.
 * 5. Correctness, losslessness, and error-entry verification.
 * 6. Scalability and robustness across diverse grammar sizes and sparsities.
 */

#ifndef SYNTAX_TABLE_H
#define SYNTAX_TABLE_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Action Codes (LR / LALR Parse Action Representation)
 * ------------------------------------------------------------------------- */
#define ACTION_ERR       ((int16_t)0)
#define ACTION_ACCEPT    ((int16_t)32767)

#define IS_ERR(a)        ((a) == ACTION_ERR)
#define IS_ACCEPT(a)     ((a) == ACTION_ACCEPT)
#define IS_SHIFT(a)      ((a) > 0 && (a) < 10000)
#define IS_REDUCE(a)     ((a) < 0 && (a) > -10000)
#define IS_GOTO(a)       ((a) >= 10000 && (a) < ACTION_ACCEPT)

#define MAKE_SHIFT(s)    ((int16_t)(s))
#define MAKE_REDUCE(r)   ((int16_t)(-(r)))
#define MAKE_GOTO(s)     ((int16_t)(10000 + (s)))

/* -------------------------------------------------------------------------
 * Uncompressed Baseline 2D Matrix
 * ------------------------------------------------------------------------- */
typedef struct {
    int num_states;      /* S */
    int num_tokens;      /* T */
    int non_zero_count;  /* NNZ */
    int16_t *matrix;     /* S x T contiguous flat array */
} RawSyntaxTable;

/* -------------------------------------------------------------------------
 * 1. Row Displacement / Comb-Vector Packing (Tarjan-Yao / Ziegler / Bison)
 * ------------------------------------------------------------------------- */
typedef struct {
    int num_states;
    int num_tokens;
    int comb_size;           /* N */
    int32_t *base;           /* base[S] displacement offsets */
    int16_t *check;          /* check[N] ownership verification vector */
    int16_t *action;         /* action[N] interleaved action values */
    int16_t *default_action; /* default_action[S] optional default reduction fallback */
    bool has_default_reductions;
} RowDisplacementTable;

/* -------------------------------------------------------------------------
 * 2. Compressed Sparse Row (CSR) Representation
 * ------------------------------------------------------------------------- */
typedef struct {
    int num_states;
    int num_tokens;
    int nnz;
    int32_t *row_ptr;        /* row_ptr[S + 1] */
    int16_t *col_idx;        /* col_idx[NNZ] token indices */
    int16_t *action;         /* action[NNZ] non-zero actions */
} CSRTable;

/* -------------------------------------------------------------------------
 * 3. Graph Coloring / Non-Conflicting Row Merging
 * ------------------------------------------------------------------------- */
typedef struct {
    int num_states;
    int num_tokens;
    int num_colors;          /* C << S (distinct composite rows) */
    int16_t *state_to_color; /* state_to_color[S] mapping */
    int16_t *color_matrix;   /* color_matrix[C x T] packed actions */
} GraphColoringTable;

/* -------------------------------------------------------------------------
 * 4. Distinct Row Deduplication (Identical Row Merging)
 * ------------------------------------------------------------------------- */
typedef struct {
    int num_states;
    int num_tokens;
    int num_distinct;        /* D <= S */
    int16_t *state_to_row;   /* state_to_row[S] mapping */
    int16_t *distinct_matrix;/* distinct_matrix[D x T] */
} DeduplicatedRowTable;

/* -------------------------------------------------------------------------
 * Evaluation Metrics Struct (Reporting all 6 Pillars)
 * ------------------------------------------------------------------------- */
typedef struct {
    const char *algorithm_name;
    const char *grammar_name;
    int num_states;
    int num_tokens;
    int non_zero_count;
    double sparsity_pct;

    /* Pillar 1: Compressed Size & Total Overhead */
    size_t raw_bytes;
    size_t payload_bytes;
    size_t index_bytes;
    size_t side_structure_bytes;
    size_t decoder_code_bytes;
    size_t total_compressed_bytes;
    double compression_ratio;   /* total_compressed_bytes / raw_bytes */
    double savings_pct;          /* (1 - ratio) * 100 */

    /* Pillar 2: Lookup Decode Latency (Mean & p99 worst-case) */
    double mean_lookup_ns;
    double p99_lookup_ns;
    double max_lookup_ns;

    /* Pillar 3: Compression Build Time */
    double build_time_us;

    /* Pillar 4: Runtime Memory Footprint & Cache Behavior */
    size_t peak_working_mem_bytes;
    double cache_miss_rate_pct;  /* 64-byte simulated L1 cache */
    double avg_lines_touched;

    /* Pillar 5: Correctness, Losslessness & Error Handling */
    bool correctness_verified;
    size_t verified_queries_count;
    size_t errors_correctly_detected;
    size_t default_reductions_applied;
} BenchmarkMetrics;

/* -------------------------------------------------------------------------
 * Corpus Grammar Descriptors
 * ------------------------------------------------------------------------- */
typedef struct {
    const char *name;
    const char *category;
    int states;
    int tokens;
    double target_sparsity;
} GrammarPreset;

/* Function prototypes */
RawSyntaxTable *syntax_create_grammar(const char *name, int states, int tokens, double target_sparsity, unsigned int seed);
void syntax_free_raw(RawSyntaxTable *table);

/* Compression Constructors */
RowDisplacementTable *compress_row_displacement(const RawSyntaxTable *raw, bool use_default_reductions, double *build_time_us);
void free_row_displacement(RowDisplacementTable *tbl);

CSRTable *compress_csr(const RawSyntaxTable *raw, double *build_time_us);
void free_csr(CSRTable *tbl);

GraphColoringTable *compress_graph_coloring(const RawSyntaxTable *raw, double *build_time_us);
void free_graph_coloring(GraphColoringTable *tbl);

DeduplicatedRowTable *compress_deduplication(const RawSyntaxTable *raw, double *build_time_us);
void free_deduplication(DeduplicatedRowTable *tbl);

/* Fast Lookups */
int16_t lookup_raw(const RawSyntaxTable *tbl, int s, int t);
int16_t lookup_row_displacement(const RowDisplacementTable *tbl, int s, int t);
int16_t lookup_csr(const CSRTable *tbl, int s, int t);
int16_t lookup_graph_coloring(const GraphColoringTable *tbl, int s, int t);
int16_t lookup_deduplication(const DeduplicatedRowTable *tbl, int s, int t);

/* Benchmark & Verification Suites */
BenchmarkMetrics evaluate_table_algorithm(
    const RawSyntaxTable *raw,
    const char *grammar_name,
    const char *algorithm_name
);

char *export_all_benchmarks_json(void);

#ifdef __cplusplus
}
#endif

#endif /* SYNTAX_TABLE_H */
