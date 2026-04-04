(() => {
  const getDiagnostics = () => {
    if (Apps && typeof Apps.diagnostics === "function") {
      return Apps.diagnostics();
    }
    return [];
  };
  const getDiagnosticsSummary = (limit) => {
    if (Apps && typeof Apps.diagnosticsSummary === "function") {
      return Apps.diagnosticsSummary(limit);
    }
    return "";
  };

  const apps = Apps.listInstalled()
    .map((app) => ({
      name: app.name,
      bundleId: app.bundleId,
      bundlePath: app.bundlePath,
      executablePath: app.executablePath,
    }))
    .sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return a.bundleId.localeCompare(b.bundleId);
    });

  const diagnostics = getDiagnostics();
  if (diagnostics.length) {
    log(`app scan diagnostics (${diagnostics.length})`);
    const summary = getDiagnosticsSummary(10);
    if (summary) log(summary);
  }
  log(`found ${apps.length} installed apps`);

  return JSON.stringify({
    ok: true,
    count: apps.length,
    diagnostics,
    apps,
  }, null, 2);
})();
