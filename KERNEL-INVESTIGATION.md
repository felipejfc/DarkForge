# Kernel Structure Offset Investigation

## Overview

The DarkSword exploit requires precise kernel structure offsets that vary between iOS builds. Every offset must be independently verified from the device's kernelcache binary.

### Supported Devices

| Device | Model | SoC | iOS | Build | XNU |
|--------|-------|-----|-----|-------|-----|
| iPhone 17,4 | iPhone 16 Pro Max | A18 Pro | 18.6 | 22G86 | 24.6 |
| iPad 8,9 | iPad Pro 11" 2nd gen | A12Z | 18.3.2 | 22D82 | ~24.3 |

Offsets are managed via `DeviceProfile.swift` — a device profile struct selected at runtime based on `uname` machine string.

## Tools

- **opcodex-cli**: Decompiler and binary analysis tool
  - Path: available on `$PATH` or via `$OPCODEX_CLI`
  - iPhone project: `./ipsw/22G86__iPhone17,4/.opcodex/kernelcache.release.iPhone17_4`
  - iPad project: `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/.opcodex/kernelcache.release.iPad8_9_10_11_12`
- **ipsw**: Apple firmware analysis tool (available on `$PATH`)
  - Used for: MIG handler tables, fileset info, direct disassembly
- **Kernelcaches**:
  - iPhone: `./ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4` (65M, arm64e FILESET)
  - iPad: `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/kernelcache.release.iPad8,9_10_11_12` (55M, arm64e FILESET)

## Methodology

### 1. Start from the DarkSword reference offset

DarkSword's `pe_main.js` contains offset tables indexed by device family and XNU version. For iPhone17 XNU 24.6, offsets are at approximately line 3300. These are a starting point but **cannot be trusted** for our build — they consistently differ.

### 2. Find a kernel function that accesses the target field

The key is finding code that reads/writes the specific struct field. Approaches:

**a) Search by symbol name:**
```
opcodex-cli project-search <project> "function_name"
opcodex-cli function-lookup <project> "function_name"
```

**b) Follow the call chain from a known MIG handler:**
```
ipsw kernel mig <kernelcache>  # Lists all MIG handlers with addresses
opcodex-cli callees <project> <address>  # Find what a function calls
opcodex-cli callers <project> <address>  # Find who calls a function
```

**c) Search for related strings:**
```
opcodex-cli substring-search <project> "keyword"
opcodex-cli project-search <project> "keyword"
```

### 3. Decompile and read the assembly

```
opcodex-cli explain <project> <address>
```

This returns JSON with the function's assembly. Look for `ldr`/`str` instructions with immediate offsets from a register that holds the struct pointer. The offset in the instruction IS the struct field offset.

### 4. Verify with cross-references

Find multiple functions that access the same field to confirm the offset. Use `callers` and `callees` to trace the call chain.

## Verified Offsets — iPhone17,4 (build 22G86)

### task struct (from kernel_task pointer)

| Field | Offset | Verification |
|-------|--------|-------------|
| taskNext | 0x30 | DarkSword default, used everywhere |
| taskThreads | 0x58 | DarkSword default for first thread |
| taskIpcSpace | 0x318 | `convert_port_to_space_read` at 0xfffffff008173fc0: `ldr x16, [x20, #0x318]` then `autda` with disc 0x8280 |
| procRO | 0x3e0 | DarkSword iPhone17 override, confirmed by task walking |
| excGuard | 0x624 | DarkSword iPhone17 24.4+ override |
| kernelTask | 0xc1bf78 | Offset from kernel base to kernel_task global pointer |

**How taskIpcSpace was found:**
1. Started from `_Xtask_set_special_port_from_user` (MIG 3410) via `ipsw kernel mig`
2. Followed callees to `convert_port_to_space_read` (0xfffffff008173ee8)
3. Decompiled with `opcodex-cli explain` — found `ldr x16, [x20, #0x318]` followed by `autda`
4. x20 = task pointer (first arg after port conversion)

### ipc_space struct

| Field | Offset | Verification |
|-------|--------|-------------|
| is_table | 0x20 | `ipc_space_terminate` at 0xfffffff00812f39c: `ldr x16, [x19, #0x20]` then `autda` with disc 0xb8b5 |

**How is_table was found:**
1. Found `_ipc_space_terminate` via `project-search "ipc_space"`
2. Decompiled — x19 = ipc_space (first arg), `ldr x16, [x19, #0x20]` loads is_table

### thread struct

| Field | Offset | Verification |
|-------|--------|-------------|
| threadOptions | 0xc0 | DarkSword default |
| kstackptr | 0x148 | Context switch asm at 0xfffffff0081055a8: `add x6, x4, #0x148` where x4=tpidr_el1 (current thread) |
| ropPid | 0x1b8 | DarkSword offset table for tro=0x3f0 builds. **DO NOT WRITE** — corrupts thread struct |
| jopPid (IA key) | 0x1c0 | Kernel auth at 0xfffffff0082cc718: `ldr x3, [x8, #0x1c0]` loads PAC key for thread state auth |
| threadTRO | 0x3f0 | `get_thread_ro` at 0xfffffff0081e9e9c: `ldr x1, [x0, #0x3f0]` where x0=thread |
| guardExcCode | 0x398 | `_mach_exception_ast` at 0xfffffff0081c53f8: `ldr w22, [x0, #0x398]` — exception type code |
| guardExcCodeData | 0x3a0 | `_mach_exception_ast` at 0xfffffff0081c5400: `ldr x20, [x0, #0x3a0]` — guard code data |
| threadAST | 0x414 | `thread_terminate` at 0xfffffff0081c6a48: `add x8, x19, #0x414` then `ldclr` (atomic clear of AST bits). `ast_taken_user`: `tbnz w21, #0xc` (bit 12 = 0x1000 = AST_GUARD) |
| mutexData | 0x420 | Thread mutex lock at 0xfffffff0081c678c: `add x23, x0, #0x420` then `casa x8, x9, [x23]` |
| threadCTID | 0x4b0 | Thread mutex lock at 0xfffffff0081c6788: `ldr w9, [x20, #0x4b0]` where x20=tpidr_el1 |
| bsdAstGuardExcCode | 0x4c0 | `bsd_ast` at 0xfffffff008630af8: `ldr x8, [x19, #0x4c0]` — BSD guard path (NOT used for EXC_GUARD injection) |

**How kstackptr was found:**
1. Found `Switch_context` via `function-lookup`
2. It calls a trampoline at 0xfffffff008105680
3. Decompiled trampoline — first instructions: `mrs x4, tpidr_el1; add x6, x4, #0x148; ldr x5, [x6]` — loads kstackptr from tpidr_el1+0x148

