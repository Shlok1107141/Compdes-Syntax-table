import samples from './samples.json';

export interface SamplePreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  code: string;
}

/**
 * Built-in presets. Kept in samples.json so backend/scripts/build_sample_results.py
 * can run the real engine over the exact same code for offline mode.
 */
export const SAMPLE_PRESETS: SamplePreset[] = samples;
