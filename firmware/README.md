# DenseSym: Embedded Firmware & Hardware Deployment Guide

> **Review 3 Deliverable**: Bare-Metal Static Symbol Table Analysis on Microcontrollers (**ESP32** & **Arduino Uno**)

---

## 📋 Architectural Overview

Traditional compiler symbol tables rely on textbook separate-chaining hash tables with 64-bit pointers and heap chunk allocations. On resource-constrained microcontrollers, this causes severe memory bloat and stack-heap collisions:
* **Arduino Uno (AVR ATmega328P)**: Has only **2,048 Bytes (2 KB) of SRAM**. A textbook 64-bucket hash table exceeds available SRAM and crashes.
* **ESP32 (Xtensa 32-bit LX6 @ 240MHz)**: Has **320 KB SRAM**. DenseSym achieves **74%–78% memory reduction**, sub-microsecond lookup, and sub-100μs full table construction.

DenseSym solves this via:
1. **Patricia Radix Trie**: Compresses redundant identifier prefixes into shared edge labels.
2. **10-Byte Flat Arena Nodes**: Stored contiguously in SRAM using 16-bit indices (`uint16_t`), eliminating pointer overhead.
3. **Atomic 32-bit Metadata Words**: Bit-packed (`type:4b | scope:8b | storage:4b | offset:16b`).

---

## 🚀 Option 1: Flashing ESP32 via VS Code PlatformIO (Fastest)

Since you already have PlatformIO installed in VS Code:

1. In VS Code, click **File → Open Folder** and select:
   `D:\UNIVERSITY\Compiler Design\Projects\Compdes-Syntax-table\firmware\esp32`
2. PlatformIO will automatically load `platformio.ini` (preconfigured for `esp32dev` and port `COM6`).
3. In the blue bottom status bar in VS Code:
   * Click **✓ (PlatformIO: Build)** to compile.
   * Click **→ (PlatformIO: Upload)** to flash `COM6`.
4. *(If it displays `Connecting........`, momentarily hold down the physical **BOOT** button on the ESP32 until the upload progress bar begins).*

---

## ⚡ Option 2: Flashing ESP32 via Arduino IDE

1. Open **Arduino IDE**.
2. Open the sketch:
   `D:\UNIVERSITY\Compiler Design\Projects\Compdes-Syntax-table\firmware\esp32\esp32.ino`
3. **Install the ESP32 Board Package** (if not already installed):
   - Go to **File → Preferences**.
   - In *Additional Board Manager URLs*, paste:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Click **OK**.
   - Go to **Tools → Board → Boards Manager**, search for `esp32` by Espressif, and click **Install**.
4. **Configure Board Settings**:
   - **Tools → Board → esp32 → ESP32 Dev Module**
   - **Tools → Port → COM6**
   - **Tools → Upload Speed → 921600** (or 115200)
5. Click **Upload** (the right-arrow icon).
6. Once uploaded, open **Tools → Serial Monitor** at **115200 baud** to see the live boot beacon:
   ```text
   =================================================
   DenseSym ESP32 Bare-Metal Static Analyzer Ready
   CPU Frequency: 240 MHz | Free Heap: 298420 bytes
   Commands: PING | DEMO | ANALYZE <source code>
   =================================================
   ```

---

## 📟 Arduino Uno Deployment (`firmware/arduino/arduino.ino`)

For demonstrating the 2 KB AVR constraint:
1. Open `firmware/arduino/arduino.ino` in Arduino IDE.
2. Select **Tools → Board → Arduino AVR Boards → Arduino Uno**.
3. Select your Arduino's COM port and click **Upload**.
4. Send `D` or `R` over Serial Monitor at 115200 baud to trigger the 24-symbol embedded workload and view live SRAM consumption (`getFreeRam()`).

---

## 🔌 Verification & Hardware Bridge Commands

You can verify the board anytime using the Python CLI:
```bash
python -c "import sys; sys.path.append('backend'); from hardware_bridge import get_hardware_status, analyze_code_on_esp32; print(get_hardware_status()); print(analyze_code_on_esp32())"
```
Or test via the REST API endpoint:
* `GET http://localhost:8000/hardware/status`
* `POST http://localhost:8000/hardware/analyze`