**How mutexData was found:**
1. Found the thread mutex lock function called from `thread_terminate`
2. At 0xfffffff0081c6764, it does `add x23, x0, #0x420; casa x8, x9, [x23]`
3. This is the mutex acquire — compare-and-swap-acquire with the thread's ctid

**How guardExcCode was found (CORRECTED):**
There are TWO guard exception paths in the kernel:
1. `bsd_ast` (triggered by AST_BSD bit 7 = 0x80) — reads `thread+0x4c0`. This is the BSD guard path.
2. `_mach_exception_ast` (triggered by AST_GUARD bit 12 = 0x1000) — reads `thread+0x398`. This is the Mach guard path.

DarkSword uses the **Mach path** (AST_GUARD + offset 0x398). We initially used the wrong offset (0x4c0 from bsd_ast) with the right AST bit (0x1000), causing the handler to read zeros and crash.

Verified from `_ast_taken_user` at 0xfffffff008138df0:
- `tbnz w21, #7` → calls `_bsd_ast` (0xfffffff008630ad0)
- `tbnz w21, #0xc` → calls `_mach_exception_ast` (0xfffffff0081c53d8)
  - At 0xfffffff0081c53f8: `ldr w22, [x0, #0x398]` — exception type code
  - At 0xfffffff0081c5400: `ldr x20, [x0, #0x3a0]` — guard code data
  - At 0xfffffff0081c5428: `lsr x8, x20, #0x3d` — extracts guard type from bits 63-61
  - Type 1 = GUARD_TYPE_MACH_PORT → guard code must use `(1 << 61)` not `(1 << 56)`

DarkSword's offset tables confirm: for our build (tro=0x3f0, ast=0x414, mutexData=0x420, ctid=0x4b0), guardExcCode=0x398.

**How threadTRO was found:**
1. Found `thread_set_exception_ports` implementation at 0xfffffff00817599c
2. It calls 0xfffffff0081e9e90 with x0=thread before acquiring mutex
3. Decompiled that function — `ldr x1, [x0, #0x3f0]` loads the TRO, validates in zone range, returns

### ipc_port struct

| Field | Offset | Verification |
|-------|--------|-------------|
| io_bits | 0x0 (lower 32) | Port dump observation |
| io_references | 0x4 (upper 32 of first qword) | Port dump observation |
| kobject | 0x48 | IPC table decode verified: port+0x48 → strip → matches task addr |
| ip_nsrequest | 0x58 | DarkSword default, used in port forging |
| ip_sorights | 0x84 | DarkSword default |

### MIG bypass offsets

| Field | Offset from kbase | Verification |
|-------|-------------------|-------------|
| migLock | 0x4066f88 | In sandbox kext `__DATA` (0xfffffff00b06af88). Read returns 0x420000 (non-zero = valid lock structure). Write verified with readback. |
| migSbxMsg | 0x4066fa8 | 0x20 after migLock, in sandbox `__DATA` |
| migKernelStackLR | Multiple | ALL callers of `_sb_evaluate_internal` found via `opcodex-cli callers`. The actual LR that fires for thread_set_exception_ports is offset 0x3925000 (from `sub_0xfffffff00a928f2c`). |

**How migLock was found:**
1. Found sandbox kext via `ipsw macho info --fileset-entry com.apple.security.sandbox`
2. Sandbox `__DATA` section: 0xfffffff00b06abb0 - 0xfffffff00b0801c0
3. Scanned all ADRP+ADD/LDR pairs in sandbox `__TEXT_EXEC` that reference sandbox `__DATA`
4. Found 86 references. The lock at 0xfffffff00b06af88 (kbase+0x4066f88) was referenced from sandbox evaluator code.
5. NOTE: The original comment values in MIGFB.swift (0x4066f88/0x4066fa8) were actually correct for this build! DarkSword's 24.6 values (0x38543a8) were for a different sub-build.

**How migKernelStackLR was verified:**
1. Found `_sb_evaluate_internal` at 0xfffffff00a938fbc via `project-search`
2. Used `opcodex-cli callers` to find ALL 17 callers with their callsite addresses
3. Computed LR = callsite + 4 for each
4. Modified MIG bypass to search for ALL known LRs instead of just one
5. The actual match was at offset 0x3925000 (NOT the originally assumed 0x3934ee0)

### Other constants

| Constant | Value | Source |
|----------|-------|--------|
| T1SZ_BOOT | 17 | DarkSword: iPhone15/16/17 use T1SZ=17 |
| KALLOC_ARRAY_TYPE_SHIFT | 46 | 64 - T1SZ_BOOT - 1 |
| ipc_entry size | 0x18 | Division-by-3 magic (0xaaaaaaab) in smr table code |
| PAC disc for is_table | 0xb8b5 | From `autda` in ipc_space_terminate |
| PAC disc for itk_space | 0x8280 | From `autda` in convert_port_to_space_read |

## Verified Offsets — iPad8,9 (build 22D82)

All offsets found via opcodex static analysis of `kernelcache.release.iPad8,9_10_11_12`.
DarkSword has NO iPad entries — all offsets were discovered from scratch.
MIG bypass is NOT needed on iOS 18.3.2 (< 18.4).

### task struct

| Field | Offset | Verification |
|-------|--------|-------------|
| taskNext | 0x30 | Universal (stable across iOS 18.x) |
| taskThreadsQueueHead | 0x50 | Universal |
| taskThreads | 0x58 | Universal |
| taskIpcSpace | 0x318 | `ldr x16, [x19, #0x318]` + `autda` in task terminate at 0xfffffff007ee5368 |
| procRO | **0x3a0** | `ldr x8, [x0, #0x3a0]` in 4 proc_ro accessors (0xfffffff007ee49e0, 0xfffffff007ee5dac, 0xfffffff007ee82d0, 0xfffffff007ee9a3c), followed by zone validation + backref check |
| excGuard | **0x5dc** | `str w9, [x0, #0x5dc]` in `_Xtask_set_exc_guard_behavior` at 0xfffffff007f32fcc; `ldr w8, [x0, #0x5dc]` in getter at 0xfffffff007f33084 |
| kernelTask | **0x9f4f08** | `str x0, [x8, #0xf08]` in task_init at 0xfffffff007ee6a94, adrp x8 = 0xfffffff0079f8000 → addr 0xfffffff0079f8f08 - 0xfffffff007004000 |

### thread struct

