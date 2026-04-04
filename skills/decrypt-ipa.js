(() => {
  const options = {
    target: String(skillInput.target || "").trim(),
    launchIfNeeded: skillInput.launchIfNeeded !== false,
    includeExtensions: skillInput.includeExtensions !== false,
    includeFrameworks: skillInput.includeFrameworks !== false,
    outputSubdir: String(skillInput.outputSubdir || "").trim(),
  };

  if (!options.target) {
    throw new Error("Missing target bundle identifier or app name");
  }

  const getDiagnosticsSummary = (limit) => {
    if (Apps && typeof Apps.diagnosticsSummary === "function") {
      return Apps.diagnosticsSummary(limit);
    }
    return "";
  };

  const normalizePath = (path) => RootFS.normalizePath(String(path || ""));
  const basename = (path) => {
    const normalized = normalizePath(path);
    return normalized.split("/").pop() || normalized;
  };
  const hex = (value) => `0x${BigInt(value).toString(16)}`;
  const refreshAppInfo = (query) => Apps.resolveTarget(query, { forceRefresh: true });
  const describeApp = (app) => `${app.bundleId} -> ${app.bundlePath}`;

  let appInfo = refreshAppInfo(options.target);
  const initialDiagnostics = getDiagnosticsSummary(10);
  if (initialDiagnostics) {
    log(`app scan diagnostics: ${initialDiagnostics}`);
  }
  log(`resolved ${describeApp(appInfo)}`);

  let pid = Tasks.findPid(appInfo);
  if (!pid && options.launchIfNeeded) {
    log(`launching ${appInfo.bundleId}`);
    Apps.launch(appInfo.bundleId);
    const waitResult = Tasks.waitForProcess(appInfo, 30000);
    pid = waitResult.pid;
    appInfo = waitResult.appInfo || appInfo;
    log(`post-launch target ${describeApp(appInfo)}`);
  }

  if (!pid) {
    const refreshed = refreshAppInfo(appInfo.bundleId || options.target);
    if (refreshed.bundlePath !== appInfo.bundlePath || refreshed.executablePath !== appInfo.executablePath) {
      log(`refreshed target path ${appInfo.bundlePath} -> ${refreshed.bundlePath}`);
    }
    appInfo = refreshed;
    pid = Tasks.findPid(appInfo);
  }

  if (!pid) {
    const diagnostics = getDiagnosticsSummary(10);
    const suffix = diagnostics ? `, scanDiagnostics=${diagnostics}` : "";
    throw new Error(`Unable to find a running PID for ${appInfo.bundleId} (bundlePath=${appInfo.bundlePath}, executablePath=${appInfo.executablePath}${suffix})`);
  }

  const taskInfo = Tasks.openForPid(pid);
  log(`task port source ${taskInfo.source} (${taskInfo.access})`);
  const loadedImages = TaskMemory.listImages(taskInfo);
  const imageByPath = new Map();
  const imagesByName = new Map();
  for (const image of loadedImages) {
    const normalizedPath = normalizePath(image.path);
    const normalizedImage = {
      path: normalizedPath,
      loadAddress: image.loadAddress,
    };
    imageByPath.set(normalizedPath, normalizedImage);
    const name = basename(normalizedPath);
    const bucket = imagesByName.get(name) || [];
    bucket.push(normalizedImage);
    imagesByName.set(name, bucket);
  }

  const resolveImage = (originalPath) => {
    const normalizedPath = normalizePath(originalPath);
    const exact = imageByPath.get(normalizedPath);
    if (exact) return exact;
    const fallback = imagesByName.get(basename(normalizedPath)) || [];
    return fallback.length === 1 ? fallback[0] : null;
  };

  const context = Staging.createDumpContext(appInfo, options.outputSubdir);
  const candidates = Apps.enumerateMachOFiles(appInfo, {
    includeExtensions: options.includeExtensions,
    includeFrameworks: options.includeFrameworks,
  });

  log(`task pid ${pid}, loaded images ${loadedImages.length}, candidates ${candidates.length}`);

  const stats = {
    totalCandidates: candidates.length,
    decrypted: 0,
    alreadyDecrypted: 0,
    skippedNoEncryptionInfo: 0,
    skippedNotLoaded: 0,
    skippedUnreadable: 0,
    errors: 0,
  };
  const files = [];
  const warnings = [];

  for (const candidate of candidates) {
    const stagedPath = Staging.stagedPath(context, candidate.originalPath);
    const record = {
      relativePath: candidate.relativePath,
      originalPath: candidate.originalPath,
      stagedPath,
      category: candidate.category,
    };

    try {
      const machoInfo = MachO.inspectFile(stagedPath);
      if (!machoInfo) {
        record.status = "skipped";
        record.reason = "staged copy is not a readable Mach-O";
        stats.skippedUnreadable += 1;
        files.push(record);
        continue;
      }

      if (!machoInfo.encryption || !machoInfo.encryption.cryptSize) {
        record.status = "skipped";
        record.reason = "no encrypted segment";
        stats.skippedNoEncryptionInfo += 1;
        files.push(record);
        continue;
      }

      record.encryption = {
        cryptOff: machoInfo.encryption.cryptOff,
        cryptSize: machoInfo.encryption.cryptSize,
        cryptId: machoInfo.encryption.cryptId,
      };

      if (!MachO.isEncrypted(machoInfo)) {
        record.status = "skipped";
        record.reason = "already decrypted";
        stats.alreadyDecrypted += 1;
        files.push(record);
        continue;
      }

      const image = resolveImage(candidate.originalPath);
      if (!image) {
        record.status = "skipped";
        record.reason = "matching image is not loaded in the target task";
        stats.skippedNotLoaded += 1;
        files.push(record);
        continue;
      }

      const memoryOffset = MachO.fileOffsetToMemoryOffset(machoInfo, machoInfo.encryption.cryptOff);
      const dumpAddress = image.loadAddress + memoryOffset;
      const decryptedBytes = TaskMemory.read(taskInfo, dumpAddress, machoInfo.encryption.cryptSize);

      MachO.patchRange(stagedPath, machoInfo.sliceOffset + machoInfo.encryption.cryptOff, decryptedBytes);
      MachO.clearCryptId(stagedPath, machoInfo);

      record.status = "decrypted";
      record.loadAddress = hex(image.loadAddress);
      record.dumpAddress = hex(dumpAddress);
      record.bytesDecrypted = machoInfo.encryption.cryptSize;
      stats.decrypted += 1;
      log(`decrypted ${candidate.relativePath}`);
    } catch (error) {
      record.status = "error";
      record.error = error && error.message ? error.message : String(error);
      stats.errors += 1;
      log(`error ${candidate.relativePath}: ${record.error}`);
    }

    files.push(record);
  }

  const ipaPath = Staging.packageDump(context);
  if (!ipaPath) {
    warnings.push("IPA packaging unavailable; staged dump directory was preserved.");
    log("zip unavailable; leaving dump directory unpackaged");
  }

  if (stats.skippedNotLoaded > 0) {
    warnings.push("Some Mach-O files were staged but not decrypted because their images were not loaded.");
  }

  const result = {
    ok: true,
    partial: stats.errors > 0 || stats.skippedNotLoaded > 0 || !ipaPath,
    generatedAt: new Date().toISOString(),
    app: {
      bundleId: appInfo.bundleId,
      name: appInfo.name,
      bundlePath: appInfo.bundlePath,
      executablePath: appInfo.executablePath,
    },
    pid,
    taskPort: hex(taskInfo.taskPort),
    taskAccess: taskInfo.access,
    taskSource: taskInfo.source,
    dumpRoot: context.dumpRoot,
    payloadRoot: context.payloadRoot,
    stagedBundlePath: context.stagedBundlePath,
    ipaPath,
    options,
    loadedImageCount: loadedImages.length,
    stats,
    warnings,
    files,
  };

  result.reportPath = `${context.dumpRoot}/report.json`;
  FileUtils.writeTextFile(result.reportPath, JSON.stringify(result, null, 2));

  log(`dump root: ${result.dumpRoot}`);
  if (ipaPath) {
    log(`ipa: ${ipaPath}`);
  }

  return JSON.stringify(result, null, 2);
})();
