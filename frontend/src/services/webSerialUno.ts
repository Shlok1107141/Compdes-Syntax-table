/**
 * Talk to an Arduino Uno running firmware/uno_bench straight from the browser
 * (Web Serial: Chrome and Edge, on https or localhost). The site asks the user
 * to pick the port; no backend is needed. Same protocol and parsing as
 * backend/hardware_uno.py, producing the same live events as POST /hardware/uno/live.
 */
import type { UnoLiveEvent, UnoStatus } from '../types';
import { avrBaselineBytes } from '../lib/unoModel';

/* The slice of the Web Serial API used here (not in TypeScript's DOM types yet). */
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(options?: object): Promise<SerialPortLike>;
}

const READY = '# uno_bench ready';
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export interface BoardSymbol {
  name: string;
  type: string;
  scope: number;
  storage_class: string;
  offset: number;
  packed: number;
}

const serial = (): SerialLike | undefined => (navigator as unknown as { serial?: SerialLike }).serial;
export const webSerialSupported = (): boolean => typeof navigator !== 'undefined' && Boolean(serial()) && window.isSecureContext;

class Restarted extends Error {}

export class WebSerialUno {
  private port: SerialPortLike;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private lines: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  readonly label: string;

  private constructor(port: SerialPortLike) {
    this.port = port;
    const info = port.getInfo();
    const id = info.usbVendorId !== undefined
      ? `${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`.toUpperCase()
      : 'serial';
    this.label = info.usbVendorId === 0x1a86 ? `USB · CH340 (${id})` : `USB · ${id}`;
  }

  /** Ask the user for the board's port (a browser dialog), open it and wait for the firmware. */
  static async connect(): Promise<WebSerialUno> {
    const s = serial();
    if (!s) throw new Error('This browser cannot open USB serial ports. Use Chrome or Edge.');
    return WebSerialUno.open(await s.requestPort());
  }

  /** Open a port the user already chose (also used by tests with a simulated port). */
  static async open(port: SerialPortLike): Promise<WebSerialUno> {
    const board = new WebSerialUno(port);
    try {
      await port.open({ baudRate: 115200 });            // opening resets the Uno
    } catch {
      throw new Error('That port is in use. Close the Arduino IDE Serial Monitor (or the local backend), then try again.');
    }
    board.readLoop();
    await board.waitForReady(8000);
    return board;
  }