| Field | Offset | Verification |
|-------|--------|-------------|
| threadOptions | 0xc0 | Universal |
| kstackptr | **0xf0** | `add x6, x4, #0xf0` in Switch_context at 0xfffffff007e64764 (x4=tpidr_el1); `str xzr, [x19, #0xf0]` in thread_deallocate_complete at 0xfffffff007ef7d5c |
| threadTRO | **0x378** | `ldr x8, [x21, #0x378]` in machine_switch_context at 0xfffffff007febacc (x21=old thread); `ldr x8, [x19, #0x378]` at 0xfffffff007febb0c (new thread) |
| guardExcCode | **0x320** | `ldr x1, [x0, #0x320]` in guard_ast at 0xfffffff007efbb34; zeroed via `str q0, [x0, #0x320]` |
| guardExcCodeData | **0x328** | `ldr x2, [x0, #0x328]` in guard_ast at 0xfffffff007efbb38 |
| threadTaskThreads | **0x360** | `ldr x26, [x26, #0x360]` in task_threads at 0xfffffff007eebfb0 (queue walk, confirmed x26=thread by thread_reference call) |
| threadAST | **0x394** | `add x8, x19, #0x394` + `ldclr w9, w8, [x8]` in thread_terminate at 0xfffffff007efce50 (atomic clear AST_APC=0x20) |
| threadMutexData | **0x3a0** | `add x10, x22, #0x3a0` + `casa x8, x9, [x10]` in exception_triage_thread at 0xfffffff007ea35d8; unlock: `casl w2, wzr, [x9]` at 0xfffffff007ea366c |
| threadCTID | **0x420** | `ldr w9, [x23, #0x420]` in exception_triage_thread at 0xfffffff007ea35d4 (x23=tpidr_el1, loads ctid for mutex casa) |

### proc_ro, thread_ro, socket/PCB structs

| Field | Offset | Verification |
|-------|--------|-------------|
| proPid (proc_ro) | 0x1b8 | Same struct-internal layout as iPhone17 (stable within iOS 18.x) |
| proComm (proc_ro) | 0x56c | Same struct-internal layout |
| troPacRopPid (thread_ro) | 0x1b8 | Same struct-internal layout |
| troPacJopPid (thread_ro) | 0x1c0 | Same struct-internal layout |
| icmp6Filter (inpcb) | 0x148 | `str x8, [x19, #0x148]` in icmp6_dgram_attach at 0xfffffff008258534 |
| socketSoCount | 0x254 | `ldr w8, [x19, #0x254]` / `sub w9, w8, #1` / `str w9, [x19, #0x254]` in soclose at 0xfffffff00837e07c |

### iPad vs iPhone offset delta

| Field | iPhone17,4 | iPad8,9 | Delta |
|-------|-----------|---------|-------|
| kernelTask | 0xc1bf78 | 0x9f4f08 | -0x22706c |
| kstackptr | 0x148 | 0xf0 | -0x58 |
| threadTRO | 0x3f0 | 0x378 | -0x78 |
| threadTaskThreads | 0x3e0 | 0x360 | -0x80 |
| guardExcCode | 0x398 | 0x320 | -0x78 |
| guardExcCodeData | 0x3a0 | 0x328 | -0x78 |
| threadAST | 0x414 | 0x394 | -0x80 |
| threadMutexData | 0x420 | 0x3a0 | -0x80 |
| threadCTID | 0x4b0 | 0x420 | -0x90 |
| procRO | 0x3e0 | 0x3a0 | -0x40 |
| excGuard | 0x624 | 0x5dc | -0x48 |
| taskIpcSpace | 0x318 | 0x318 | 0 |
| icmp6Filter | 0x148 | 0x148 | 0 |
| socketSoCount | 0x254 | 0x254 | 0 |

Deltas are NOT consistent — each field shifted differently. This reinforces that offsets cannot be estimated by applying a constant delta.

## Offset Delta Summary (iPhone17,4 vs DarkSword reference)

Every DarkSword offset for iPhone17 XNU 24.6 was wrong for our build 22G86:

| Field | DarkSword | Our build | Delta |
|-------|-----------|-----------|-------|
| kstackptr | 0xf8 | 0x148 | +0x50 |
| threadTRO | 0x398 | 0x3f0 | +0x58 |
| threadAST | 0x3bc | 0x414 | +0x58 |
| mutexData | 0x3c8 | 0x420 | +0x58 |
| guardExcCode | 0x340 | 0x398 (mach path) / 0x4c0 (bsd path) | +0x58 (mach) / +0x180 (bsd) |
| ctid | 0x450 | 0x4b0 | +0x60 |
| migKernelStackLR | 0x31a27e0 | 0x3925000 (multiple) | N/A |
| migLock | 0x38543a8 | 0x4066f88 | N/A |

The deltas are NOT consistent — each field shifted by a different amount. This means offsets cannot be estimated by applying a constant delta. Each must be verified independently from the kernelcache.

## Lessons Learned

