"""
Hardware Serial Telemetry Bridge for ESP32 and Arduino Boards.
Connects over USB-UART Serial (default COM6 @ 115200 baud) to communicate
with the bare-metal DenseSym static symbol table analyzer firmware.
"""

import json
import logging
import os
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("hardware_bridge")

DEFAULT_PORT = os.environ.get("ESP32_PORT", "COM6")
DEFAULT_BAUD = int(os.environ.get("ESP32_BAUD", "115200"))


def probe_serial_port(port: str = DEFAULT_PORT) -> Dict[str, Any]:
    """Checks if the serial port is present at OS level and accessible."""
    try:
        import serial
        import serial.tools.list_ports
    except ImportError:
        return {"status": "ERROR", "detail": "pyserial not installed"}

    ports = list(serial.tools.list_ports.comports())
    matching = [p for p in ports if p.device.upper() == port.upper()]

    if not matching:
        return {
            "status": "DISCONNECTED",
            "port": port,
            "available_ports": [p.device for p in ports],
            "detail": f"Port {port} not found on host.",
        }

    dev = matching[0]
    return {
        "status": "DETECTED",
        "port": dev.device,
        "description": dev.description,
        "hwid": dev.hwid,
    }


def send_hardware_command(
    command: str, port: str = DEFAULT_PORT, baud: int = DEFAULT_BAUD, timeout: float = 3.0
) -> Dict[str, Any]:
    """Sends a command to the ESP32 and collects the streamed JSON response."""
    try:
        import serial
    except ImportError:
        return {"status": "ERROR", "detail": "pyserial not installed"}

    try:
        with serial.Serial(port, baud, timeout=timeout) as ser:
            # Clear input buffer
            ser.reset_input_buffer()
            time.sleep(0.05)

            # Send command
            cmd_payload = (command.strip() + "\n").encode("utf-8")
            ser.write(cmd_payload)
            ser.flush()

            # Read lines until JSON or timeout
            start_time = time.time()
            lines = []
            json_started = False
            brace_count = 0

            while time.time() - start_time < timeout:
                line = ser.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                if "{" in line:
                    json_started = True

                if json_started:
                    lines.append(line)
                    brace_count += line.count("{") - line.count("}")
                    if brace_count <= 0 and lines:
                        break

            if not lines:
                return {
                    "status": "NO_FIRMWARE_RESPONSE",
                    "port": port,
                    "detail": "ESP32 port opened successfully, but board did not respond with JSON. "
                              "Please flash firmware/esp32/esp32.ino to the board.",
                }

            full_text = "\n".join(lines)
            # Find the outer JSON boundaries
            idx_start = full_text.find("{")
            idx_end = full_text.rfind("}")
            if idx_start != -1 and idx_end != -1 and idx_end >= idx_start:
                json_str = full_text[idx_start : idx_end + 1]
                data = json.loads(json_str)
                return data

            return {"status": "RAW_OUTPUT", "port": port, "output": full_text}

    except serial.SerialException as exc:
        return {"status": "PORT_ERROR", "port": port, "detail": str(exc)}
    except json.JSONDecodeError as exc:
        return {"status": "JSON_ERROR", "raw": full_text, "detail": str(exc)}


def get_hardware_status(port: str = DEFAULT_PORT) -> Dict[str, Any]:
    """Pings the ESP32 hardware to check firmware health and memory."""
    probe = probe_serial_port(port)
    if probe["status"] != "DETECTED":
        return probe

    resp = send_hardware_command("PING", port=port, timeout=1.5)
    if resp.get("status") == "PONG":
        return {
            "status": "ONLINE",
            "port": port,
            "board": resp.get("board", "ESP32"),
            "clock_mhz": resp.get("clock_mhz", 240),
            "free_heap": resp.get("free_heap", 0),
            "description": probe["description"],
        }

    return {
        "status": "CONNECTED_READY_TO_FLASH",
        "port": port,
        "description": probe["description"],
        "detail": "Board detected on USB COM port. Ready to flash firmware.",
    }


def analyze_code_on_esp32(code: Optional[str] = None, port: str = DEFAULT_PORT) -> Dict[str, Any]:
    """Runs symbol table compression and profiling directly on physical ESP32."""
    if code and code.strip():
        # Sanitize single-line stream
        single_line = " ".join(code.split())
        cmd = f"ANALYZE {single_line}"
    else:
        cmd = "DEMO"

    result = send_hardware_command(cmd, port=port, timeout=3.0)
    return result
