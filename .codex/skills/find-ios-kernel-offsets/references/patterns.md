# Offset Patterns

This is the repo-local lookup oracle for DarkForge's app-side offsets.

The goal is not to memorize values. The goal is to know where to look in the
kernelcache, what instruction shape proves the field, and which fields are
still semantically muddy.

## Calibrated Inputs

- iPhone 17,4 / 22G86:
  `./ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4.i64`
- iPhone symbol map:
  `./ipsw/22G86__iPhone17,4/symbols/kernelcache.release.iPhone17,4.symbols.json`
- iPhone 15 Pro / 22E240:
  `./ipsw/22E240__iPhone16,1/kernelcache.release.iphone16.i64`
- iPhone 15 Pro / 22E240 symbol map:
  `./ipsw/22E240__iPhone16,1/symbols/kernelcache.release.iPhone16,1.symbols.json`
- iPad 8,9 / 22D82:
  `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/kernelcache.release.iPad8,9_10_11_12.i64`
- iPad symbol map:
  `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/.opcodex/kernelcache.release.iPad8_9_10_11_12/cache/ipsw/outputs/kernelcache.release.iPad8,9_10_11_12.symbols.json`

## Read This First

- `task`, `thread`, `ipc_space`, `socket`, and `inpcb` offsets are recoverable
  directly from the kernelcache.
- `proPid` is still the muddiest identity field in DarkForge because the repo
  mixes `proc` and `proc_ro` semantics across builds.
- `pacizaGadget` is not a kernelcache offset. It comes from the dyld shared
  cache.
- Some iPad values conflict between the current Swift profile and the later
  investigation notes. Those conflicts are called out explicitly below.

## Strong Anchors

These are the best fields to recover first on a new target because the patterns
are crisp and the instruction shapes are obvious.