1. **Never trust DarkSword offsets for a different build.** Even same iOS version + same device family can have different offsets between sub-builds.
2. **Always verify from kernelcache disassembly** before writing to kernel memory. Wrong offset writes cause kernel panics.
3. **Use opcodex `explain` + `callers`/`callees` chain** to trace from known MIG handlers or exported symbols to the target field access.
4. **The instruction encoding reveals the offset directly**: `ldr x8, [x19, #0x420]` means the field is at struct+0x420.
5. **PAC discriminators are visible in the `movk` + `autda` pattern**: e.g., `movk x17, #0x8280, lsl #48` followed by `autda x16, x17`.
6. **Multiple callers**: Functions like `_sb_evaluate_internal` have many callers. Search for ALL of them, not just the first one found.
8. **Verify MAC policy hooks at runtime before building bypass infrastructure.** We spent significant time building a MIG sandbox bypass only to discover that the MAC policy hooks for `thread_set_exception_ports` are ALL NULL — no policy checks this operation. The MAC check function (`sub_0xfffffff008905310`) iterates policies and reads `ops+0x408`/`ops+0x428`, both NULL. Verify via REPL: read the MAC policy table at `kbase+0x81F8F8`, iterate entries, check ops table for the specific hook offset.
9. **Two different guard exception paths exist.** `bsd_ast` (AST_BSD=0x80, reads thread+0x4c0) and `_mach_exception_ast` (AST_GUARD=0x1000, reads thread+0x398). DarkSword uses the Mach path. Using the wrong offset with the right AST bit causes the handler to read zeros and crash.
10. **Guard code type encoding matters.** `_mach_exception_ast` extracts the guard type via `lsr x8, x20, #0x3d` (shift right 61). The type must be at bits 63-61 (`1 << 61`), not at an arbitrary position like bit 56. Wrong encoding causes the handler to hit an unknown-type path and panic.
11. **Per-process PAC keys on iOS 18.x.** The kernel does NOT use hardware `autia` directly for thread state authentication. Instead, `machine_thread_set_state` calls a software auth function (`sub_0xfffffff0082af61c`) which: (a) reads the PAC key from `thread+0x1c0` (jopPid), (b) switches the hardware IA key to the target thread's key, (c) calls `autia`, (d) restores the original key. This means `pacia` in our process uses OUR key, but the kernel authenticates with the TARGET thread's key. Fix: kwrite our key to `target_thread+0x1c0`. Found by tracing from `movk x9, #0x7481, lsl #48` at `0xfffffff0082cc70c` → `ldr x3, [x8, #0x1c0]` → `bl auth_function`.
12. **Only write jopPid (+0x1c0), NOT ropPid (+0x1b8).** Writing to ropPid corrupts the thread struct and causes kernel panic on next context switch. The kernel auth function only reads from +0x1c0 for PC/LR authentication.
7. **Live probing is dangerous** for unverified offsets — reading wrong kernel addresses can panic. Static analysis first, live verification only for confirmed offsets.
13. **MIG bypass not needed on iOS < 18.4.** The sandbox MIG filter that blocks `thread_set_exception_ports` was added in iOS 18.4. On earlier versions (e.g., iPad8,9 on 18.3.2), the MIG offsets can be left zeroed.
14. **Thread list walk: read64(entry + threadTaskThreads), NOT read64(entry).** The queue at task+0x50 stores thread BASE addresses. Following the chain requires adding the threadTaskThreads offset. Reading at offset 0 of the entry gives the PREV pointer, causing an infinite 2-entry loop. Verified via REPL: 9 real threads vs infinite loop with wrong walk.
15. **PAC key swap has a multi-core race.** Writing our key → target jopPid, sending reply, then restoring creates a window where the thread runs with our key. Simple syscalls (getpid, mmap svc) survive because they don't use IA-authenticated calls. Complex functions (malloc) crash because zone allocator vtables use PAC. Restoring BEFORE send doesn't work either — the kernel validates the incoming PAC against jopPid at processing time. This is a fundamental limitation of the key-swap approach; the DarkSword signing thread (copy target key to local thread) would avoid this.
16. **iOS apps cannot allocate executable pages** without a JIT entitlement. `mach_vm_protect(PROT_EXEC)` silently fails or the page faults on instruction fetch. Gadgets must be found in already-loaded shared cache frameworks.
17. **Cross-device offsets are never safe to assume.** iPad8,9 (A12Z) vs iPhone17,4 (A18) have completely different thread struct layouts (deltas -0x58 to -0x90). Even IPC offsets that happen to match (taskIpcSpace=0x318) must be independently verified. The only reliably stable offsets are task linked list pointers (taskNext=0x30, taskPrev=0x38) and struct-internal layouts (proc_ro fields, thread_ro fields) within the same iOS major version.

### Thread list iteration

**iPad8,9** (verified from task_threads at 0xfffffff007eebdfc + REPL live verification):
- Task threads queue head: task+0x50
- `read64(task+0x50)` → first thread BASE address
- Next thread: `read64(thread_base + 0x360)` → next thread BASE address
- Walk terminates when next == task+0x50 (queue head sentinel)
- **CRITICAL**: The queue stores thread BASE addresses, NOT `thread+offset`. The `ldr x26, [x26, #0x360]` instruction in task_threads reads from `thread_base+0x360` to get the next thread base.
- **BUG FOUND**: Previous code did `read64(entry)` to follow the chain — this reads the PREV pointer at offset 0, causing a 2-entry infinite loop. Correct: `read64(entry + threadTaskThreads)`.

**iPhone17,4** (from task_threads at 0xfffffff0081b4898):
- Same pattern: queue head at task+0x50, entries are thread BASE addresses
- Next: `read64(thread_base + 0x3e0)` → next thread base
- Walk terminates when next == task+0x50

### PAC Key Architecture — iPad8,9 (A12X) vs iPhone17,4 (A18)

**iPad8,9 (A12X) — Verified via kernelcache disassembly + live testing:**

1. **Switch_context** (at 0xfffffff007e64764): Only loads IB/DB keys per-thread:
   ```
   ldr x5, [x4, #0x158]       ; x4=tpidr_el1(thread), load IB base key
   msr apibkeylo_el1, x5      ; IB_lo = key
   add x6, x5, #1
   msr apibkeyhi_el1, x6      ; IB_hi = key+1
   add x6, x6, #1
   msr apdbkeylo_el1, x6      ; DB_lo = key+2
   add x6, x6, #1
   msr apdbkeyhi_el1, x6      ; DB_hi = key+3
   ```
   **NO `msr apiakeylo_el1`** — the IA key register is never switched per-thread.

2. **CRITICAL DISCOVERY (CORRECTED)**: The field at thread+0x160 on iPad is the **IA key**. It is loaded into `APIAKEYLO_EL1` during EXCEPTION RETURN (at `0xfffffff007e5bf64`), NOT during `Switch_context`. The exception return code: `ldr x1, [thread, #0x160]; msr apiakeylo_el1, x1; add x3, x1, #1; msr apiakeyhi_el1, x3`. This only happens when flag at thread+0xa8 bit 1 is clear (userspace return). The value `0xFEEDFACEFEEDFAD5` for launchd is launchd's actual IA key. Key write must happen while thread is BLOCKED in exception delivery — writing while thread is suspended mid-syscall corrupts the return path. Previously misidentified as IB key (value `0xFEEDFACEFEEDFAD5` for launchd — the well-known B-key constant). The DeviceProfile names it `troPacJopPid` but it's the IB key, NOT the IA key. Writing our key there corrupts the target's IB key, causing `retab` (IB-authenticated return) to fail in complex functions (malloc, pthread_create). Simple syscall wrappers (getpid=`svc;ret`) work because they don't use authenticated returns. The field IS used by the kernel's `machine_thread_set_state` for thread state authentication — but writing it has the side effect of breaking IB-authenticated code in the target.

3. **PAC key swap model (working, commit 7fecf81)**:
   - Before sign: write OUR key → target thread's jopPid (thread+0x160 via queue entry)
   - Sign PC/LR with local `pacia_sign()` (uses our IA key)
   - Send exception reply via `mach_msg`
   - Immediately after send: restore target's original key
   - **Race condition**: On multi-core, the target thread may start executing before we restore. Simple syscalls (getpid, mmap) work fine. Complex functions (malloc) may hit PAC-authenticated internal calls with the wrong key.

