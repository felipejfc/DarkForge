---
name: find-ios-kernel-offsets
description: Use when you need to recover DarkForge's app-side iOS kernel offsets from a kernelcache, IDA database, or IPSW-derived symbol map. Focuses on the exact offsets DarkForge consumes, with cross-checks from the local iPhone17,4 22G86, iPhone16,1 22E240, and iPad8,9 22D82 studies.
---

# Find iOS Kernel Offsets

Use this skill to recover or validate the offsets DarkForge actually uses in
`DeviceProfile`.

Do not copy reference tables blindly. Recover the offsets DarkForge consumes,
prove them from the target kernelcache, and leave the unresolved ones blank.

## Repo Inputs

Use repo-relative paths so the skill is safe to keep in a public repository.

- iPhone raw kernelcache:
  `./ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4`
- iPhone IDA DB:
  `./ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4.i64`
- iPhone symbol map:
  `./ipsw/22G86__iPhone17,4/symbols/kernelcache.release.iPhone17,4.symbols.json`
- iPhone 15 Pro / 22E240 extracted kernelcache:
  `./ipsw/22E240__iPhone16,1/extracted/22E240__iPhone16,1/kernelcache.release.iPhone16,1`
- iPhone 15 Pro / 22E240 IDA DB:
  `./ipsw/22E240__iPhone16,1/kernelcache.release.iphone16.i64`
- iPhone 15 Pro / 22E240 symbol map:
  `./ipsw/22E240__iPhone16,1/symbols/kernelcache.release.iPhone16,1.symbols.json`
- iPad raw kernelcache:
  `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/kernelcache.release.iPad8,9_10_11_12`
- iPad IDA DB:
  `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/kernelcache.release.iPad8,9_10_11_12.i64`
- iPad symbol map:
  `./ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/.opcodex/kernelcache.release.iPad8_9_10_11_12/cache/ipsw/outputs/kernelcache.release.iPad8,9_10_11_12.symbols.json`
- Investigation notes:
  `docs/KERNEL-INVESTIGATION.md`

## What Counts As Done

For a new target, produce:

1. The DarkForge offsets directly proven from the target kernelcache.
2. The offsets still missing direct proof.
3. The offsets that are structurally plausible but currently dubious.
4. The exact functions and instructions used as proof.

## Core Rules

1. Only chase offsets DarkForge actually reads.
2. Prefer direct disassembly proof over reference-table carryover.
3. Use at least one anchor function, and a second cross-check when practical.
4. Treat proc/proc_ro and thread/thread_ro semantics as unstable until proven.
5. `threadJopDisable` and `pacizaGadget` have been removed from DeviceProfile.
   Signing is now handled entirely by the PAC oracle. Do not recover these.

## Symbolication

If you already have a `.symbols.json`, prefer passing it directly to the probe
script with `--symbols`.

That path intentionally mirrors the logic from `ipsw`'s IDA
`symbolicate.py`, but avoids baking host-specific plugin paths into the skill.

If you want to inspect the upstream implementation, a vendored copy may exist
under the target's `.opcodex/.../plugins/ida/symbolicate.py`.

For a fresh IPSW already added to `./ipsw`, the minimal workflow is:

```bash
REPO=$(pwd)
ipsw extract --kernel -o "$REPO/ipsw/22E240__iPhone16,1/extracted" \
  "$REPO/ipsw/iPhone16,1_18.4_22E240_Restore.ipsw"

ipsw kernel symbolicate -j \
  -s "$REPO/ipsw/22G86__iPhone17,4/.opcodex/kernelcache.release.iPhone17_4/cache/ipsw/symbolicator/kernel" \
  -o "$REPO/ipsw/22E240__iPhone16,1/symbols" \
  "$REPO/ipsw/22E240__iPhone16,1/extracted/22E240__iPhone16,1/kernelcache.release.iPhone16,1"
```

## Batch IDA

The probe script now accepts a symbol map directly:

```bash
REPO=$(pwd)
IDAT="${IDAT:-idat}"

"$IDAT" -A \
  -S"$REPO/.codex/skills/find-ios-kernel-offsets/scripts/ida_offset_probe.py \
      --symbols $REPO/ipsw/22G86__iPhone17,4/symbols/kernelcache.release.iPhone17,4.symbols.json \
      --out /tmp/offset-probe-22G86.json" \
  "$REPO/ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4.i64"
```

```bash
REPO=$(pwd)
IDAT="${IDAT:-idat}"

"$IDAT" -A \
  -S"$REPO/.codex/skills/find-ios-kernel-offsets/scripts/ida_offset_probe.py \
      --symbols $REPO/ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/.opcodex/kernelcache.release.iPad8_9_10_11_12/cache/ipsw/outputs/kernelcache.release.iPad8,9_10_11_12.symbols.json \
      --out /tmp/offset-probe-22D82.json" \
  "$REPO/ipsw/22D82__iPad8,1_2_3_4_5_6_7_8_9_10_11_12/kernelcache.release.iPad8,9_10_11_12.i64"
```

```bash
REPO=$(pwd)
IDAT="${IDAT:-idat}"

"$IDAT" -A \
  -S"$REPO/.codex/skills/find-ios-kernel-offsets/scripts/ida_offset_probe.py \
      --symbols $REPO/ipsw/22E240__iPhone16,1/symbols/kernelcache.release.iPhone16,1.symbols.json \
      --out /tmp/offset-probe-22E240.json" \
  "$REPO/ipsw/22E240__iPhone16,1/kernelcache.release.iphone16.i64"
```

For the hard cases, use the built-in immediate scan mode. Example: recover
task-side `procRO` and proc-side `proComm` candidates from task/proc functions:

```bash
REPO=$(pwd)
IDAT="${IDAT:-idat}"

"$IDAT" -A \
  -S"$REPO/.codex/skills/find-ios-kernel-offsets/scripts/ida_offset_probe.py \
      --symbols $REPO/ipsw/22G86__iPhone17,4/symbols/kernelcache.release.iPhone17,4.symbols.json \
      --out /tmp/offset-scan-22G86.json \
      --imm '#0x3E0' --imm '#0x56C' \
      --name-substr task --name-substr proc" \
  "$REPO/ipsw/22G86__iPhone17,4/kernelcache.release.iPhone17,4.i64"
```

That scan mode is especially useful for:

- `procRO`
- `proComm`
- `proPid` candidate discovery
- `threadOptions` when the obvious symbol names are missing

## Suggested Workflow

1. Run the probe with the target symbol map.
2. Open `references/patterns.md`.
3. Recover the high-confidence fields first:
   `kstackptr`, `threadCTID`, `threadAST`, `threadMutexData`,
   `guardExcCode`, `guardExcCodeData`, `taskIpcSpace`, `excGuard`,
   `icmp6Filter`, `socketSoCount`, `ipcSpaceTable`,
   `threadOptions`, `ipcPortKObject`, `procRO`, `proComm`.
4. Then recover the structurally trickier fields:
   `kernelTask`, `threadTRO`, `threadTaskThreads`,
   `troPacRopPid`, `troPacJopPid`, `proPid`,
   `ptovTableOffset`, `physBaseStructOffset`.
5. Leave unresolved fields blank and note why.

## References

- Pattern guide: `references/patterns.md`
- IDA helper: `scripts/ida_offset_probe.py`