| Field | iPhone 22G86 | iPad 22D82 | Recovery Rule |
| --- | --- | --- | --- |
| `kstackptr` | `Switch_context` trampoline: `mrs x4, tpidr_el1; add x6, x4, #0x148; ldr x5, [x6]` | `Switch_context`: `add x6, x4, #0xf0`; cross-check `thread_deallocate_complete: str xzr, [x19, #0xf0]` | Look for the current-thread `tpidr_el1` path that derives a pointer used as the kernel stack slot. |
| `threadTRO` | local verified helper: `get_thread_ro` loads `[thread + 0x3f0]` | `machine_switch_context` loads `[old_thread + 0x378]` and `[new_thread + 0x378]` | Recover the per-thread RO pointer from the helper or the context-switch path. |
| `threadOptions` | `sub_FFFFFFF0081C7A00` in the `thread_set_state` path: `ldrsh w8, [x0, #0xc0]` and `ldrsh w8, [x19, #0xc0]` | `sub_FFFFFFF007EFDD28` in the `thread_set_state` path: `ldrsh w8, [x19, #0x70]` | Recover it from the thread-state set/convert helper chain, not from PAC-skip logic. |
| `threadCTID` | `_exception_triage_thread` `0xfffffff0081458b4: ldr w10, [x23, #0x4b0]` | `exception_triage_thread` `0xfffffff007ea35d4: ldr w9, [x23, #0x420]` | In `exception_triage_thread`, find the compact thread ID load right before the mutex CAS sequence. |
| `threadMutexData` | `_exception_triage_thread` `0xfffffff0081458b8: add x27, x22, #0x420` | `exception_triage_thread` `0xfffffff007ea35d8: add x10, x22, #0x3a0` | Same function as `threadCTID`: find the address used by `casa` / `casl`. |
| `threadAST` | `_ast_taken_user` `ldr w10, [x19, #0x414]`; docs also show `thread_terminate` `add x8, x19, #0x414` + `ldclr` | `ast_taken_user` `ldr w10, [x19, #0x394]`; docs also show `thread_terminate` `add x8, x19, #0x394` + `ldclr` | Use `ast_taken_user` or `thread_terminate`. The AST field is the one tested against `AST_GUARD` and atomically cleared. |
| `guardExcCode` | `_mach_exception_ast` `0xfffffff0081c53f8: ldr w22, [x0, #0x398]` | `guard_ast` `0xfffffff007efbb34: ldr x1, [x0, #0x320]` | Follow the AST_GUARD dispatch, not the BSD guard path. |
| `guardExcCodeData` | `_mach_exception_ast` `0xfffffff0081c5400: ldr x20, [x0, #0x3a0]` | `guard_ast` `0xfffffff007efbb38: ldr x2, [x0, #0x328]` | On modern split layouts, this is the payload field next to `guardExcCode`. |
| `taskIpcSpace` | `convert_port_to_space_read`: `ldr x16, [x20, #0x318]` then `autda` | task terminate path: `ldr x16, [x19, #0x318]` + `autda` | Look for the authenticated `itk_space` load from a `task *`. |
| `procRO` | `_task_deallocate_internal`, `_task_info`, `_task_set_pac_exception_fatal_flag` all load `[task + 0x3e0]` | `task_deallocate_internal`, `task_set_pac_exception_fatal_flag`, `task_set_jit_exception_fatal_flag` all load `[task + 0x3a0]` | Use task-centric functions that must dereference the process metadata pointer. |
| `excGuard` | `_Xtask_set_exc_guard_behavior` `0xfffffff0081ff128: str w9, [x0, #0x624]` | `_Xtask_set_exc_guard_behavior` `0xfffffff007f32fcc: str w9, [x0, #0x5dc]` | The setter path is the cleanest proof. |
| `ipcPortKObject` | `_mach_port_kobject_description_from_user` `add x9, x23, #0x48; ldr x16, [x23, #0x48]` | `mach_port_kobject_description_from_user` `ldr x16, [x9, #0x48]!` | Prefer kobject-description helpers; they expose the field directly. |
| `icmp6Filter` | `_icmp6_dgram_attach` `0xfffffff00855dc50: str x8, [x19, #0x148]` | `icmp6_dgram_attach` `0xfffffff008258534: str x8, [x19, #0x148]` | Search `icmp6_dgram_attach`; the store into the inpcb is the field. |
| `socketSoCount` | iPhone local notes: `soclose` reads `thread/socket + 0x254`; current repo historically used `0x254` | `soclose` `0xfffffff00837e07c: ldr w8, [x19, #0x254]` and later `str w9, [x19, #0x254]` | In `soclose`, identify the decrement/store of the socket refcount. |
| `ipcSpaceTable` | `_ipc_space_terminate` `0xfffffff00812f39c: ldr x16, [x19, #0x20]` + `autda` | `ipc_space_terminate` `0xfffffff007e8ccec: ldr x16, [x8, #0x20]!` + `autda` | Find the authenticated table-pointer load from `ipc_space`. |
| `threadJopDisable` | `machine_thread_state_convert_from_user` `0xfffffff0082cc544: ldrb w8, [x20, #0xf8]; tbnz w8, #1, skip_pac` | `machine_thread_state_convert_from_user` `0xfffffff007fedd98: ldrb w8, [x22, #0xa8]; tbnz w8, #1, skip_pac` | Hunt the first byte load guarded by `tbnz bit 1` in the PAC-skip path. |
| `proComm` | `_thread_update_process_threads`, `_task_info`, `_task_port_space_ast`, `_bsdinit_task` all derive `proc + 0x56c` | `task_wakeups_rate_exceeded`, `task_deallocate_internal`, `bsdinit_task`, `ktrace_set_owning_proc` all derive `proc + 0x56c` | This is a proc-side field on both known targets. |

## What Is Actually Weak

These are the fields that are still genuinely weak after the dual-device pass:

- `proPid`
  Why weak: the app-side schema still collapses proc-side and proc_ro-side PID
  semantics. Static scans did not produce a clean dual-device proof for the
  current single-field model.
- `physBaseStructOffset`
  Why weak: it is an iPhone-only SPTM mechanism with no direct iPad analogue,
  so the second device does not provide a cross-checking pattern.

