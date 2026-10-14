"""Unit tests verifying all 6 evaluation pillars for syntax table compression:
1. Compressed size including overhead.
2. Lookup decode latency (Mean & p99 worst-case).
3. Compression build time.
4. Runtime memory footprint and 64-byte cache behavior.
5. Correctness, losslessness, and error entry handling.
6. Scalability and robustness across diverse grammar inputs.
"""

import asyncio
from syntax_engine import run_syntax_benchmarks


def test_syntax_table_benchmark_suite():
    data = asyncio.run(run_syntax_benchmarks())
    assert "benchmarks" in data
    benchmarks = data["benchmarks"]
    assert len(benchmarks) > 0

    # Group by grammar
    grammars = {b["grammar"] for b in benchmarks}
    assert "Toy Arithmetic Expression" in grammars
    assert "JSON Object Notation" in grammars
    assert "ANSI C11 Grammar" in grammars
    assert "ANSI SQL-92 Grammar" in grammars
    assert "Synthetic Dense Stress Table" in grammars
    assert "Synthetic Ultra-Sparse Table" in grammars

    for b in benchmarks:
        # Pillar 1: Compressed Size, Including Overhead
        assert b["raw_bytes"] > 0
        assert b["total_compressed_bytes"] > 0
        assert "payload_bytes" in b
        assert "index_bytes" in b
        assert "side_structure_bytes" in b
        assert "decoder_code_bytes" in b
        assert b["compression_ratio"] > 0

        # Pillar 2: Lookup Decode Latency (Mean & p99 worst case)
        assert b["mean_lookup_ns"] >= 0
        assert b["p99_lookup_ns"] >= 0
        assert b["max_lookup_ns"] >= b["p99_lookup_ns"]

        # Pillar 3: Compression Build Time
        assert b["build_time_us"] >= 0

        # Pillar 4: Runtime Memory Footprint & Cache Behavior
        assert b["peak_working_mem_bytes"] > 0
        assert 0.0 <= b["cache_miss_rate_pct"] <= 100.0
        assert b["avg_lines_touched"] >= 0

        # Pillar 5: Correctness and Losslessness
        assert b["correctness_verified"] is True
        assert b["verified_queries_count"] == b["states"] * b["tokens"]
        assert b["errors_correctly_detected"] >= 0

        # Pillar 6: Scalability & Sparsity
        assert 0.0 <= b["sparsity_pct"] <= 100.0


def test_row_displacement_vs_raw():
    data = asyncio.run(run_syntax_benchmarks())
    benchmarks = data["benchmarks"]

    # For sparse grammars (like C or SQL), row displacement should achieve substantial savings
    sql_benches = {b["algorithm"]: b for b in benchmarks if b["grammar"] == "ANSI SQL-92 Grammar"}
    assert "raw_2d" in sql_benches
    assert "row_displacement" in sql_benches

    raw = sql_benches["raw_2d"]
    disp = sql_benches["row_displacement"]

    # Row displacement compresses high-sparsity tables effectively
    assert disp["total_compressed_bytes"] < raw["raw_bytes"]
    assert disp["savings_pct"] > 50.0  # At 95%+ sparsity, savings exceed 50%
    assert disp["correctness_verified"] is True


def test_syntax_table_api_endpoint(client):
    response = client.get("/syntax-table/benchmark")
    assert response.status_code == 200
    data = response.json()
    assert "benchmarks" in data
    assert len(data["benchmarks"]) > 0

