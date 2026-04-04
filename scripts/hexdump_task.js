// ============================================================================
// hexdump_task.js — Hex dump kernel_task and first few tasks/proc_ro structs
// ============================================================================
//
// REPL API assumed:
//   kread64(addr)        -> BigInt   — read 8 bytes from kernel address
//   kernelBase()         -> BigInt   — current kernel base
//   log(msg)             -> void     — print to REPL console
//
// If the REPL provides a native hexdump(addr, size), it will be used.
// Otherwise this script implements its own via kread64.
//
// Offsets from PrivilegeEscalation.swift / Constants.swift
// Targeting: iPhone17 / iOS 18.6 / XNU 24.6
// ============================================================================

(function hexdumpTask() {
    "use strict";

    // --- Known offsets -------------------------------------------------------
    var OFFSET_KERNEL_TASK = 0xc1bf78n;
    var OFFSET_TASK_NEXT   = 0x30n;
    var OFFSET_PROC_RO     = 0x3e0n;
    var DUMP_SIZE           = 0x400n;  // bytes to dump per structure

    // --- Helpers -------------------------------------------------------------
    function hex(val) {
        if (typeof val === "bigint") return "0x" + val.toString(16);
        return "0x" + val.toString(16);
    }

    function hex8(val) {
        // Format a byte as 2-digit hex
        var s = val.toString(16);
        return s.length < 2 ? "0" + s : s;
    }

    function hex16be(val) {
        // Format a 16-bit value as 4-digit hex
        var s = val.toString(16);
        while (s.length < 4) s = "0" + s;
        return s;
    }

    function safeKread64(addr) {
        try {
            return kread64(addr);
        } catch (e) {
            return null;
        }
    }

    // --- hexdump implementation via kread64 ----------------------------------
    // Reads memory 8 bytes at a time and formats as a classic hex dump.
    // If the REPL provides a native hexdump(), prefer that instead.
    function doHexdump(baseAddr, size) {
        var bytesPerLine = 16;
        var numLines = Number(size) / bytesPerLine;

        for (var line = 0; line < numLines; line++) {
            var lineAddr = baseAddr + BigInt(line * bytesPerLine);
            var hexPart = "";
            var asciiPart = "";

            // Read two 64-bit values (16 bytes)
            var qword0 = safeKread64(lineAddr);
            var qword1 = safeKread64(lineAddr + 8n);

            if (qword0 === null && qword1 === null) {
                log(hex(lineAddr) + ":  ???????????????? ????????????????  |................|");
                continue;
            }

            for (var i = 0; i < 16; i++) {
                var byteVal;
                if (i < 8) {
                    if (qword0 === null) { hexPart += "??"; asciiPart += "."; continue; }
                    byteVal = Number((qword0 >> BigInt(i * 8)) & 0xFFn);
                } else {
                    if (qword1 === null) { hexPart += "??"; asciiPart += "."; continue; }
                    byteVal = Number((qword1 >> BigInt((i - 8) * 8)) & 0xFFn);
                }
                hexPart += hex8(byteVal);
                if (i === 7) hexPart += "  "; else if (i < 15) hexPart += " ";
                asciiPart += (byteVal >= 0x20 && byteVal <= 0x7e) ? String.fromCharCode(byteVal) : ".";
            }

            log(hex(lineAddr) + ":  " + hexPart + "  |" + asciiPart + "|");
        }
    }

    // Use native hexdump if available, otherwise use our implementation
    function dumpRegion(label, addr, size) {
        log("\n" + label);
        log("Address: " + hex(addr) + "  Size: " + hex(size) + " bytes");
        log("------------------------------------------------------------------------");

        if (typeof hexdump === "function") {
            try {
                hexdump(addr, Number(size));
                return;
            } catch (e) {
                // Fall through to manual implementation
            }
        }

        doHexdump(addr, size);
    }

    // --- Step 1: Read kernel_task pointer ------------------------------------
    var kbase = kernelBase();
    log("[hexdump] kernel_base = " + hex(kbase));

    var kernelTaskAddr = kbase + OFFSET_KERNEL_TASK;
    var kernelTaskVal = kread64(kernelTaskAddr);
    log("[hexdump] kernel_task ptr @ " + hex(kernelTaskAddr) + " = " + hex(kernelTaskVal));

    if (kernelTaskVal === 0n) {
        log("[hexdump] ERROR: kernel_task is NULL");
        return;
    }

    // --- Step 2: Dump kernel_task struct -------------------------------------
    dumpRegion(
        "=== KERNEL_TASK (task struct for PID 0) ===",
        kernelTaskVal,
        DUMP_SIZE
    );

    // --- Step 3: Walk first 3 tasks and dump each ----------------------------
    var NUM_TASKS = 3;
    var current = safeKread64(kernelTaskVal + OFFSET_TASK_NEXT);

    for (var i = 0; i < NUM_TASKS && current !== null && current !== 0n && current !== kernelTaskVal; i++) {
        dumpRegion(
            "=== TASK[" + i + "] ===",
            current,
            DUMP_SIZE
        );

        // --- Step 4: Dump proc_ro for this task ------------------------------
        var procROAddr = safeKread64(current + OFFSET_PROC_RO);
        if (procROAddr !== null && procROAddr !== 0n) {
            dumpRegion(
                "=== TASK[" + i + "] -> proc_ro ===",
                procROAddr,
                DUMP_SIZE
            );

            // Also dump dereferenced proc_ro[0] (the proc struct itself)
            var procVal = safeKread64(procROAddr);
            if (procVal !== null && procVal !== 0n && (procVal & 0xffffff0000000000n) !== 0n) {
                dumpRegion(
                    "=== TASK[" + i + "] -> proc_ro -> *proc ===",
                    procVal,
                    DUMP_SIZE
                );
            }
        } else {
            log("\n[hexdump] TASK[" + i + "] proc_ro is NULL — skipping proc_ro dump");
        }

        current = safeKread64(current + OFFSET_TASK_NEXT);
    }

    // --- Step 5: Dump kernel_task's own proc_ro ------------------------------
    var kprocRO = safeKread64(kernelTaskVal + OFFSET_PROC_RO);
    if (kprocRO !== null && kprocRO !== 0n) {
        dumpRegion(
            "=== KERNEL_TASK -> proc_ro (kernel proc) ===",
            kprocRO,
            DUMP_SIZE
        );
    } else {
        log("\n[hexdump] kernel_task proc_ro is NULL");
    }

    log("\n[hexdump] Done. Use the hex dumps above to visually identify structure layouts.");
    log("[hexdump] Look for:");
    log("[hexdump]   - Small integers (PIDs) in proc_ro dumps");
    log("[hexdump]   - ASCII strings (process names like 'kernel_task', 'launchd')");
    log("[hexdump]   - Pointer chains (0xffffff... addresses) for linked lists");
})();
