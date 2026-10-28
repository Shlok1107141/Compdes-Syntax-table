import { useMemo } from 'react';
import { BarChart3, Cpu, FlaskConical } from 'lucide-react';
import board from '../data/unoBoard.json';
import { SAMPLE_PRESETS } from '../data/sampleCodes';
import { declaredNames } from '../services/api';
import { predictUno, UNO_VARIANTS } from '../lib/unoModel';
import type { UnoModelData, UnoPrediction, UnoVariant } from '../lib/unoModel';

/* Board measurements written by firmware/tools/fit_uno_model.py. */
interface RunSummary {
  n: number;
  stored: number;
  refused: number;
  stopped: string;
  table_bytes: number;
  insert_us_mean: number | null;
  lookup_hit_us_mean: number | null;
}
type PresetRow = { id: string; name: string } & Partial<Record<UnoVariant, RunSummary>>;
interface SimRow {
  variant: UnoVariant;
  pattern: string;
  n: number;
  programs: number;
  held_all: number;
  table_bytes_mean: number | null;
  insert_us_mean: number | null;
  lookup_hit_us_mean: number | null;
}

const PRESETS = board.presets as PresetRow[];
const SIMS = board.sims as SimRow[];
const MODEL = board.model as unknown as UnoModelData & {
  validation: { variant: string; insert_measured: number; insert_predicted: number; insert_half_range: number;
    lookup_measured: number; lookup_predicted: number; lookup_half_range: number }[];
};

const LABEL: Record<UnoVariant, string> = {
  baseline: 'Textbook hash table',
  AB: 'Arena + bit-packing (AB)',
  ABC: 'Compressed: trie + arena + bit-packing (ABC)',
};
const COLOR: Record<UnoVariant, string> = { baseline: 'bg-slate-400', AB: 'bg-teal-400', ABC: 'bg-teal-800' };
const STROKE: Record<UnoVariant, string> = { baseline: '#94a3b8', AB: '#2dd4bf', ABC: '#115e59' };

