import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, Cpu, Database, Info, Play, Power, RefreshCw, RotateCcw, Save, Search, Square, Upload, Usb,
  XCircle,
} from 'lucide-react';
import { SAMPLE_PRESETS } from '../data/sampleCodes';
import recorded from '../data/unoResults.json';
import {
  boardProgram, listSerialPorts, runOnUno, unoDisconnect, unoLoad, unoLookup, unoReset, unoSave, unoStatus,
} from '../services/api';
import { WebSerialUno, webSerialSupported } from '../services/webSerialUno';
import { UnoComparison } from './UnoComparison';
import type { SerialPortInfo, UnoLiveEvent, UnoStatus } from '../types';

type StartEvent = Extract<UnoLiveEvent, { event: 'start' }>;
type SymbolRow = Extract<UnoLiveEvent, { event: 'symbol' }>;
type DoneEvent = Extract<UnoLiveEvent, { event: 'done' }>;

const RAM_TOTAL = 2048;
const EDITOR_SOURCE = '__editor__';
const VARIANTS: Record<string, string> = {
  baseline: 'Textbook hash table (baseline)',
  A: 'Bit-packing only (A)',
  B: 'Arena only (B)',
  C: 'Radix trie only (C)',
  AB: 'Arena + bit-packing (AB)',
  AC: 'Trie + bit-packing (AC)',
  BC: 'Trie + arena (BC)',
  ABC: 'Compressed: trie + arena + bit-packing (ABC)',
};
const HEAP_VARIANTS = new Set(['baseline', 'A', 'C', 'AC']);

/** Where a number on this panel comes from. */
const SOURCES = {
  LIVE: { cls: 'bg-emerald-100 text-emerald-900 border-emerald-300', title: 'Reported by the Uno during this run' },
  MODEL: { cls: 'bg-amber-100 text-amber-900 border-amber-300', title: 'AVR model of the textbook table; equal to every baseline the Uno measured' },
  PC: { cls: 'bg-sky-100 text-sky-900 border-sky-300', title: 'The same program measured by the engine on this 64-bit PC' },
  RECORDED: { cls: 'bg-slate-100 text-slate-800 border-slate-300', title: 'Measured earlier on this Uno (firmware/results)' },
} as const;
type Source = keyof typeof SOURCES;

function SourceBadge({ source }: { source: Source }) {
  return (
    <span title={SOURCES[source].title}
      className={`px-1.5 py-0.5 rounded border text-[10px] font-black uppercase tracking-wide ${SOURCES[source].cls}`}>
      {source}
    </span>
  );
}

