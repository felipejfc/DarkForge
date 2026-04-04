#!/usr/bin/env python3
"""
kserver.py - WebSocket server for kernel exploitation REPL.

Listens on port 9090 for a WebSocket connection from the iPhone app,
then provides an interactive JS REPL.

Usage:
    python3 kserver.py                    # interactive REPL (JSCBridge mode)
    python3 kserver.py repl               # same as above, explicit
    python3 kserver.py script.js          # execute script, print result, exit
    python3 kserver.py -e "kread64(x)"   # execute one-liner

In REPL mode, JS code is evaluated in the target process's JSContext
via JSCBridge. Available APIs: Native.callSymbol(), Native.read/write(),
FileUtils, log(), and the full DarkForge loader environment.
"""

import argparse
import asyncio
import base64
import json
import mimetypes
import os
import readline
import re
import signal
import sys
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import websockets
    from websockets.asyncio.server import serve
except ImportError:
    print("Error: 'websockets' library is required.  pip3 install websockets")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_WS_PORT = 9090
DEFAULT_AGENT_PORT = 9091
DEFAULT_HTTP_PORT = 9092
PORT = DEFAULT_WS_PORT
AGENT_PORT = DEFAULT_AGENT_PORT
HTTP_PORT = DEFAULT_HTTP_PORT  # HTTP API port for krepl.py to send commands
LOG_PATH = Path("/tmp/krepl-logs.txt")
SERVER_LOG_LIMIT = 4000
EXEC_TIMEOUT = 60  # seconds per exec command
CONNECT_TIMEOUT = 120  # seconds to wait for initial connection
AGENT_PING_INTERVAL = 10  # seconds between heartbeat pings
AGENT_PONG_TIMEOUT = 25  # seconds without inbound agent traffic before eviction
TOOLS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TOOLS_DIR.parent

# When frozen by PyInstaller, bundled data lives under sys._MEIPASS.
# Env vars DARKFORGE_WEBUI_DIR / DARKFORGE_SKILLS_DIR override both.
_FROZEN_ROOT = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else None


def _resolve_asset_dir(env_var: str, frozen_subdir: str, default: Path) -> Path:
    override = os.environ.get(env_var)
    if override:
        return Path(override).resolve()
    if _FROZEN_ROOT is not None:
        return (_FROZEN_ROOT / frozen_subdir).resolve()
    return default


WEB_UI_DIR = _resolve_asset_dir("DARKFORGE_WEBUI_DIR", "webui", TOOLS_DIR / "webui")
SKILLS_DIR = _resolve_asset_dir("DARKFORGE_SKILLS_DIR", "skills", PROJECT_DIR / "skills")
CONTROL_ROOT = "/var/mobile/Media/DarkForge/Control"
DEFAULT_SKILL_RUNTIME = "jscbridge"
VALID_SKILL_RUNTIMES = {DEFAULT_SKILL_RUNTIME}
VALID_SKILL_INPUT_TYPES = {"text", "boolean", "select", "app"}
VALID_SKILL_EXECUTION_MODES = {"interactive", "job"}

# ---------------------------------------------------------------------------
# ANSI colours
# ---------------------------------------------------------------------------

