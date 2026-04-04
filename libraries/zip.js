const zipLibrary =
  (globalThis.Libraries && globalThis.Libraries.zip)
  || (globalThis.__DarkForgeBuiltins && globalThis.__DarkForgeBuiltins.zip)
  || null;

if (!zipLibrary || typeof zipLibrary.createZip !== "function") {
  throw new Error("DarkForge ZIP library is not available in this runtime");
}

module.exports = zipLibrary;
