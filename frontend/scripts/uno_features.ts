/**
 * Writes firmware/results/uno_abc_features.csv: for every program the Uno ran
 * (firmware/results/uno_run_lists.json), the work the ABC trie does on each
 * insert and on each lookup, counted by the same replay the website uses
 * (src/lib/unoModel.ts). firmware/tools/fit_uno_model.py fits the board's
 * ABC times on these counts.
 *
 *   node frontend/scripts/uno_features.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { trieFull, trieLookupWork } from '../src/lib/unoModel.ts';
import type { UnoModelData } from '../src/lib/unoModel.ts';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

const pools = Object.fromEntries([...read('firmware/uno_bench/src/pools.h').matchAll(/#define (POOL_ABC_\w+)\s+(\d+)/g)]
  .map(([, k, v]) => [k, Number(v)]));
const model = { pools: { ABC: { nodes: pools.POOL_ABC_NODES, chars: pools.POOL_ABC_CHARS,
  meta: pools.POOL_ABC_META, shadows: pools.POOL_ABC_SHADOWS } } } as unknown as UnoModelData;

const lists: Record<string, string[]> = JSON.parse(read('firmware/results/uno_run_lists.json'));
const rows = ['kind,list,ordinal,len,scans,compares,copied,split,depth'];
for (const [id, names] of Object.entries(lists)) {
  const r = trieFull(names, model);
  r.work.forEach((w, i) => rows.push(['insert', id, i, w.len, w.scans, w.compares, w.copied, w.split, ''].join(',')));
  // the board looks up each distinct stored name, then up to ten names that are not stored
  const distinct = [...new Set(names.slice(0, r.stored))];
  distinct.forEach((n, i) => {
    const w = trieLookupWork(r.root, n);
    rows.push(['hit', id, i, w.len, w.scans, w.compares, '', '', w.depth].join(','));
  });
  distinct.slice(0, 10).map((n) => `${n}_zq`).filter((p) => !distinct.includes(p)).forEach((p, i) => {
    const w = trieLookupWork(r.root, p);
    rows.push(['miss', id, i, w.len, w.scans, w.compares, '', '', w.depth].join(','));
  });
}
writeFileSync(new URL('firmware/results/uno_abc_features.csv', root), rows.join('\n') + '\n');
console.log(`wrote ${rows.length - 1} rows to firmware/results/uno_abc_features.csv`);
