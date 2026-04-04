# JSC Bridge Development Guide

Rules and pitfalls for modifying `JSLibrary.swift` (the remote JSC bridge loader
script that runs inside SpringBoard via the `__invoking__` + NSInvocation chain).

---

## 1. Autorelease Pool Drains Every `invoker()` Call

JavaScriptCore's `objCCallbackFunctionCallAsFunction` wraps each ObjC callback in
`@autoreleasepool`. Every `callSymbol` / `invoker()` round-trip **drains autoreleased
objects before JS reads the return value**.

### What breaks

```js
// BAD — stringWithUTF8String: returns autoreleased → freed before JS gets it
nsString(value) {
    return Native.callSymbol("objc_msgSend", NSString, "stringWithUTF8String:", str);
}

// BAD — dictionaryWithContentsOfFile: returns autoreleased
dictForPath(path) {
    return this.msg(NSDictionary, "dictionaryWithContentsOfFile:", path);
}
```

### What works

```js
// GOOD — CFStringCreateWithCString returns retained (+1), no autorelease
nsString(value) {
    return Native.callSymbol("CFStringCreateWithCString", 0, String(value), 0x08000100);
}

// GOOD — alloc/init returns retained (+1), no autorelease
dictForPath(path) {
    const raw = Native.callSymbol("objc_msgSend", NSDictionary, sel("alloc"));
    return Native.callSymbol("objc_msgSend", raw, sel("initWithContentsOfFile:"), nsString(path));
}
```

### Rules

- Use CF functions that return retained objects (`CFStringCreateWithCString`,
  `CFDictionaryCreateMutable`, etc.) instead of ObjC convenience methods.
- Use `[[Class alloc] initWith...]` instead of `[Class classWithX:]` patterns.
- Do **not** add blanket `objc_retain` / `CFRetain` on all `msg()` return values —
  it crashes on singletons and immortal objects (`KERN_PROTECTION_FAILURE`).
- `msgRaw()` is fine for methods returning non-object values (integers, BOOLs).

---

## 2. ObjC Methods Expect NSString, Not C Strings

When calling ObjC methods through `callSymbol("objc_msgSend", ...)` directly
(bypassing `msg()`), JS string arguments go through `#toNative` which writes them
to the shared buffer as **C strings** and returns a raw pointer. ObjC methods expect
**NSString** objects.

### What breaks

```js
// BAD — String(path) becomes a C string pointer via #toNative
Native.callSymbol("objc_msgSend", raw, sel("initWithContentsOfFile:"), String(path));
```

### What works

```js
// GOOD — wrap with nsString() first
const nsPath = this.nsString(String(path));
Native.callSymbol("objc_msgSend", raw, sel("initWithContentsOfFile:"), nsPath);
```

### Rule

Always use `ObjC.nsString()` before passing paths or text to ObjC methods.

---

## 3. Agent Bridge `init()` Cannot Use `invoker()`

The agent executor bridge runs `injectLoader()` via `performSelectorInBackground:`.
The `__invoking__` chain **does not work** during background-thread script
evaluation. Any call to `callSymbol`, `malloc`, or `memcpy` via `#nativeCallAddr`
during `init()` will fail silently (return 0).

### What breaks

```js
// BAD — malloc goes through invoker() which doesn't work on the background thread
static init() {
    this.mem = this.#nativeCallAddr(this.#mallocAddr, 0x4000n);     // returns 0
    this.#argMem = this.#nativeCallAddr(this.#mallocAddr, 0x1000n); // returns 0
}
```

### What works

```js
// GOOD — use shared buffer regions directly, no invoker() needed
static init() {
    this.#argMem = this.#baseAddr + 0x2000n;  // 0x2000-0x2FFF: string args
    this.mem = this.#baseAddr + 0x3000n;       // 0x3000-0x3FFF: general purpose
    this.memSize = 0x1000;
}
```

### Rules

- `init()` must not call `callSymbol`, `#nativeCallAddr`, `#dlsym`, or any function
  that triggers `invoker()`.
- `#toNative` must write strings directly to the shared buffer via
  `Uint8Array.set()` — no `writeString` / `memcpy` dance.
- Symbol resolution (`#dlsym`) happens lazily on first `callSymbol` call, which
  runs after init and works fine.

---

## 4. Shared Buffer Layout (0x4000 bytes)

The shared buffer (`nativeCallBuff` in JS / `callBuff` in Swift) is a 16 KB
`calloc`'d region shared between JS and native code via
`JSObjectMakeArrayBufferWithBytesNoCopy`.

```
Offset      Slots       Purpose
──────────  ──────────  ──────────────────────────────────────────────
0x0000      [0-3]       Second __invoking__ params
                        [0] = target function (written per call by JS)
                        [1] = resultBuf ptr (set by Swift, DO NOT MODIFY)
                        [2] = argsBuf ptr   (set by Swift, DO NOT MODIFY)
                        [3] = argsSize      (set by Swift, DO NOT MODIFY)

0x0050      [10-13]     First __invoking__ params (set by Swift via
                        NSInvocation setArgument:, DO NOT MODIFY)

0x00A0      [20-32]     Exported values for JS Native class
                        [20] = baseAddr, [21] = dlsymAddr,
                        [22] = memcpyAddr, [23] = mallocAddr, ...

0x0320      [100-107]   Function arguments x0-x7 (written per call by JS)

0x0640      [200]       Return value (written by __invoking__, read by JS)

0x1000                  Staging area for write()/read()/dlsym() (4 KB)

0x2000                  String arguments — #argMem (4 KB)
                        Written directly by #toNative via Uint8Array.set()

0x3000                  General purpose buffer — Native.mem (4 KB)
                        Used for stat buffers, small reads, etc.
```

