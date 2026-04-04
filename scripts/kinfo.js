// ============================================================================
// kinfo.js — Print basic kernel info
// ============================================================================
//
// REPL API assumed:
//   kread64(addr)        -> BigInt   — read 8 bytes from kernel address
//   kernelBase()         -> BigInt   — current kernel base
//   kernelSlide()        -> BigInt   — current KASLR slide
//   log(msg)             -> void     — print to REPL console
//
// Optionally:
//   getpid()             -> Number   — our PID
//   hexdump(addr, size)  -> void     — native hex dump
//
// Offsets from Constants.swift / KernelDiscovery.swift / PrivilegeEscalation.swift
// Targeting: iPhone17 / iOS 18.6 / XNU 24.6
// ============================================================================

(function kinfo() {
    "use strict";

    // --- Known constants -----------------------------------------------------
    var UNSLID_KERNEL_BASE = 0xfffffff007004000n;
    var MACHO_MAGIC_64     = 0xfeedfacfn;            // MH_MAGIC_64
    var MACHO_FULL_MAGIC   = 0x100000cfeedfacfn;     // magic + flags in first 8 bytes
    var OFFSET_KERNEL_TASK = 0xc1bf78n;
    var OFFSET_TASK_NEXT   = 0x30n;
    var OFFSET_PROC_RO     = 0x3e0n;
    var OFFSET_PRO_PID     = 0x1b8n;
    var OFFSET_PRO_COMM    = 0x56cn;
    var OFFSET_PRO_UCRED   = 0x20n;
    var OFFSET_UCRED_UID   = 0x18n;

    // Mach-O header offsets (from mach-o/loader.h)
    var OFF_MAGIC      = 0x0n;   // uint32_t magic
    var OFF_CPUTYPE    = 0x4n;   // cpu_type_t cputype
    var OFF_CPUSUBTYPE = 0x8n;   // cpu_subtype_t cpusubtype
    var OFF_FILETYPE   = 0xCn;   // uint32_t filetype
    var OFF_NCMDS      = 0x10n;  // uint32_t ncmds
    var OFF_SIZEOFCMDS = 0x14n;  // uint32_t sizeofcmds
    var OFF_FLAGS      = 0x18n;  // uint32_t flags

    // --- Helpers -------------------------------------------------------------
    function hex(val) {
        if (typeof val === "bigint") return "0x" + val.toString(16);
        return "0x" + val.toString(16);
    }

    function safeKread64(addr) {
        try {
            return kread64(addr);
        } catch (e) {
            return null;
        }
    }

    function read32(addr) {
        var val = safeKread64(addr);
        if (val === null) return null;
        return Number(val & 0xFFFFFFFFn);
    }

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

    // =========================================================================
    // SECTION 1: Kernel base and slide
    // =========================================================================
    log("================================================================");
    log("  KERNEL INFO");
    log("================================================================\n");

    var kbase = kernelBase();
    var kslide = kernelSlide();

    log("[kinfo] Kernel base:        " + hex(kbase));
    log("[kinfo] Kernel slide:       " + hex(kslide));
    log("[kinfo] Unslid base:        " + hex(UNSLID_KERNEL_BASE));
    log("[kinfo] Computed base:      " + hex(UNSLID_KERNEL_BASE + kslide) + " (should match kernel base)");

    var baseMatch = (UNSLID_KERNEL_BASE + kslide) === kbase;
    log("[kinfo] Slide consistency:  " + (baseMatch ? "OK" : "MISMATCH"));

    // =========================================================================
    // SECTION 2: Mach-O header fields
    // =========================================================================
    log("\n--- Mach-O Header ---");

    var fullMagic = safeKread64(kbase + OFF_MAGIC);
    log("[kinfo] header[0x00] (raw 8 bytes): " + hex(fullMagic));

    var magic = read32(kbase + OFF_MAGIC);
    log("[kinfo] magic:        " + hex(magic) +
        (magic === 0xfeedfacf ? "  (MH_MAGIC_64 - correct)" : "  (UNEXPECTED)"));

    // cputype and cpusubtype are packed in second 8 bytes
    var cpuRaw = safeKread64(kbase + OFF_CPUTYPE);
    var cputype = read32(kbase + OFF_CPUTYPE);
    var cpusubtype = read32(kbase + OFF_CPUSUBTYPE);
    log("[kinfo] cputype:      " + hex(cputype) +
        (cputype === 0x100000c ? "  (CPU_TYPE_ARM64)" : ""));
    log("[kinfo] cpusubtype:   " + hex(cpusubtype));

    var filetype = read32(kbase + OFF_FILETYPE);
    log("[kinfo] filetype:     " + hex(filetype) +
        (filetype === 2 ? "  (MH_EXECUTE)" : ""));

    var ncmds = read32(kbase + OFF_NCMDS);
    log("[kinfo] ncmds:        " + ncmds);

    var sizeofcmds = read32(kbase + OFF_SIZEOFCMDS);
    log("[kinfo] sizeofcmds:   " + hex(sizeofcmds) + " (" + sizeofcmds + " bytes)");

    var flags = read32(kbase + OFF_FLAGS);
    log("[kinfo] flags:        " + hex(flags));

    // =========================================================================
    // SECTION 3: Try to find kernel version string
    // =========================================================================
    log("\n--- Kernel Version String ---");

    // The kernel version string is typically at a known symbol (version[]).
    // We scan the first few load commands for LC_SOURCE_VERSION or look for
    // common patterns. The string often lives near "Darwin Kernel Version".

    // Method 1: Read header+0x30 (used by DarkSword pe_main.js)
    var headerPlus30 = safeKread64(kbase + 0x30n);
    log("[kinfo] header[0x30]: " + hex(headerPlus30));

    // Method 2: Scan first few KB past the Mach-O header for "Darwin" string
    var versionString = null;
    var SCAN_START = 0x100n;  // Past the header
    var SCAN_END   = 0x10000n;
    var SCAN_STEP  = 0x8n;

    // We look for the ASCII pattern "Darw" (0x77726144 little-endian)
    var DARWIN_MAGIC = 0x77726144n;  // "Darw" in LE

    for (var off = SCAN_START; off < SCAN_END; off += SCAN_STEP) {
        var val = safeKread64(kbase + off);
        if (val === null) continue;
        if ((val & 0xFFFFFFFFn) === DARWIN_MAGIC) {
            // Found "Darw" — read the full version string
            versionString = readString(kbase + off, 128);
            log("[kinfo] Version string @ " + hex(kbase + off) + ":");
            log("[kinfo]   \"" + versionString + "\"");
            break;
        }
    }

    if (!versionString) {
        // Method 3: Try reading as a pointer (some kernels store a version pointer)
        if (headerPlus30 !== null && headerPlus30 !== 0n && (headerPlus30 & 0xffffff0000000000n) !== 0n) {
            var vstr = readString(headerPlus30, 128);
            if (vstr && vstr.length > 4) {
                log("[kinfo] Version via pointer @ header+0x30:");
                log("[kinfo]   \"" + vstr + "\"");
                versionString = vstr;
            }
        }
    }

    if (!versionString) {
        log("[kinfo] Could not find kernel version string in first 64KB of kernel image.");
        log("[kinfo] The version string offset may differ on this kernel build.");
    }

    // =========================================================================
    // SECTION 4: Our process info
    // =========================================================================
    log("\n--- Our Process ---");

    var ourPid = -1;
    if (typeof getpid === "function") {
        ourPid = getpid();
        log("[kinfo] Our PID:        " + ourPid);
    } else {
        log("[kinfo] getpid() not available in REPL");
    }

    // Read kernel_task and walk to find our process
    var kernelTaskVal = safeKread64(kbase + OFFSET_KERNEL_TASK);
    log("[kinfo] kernel_task:    " + hex(kernelTaskVal));

    if (kernelTaskVal !== null && kernelTaskVal !== 0n) {
        // Show kernel_task info
        var kprocRO = safeKread64(kernelTaskVal + OFFSET_PROC_RO);
        if (kprocRO !== null && kprocRO !== 0n) {
            var kpid = read32(kprocRO + OFFSET_PRO_PID);
            log("[kinfo] kernel PID:     " + kpid + " (should be 0)");
        }

        // Walk tasks to find our PID
        if (ourPid > 0) {
            var current = safeKread64(kernelTaskVal + OFFSET_TASK_NEXT);
            var walkCount = 0;
            var MAX_WALK = 500;

            while (current !== null && current !== 0n && current !== kernelTaskVal && walkCount < MAX_WALK) {
                walkCount++;
                var procRO = safeKread64(current + OFFSET_PROC_RO);
                if (procRO !== null && procRO !== 0n) {
                    var pid = read32(procRO + OFFSET_PRO_PID);
                    if (pid === ourPid) {
                        var name = readString(procRO + OFFSET_PRO_COMM, 16);
                        log("[kinfo] Our task:       " + hex(current));
                        log("[kinfo] Our proc_ro:    " + hex(procRO));
                        log("[kinfo] Our name:       \"" + name + "\"");

                        // Read credentials
                        var ucred = safeKread64(procRO + OFFSET_PRO_UCRED);
                        if (ucred !== null && ucred !== 0n) {
                            var uid = read32(ucred + OFFSET_UCRED_UID);
                            log("[kinfo] Our UID:        " + uid);
                            log("[kinfo] ucred ptr:      " + hex(ucred));
                        }

                        // Read task IPC space
                        var ipcSpace = safeKread64(current + 0x300n);
                        if (ipcSpace !== null && ipcSpace !== 0n) {
                            log("[kinfo] Our ipc_space:  " + hex(ipcSpace));
                        }

                        break;
                    }
                }
                current = safeKread64(current + OFFSET_TASK_NEXT);
            }

            if (walkCount >= MAX_WALK) {
                log("[kinfo] WARNING: Walked " + MAX_WALK + " tasks without finding PID " + ourPid);
            }
        }
    }

    // =========================================================================
    // SECTION 5: Quick sanity checks
    // =========================================================================
    log("\n--- Sanity Checks ---");

    // Verify Mach-O magic
    var magicOk = (magic === 0xfeedfacf);
    log("[kinfo] [" + (magicOk ? "PASS" : "FAIL") + "] Mach-O magic = 0xfeedfacf");

    // Verify slide is page-aligned
    var slideAligned = (kslide & 0x3FFFn) === 0n;
    log("[kinfo] [" + (slideAligned ? "PASS" : "FAIL") + "] Slide is page-aligned (16KB)");

    // Verify kernel_task is not NULL
    var ktaskOk = (kernelTaskVal !== null && kernelTaskVal !== 0n);
    log("[kinfo] [" + (ktaskOk ? "PASS" : "FAIL") + "] kernel_task pointer is non-NULL");

    // Verify cputype is ARM64
    var cpuOk = (cputype === 0x100000c);
    log("[kinfo] [" + (cpuOk ? "PASS" : "FAIL") + "] cputype = CPU_TYPE_ARM64");

    log("\n================================================================");
    log("  END KERNEL INFO");
    log("================================================================");
})();
