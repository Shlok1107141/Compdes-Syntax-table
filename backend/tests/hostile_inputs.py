"""Hostile-input corpus for the analyzer.

The analyzer parses untrusted text, so it must always answer with JSON and a
known exit code -- never crash, hang, or trip a sanitizer. This module is
stdlib-only so it runs two ways:

    pytest (via test_hostile_inputs.py), against the sanitized session build
    python3 hostile_inputs.py <analyzer-binary>   e.g. inside WSL under ASan
"""

from __future__ import annotations

import json
import random
import subprocess
import sys

REQUIRED_KEYS = {"baseline_bytes", "compressed_bytes", "savings_pct", "symbol_table", "ablation"}
ALLOWED_EXIT_CODES = (0, 2)   # 3 means internal verification failed: always a bug


def _random_cases() -> dict[str, bytes]:
    cases = {}
    for seed in range(40):
        rng = random.Random(seed)
        cases[f"random_bytes_{seed}"] = bytes(rng.randrange(256) for _ in range(2000))
        cases[f"random_c_soup_{seed}"] = "".join(
            rng.choice("intcharstructvoid*[]{}();,=  \n\t/*\"'\\#") for _ in range(2000)
        ).encode()
    return cases


CASES: dict[str, bytes] = {
    "empty": b"",
    "nul_bytes": b"int \x00 x;\n",
    "only_open_braces": b"{" * 5000,
    "only_close_braces": b"}" * 5000,
    "unterminated_comment": b"int a; /* never closed\nint b;",
    "unterminated_string": b'char *s = "abc\nint b;',
    "unterminated_char": b"char c = 'a\nint b;",
    "ident_255": b"int " + b"a" * 255 + b";",
    "ident_256": b"int " + b"a" * 256 + b";",
    "deep_block_nesting": b"void f(void){" + b"{int x;" * 400 + b"}" * 400 + b"}",
    "deep_paren_nesting": b"int x = " + b"(" * 5000 + b"1" + b")" * 5000 + b";",
    "symbol_limit_exceeded": b";".join(b"int v%d" % i for i in range(9000)) + b";",
    "huge_array": b"int big[999999999];",
    "same_name_3000_times": b"void f(void){" + b"int x;" * 3000 + b"}",
    "stray_punctuation": b"@@@$$$``~~~\\\\\\;;;int x;",
    "keyword_soup": b"static const volatile unsigned long long int x;",
    "for_declaration": b"void f(void){for(int i=0;i<10;i++){int j;}}",
    "struct_without_body": b"struct undefined_tag *p;",
    "typedef_chain": b"typedef int myint; typedef myint yourint; yourint z;",
    "function_pointers": b"int (*fp)(int, char*); void (*table[4])(void);",
    "bitfields": b"struct f { unsigned a : 3; unsigned b : 5; };",
    "kr_style_function": b"int f(a, b) int a; int b; { return a; }",
    "utf8_in_comment": "int x; /* éè你好 */ int y;".encode("utf-8"),
    "over_one_mib": b"int x;\n" * 200000,
    "preprocessor_continuation": b"#define X(a) a\\\n  int not_a_symbol;\n#include <x.h>\nint real;",
    "nested_anonymous_structs": b"struct { struct { struct { int x; } a; } b; } c;",
    "unclosed_function_pointer": b"int (*" * 200,
    "nested_array_brackets": b"int " + b"a[" * 100 + b"1" + b"]" * 100 + b";",
    **_random_cases(),
}


def check(binary: str, name: str, data: bytes, timeout: float = 20.0) -> str | None:
    """Run one case. Returns None on success, else a description of the failure."""
    try:
        proc = subprocess.run([binary], input=data, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "timed out"

    if proc.returncode not in ALLOWED_EXIT_CODES:
        return f"exit code {proc.returncode}; stderr: {proc.stderr[:300]!r}"
    if proc.stderr.strip():
        return f"wrote to stderr: {proc.stderr[:300]!r}"
    try:
        payload = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return f"output is not JSON ({exc})"

    if proc.returncode == 0:
        missing = REQUIRED_KEYS - payload.keys()
        if missing:
            return f"missing keys {sorted(missing)}"
    elif "error" not in payload:
        return "rejected input without an error message"
    return None


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <analyzer-binary>", file=sys.stderr)
        return 2
    failures = 0
    for name, data in CASES.items():
        problem = check(argv[1], name, data)
        if problem:
            failures += 1
            print(f"FAIL {name}: {problem}")
    print(f"{len(CASES)} hostile inputs, {failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
