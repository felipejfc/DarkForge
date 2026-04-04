#!/usr/bin/env python3
"""
krepl.py — Send a JS command to the running kserver and get the result.

The kserver runs as a background daemon with both:
  - WebSocket server on :9090 (for iPhone app connection)
  - HTTP API on :9092 (for sending commands from the Mac)

Usage:
    python3 krepl.py "kread64(kernelBase)"              # one-liner
    python3 krepl.py scripts/probe_offsets.js            # execute script file
    python3 krepl.py                                     # interactive REPL
"""

import sys
import json
import urllib.request
import readline
import os

SERVER = "http://localhost:9092"
HISTORY_FILE = os.path.expanduser("~/.krepl_history")

def send_command(code: str, timeout: float = 60) -> dict:
    """Send JS code to kserver HTTP API, return result dict."""
    data = json.dumps({"code": code}).encode("utf-8")
    req = urllib.request.Request(
        f"{SERVER}/exec",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        return {"error": f"Cannot connect to kserver at {SERVER}: {e}"}
    except Exception as e:
        return {"error": str(e)}

def print_result(result: dict):
    """Pretty-print a REPL result."""
    if result.get("logs"):
        for log in result["logs"]:
            print(f"\033[36m[log]\033[0m {log}")
    if result.get("error"):
        print(f"\033[91m[error]\033[0m {result['error']}")
    elif result.get("value") is not None:
        val = result["value"]
        if val != "undefined" and val != "":
            print(f"\033[32m=> {val}\033[0m")

def check_status() -> bool:
    """Check if kserver is running and device is connected."""
    try:
        req = urllib.request.Request(f"{SERVER}/status")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("connected"):
                print(f"\033[32m[+] Device connected  kernel_base={data.get('kernelBase')}  slide={data.get('kernelSlide')}  pid={data.get('pid')}\033[0m")
                return True
            else:
                print(f"\033[93m[*] Server running but no device connected\033[0m")
                return False
    except:
        print(f"\033[91m[-] kserver not running. Start it with: python3 tools/kserver.py &\033[0m")
        return False

def interactive():
    """Interactive REPL mode."""
    # Load history
    try:
        readline.read_history_file(HISTORY_FILE)
    except FileNotFoundError:
        pass

    if not check_status():
        return

    print("Type JS commands. Use .load <file> to run scripts. Ctrl+D to exit.\n")

    multiline = ""
    while True:
        try:
            prompt = "krepl> " if not multiline else "  ...> "
            line = input(prompt)
        except (EOFError, KeyboardInterrupt):
            print()
            break

        # Multi-line support
        if line.strip().startswith("{") and "}" not in line:
            multiline = line + "\n"
            continue
        if multiline:
            multiline += line + "\n"
            if line.strip() == "}":
                line = multiline
                multiline = ""
            else:
                continue

        line = line.strip()
        if not line:
            continue

        # Dot commands
        if line.startswith(".load "):
            filepath = line[6:].strip()
            try:
                with open(filepath) as f:
                    code = f.read()
                result = send_command(code, timeout=120)
                print_result(result)
            except FileNotFoundError:
                print(f"\033[91mFile not found: {filepath}\033[0m")
            continue

        if line in (".status", ".s"):
            check_status()
            continue

        if line in (".quit", ".exit", ".q"):
            break

        if line.startswith(".upload "):
            # .upload <local_path> <remote_path>
            parts = line[8:].strip().split(None, 1)
            if len(parts) != 2:
                print("\033[91mUsage: .upload <local_file> <remote_path>\033[0m")
                continue
            local_path, remote_path = parts
            try:
                import base64
                with open(local_path, "rb") as f:
                    file_data = f.read()
                b64 = base64.b64encode(file_data).decode("ascii")
                print(f"\033[36mUploading {len(file_data)} bytes → {remote_path}...\033[0m")
                data = json.dumps({"path": remote_path, "data": b64}).encode("utf-8")
                req = urllib.request.Request(
                    f"{SERVER}/upload", data=data,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                print_result(result)
            except FileNotFoundError:
                print(f"\033[91mFile not found: {local_path}\033[0m")
            except Exception as e:
                print(f"\033[91mUpload error: {e}\033[0m")
            continue

        if line.startswith(".rcall "):
            # .rcall <func_name> [arg1] [arg2] ...
            parts = line[7:].strip().split()
            if not parts:
                print("\033[91mUsage: .rcall <func_name> [args...]\033[0m")
                continue
            func_name = parts[0]
            args = []
            for a in parts[1:]:
                args.append(int(a, 0))  # supports hex (0x...) and decimal
            try:
                data = json.dumps({"func": func_name, "args": args}).encode("utf-8")
                req = urllib.request.Request(
                    f"{SERVER}/rcall", data=data,
                    headers={"Content-Type": "application/json"}, method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                print_result(result)
            except Exception as e:
                print(f"\033[91mrcall error: {e}\033[0m")
            continue

        if line == ".help":
            print("Commands:")
            print("  .load <file>                  — execute JS script file")
            print("  .upload <local> <remote>       — upload file to device (root)")
            print("  .rcall <func> [args...]        — call C function in launchd (root)")
            print("  .status / .s                   — check device connection")
            print("  .quit / .q                     — exit")
            print("  <js code>                      — execute JS in kernel REPL")
            continue

        # Regular JS command
        readline.add_history(line)
        result = send_command(line)
        print_result(result)

    # Save history
    try:
        readline.set_history_length(2000)
        readline.write_history_file(HISTORY_FILE)
    except:
        pass

def main():
    if len(sys.argv) == 1:
        interactive()
    elif sys.argv[1] == "-e":
        code = " ".join(sys.argv[2:])
        result = send_command(code)
        print_result(result)
        sys.exit(1 if result.get("error") else 0)
    else:
        # File mode
        filepath = sys.argv[1]
        try:
            with open(filepath) as f:
                code = f.read()
        except FileNotFoundError:
            print(f"File not found: {filepath}")
            sys.exit(1)
        result = send_command(code, timeout=120)
        print_result(result)
        sys.exit(1 if result.get("error") else 0)

if __name__ == "__main__":
    main()