These are medium-confidence, not weak:

- `kernelTask`
  The function family is right (`task_init` / task bootstrap global store), but
  the current pass only has a strong fresh iPad proof.
- `threadTaskThreads`
  The internal `task_threads` queue-walk pattern is good, but the current pass
  only re-extracted the iPad-side direct dereference.

## Per-Offset Notes

### `kernelTask`

- What it is:
  kernel-base-relative offset of the `kernel_task` global pointer.
- Best function family:
  `task_init`, `task_suspend_internal`, or task bootstrap helpers that seed the
  singleton task globals.
- iPad strong clue:
  `task_init` at `0xfffffff007ee6a94` stores `x0` through an `adrp + imm`
  target, giving `0x9f4f08` from the unslid base.
- iPhone state:
  the current verified app value is `0xc1bf78`, but this pass did not recover a
  fresh direct store/load anchor.
- How to find on a new build:
  search for the first global store of the boot `task *`; compute
  `(adrp_page + imm) - kernel_base`.
- Warning:
  this is medium-confidence, not structurally weak. The function family is
  stable; the remaining gap is a fresh iPhone-side re-extraction.

### `kstackptr`

- iPhone:
  `Switch_context` trampoline uses `tpidr_el1 + 0x148`.
- iPad:
  `Switch_context` uses `tpidr_el1 + 0xf0`, then
  `thread_deallocate_complete` clears `[thread + 0xf0]`.
- New-target clue:
  the correct field is the per-thread slot used to fetch the current kernel
  stack pointer immediately after `mrs ..., tpidr_el1`.

### `threadTRO`

- iPhone:
  `get_thread_ro` loads `ldr x1, [x0, #0x3f0]`.
- iPad:
  `machine_switch_context` shows `ldr x8, [x21, #0x378]` and
  `ldr x8, [x19, #0x378]`.
- New-target clue:
  find the helper that turns `thread *` into `thread_ro *`, or inspect
  `machine_switch_context` for the per-thread RO pointer load.
- Warning:
  the current Swift iPad profile says `0x370`, but the later notes and fresh
  batch evidence point at `0x378`. This is an active conflict.

### `threadTaskThreads`

- Best function family:
  internal `task_threads` queue walk, not the MIG wrapper.
- iPad strong clue:
  `task_threads` at `0xfffffff007eebfb0` does
  `ldr x26, [x26, #0x360]`.
- iPhone state:
  the live profile uses `0x3e0`, but this pass did not recover the internal
  queue-walk symbol directly.
- New-target clue:
  look for the field dereferenced on each iteration of the task's thread queue.
- Warning:
  this is medium-confidence. The function family is good, but the current pass
  only re-extracted the iPad direct load.

### `threadOptions`

- Best function family:
  `thread_set_state` / `thread_convert_thread_state` helper chain.
- iPhone proof:
  `sub_FFFFFFF0081C7A00` loads `ldrsh w8, [x0, #0xc0]` and
  `ldrsh w8, [x19, #0xc0]`.
- iPad proof:
  `sub_FFFFFFF007EFDD28` loads `ldrsh w8, [x19, #0x70]`.
- New-target clue:
  start from `_Xthread_set_state_from_user`, then inspect the internal helper
  that manipulates thread-state set-up before the final machine conversion.
- Resolution:
  the known iPad conflict is resolved in favor of `0x70`. The later `0xc0`
  note is not supported by the direct iPad batch pass.

### `threadCTID`

- Reliable anchor:
  `exception_triage_thread`.
- Pattern:
  a `ldr wN, [current_thread, #imm]` immediately before `casa`.

### `threadAST`

- Reliable anchors:
  `ast_taken_user` and `thread_terminate`.
- Pattern:
  the AST field is both loaded for dispatch and targeted by `ldclr`.
- Third datapoint:
  on `iPhone16,1/22E240`, `thread_terminate` shows `add x8, x19, #0x404`.

### `threadMutexData`

- Reliable anchor:
  `exception_triage_thread`.