4. **`machine_thread_set_state` flow** (from opcodex at 0xfffffff007feda18):
   - Calls `_ml_check_signed_state` (PACGA hash validation of CURRENT saved state)
   - Checks KERNEL_SIGNED flags in incoming state: if SET → **kernel panic** (`brk #0`)
   - If flags CLEAR: writes incoming values to saved state, calls `_ml_sign_thread_state` to re-sign PACGA hash
   - This function only handles PACGA (internal kernel state integrity). It does NOT authenticate/re-sign PACIA on PC/LR.
   - **BUT**: the exception return path (`eret` at `0xfffffff007e5c02c`) loads PC into `elr_el1` and returns to userspace. The HARDWARE then does instruction fetch at PC — which requires a valid PACIA signature matching the IA key loaded from `thread+0x160`.
   - **Tested**: sending raw stripped PC (no PAC) with KERNEL_SIGNED cleared → kernel accepts it (PACGA re-signed) → but thread crashes on execution because hardware instruction fetch fails PAC check.
   - **Conclusion**: `pacia_sign` with the correct IA key IS required. The key swap (write our key to target's +0x160) is the only working approach. The kernel's PACGA is for internal integrity only; hardware PAC on instruction fetch is separate.

5. **Key swap mystery**: Writing our key to thread+0x160 (IB key field) was empirically required for getpid to work, even though `machine_thread_set_state` only uses PACGA (not IA). The mechanism by which this write enables the reply is UNKNOWN — it may affect something in the exception delivery/reply path outside of `machine_thread_set_state`, or it may affect thread scheduling/signal delivery. Without the write, launchd crashes (`initproc exited`). With the write, simple syscalls work but complex functions (malloc, pthread_create) crash due to IB key corruption.
   - **Before send restore**: crashes getpid. The write is needed at mach_msg time.
   - **After send restore**: getpid/mmap work. Complex functions crash (IB-authenticated `retab` fails).

6. **`threads_ro` zone**: Thread RO elements are only 88 bytes on iPad. The `troPacJopPid=0x160` offset is NOT inside thread_ro — it's at `thread_base + 0x160` in the thread struct itself. Writing via `queue_entry + troPacJopPid` where queue_entry = `thread_base + 0x360` would write to `thread_base + 0x4C0`, which is a DIFFERENT field. The working commit read `task+0x50` (queue head) directly and applied the offset to that value, effectively computing `thread_base + 0x160`.

7. **Keep-alive crash fix**: After a remote call returns, the return exception may have PC at the instruction AFTER the syscall (e.g., `mmap+4`) rather than the crash address (`0x201`). Echoing this state as-is resumes the thread mid-function, causing launchd to execute uncontrolled code and crash. **Fix**: keep-alive must redirect PC to the crash address (`signPC: fakePCTrojanCreator, signLR: fakeLRTrojanCreator`) instead of echoing.

**iPhone17,4 (A18) — From earlier investigation:**

1. IA key IS per-process: kernel auth function at 0xfffffff0082af61c reads thread+0x1c0 (jopPid), switches hardware IA key, calls autia, restores.
2. `Switch_context` likely switches IA key per-thread (needs verification).
3. The signing thread approach (DarkSword `remotePACLocal`) would be needed here since IA keys differ between processes.

### Remote Call Function Resolution — CRITICAL

**Library wrappers vs raw syscall wrappers:**
- `dlsym("mmap")` → libc wrapper (complex C function, uses IA-authenticated calls, CRASHES with key swap)
- `dlsym("__mmap")` → raw syscall wrapper (`mov x16, #SYS_mmap; svc #0x80; b.cs cerror; ret`, WORKS)

**Verified working (raw syscall wrappers with `__` prefix):**
- `__mmap` → x0=mapped address, ret PC=0x201, carry=0, cpsr=0 ✓
- `getpid` → x0=1, ret PC=0x201 ✓ (getpid IS the raw wrapper, no `__` needed)
- `__bsdthread_create` → svc executes, returned EINVAL (bad args) but syscall DID run

**Verified BROKEN (libc wrappers):**
- `mmap` → crashes mid-function, x0=input arg (never modified), ret PC=mmap+4
- `pthread_create_suspended_np` → crashes mid-function, x0=garbage
- `malloc` → crashes mid-function (IA-authenticated zone allocator vtables)

**Rule: ALL remote calls must use `__` prefixed raw syscall wrappers (or known-simple wrappers like getpid).**

**Error handling:**
- On success: carry=0, x0=return value, ret PC=0x201 (hit our crash LR)
- On error: carry=1, x0=errno, ret PC=func+8 (at `b.cs cerror` instruction)
- Error path: `b.cs cerror` branches to cerror (complex function) → crashes launchd
- Keep-alive redirects PC to 0x101, but if the branch already executed, launchd is dead
- Prevention: ensure syscall args are correct to avoid error returns

### DarkSword PAC Signing Reference

**DarkSword's approach (PAC.js, commented-out `remotePACLocal`):**
1. Read target thread's PAC keys (ropPid + jopPid) from kernel
2. Create new Mach thread via `thread_create(mach_task_self_)`
3. Set thread state (PC = pacia gadget in JSC, x16=addr, x17=disc)
4. Set `threadOptions |= 0x8000` before `thread_set_state`, clear after
5. Write target's PAC keys to the new thread's kernel struct (via `Thread.setPACKeys`)
6. Set exception port, resume thread
7. Gadget executes `pacia x16, x17` with target's key → crashes at invalid LR
8. Read x16 from exception state = signed value

**DarkSword's current (simplified) approach:**
- Just calls `Native.pacia(address, modifier)` — signs with the CALLER's local key
- The `threadAddr` parameter in `remotePAC()` is passed but IGNORED
- This works because DarkSword runs from mediaplaybackd (a system daemon), possibly sharing PAC context, or the exception reply re-signs anyway

**Our approach (working on iPad):**
- Temporarily write our IA key to target thread's jopPid
- Sign with local `pacia_sign()`
- Restore target's key after `mach_msg` send
- This is the REVERSE of DarkSword's old approach (they copied target's key to a local thread)

### PAC Bypass: disable_user_jop in machine_thread_state_convert_from_user

**Discovery**: The kernel function `machine_thread_state_convert_from_user` has 5 independent conditions that completely skip PAC authentication on exception replies. If ANY condition is true, raw unsigned PC/LR values are accepted.

**iPhone17,4 (A18, iOS 18.6)**: function at `0xfffffff0082cc4e0`

