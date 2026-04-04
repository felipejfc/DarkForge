# Crash Investigation: Kernel panics on app close

## Root Cause: exc_actions zeroing writes to freed kernel memory

The `destroy()` method in `RemoteCall.swift` zeroed exc_actions port entries on
`troSwappedThreads` (the initial 2 SpringBoard threads used for TRO swap injection).
After `JSCBridge.setup()` runs ~20+ remote calls creating ObjC/JSC objects in
SpringBoard, those original GCD worker threads can be destroyed by SpringBoard's
thread pool management. Their kernel memory is freed and potentially reused.

When `destroy()` then reads `thread + PEOffsets.threadTRO` on a dead thread, it gets
garbage data, computes a garbage `exc_actions` address, and writes zeros to arbitrary
kernel heap memory. This corruption eventually triggers a `port send right count
overflow (delta: -1)` panic.

## Evidence

Bisected by commenting out code and testing app close:

| Config | Panic? |
|--------|--------|
| No stable/signing/JSC bridge | No |
| Stable + signing, no JSC bridge | No |
| Stable + signing + `bridge.setup()` | **Yes** |
| Full setup, skip `destroy()` entirely | No |
| Full setup, `destroy()` with only port dealloc | No |
| Full setup, `destroy()` with exc_actions zeroing + port dealloc | **Yes** |

This proves:
1. The exc_actions zeroing is what triggers the panic
2. Port deallocation alone is safe
3. The kernel's natural refcounting (via `ipc_port_copy_send` / `ipc_port_release_send`) is balanced

## Why exc_actions zeroing was wrong

The original comment claimed the TRO swap created "orphaned" port references that
needed manual cleanup. In reality, `thread_set_exception_ports` (called via the TRO
swap technique) properly calls `ipc_port_copy_send()` to create send rights. When
threads are destroyed, the kernel calls `ipc_port_release_send()` on exc_actions
entries. This is balanced — no manual intervention needed.

The zeroing was actively harmful because:
- It prevented the kernel from properly releasing send rights (causing leaks)
- After `bridge.setup()`, the thread kernel addresses were stale → writes to freed memory → heap corruption

## Fix

Removed exc_actions zeroing from `destroy()`. The method now:
1. Kills the stable thread via `pthread_exit` (remote call)
2. Deallocates the 3 exception ports (`firstExcPort`, `secondExcPort`, `signingExcPort`)

The kernel handles the rest naturally during thread/task destruction.

## Shutdown order

```
KernelREPL.shutdown()
  → disconnect()
  → bridge.shutdown()        // frees remote memory via stable thread
  → remote.destroy()         // kills stable thread, deallocates ports
```

`bridge.shutdown()` must run before `destroy()` because it uses the stable thread
for remote `free()` calls.

## Panic signature

```
panic(cpu N caller 0xXXX): port 0xXXX send right count overflow (delta: -1) @ipc_port.c:147
Panicked task: pid 34: SpringBoard
```

Backtrace always ended with `lr: 0x0000000000000101` (fakePCTrojanCreator — the
parked temp thread), confirming the corruption affected the temp thread's exc_actions
region or nearby kernel memory.

## 2026-04-02: Decrypt skill crash in SpringBoard

The reset counter report `ResetCounter-2026-04-02-191755.ips` was only the device
restart symptom. The actionable crashes were the adjacent SpringBoard reports:

- `SpringBoard-2026-04-02-191343.ips`
- `SpringBoard-2026-04-02-191712.ips`
- `SpringBoard-2026-04-02-191843.ips`

All three showed the same exception:

```
NSInvalidArgumentException
+[NSString stringByStandardizingPath]: unrecognized selector sent to class
```

The crashing stack ran through `JSC::ObjCCallbackFunctionImpl::call`, which points
to our injected loader JS calling Foundation path helpers through the generic ObjC
bridge while hosted inside SpringBoard.

### Root cause

`ObjC.standardizePath()` in `JSLibrary.swift` called:

- `stringByStandardizingPath`
- `stringByResolvingSymlinksInPath`

through the bridge. In this execution path the selector dispatch was landing as a
class send (`+[NSString ...]`) instead of the expected instance send, which made
SpringBoard abort during the decrypt flow.

### Fix

Removed Foundation-backed path canonicalization from the loader. `standardizePath()`
now stays in pure JS:

- normalizes `/`, `.`, and `..` with `RootFS.normalizePath()`
- folds `/private/var/...` to `/var/...`
- folds `/private/tmp/...` to `/tmp/...`

This keeps the path matching logic used by `Tasks.findPid()`, `TaskMemory.listImages()`,
and Mach-O enumeration, without sending unstable `NSString` path selectors through
the bridge from SpringBoard.
