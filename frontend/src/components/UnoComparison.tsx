import { Trophy } from 'lucide-react';
import board from '../data/unoBoard.json';
import { avrBaselineBytes, predictUno } from '../lib/unoModel';
import type { Range, UnoModelData } from '../lib/unoModel';

const MODEL = board.model as unknown as UnoModelData;
const RAM = 2048;

export interface RunFacts {
  /** Structure the board ran: baseline, AB, ABC, ... */
  variant: string;
  /** Every declaration sent, in order (including any the board refused). */
  names: string[];
  stored: number;
  tableBytes: number;
  insertUs: number | null;
  lookupUs: number | null;
}

interface Side {
  label: string;
  measured: boolean;           // true: from this run on the board; false: computed / predicted
  stored: number;
  total: number;
  bytes: number;               // bytes for the symbols it holds
  bytesAll: number | null;     // bytes it would need for every symbol (normal way only)
  insert: number | Range | null;
  lookup: number | Range | null;
}

const fmtUs = (v: number | Range | null) =>
  v === null ? '—' : typeof v === 'number' ? `${v.toFixed(1)} µs` : `${v.mean.toFixed(1)} µs (${v.low.toFixed(0)}–${v.high.toFixed(0)})`;
const mean = (v: number | Range | null) => (v === null ? null : typeof v === 'number' ? v : v.mean);

