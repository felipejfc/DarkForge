// zip.js — Skill wrapper over the shared DarkForge ZIP library.
// Usage: createZip("/out/archive.zip", "/path/to/rootDir", "Payload");

(() => {
  const zip =
    (globalThis.Libraries && globalThis.Libraries.zip)
    || (typeof require === "function" ? require("darkforge/zip") : null);

  if (!zip || typeof zip.createZip !== "function") {
    throw new Error("DarkForge ZIP library is unavailable");
  }

  globalThis.createZip = zip.createZip.bind(zip);
  globalThis.crc32 = zip.crc32.bind(zip);

  if (typeof skillInput !== "undefined" && skillInput && skillInput.rootDir) {
    const rootDir = String(skillInput.rootDir);
    const prefix = String(skillInput.prefix || "Payload");
    const outputPath = String(skillInput.outputPath || (rootDir + "/" + prefix + ".zip"));
    const result = zip.createZip(outputPath, rootDir, prefix);
    return JSON.stringify({ ok: !!result, path: result });
  }

  return "zip.js loaded — shared ZIP helpers available";
})();