class C:
    GREEN = "\033[92m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    YELLOW = "\033[93m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_log_file = None


def _append_server_log(msg: str):
    state.server_logs.append(msg)
    try:
        asyncio.ensure_future(_broadcast_event("server-log", {"msg": msg}))
    except RuntimeError:
        pass

def _open_log():
    global _log_file
    _log_file = open(LOG_PATH, "a", encoding="utf-8")
    _log_file.write("\n")
    _log("=" * 60)
    _log(f"Session started at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    _log("=" * 60)

def _log(msg: str):
    _append_server_log(msg)
    if _log_file:
        _log_file.write(msg + "\n")
        _log_file.flush()

def _close_log():
    if _log_file and not _log_file.closed:
        _log(f"Session ended at {time.strftime('%Y-%m-%d %H:%M:%S')}")
        _log_file.close()

# ---------------------------------------------------------------------------
# Pretty printing helpers
# ---------------------------------------------------------------------------

def _print_result(value: str):
    for line in value.splitlines():
        print(f"{C.GREEN}{line}{C.RESET}")

def _print_error(msg: str):
    for line in msg.splitlines():
        print(f"{C.RED}{line}{C.RESET}")

def _print_log(msg: str):
    for line in msg.splitlines():
        print(f"{C.CYAN}  [log] {line}{C.RESET}")
    try:
        asyncio.ensure_future(_broadcast_event("log", {"msg": msg}))
    except RuntimeError:
        pass

def _print_info(msg: str):
    print(f"{C.DIM}{msg}{C.RESET}")

def _print_status(msg: str):
    print(f"{C.YELLOW}{C.BOLD}{msg}{C.RESET}")


def _parse_port(value: str) -> int:
    try:
        port = int(value, 10)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid port: {value}") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError(f"Port must be between 1 and 65535: {value}")
    return port


def _parse_args(argv: list[str]) -> tuple[str, str | None, int, int, int]:
    parser = argparse.ArgumentParser(description="DarkForge host bridge server")
    parser.add_argument("mode_or_script", nargs="?", default="repl")
    parser.add_argument(
        "-d",
        "--daemon",
        action="store_true",
        help="Run without the interactive REPL (HTTP + WS only)",
    )
    parser.add_argument(
        "-e",
        "--eval",
        dest="eval_code",
        help="Execute one line of JavaScript and exit",
    )
    parser.add_argument(
        "--ws-port",
        type=_parse_port,
        default=DEFAULT_WS_PORT,
        help=f"WebSocket port for the app bridge (default: {DEFAULT_WS_PORT})",
    )
    parser.add_argument(
        "--agent-port",
        type=_parse_port,
        default=DEFAULT_AGENT_PORT,
        help=f"TCP port for the launchd agent bridge (default: {DEFAULT_AGENT_PORT})",
    )
    parser.add_argument(
        "--http-port",
        type=_parse_port,
        default=DEFAULT_HTTP_PORT,
        help=f"HTTP API + web UI port (default: {DEFAULT_HTTP_PORT})",
    )

    args = parser.parse_args(argv)
    if len({args.ws_port, args.agent_port, args.http_port}) != 3:
        parser.error("--ws-port, --agent-port, and --http-port must be distinct")

    mode = "repl"
    script_code = None
    target = args.mode_or_script

    if args.eval_code is not None:
        if target not in ("repl", ""):
            parser.error("Cannot combine -e/--eval with a script path")
        mode = "script"
        script_code = args.eval_code
    elif args.daemon:
        if target not in ("repl", ""):
            parser.error("Cannot combine --daemon with a script path")
        mode = "daemon"
    elif target != "repl":
        fpath = Path(target).expanduser().resolve()
        if not fpath.exists():
            parser.error(f"File not found: {fpath}")
        mode = "script"
        script_code = fpath.read_text(encoding="utf-8")

    return mode, script_code, args.ws_port, args.agent_port, args.http_port

# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

HISTORY_PATH = Path.home() / ".krepl_history"

def _load_history():
    if HISTORY_PATH.exists():
        try:
            readline.read_history_file(str(HISTORY_PATH))
        except OSError:
            pass
    readline.set_history_length(2000)

def _save_history():
    try:
        readline.write_history_file(str(HISTORY_PATH))
    except OSError:
        pass

# ---------------------------------------------------------------------------
# Server state
# ---------------------------------------------------------------------------

class ServerState:
    def __init__(self):
        self.ws = None
        self.connected = asyncio.Event()
        self.disconnected = asyncio.Event()
        self.pending: dict[str, asyncio.Future] = {}
        self.bulk_pending: dict[str, dict] = {}
        self.agent_reader: asyncio.StreamReader | None = None
        self.agent_writer: asyncio.StreamWriter | None = None
        self.agent_pending: dict[str, asyncio.Future] = {}
        self.agent_bulk_pending: dict[str, dict] = {}
        self.agent_connected = asyncio.Event()
        self.agent_role: str | None = None
        self.agent_host: str | None = None
        self.agent_pid: int | None = None
        self.agent_bootstrap_task: asyncio.Task | None = None
        self.agent_heartbeat_task: asyncio.Task | None = None
        self.agent_last_seen_monotonic: float | None = None
        self.agent_last_pong_at: str | None = None
        self.agent_worker_ready: bool = False
        self.agent_supports_bulk: bool = False
        self.agent_supports_async: bool = False
        self.agent_inline_limit: int | None = None
        self.agent_bulk_chunk_size: int | None = None
        self.agent_bulk_max: int | None = None
        self.agent_send_lock = asyncio.Lock()
        self.agent_active_jobs: set[str] = set()
        self.server_url: str | None = None
        self.server_address: str | None = None
        self.browser_clients: set[asyncio.StreamWriter] = set()
        self.server_logs: deque[str] = deque(maxlen=SERVER_LOG_LIMIT)
        self.jobs: dict[str, dict] = {}
        self.kernel_base: str | None = None
        self.kernel_slide: str | None = None
        self.pid: int | None = None
        self.ready = asyncio.Event()
        self.watch_task: asyncio.Task | None = None
        self.watch_path: str | None = None
        self.running = True

    def reset(self):
        self.ws = None
        self.ready.clear()
        self.kernel_base = None
        self.kernel_slide = None
        self.pid = None
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(ConnectionError("Client disconnected"))
        self.pending.clear()
        self.bulk_pending.clear()
        self._refresh_connectivity()

    def reset_agent(self):
        if self.agent_heartbeat_task and not self.agent_heartbeat_task.done():
            self.agent_heartbeat_task.cancel()
        self.agent_reader = None
        self.agent_writer = None
        self.agent_role = None
        self.agent_host = None
        self.agent_pid = None
        self.agent_heartbeat_task = None
        self.agent_last_seen_monotonic = None
        self.agent_last_pong_at = None
        self.agent_worker_ready = False
        self.agent_supports_bulk = False
        self.agent_supports_async = False
        self.agent_inline_limit = None
        self.agent_bulk_chunk_size = None
        self.agent_bulk_max = None
        self.agent_connected.clear()
        for fut in self.agent_pending.values():
            if not fut.done():
                fut.set_exception(ConnectionError("Agent disconnected"))
        self.agent_pending.clear()
        self.agent_bulk_pending.clear()
        self.agent_active_jobs.clear()
        self._refresh_connectivity()

    def _refresh_connectivity(self):
        if (self.ws is not None and self.ready.is_set()) or self.agent_connected.is_set():
            self.connected.set()
            self.disconnected.clear()
        else:
            self.connected.clear()
            self.disconnected.set()

state = ServerState()

# ---------------------------------------------------------------------------
# WebSocket message handling
# ---------------------------------------------------------------------------

def _make_exec_msg(code: str, runtime: str | None = None) -> tuple[str, str]:
    """Build an exec message and return (msg_id, json_str)."""
    msg_id = str(uuid.uuid4())
    payload = {"type": "exec", "id": msg_id, "code": code}
    if runtime:
        payload["runtime"] = runtime
    return msg_id, json.dumps(payload)

def _parse_bulk_frame(raw: bytes) -> tuple[dict, bytes] | None:
    if len(raw) < 4:
        return None
    header_len = int.from_bytes(raw[:4], "big")
    if header_len <= 0 or 4 + header_len > len(raw):
        return None
    header_bytes = raw[4:4 + header_len]
    payload = raw[4 + header_len:]
    try:
        header = json.loads(header_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return header, payload


def _finalize_bulk_message(msg_id: str, data: bytes):
    pending = state.bulk_pending.pop(msg_id, None)
    if not pending:
        return

    msg = pending["msg"]
    encoding = pending["encoding"]
    if encoding == "binary":
        msg["value"] = pending.get("summary", f"<binary {len(data)} bytes>")
        msg["binaryBase64"] = base64.b64encode(data).decode("ascii")
        msg["valueEncoding"] = "binary"
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("utf-8", errors="replace")
        if msg.get("type") == "error":
            msg["error"] = text
        else:
            msg["value"] = text
        msg["valueEncoding"] = encoding

    fut = state.pending.pop(msg_id, None)
    if fut and not fut.done():
        fut.set_result(msg)


def _finalize_agent_bulk_message(msg_id: str, data: bytes):
    pending = state.agent_bulk_pending.pop(msg_id, None)
    if not pending:
        return

    msg = pending["msg"]
    encoding = pending["encoding"]
    if encoding == "binary":
        msg["value"] = pending.get("summary", f"<binary {len(data)} bytes>")
        msg["binaryBase64"] = base64.b64encode(data).decode("ascii")
        msg["valueEncoding"] = "binary"
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("utf-8", errors="replace")
        if msg.get("type") == "error":
            msg["error"] = text
        else:
            msg["value"] = text
        msg["valueEncoding"] = encoding

    fut = state.agent_pending.pop(msg_id, None)
    if fut and not fut.done():
        fut.set_result(msg)


async def _handle_bulk_frame(raw: bytes):
    parsed = _parse_bulk_frame(raw)
    if not parsed:
        _print_error("Invalid binary frame from device")
        return

    header, payload = parsed
    if header.get("type") != "bulk_chunk":
        _print_info(f"Unknown binary frame type: {header.get('type')}")
        return

    msg_id = header.get("id")
    pending = state.bulk_pending.get(msg_id)
    if not msg_id or not pending:
        _print_error("Unexpected bulk chunk with no pending transfer")
        return

    def _fail(message: str):
        _print_error(message)
        state.bulk_pending.pop(msg_id, None)
        fut = state.pending.pop(msg_id, None)
        if fut and not fut.done():
            fut.set_result({"type": "error", "id": msg_id, "error": message, "logs": pending["msg"].get("logs", [])})

    offset_value = header.get("offset", -1)
    chunk_length_value = header.get("chunkLength", len(payload))
    total_length_value = header.get("totalLength", pending["total_length"])
    offset = int(offset_value if offset_value is not None else -1)
    chunk_length = int(chunk_length_value if chunk_length_value is not None else len(payload))
    total_length = int(total_length_value if total_length_value is not None else pending["total_length"])
    eof = bool(header.get("eof", False))

    if offset != len(pending["buffer"]):
        _fail(f"Bulk chunk offset mismatch for {msg_id}: expected {len(pending['buffer'])}, got {offset}")
        return
    if chunk_length != len(payload):
        _fail(f"Bulk chunk length mismatch for {msg_id}: declared {chunk_length}, got {len(payload)}")
        return
    if total_length != pending["total_length"]:
        _fail(f"Bulk total length mismatch for {msg_id}: expected {pending['total_length']}, got {total_length}")
        return

    pending["buffer"].extend(payload)
    if eof or len(pending["buffer"]) >= pending["total_length"]:
        data = bytes(pending["buffer"])
        if len(data) != pending["total_length"]:
            _fail(f"Bulk transfer size mismatch for {msg_id}: expected {pending['total_length']}, got {len(data)}")
            return
        _finalize_bulk_message(msg_id, data)


async def _handle_message(raw: str):
    """Process a single incoming message from the device."""
    _log(f"<< {raw[:2000]}")
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        _print_error(f"Invalid JSON from device: {raw[:200]}")
        return

    msg_type = msg.get("type")

    if msg_type in ("ready", "hello"):
        state.kernel_base = msg.get("kernelBase", "?")
        state.kernel_slide = msg.get("kernelSlide", "?")
        state.pid = msg.get("pid", "?")
        state.server_url = msg.get("serverURL") or state.server_url
        state.server_address = msg.get("serverAddress") or state.server_address or _parse_server_host(state.server_url)
        state.ready.set()
        state._refresh_connectivity()
        _print_status(f"\n[*] Device ready  kernel_base={state.kernel_base}  slide={state.kernel_slide}  pid={state.pid}")
        _log(f"READY kernel_base={state.kernel_base} slide={state.kernel_slide} pid={state.pid}")
        asyncio.create_task(_emit_status_event())

    elif msg_type in ("result", "error"):
        msg_id = msg.get("id")
        for log_line in msg.get("logs", []):
            _print_log(str(log_line))
            _log(f"LOG: {log_line}")

        transfer = msg.get("transfer") or {}
        if transfer.get("mode") == "bulk":
            total_length = int(transfer.get("totalLength", 0) or 0)
            state.bulk_pending[msg_id] = {
                "msg": msg,
                "encoding": transfer.get("encoding", msg.get("encoding", "utf8")),
                "total_length": total_length,
                "summary": msg.get("value") or msg.get("error") or transfer.get("summary"),
                "buffer": bytearray(),
            }
            return

        fut = state.pending.pop(msg_id, None)
        if fut and not fut.done():
            fut.set_result(msg)

    elif msg_type == "log":
        log_msg = msg.get("msg", "")
        _print_log(log_msg)
        _log(f"LOG: {log_msg}")

    else:
        _print_info(f"Unknown message type: {msg_type}")

# ---------------------------------------------------------------------------
# Browser events + agent transport
# ---------------------------------------------------------------------------

async def _broadcast_event(event: str, payload: dict):
    if not state.browser_clients:
        return
    frame = f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    dead_clients = []
    for writer in tuple(state.browser_clients):
        try:
            writer.write(frame)
            await writer.drain()
        except Exception:
            dead_clients.append(writer)
    for writer in dead_clients:
        state.browser_clients.discard(writer)
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def _emit_status_event():
    await _broadcast_event("status", _status_payload())


async def _emit_job_event(job: dict):
    await _broadcast_event("job", _job_payload(job))


async def _emit_server_log_reset_event():
    await _broadcast_event("server-log-reset", {"cleared": True})


def _upsert_job(job_id: str, **changes) -> dict:
    now = _utc_now_iso()
    job = state.jobs.get(job_id)
    if job is None:
        job = {
            "jobId": job_id,
            "status": "queued",
            "createdAt": now,
            "startedAt": None,
            "finishedAt": None,
            "logs": [],
            "artifactPaths": [],
        }
        state.jobs[job_id] = job
    job.update({key: value for key, value in changes.items() if value is not None})
    return job


async def _read_agent_frame(reader: asyncio.StreamReader) -> tuple[str, dict | bytes]:
    header = await reader.readexactly(4)
    if header in {b"GET ", b"POST", b"HEAD", b"PUT ", b"OPTI"}:
        raise ValueError(f"Received HTTP on agent port {AGENT_PORT}; use HTTP port {HTTP_PORT}")
    length = int.from_bytes(header, "big")
    if length <= 0 or length > 16 * 1024 * 1024:
        raise ValueError(f"Invalid agent frame length: {length}")
    payload = await reader.readexactly(length)
    stripped = payload.lstrip()
    if stripped[:1] in {b"{", b"["}:
        return "json", json.loads(payload.decode("utf-8"))
    return "binary", payload


async def _send_agent_frame(payload: dict):
    if not state.agent_writer:
        raise ConnectionError("launchd agent is not connected")
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    frame = len(raw).to_bytes(4, "big") + raw
    async with state.agent_send_lock:
        if not state.agent_writer:
            raise ConnectionError("launchd agent is not connected")
        state.agent_writer.write(frame)
        await state.agent_writer.drain()


async def _agent_heartbeat_loop(writer: asyncio.StreamWriter):
    try:
        while True:
            await asyncio.sleep(AGENT_PING_INTERVAL)
            if state.agent_writer is not writer:
                return

            last_seen = state.agent_last_seen_monotonic or time.monotonic()
            idle_for = time.monotonic() - last_seen
            if idle_for > AGENT_PONG_TIMEOUT:
                if state.agent_pending or state.agent_bulk_pending or state.agent_active_jobs:
                    _log(f"AGENT HEARTBEAT BUSY-SUPPRESS idle={idle_for:.1f}s pending={len(state.agent_pending)} bulk={len(state.agent_bulk_pending)} jobs={len(state.agent_active_jobs)}")
                    continue
                _print_status(f"\n[-] launchd agent heartbeat timed out after {idle_for:.1f}s")
                _log(f"AGENT HEARTBEAT TIMEOUT after {idle_for:.1f}s")
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass
                return

            await _send_agent_frame({
                "type": "ping",
                "ts": _utc_now_iso(),
            })
    except asyncio.CancelledError:
        return
    except Exception as error:
        _log(f"AGENT HEARTBEAT ERROR: {error}")
        if state.agent_writer is writer:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


def _parse_server_host(url_value: str | None) -> str:
    parsed = urlparse(url_value or "")
    return (parsed.hostname or "").strip()


async def _ensure_remote_agent():
    return


async def _ensure_remote_agent_ready(timeout: float = 15) -> bool:
    if _has_agent_runtime():
        return True
    if not _has_app_runtime():
        return False
    try:
        await asyncio.wait_for(state.agent_connected.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        return False
    return _has_agent_runtime()


# ---------------------------------------------------------------------------
# Send code and wait for result
# ---------------------------------------------------------------------------

async def _send_app_message(message: dict, timeout: float) -> dict | None:
    if not state.ws:
        _print_error("Not connected to device.")
        return None

    msg_id = str(message.get("id") or uuid.uuid4())
    message["id"] = msg_id
    payload = json.dumps(message)
    _log(f">> {payload[:2000]}")
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    state.pending[msg_id] = fut

    try:
        await state.ws.send(payload)
    except Exception as e:
        state.pending.pop(msg_id, None)
        _print_error(f"Send failed: {e}")
        return None

    try:
        result = await asyncio.wait_for(fut, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        state.pending.pop(msg_id, None)
        state.bulk_pending.pop(msg_id, None)
        _print_error(f"Timeout after {timeout}s waiting for result.")
        return None
    except ConnectionError as e:
        state.bulk_pending.pop(msg_id, None)
        _print_error(str(e))
        return None


async def _exec_via_app_ws(code: str, timeout: float, runtime: str | None = None) -> dict | None:
    msg_id, payload = _make_exec_msg(code, runtime=runtime)
    message = json.loads(payload)
    message["id"] = msg_id
    return await _send_app_message(message, timeout=timeout)


async def _exec_via_agent(code: str, timeout: float) -> dict | None:
    if not _has_agent_runtime():
        return None

    msg_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    state.agent_pending[msg_id] = fut

    try:
        await _send_agent_frame({"type": "exec", "id": msg_id, "code": code})
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        state.agent_pending.pop(msg_id, None)
        state.agent_bulk_pending.pop(msg_id, None)
        _print_error(f"Timeout after {timeout}s waiting for agent exec.")
        return None
    except ConnectionError as e:
        state.agent_pending.pop(msg_id, None)
        state.agent_bulk_pending.pop(msg_id, None)
        _print_error(str(e))
        return None


async def exec_code(code: str, timeout: float = EXEC_TIMEOUT, runtime: str | None = None, *, prefer_agent: bool = True, target: str | None = None) -> dict | None:
    """Send code to the preferred device runtime and wait for the result.

    target: "agent" forces launchd agent, "bridge" forces app WebSocket,
            None / "auto" uses the default prefer_agent heuristic.
    """
    if target == "agent":
        if _has_agent_runtime():
            return await _exec_via_agent(code, timeout)
        _print_error("launchd agent is not connected.")
        return None
    if target == "bridge":
        if _has_app_runtime():
            return await _exec_via_app_ws(code, timeout, runtime=runtime)
        _print_error("App bridge is not connected.")
        return None
    # Auto: original heuristic
    if prefer_agent and runtime == DEFAULT_SKILL_RUNTIME and _has_agent_runtime():
        return await _exec_via_agent(code, timeout)
    if _has_app_runtime():
        return await _exec_via_app_ws(code, timeout, runtime=runtime)
    if _has_agent_runtime():
        return await _exec_via_agent(code, timeout)
    _print_error("Not connected to device.")
    return None


async def _submit_job_to_agent(job: dict):
    if not await _ensure_remote_agent_ready():
        raise ConnectionError("launchd agent is not connected")
    state.agent_active_jobs.add(job["jobId"])
    try:
        await _send_agent_frame({
            "type": "job_submit",
            "jobId": job["jobId"],
            "skillId": job.get("skillId", ""),
            "name": job.get("name", ""),
            "createdAt": job.get("createdAt"),
            "code": job.get("code", ""),
        })
    except Exception:
        state.agent_active_jobs.discard(job["jobId"])
        raise


async def _handle_agent_bulk_frame(raw: bytes):
    parsed = _parse_bulk_frame(raw)
    if not parsed:
        _print_error("Invalid binary frame from launchd agent")
        return

    header, payload = parsed
    if header.get("type") != "bulk_chunk":
        _print_info(f"Unknown agent binary frame type: {header.get('type')}")
        return

    msg_id = str(header.get("id") or "")
    pending = state.agent_bulk_pending.get(msg_id)
    if not msg_id or not pending:
        _print_error("Unexpected agent bulk chunk with no pending transfer")
        return

    def _fail(message: str):
        _print_error(message)
        state.agent_bulk_pending.pop(msg_id, None)
        fut = state.agent_pending.pop(msg_id, None)
        if fut and not fut.done():
            fut.set_result({"type": "error", "id": msg_id, "error": message, "logs": pending["msg"].get("logs", [])})

    offset = int(header.get("offset", -1) if header.get("offset", -1) is not None else -1)
    chunk_length = int(header.get("chunkLength", len(payload)) if header.get("chunkLength", len(payload)) is not None else len(payload))
    total_length = int(header.get("totalLength", pending["total_length"]) if header.get("totalLength", pending["total_length"]) is not None else pending["total_length"])
    eof = bool(header.get("eof", False))

    if offset != len(pending["buffer"]):
        _fail(f"Agent bulk chunk offset mismatch for {msg_id}: expected {len(pending['buffer'])}, got {offset}")
        return
    if chunk_length != len(payload):
        _fail(f"Agent bulk chunk length mismatch for {msg_id}: declared {chunk_length}, got {len(payload)}")
        return
    if total_length != pending["total_length"]:
        _fail(f"Agent bulk total length mismatch for {msg_id}: expected {pending['total_length']}, got {total_length}")
        return

    pending["buffer"].extend(payload)
    if eof or len(pending["buffer"]) >= pending["total_length"]:
        data = bytes(pending["buffer"])
        if len(data) != pending["total_length"]:
            _fail(f"Agent bulk transfer size mismatch for {msg_id}: expected {pending['total_length']}, got {len(data)}")
            return
        _finalize_agent_bulk_message(msg_id, data)


async def _handle_agent_message(msg: dict):
    msg_type = msg.get("type")
    state.agent_last_seen_monotonic = time.monotonic()
    if msg_type == "hello":
        state.agent_role = str(msg.get("role") or "launchd-agent")
        if not state.agent_host:
            state.agent_host = "launchd-agent"
        state.agent_pid = msg.get("pid")
        state.agent_worker_ready = bool(msg.get("workerReady", False))
        state.agent_supports_bulk = bool(msg.get("supportsBulk", False))
        state.agent_supports_async = bool(msg.get("supportsAsync", False))
        state.agent_inline_limit = int(msg.get("inlineLimit", 0) or 0) or None
        state.agent_bulk_chunk_size = int(msg.get("bulkChunkSize", 0) or 0) or None
        state.agent_bulk_max = int(msg.get("bulkMax", 0) or 0) or None
        state.agent_last_pong_at = _utc_now_iso()
        state.agent_connected.set()
        state._refresh_connectivity()
        await _emit_status_event()
        return

    if msg_type == "pong":
        state.agent_last_pong_at = str(msg.get("ts") or _utc_now_iso())
        return

    if msg_type == "ping":
        await _send_agent_frame({"type": "pong", "ts": _utc_now_iso()})
        return

    if msg_type == "exec_result":
        msg_id = str(msg.get("id") or "")
        transfer = msg.get("transfer") or {}
        payload = {
            "type": "result" if msg.get("ok") else "error",
            "id": msg.get("id"),
            "value": msg.get("value", ""),
            "error": msg.get("error", ""),
            "logs": msg.get("logs", []),
            "encoding": msg.get("encoding", "utf8"),
        }
        if transfer.get("mode") == "bulk":
            total_length = int(transfer.get("totalLength", 0) or 0)
            state.agent_bulk_pending[msg_id] = {
                "msg": payload,
                "encoding": transfer.get("encoding", msg.get("encoding", "utf8")),
                "total_length": total_length,
                "summary": msg.get("value") or msg.get("error") or transfer.get("summary"),
                "buffer": bytearray(),
            }
            return
        fut = state.agent_pending.pop(msg_id, None)
        if fut and not fut.done():
            fut.set_result(payload)
        return

    job_id = str(msg.get("jobId") or "").strip()
    if not job_id:
        return

    if msg_type == "job_update":
        job = _upsert_job(job_id, status=msg.get("status", "running"), startedAt=msg.get("startedAt"))
        log_line = msg.get("log")
        if log_line:
            job.setdefault("logs", []).append(str(log_line))
        await _emit_job_event(job)
        await _emit_status_event()
        return

    if msg_type == "job_result":
        state.agent_active_jobs.discard(job_id)
        job = _upsert_job(
            job_id,
            status=msg.get("status", "completed"),
            finishedAt=msg.get("finishedAt") or _utc_now_iso(),
            result=msg.get("result"),
            reportPath=msg.get("reportPath"),
            artifactPaths=list(msg.get("artifactPaths", []) or []),
        )
        await _emit_job_event(job)
        await _emit_status_event()
        return

    if msg_type == "job_error":
        state.agent_active_jobs.discard(job_id)
        job = _upsert_job(
            job_id,
            status=msg.get("status", "failed"),
            finishedAt=msg.get("finishedAt") or _utc_now_iso(),
            error=msg.get("error"),
        )
        await _emit_job_event(job)
        await _emit_status_event()


async def _agent_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    remote = writer.get_extra_info("peername")
    _print_status(f"\n[+] launchd agent connected from {remote}")
    _log(f"AGENT CONNECTED from {remote}")

    if state.agent_writer is not None:
        try:
            state.agent_writer.close()
            await state.agent_writer.wait_closed()
        except Exception:
            pass

    state.agent_reader = reader
    state.agent_writer = writer
    state.agent_host = str(remote)
    state.agent_last_seen_monotonic = time.monotonic()
    state.agent_last_pong_at = _utc_now_iso()
    state.agent_heartbeat_task = asyncio.create_task(_agent_heartbeat_loop(writer))

    try:
        while True:
            frame_kind, frame = await _read_agent_frame(reader)
            if frame_kind == "binary":
                await _handle_agent_bulk_frame(frame)
            else:
                await _handle_agent_message(frame)
    except (asyncio.IncompleteReadError, ConnectionError, ValueError) as e:
        _print_status(f"\n[-] launchd agent disconnected: {e}")
        _log(f"AGENT DISCONNECTED: {e}")
    except Exception as e:
        _print_error(f"\nAgent connection error: {e}")
        _log(f"AGENT CONNECTION ERROR: {e}")
    finally:
        if state.agent_writer is writer:
            state.reset_agent()
            await _emit_status_event()
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

def _display_result(result: dict | None):
    """Pretty-print a result dict."""
    if result is None:
        return
    error = result.get("error")
    if error:
        _print_error(f"Error: {error}")
        _log(f"ERROR: {error}")
    else:
        value = result.get("value", "")
        if value:
            _print_result(str(value))
            _log(f"RESULT: {value}")

# ---------------------------------------------------------------------------
# .load / .watch commands
# ---------------------------------------------------------------------------

async def _load_file(path: str):
    """Read a JS file and send it for execution."""
    resolved = Path(path).expanduser().resolve()
    if not resolved.exists():
        _print_error(f"File not found: {resolved}")
        return
    code = resolved.read_text(encoding="utf-8")
    _print_info(f"Sending {resolved} ({len(code)} bytes)...")
    result = await exec_code(code, timeout=EXEC_TIMEOUT * 2)
    _display_result(result)

async def _watch_file(path: str):
    """Watch a file and re-execute on changes."""
    resolved = Path(path).expanduser().resolve()
    if not resolved.exists():
        _print_error(f"File not found: {resolved}")
        return

    # Cancel previous watch if any
    if state.watch_task and not state.watch_task.done():
        state.watch_task.cancel()
        try:
            await state.watch_task
        except asyncio.CancelledError:
            pass

    state.watch_path = str(resolved)
    _print_info(f"Watching {resolved} for changes...")

    async def _watcher():
        last_mtime = resolved.stat().st_mtime
        while True:
            await asyncio.sleep(0.5)
            try:
                mtime = resolved.stat().st_mtime
            except FileNotFoundError:
                _print_error(f"Watch target disappeared: {resolved}")
                return
            if mtime != last_mtime:
                last_mtime = mtime
                _print_info(f"\n[reload] {resolved.name} changed, re-executing...")
                code = resolved.read_text(encoding="utf-8")
                result = await exec_code(code, timeout=EXEC_TIMEOUT * 2)
                _display_result(result)
                # Re-print prompt hint
                print(f"{C.DIM}krepl>{C.RESET} ", end="", flush=True)

    state.watch_task = asyncio.get_running_loop().create_task(_watcher())

# ---------------------------------------------------------------------------
# WebSocket connection handler
# ---------------------------------------------------------------------------

async def _ws_handler(ws):
    """Handle a single WebSocket connection."""
    remote = ws.remote_address
    _print_status(f"\n[+] Device connected from {remote}")
    _log(f"CONNECTED from {remote}")

    if state.ws is not None:
        _print_info("Replacing previous connection.")
        try:
            await state.ws.close()
        except Exception:
            pass

    state.ws = ws
    state._refresh_connectivity()
    await _emit_status_event()

    try:
        async for raw in ws:
            if isinstance(raw, bytes):
                await _handle_bulk_frame(raw)
            else:
                await _handle_message(raw)
    except websockets.exceptions.ConnectionClosed as e:
        _print_status(f"\n[-] Device disconnected: {e}")
        _log(f"DISCONNECTED: {e}")
    except Exception as e:
        _print_error(f"\nConnection error: {e}")
        _log(f"CONNECTION ERROR: {e}")
    finally:
        if state.ws is ws:
            state.reset()
            _print_status("[-] Connection lost. Waiting for reconnect...")
            print(f"{C.DIM}krepl>{C.RESET} ", end="", flush=True)
            await _emit_status_event()

# ---------------------------------------------------------------------------
# REPL input reader (runs in executor to avoid blocking the event loop)
# ---------------------------------------------------------------------------

def _read_line(prompt: str) -> str | None:
    """Blocking readline call, intended to run in a thread executor."""
    try:
        return input(prompt)
    except EOFError:
        return None
    except KeyboardInterrupt:
        print()
        return ""

async def _async_input(prompt: str) -> str | None:
    """Read a line from stdin without blocking the event loop."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _read_line, prompt)


def _needs_more_input(code: str) -> bool:
    """Heuristic check for incomplete multi-line JavaScript input."""
    if not code.strip():
        return False
    if code.rstrip().endswith("\\"):
        return True

    stack: list[str] = []
    in_single = False
    in_double = False
    in_template = False
    in_line_comment = False
    in_block_comment = False
    escape = False

    pairs = {"(": ")", "[": "]", "{": "}"}
    closers = {")", "]", "}"}

    i = 0
    while i < len(code):
        ch = code[i]
        nxt = code[i + 1] if i + 1 < len(code) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        if in_single:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == "'":
                in_single = False
            i += 1
            continue

        if in_double:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_double = False
            i += 1
            continue

        if in_template:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == "`":
                in_template = False
            i += 1
            continue

        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue

        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        if ch == "'":
            in_single = True
        elif ch == '"':
            in_double = True
        elif ch == "`":
            in_template = True
        elif ch in pairs:
            stack.append(pairs[ch])
        elif ch in closers:
            if stack and stack[-1] == ch:
                stack.pop()
            else:
                return False
        i += 1

    return bool(stack or in_single or in_double or in_template or in_block_comment)

# ---------------------------------------------------------------------------
# Interactive REPL
# ---------------------------------------------------------------------------

async def repl_loop():
    """Main interactive REPL."""
    _load_history()

    _print_status("krepl - JSCBridge REPL")
    _print_info("JS code runs in the target process via JSCBridge.")
    _print_info("Available: Native.callSymbol(), Native.read/write(), FileUtils, log()")
    _print_info("")
    _print_info("Commands:")
    _print_info("  .load <file>    Load and execute a JS file")
    _print_info("  .watch <file>   Watch a file and re-execute on change")
    _print_info("  .unwatch        Stop watching")
    _print_info("  .status         Show connection status")
    _print_info("  .timeout <sec>  Set exec timeout (default 30)")
    _print_info("  .quit / .exit   Exit")
    _print_info("  multi-line JS   Continue entering code while (), [], or {} stay open")
    _print_info("                  Backslash at end of line also continues input")
    _print_info("")

    timeout = EXEC_TIMEOUT

    while state.running:
        try:
            line = await _async_input(f"{C.BOLD}krepl>{C.RESET} ")
        except asyncio.CancelledError:
            break

        if line is None:
            # EOF
            _print_info("\nBye.")
            break

        line_stripped = line.strip()
        if not line_stripped:
            continue

        # -- Dot commands ------------------------------------------------

        if line_stripped in (".quit", ".exit"):
            _print_info("Bye.")
            break

        if line_stripped == ".status":
            if state.ws:
                _print_status(f"[*] Connected  kernel_base={state.kernel_base}  slide={state.kernel_slide}  pid={state.pid}")
            else:
                _print_status("[-] Not connected. Waiting for device...")
            if state.watch_path:
                _print_info(f"  Watching: {state.watch_path}")
            continue

        if line_stripped == ".unwatch":
            if state.watch_task and not state.watch_task.done():
                state.watch_task.cancel()
                _print_info("Watch stopped.")
            else:
                _print_info("Nothing to unwatch.")
            state.watch_path = None
            continue

        if line_stripped.startswith(".timeout"):
            parts = line_stripped.split(None, 1)
            if len(parts) == 2:
                try:
                    timeout = float(parts[1])
                    _print_info(f"Timeout set to {timeout}s")
                except ValueError:
                    _print_error("Usage: .timeout <seconds>")
            else:
                _print_info(f"Current timeout: {timeout}s")
            continue

        if line_stripped.startswith(".load "):
            path = line_stripped[6:].strip()
            if not path:
                _print_error("Usage: .load <file>")
                continue
            if not state.ws:
                _print_error("Not connected to device.")
                continue
            await _load_file(path)
            continue

        if line_stripped.startswith(".watch "):
            path = line_stripped[7:].strip()
            if not path:
                _print_error("Usage: .watch <file>")
                continue
            if not state.ws:
                _print_error("Not connected to device.")
                continue
            await _watch_file(path)
            continue

        # -- Multi-line input --------------------------------------------

        lines = [line]
        code = line
        while _needs_more_input(code):
            mline = await _async_input(f"{C.DIM}  ...>{C.RESET} ")
            if mline is None:
                break
            lines.append(mline)
            code = "\n".join(lines)

        # -- Execute code ------------------------------------------------

        if not state.ws:
            _print_error("Not connected to device. Waiting...")
            continue

        _log(f"EXEC: {code}")
        result = await exec_code(code, timeout=timeout)
        _display_result(result)

    _save_history()

# ---------------------------------------------------------------------------
# Script mode: execute a file and exit
# ---------------------------------------------------------------------------

async def run_script(code: str):
    """Execute code, print result, exit."""
    _print_info(f"Waiting for device connection on port {PORT}...")

    try:
        await asyncio.wait_for(state.connected.wait(), timeout=CONNECT_TIMEOUT)
    except asyncio.TimeoutError:
        _print_error(f"No connection after {CONNECT_TIMEOUT}s, giving up.")
        return 1

    # Wait for ready message
    try:
        await asyncio.wait_for(state.ready.wait(), timeout=30)
    except asyncio.TimeoutError:
        _print_error("Device connected but never sent ready message.")
        return 1

    _print_info(f"Executing ({len(code)} bytes)...")
    result = await exec_code(code, timeout=EXEC_TIMEOUT * 4)
    _display_result(result)

    if result and result.get("error"):
        return 1
    return 0

# ---------------------------------------------------------------------------
# HTTP API server + Web UI
# ---------------------------------------------------------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _has_app_runtime() -> bool:
    return state.ws is not None and state.ready.is_set()


def _has_agent_runtime() -> bool:
    return state.agent_writer is not None and state.agent_connected.is_set()


def _has_remote_runtime() -> bool:
    return _has_agent_runtime() or _has_app_runtime()


def _job_payload(job: dict) -> dict:
    return {
        "jobId": job["jobId"],
        "skillId": job.get("skillId"),
        "name": job.get("name"),
        "runtime": job.get("runtime"),
        "status": job.get("status"),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "result": job.get("result"),
        "error": job.get("error"),
        "logs": list(job.get("logs", [])),
        "reportPath": job.get("reportPath"),
        "artifactPaths": list(job.get("artifactPaths", [])),
        "executionMode": job.get("executionMode", "job"),
    }


def _status_payload() -> dict:
    active_jobs = sum(1 for job in state.jobs.values() if job.get("status") in {"queued", "running"})
    return {
        "connected": _has_remote_runtime(),
        "appConnected": _has_app_runtime(),
        "launchdAgentConnected": _has_agent_runtime(),
        "launchdWorkerReady": state.agent_worker_ready,
        "bootstrapReady": _has_agent_runtime(),
        "transport": "agent" if _has_agent_runtime() else ("app" if _has_app_runtime() else "offline"),
        "activeJobs": active_jobs,
        "kernelBase": state.kernel_base,
        "kernelSlide": state.kernel_slide,
        "pid": state.pid,
        "agentPid": state.agent_pid,
        "agentHost": state.agent_host,
        "agentWorkerReady": state.agent_worker_ready,
        "agentSupportsBulk": state.agent_supports_bulk,
        "agentSupportsAsync": state.agent_supports_async,
        "agentInlineLimit": state.agent_inline_limit,
        "agentBulkChunkSize": state.agent_bulk_chunk_size,
        "agentBulkMax": state.agent_bulk_max,
    }


def _json_response(payload: dict | list | str, status: int = 200) -> tuple[int, bytes, str]:
    return status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8"


def _text_response(payload: str, status: int = 200, content_type: str = "text/plain; charset=utf-8") -> tuple[int, bytes, str]:
    return status, payload.encode("utf-8"), content_type


def _http_reason(status: int) -> str:
    return {
        200: "OK",
        201: "Created",
        204: "No Content",
        400: "Bad Request",
        404: "Not Found",
        405: "Method Not Allowed",
        500: "Internal Server Error",
    }.get(status, "OK")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or f"skill-{uuid.uuid4().hex[:8]}"


def _skill_file(skill_id: str) -> Path:
    safe_id = re.sub(r"[^a-z0-9-]+", "-", skill_id.strip().lower()).strip("-")
    if not safe_id:
        raise ValueError("Invalid skill id")
    return SKILLS_DIR / f"{safe_id}.json"


def _ensure_skills_dir():
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_skill_entry_file(entry_file) -> str:
    value = str(entry_file or "").strip().replace("\\", "/")
    if not value:
        return ""
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("Skill entryFile must stay inside the skills directory")
    if candidate.suffix.lower() != ".js":
        raise ValueError("Skill entryFile must point to a .js file")
    normalized = candidate.as_posix().lstrip("./")
    if not normalized:
        raise ValueError("Skill entryFile must not be empty")
    return normalized


def _skill_entry_path(entry_file: str) -> Path:
    normalized = _normalize_skill_entry_file(entry_file)
    candidate = (SKILLS_DIR / normalized).resolve()
    skills_root = SKILLS_DIR.resolve()
    if not candidate.is_relative_to(skills_root):
        raise ValueError("Skill entryFile escaped the skills directory")
    return candidate


def _read_skill_entry_file(entry_file: str) -> str:
    path = _skill_entry_path(entry_file)
    if not path.exists():
        raise FileNotFoundError(f"Skill entry file not found: {entry_file}")
    return path.read_text(encoding="utf-8")


def _coerce_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(f"Invalid boolean value: {value}")


def _normalize_select_options(raw_options) -> list[dict]:
    if not isinstance(raw_options, list) or not raw_options:
        raise ValueError("Select inputs require a non-empty options list")

    options = []
    seen = set()
    for raw_option in raw_options:
        if isinstance(raw_option, dict):
            value = str(raw_option.get("value", "")).strip()
            label = str(raw_option.get("label", value)).strip()
        else:
            value = str(raw_option).strip()
            label = value
        if not value:
            raise ValueError("Select option values cannot be empty")
        if value in seen:
            continue
        seen.add(value)
        options.append({"value": value, "label": label or value})

    if not options:
        raise ValueError("Select inputs require at least one option")
    return options


def _normalize_skill_inputs(raw_inputs) -> list[dict]:
    if raw_inputs in (None, ""):
        return []
    if not isinstance(raw_inputs, list):
        raise ValueError("Skill inputs must be a list")

    normalized = []
    seen_ids = set()
    for index, raw_input in enumerate(raw_inputs):
        if not isinstance(raw_input, dict):
            raise ValueError(f"Skill input at index {index} must be an object")

        input_id = _slugify(str(raw_input.get("id") or raw_input.get("label") or f"input-{index + 1}"))
        if input_id in seen_ids:
            raise ValueError(f"Duplicate skill input id: {input_id}")
        seen_ids.add(input_id)

        input_type = str(raw_input.get("type") or "text").strip().lower()
        if input_type not in VALID_SKILL_INPUT_TYPES:
            raise ValueError(f"Unsupported skill input type: {input_type}")

        label = str(raw_input.get("label") or input_id.replace("-", " ").title()).strip()
        placeholder = str(raw_input.get("placeholder") or "").strip()
        required = _coerce_bool(raw_input.get("required", False))

        entry = {
            "id": input_id,
            "label": label or input_id,
            "type": input_type,
            "required": required,
        }

        if input_type == "boolean":
            entry["defaultValue"] = _coerce_bool(raw_input.get("defaultValue", False))
        elif input_type == "select":
            options = _normalize_select_options(raw_input.get("options"))
            default_value = str(raw_input.get("defaultValue") or options[0]["value"]).strip()
            allowed = {option["value"] for option in options}
            if default_value not in allowed:
                default_value = options[0]["value"]
            entry["options"] = options
            entry["defaultValue"] = default_value
        else:
            entry["defaultValue"] = str(raw_input.get("defaultValue") or "")
            if placeholder:
                entry["placeholder"] = placeholder

        normalized.append(entry)

    return normalized


def _normalize_skill_payload(payload: dict, *, require_name: bool) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Skill payload must be an object")

    name = str(payload.get("name", "")).strip()
    summary = str(payload.get("summary", "")).strip()
    entry_file = _normalize_skill_entry_file(payload.get("entryFile"))
    code = str(payload.get("code", ""))
    if entry_file and not code.strip():
        code = _read_skill_entry_file(entry_file)
    runtime = str(payload.get("runtime") or DEFAULT_SKILL_RUNTIME).strip().lower()
    execution_mode = str(payload.get("executionMode") or "interactive").strip().lower()

    if require_name and not name:
        raise ValueError("Skill name is required")
    if not code.strip():
        raise ValueError("Skill code is required")
    if runtime not in VALID_SKILL_RUNTIMES:
        raise ValueError(f"Unsupported skill runtime: {runtime}")
    if execution_mode not in VALID_SKILL_EXECUTION_MODES:
        raise ValueError(f"Unsupported skill execution mode: {execution_mode}")

    return {
        "name": name,
        "summary": summary,
        "code": code,
        "runtime": runtime,
        "executionMode": execution_mode,
        "inputs": _normalize_skill_inputs(payload.get("inputs")),
        "entryFile": entry_file,
    }


def _coerce_skill_input_values(input_defs: list[dict], raw_values) -> dict:
    if raw_values in (None, ""):
        raw_values = {}
    if not isinstance(raw_values, dict):
        raise ValueError("Skill input values must be an object")

    values = {}
    for input_def in input_defs:
        input_id = input_def["id"]
        raw_value = raw_values.get(input_id, input_def.get("defaultValue"))

        if input_def["type"] == "boolean":
            value = _coerce_bool(raw_value)
        elif input_def["type"] == "select":
            allowed = {option["value"] for option in input_def.get("options", [])}
            value = str(raw_value or input_def.get("defaultValue") or "").strip()
            if value not in allowed:
                if input_def.get("defaultValue") in allowed:
                    value = input_def["defaultValue"]
                elif allowed:
                    value = next(iter(allowed))
            if input_def["required"] and value not in allowed:
                raise ValueError(f"Missing required input: {input_id}")
        else:
            value = str(raw_value or "")
            if input_def["required"] and not value.strip():
                raise ValueError(f"Missing required input: {input_id}")

        values[input_id] = value

    return values


def _wrap_skill_code(code: str, input_values: dict) -> str:
    skill_input_json = json.dumps(input_values, ensure_ascii=False)
    return (
        f"globalThis.skillInput = Object.freeze({skill_input_json});\n"
        "globalThis.SkillInput = globalThis.skillInput;\n"
        f"{code}"
    )


def _load_skill(skill_id: str) -> dict:
    path = _skill_file(skill_id)
    if not path.exists():
        raise FileNotFoundError(skill_id)
    raw_payload = json.loads(path.read_text(encoding="utf-8"))
    payload = _normalize_skill_payload(raw_payload, require_name=False)
    payload["createdAt"] = raw_payload.get("createdAt")
    payload["updatedAt"] = raw_payload.get("updatedAt")
    payload["id"] = path.stem
    return payload


def _list_skills() -> list[dict]:
    _ensure_skills_dir()
    skills = []
    for path in SKILLS_DIR.glob("*.json"):
        try:
            raw_payload = json.loads(path.read_text(encoding="utf-8"))
            payload = _normalize_skill_payload(raw_payload, require_name=False)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        skills.append({
            "id": path.stem,
            "name": payload.get("name", path.stem),
            "summary": payload.get("summary", ""),
            "runtime": payload.get("runtime", DEFAULT_SKILL_RUNTIME),
            "executionMode": payload.get("executionMode", "interactive"),
            "inputCount": len(payload.get("inputs", [])),
            "entryFile": payload.get("entryFile", ""),
            "createdAt": raw_payload.get("createdAt"),
            "updatedAt": raw_payload.get("updatedAt"),
        })
    skills.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    return skills


def _save_skill(payload: dict) -> dict:
    _ensure_skills_dir()
    normalized = _normalize_skill_payload(payload, require_name=True)
    name = normalized["name"]
    previous_id = str(payload.get("previousId") or payload.get("id") or "").strip()

    skill_id = _slugify(str(payload.get("id", "")).strip() or name)
    path = _skill_file(skill_id)
    now = _utc_now_iso()
    created_at = now

    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            created_at = existing.get("createdAt", now)
        except (OSError, json.JSONDecodeError):
            created_at = now

    if previous_id and previous_id != skill_id:
        previous_path = _skill_file(previous_id)
        if previous_path.exists():
            previous_path.unlink()

    stored = {
        "name": normalized["name"],
        "summary": normalized["summary"],
        "runtime": normalized["runtime"],
        "executionMode": normalized["executionMode"],
        "inputs": normalized["inputs"],
        "createdAt": created_at,
        "updatedAt": now,
    }

    if normalized["entryFile"]:
        entry_path = _skill_entry_path(normalized["entryFile"])
        entry_path.parent.mkdir(parents=True, exist_ok=True)
        entry_path.write_text(normalized["code"], encoding="utf-8")
        stored["entryFile"] = normalized["entryFile"]
    else:
        stored["code"] = normalized["code"]

    path.write_text(json.dumps(stored, indent=2) + "\n", encoding="utf-8")
    stored["id"] = skill_id
    stored["code"] = normalized["code"]
    return stored


def _delete_skill(skill_id: str):
    path = _skill_file(skill_id)
    if not path.exists():
        raise FileNotFoundError(skill_id)
    path.unlink()


def _resolve_static_path(url_path: str) -> Path | None:
    relative = "index.html" if url_path == "/" else url_path.removeprefix("/assets/")
    candidate = (WEB_UI_DIR / relative).resolve()
    web_root = WEB_UI_DIR.resolve()
    if not candidate.is_relative_to(web_root) or not candidate.is_file():
        return None
    return candidate


async def _exec_from_body(body: bytes) -> dict:
    req = json.loads(body.decode("utf-8") or "{}")
    code = str(req.get("code", ""))
    runtime = str(req.get("runtime") or "").strip().lower() or None
    target = str(req.get("target") or "").strip().lower() or None
    if not _has_remote_runtime():
        return {"error": "Device not connected"}
    result = await exec_code(code, timeout=EXEC_TIMEOUT * 4, runtime=runtime, target=target)
    return result or {"error": "No response from device"}


async def _run_skill_from_body(body: bytes) -> dict:
    req = json.loads(body.decode("utf-8") or "{}")
    skill_id = str(req.get("skillId") or "").strip()
    target = str(req.get("target") or "").strip().lower() or None

    if skill_id and not req.get("code"):
        skill_payload = _load_skill(skill_id)
    else:
        skill_payload = {
            "name": req.get("name", ""),
            "summary": req.get("summary", ""),
            "code": req.get("code", ""),
            "runtime": req.get("runtime", DEFAULT_SKILL_RUNTIME),
            "inputs": req.get("inputs", []),
            "entryFile": req.get("entryFile", ""),
        }

    normalized = _normalize_skill_payload(skill_payload, require_name=False)
    input_values = _coerce_skill_input_values(normalized["inputs"], req.get("inputValues"))
    wrapped_code = _wrap_skill_code(normalized["code"], input_values)

    if normalized["runtime"] == DEFAULT_SKILL_RUNTIME and not _has_remote_runtime():
        return {"error": "JSCBridge runtime requires a connected device"}

    if normalized["executionMode"] == "job":
        job_id = str(uuid.uuid4())
        job = _upsert_job(
            job_id,
            skillId=skill_id or _slugify(normalized["name"] or "skill"),
            name=normalized["name"] or skill_id or "Skill Job",
            runtime=normalized["runtime"],
            executionMode=normalized["executionMode"],
            status="queued",
            code=wrapped_code,
        )
        try:
            await _submit_job_to_agent(job)
        except ConnectionError as error:
            state.jobs.pop(job_id, None)
            return {"error": str(error)}
        await _emit_job_event(job)
        await _emit_status_event()
        return {"ok": True, "jobId": job_id, "status": job["status"], "executionMode": "job"}

    result = await exec_code(wrapped_code, timeout=EXEC_TIMEOUT * 10, runtime=normalized["runtime"], target=target)
    if result is None:
        return {"error": "No response from device"}
    result["skillInput"] = input_values
    result["executionMode"] = normalized["executionMode"]
    return result


async def _list_apps_handler() -> dict:
    """List installed apps from device via Apps.listInstalled()."""
    if not _has_remote_runtime():
        return {"error": "Device not connected"}
    code = """
(() => {
  const apps = Apps.listInstalled({ forceRefresh: true });
  return JSON.stringify(apps.map(a => ({
    name: a.name,
    bundleId: a.bundleId,
    bundlePath: a.bundlePath
  })));
})()
"""
    result = await exec_code(code, timeout=EXEC_TIMEOUT * 2)
    if not result or result.get("error"):
        return {"error": result.get("error", "No response") if result else "No response from device"}
    try:
        apps = json.loads(result.get("value", "[]"))
    except json.JSONDecodeError:
        return {"error": "Failed to decode app list"}
    return {"ok": True, "apps": apps}


async def _app_icon_handler(query: dict) -> tuple[int, bytes, str]:
    """Return the app icon PNG for a given bundlePath."""
    bundle_path = (query.get("bundlePath") or query.get("bundlepath") or [""])[0].strip()
    if not bundle_path:
        return _json_response({"error": "Missing bundlePath query parameter"}, status=400)
    if not _has_remote_runtime():
        return _json_response({"error": "Device not connected"}, status=503)

    js_bp = json.dumps(bundle_path, ensure_ascii=False)
    # Resolve icon path
    resolve_code = f"""
(() => {{
  const bp = {js_bp};
  const candidates = [
    'AppIcon60x60@3x.png', 'AppIcon60x60@2x.png',
    'AppIcon76x76@2x.png', 'AppIcon40x40@3x.png',
    'AppIcon40x40@2x.png', 'AppIcon29x29@3x.png',
    'AppIcon29x29@2x.png',
  ];
  for (const name of candidates) {{
    const p = bp + '/' + name;
    if (FileUtils.exists(p)) return p;
  }}
  const entries = FileUtils.listDir(bp) || [];
  const icons = entries
    .filter(e => !e.isDirectory && /^AppIcon.*\\.png$/i.test(e.name))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return icons.length ? icons[0].path : "";
}})()
"""
    resolve_result = await exec_code(resolve_code, timeout=EXEC_TIMEOUT)
    if not resolve_result:
        return _json_response({"error": "No response"}, status=500)
    icon_path = resolve_result.get("value", "").strip().strip('"')
    if not icon_path:
        return _json_response({"error": "No icon found"}, status=404)

    # Read the icon file as base64
    js_icon_path = json.dumps(icon_path, ensure_ascii=False)
    read_code = f"""
(() => {{
  const d = FileUtils.readFile({js_icon_path}, 0, 131072);
  if (d === null) return "";
  const u = new Uint8Array(d);
  const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  for (let i = 0; i < u.length; i += 3) {{
    const a = u[i], b = i+1 < u.length ? u[i+1] : 0, c = i+2 < u.length ? u[i+2] : 0;
    s += C[a>>2] + C[((a&3)<<4)|(b>>4)] + (i+1<u.length ? C[((b&0xF)<<2)|(c>>6)] : "=") + (i+2<u.length ? C[c&0x3F] : "=");
  }}
  return s;
}})()
"""
    read_result = await exec_code(read_code, timeout=EXEC_TIMEOUT * 2)
    if not read_result:
        return _json_response({"error": "Failed to read icon"}, status=500)
    b64 = read_result.get("value", "")
    if not b64:
        return _json_response({"error": "Empty icon data"}, status=500)
    try:
        icon_bytes = base64.b64decode(b64)
    except Exception:
        return _json_response({"error": "Invalid base64 icon data"}, status=500)
    return 200, icon_bytes, "image/png"


async def _fs_download_handler(body: bytes) -> tuple[int, bytes, str]:
    """Download a file from device via base64-encoded chunks."""
    req = json.loads(body.decode("utf-8") or "{}")
    path = str(req.get("path", "")).strip()
    if not path:
        return _json_response({"error": "Missing path"}, status=400)
    if not _has_remote_runtime():
        return _json_response({"error": "Device not connected"}, status=503)

    CHUNK = 786432  # 768KB raw -> ~1MB base64
    js_path = json.dumps(path, ensure_ascii=False)
    # Get file size first
    size_code = f"""
(() => {{
  const st = FileUtils.stat({js_path});
  if (!st) return JSON.stringify({{error: "not found"}});
  return JSON.stringify({{size: st.size}});
}})()
"""
    size_result = await exec_code(size_code, timeout=EXEC_TIMEOUT * 2)
    if not size_result or size_result.get("error"):
        return _json_response({"error": size_result.get("error", "stat failed") if size_result else "no response"}, status=500)
    try:
        info = json.loads(size_result.get("value", "{}"))
    except json.JSONDecodeError:
        return _json_response({"error": "bad stat response"}, status=500)
    if info.get("error"):
        return _json_response({"error": info["error"]}, status=404)

    file_size = int(info.get("size", 0))
    # Read in chunks via base64
    chunks = []
    offset = 0
    while offset < file_size:
        length = min(CHUNK, file_size - offset)
        read_code = f"""
(() => {{
  const d = FileUtils.readFile({js_path}, {offset}, {length});
  if (d === null) return "";
  const u = new Uint8Array(d);
  const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  for (let i = 0; i < u.length; i += 3) {{
    const a = u[i], b = i+1 < u.length ? u[i+1] : 0, c = i+2 < u.length ? u[i+2] : 0;
    s += C[a>>2] + C[((a&3)<<4)|(b>>4)] + (i+1<u.length ? C[((b&0xF)<<2)|(c>>6)] : "=") + (i+2<u.length ? C[c&0x3F] : "=");
  }}
  return s;
}})()
"""
        result = await exec_code(read_code, timeout=EXEC_TIMEOUT * 4)
        if not result:
            return _json_response({"error": f"read failed at offset {offset}"}, status=500)
        b64 = result.get("value", "")
        if not b64:
            break
        chunks.append(base64.b64decode(b64))
        offset += length

    file_bytes = b"".join(chunks)
    filename = path.rsplit("/", 1)[-1] or "download"
    return 200, file_bytes, f"application/octet-stream; filename=\"{filename}\""


async def _fs_from_body(body: bytes) -> dict:
    req = json.loads(body.decode("utf-8") or "{}")
    if not _has_remote_runtime():
        return {"error": "Device not connected"}

    op = str(req.get("op", "")).strip()
    if not op:
        return {"error": "Missing fs op"}
    if op == "write" and len(str(req.get("text", "")).encode("utf-8")) > 2800:
        return {"error": "Inline web editor limit is 2800 bytes per save"}

    # Handle binary upload via base64 — data is decoded on-device by JS
    if op == "write_base64":
        path = req.get("path", "")
        data = req.get("data", "")
        append = bool(req.get("append", False))
        if not path:
            return {"error": "Missing path for write_base64"}
        if not data:
            return {"error": "Missing data for write_base64"}
        js_path = json.dumps(path, ensure_ascii=False)
        js_append = "true" if append else "false"
        code = f"""
(() => {{
  const b64 = {json.dumps(data)};
  const T = new Uint8Array(128);
  const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < C.length; i++) T[C.charCodeAt(i)] = i;
  const n = b64.length;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((n * 3 >> 2) - pad);
  let j = 0;
  for (let i = 0; i < n; i += 4) {{
    const a = T[b64.charCodeAt(i)], b = T[b64.charCodeAt(i+1)],
          c = T[b64.charCodeAt(i+2)], d = T[b64.charCodeAt(i+3)];
    out[j++] = (a << 2) | (b >> 4);
    if (j < out.length) out[j++] = ((b & 15) << 4) | (c >> 2);
    if (j < out.length) out[j++] = ((c & 3) << 6) | d;
  }}
  const ok = {js_append}
    ? FileUtils.appendFile({js_path}, out.buffer)
    : FileUtils.writeFile({js_path}, out.buffer);
  if (!ok) throw new Error("Failed to write file: " + {js_path});
  return JSON.stringify({{ ok: true, path: {js_path}, size: out.length }});
}})()
"""
        result = await exec_code(code, timeout=EXEC_TIMEOUT * 4)
        if result is None:
            return {"error": "No response from device"}
        if result.get("error"):
            return {"error": result["error"], "logs": result.get("logs", [])}
        value = result.get("value", "")
        try:
            payload = json.loads(value) if value else None
        except json.JSONDecodeError:
            return {"error": f"Invalid write_base64 response: {value}", "logs": result.get("logs", [])}
        return {"ok": True, "result": payload, "logs": result.get("logs", [])}

    async def exec_fs_request(fs_req: dict) -> dict:
        js_req = json.dumps(fs_req, ensure_ascii=False)
        code = f"""
(() => {{
  const __req = {js_req};
  const __run = () => {{
    switch (__req.op) {{
      case "list":
        return RootFS.list(__req.path || "/");
      case "read":
        return RootFS.readText(__req.path || "/", __req.maxBytes || 262144);
      case "write":
        return (__req.append ? RootFS.appendText(__req.path || "/", __req.text || "") : RootFS.writeText(__req.path || "/", __req.text || ""));
      case "mkdir":
        return RootFS.mkdir(__req.path || "/");
      case "rename":
        return RootFS.rename(__req.path || "/", __req.destination || "/");
      case "delete":
        return RootFS.remove(__req.path || "/", __req.recursive !== false);
      case "stat":
        return RootFS.stat(__req.path || "/");
      default:
        throw new Error("Unsupported fs op: " + __req.op);
    }}
  }};
  return __run();
}})()
"""
        result = await exec_code(code, timeout=EXEC_TIMEOUT * 4)
        if result is None:
            return {"error": "No response from device"}
        if result.get("error"):
            return {"error": result["error"], "logs": result.get("logs", [])}

        value = result.get("value", "")
        try:
            payload = json.loads(value) if value else None
        except json.JSONDecodeError:
            return {"error": f"Invalid fs payload: {value}", "logs": result.get("logs", [])}

        return {"ok": True, "result": payload, "logs": result.get("logs", [])}

    return await exec_fs_request(req)


async def _upload_from_body(body: bytes) -> dict:
    req = json.loads(body.decode("utf-8") or "{}")
    if not _has_app_runtime():
        return {"error": "Device not connected"}

    msg_id = str(uuid.uuid4())
    payload = json.dumps({
        "type": "upload",
        "id": msg_id,
        "path": req.get("path", ""),
        "data": req.get("data", ""),
    })
    _log(f">> upload to {req.get('path', '')} ({len(req.get('data', '')) // 1024}KB base64)")
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    state.pending[msg_id] = fut
    try:
        await state.ws.send(payload)
        return await asyncio.wait_for(fut, timeout=300)
    except asyncio.TimeoutError:
        state.pending.pop(msg_id, None)
        return {"error": "Upload timeout"}
    except Exception as e:
        state.pending.pop(msg_id, None)
        return {"error": str(e)}


async def _rcall_from_body(body: bytes) -> dict:
    req = json.loads(body.decode("utf-8") or "{}")
    if not _has_app_runtime():
        return {"error": "Device not connected"}

    msg_id = str(uuid.uuid4())
    payload = json.dumps({
        "type": "rcall",
        "id": msg_id,
        "func": req.get("func", ""),
        "args": req.get("args", []),
    })
    _log(f">> rcall {req.get('func', '')}({req.get('args', [])})")
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    state.pending[msg_id] = fut
    try:
        await state.ws.send(payload)
        return await asyncio.wait_for(fut, timeout=60)
    except asyncio.TimeoutError:
        state.pending.pop(msg_id, None)
        return {"error": "rcall timeout"}
    except Exception as e:
        state.pending.pop(msg_id, None)
        return {"error": str(e)}


async def _route_http(method: str, path: str, body: bytes) -> tuple[int, bytes, str]:
    parsed_url = urlparse(path)
    route = parsed_url.path or "/"
    query = dict(parse_qs(parsed_url.query, keep_blank_values=True))

    if method == "OPTIONS":
        return 204, b"", "text/plain; charset=utf-8"

    if route in ("/", "/index.html"):
        asset = _resolve_static_path("/")
        if asset:
            return 200, asset.read_bytes(), "text/html; charset=utf-8"
        return _text_response("Missing web UI assets", status=404)

    if route.startswith("/assets/"):
        asset = _resolve_static_path(route)
        if asset is None:
            return _text_response("Asset not found", status=404)
        content_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or asset.suffix == ".js":
            content_type += "; charset=utf-8"
        return 200, asset.read_bytes(), content_type

    if route in ("/status", "/api/status"):
        return _json_response(_status_payload())

    if route == "/api/jobs" and method == "GET":
        jobs = sorted(state.jobs.values(), key=lambda item: item.get("createdAt") or "", reverse=True)
        return _json_response({"jobs": [_job_payload(job) for job in jobs]})

    if route == "/api/logs":
        if method == "GET":
            return _json_response({"logs": list(state.server_logs)})
        if method == "DELETE":
            state.server_logs.clear()
            await _emit_server_log_reset_event()
            return _json_response({"ok": True})
        return _json_response({"error": f"Method not allowed: {method}"}, status=405)

    if route.startswith("/api/jobs/") and method == "GET":
        job_path = unquote(route.removeprefix("/api/jobs/")).strip("/")
        if job_path.endswith("/logs"):
            job_id = job_path.removesuffix("/logs")
            job = state.jobs.get(job_id)
            if not job:
                return _json_response({"error": f"Job not found: {job_id}"}, status=404)
            return _json_response({"jobId": job_id, "logs": job.get("logs", [])})
        job_id = job_path
        job = state.jobs.get(job_id)
        if not job:
            return _json_response({"error": f"Job not found: {job_id}"}, status=404)
        return _json_response(_job_payload(job))

    if route in ("/exec", "/api/exec") and method == "POST":
        return _json_response(await _exec_from_body(body))

    if route == "/api/skills/run" and method == "POST":
        return _json_response(await _run_skill_from_body(body))

    if route == "/api/fs" and method == "POST":
        return _json_response(await _fs_from_body(body))

    if route == "/api/fs/download" and method == "POST":
        return await _fs_download_handler(body)

    if route == "/api/apps" and method == "GET":
        return _json_response(await _list_apps_handler())

    if route == "/api/skills" and method == "GET":
        return _json_response({"skills": _list_skills()})

    if route == "/api/skills" and method == "POST":
        payload = json.loads(body.decode("utf-8") or "{}")
        return _json_response(_save_skill(payload), status=201)

    if route.startswith("/api/skills/"):
        skill_id = unquote(route.removeprefix("/api/skills/")).strip("/")
        if method == "GET":
            return _json_response(_load_skill(skill_id))
        if method == "DELETE":
            _delete_skill(skill_id)
            return _json_response({"ok": True})
        return _json_response({"error": f"Method not allowed: {method}"}, status=405)

    if route == "/upload" and method == "POST":
        return _json_response(await _upload_from_body(body))

    if route == "/rcall" and method == "POST":
        return _json_response(await _rcall_from_body(body))

    if route == "/log.html" and method == "GET":
        qs = parse_qs(urlparse(path).query)
        text = qs.get("text", [""])[0]
        if text:
            _print_log(text)
            _log(f"LOG: {text}")
        return _text_response("ok")

    if route == "/health":
        return _text_response("ok")

    return _json_response({"error": f"Unknown endpoint: {method} {route}"}, status=404)


async def _send_http_response(writer: asyncio.StreamWriter, status: int, body: bytes, content_type: str):
    writer.write(
        f"HTTP/1.1 {status} {_http_reason(status)}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Access-Control-Allow-Origin: *\r\n"
        f"Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n"
        f"Access-Control-Allow-Headers: Content-Type\r\n"
        f"\r\n".encode("utf-8")
    )
    writer.write(body)
    await writer.drain()


async def _send_sse_headers(writer: asyncio.StreamWriter):
    writer.write(
        (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/event-stream; charset=utf-8\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: keep-alive\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
            "\r\n"
        ).encode("utf-8")
    )
    await writer.drain()


async def _serve_events(writer: asyncio.StreamWriter):
    await _send_sse_headers(writer)
    state.browser_clients.add(writer)
    await _broadcast_event("status", _status_payload())
    for job in state.jobs.values():
        await _broadcast_event("job", _job_payload(job))

    try:
        while not writer.is_closing():
            writer.write(b": keepalive\n\n")
            await writer.drain()
            await asyncio.sleep(15)
    except Exception:
        pass
    finally:
        state.browser_clients.discard(writer)
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def _http_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Handle HTTP requests for API clients and the browser UI."""
    try:
        request_line = await asyncio.wait_for(reader.readline(), timeout=5)
        if not request_line:
            return
        request_str = request_line.decode("utf-8", errors="replace").strip()
        method, path, *_ = request_str.split(" ") if request_str else ("", "", "")
        route = urlparse(path).path or "/"

        content_length = 0
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=5)
            header = line.decode("utf-8", errors="replace").strip()
            if not header:
                break
            if header.lower().startswith("content-length:"):
                content_length = int(header.split(":", 1)[1].strip())

        if method == "GET" and route == "/api/events":
            await _serve_events(writer)
            return

        body = b""
        if content_length > 0:
            body = await asyncio.wait_for(reader.readexactly(content_length), timeout=10)

        status, resp_bytes, content_type = await _route_http(method, path, body)
        await _send_http_response(writer, status, resp_bytes, content_type)
    except FileNotFoundError as e:
        status, resp_bytes, content_type = _json_response({"error": f"Skill not found: {e.args[0]}"}, status=404)
        await _send_http_response(writer, status, resp_bytes, content_type)
    except (ValueError, json.JSONDecodeError) as e:
        status, resp_bytes, content_type = _json_response({"error": str(e)}, status=400)
        await _send_http_response(writer, status, resp_bytes, content_type)
    except Exception as e:
        _log(f"HTTP ERROR: {e}")
        status, resp_bytes, content_type = _json_response({"error": "Internal server error"}, status=500)
        await _send_http_response(writer, status, resp_bytes, content_type)
    finally:
        if writer not in state.browser_clients:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def async_main():
    global PORT, AGENT_PORT, HTTP_PORT
    _open_log()

    mode, script_code, PORT, AGENT_PORT, HTTP_PORT = _parse_args(sys.argv[1:])

    # Start WebSocket server + HTTP API server
    _print_info(f"Starting WebSocket server on 0.0.0.0:{PORT}")
    _print_info(f"Starting agent socket on 0.0.0.0:{AGENT_PORT}")
    _print_info(f"Starting HTTP API on 0.0.0.0:{HTTP_PORT}")
    _print_info(f"Logs: {LOG_PATH}")
    _log(f"Starting WebSocket server on 0.0.0.0:{PORT}")
    _log(f"Starting agent socket on 0.0.0.0:{AGENT_PORT}")
    _log(f"Starting HTTP API on 0.0.0.0:{HTTP_PORT}")
    _log(f"Logs: {LOG_PATH}")

    stop_event = asyncio.Event()

    # Start HTTP API server for krepl.py
    http_server = await asyncio.start_server(_http_handler, "0.0.0.0", HTTP_PORT)
    agent_server = await asyncio.start_server(_agent_handler, "0.0.0.0", AGENT_PORT)

    async with serve(
        _ws_handler,
        "0.0.0.0",
        PORT,
        max_size=16 * 1024 * 1024,  # 16 MB max message size
        ping_interval=20,
        ping_timeout=60,
        close_timeout=10,
    ) as server:
        _print_status(f"[*] Listening on ws://0.0.0.0:{PORT} (app) + tcp://0.0.0.0:{AGENT_PORT} (agent) + http://0.0.0.0:{HTTP_PORT} (API)")
        _log(f"Listening on ws://0.0.0.0:{PORT} (app) + tcp://0.0.0.0:{AGENT_PORT} (agent) + http://0.0.0.0:{HTTP_PORT} (API)")

        if mode == "script":
            exit_code = await run_script(script_code)
            _close_log()
            sys.exit(exit_code)
        elif mode == "daemon":
            _print_info("Running in daemon mode (HTTP API only, no interactive REPL)...\n")
            try:
                await stop_event.wait()  # Block forever
            except asyncio.CancelledError:
                pass
        else:
            _print_info("Waiting for device connection...\n")
            try:
                await repl_loop()
            except asyncio.CancelledError:
                pass
            finally:
                # Clean up watch task
                if state.watch_task and not state.watch_task.done():
                    state.watch_task.cancel()
                    try:
                        await state.watch_task
                    except asyncio.CancelledError:
                        pass
                # Close connection
                if state.ws:
                    try:
                        await state.ws.close()
                    except Exception:
                        pass
                _close_log()


def main():
    # Handle Ctrl+C gracefully at the top level
    def _sigint_handler(sig, frame):
        print(f"\n{C.DIM}Use .quit to exit or Ctrl+D for EOF.{C.RESET}")

    signal.signal(signal.SIGINT, _sigint_handler)

    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        print("\nBye.")
    finally:
        _save_history()
        _close_log()


if __name__ == "__main__":
    main()