- Pattern:
  the mutex word is the address passed to `casa` or `casl`.
- Third datapoint:
  on `iPhone16,1/22E240`, `exception_triage_thread` shows
  `add x27, x22, #0x410`.

### `guardExcCode` / `guardExcCodeData`

- Use the Mach guard path, not the BSD guard path.
- iPhone:
  `_mach_exception_ast` is the cleanest proof.
- A17 datapoint:
  on `iPhone16,1/22E240`, the symbolicated target uses `guard_ast` directly and
  reads `ldr x20, [x0, #0x390]` plus `ldr x19, [x0, #0x398]`.
- iPad:
  `ast_taken_user` branches to `guard_ast` when bit 12 is set.
- New-target clue:
  start from `ast_taken_user`, find the AST_GUARD branch, and inspect the
  callee that reads and zeroes the guard payload.

### `taskIpcSpace`

- Reliable anchor:
  `convert_port_to_space_read` or a task teardown path that immediately
  authenticates the field with `autda`.
- Pattern:
  `ldr x16, [xTask, #imm]` followed by `autda`.
- Third datapoint:
  on `iPhone16,1/22E240`, `exception_triage_thread` also reaches
  `ldr x9, [x8, #0x318]`.

### `procRO`

- Best function family:
  task-centric helpers plus `proc_ro_ref_task` for semantic confirmation.
- iPhone proof:
  `_task_deallocate_internal`, `_task_info`, `_task_set_pac_exception_fatal_flag`,
  `_task_set_jit_flags`, and `_task_generate_corpse_internal` all load
  `[task + 0x3e0]`.
- iPad proof:
  `task_deallocate_internal`, `task_set_pac_exception_fatal_flag`, and
  `task_set_jit_exception_fatal_flag` all load `[task + 0x3a0]`.
- New-target clue:
  search task functions that need process metadata and look for the repeated
  load of the process metadata pointer from the task object.
- Status:
  no longer weak. The task-side field is structurally solid on both builds.
- A17 datapoint:
  the `22E240` pass did not finish a direct local `task + 0x3e0` line
  extraction, so use the 22G86 and JS-family evidence as the current guide for
  A17 until a dedicated helper pass is completed.

### `excGuard`

- Reliable anchor:
  `_Xtask_set_exc_guard_behavior`.
- Pattern:
  setter writes `str wN, [xTask, #imm]`; getter reads the same location.
- Third datapoint:
  on `iPhone16,1/22E240`, `_Xtask_set_exc_guard_behavior` writes
  `str w9, [x0, #0x624]`.

### `troPacRopPid` / `troPacJopPid`

- These are paired PAC-related fields and must be reasoned about together.
- iPad strong clues:
  - `Switch_context` loads `[thread + 0x158]` into `APIBKEY*`.
  - exception return loads `[thread + 0x160]` into `APIAKEY*`.
- iPhone strong clue:
  earlier investigation notes show an IA-key auth helper reading
  `[thread_or_tro + 0x1c0]`.
- New-target clue:
  inspect `Switch_context`, exception return, and `machine_thread_set_state`
  call chains. The paired field is usually 8 bytes below or above the visible
  IA-key field.
- Warning:
  the repo's naming is historical. The semantic PAC-key meaning is easy to
  mislabel across generations.

### `proPid` / `proComm`

- `proComm` is now structurally strong and proc-side.
- iPhone proof for `proComm`:
  `_thread_update_process_threads`, `_task_info`, `_task_port_space_ast`,
  `_task_wakeups_rate_exceeded`, `_bsdinit_task`, and `_ktrace_set_owning_proc`
  all derive `proc + 0x56c`.
- Third datapoint:
  on `iPhone16,1/22E240`, `_thread_update_process_threads` still shows
  `add x8, x8, #0x56c`.
- iPad proof for `proComm`:
  `task_wakeups_rate_exceeded`, `task_deallocate_internal`, `task_info`,
  `bsdinit_task`, `ktrace_set_owning_proc`, and `so_set_effective_pid`
  all derive `proc + 0x56c`.
