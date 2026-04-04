// block-ota.js — Neuter the iOS OTA staging directories so softwareupdated
// cannot download or stage an OTA. Works by replacing each staging directory
// with a regular file (optionally UF_IMMUTABLE) so mkdir() fails with EEXIST.
//
// Actions: "block" | "unblock" | "status"

(() => {
  const SKILL_VERSION = "2026-04-04-debug1";
  const action = String(skillInput.action || "block").trim().toLowerCase();
  const setImmutable = skillInput.setImmutable !== false;
  const verbose = skillInput.verbose !== false;

  // flags (sys/stat.h on Darwin)
  const UF_IMMUTABLE = 0x00000002;
  const S_IFMT = 0o170000;
  const S_IFDIR = 0o040000;
  const S_IFREG = 0o100000;
  const S_IFLNK = 0o120000;

  // The OTA staging paths softwareupdated uses. Killing these starves every
  // stage of the update pipeline (discovery metadata + staged payload).
  const TARGETS = [
    "/var/MobileAsset/AssetsV2/com_apple_MobileAsset_SoftwareUpdate",
    "/var/MobileAsset/AssetsV2/com_apple_MobileAsset_SoftwareUpdateDocumentation",
    "/var/MobileAsset/AssetsV2/com_apple_MobileAsset_SoftwareUpdateManagedAssets",
    "/var/MobileAsset/AssetsV2/com_apple_MobileAsset_UrgentSoftwareUpdate",
    "/var/MobileSoftwareUpdate/MobileAsset/AssetsV2/com_apple_MobileAsset_SoftwareUpdate",
    "/var/MobileSoftwareUpdate/MobileAsset/AssetsV2/com_apple_MobileAsset_SoftwareUpdateDocumentation",
  ];

  const SENTINEL_BODY = "blocked by DarkForge block-ota skill\n";

  // ---- chflags wrappers (best-effort; errors are non-fatal) ----
  const chflags = (path, flags) => {
    // int chflags(const char *path, u_int flags);
    const rc = Native.callSymbol("chflags", path, flags);
    return rc === 0 || rc === 0n;
  };

  const tryClearFlags = (path) => {
    // Clear any flags so we can unlink the sentinel.
    try { chflags(path, 0); } catch (_) {}
  };

  const trySetImmutable = (path) => {
    try { return chflags(path, UF_IMMUTABLE); } catch (_) { return false; }
  };

  // Recursive mkdir -p. createDir is single-level (plain mkdir), so walk up
  // and create each missing ancestor. Returns true if the full path exists
  // as a directory at the end.
  const statKind = (st) => {
    if (!st || typeof st.mode !== "number") return "other";
    const kind = st.mode & S_IFMT;
    if (kind === S_IFDIR) return "dir";
    if (kind === S_IFREG) return "file";
    if (kind === S_IFLNK) return "link";
    return "other";
  };

  const mkdirP = (dir) => {
    if (!dir || dir === "/") return true;
    if (FileUtils.exists(dir)) {
      const st = FileUtils.lstat(dir);
      return statKind(st) === "dir";
    }
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (!mkdirP(parent)) return false;
    return FileUtils.createDir(dir);
  };

  // ---- per-target operations ----
  const describe = (path) => {
    const st = FileUtils.lstat(path);
    if (!st) return { path, exists: false };
    const kind = statKind(st);
    return {
      path,
      exists: true,
      isDirectory: kind === "dir",
      isFile: kind === "file",
      isLink: kind === "link",
      kind,
      mode: st.mode || 0,
      size: st.size || 0,
      flags: st.flags || 0,
    };
  };

  const formatInfo = (info) => {
    if (!info || !info.exists) return "missing";
    return `${info.kind} mode=0${Number(info.mode || 0).toString(8)} size=${info.size || 0} flags=${info.flags || 0}`;
  };

  const trace = (record, message) => {
    if (!record.steps) record.steps = [];
    record.steps.push(message);
    if (verbose) log(`trace                  ${record.path}: ${message}`);
  };

  const isSentinelFile = (info) => {
    if (!info || !info.exists) return false;
    if (!info.isFile || info.isDirectory) return false;
    if (info.size > 512) return false;
    const body = FileUtils.readTextFile(info.path, 0, 512);
    return typeof body === "string" && body.indexOf("DarkForge block-ota") !== -1;
  };

  const doBlock = (path) => {
    const before = describe(path);
    const record = { path, before };
    trace(record, `before ${formatInfo(before)}`);

    // Already blocked? Just refresh the immutable flag if requested.
    if (isSentinelFile(before)) {
      record.status = "already-blocked";
      let immutableRefreshed = false;
      if (setImmutable) immutableRefreshed = trySetImmutable(path);
      trace(record, `sentinel already present${setImmutable ? ` immutable-refresh=${immutableRefreshed}` : ""}`);
      record.after = describe(path);
      trace(record, `after ${formatInfo(record.after)} sentinel=${isSentinelFile(record.after)}`);
      return record;
    }

    // Clear any flags on an existing entry so we can remove it.
    if (before.exists) {
      trace(record, "clearing existing flags");
      tryClearFlags(path);
    }

    // Remove whatever is currently there.
    if (before.exists) {
      let removed = false;
      if (before.isDirectory && !before.isLink) {
        trace(record, "removing existing directory recursively");
        removed = FileUtils.deleteDir(path, true);
      } else {
        trace(record, `removing existing ${before.kind}`);
        removed = FileUtils.deleteFile(path);
      }
      if (!removed) {
        record.status = "error";
        record.error = "failed to remove existing entry";
        record.after = describe(path);
        trace(record, `remove failed; after ${formatInfo(record.after)}`);
        return record;
      }
      trace(record, "existing entry removed");
    }

    // Ensure full parent chain exists. These paths live under
    // /var/MobileSoftwareUpdate which may not yet be populated on a device
    // that has never staged an OTA.
    const parent = path.substring(0, path.lastIndexOf("/"));
    trace(record, `ensuring parent ${parent}`);
    if (parent && !mkdirP(parent)) {
      record.status = "error";
      record.error = `failed to create parent directory ${parent}`;
      record.after = describe(path);
      trace(record, `mkdirP failed; after ${formatInfo(record.after)}`);
      return record;
    }
    trace(record, "parent ready");

    // Drop the sentinel file at the staging path.
    trace(record, "writing sentinel file");
    if (!FileUtils.writeTextFile(path, SENTINEL_BODY)) {
      record.status = "error";
      record.error = "failed to write sentinel file";
      record.after = describe(path);
      trace(record, `write failed; after ${formatInfo(record.after)}`);
      return record;
    }
    trace(record, "sentinel file written");

    // Lock it so softwareupdated can't unlink and mkdir over it.
    let immutableOk = false;
    if (setImmutable) {
      immutableOk = trySetImmutable(path);
      trace(record, `immutable set=${immutableOk}`);
    }

    record.status = "blocked";
    record.immutable = immutableOk;
    record.after = describe(path);
    trace(record, `after ${formatInfo(record.after)} sentinel=${isSentinelFile(record.after)}`);
    return record;
  };

  const doUnblock = (path) => {
    const before = describe(path);
    const record = { path, before };
    trace(record, `before ${formatInfo(before)}`);

    if (!before.exists) {
      record.status = "not-present";
      trace(record, "nothing to remove");
      return record;
    }

    if (!isSentinelFile(before)) {
      record.status = "skipped-not-sentinel";
      record.note = "path exists but is not a DarkForge sentinel; leaving untouched";
      trace(record, "existing entry is not a DarkForge sentinel");
      return record;
    }

    trace(record, "clearing sentinel flags");
    tryClearFlags(path);
    trace(record, "removing sentinel file");
    if (!FileUtils.deleteFile(path)) {
      record.status = "error";
      record.error = "failed to remove sentinel";
      record.after = describe(path);
      trace(record, `remove failed; after ${formatInfo(record.after)}`);
      return record;
    }

    // Recreate the directory so softwareupdated is happy next run.
    trace(record, "recreating directory");
    if (!FileUtils.createDir(path)) {
      record.status = "partial";
      record.note = "sentinel removed but directory not recreated";
      record.after = describe(path);
      trace(record, `recreate failed; after ${formatInfo(record.after)}`);
      return record;
    }

    record.status = "unblocked";
    record.after = describe(path);
    trace(record, `after ${formatInfo(record.after)}`);
    return record;
  };

  const doStatus = (path) => {
    const info = describe(path);
    const record = { path, steps: [`info ${formatInfo(info)}`] };
    if (!info.exists) {
      record.status = "missing";
    } else if (isSentinelFile(info)) {
      record.status = "blocked";
    } else if (info.isDirectory) {
      record.status = "open-directory";
    } else {
      record.status = "other";
    }
    record.info = info;
    return record;
  };

  // ---- dispatch ----
  const runner = action === "unblock" ? doUnblock
               : action === "status"  ? doStatus
               :                        doBlock;

  if (action !== "block" && action !== "unblock" && action !== "status") {
    throw new Error(`Unknown action "${action}" (expected block | unblock | status)`);
  }

  log(`block-ota version=${SKILL_VERSION} action=${action} targets=${TARGETS.length}`);
  const results = TARGETS.map((p) => {
    try {
      const r = runner(p);
      if (r.status === "error" && r.error) {
        log(`${r.status.padEnd(22)} ${p}: ${r.error}`);
      } else {
        log(`${r.status.padEnd(22)} ${p}`);
      }
      return r;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      log(`error                  ${p}: ${msg}`);
      return { path: p, status: "error", error: msg };
    }
  });

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const hasErrors = results.some((r) => r.status === "error");
  const total = results.length;

  let alreadyApplied = false;
  let headline = "";
  if (action === "block") {
    alreadyApplied = !hasErrors && counts["already-blocked"] === total;
    if (alreadyApplied) {
      headline = "already applied! all OTA staging paths are already blocked";
    } else if (!hasErrors) {
      const newly = counts["blocked"] || 0;
      const kept = counts["already-blocked"] || 0;
      headline = `blocked ${newly} path(s), ${kept} already in place`;
    } else {
      headline = "block completed with errors";
    }
  } else if (action === "unblock") {
    const nothingToDo = (counts["not-present"] || 0) + (counts["skipped-not-sentinel"] || 0);
    if (!hasErrors && nothingToDo === total) {
      alreadyApplied = true;
      headline = "already applied! no DarkForge sentinels were in place";
    } else if (!hasErrors) {
      headline = `unblocked ${counts["unblocked"] || 0} path(s)`;
    } else {
      headline = "unblock completed with errors";
    }
  } else {
    // status
    const blocked = counts["blocked"] || 0;
    headline = blocked === total
      ? "already applied! all OTA staging paths are blocked"
      : `status: ${blocked}/${total} blocked`;
    alreadyApplied = blocked === total;
  }

  log(headline);

  const summary = {
    skillVersion: SKILL_VERSION,
    ok: !hasErrors,
    alreadyApplied,
    headline,
    action,
    setImmutable,
    verbose,
    counts,
    results,
    generatedAt: new Date().toISOString(),
    notes: [
      "Blocks OTA staging via /var/MobileAsset + /var/MobileSoftwareUpdate only.",
      "Root filesystem (hosts file, launch daemons) is untouched.",
      "Reboot or kill -9 softwareupdated nsurlsessiond to force a fresh check."
    ],
  };

  return JSON.stringify(summary, null, 2);
})();
