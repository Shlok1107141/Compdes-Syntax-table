import type { AnalyzeRequest, AnalyzeResponse, ExecutionMode, HealthStatus } from '../types';
import { SAMPLE_PRESETS } from '../data/sampleCodes';
import sampleResults from '../data/sampleResults.json';

/**
 * Where the backend lives. The same-origin `/api` prefix works both in
 * development (Vite proxy, see vite.config.ts) and in Docker (nginx).
 * Set VITE_API_URL at build time to point somewhere else.
 */
const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api';
const REQUEST_TIMEOUT_MS = 8000;

/** The engine's real output for each built-in sample (backend/scripts/build_sample_results.py). */
const OFFLINE_RESULTS = sampleResults as unknown as Record<string, AnalyzeResponse>;

export const OFFLINE_UNAVAILABLE =
  'Offline mode only has the engine\'s results for the built-in samples. ' +
  'Start the backend (docker compose up) to analyze your own code.';

/**
 * The precomputed engine result for `code` when it is one of the built-in
 * samples, otherwise null. Offline mode never invents numbers.
 */
export function offlineResultFor(code: string): AnalyzeResponse | null {
  const preset = SAMPLE_PRESETS.find((p) => p.code.trim() === code.trim());
  return preset ? OFFLINE_RESULTS[preset.id] ?? null : null;
}

/** Ping the backend to see whether it and the engine binary are available. */
export async function checkBackendHealth(): Promise<HealthStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    if (!response.ok) {
      return { online: false, message: `Server returned status ${response.status}` };
    }
    const data = await response.json();
    return { online: true, engineReady: Boolean(data.engine_ready), message: data.status || 'ok' };
  } catch {
    return { online: false, message: 'Backend is offline' };
  } finally {
    clearTimeout(timeoutId);
  }
}

const STATUS_LABELS: Record<number, string> = {
  400: 'C Parse Error (HTTP 400)',
  413: 'Payload Too Large (HTTP 413)',
  422: 'Invalid Request (HTTP 422)',
  429: 'Rate Limit Exceeded (HTTP 429)',
  503: 'Engine Unavailable (HTTP 503)',
  504: 'Analysis Timed Out (HTTP 504)',
};

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed.detail) return typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
  } catch {
    // not JSON: fall back to the raw body
  }
  return text || response.statusText;
}

/** Analyze `code`, either through the live backend or from the offline sample results. */
export async function analyzeCode(code: string, mode: ExecutionMode): Promise<AnalyzeResponse> {
  if (mode === 'offline') {
    const result = offlineResultFor(code);
    if (!result) throw new Error(OFFLINE_UNAVAILABLE);
    return result;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code } as AnalyzeRequest),
      signal: controller.signal,
    });

    if (!response.ok) {
      const label = STATUS_LABELS[response.status] ?? `Backend Error (HTTP ${response.status})`;
      throw new Error(`${label}: ${await errorDetail(response)}`);
    }
    return (await response.json()) as AnalyzeResponse;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Analysis request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
    }
    if (err instanceof TypeError) {
      throw new Error('Could not connect to the backend. Start it with "docker compose up" (or uvicorn on port 8000).');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
