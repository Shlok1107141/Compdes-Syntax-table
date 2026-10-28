/**
 * What the Arduino Uno would do with a list of declarations, for code the
 * website cannot send to a board (GitHub Pages cannot reach a USB port).
 *
 * Bytes and refusals are exact: each structure's allocation rules are replayed
 * (the same up-front checks as firmware/uno_bench and engine/variant_*.c), with
 * the board's constants from unoBoard.json. frontend/scripts/check_uno_model.ts
 * compares them with every program the board ran.
 *
 * Times are estimates: a linear model fitted to the board's measurements
 * (firmware/tools/fit_uno_model.py), given as a range of about +/- 2 standard
 * deviations of the error seen between programs.
 */

export type UnoVariant = 'baseline' | 'AB' | 'ABC';
export const UNO_VARIANTS: UnoVariant[] = ['baseline', 'AB', 'ABC'];

export interface TimeFit {
  coef: number[];
  /** The feature each coefficient multiplies ('1' is the intercept). */
  x: string[];
  /** Larger of the spread between programs and the leave-one-pattern-out error. */
  sd_band: number;
}

export interface UnoModelData {
  baseline_free_plus_heap: number;
  ram_reserve: number;
  pools: {
    AB: { nodes: number; chars: number };
    ABC: { nodes: number; chars: number; meta: number; shadows: number };
    budget: number;
  };
  variants: Record<UnoVariant, { insert: TimeFit; lookup_hit: TimeFit; lookup_miss: TimeFit }>;
}

export interface Range {
  mean: number;
  low: number;
  high: number;
}

export interface UnoPrediction {
  variant: UnoVariant;
  total: number;
  stored: number;
  refused: number;
  stopped: 'none' | 'arena_full' | 'out_of_ram';
  /** Bytes of the table holding the stored symbols (engine accounting). */
  tableBytes: number;
  insertUs: Range | null;
  lookupUs: Range | null;
}

/** Bytes the textbook table needs on the Uno for these declarations (it matched
 * every baseline the board measured; backend/hardware_uno.py has the same formula). */
export function avrBaselineBytes(names: string[]): number {
  return 128 + names.reduce((s, n) => s + 12 + 2 + n.length + 1 + 2, 0);
}

/* ---- the textbook table on avr-libc: 64 two-byte buckets, then per declaration a
 * 12 B node and a name copy, each malloc block with a 2 B header. It stops when
 * the free RAM between heap and stack would drop below the reserve. ---- */
function baseline(names: string[], m: UnoModelData) {
  let heap = 0;
  let stored = 0;
  for (const name of names) {
    if (m.baseline_free_plus_heap - heap < m.ram_reserve + 2 * name.length) {
      return { stored, stopped: 'out_of_ram' as const, bytes: 128 + heap, lengths: names.slice(0, stored) };
    }
    heap += 12 + 2 + name.length + 1 + 2;
    stored++;
  }
  return { stored, stopped: 'none' as const, bytes: 128 + heap, lengths: names };
}

/* ---- AB: one 8 B node per declaration, the full name in a char pool, 64 uint16 buckets ---- */
function arenaBitpack(names: string[], m: UnoModelData) {
  let chars = 0;
  let stored = 0;
  for (const name of names) {
    if (stored >= m.pools.AB.nodes || chars + name.length + 1 > m.pools.AB.chars) {
      return { stored, stopped: 'arena_full' as const, bytes: 128 + 8 * stored + chars, lengths: names.slice(0, stored) };
    }
    chars += name.length + 1;
    stored++;
  }
  return { stored, stopped: 'none' as const, bytes: 128 + 8 * stored + chars, lengths: names };
}

/* ---- ABC: Patricia trie of 10 B nodes, edges are views into one char pool,
 * 4 B packed metadata per declaration, 4 B shadow record per redeclaration ---- */
export interface TrieNode {
  edge: string;
  children: TrieNode[];
  terminal: boolean;
}

/** Work the board's trie does, counted the way engine/variant_abc_full.c loops:
 * scans = sibling nodes examined, compares = edge characters matched,
 * copied = characters written to the pool, split = an edge was split. */
export interface InsertWork { len: number; scans: number; compares: number; copied: number; split: number }
export interface LookupWork { len: number; scans: number; compares: number; depth: number }

/** Index of the child whose edge starts with c, counting every sibling examined. */
function findChild(n: TrieNode, c: string, w: { scans: number }): number {
  for (let i = 0; i < n.children.length; i++) {
    w.scans++;
    if (n.children[i].edge[0] === c) return i;
  }
  w.scans++;                                  // the final test that hits NIL
  return -1;
}