const pct = (part: number, whole: number) => `${(100 * (1 - part / whole)).toFixed(1)}%`;

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-700">
      {UNO_VARIANTS.map((v) => (
        <span key={v} className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm ${COLOR[v]}`} />{LABEL[v]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm border-2 border-rose-500 bg-rose-100" />ran out before the end
      </span>
    </div>
  );
}

/** Grouped horizontal bars: one group per preset, one bar per structure. */
function PresetBars({ title, unit, pick, note }: {
  title: string;
  unit: string;
  pick: (r: RunSummary) => number | null;
  note: string;
}) {
  const max = Math.max(...PRESETS.flatMap((p) => UNO_VARIANTS.map((v) => (p[v] ? pick(p[v]!) ?? 0 : 0))));
  return (
    <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
      <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">{title}</h4>
      <p className="text-xs text-slate-600 mb-3">{note}</p>
      <div className="space-y-3">
        {PRESETS.map((p) => (
          <div key={p.id}>
            <div className="text-xs font-bold text-slate-800 mb-1">{p.name}</div>
            {UNO_VARIANTS.map((v) => {
              const r = p[v];
              const val = r ? pick(r) : null;
              const short = r && r.refused > 0;
              return (
                <div key={v} className="flex items-center gap-2 h-4 mb-0.5">
                  <div className="flex-1 bg-slate-50 rounded-sm h-full overflow-hidden">
                    {val !== null && (
                      <div className={`h-full rounded-sm ${COLOR[v]} ${short ? 'ring-2 ring-inset ring-rose-500 opacity-80' : ''}`}
                        style={{ width: `${(100 * val) / max}%` }} />
                    )}
                  </div>
                  <span className={`w-36 shrink-0 text-[11px] font-mono font-bold ${short ? 'text-rose-700' : 'text-slate-700'}`}>
                    {val === null ? '—' : `${val.toLocaleString()} ${unit}`}
                    {short && ` (${r!.stored}/${r!.n})`}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Table bytes against symbol count for one naming pattern, from the simulations. */
function ScalingChart() {
  const rows = SIMS.filter((s) => s.pattern === 'realistic');
  const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const maxB = Math.max(...rows.map((r) => r.table_bytes_mean ?? 0));
  const W = 420, H = 190, L = 44, B = 26, T = 10, R = 10;
  const x = (n: number) => L + ((n - ns[0]) / (ns[ns.length - 1] - ns[0])) * (W - L - R);
  const y = (b: number) => H - B - (b / maxB) * (H - B - T);
  return (
    <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
      <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">Size as programs grow (simulations)</h4>
      <p className="text-xs text-slate-600 mb-2">
        Mean table bytes over {rows.find((r) => r.variant === 'ABC')?.programs ?? 0} generated programs per size
        (subsystem_field names). Each point counts only programs that fully fit; × marks a size where some programs ran out.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Table bytes against number of symbols">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(f * maxB)} y2={y(f * maxB)} stroke="#e2e8f0" />
            <text x={L - 4} y={y(f * maxB) + 3} fontSize="9" textAnchor="end" fill="#64748b">{Math.round(f * maxB)}</text>
          </g>
        ))}
        {ns.map((n) => (
          <text key={n} x={x(n)} y={H - 10} fontSize="9" textAnchor="middle" fill="#64748b">{n}</text>
        ))}
        <text x={(L + W) / 2} y={H} fontSize="9" textAnchor="middle" fill="#475569">symbols declared</text>
        {UNO_VARIANTS.map((v) => {
          const pts = rows.filter((r) => r.variant === v && r.table_bytes_mean !== null);
          return (
            <g key={v}>
              <polyline fill="none" stroke={STROKE[v]} strokeWidth="2.5"
                points={pts.map((r) => `${x(r.n)},${y(r.table_bytes_mean!)}`).join(' ')} />
              {rows.filter((r) => r.variant === v).map((r) =>
                r.held_all < r.programs ? (
                  <text key={r.n} x={x(r.n)} y={r.table_bytes_mean !== null ? y(r.table_bytes_mean) - 5 : y(maxB) + 8}
                    fontSize="11" fontWeight="bold" textAnchor="middle" fill="#e11d48">×</text>
                ) : (
                  <circle key={r.n} cx={x(r.n)} cy={y(r.table_bytes_mean!)} r="3" fill={STROKE[v]} />
                ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Range({ r }: { r: UnoPrediction['insertUs'] }) {
  if (!r) return <>—</>;
  return <>{r.mean.toFixed(0)} µs <span className="text-slate-500 font-semibold">({r.low.toFixed(0)}–{r.high.toFixed(0)})</span></>;
}

/** The editor's code: measured if it is a preset the board ran, predicted otherwise. */
function EditorCode({ code }: { code: string }) {
  const preset = SAMPLE_PRESETS.find((p) => p.code.trim() === code.trim());
  const measured = preset ? PRESETS.find((p) => p.id === preset.id) : undefined;
  const { names, source } = useMemo(() => declaredNames(code), [code]);
  const pred = useMemo(() => predictUno(names, MODEL), [names]);
  const base = measured?.baseline;

  return (
    <div className="bg-white border-2 border-teal-300 rounded-xl p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <FlaskConical className="w-4 h-4" /> The code in the editor, on the Uno
        </h4>
        <span className={`px-2 py-0.5 rounded border text-[10px] font-black uppercase ${measured
          ? 'bg-slate-100 text-slate-800 border-slate-300' : 'bg-amber-100 text-amber-900 border-amber-300'}`}>
          {measured ? 'Measured on the board' : 'Predicted'}
        </span>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        {measured
          ? `"${measured.name}" is one of the programs the Uno ran: these are its measurements.`
          : `${names.length} declarations found by the ${source === 'engine' ? "engine" : "browser's approximate parser"}. ` +
            'Bytes and refusals are computed exactly from each structure\'s rules (they matched every program the board ran); ' +
            'times are a model fitted to the board, shown with a range of about ±2 standard deviations.'}
      </p>
      {names.length === 0 ? (
        <p className="text-xs font-semibold text-slate-600">No declarations found in the editor's code.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-black">
              <tr>
                <th className="p-2">Structure</th><th className="p-2">Stored</th><th className="p-2 text-right">Table</th>
                <th className="p-2 text-right">vs textbook</th><th className="p-2">Insert / symbol</th><th className="p-2">Name lookup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {UNO_VARIANTS.map((v) => {
                const m = measured?.[v];
                const p = pred[v];
                const stored = m ? m.stored : p.stored;
                const total = m ? m.n : p.total;
                const bytes = m ? m.table_bytes : p.tableBytes;
                const textbookFull = m ? base && base.refused === 0 : pred.baseline.refused === 0;
                const textbookBytes = m ? base?.table_bytes : pred.baseline.tableBytes;
                return (
                  <tr key={v} className={stored < total ? 'bg-rose-50' : ''}>
                    <td className="p-2 font-sans font-bold">{LABEL[v]}</td>
                    <td className={`p-2 ${stored < total ? 'text-rose-700 font-bold' : ''}`}>
                      {stored}/{total}{stored < total && ' (ran out)'}
                    </td>
                    <td className="p-2 text-right">{bytes.toLocaleString()} B</td>
                    <td className="p-2 text-right">
                      {v === 'baseline' ? '—' : textbookFull && stored === total && textbookBytes ? pct(bytes, textbookBytes) + ' smaller'
                        : 'textbook ran out'}
                    </td>
                    <td className="p-2">{m ? `${m.insert_us_mean ?? '—'} µs` : <Range r={p.insertUs} />}</td>
                    <td className="p-2">{m ? `${m.lookup_hit_us_mean ?? '—'} µs` : <Range r={p.lookupUs} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function UnoBoardResults({ editorCode }: { editorCode: string }) {
  const val = MODEL.validation;
  const err = (k: 'insert' | 'lookup') =>
    val.length ? (val.reduce((s, r) => s + Math.abs(r[`${k}_measured`] - r[`${k}_predicted`]), 0) / val.length).toFixed(1) : '—';
  const inside = val.reduce((s, r) =>
    s + (Math.abs(r.insert_measured - r.insert_predicted) <= r.insert_half_range ? 1 : 0)
      + (Math.abs(r.lookup_measured - r.lookup_predicted) <= r.lookup_half_range ? 1 : 0), 0);
  const sims = SIMS.filter((s) => s.variant === 'ABC').reduce((s, r) => s + r.programs, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-800" /> Every preset, run on the Arduino Uno
          </h3>
          <span className="px-2 py-0.5 rounded border text-[10px] font-black uppercase bg-slate-100 text-slate-800 border-slate-300">
            Measured {board.measured}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1 flex items-start gap-1.5">
          <Cpu className="w-4 h-4 shrink-0" />
          <span>
            {board.board}. The PC parses each program; the board inserts every declaration into the structure it was flashed
            with, verifies it, and times each insert and lookup itself ({board.counts.inserts.toLocaleString()} inserts and{' '}
            {board.counts.lookups.toLocaleString()} lookups over {board.counts.runs} runs: {PRESETS.length} presets and{' '}
            {sims} generated programs, on three firmware builds).
          </span>
        </p>
        <div className="mt-3"><Legend /></div>
      </div>

      <EditorCode code={editorCode} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <PresetBars title="Memory" unit="B" pick={(r) => r.table_bytes}
          note="Bytes of the table on the board. A red outline means the structure ran out of room before the last symbol." />
        <PresetBars title="Insert time" unit="µs" pick={(r) => r.insert_us_mean}
          note="Mean time to insert one declaration, measured on the 16 MHz board." />
        <PresetBars title="Name lookup time" unit="µs" pick={(r) => r.lookup_hit_us_mean}
          note="Mean time to find one stored name (board repeats each lookup 16 times for precision)." />
      </div>

      <ScalingChart />

      <p className="text-xs text-slate-500">
        Timing model fitted on the {sims} generated programs only (for ABC on the trie work each name causes: siblings scanned,
        characters compared, edge splits). Tested on the {PRESETS.length} presets, which the fit never saw: mean error{' '}
        {err('insert')} µs per insert and {err('lookup')} µs per lookup; {inside} of {2 * val.length} measured times fall inside
        the predicted range. Memory and refusals are exact for all {board.counts.runs} runs. Data: firmware/results/uno_runs.csv.
      </p>
    </div>
  );
}
