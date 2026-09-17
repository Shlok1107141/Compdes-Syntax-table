export interface SamplePreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  code: string;
}

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'embedded-prototype-30',
    name: 'Embedded Sensor Subsystem (Review Prototype 30)',
    badge: 'Verified 75.4% Savings',
    description: 'The exact 30-symbol workload from engine/symtab_demo.c demonstrating real-world naming conventions.',
    code: `/* Embedded Sensor Node Firmware - BCSE307L Benchmark */
int counter;
int counter_max;
int counter_min;
char temp;
char temp_max;
char temp_min;
int* temp_buffer;

int sensor_id;
int sensor_value;
int led_pin;
int led_state;
char* buffer;
int buffer_size;
char* buffer_ptr;

int status;
int status_flag;
int status_code;
struct Config config;
int config_flag;

void counter_reset(void) {
    int count;
    int count_all;
}

void sensor_read(void) {
    static int init_flag;
}

void sensor_write(void) {}
void led_toggle(void) {}

void handler(void) {
    static int handler_id;
}

int main(void) {
    return 0;
}
`
  },
  {
    id: 'can-bus-controller',
    name: 'CAN Bus & Motor Subsystem (High Redundancy)',
    badge: 'Heavy Prefix Sharing',
    description: 'Heavily partitioned embedded device with repeated subsystem prefixes (can_*, motor_*, sensor_*).',
    code: `/* CAN 2.0B Controller & Dual Stepper Subsystem */
int can_rx_buf_head;
int can_rx_buf_tail;
int can_rx_filter_id;
int can_rx_mask;
int can_tx_buf_head;
int can_tx_buf_tail;
int can_tx_priority;
int can_status_bus_off;
int can_status_err_warn;

int motor_stepper_pos_actual;
int motor_stepper_pos_target;
int motor_stepper_vel_max;
int motor_stepper_accel_rate;
int motor_pwm_duty_cycle;
int motor_pwm_freq_hz;
int motor_driver_fault;

int telemetry_packet_count;
int telemetry_packet_crc;
int telemetry_tx_rate_hz;

void can_init_registers(int baud_prescaler) {
    int can_reg_btr0;
    int can_reg_btr1;
    int can_reg_ocr;
}

void motor_update_pid(void) {
    int motor_pid_error_p;
    int motor_pid_error_i;
    int motor_pid_error_d;
}
`
  },
  {
    id: 'nested-scopes-c',
    name: 'Lexical Scoping & Shadowing',
    badge: 'Deep Scope Depth',
    description: 'Demonstrates bit-packed scope tracking across nested lexical blocks and local parameters.',
    code: `/* Multi-tier Scope Tracking */
int global_system_state;
int global_error_counter;

int compute_metrics(int input_factor, int sample_rate) {
    int local_accumulator;
    int local_threshold;
    
    for (int loop_i = 0; loop_i < 100; loop_i++) {
        int block_sample;
        if (block_sample > 10) {
            int nested_spike_delta;
            int nested_confidence;
        }
    }
    
    return local_accumulator;
}
`
  },
  {
    id: 'random-worst-case',
    name: 'Disjoint Identifiers (Worst-Case)',
    badge: 'Near-Zero Prefix Overlap',
    description: 'Identifiers with unique initial characters designed to evaluate trie behavior under minimal prefix sharing.',
    code: `/* Disjoint Identifier Stress Set */
int alpha;
int beta;
int gamma;
int delta;
int epsilon;
int zeta;
int eta;
int theta;
int iota;
int kappa;
int lambda;
int mu;
int nu;
int xi;
int omicron;
int pi;
int rho;
int sigma;
int tau;
int upsilon;
int phi;
int chi;
int psi;
int omega;
`
  }
];