```
; x20 = tpidr_el1 = OUR thread (calling mach_msg)
0xfffffff0082cc544  ldrb     w8, [x20, #0xf8]      ; ① OUR thread+0xf8
0xfffffff0082cc548  tbnz     w8, #1, skip_pac       ; bit 1 set → SKIP

; get task from TRO
0xfffffff0082cc564  ldr      w9, [x0, #0x410]       ; ② task+0x410
0xfffffff0082cc568  tbz      w9, #0, skip_pac       ; bit 0 clear → SKIP

; x19 = TARGET thread
0xfffffff0082cc56c  ldrb     w8, [x19, #0xf8]       ; ③ TARGET thread+0xf8
0xfffffff0082cc570  tbnz     w8, #1, skip_pac       ; bit 1 set → SKIP

0xfffffff0082cc580  ldr      w9, [x0, #0x410]       ; ④ target task+0x410
0xfffffff0082cc584  tbz      w9, #0, skip_pac       ; bit 0 clear → SKIP

; GLOBAL
0xfffffff0082cc594  ldrb     w9, [x9, #7]            ; ⑤ global_ptr+0x477
0xfffffff0082cc598  tbnz     w9, #5, skip_pac        ; bit 5 set → SKIP

skip_pac:
0xfffffff0082cc5cc  mov      w8, #1
0xfffffff0082cc5d0  str      w8, [x2, #0x10c]        ; opaque_flags = 1
0xfffffff0082cc5d4  mov      w0, #0                   ; KERN_SUCCESS
```

**iPad8,9 (A12Z, iOS 18.3.2)**: function at `0xfffffff007fedd2c`

```
0xfffffff007fedd98  ldrb     w8, [x22, #0xa8]       ; ① OUR thread+0xa8
0xfffffff007fedd9c  tbnz     w8, #1, skip_pac

0xfffffff007fedda8  ldr      w8, [x0, #0x3d0]       ; ② task+0x3d0
0xfffffff007feddac  tbz      w8, #0, skip_pac

0xfffffff007feddb0  ldrb     w8, [x20, #0xa8]       ; ③ TARGET thread+0xa8
0xfffffff007feddb4  tbnz     w8, #1, skip_pac

0xfffffff007feddc0  ldr      w8, [x0, #0x3d0]       ; ④ target task+0x3d0
0xfffffff007feddc4  tbz      w8, #0, skip_pac

0xfffffff007feddd0  ldrb     w8, [x8, #0x477]        ; ⑤ global+0x477
0xfffffff007feddd4  tbnz     w8, #5, skip_pac
```

**Bypass offset summary**:

| Vector | iPhone17,4 | iPad8,9 | What |
|--------|-----------|---------|------|
| ① Our thread | +0xf8 bit 1 | +0xa8 bit 1 | Caller's JOP disable |
| ② Our task | +0x410 bit 0 | +0x3d0 bit 0 | Caller's pmap JOP enable |
| ③ Target thread | +0xf8 bit 1 | +0xa8 bit 1 | Target's JOP disable |
| ④ Target task | +0x410 bit 0 | +0x3d0 bit 0 | Target's pmap JOP enable |
| ⑤ Global | +0x477 bit 5 | +0x477 bit 5 | System-wide JOP enable |

**Implementation**: Set vector ③ (target thread byte bit 1) once before starting the exception loop. The kernel skips PAC auth for all subsequent replies. No PACSigningThread or key-swap needed.

**Why eret doesn't need signed PC**: The hardware PAC only checks on `blraaz`/`retab`/`autia` instructions. The `eret` instruction loads PC from `elr_el1` directly — no PAC authentication. The kernel's software check in this function is the only barrier, and we bypass it.

**Why internal PAC still works**: Target thread's IA/IB keys are NEVER modified. Internal signed function pointers (malloc vtables, retab returns) remain valid. Only the kernel's software auth of the exception reply state is skipped.

### PPL (Page Protection Layer) — iPad8,9 (A12Z)

**Mechanism**: On A12Z, PPL uses APRR (Alternative Page Range Register) to protect page tables, trust caches, and read-only kernel structures. APRR registers (`s3_4_c15_c2_0` for EL0, `s3_4_c15_c2_1` for EL1) remap PTE permission bits. On PPL entry, APRR1_EL1 is set to `0x4455445564666677` (PPL code executable, PPL data writable); on exit it reverts to `0x4455445464666477` (PPL code non-executable, PPL data read-only). Transition is a software register write protected by KTRR. (A15+ uses hardware GXF/SPRR instead.)

**What PPL protects:**
- Page tables (pmap structures)
- Trust caches (code signature verification)
- `proc_ro` — process read-only data (credentials, csflags, task tokens)
- `thread_ro` — thread read-only data (PAC keys, exception actions)
- These are in `zalloc_ro` read-only zones, modifiable only via `zalloc_ro_mut` PPL routines

**Key kernel functions (iPad8,9):**

| Function | Address | Purpose |
|----------|---------|---------|
| `zalloc_ro_mut` | `0xfffffff007f1c6bc` | Legitimate way to modify read-only zone objects (57 callers) |
| `zalloc_ro_mut_validation_panic` | `0xfffffff0085fef90` | Panic on invalid ro_mut call |
| `ppl_load_trust_cache` | `0xfffffff00834972c` | Load trust cache into PPL-protected pages |
| `ppl_register_provisioning_profile` | `0xfffffff00834ad58` | Register provisioning profiles |
| `trust_cache_runtime_init` | `0xfffffff00834935c` | Initialize trust cache subsystem |
| `pmap_protect_options` | `0xfffffff007fd4478` | Page protection enforcement |
| `kauth_cred_rw_verify_panic` | `0xfffffff0086036e8` | Panics on credential RW violation |

**Known PPL bypass techniques (ALL PATCHED):**

1. **TLB invalidation bug** (Project Zero Issue 2035, iOS 13.6 fix) — stale TLB entries from pmap_remove_options_internal.
2. **tlbFail / CVE-2022-26764** (Fugu15, iOS 15.5 fix) — similar TLB flaw, needed kcall via badRecovery.
3. **Operation Triangulation / CVE-2023-38606** (Kaspersky, iOS 16.6 fix) — undocumented GPU MMIO registers at `0x206150048` performed DMA writes bypassing APRR/PPL. **Affected A12Z** with chip constant `0x07D34B9F`.
4. **CVE-2025-24118** — race condition in `zalloc_ro_mut()` during p_ucred updates. Patched iOS 18.3.

**Practical PPL bypass approaches (unpatched, for our use case):**

**Approach 1: Check if ucred is directly writable (TRY FIRST)**
- Read `proc_ro->p_ucred` pointer via kernel R/W
- The `ucred` struct itself may be in a regular (writable) kernel heap zone
- If so, modify uid/gid fields directly — no PPL bypass needed
- On iOS 18.3.2, ucred may not yet be in a read-only zone

