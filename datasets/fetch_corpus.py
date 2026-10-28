#!/usr/bin/env python3
"""Download the real-C corpus behind engine/real_corpus.csv and check every file.

The corpus is 93 C files from five projects. The third-party sources are not stored
in this repository (their licences vary), so this script fetches the exact upstream
releases, extracts the files listed in corpus_manifest.csv, and verifies each one
against its recorded size and SHA-256. Standard library only; works on Linux,
macOS and Windows.

    python3 datasets/fetch_corpus.py            # -> datasets/corpus/<project>/*.c

Then measure (raw mode reproduces the published numbers exactly):

    python3 engine/real_corpus.py --out /tmp/corpus.csv \
        sqlite-ext=datasets/corpus/sqlite-ext readline=datasets/corpus/readline \
        xz=datasets/corpus/xz mpfr=datasets/corpus/mpfr symtab-engine=datasets/corpus/symtab-engine
"""
from __future__ import annotations

import csv
import hashlib
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "corpus_manifest.csv"
DEST = HERE / "corpus"
CACHE = HERE / "downloads"
REPO_RAW = "https://raw.githubusercontent.com/Shlok1107141/Compdes-Syntax-table"

# project -> (download URL, archive file name, directory of the .c files inside the archive)
SOURCES = {
    "sqlite-ext": ("https://www.sqlite.org/2024/sqlite-src-3460100.zip", "sqlite-src-3460100.zip",
                   "sqlite-src-3460100/ext/misc"),
    "readline": ("https://ftp.gnu.org/gnu/readline/readline-8.2.tar.gz", "readline-8.2.tar.gz",
                 "readline-8.2/examples"),
    "xz": ("https://github.com/tukaani-project/xz/releases/download/v5.6.3/xz-5.6.3.tar.gz", "xz-5.6.3.tar.gz",
           "xz-5.6.3/doc/examples"),
    "mpfr": ("https://www.mpfr.org/mpfr-4.2.1/mpfr-4.2.1.tar.xz", "mpfr-4.2.1.tar.xz", "mpfr-4.2.1/examples"),
}
# The engine's own sources as they were when the corpus was measured: commit 66b7246, except
# symtab_stress.c, which that commit edited after the run (its parent b379e58 has the measured copy).
# The run was on Windows, so the files are measured with CRLF line endings.
ENGINE_COMMIT = "66b7246e0b878c7456dfe3e261a35bc4effb2485"
ENGINE_OVERRIDES = {"symtab_stress.c": "b379e5867e8545d4ab8db844601aa13f57a50c4c"}
# The corpus was taken from MSYS2's packaged copies. MSYS2 adds one include to one SQLite extension;
# the same one-line patch is applied here so the bytes match what was measured.
PATCHES = {("sqlite-ext", "pcachetrace.c"): (b'#include <stdio.h>\n', b'#include <stdio.h>\n#include "sqlite3.h"\n')}


def download(url: str, name: str) -> Path:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists() or path.stat().st_size == 0:
        print(f"  downloading {url}")
        with urllib.request.urlopen(url, timeout=120) as resp:
            path.write_bytes(resp.read())
    return path


def read_from_archive(archive: Path, member: str) -> bytes:
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as z:
            return z.read(member)
    with tarfile.open(archive) as t:
        f = t.extractfile(member)
        if f is None:
            raise KeyError(member)
        return f.read()


def engine_file(name: str) -> bytes:
    commit = ENGINE_OVERRIDES.get(name, ENGINE_COMMIT)
    with urllib.request.urlopen(f"{REPO_RAW}/{commit}/engine/{name}", timeout=60) as resp:
        data = resp.read()
    return data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")


def main() -> int:
    with MANIFEST.open(newline="") as fh:
        manifest = list(csv.DictReader(fh))
    failures = 0
    for project in [*SOURCES, "symtab-engine"]:
        entries = [m for m in manifest if m["project"] == project]
        print(f"{project}: {len(entries)} files")
        out = DEST / project
        out.mkdir(parents=True, exist_ok=True)
        archive = download(*SOURCES[project][:2]) if project in SOURCES else None
        for m in entries:
            if archive:
                data = read_from_archive(archive, f"{SOURCES[project][2]}/{m['file']}")
            else:
                data = engine_file(m["file"])
            if (project, m["file"]) in PATCHES:
                old, new = PATCHES[(project, m["file"])]
                data = data.replace(old, new, 1)
            ok =len(data) == int(m["bytes"]) and hashlib.sha256(data).hexdigest() == m["sha256"]
            if not ok:
                failures += 1
                print(f"  MISMATCH {project}/{m['file']}")
            (out / m["file"]).write_bytes(data)
    total = len(manifest)
    print(f"{total - failures}/{total} files match corpus_manifest.csv -> {DEST}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
