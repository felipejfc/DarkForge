# Offsets

This document tracks the current live offset surface for DarkForge after the
MIG bypass removal and the darksword-kexploit-fun offset port.

The goal is to answer one question for new `device + iOS build` support:
which offsets and per-target constants are actually needed by the current app.

## Single Source of Truth: DeviceProfile

All kernel structure offsets live in `DarkForge/Exploit/DeviceProfile.swift`.
There are no separate "verified profiles" — every device goes through the
same `DeviceProfile.resolve()` path:

1. **Version-based seed**: sets base offsets from iOS version + CPU family.
2. **Per-device table**: refines offsets for specific device families/models
   (includes IDA-verified values like `kernelTask`, `proPid`, `ptovTableOffset`).
3. **Stable defaults**: offsets verified across iOS 17–26 have default values
   in the struct and are overridable if a future kernel changes them.

Forwarding enums in `Offsets.swift` and `PrivilegeEscalation.swift` expose
these values under their original names so call sites stay unchanged.

## Per-Profile Fields

These are the fields currently modeled in
`DarkForge/Exploit/DeviceProfile.swift`.

### Core exploit flow (required)

| Field | Source | Why |
| --- | --- | --- |
| `kernelTask` | Per-device (JSTable) | `kernel_task` bootstrap and task walking. **TODO per device** — reference does not provide this. |
| `kstackptr` | DarkSword seed | Caller-thread stack scan during TRO swap |
| `threadTRO` | DarkSword seed | TRO reads, TRO swap, `exc_actions` lookup |
| `threadTaskThreads` | DarkSword seed | Thread list walking |
| `threadOptions` | DarkSword seed | Thread options reads |
| `threadCTID` | DarkSword seed | Mutex ownership setup for injection |
| `threadAST` | DarkSword seed | `AST_GUARD` injection and cleanup |
| `threadMutexData` | DarkSword seed | Thread lock word writes |
| `guardExcCode` | DarkSword seed | Guard exception injection and cleanup |
| `guardExcCodeData` | DarkSword seed | Guard exception payload and cleanup |
| `taskIpcSpace` | DarkSword seed | IPC space lookup and port forging |
| `procRO` | Per-device (JSTable) | Task to proc lookup. **TODO per device** — reference does not provide this. |
| `excGuard` | DarkSword seed | `EXC_GUARD` delivery setup |
| `proPid` | Per-device only | PID matching from proc_ro. **TODO per device** — reference does not provide this. |
| `proComm` | Per-device (JSTable) | Process-name matching from proc_ro. **TODO per device** — reference does not provide this. |
| `icmp6Filter` | DarkSword seed | Early PCB corruption and kRW bootstrap |
| `socketSoCount` | DarkSword seed | Socket leak to keep kRW alive |
| `ipcSpaceTable` | DarkSword seed | IPC table pointer decode |
| `ipcPortKObject` | DarkSword seed | IPC port kobject lookup |
| `troPacRopPid` | DarkSword seed | TRO ROP PID for PAC key reads |
| `troPacJopPid` | DarkSword seed | TRO JOP PID for PAC key reads |

### Ported from darksword-kexploit-fun (auto-populated by seed)

| Field | Source | Why |
| --- | --- | --- |
| `socketSoProto` | DarkSword seed | socket→so_proto (0x18 on 17.0–17.3, 0x20 on 17.4+) |
| `socketSoBackgroundThread` | DarkSword seed | socket→so_background_thread for proc_self |
| `threadRoTroProc` | DarkSword seed | thread_ro→tro_proc navigation |
| `threadRoTroTask` | DarkSword seed | thread_ro→tro_task navigation |
| `threadMachineUpcb` | DarkSword seed | thread→machine.upcb (user PCB) |
| `threadMachineJopPid` | DarkSword seed | thread→machine.jop_pid (0xdeaddead on A10) |
| `procPName` | DarkSword seed | proc→p_name (0x579/0x57d) |
| `procPFd` | DarkSword seed | proc→p_fd (filedesc pointer) |
| `procPFlag` | DarkSword seed | proc→p_flag |
| `procPTextvp` | DarkSword seed | proc→p_textvp (text vnode) |
| `procRoUcred` | DarkSword seed | proc_ro→p_ucred (0x20, changes in 18.4+) |
| `taskThreadsNext` | DarkSword seed | task→threads.next (0x58 on 17.x, 0x50 on 18.x+) |
| `labelAmfi` | DarkSword seed | label→l_perpolicy AMFI slot |
| `labelSandbox` | DarkSword seed | label→l_perpolicy sandbox slot |