**Approach 2: kcall to zalloc_ro_mut**
- Build kcall primitive from existing infrastructure (forge kernel task port, thread_create_running)
- Call `zalloc_ro_mut(ZONE_ID_PROC_RO, proc_ro_addr, field_offset, &new_value, size)`
- Modifies proc_ro fields through the kernel's own legitimate interface
- Requires: kernel task port forgery + kcall capability

**Approach 3: Physical memory PPLRW (Dopamine approach)**
- Call `pmap_enter_options` to map kernel physical memory into our process at a fixed VA offset
- Physical memory access from EL0 bypasses APRR permission remapping
- Walk page tables to translate proc_ro VA → PA, write directly
- Requires: kcall capability (to call pmap_enter_options)

**Approach 4: Sandbox token delegation (NO PPL bypass needed)**
- Already have launchd RCE via exception-based RemoteCall
- Call `sandbox_extension_issue_file` in launchd context to get sandbox tokens
- `sandbox_extension_consume` in our process to escape sandbox
- Provides file access to protected paths without modifying credentials
- Does NOT require PPL bypass — works with existing capabilities

**Recommended path:**
1. Try Approach 1 (direct ucred write) — simplest, may work on iOS 18.3.2
2. If ucred is RO, use Approach 4 (sandbox tokens) for immediate utility
3. Build kcall for Approach 2/3 when full privilege escalation is needed

**Trust cache globals (iPad8,9):**
- `0xfffffff007a12108` — trust cache pointer
- `0xfffffff007a4ef68` — trust cache config
- `0xfffffff007a035d0/0x5d8` — cache entries

### PPL Internals: zalloc_ro_mut and Race Condition Analysis

**PPL dispatch mechanism (iPad8,9):**
```
zalloc_ro_mut(zone_id, ptr, offset, &value, size)
    → sub_0xfffffff007e66914: mov x15, #0x4c; b PPL_dispatch
    → PPL_dispatch (0xfffffff007e5c97c):
        1. mrs x10, tpidr_el1; ldr w12, [x10, #0x150]; add w12, +1  (PPL reentry counter)
        2. b 0xfffffff00862ffe0  (APRR switch: msr s3_4_c15_c2_1, ppl_rw_value)
        3. Execute handler 0x4c in PPL mode (RO pages become writable)
        4. On return: msr s3_4_c15_c2_1, ppl_ro_value (restore read-only)
```

**Zone IDs observed:**
- Zone 4 = `ZONE_ID_PROC_RO` (proc_ro structures)
- Zone 8 = likely ucred/kauth_cred zone
- Zone 0xd = special zone (has additional init check at 0xfffffff007a03a48)

**Self-pointer bypass pattern found in ucred modifiers:**

Several functions that call `zalloc_ro_mut` use a self-pointer check to decide between the PPL path and a direct store:

```c
// Pattern found in sub_0xfffffff0082da0e0 and sub_0xfffffff0082da498:
x9 = obj->field_0x10;        // read self-pointer
if (x9 == obj) {
    // Canonical RO zone element → must use zalloc_ro_mut (PPL)
    zalloc_ro_mut(8, obj, field_offset, &new_value, 4);
} else {
    // Stack/heap copy → direct store (NO PPL, NO lock)
    *(obj + field_offset) = new_value;
}
```

`sub_0xfffffff0082da0e0` (43 insns, 0 callers — dead code or indirect):
- Modifies zone 8 field at +0x20 (clears bit 0)
- No lock (no `casa`/`ldxr` before write)
- Direct store when `obj+0x10 != obj`

`sub_0xfffffff0082da498` (37 insns, 1 caller):
- Modifies zone 8 field at +0xb0
- No lock
- Direct store when `obj+0x10 != obj`

**Potential race/bypass vectors (THEORETICAL, UNVERIFIED):**

1. **Self-pointer corruption**: If we could corrupt `obj+0x10` to not equal `obj`, the direct-store path would be taken even for canonical RO zone elements. BUT: `obj+0x10` is itself in the RO zone, so we'd need PPL/physical write to corrupt it. Circular dependency.

2. **TOCTOU in multi-step credential updates**: Functions like `sub_0xfffffff007eac89c` (195 insns) acquire a lock (`casa` at insn [15]), then call `zalloc_ro_mut` at insn [32], then perform many `sub_0xfffffff0085d1234`/`sub_0xfffffff0085f00c4` calls (13 pairs). The long critical section might have interleaving issues if the lock isn't held throughout, or if the repeated sub-calls release/reacquire.

