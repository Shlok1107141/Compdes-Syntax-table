import samples from './samples.json';

export interface SamplePreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  code: string;
}

export const CUSTOM_PRESET: SamplePreset = {
  id: 'custom',
  name: 'Custom C Code (User Defined)',
  badge: 'Interactive Input',
  description: 'Write, paste, or modify your own C declarations, structs, and functions to evaluate memory compression.',
  code: '/* Custom Embedded C Declarations */\nint motor_rpm;\nint motor_max_rpm;\nfloat battery_voltage;\nchar device_status;\n\nvoid init_hardware(int bus_clock) {\n    int timer_prescaler;\n    int adc_channel;\n}\n\nint main(void) {\n    return 0;\n}\n',
};

/**
 * Built-in presets. Kept in samples.json so backend/scripts/build_sample_results.py
 * can run the real engine over the exact same code for offline mode.
 */
export const SAMPLE_PRESETS: SamplePreset[] = [
  ...samples,
  CUSTOM_PRESET,
];