export function trieFull(names: string[], m: UnoModelData) {
  const p = m.pools.ABC;
  const root: TrieNode = { edge: '', children: [], terminal: false };
  let nodes = 1;
  let chars = 0;
  let meta = 0;
  let shadows = 0;
  let stored = 0;
  const work: InsertWork[] = [];
  const declare = (n: TrieNode) => {
    if (n.terminal) shadows++;
    meta++;
    n.terminal = true;
  };
  for (const key of names) {
    if (nodes + 2 > p.nodes || chars + key.length > p.chars || meta >= p.meta || shadows >= p.shadows) {
      return { stored, stopped: 'arena_full' as const, bytes: 10 * nodes + chars + 4 * meta + 4 * shadows,
        lengths: names.slice(0, stored), work, root };
    }
    const w: InsertWork = { len: key.length, scans: 0, compares: 0, copied: 0, split: 0 };
    let cur = root;
    let pos = 0;
    for (;;) {
      const at = findChild(cur, key[pos], w);
      const child = at >= 0 ? cur.children[at] : undefined;
      if (!child) {
        cur.children.push({ edge: key.slice(pos), children: [], terminal: false });
        nodes++;
        chars += key.length - pos;
        w.copied += key.length - pos;
        declare(cur.children[cur.children.length - 1]);
        break;
      }
      let cp = 0;
      while (cp < child.edge.length && pos + cp < key.length && child.edge[cp] === key[pos + cp]) cp++;
      w.compares += cp;
      if (cp === child.edge.length) {
        pos += cp;
        cur = child;
        if (pos === key.length) { declare(cur); break; }
        continue;
      }
      // split the edge: the shared part becomes a new node above the child (no bytes copied)
      const mid: TrieNode = { edge: child.edge.slice(0, cp), children: [child], terminal: false };
      child.edge = child.edge.slice(cp);
      cur.children[at] = mid;
      nodes++;
      w.split = 1;
      const rest = key.length - (pos + cp);
      if (rest === 0) {
        declare(mid);
      } else {
        const leaf: TrieNode = { edge: key.slice(pos + cp), children: [], terminal: false };
        mid.children.push(leaf);
        nodes++;
        chars += rest;
        w.copied += rest;
        declare(leaf);
      }
      break;
    }
    work.push(w);
    stored++;
  }
  return { stored, stopped: 'none' as const, bytes: 10 * nodes + chars + 4 * meta + 4 * shadows, lengths: names,
    work, root };
}

/** The work of looking `key` up in a finished trie (abc_find). */
export function trieLookupWork(root: TrieNode, key: string): LookupWork {
  const w: LookupWork = { len: key.length, scans: 0, compares: 0, depth: 0 };
  let cur = root;
  let pos = 0;
  while (pos < key.length) {
    const at = findChild(cur, key[pos], w);
    if (at < 0) return w;
    const child = cur.children[at];
    if (child.edge.length > key.length - pos) return w;
    w.compares += child.edge.length;          // memcmp of the whole edge
    if (key.slice(pos, pos + child.edge.length) !== child.edge) return w;
    pos += child.edge.length;
    w.depth++;
    cur = child;
  }
  return w;
}

type Features = Record<string, number>;

/** Mean of the fitted model over feature rows, with a range of +/- 2 sd between programs. */
function estimate(fit: TimeFit, rows: Features[]): Range | null {
  if (!rows.length) return null;
  const mean = rows.reduce((s, f) => s + fit.coef.reduce((t, c, i) => t + c * (f[fit.x[i]] ?? 0), 0), 0) / rows.length;
  const half = 2 * fit.sd_band;
  return { mean, low: Math.max(0, mean - half), high: mean + half };
}

/** Feature rows for each stored insert and each lookup of a distinct stored name, as the board ran them. */
export function timingFeatures(v: UnoVariant, names: string[], m: UnoModelData) {
  if (v === 'ABC') {
    const r = trieFull(names, m);
    const held = names.slice(0, r.stored);
    const inserts = r.work.map((w, i) => ({ '1': 1, name_len: w.len, stored_before: i, scans: w.scans,
      compares: w.compares, copied: w.copied, split: w.split }));
    const lookups = [...new Set(held)].map((n) => {
      const w = trieLookupWork(r.root, n);
      return { '1': 1, name_len: w.len, table_n: r.stored, scans: w.scans, compares: w.compares, depth: w.depth };
    });
    return { result: r, inserts, lookups };
  }
  const r = v === 'baseline' ? baseline(names, m) : arenaBitpack(names, m);
  const held = names.slice(0, r.stored);
  const inserts = held.map((n, i) => ({ '1': 1, name_len: n.length, stored_before: i }));
  const lookups = [...new Set(held)].map((n) => ({ '1': 1, name_len: n.length, table_n: r.stored }));
  return { result: r, inserts, lookups };
}

export function predictUno(names: string[], m: UnoModelData): Record<UnoVariant, UnoPrediction> {
  const out = {} as Record<UnoVariant, UnoPrediction>;
  for (const v of UNO_VARIANTS) {
    const { result: r, inserts, lookups } = timingFeatures(v, names, m);
    out[v] = { variant: v, total: names.length, stored: r.stored, refused: names.length - r.stored,
      stopped: r.stopped, tableBytes: r.bytes,
      insertUs: estimate(m.variants[v].insert, inserts), lookupUs: estimate(m.variants[v].lookup_hit, lookups) };
  }
  return out;
}
