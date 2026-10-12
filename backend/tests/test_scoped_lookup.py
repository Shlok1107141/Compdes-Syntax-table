"""Scoped lookup: every identifier use resolves to the innermost declaration
of that name still in scope, through the compressed table's trie chain.

The engine already cross-checks each resolution against an independent
reference resolver (exit 3 on disagreement). These tests add a third,
fully independent check: programs whose correct answer is known by
construction.
"""

from __future__ import annotations

import random

import pytest

SHADOWING = """
#define BUF_LEN 16
int counter;
char buffer[BUF_LEN];
struct point { int x; int y; };

void bump(void) {
    counter = counter + 1;
}

int main(void) {
    int counter = 5;
    struct point p;
    p.x = counter;
    {
        int counter = 7;
        counter++;
    }
    counter--;
    bump();
    return p.y + buffer[0];
}
"""


def refs(payload: dict) -> list[tuple[str, int, int]]:
    return [(s["name"], s["scope"], s["references"]) for s in payload["symbol_table"]]


def test_uses_resolve_to_the_innermost_declaration(run_engine):
    code, payload, _ = run_engine(SHADOWING)
    assert code == 0, payload
    assert refs(payload) == [
        ("counter", 0, 2),   # both uses inside bump()
        ("buffer", 0, 1),
        ("x", 1, 0),         # p.x is member access, not a use of a variable
        ("y", 1, 0),
        ("bump", 0, 1),
        ("main", 0, 0),
        ("counter", 1, 2),   # p.x = counter; counter--;
        ("p", 1, 2),
        ("counter", 2, 1),   # counter++ in the inner block
    ]


def test_undeclared_names_resolve_to_nothing(run_engine):
    code, payload, _ = run_engine("void f(void) { printf(\"%d\", missing); }")
    assert code == 0
    assert [s["references"] for s in payload["symbol_table"]] == [0]


def test_a_declaration_is_visible_in_its_own_initializer(run_engine):
    # C: the scope of `x` starts right after its declarator, so the inner
    # initializer refers to the new x, not the outer one.
    _, payload, _ = run_engine("int x; void f(void) { int x = x; }")
    assert refs(payload) == [("x", 0, 0), ("f", 0, 0), ("x", 1, 1)]


def test_macro_sized_array_gets_its_real_size(run_engine):
    _, payload, _ = run_engine("#define N 16\nchar buf[N];\nint after;")
    offsets = {s["name"]: s["offset"] for s in payload["symbol_table"]}
    assert offsets["after"] == 16


def test_compound_array_size_is_unknown_not_misread(run_engine):
    # [N + 1] is not a single constant; it must not be read as [N].
    _, payload, _ = run_engine("#define N 16\nchar buf[N + 1];\nint after;")
    offsets = {s["name"]: s["offset"] for s in payload["symbol_table"]}
    assert offsets["after"] == 4   # unknown length: sized as one element, then aligned


def test_function_like_macros_are_ignored(run_engine):
    _, payload, _ = run_engine("#define SQ(x) 4\nchar buf[SQ];\nint after;")
    offsets = {s["name"]: s["offset"] for s in payload["symbol_table"]}
    assert offsets["after"] == 4


def test_running_out_of_the_16_bit_character_arena_is_a_clean_error(run_engine):
    # 300 distinct 250-character names need ~75 KB of characters; 16-bit
    # offsets address 64 KiB. That is a limit of the technique, reported as such.
    names = [f"n{i:03d}_" + "x" * 245 for i in range(300)]
    code, payload, stderr = run_engine("".join(f"int {n};\n" for n in names))
    assert code == 2, payload
    assert "16-bit arena" in payload["error"]
    assert stderr == ""


# ---------------------------------------------------------------------------
# Randomized: nested blocks, heavy shadowing, answer known by construction
# ---------------------------------------------------------------------------

NAMES = ["a", "b", "c", "d", "count", "tmp"]


def random_program(seed: int) -> tuple[str, list[int]]:
    """Return (source, expected reference count per declaration, in source order)."""
    rng = random.Random(seed)
    lines: list[str] = []
    expected: list[int] = []
    scopes: list[dict[str, int]] = []

    def declare(name: str) -> None:
        scopes[-1][name] = len(expected)
        expected.append(0)
        lines.append(f"int {name};")

    def use(name: str) -> None:
        for scope in reversed(scopes):
            if name in scope:
                expected[scope[name]] += 1
                break

    def block(depth: int) -> None:
        scopes.append({})
        for _ in range(rng.randint(2, 8)):
            roll = rng.random()
            fresh = [n for n in NAMES if n not in scopes[-1]]
            if roll < 0.35 and fresh:
                declare(rng.choice(fresh))
            elif roll < 0.8:
                left, right = rng.choice(NAMES), rng.choice(NAMES)
                lines.append(f"{left} = {right};")
                use(left)
                use(right)
            elif depth < 5:
                lines.append("{")
                block(depth + 1)
                lines.append("}")
        scopes.pop()

    scopes.append({})                    # file scope
    for name in rng.sample(NAMES, rng.randint(0, 3)):
        declare(name)
    scopes[-1]["f"] = len(expected)      # the function itself
    expected.append(0)
    lines.append("void f(void) {")
    block(1)
    lines.append("}")
    return "\n".join(lines), expected


@pytest.mark.parametrize("seed", range(60))
def test_random_nested_scopes_resolve_like_a_compiler(run_engine, seed):
    source, expected = random_program(seed)
    code, payload, stderr = run_engine(source)
    assert code == 0, (payload, source)
    assert stderr == ""
    assert [s["references"] for s in payload["symbol_table"]] == expected, source
