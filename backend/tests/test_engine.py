"""Engine-level tests: parsing, scope tracking, and memory accounting.

Every test here runs the sanitizer-instrumented binary, so a memory error in
the C code fails the suite rather than silently producing numbers.
"""

from __future__ import annotations

import pytest

from conftest import SAMPLE_SOURCE


def symbols_by_name(payload: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for sym in payload["symbol_table"]:
        out.setdefault(sym["name"], []).append(sym)
    return out


def test_sample_program_parses_cleanly(run_engine):
    code, payload, stderr = run_engine(SAMPLE_SOURCE)
    assert code == 0, payload
    assert stderr == ""
    assert payload["symbol_table"], "no symbols extracted"


def test_declarations_get_type_scope_and_storage(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    syms = symbols_by_name(payload)

    assert syms["counter_max"][0] == {
        "name": "counter_max", "type": "int", "scope": 0,
        "storage_class": "global", "offset": syms["counter_max"][0]["offset"],
    }
    assert syms["counter"][0]["storage_class"] == "static"
    assert syms["temp_buffer"][0]["type"] == "array"
    assert syms["out_buf"][0]["type"] == "pointer"
    assert syms["out_buf"][0]["storage_class"] == "param"
    assert syms["call_count"][0]["storage_class"] == "static"
    assert syms["sensor_name"][0]["storage_class"] == "member"
    assert syms["main"][0]["type"] == "function"


def test_scope_depth_tracks_nesting(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    syms = symbols_by_name(payload)

    assert syms["counter_max"][0]["scope"] == 0        # file scope
    assert syms["value"][0]["scope"] == 1              # function body
    assert syms["clamped"][0]["scope"] == 2            # nested block
    assert syms["i"][0]["scope"] == 2                  # for-statement scope


def test_shadowed_name_is_two_symbols(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    counters = symbols_by_name(payload)["counter"]
    assert len(counters) == 2
    assert {c["scope"] for c in counters} == {0, 1}


def test_prototype_and_definition_are_one_symbol(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    assert len(symbols_by_name(payload)["sensor_read"]) == 1


def test_struct_members_get_increasing_offsets(run_engine):
    _, payload, _ = run_engine(
        "struct s { char a; int b; char c[10]; int d; };"
    )
    offsets = [s["offset"] for s in payload["symbol_table"]]
    assert offsets == sorted(offsets)
    assert len(set(offsets)) == len(offsets)


def test_union_members_share_offset_zero(run_engine):
    _, payload, _ = run_engine("union u { int raw; char bytes[4]; };")
    assert [s["offset"] for s in payload["symbol_table"]] == [0, 0]


def test_locals_get_distinct_frame_offsets(run_engine):
    _, payload, _ = run_engine("void f(void) { char a; int b; double c; }")
    offsets = [s["offset"] for s in payload["symbol_table"] if s["storage_class"] == "local"]
    assert len(set(offsets)) == 3


def test_typedef_names_are_usable_types(run_engine):
    _, payload, _ = run_engine("typedef int myint; myint counter; myint *ptr;")
    syms = symbols_by_name(payload)
    assert syms["myint"][0]["storage_class"] == "typedef"
    assert syms["counter"][0]["type"] == "int"
    assert syms["ptr"][0]["type"] == "pointer"


def test_comments_strings_and_directives_are_not_symbols(run_engine):
    source = """
    #define NOT_A_SYMBOL 1
    #include <stdio.h>
    /* int commented_out; */
    // int line_commented;
    const char *msg = "int string_symbol; }";
    char quote = '"';
    int real_symbol;
    """
    _, payload, _ = run_engine(source)
    names = set(symbols_by_name(payload))
    assert "real_symbol" in names
    assert names.isdisjoint(
        {"NOT_A_SYMBOL", "commented_out", "line_commented", "string_symbol"}
    )


def test_expressions_are_not_mistaken_for_declarations(run_engine):
    source = """
    int a;
    int b;
    void f(void) {
        a = b * 2;
        b = a;
        f();
    }
    """
    _, payload, _ = run_engine(source)
    assert sorted(symbols_by_name(payload)) == ["a", "b", "f"]


def test_empty_input_is_valid_and_empty(run_engine):
    code, payload, _ = run_engine("")
    assert code == 0
    assert payload["symbol_table"] == []
    assert payload["baseline_bytes"] > 0
    assert payload["compressed_bytes"] > 0


def test_compressed_beats_baseline_on_prefixed_names(run_engine):
    source = "".join(
        f"int sensor_channel_{field};\n"
        for field in ("id", "value", "flag", "state", "count", "max", "min", "size")
    )
    _, payload, _ = run_engine(source)
    assert payload["compressed_bytes"] < payload["baseline_bytes"]
    assert payload["savings_pct"] > 50


def test_ablation_reports_all_six_variants(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    ablation = payload["ablation"]
    assert set(ablation) == {
        "trie_only", "arena_only", "bitpack_only",
        "trie_arena", "trie_bitpack", "arena_bitpack",
    }
    assert all(isinstance(v, int) and v > 0 for v in ablation.values())
    # The trie alone (pointer nodes, one malloc each) costs more than the
    # combination -- it only pays off once the arena removes the pointers.
    assert payload["compressed_bytes"] < ablation["trie_only"]


def test_all_three_techniques_win_on_prefix_sharing_names(run_engine):
    """The paper's claim, on the input shape it is claimed for."""
    source = "".join(
        f"int sensor_channel_{field};\n"
        for field in "id value flag state count max min size ptr addr len init".split()
    )
    _, payload, _ = run_engine(source)

    competitors = {**payload["ablation"], "baseline": payload["baseline_bytes"]}
    assert payload["compressed_bytes"] < min(competitors.values()), competitors


def test_savings_percentage_matches_the_byte_counts(run_engine):
    _, payload, _ = run_engine(SAMPLE_SOURCE)
    expected = 100.0 * (1 - payload["compressed_bytes"] / payload["baseline_bytes"])
    assert payload["savings_pct"] == pytest.approx(expected, abs=0.01)


def test_oversized_identifier_is_rejected(run_engine):
    code, payload, _ = run_engine("int " + "a" * 256 + ";")
    assert code == 2
    assert "identifier" in payload["error"]


def test_source_over_one_mib_is_rejected(run_engine):
    code, payload, _ = run_engine("int x;\n" * 200_000)
    assert code == 2
    assert "1 MiB" in payload["error"]


@pytest.mark.parametrize(
    "source",
    [
        "{" * 2000,
        "}" * 2000,
        "int a; /* unterminated",
        'char *s = "unterminated',
        "int (*" * 200,
        "struct { struct { struct { int x; }; }; };",
        "\x00\x01\x02 int x;",
        "int " + "a[" * 100 + "1" + "]" * 100 + ";",
    ],
)
def test_malformed_input_never_crashes(run_engine, source):
    code, payload, stderr = run_engine(source)
    assert code in (0, 2), f"unexpected exit {code}: {stderr}"
    assert payload, "no JSON returned"
    assert stderr == "", stderr