### Rules

- **Never** write to slots 1-3 or 10-13 from JS. These control the `__invoking__`
  chain and are configured once during Swift bridge setup. Modifying them breaks all
  subsequent function calls and crashes SpringBoard.
- Slot 0 and slots 100-107 are written by `#nativeCallAddr` before each call.
- Slot 200 is the return value — read it immediately after `invoker()` returns.

---

## 5. `callSymbolRetain` Must Stay as an Alias for `callSymbol`

The original DarkSword `callSymbolRetain` was a plain alias for `callSymbol`.

### What breaks

Adding an NSInvocation (`oinv`) path with `setArgument:atIndex:` +
`invokeUsingIMP:`. The `setArgument:atIndex:` method reads **from** the pointer
argument, so passing a raw ObjC object value makes it read the object's ISA
(PAC-signed on ARM64e) instead of the pointer itself → `PAC_EXCEPTION` in
`objc_msgSend`.

The `#toNativePtr` helper was designed for this path and is no longer needed.

### Rule

```js
// GOOD — keep it simple
static callSymbolRetain(name, x0, x1, x2, x3, x4, x5, x6, x7) {
    return this.callSymbol(name, x0, x1, x2, x3, x4, x5, x6, x7);
}
```

Do not re-introduce the `oinv` / `setArgument:atIndex:` / `#toNativePtr` path.

---

## 6. Pre-loaded Addresses May Be Stale

The Swift bridge setup writes `mallocAddr`, `memcpyAddr`, etc. to the shared buffer
(slots 20-32). These are resolved via `dlsym` during `setup()`. On the agent
executor bridge, these addresses **can be wrong** (the background thread may see
stale state).

### Rule

Use `#dlsym("malloc")` / `#dlsym("memcpy")` lazily at first use instead of
trusting the pre-loaded values from `buff[22]` / `buff[23]`. The `callSymbol` path
already does this — function names go through `#dlsym` which caches results.

---

## 7. Agent Executor and Direct Bridge Are Not the Same Runtime

The direct bridge path (`executeRemoteScript()` + `remoteEvalWrapper`) and the
persistent agent executor loop are different execution environments.

- The direct bridge gets `globalThis.Host.acquireTaskPort()` from
  `remoteEvalWrapper`.
- The persistent agent executor **must define its own** `Host.acquireTaskPort()`
  shim and talk to Swift through dedicated control slots.
- If the executor does not expose that shim, `Tasks.openForPid()` falls back to
  `task_for_pid` / `task_read_for_pid` / `processor_set_tasks`, which fail with
  `kr=53` for third-party targets.

### Rule

When adding host-assisted functionality needed by both execution modes:

- implement it once in the direct wrapper (`remoteEvalWrapper`)
- implement it again in `makeAgentExecutorScript(...)`
- add a Swift-side service loop for the agent control slots

Do not assume that features exposed by `remoteEvalWrapper` automatically exist in
the persistent agent runtime.

### Current host-assisted operation

The task-port path now depends on:

- `Host.acquireTaskPort(pid)` in JS
- Swift-side kernel-backed `forgeRemoteTaskPortInTarget(forPid:)`
- agent control slots `agentSlotHostOp` through `agentSlotHostResult2`

`Tasks.openForPid()` should try that host path first and only use legacy
userland APIs as fallback diagnostics.

---

## 8. Staging and Packaging Should Not Depend on Shell Semantics

The decrypt flow originally used shell-backed helpers like:

```js
System.run("mkdir -p ...");
System.run("cp -R ...");
System.run("rm -rf ...");
```

That is fragile in injected agent processes. Directory creation and bundle staging
should use direct filesystem APIs instead.

### Rules

- Prefer `FileUtils` / `NSFileManager` backed operations for staging.
- `System.ensureDir()` should work recursively without relying on `/bin/sh`.
- If packaging depends on an external tool (`zip`), report a partial result and
  preserve the staged dump directory instead of treating the whole decrypt as a
  failure.

For the current decrypt flow, a successful staged dump with `ipaPath: null` is a
valid partial success.

---

## 9. Mach-O Header Parsing Must Respect On-Disk Endianness

Thin iOS Mach-O binaries on disk begin with little-endian magic bytes like:

```text
cffaedfe
```

If the parser reads the top-level or thin-slice magic as big-endian, valid app
executables will be rejected and `Apps.enumerateMachOFiles()` will incorrectly
return zero candidates.

### Rule

- FAT header detection: read magic/count fields with the endianness used by the
  FAT format.
- Thin Mach-O detection: read `MH_MAGIC` / `MH_MAGIC_64` using little-endian
  decoding.

If `FileUtils.listDir()` works and `MachO.inspectFile(app.executablePath)` still
returns `null`, check the magic read path first.