- `proPid` remains the bad one.
- Why `proPid` is still weak:
  static scans did not produce a clean dual-device proof for the current
  single-field DarkForge model. The likely proc-side PID field is low in the
  struct and distinct from the proc_ro-style candidate, which means the app
  schema wants a split field, not more guessing.
- New-target clue:
  recover `procRO` first. Then separately identify:
  1. proc-side name field
  2. proc-side PID field
  3. proc_ro-side identity fields, if the target build uses them
  Validate against a known PID or process name like `launchd`.
- Recommendation:
  keep `proComm` and `proPid` mentally separate. `proComm` is structurally
  recoverable; `proPid` still needs both static recovery and runtime identity
  validation, and ideally a schema split in the app.

### `icmp6Filter`

- Reliable anchor:
  `icmp6_dgram_attach`.
- Pattern:
  store of the new filter pointer into the inpcb.

### `socketSoCount`

- Reliable anchor:
  `soclose`.
- Pattern:
  load/decrement/store of the refcount field.

### `ipcSpaceTable`

- Reliable anchor:
  `ipc_space_terminate`.
- Pattern:
  authenticated table-pointer load from `ipc_space`.

### `ipcPortKObject`

- Best function family:
  `mach_port_kobject_description_from_user` and related kobject-description
  helpers.
- iPhone proof:
  `_mach_port_kobject_description_from_user` does
  `add x9, x23, #0x48; ldr x16, [x23, #0x48]`.
- Third datapoint:
  the `22E240` symbol map contains `mach_port_kobject_description_from_user`,
  but this pass did not finish a clean direct field-line extraction from that
  function window.
- iPad proof:
  `mach_port_kobject_description_from_user` does
  `ldr x16, [x9, #0x48]!`.
- New-target clue:
  prefer the kobject-description helper over generic `ipc_port_*` destroy paths;
  it exposes the field directly.
- Status:
  no longer weak. The offset is structurally solid on both known builds.

### `threadJopDisable`

- Reliable anchor:
  `machine_thread_state_convert_from_user`.
- Pattern:
  first byte load tested with `tbnz bit 1` on the PAC-skip path.

### `ptovTableOffset`

- iPad only.
- Best function family:
  `phystokv_range`.
- Current state:
  the iPad batch pass resolved `phystokv_range` at `0xfffffff007fdd814`, but
  not the exact `adrp/add` table-base sequence in the initial window.
- New-target clue:
  extend the window around `phystokv_range` until you find the load of the
  inline `{pa, va, len}` table, then convert that global VA to a kbase-relative
  offset.

### `physBaseStructOffset`

- iPhone only.
- Best clue:
  PA->KVA helpers for the SPTM linear translation path.
- Current state:
  the app uses a `{virtBase, physBase}` struct offset, but this pass did not
  recover a fresh dual-device anchor.
- New-target clue:
  search SPTM PA->KVA helpers for a two-qword global struct used as the linear
  translation base.

### `pacizaGadget`

- Not a kernelcache field.
- Recover it from the dyld shared cache.
- Best clue:
  find a stable `paciza x0; ret` or a `signPointer`-style helper and record its
  unslid address.

## Current Conflicts And Weak Spots

Re-prove these before trusting the current repo values:

- iPad `kernelTask`: Swift profile comment and later investigation notes differ.
- iPad `threadTRO`: current code says `0x370`; fresh batch evidence points at
  `0x378`.
- iPhone16,1 `threadOptions`: family/reference says `0xc0`, but this pass did
  not complete a fresh direct helper-line extraction.
- `proPid`: current app semantics are still inconsistent across builds.
- `physBaseStructOffset`: still weakly documented.

## Practical Order For New Targets

1. Recover the strong task/thread/socket/IPC fields first.
2. Recover PAC-related fields only after the basic thread layout is proven.
3. Leave proc/proc_ro identity fields until the end and validate them at
   runtime.
4. Keep unresolved fields blank rather than copying guesses into `DeviceProfile`.
