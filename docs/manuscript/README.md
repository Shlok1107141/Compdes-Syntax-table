# Manuscript

| File | What it is |
|---|---|
| [`DenseSym_Draft2.pdf`](DenseSym_Draft2.pdf) | Draft 2 of the paper (Review 2: web application, evaluation on real C code, choice of the best combination), compiled from the zip below |
| [`DenseSym_Draft2_LaTeX.zip`](DenseSym_Draft2_LaTeX.zip) | The LaTeX source: `main.tex` and `figures/` (charts, screenshots, logos, author photos) |

## Compile

**Overleaf:** New Project → Upload Project → choose `DenseSym_Draft2_LaTeX.zip`. The compiler is
pdfLaTeX (Overleaf's default) and the main document is `main.tex`.

**Locally** (TeX Live 2022 or newer):

```bash
mkdir manuscript && cd manuscript
unzip ../docs/manuscript/DenseSym_Draft2_LaTeX.zip
latexmk -pdf main.tex
```

The paper uses only standard packages (`article`, `mathptmx`, `helvet`, `geometry`, `titlesec`,
`caption`, `fancyhdr`, `hyperref`, `enumitem`, `fancyvrb`), with the IEEE Access page size and
styling. The Reproduce workflow (`.github/workflows/reproduce.yml`) compiles the zip with TeX Live
on every push.

## Where the numbers come from

Every figure and table is produced by a script in this repository; see
[`results/README.md`](../../results/README.md) for the mapping and
`bash scripts/reproduce_results.sh` to regenerate them.