### Physical translation (per-device, manual)

| Field | Source | Why |
| --- | --- | --- |
| `ptovTableOffset` | Per-device IDA | **TODO per device** — reference does not provide. iPad: ptov_table from phystokv_range. |
| `physBaseStructOffset` | Per-device IDA | **TODO per device** — reference does not provide. iPhone: SPTM physBase struct. |

### Stable offsets (defaults in DeviceProfile, overridable per-device)

These offsets have been verified stable across iOS 17–26. They have default
values in the `DeviceProfile` struct and do not need to be specified unless a
future kernel build changes them.

| Group | Fields | Forwarding enum |
| --- | --- | --- |
| PCB / socket / discovery | pcbToSocket, pcbListEntry, pcbListNext, pcbGencnt, pcbToPcbinfo, socketToProto, protoToInput | `KernelOffsets` |
| IPC | ipcEntryStride, ipcEntryBits, ipcPortNsRequest, ipcPortIoReferences, ipcPortIpSrights, ipcPortIpSorights | `IPCOffsets` |
| Kernel stack | kstackKernelSP, kstackScanRegion | `KstackOffsets` |
| Exception actions | excActionsStride, excBadAccessPort, excBadAccessBehavior, excGuardPort, excGuardBehavior | `ExcActionsOffsets` |
| Kernel discovery | machOMagic, machOCpuType, pageAlignMask, unslidKernelBase, pcbinfoToIpiZone, ipiZoneToZvName, machOCpuTypeOffset | `KernelDiscoveryConstants` |
| Task / thread / proc | taskNext, taskPrev, taskThreadsQueueHead, taskThreadsOffset, procPidOffset, ucredUid, ucredGid, ucredSvuid, ucredNgroups, troExcActions, troVerifyDelta, taskExcGuardMpDeliver, taskExcGuardMpCorpse, taskExcGuardMpFatal, astGuard | `PEOffsets` |

## Per-Profile Constants

| Field | Used now | Needed for new target | Why |
| --- | --- | --- | --- |
| `isA18` | Yes | Yes | Branches active behavior in `KExploit` and `RemoteCall` |
| `t1szBoot` | Yes | Yes | Drives IPC table decode through `decodeTablePointer()` |
| `usesKallocArrays` | Yes | Yes | Same |
| `name` | Log/export only | No | Logging and REPL metadata |

## Removed From Active Schema

| Field | Status |
| --- | --- |
| `migLock` | Removed |
| `migSbxMsg` | Removed |
| `migKernelStackLR` | Removed |
| `sbEvalCallerOffsets` | Removed |
| `threadJopDisable` | Removed — signing now handled by PAC oracle |
| `pacizaGadget` | Removed — signing now handled by PAC oracle |

## Porting Guidance

For a new target:

1. The DarkSword seed auto-populates most offsets based on iOS version and CPU
   family. Verify the device is detected correctly (check CPU family constants).

2. Manually find these per-device offsets (marked **TODO** above):
   - `kernelTask` — offset from kernel base to `kernel_task` global in __DATA
   - `procRO` — task→proc_ro offset (varies per device/build)
   - `proPid` — proc_ro→p_pid offset
   - `proComm` — proc→p_comm or proc_ro→p_comm offset
   - `ptovTableOffset` — kernel base to ptov_table (iPad) or 0 (iPhone)
   - `physBaseStructOffset` — kernel base to SPTM physBase struct (iPhone) or 0 (iPad)

3. Use the `find-ios-kernel-offsets` skill and IDA probe scripts for recovery.