function Tile({ label, value, sub, source }: { label: string; value: ReactNode; sub?: ReactNode; source: Source }) {
  return (
    <div className="bg-white border-2 border-slate-300 rounded-xl p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2 text-xs font-black text-slate-600 mb-1">
        <span className="uppercase">{label}</span>
        <SourceBadge source={source} />
      </div>
      <div className="text-2xl font-black text-slate-900 font-mono">{value}</div>
      {sub && <div className="text-xs font-semibold text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function UnoLive({ editorCode }: { editorCode: string }) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [port, setPort] = useState('');
  const [status, setStatus] = useState<UnoStatus | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Board opened by this page over Web Serial (no backend needed), or null. */
  const [usb, setUsb] = useState<WebSerialUno | null>(null);
  /** null: not checked yet; false: no local backend (e.g. on GitHub Pages). */
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const usbMode = usb !== null || backendUp === false;

  const [source, setSource] = useState('uno-demo-50');
  const [delayMs, setDelayMs] = useState(120);
  const [running, setRunning] = useState(false);
  const [start, setStart] = useState<StartEvent | null>(null);
  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [lookupName, setLookupName] = useState('');
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const code = source === EDITOR_SOURCE ? editorCode : SAMPLE_PRESETS.find((p) => p.id === source)?.code ?? '';

  const connect = useCallback((p: string) => {
    if (!p) return Promise.resolve();
    setBusy('Connecting (the Uno restarts when its port opens)');
    return unoStatus(p)
      .then((s) => { setStatus(s); setBoardError(null); })
      .catch((err) => { setStatus(null); setBoardError(message(err)); })
      .finally(() => setBusy(null));
  }, []);

  /** List the ports, keep or pick one (an Arduino first), and connect to it. */
  const scan = useCallback((current: string) =>
    listSerialPorts()
      .then((res) => {
        setBackendUp(true);
        const chosen = current && res.ports.some((p) => p.device === current)
          ? current
          : res.ports.find((p) => p.likely_board?.startsWith('Arduino'))?.device ?? res.ports[0]?.device ?? '';
        setPorts(res.ports);
        setPort(chosen);
        if (!chosen) {
          setStatus(null);
          setBoardError('No serial ports found. Plug the Uno in over USB, then press Refresh.');
          return;
        }
        return connect(chosen);
      })
      .catch((err) => {
        // No local backend (e.g. on GitHub Pages): this page can open the board itself.
        setPorts([]);
        setStatus(null);
        setBackendUp(false);
        setBoardError(webSerialSupported() ? null
          : `${message(err)} Or open this page in Chrome or Edge, which can connect to the Uno directly.`);
      }), [connect]);

  /** Ask the browser for the board's port and open it here (Web Serial). */
  const connectUsb = async () => {
    setBusy('Pick the Uno in the browser\'s list (it restarts when the port opens)');
    setBoardError(null);
    const asked = Date.now();
    try {
      const board = await WebSerialUno.connect();
      setUsb(board);
      setStatus(await board.status());
    } catch (err) {
      setStatus(null);
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        // The user closed the list without choosing; if it closed at once, no list was shown at all.
        if (Date.now() - asked < 800) {
          setBoardError('No port list appeared. Open this page in Google Chrome or Microsoft Edge to connect the Uno.');
        }
      } else {
        setBoardError(message(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const disconnectUsb = async () => {
    await usb?.close();
    setUsb(null);
    setStatus(null);
  };

  useEffect(() => () => { void usb?.close(); }, [usb]);

  useEffect(() => {
    void scan('');
  }, [scan]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = tableRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const note = (ok: boolean, text: string) => setLog((l) => [{ ok, text }, ...l].slice(0, 12));

  const run = async () => {
    if ((!usb && !port) || !code.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setStart(null);
    setRows([]);
    setDone(null);
    setRunError(null);
    const onEvent = (e: UnoLiveEvent) => {
      if (e.event === 'start') setStart(e);
      else if (e.event === 'symbol') setRows((r) => [...r, e]);
      else if (e.event === 'done') setDone(e);
      else setRunError(e.detail);
    };
    try {
      if (usb) {
        const prog = boardProgram(code);
        await usb.runLive(prog.symbols, prog.pc, delayMs, onEvent, ctrl.signal);
      } else {
        await runOnUno(code, port, delayMs, onEvent, ctrl.signal);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) setRunError(message(err));
    } finally {
      setRunning(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    note(false, 'Run stopped. The symbols already sent stay in the board\'s table.');
  };

  const act = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    try {
      note(true, await fn());
    } catch (err) {
      note(false, message(err));
    } finally {
      setBusy(null);
    }
  };

  const latest = rows[rows.length - 1];
  const firstRefused = rows.find((r) => r.result !== 'ok');
  const okRows = rows.filter((r) => r.result === 'ok');
  const avgInsert = okRows.length ? okRows.reduce((s, r) => s + r.insert_us, 0) / okRows.length : null;
  const variant = start?.variant ?? status?.variant ?? '';
  const isHeap = HEAP_VARIANTS.has(variant);
  const staticRam = start?.static_ram ?? status?.static_ram ?? 0;
  const freeRam = latest?.free_ram ?? start?.free_ram ?? status?.free_ram ?? 0;
  const heapBytes = latest?.heap_bytes ?? 0;
  const tableBytes = done?.table_bytes ?? latest?.table_bytes ?? 0;
  const budget = start?.budget ?? 1200;
  const disabled = !status || running || busy !== null;

  const rec = recorded.same_symbols.find((r) => r.set === 'proto30');
  const capOf = (v: string) => recorded.capacity.find((c) => c.variant === v);
  const speedOf = (v: string) => recorded.speed.find((s) => s.variant === v);

  return (
    <div className="space-y-6">
      {/* Board */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-lg bg-teal-800 text-white flex items-center justify-center border-2 border-teal-900">
              <Cpu className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Arduino Uno: live symbol table</h2>
              <p className="text-xs font-semibold text-slate-600 mt-0.5 max-w-2xl">
                This computer parses the C code; the Uno (ATmega328P, 2,048 B RAM) inserts each declaration into the
                structure it was flashed with and reports what that cost.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {usbMode ? (
              usb ? (
                <button type="button" onClick={() => void disconnectUsb()} disabled={running || busy !== null}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs border-2 border-slate-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                  <Usb className="w-4 h-4" /> Disconnect
                </button>
              ) : (
                <button type="button" onClick={() => void connectUsb()} disabled={busy !== null || !webSerialSupported()}
                  className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-black text-sm border-2 border-teal-900 flex items-center gap-2 disabled:opacity-50 cursor-pointer">
                  <Usb className="w-4 h-4" /> Connect Uno (USB)
                </button>
              )
            ) : (
              <>
                <select value={port} onChange={(e) => { setPort(e.target.value); void connect(e.target.value); }}
                  disabled={running || busy !== null}
                  className="px-2 py-2 border-2 border-slate-300 rounded-lg text-xs font-bold bg-white">
                  {ports.length === 0 && <option value="">no ports</option>}
                  {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                      {p.device} {p.likely_board ? `· ${p.likely_board}` : `· ${p.description}`}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void scan(port)}
                  disabled={running || busy !== null}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs border-2 border-slate-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </>
            )}
            <button type="button" disabled={disabled}
              onClick={() => act('Resetting', async () => {
                const s = usb ? await usb.reset() : await unoReset(port);
                setStatus(s);
                setStart(null);                 // the table that run built is gone with the RAM
                setRows([]);
                setDone(null);
                return `Board reset: its RAM was cleared (${s.free_ram} B free). A saved table is still in EEPROM.`;
              })}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs border-2 border-slate-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
              <RotateCcw className="w-4 h-4" /> Reset board
            </button>
            {!usbMode && (
              <button type="button" disabled={!status || running || busy !== null}
                onClick={() => act('Releasing port', async () => {
                  await unoDisconnect();
                  setStatus(null);
                  setBoardError(`Port released. Flash another structure with: python firmware/tools/flash.py ABC --port ${port} — then press Refresh.`);
                  return 'Port released for flashing.';
                })}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs border-2 border-slate-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                <Power className="w-4 h-4" /> Release port
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {status ? (
            <>
              <span className="px-2.5 py-1 rounded-full font-black bg-emerald-100 text-emerald-900 border-2 border-emerald-300">
                ONLINE · {status.port}
              </span>
              <span className="px-2.5 py-1 rounded-full font-bold bg-teal-50 text-teal-900 border-2 border-teal-300">
                Firmware: {VARIANTS[status.variant] ?? status.variant}
              </span>
              <span className="px-2.5 py-1 rounded-full font-bold bg-slate-50 text-slate-800 border-2 border-slate-300">
                {status.clock_mhz} MHz · globals {status.static_ram} B · {status.free_ram} B free
              </span>
            </>
          ) : (
            <span className="px-2.5 py-1 rounded-full font-black bg-slate-100 text-slate-700 border-2 border-slate-300">
              {busy ?? 'Not connected'}
            </span>
          )}
          {busy && status && <span className="text-slate-600 font-semibold">{busy}…</span>}
        </div>
        {boardError && (
          <div className="mt-3 p-3 rounded-lg bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs font-semibold flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{boardError}</span>
          </div>
        )}
        {usbMode && !usb && !boardError && (
          <div className="mt-3 p-3 rounded-lg bg-sky-50 border-2 border-sky-300 text-sky-950 text-xs font-semibold flex gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>
              Plug the Uno into this computer by USB and click <b>Connect Uno (USB)</b>; the browser asks which port to use
              (pick the USB-SERIAL CH340 one). It needs Chrome or Edge, and the board must run the uno_bench firmware. Close
              the Arduino IDE Serial Monitor first: only one program can hold the port.
            </span>
          </div>
        )}
      </div>

      {/* Program */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <label className="flex-1 text-xs font-black text-slate-700 uppercase">
            Program
            <select value={source} onChange={(e) => setSource(e.target.value)} disabled={running}
              className="mt-1 w-full px-2 py-2 border-2 border-slate-300 rounded-lg text-xs font-bold bg-white normal-case">
              {SAMPLE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value={EDITOR_SOURCE}>Code in the Symbol Table editor</option>
            </select>
          </label>
          <label className="w-full lg:w-64 text-xs font-black text-slate-700 uppercase">
            Pace: {delayMs} ms between symbols
            <input type="range" min={0} max={300} step={20} value={delayMs} disabled={running}
              onChange={(e) => setDelayMs(Number(e.target.value))} className="mt-2 w-full accent-teal-700" />
          </label>
          {running ? (
            <button type="button" onClick={stop}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black text-sm border-2 border-rose-800 flex items-center gap-2 cursor-pointer">
              <Square className="w-4 h-4 fill-white" /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => void run()} disabled={disabled || !code.trim()}
              className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-black text-sm border-2 border-orange-800 flex items-center gap-2 disabled:opacity-50 cursor-pointer">
              <Play className="w-4 h-4 fill-white" /> Run on Uno
            </button>
          )}
        </div>
        {source !== EDITOR_SOURCE && (
          <p className="mt-2 text-xs text-slate-600">
            {SAMPLE_PRESETS.find((p) => p.id === source)?.description}
          </p>
        )}
      </div>

      {runError && (
        <div className="p-4 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-sm font-bold flex gap-2">
          <XCircle className="w-5 h-5 shrink-0" />
          <span>{runError}</span>
        </div>
      )}

      {start && (
        <>
          {/* RAM */}
          <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Uno RAM while it runs {VARIANTS[variant] ?? variant}
              </h3>
              <SourceBadge source="LIVE" />
            </div>
            <div>
              <div className="flex h-7 w-full rounded-lg overflow-hidden border-2 border-slate-400 text-[10px] font-black text-white">
                <div className="bg-slate-500 flex items-center justify-center" style={{ width: `${(staticRam / RAM_TOTAL) * 100}%` }}
                  title="Firmware globals; in an arena build this includes the table's fixed pools">
                  {staticRam} B
                </div>
                {isHeap && heapBytes > 0 && (
                  <div className="bg-teal-600 flex items-center justify-center transition-all duration-150"
                    style={{ width: `${(heapBytes / RAM_TOTAL) * 100}%` }} title="Heap taken by the table">
                    {heapBytes} B
                  </div>
                )}
                <div className="bg-white" style={{ flex: 1 }} />
                <div className={`${firstRefused ? 'bg-rose-500' : 'bg-emerald-500'} flex items-center justify-center transition-all duration-150`}
                  style={{ width: `${(Math.max(freeRam, 0) / RAM_TOTAL) * 100}%` }} title="Free between heap and stack">
                  {freeRam} B
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
                <span><span className="inline-block w-3 h-3 bg-slate-500 rounded-sm mr-1 align-middle" />
                  {isHeap ? 'Program globals (incl. any bucket array)' : 'Program globals + the arena pools (reserved when it is flashed)'}</span>
                {isHeap && <span><span className="inline-block w-3 h-3 bg-teal-600 rounded-sm mr-1 align-middle" />Table on the heap</span>}
                <span><span className="inline-block w-3 h-3 bg-white border border-slate-400 rounded-sm mr-1 align-middle" />Stack</span>
                <span><span className="inline-block w-3 h-3 bg-emerald-500 rounded-sm mr-1 align-middle" />Free</span>
                <span className="ml-auto font-mono">2,048 B total</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-black text-slate-700 mb-1">
                <span>Table size vs the {budget} B every structure gets in the capacity test</span>
                <span className="font-mono">{tableBytes} / {budget} B</span>
              </div>
              <div className="h-3 w-full rounded-full bg-slate-100 border border-slate-300 overflow-hidden">
                <div className={`h-full ${tableBytes > budget ? 'bg-rose-500' : 'bg-teal-600'} transition-all duration-150`}
                  style={{ width: `${Math.min(100, (tableBytes / budget) * 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Tile source="LIVE" label="Symbols stored"
              value={<>{done?.stored ?? latest?.stored ?? 0}<span className="text-base text-slate-500"> / {start.total}</span></>}
              sub={done ? (done.refused ? `${done.refused} refused` : 'every declaration stored and verified') : running ? 'inserting…' : ''} />
            <Tile source="LIVE" label="Table on the Uno" value={`${tableBytes} B`}
              sub={avgInsert !== null ? `${avgInsert.toFixed(0)} µs per insert on average (16 MHz)` : undefined} />
            <Tile source="LIVE" label="Name lookup on the Uno"
              value={done?.lookup_us_mean != null ? `${done.lookup_us_mean.toFixed(1)} µs` : '—'}
              sub={done?.lookup_us_mean != null ? 'mean time to find a stored name, timed on the board'
                : done ? 'not measured in this run' : 'measured when the inserts finish'} />
          </div>
          {done && (
            <UnoComparison run={{ variant: done.variant, names: rows.map((r) => r.name), stored: done.stored,
              tableBytes: done.table_bytes, insertUs: avgInsert, lookupUs: done.lookup_us_mean ?? null }} />
          )}
          {start.pc && (
            <p className="text-xs font-semibold text-slate-600 flex items-center gap-2">
              <SourceBadge source="PC" /> The same program on a 64-bit PC: {start.pc.baseline_bytes} → {start.pc.compressed_bytes} B
              ({start.pc.savings_pct.toFixed(1)}% smaller), because pointers there are 8 B instead of 2 B.
            </p>
          )}

          {firstRefused && (
            <div className="p-4 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-900 text-sm font-bold flex gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>
                The Uno refused symbol #{firstRefused.index + 1} ({firstRefused.name}) and every one after it:{' '}
                {firstRefused.result === 'out_of_ram'
                  ? 'its RAM ran out (the heap reached the stack reserve).'
                  : 'the fixed arena pools are full.'}{' '}
                It holds {firstRefused.stored} of {start.total}.
              </span>
            </div>
          )}
          {start.skipped.length > 0 && (
            <p className="text-xs font-semibold text-amber-800">
              Not sent: {start.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}
            </p>
          )}

          {/* Table */}
          <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Inserted on the board ({rows.length} of {start.total})
              </h3>
              <SourceBadge source="LIVE" />
            </div>
            <div ref={tableRef} className="overflow-auto max-h-80 border-2 border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 sticky top-0 border-b-2 border-slate-300 text-slate-700 font-black">
                  <tr>
                    <th className="p-2">#</th><th className="p-2">Name</th><th className="p-2">Type</th>
                    <th className="p-2">Scope</th><th className="p-2">Offset</th><th className="p-2">Packed word</th>
                    <th className="p-2 text-right">Insert µs</th><th className="p-2 text-right">Table B</th>
                    <th className="p-2">On the Uno</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {rows.map((r) => (
                    <tr key={r.index} className={r.result === 'ok' ? 'hover:bg-slate-50' : 'bg-rose-50 text-rose-800'}>
                      <td className="p-2 text-slate-500">{r.index + 1}</td>
                      <td className="p-2 font-bold">{r.name}</td>
                      <td className="p-2">{r.type}</td>
                      <td className="p-2">{r.scope}</td>
                      <td className="p-2">{r.offset}</td>
                      <td className="p-2 text-orange-700 font-bold">0x{r.packed_hex}</td>
                      <td className="p-2 text-right">{r.result === 'ok' ? r.insert_us : '—'}</td>
                      <td className="p-2 text-right">{r.table_bytes}</td>
                      <td className="p-2 font-sans font-bold">
                        {r.result === 'ok'
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />stored, found</span>
                          : <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{r.result === 'out_of_ram' ? 'out of RAM' : 'pools full'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* EEPROM + lookup */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Keep the table across a reset</h3>
          <SourceBadge source="LIVE" />
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Save writes the table to the Uno's 1,024 B EEPROM. Then press the board's reset button (or Reset board): RAM is
          wiped. Load brings it back, and Lookup asks the board whether a name is stored. Baseline and ABC builds only.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={disabled}
            onClick={() => act('Saving', async () => {
              const r = usb ? await usb.save() : await unoSave(port);
              return `Saved ${r.symbols} symbols: ${r.snapshot_bytes} B written to EEPROM in ${r.save_ms.toFixed(0)} ms.`;
            })}
            className="px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold text-xs border-2 border-teal-900 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
            <Save className="w-4 h-4" /> Save to EEPROM
          </button>
          <button type="button" disabled={disabled}
            onClick={() => act('Loading', async () => {
              const r = usb ? await usb.load() : await unoLoad(port);
              return `Loaded ${r.symbols} symbols (${r.table_bytes} B table) from EEPROM in ${r.load_ms.toFixed(1)} ms.`;
            })}
            className="px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold text-xs border-2 border-teal-900 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
            <Upload className="w-4 h-4" /> Load from EEPROM
          </button>
          <form className="flex items-center gap-2 ml-0 sm:ml-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = lookupName.trim();
              if (name) void act('Looking up', async () => {
                const r = usb ? await usb.lookup(name) : await unoLookup(port, name);
                return r.found
                  ? `${r.name}: FOUND on the board${r.declarations ? ` (${r.declarations} declaration${r.declarations > 1 ? 's' : ''})` : ''}.`
                  : `${r.name}: not in the board's table.`;
              });
            }}>
            <input value={lookupName} onChange={(e) => setLookupName(e.target.value)} placeholder="identifier"
              className="px-2 py-2 border-2 border-slate-300 rounded-lg text-xs font-mono w-48" />
            <button type="submit" disabled={disabled || !lookupName.trim()}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-xs border-2 border-slate-300 flex items-center gap-1 disabled:opacity-50 cursor-pointer">
              <Search className="w-4 h-4" /> Lookup
            </button>
          </form>
        </div>
        {log.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs font-semibold">
            {log.map((l, i) => (
              <li key={log.length - i} className={`flex gap-2 ${l.ok ? 'text-emerald-800' : 'text-rose-800'} ${i ? 'opacity-60' : ''}`}>
                {l.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recorded */}
      {rec && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4" /> Measured earlier on this Uno, all eight structures
            </h3>
            <SourceBadge source="RECORDED" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border-2 border-slate-200">
              <div className="font-black text-slate-700 uppercase mb-1">Prototype's {rec.n} names</div>
              <div className="font-mono text-slate-900">PC: {rec.pc_baseline_bytes} → {rec.pc_abc_bytes} B ({(100 * (1 - rec.pc_abc_bytes / rec.pc_baseline_bytes)).toFixed(1)}% smaller)</div>
              {rec.uno_baseline_bytes !== null && rec.uno_abc_bytes !== null && (
                <div className="font-mono text-slate-900">Uno: {rec.uno_baseline_bytes} → {rec.uno_abc_bytes} B ({(100 * (1 - rec.uno_abc_bytes / rec.uno_baseline_bytes)).toFixed(1)}% smaller)</div>
              )}
              <div className="text-slate-600 mt-1">ABC is the same size on both; the textbook table shrinks on the Uno.</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border-2 border-slate-200">
              <div className="font-black text-slate-700 uppercase mb-1">Names held in the same RAM</div>
              <div className="font-mono text-slate-900">Textbook: {capOf('baseline')?.fit_budget} · AB: {capOf('AB')?.fit_budget} · ABC: {capOf('ABC')?.fit_budget}</div>
              <div className="text-slate-600 mt-1">Each structure given {budget} B of the 400-name set.</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border-2 border-slate-200">
              <div className="font-black text-slate-700 uppercase mb-1">Lookup time (prototype set)</div>
              <div className="font-mono text-slate-900">Textbook: {speedOf('baseline')?.lookup_us} µs · ABC: {speedOf('ABC')?.lookup_us} µs</div>
              <div className="text-slate-600 mt-1">Compression costs time on an 8-bit CPU.</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Source: firmware/results/HARDWARE_RESULTS.md</p>
        </div>
      )}
    </div>
  );
}