  private async readLoop() {
    const decoder = new TextDecoder();
    let buf = '';
    while (!this.closed && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) { this.lines.push(line); this.wake?.(); }
          }
        }
      } catch {
        break;                                         // unplugged or closed
      } finally {
        this.reader.releaseLock();
      }
    }
    this.closed = true;
    this.wake?.();
  }

  private async nextLine(deadline: number): Promise<string> {
    while (!this.lines.length) {
      if (this.closed) throw new Error('The board was disconnected.');
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timeout');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.wake = () => { clearTimeout(t); resolve(); };
      });
      this.wake = null;
    }
    return this.lines.shift()!;
  }

  private async waitForReady(ms: number) {
    const deadline = Date.now() + ms;
    try {
      for (;;) if ((await this.nextLine(deadline)).startsWith(READY)) return;
    } catch {
      throw new Error('The board did not answer as uno_bench firmware. Flash it with: python firmware/tools/flash.py ABC --port COM3');
    }
  }

  private async send(line: string, ms: number): Promise<string[]> {
    this.lines = [];
    const writer = this.port.writable!.getWriter();
    await writer.write(new TextEncoder().encode(line + '\n'));
    writer.releaseLock();
    const out: string[] = [];
    const deadline = Date.now() + ms;
    for (;;) {
      let l: string;
      try {
        l = await this.nextLine(deadline);
      } catch (e) {
        if ((e as Error).message === 'timeout') throw new Error(`The board did not answer ${line.split(' ')[0]}.`);
        throw e;
      }
      if (l.startsWith('DONE')) return out;
      if (l.startsWith(READY)) throw new Restarted();   // reset button: the command was lost
      out.push(l);
    }
  }

  /** One command; returns what it printed before DONE. Sent again once if the board restarted. */
  async command(line: string, ms = 3000): Promise<string[]> {
    try {
      return await this.send(line, ms);
    } catch (e) {
      if (e instanceof Restarted) return this.send(line, ms);
      throw e;
    }
  }

  async close() {
    this.closed = true;
    try { await this.reader?.cancel(); } catch { /* already gone */ }
    try { await this.port.close(); } catch { /* already closed */ }
  }

  /** Pulse DTR: the Uno restarts and its RAM (and the table in it) is cleared. */
  async reset(): Promise<UnoStatus> {
    await this.port.setSignals({ dataTerminalReady: false });
    await new Promise((r) => setTimeout(r, 100));
    this.lines = [];
    await this.port.setSignals({ dataTerminalReady: true });
    await this.waitForReady(8000);
    return this.status();
  }

  async status(): Promise<UnoStatus> {
    const json = (await this.command('PING')).find((l) => l.startsWith('{'));
    const p = json ? JSON.parse(json) : null;
    if (!p || p.firmware !== 'uno_bench') throw new Error('The board answered, but not with the uno_bench firmware.');
    return { status: 'ONLINE', port: this.label, variant: p.variant, clock_mhz: p.clock_mhz, free_ram: p.free_heap,
      static_ram: p.static_ram, live_symbols: p.live_symbols ?? 0 };
  }

  private static rows(lines: string[], kind: string) {
    return lines.filter((l) => l.startsWith(`LIVE,${kind},`)).map((l) => l.split(','));
  }
  private static error(lines: string[]) {
    return WebSerialUno.rows(lines, 'ERROR')[0];
  }

  /** Insert every symbol on the board, then time a lookup of each stored name. */
  async runLive(symbols: BoardSymbol[], pc: Extract<UnoLiveEvent, { event: 'start' }>['pc'] | undefined,
    delayMs: number, onEvent: (e: UnoLiveEvent) => void, signal: AbortSignal) {
    const sent = symbols.filter((s) => NAME_RE.test(s.name)).slice(0, 200);
    const skipped = symbols.filter((s) => !sent.includes(s)).map((s) => ({ name: s.name, reason: 'not sent (name over 32 characters or more than 200 symbols)' }));
    const ready = WebSerialUno.rows(await this.command('LIVE'), 'READY')[0];
    if (!ready) throw new Error('The board did not start a live session.');
    const [, , variant, free, stat, budget] = ready;
    onEvent({ event: 'start', port: this.label, variant, free_ram: +free, static_ram: +stat, budget: +budget,
      total: sent.length, skipped, pc });

    for (let i = 0; i < sent.length; i++) {
      if (signal.aborted) return;
      const s = sent[i];
      const p = s.packed >>> 0;
      const lines = await this.command(`SYM ${(p >>> 28) & 0xf} ${(p >>> 20) & 0xff} ${(p >>> 16) & 0xf} ${p & 0xffff} ${s.name}`);
      const r = WebSerialUno.rows(lines, 'SYM')[0];
      if (!r) {
        const why = WebSerialUno.error(lines)?.[2];
        throw new Error(why === 'no_session'
          ? 'The board restarted during the run (its RAM was cleared). Press Run on Uno again.'
          : `The board rejected ${s.name}: ${why ?? 'no reply'}`);
      }
      const [, , n, name, result, table, heap, freeRam, us, verified, packed] = r;
      onEvent({ event: 'symbol', index: i, name, type: s.type, scope: s.scope, storage_class: s.storage_class,
        offset: s.offset, stored: +n, result: result as 'ok', table_bytes: +table, heap_bytes: +heap,
        free_ram: +freeRam, insert_us: +us, verified: verified === '1', packed_hex: packed });
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    }

    const d = WebSerialUno.rows(await this.command('END'), 'DONE')[0];
    if (!d) throw new Error('The board did not finish the live session.');
    const [, , stored, table, heap, freeRam, stopped] = d;
    // time a lookup of every stored name, on the board
    const names = [...new Set(sent.slice(0, +stored).map((s) => s.name))];
    const times: number[] = [];
    for (const n of names) {
      if (signal.aborted) return;
      const l = WebSerialUno.rows(await this.command(`LOOKUP ${n}`), 'LOOKUP')[0];
      if (l && l.length >= 7) times.push(+l[5] / +l[6]);
    }
    const model = +stored ? avrBaselineBytes(sent.slice(0, +stored).map((s) => s.name)) : null;
    onEvent({ event: 'done', stored: +stored, table_bytes: +table, heap_bytes: +heap, free_ram: +freeRam,
      stopped: stopped as 'none', variant, total: sent.length, refused: sent.length - +stored,
      avr_baseline_model_bytes: model,
      saving_vs_model_pct: model && variant !== 'baseline' ? Math.round(10000 * (1 - +table / model)) / 100 : null,
      lookup_us_mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null });
  }

  async lookup(name: string) {
    if (!NAME_RE.test(name)) throw new Error('Not an identifier of at most 32 characters.');
    const lines = await this.command(`LOOKUP ${name}`);
    const r = WebSerialUno.rows(lines, 'LOOKUP')[0];
    if (!r) throw new Error(WebSerialUno.error(lines)?.[2] === 'no_session'
      ? 'No table on the board: run some code or load a saved one first.' : 'The board did not answer the lookup.');
    return { name: r[2], found: r[3] === 'FOUND', declarations: +r[4] >= 0 ? +r[4] : null,
      lookup_us: r.length >= 7 ? +r[5] / +r[6] : undefined };
  }

  async save() {
    const lines = await this.command('SAVE', 12000);           // EEPROM writes take ~3 ms a byte
    const r = WebSerialUno.rows(lines, 'SAVED')[0];
    if (!r) {
      const e = WebSerialUno.error(lines);
      if (e?.[2] === 'too_big') throw new Error(`The table needs ${e[3]} B; the EEPROM holds ${e[4]} B.`);
      throw new Error(e?.[2] === 'no_session' ? 'No table on the board to save.'
        : e?.[2] === 'no_persistence' ? 'This firmware build cannot save (only baseline and ABC can).' : 'The board did not save.');
    }
    return { symbols: +r[2], snapshot_bytes: +r[3], table_bytes: +r[4], save_ms: +r[5] / 1000 };
  }

  async load() {
    const lines = await this.command('LOAD', 5000);
    const r = WebSerialUno.rows(lines, 'LOADED')[0];
    if (!r) {
      if (lines.some((l) => l.startsWith('CSV,LOAD,')))
        throw new Error('The EEPROM holds a benchmark snapshot, not a table saved from the app: run a program and press Save first.');
      const e = WebSerialUno.error(lines)?.[2];
      throw new Error(e === 'no_snapshot' ? 'No saved table for this firmware build in EEPROM.'
        : e === 'no_persistence' ? 'This firmware build cannot load (only baseline and ABC can).' : 'The board did not load.');
    }
    return { symbols: +r[2], snapshot_bytes: +r[3], table_bytes: +r[4], load_ms: +r[5] / 1000 };
  }
}
