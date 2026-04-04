# Using the Kernel REPL

## Connection

The REPL runs as a WebSocket client from the iPad app, connecting to kserver.py on Mac.

```bash
python3 tools/kserver.py   # Listens on port 9090 (WS) and 9092 (HTTP API)
```

## HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /status | GET | Returns `{connected, kernelBase, kernelSlide, pid}` |
| /exec | POST | Execute JS in app process: `{"code": "..."}` |
| /rcall | POST | Remote call in **stable thread** (target process): `{"func": "getpid", "args": []}` |
| /upload | POST | Upload file to device |
| /health | GET | Health check |

## CRITICAL: exec vs rcall

| | /exec | /rcall |
|---|---|---|
| **Runs in** | Our app's process (JSContext) | Stable thread (target process) via exception RPC |
| **Has access to** | kread/kwrite (kernel R/W), local memory | Target process memory, syscalls, Mach calls |
| **Use for** | Kernel struct reads, task walks | Userspace function calls in target process |

### JS Functions in /exec context

**Kernel R/W** (via setsockopt primitive, runs in our app):
- `kread64(addrStr)` / `kwrite64(addrStr, valStr)` — kernel memory
- `kread32`, `kread16`, `kread8` — smaller reads
- `kread64_raw` / `kwrite64_raw` — no lock variants

**Remote call in stable thread (target process)** (via exception RPC):
- `rcall(addrStr, a0, a1, ..., a7)` — call function at raw address in stable thread (target process)
- `callSymbol(name, a0, ..., a7)` — resolve locally + call **locally** (NOT in stable thread (target process)!)

**Userspace memory** (our app's address space, NOT stable thread (target process)):
- `uread64(addrStr)` / `uwrite64(addrStr, valStr)` — our process memory
- `umalloc(size)` / `ufree(addrStr)` — our process heap

**Helpers:**
- `hex(val)`, `add(a, b)`, `sub(a, b)`, `strip(addrStr)`
- `readbuf(addrStr, len)`, `kstrread(addrStr, maxlen)`
- `kernelBase` — string, current kernel base

## /rcall: Running Code in Stable thread (target process)

```bash
# getpid — confirms stable thread (target process)
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"getpid","args":[]}'

# mmap in stable thread (target process) (small numeric args)
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"__mmap","args":[0,16384,3,4098,-1,0]}'

# Read from stable thread (target process) memory (addr as hex string)
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"OSAtomicAdd64","args":[0,"0x104b6c4c8"]}'

# Write 1234 to stable thread (target process) memory
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"OSAtomicAdd64","args":[1234,"0x104b6c4c8"]}'

# mach_task_self (stable thread (target process)'s task port)
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"mach_task_self","args":[]}'

# mach_vm_protect
curl -s -X POST http://localhost:9092/rcall -H 'Content-Type: application/json' \
  -d '{"func":"mach_vm_protect","args":["0x203","0x104b6c000",16384,0,3]}'
```

### Arg Types for /rcall
- **Small numbers** (< 2^53): JSON numbers: `[0, 16384, 3]`
- **Large addresses**: hex strings: `["0x104b6c4c8"]`
- **Negative values**: JSON numbers: `[-1]`
- **Mixed**: `[1234, "0x104b6c4c8"]`

## /exec: Kernel R/W and Remote Calls via JS

```bash
# Read kernel memory
curl -s -X POST http://localhost:9092/exec -H 'Content-Type: application/json' \
  -d '{"code":"kread64(add(kernelBase, \"0xa4d988\"))"}'

# Walk task list
curl -s -X POST http://localhost:9092/exec -H 'Content-Type: application/json' \
  -d '{"code":"var kt=kread64(add(kernelBase,\"0xa4d988\")); var t=kread64(add(kt,\"0x30\")); var pids=[]; for(var i=0;i<30;i++){var pro=kread64(add(t,\"0x3a0\")); if(pro!=\"0x0\"){var pid=kread32(add(pro,\"0x10\")); pids.push(pid+\"=\"+t);} var nt=kread64(add(t,\"0x30\")); if(nt==\"0x0\"||nt==kt)break; t=nt;} pids.join(\",\")"}'

# Call function in stable thread (target process) via JS rcall()
# Note: rcall() takes a RAW ADDRESS string, not a function name
# Use dlsym result from callSymbol or a known address
curl -s -X POST http://localhost:9092/exec -H 'Content-Type: application/json' \
  -d '{"code":"rcall(\"0x1d7799bf0\")"}'
```

## Tips

- `kread`/`kwrite` use setsockopt-based primitive (32-byte read/write chunks)
- `/rcall` uses exception-based remote call in stable thread (target process) (independent of kRW)
- `uread64`/`uwrite64` access OUR app's memory, NOT stable thread (target process)'s
- `callSymbol` runs in OUR app, NOT stable thread (target process) — use `/rcall` for stable thread (target process)
- **Always pass large addresses as hex strings** in `/rcall` args
- All kernel addresses must be verified before reading — bad reads cause kernel panic
- If kread64 returns "ERROR: setsockopt failed", kRW socket is dead — re-run exploit