function Tag({ measured }: { measured: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-black uppercase ${measured
      ? 'bg-emerald-100 text-emerald-900 border-emerald-300' : 'bg-amber-100 text-amber-900 border-amber-300'}`}
      title={measured ? 'Measured on the board in this run' : 'Computed from the board-checked model (bytes exact; times estimated)'}>
      {measured ? 'Live' : 'Model'}
    </span>
  );
}

/**
 * The run's result: the compressed table against the normal way (a textbook
 * chained hash table) holding the same declarations. The structure on the board
 * is measured; the other one is computed with frontend/src/lib/unoModel.ts, whose
 * bytes and refusals matched all 468 programs the Uno ran.
 */
export function UnoComparison({ run }: { run: RunFacts }) {
  const pred = predictUno(run.names, MODEL);
  const boardIsNormal = run.variant === 'baseline';
  const live: Side = {
    label: '', measured: true, stored: run.stored, total: run.names.length, bytes: run.tableBytes, bytesAll: null,
    insert: run.insertUs, lookup: run.lookupUs,
  };
  const normal: Side = boardIsNormal
    ? { ...live, label: 'Normal way: textbook hash table', bytesAll: avrBaselineBytes(run.names) }
    : { label: 'Normal way: textbook hash table', measured: false, stored: pred.baseline.stored, total: run.names.length,
        bytes: pred.baseline.tableBytes, bytesAll: avrBaselineBytes(run.names),
        insert: pred.baseline.insertUs, lookup: pred.baseline.lookupUs };
  const ours: Side = boardIsNormal
    ? { label: 'Ours: trie + arena + bit-packing', measured: false, stored: pred.ABC.stored, total: run.names.length,
        bytes: pred.ABC.tableBytes, bytesAll: null, insert: pred.ABC.insertUs, lookup: pred.ABC.lookupUs }
    : { ...live, label: run.variant === 'ABC' ? 'Ours: trie + arena + bit-packing' : `On the board: ${run.variant}` };

  const bothFull = normal.stored === normal.total && ours.stored === ours.total;
  const normalNeeds = normal.bytesAll ?? normal.bytes;
  const saved = normalNeeds - ours.bytes;
  const pct = (100 * saved) / normalNeeds;
  const max = Math.max(normalNeeds, ours.bytes);
  const n = run.names.length;
  const insertDiff = mean(ours.insert) !== null && mean(normal.insert) !== null ? mean(ours.insert)! - mean(normal.insert)! : null;
  const lookupDiff = mean(ours.lookup) !== null && mean(normal.lookup) !== null ? mean(ours.lookup)! - mean(normal.lookup)! : null;
  const faster = (d: number | null, what: string) =>
    d === null ? null : `${what}: ours is ${Math.abs(d).toFixed(1)} µs ${d > 0 ? 'slower' : 'faster'} per ${what === 'Insert' ? 'symbol' : 'lookup'}`;

  return (
    <div className="bg-white border-2 border-teal-400 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Trophy className="w-4 h-4 text-orange-600" /> Result: our compressed table vs the normal way
        </h3>
        <span className="text-xs font-semibold text-slate-600">same {n} declarations</span>
      </div>

      {/* headline */}
      <div className="rounded-lg bg-teal-50 border-2 border-teal-200 p-4">
        {normal.stored < normal.total && ours.stored === ours.total ? (
          <p className="text-base font-black text-teal-950">
            The normal way runs out of RAM after {normal.stored} of {n} symbols (it would need{' '}
            {normalNeeds.toLocaleString()} B). Ours holds all {n} in {ours.bytes.toLocaleString()} B:{' '}
            <span className="text-orange-600">{saved.toLocaleString()} B less ({pct.toFixed(1)}%)</span>.
          </p>
        ) : bothFull ? (
          <p className="text-base font-black text-teal-950">
            Ours stores these {n} symbols in {ours.bytes.toLocaleString()} B instead of {normalNeeds.toLocaleString()} B:{' '}
            <span className="text-orange-600">{saved.toLocaleString()} B saved ({pct.toFixed(1)}% smaller)</span>,{' '}
            {(ours.bytes / n).toFixed(1)} B per symbol instead of {(normalNeeds / n).toFixed(1)} B.
          </p>
        ) : (
          <p className="text-base font-black text-teal-950">
            Ours holds {ours.stored} of {n} symbols in {ours.bytes.toLocaleString()} B (its fixed pools filled up);
            the normal way holds {normal.stored} of {n} in {normal.bytes.toLocaleString()} B.
          </p>
        )}
      </div>

      {/* memory bars */}
      <div className="space-y-2">
        {[normal, ours].map((s) => {
          const shown = s === normal ? normalNeeds : s.bytes;
          const short = s.stored < s.total;
          return (
            <div key={s.label}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-800 mb-1">
                <span className="flex items-center gap-2">{s.label} <Tag measured={s.measured} /></span>
                <span className="font-mono">
                  {shown.toLocaleString()} B{short ? ` needed (held ${s.stored}/${s.total} before RAM ran out)` : ''}
                  {' '}· {((100 * shown) / RAM).toFixed(0)}% of the Uno's 2,048 B
                </span>
              </div>
              <div className="h-5 w-full bg-slate-100 rounded-md overflow-hidden">
                <div className={`h-full rounded-md ${s === ours ? 'bg-teal-700' : 'bg-slate-400'} ${short ? 'ring-2 ring-inset ring-rose-500' : ''}`}
                  style={{ width: `${(100 * shown) / max}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* speed */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-slate-100 text-slate-700 font-black">
            <tr><th className="p-2"> </th><th className="p-2">Normal way</th><th className="p-2">Ours</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-mono">
            <tr>
              <td className="p-2 font-sans font-bold">Memory</td>
              <td className="p-2">{normalNeeds.toLocaleString()} B <Tag measured={normal.measured} /></td>
              <td className="p-2">{ours.bytes.toLocaleString()} B <Tag measured={ours.measured} /></td>
            </tr>
            <tr>
              <td className="p-2 font-sans font-bold">Insert, per symbol</td>
              <td className="p-2">{fmtUs(normal.insert)} <Tag measured={normal.measured} /></td>
              <td className="p-2">{fmtUs(ours.insert)} <Tag measured={ours.measured} /></td>
            </tr>
            <tr>
              <td className="p-2 font-sans font-bold">Name lookup</td>
              <td className="p-2">{fmtUs(normal.lookup)} <Tag measured={normal.measured} /></td>
              <td className="p-2">{fmtUs(ours.lookup)} <Tag measured={ours.measured} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600">
        {[faster(insertDiff, 'Insert'), faster(lookupDiff, 'Lookup')].filter(Boolean).join('. ')}
        {insertDiff !== null || lookupDiff !== null ? '. ' : ''}
        The board runs one firmware at a time: the other structure's bytes and run-out point are computed exactly
        (they matched all {board.counts.runs} board runs) and its times are estimated from the board's measurements.
      </p>
    </div>
  );
}
