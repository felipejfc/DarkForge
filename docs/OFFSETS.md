# Offsets

This document tracks the current live offset surface for DarkForge after the
MIG bypass removal.

The goal is to answer one question for new `device + iOS build` support:
which offsets and per-target constants are actually needed by the current app.

## Per-Profile Fields

These are the fields currently modeled in
`DarkForge/Exploit/DeviceProfile.swift`.

| Field | Used now | Needed for new target | Why |
| --- | --- | --- | --- |
| `kernelTask` | Yes | Yes | `kernel_task` bootstrap and task walking |
| `kstackptr` | Yes | Yes | Caller-thread stack scan during TRO swap |
| `threadTRO` | Yes | Yes | TRO reads, TRO swap, `exc_actions` lookup |
| `threadTaskThreads` | Yes | Yes | Thread list walking |
| `threadCTID` | Yes | Yes | Mutex ownership setup for injection |
| `threadAST` | Yes | Yes | `AST_GUARD` injection and cleanup |
| `threadMutexData` | Yes | Yes | Thread lock word writes |
| `guardExcCode` | Yes | Yes | Guard exception injection and cleanup |
| `guardExcCodeData` | Yes | Yes | Guard exception payload and cleanup |
| `taskIpcSpace` | Yes | Yes | IPC space lookup and port forging |
| `procRO` | Yes | Yes | Task to proc lookup |
| `excGuard` | Yes | Yes | `EXC_GUARD` delivery setup |
| `proPid` | Yes | Yes | PID matching while walking tasks |
| `proComm` | Yes | Yes | Process-name matching |
| `icmp6Filter` | Yes | Yes | Early PCB corruption and kRW bootstrap |
| `socketSoCount` | Yes | Yes | Socket leak to keep kRW alive |
| `troPacRopPid` | No | No | Present in the profile, not used by live app logic |
| `troPacJopPid` | Export-only | No | Exported to REPL metadata, not required by exploit flow |
| `ptovTableOffset` | No | No today | Used only by `PhysTranslation`, not wired into current runtime |
| `physBaseStructOffset` | No | No today | Used only by `PhysTranslation`, not wired into current runtime |

## Per-Profile Constants

These are not offsets, but they are still per-target values required by the
current runtime.

| Field | Used now | Needed for new target | Why |
| --- | --- | --- | --- |
| `isA18` | Yes | Yes | Branches active behavior in `KExploit` and `RemoteCall` |
| `t1szBoot` | Yes | Yes | Drives IPC table decode through `decodeTablePointer()` |
| `usesKallocArrays` | Yes | Yes | Same |
| `name` | Log/export only | No | Logging and REPL metadata |

## Hardcoded But Still In Play

These values are still used by the app, but they are currently assumed to be
stable and are not modeled per target.

| Group | Where | Notes |
| --- | --- | --- |
| Task list and task-thread queue offsets | `DarkForge/Exploit/PrivilegeEscalation.swift` | `taskNext`, `taskPrev`, `taskThreadsQueueHead`, `taskThreads` |
| Thread and credential helpers | `DarkForge/Exploit/PrivilegeEscalation.swift` | `threadOptions`, `procPid`, `proUcred`, `ucred*`, `troExcActions`, `troVerifyDelta`, `astGuard` |
| IPC structure offsets | `DarkForge/Exploit/Offsets.swift` | `IPCOffsets` used by port forging and IPC table walking |
| Kernel stack helper offsets | `DarkForge/Exploit/Offsets.swift` | `KstackOffsets` used by launchd injection stack scanning |
| Exception action offsets | `DarkForge/Exploit/Offsets.swift` | `ExcActionsOffsets` used for exception-port verification and cleanup |

## Removed From Active Schema

These fields were removed when the MIG bypass was deleted from the live app and
are no longer needed for new target support.

| Field | Status |
| --- | --- |
| `migLock` | Removed |
| `migSbxMsg` | Removed |
| `migKernelStackLR` | Removed |
| `sbEvalCallerOffsets` | Removed |
| `threadJopDisable` | Removed — signing now handled by PAC oracle |
| `pacizaGadget` | Removed — signing now handled by PAC oracle |

## Porting Guidance

For a new target, collect all rows marked `Yes`.