3. **Unlocked credential reads alongside locked writes**: Several callers read proc_ro fields without locking (reads don't need locks for correctness). But if a read happens during a concurrent `zalloc_ro_mut` write (which temporarily lifts PPL protection), the read might see a torn/intermediate value. This is the class of bug CVE-2025-24118 was in.

4. **PPL reentry counter race**: The PPL dispatch increments `thread+0x150` as a reentry counter. If we could manipulate this counter (it's in the thread struct, potentially writable with kernel R/W), we might confuse the PPL dispatch. For example, setting it to a large value before a PPL call might cause the exit path to NOT restore APRR to read-only (because `sub w12, w12, #1; cbnz x12, skip_aprr_restore`). This would leave PPL pages WRITABLE after the call returns.

**PPL reentry counter (MOST INTERESTING, iPad8,9):**

```asm
; PPL dispatch entry (0xfffffff007e5c97c):
0xfffffff007e5c98c  mrs      x10, tpidr_el1
0xfffffff007e5c990  ldr      w12, [x10, #0x150]    ; read PPL reentry counter
0xfffffff007e5c994  add      w12, w12, #1           ; increment
0xfffffff007e5c998  str      w12, [x10, #0x150]     ; store back

; PPL dispatch exit (after handler returns):
0xfffffff007e5c9d8  sub      w12, w12, #1           ; decrement
0xfffffff007e5c9dc  str      w12, [x10, #0x150]     ; store
0xfffffff007e5c9e0  cbnz     x12, skip_aprr_restore ; if count > 0, DON'T restore APRR!
; ... (only restores APRR to RO when count reaches 0)
```

**Attack scenario**: With kernel R/W, set `thread+0x150 = 1` on a thread BEFORE it enters PPL. When the handler returns, it decrements to 1 (not 0), so it SKIPS the APRR restore. PPL pages remain writable. Next kernel R/W operations can write to proc_ro/ucred directly.

**WARNING**: This offset (0x150) needs verification. The `thread+0x150` on iPad might not be directly writable from our kernel R/W if it's in a protected region. Also, the kernel might validate the counter or panic on unexpected values. MUST test carefully.

**To verify**: Read `thread+0x150` via REPL for our own thread. It should be 0 (no PPL calls in progress). If readable and writable, this is a viable PPL bypass on iPad8,9.

## IPC Space Table Decode (iPad 18.3.2)

Findings from REPL investigation on SpringBoard (pid 33):

- `task->itk_space` at task+0x318 is PAC-signed with autda (discriminator includes 0x8280)
- `ipc_space->is_table` at space+0x20 is PAC-signed with autda (discriminator includes 0xb8b5)
- Confirmed from `ipc_space_terminate` at 0xfffffff007e8cc8c:
  ```
  ldr  x16, [x8, #0x20]!    // load is_table
  mov  x17, x8               // context = &space->is_table
  movk x17, #0xb8b5, lsl #48 // discriminator
  autda x16, x17             // authenticate
  ```
- The table pointer is a plain PAC-signed pointer with low alignment bits (0x3)
- Correct decode: `xpaci(raw) & ~0x1F` — strip PAC then alignment bits
- **DO NOT use kalloc array decode** (`decodeTablePointer`) — it corrupts the pointer
  - `usesKallocArrays` in DeviceProfile is for other purposes, not IPC tables on this build
  - The kalloc decode checks bit 38 (zoneMask) which is NOT set for IPC table pointers
  - Previous bug: decode produced 0x4000000000 (just the zoneMask) instead of the real address

Example from REPL:
- tableRaw = 0xe09dd59c072c8003
- xpaci(tableRaw) = 0xffffff9c072c8003
- Correct table base = 0xffffff9c072c8000 (& ~0x1F)

## Jetsam / Memorystatus Control (iPad 18.3.2)

From opcodex disassembly of memorystatus_control at 0xfffffff00833aa3c:

| CMD | Name | Handler | Args | Effect |
|-----|------|---------|------|--------|
| 5 | SET_JETSAM_HIGH_WATER_MARK | 0x833ac48 | pid, limit | Non-fatal (is_fatal=0). limit<1 → system default |
| 6 | SET_JETSAM_TASK_LIMIT | 0x833ac58 | pid, limit | Fatal (is_fatal=1). limit<1 → system default |
| 16 | SET_PROCESS_IS_MANAGED | 0x833ad4c | pid, managed | managed=0: clears bit 11 (0x800) of proc+0x6B4 |

Key proc struct offsets for memorystatus:
- proc+0x6B4: p_memstat_state (bit 11=MANAGED, bit 13=FATAL_ACTIVE, bit 14=LIMIT_SET, bit 15=IS_FATAL)
- proc+0x6F8: p_memstat_memlimit_active (int32, MB)
- proc+0x6FC: p_memstat_memlimit (soft limit)
- proc+0x700: p_memstat_memlimit_inactive

DarkSword pattern (pe_main.js:6658):
```
memorystatus_control(5, pid, -1, 0, 0)   // reset highwater
memorystatus_control(16, pid, 0, 0, 0)   // unmanage
memorystatus_control(6, pid, 0, 0, 0)    // reset task limit
```

Note: memorystatus_control returns errors (carry=1) when called from non-root processes like SpringBoard. Works from launchd (pid=1).

## Guard AST Crash Path (iPad 18.3.2)

From crash log analysis and opcodex:

Mach port guard exceptions (guard_type=1, subcode <= 0x80) are **unconditionally fatal**:
```
ast_taken_user (0x7e97124)
  → bit 12 (AST_GUARD=0x1000) → guard_ast (0x7efbb24)
    → type 1 dispatch → sub_0x7e95aa4
      → exception_triage (delivers to port)
      → exit_with_mach_exception(flags=5) → SIGKILL
```

The task->exc_guard FATAL flag is NOT checked for subcode <= 0x80. Kill happens regardless.

guard_ast reads and zeros thread+0x320 (guardExcCode) and thread+0x328 (guardExcCodeData), then dispatches based on top 3 bits of guardExcCode.

## IPC Table Scanning Technique (iPad 18.3.2)

### Overview
Scan a task's IPC space table to find the port name for a kernel object (e.g., thread).
This was developed for finding newly created thread ports but can be used for any kobject lookup.

### How it works
1. Read task->itk_space at task+0x318 (PAC-signed with autda, disc 0x8280)
2. Strip PAC: `xpaci(spaceRaw)` → space address
3. Read space->is_table at space+0x20 (PAC-signed with autda, disc 0xb8b5)
4. Decode table: `xpaci(tableRaw) & ~0x1F` (strip PAC + alignment bits)
5. Iterate entries: `table + index * 0x18` (stride = 0x18)
6. For each entry: read ie_object at entry+0x0 (PAC-signed port pointer)
7. Strip to get port address: `xpaci(ie_object)`
8. Read ip_kobject at port+0x48
9. Strip: `xpaci(kobject)` → compare with target kernel address

### Port Name Format
Port names include generation bits: `name = (index << 8) | (gen >> 24)`
- Generation is in ie_bits (entry+0x8) bits 24-31
- Missing generation causes MACH_SEND_INVALID_DEST when using the port

### ie_bits Decode (entry+0x8)
```
bits 0-15:  user references (urefs)
bit 16:     MACH_PORT_TYPE_SEND (0x10000)
bit 17:     MACH_PORT_TYPE_RECEIVE (0x20000)
bit 18:     MACH_PORT_TYPE_SEND_ONCE (0x40000)
bits 24-31: generation counter
```

### Known Issues
- Table pointer decode (`xpaci & ~0x1F`) works on most boots but can produce invalid addresses on some ASLR layouts where xpaci misinterprets the VA bits
- Guard check: validate table address > 0xffffff0000000000 before scanning
- SpringBoard has many ports (500+ entries) — scan up to 2000
- DO NOT use `decodeTablePointer` (kalloc array decode) for IPC tables on iPad 18.3.2 — corrupts the pointer

### Alternative: DarkSword Approach (Preferred)
Instead of scanning the IPC table, DarkSword uses:
1. `pthread_create_suspended_np(outPtr, ...)` → stores pthread_t at *outPtr
2. Read pthread_t via `OSAtomicAdd64(0, outPtr)` (returns *outPtr + 0 = *outPtr)
3. `pthread_mach_thread_np(pthread_t)` → returns mach_port_t with proper send right

This avoids all IPC table decode issues and gives a guaranteed valid send right.

### Offsets Reference
| Field | Offset | Notes |
|-------|--------|-------|
| task->itk_space | +0x318 | autda signed, disc 0x8280 |
| space->is_table | +0x20 | autda signed, disc 0xb8b5 |
| IPC entry stride | 0x18 | |
| entry->ie_object | +0x00 | PAC-signed port pointer |
| entry->ie_bits | +0x08 | type + generation + urefs |
| port->ip_kobject | +0x48 | PAC-signed kobject pointer |
