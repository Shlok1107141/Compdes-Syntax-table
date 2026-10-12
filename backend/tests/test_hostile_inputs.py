"""Every hostile input must produce JSON and a known exit code, never a crash.

Runs against the session's sanitizer build, so on Linux CI a memory error or
leak on any of these inputs fails the suite.
"""

from __future__ import annotations

import pytest

from hostile_inputs import CASES, check


@pytest.mark.parametrize("name", list(CASES))
def test_hostile_input_is_handled(engine_binary, name):
    problem = check(str(engine_binary), name, CASES[name])
    assert problem is None, problem
