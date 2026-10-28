/**
 * Checks frontend/src/lib/unoModel.ts against the Arduino Uno's measurements:
 * for every program the board ran (firmware/results/uno_runs.csv) the predicted
 * symbols stored, reason for stopping and table bytes must equal the board's.
 * Also reports how often the measured preset times fall inside the predicted ranges.
 *
 *   node frontend/scripts/check_uno_model.ts
 */
import { readFileSync } from 'node:fs';
import { predictUno } from '../src/lib/unoModel.ts';
import type { UnoModelData, UnoVariant } from '../src/lib/unoModel.ts';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

const board = JSON.parse(read('frontend/src/data/unoBoard.json'));
const model: UnoModelData = board.model;
const lists: Record<string, string[]> = JSON.parse(read('firmware/results/uno_run_lists.json'));
const [header, ...lines] = read('firmware/results/uno_runs.csv').trim().split('\n');
const cols = header.split(',');
const runs = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));

let exact = 0;
const wrong: string[] = [];
let inRange = 0;
let ranged = 0;
for (const r of runs) {
  const names = lists[r.list];
  if (!names) { wrong.push(`${r.list}: names missing`); continue; }
  const p = predictUno(names, model)[r.variant as UnoVariant];
  const same = p.stored === Number(r.stored) && p.stopped === r.stopped && p.tableBytes === Number(r.table_bytes);
  if (same) exact++;
  else wrong.push(`${r.variant} ${r.list}: predicted ${p.stored} stored, ${p.stopped}, ${p.tableBytes} B; ` +
    `board ${r.stored} stored, ${r.stopped}, ${r.table_bytes} B`);
  if (r.kind === 'preset' && p.insertUs && p.lookupUs && r.insert_us_mean && r.lookup_hit_us_mean) {
    for (const [range, measured] of [[p.insertUs, Number(r.insert_us_mean)], [p.lookupUs, Number(r.lookup_hit_us_mean)]] as const) {
      ranged++;
      if (measured >= range.low && measured <= range.high) inRange++;
    }
  }
}
console.log(`bytes, symbols stored and stopping reason: ${exact} of ${runs.length} programs exact`);
console.log(`preset times inside the predicted range: ${inRange} of ${ranged}`);
for (const w of wrong.slice(0, 20)) console.log('  MISMATCH ' + w);
process.exit(wrong.length ? 1 : 0);
