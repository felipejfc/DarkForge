// zip.js — Streaming pure-JS ZIP builder for the JSCBridge environment.
// Writes directly to disk entry-by-entry to avoid OOM in launchd.
// Usage: createZip("/out/archive.zip", "/path/to/rootDir", "Payload");

(() => {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }

  function crc32(data) {
    const u = new Uint8Array(data);
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u.length; i++) c = crcTable[(c ^ u[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) {
    const o = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) o.push(c);
      else if (c < 0x800) o.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else o.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return new Uint8Array(o);
  }

  const p16 = (v, o, val) => v.setUint16(o, val, true);
  const p32 = (v, o, val) => v.setUint32(o, val, true);

  function walkDir(base, prefix) {
    const r = [];
    const ls = FileUtils.listDir(base);
    if (!ls) return r;
    for (const it of ls) {
      const rel = prefix ? (prefix + "/" + it.name) : it.name;
      if (it.isDirectory || (it.isLink && it.linkTargetIsDirectory)) {
        r.push({ rel: rel + "/", fp: it.path, dir: true });
        for (const s of walkDir(it.path, rel)) r.push(s);
      } else {
        r.push({ rel: rel, fp: it.path, dir: false });
      }
    }
    return r;
  }

  function makeLocalHeader(nameBytes, crc, size) {
    const buf = new ArrayBuffer(30 + nameBytes.length);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    p32(dv, 0, 0x04034b50); p16(dv, 4, 20); p16(dv, 6, 0x0800); p16(dv, 8, 0);
    p16(dv, 10, 0); p16(dv, 12, 0x0021);
    p32(dv, 14, crc); p32(dv, 18, size); p32(dv, 22, size);
    p16(dv, 26, nameBytes.length); p16(dv, 28, 0);
    u8.set(nameBytes, 30);
    return buf;
  }

  function makeCDEntry(nameBytes, crc, size, localOffset, externalAttr) {
    const buf = new ArrayBuffer(46 + nameBytes.length);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    p32(dv, 0, 0x02014b50); p16(dv, 4, 20); p16(dv, 6, 20); p16(dv, 8, 0x0800);
    p16(dv, 10, 0); p16(dv, 12, 0); p16(dv, 14, 0x0021);
    p32(dv, 16, crc); p32(dv, 20, size); p32(dv, 24, size);
    p16(dv, 28, nameBytes.length); p16(dv, 30, 0); p16(dv, 32, 0);
    p16(dv, 34, 0); p16(dv, 36, 0);
    p32(dv, 38, externalAttr); p32(dv, 42, localOffset);
    u8.set(nameBytes, 46);
    return buf;
  }

  function createZip(zipPath, rootDir, prefix) {
    const src = rootDir + "/" + prefix;
    log("[zip] Scanning " + src);
    const entries = walkDir(src, prefix);
    log("[zip] " + entries.length + " entries");

    // Create empty output file
    FileUtils.writeFile(zipPath, new ArrayBuffer(0));

    const cds = [];
    let off = 0;
    let written = 0;

    for (const e of entries) {
      const nb = utf8(e.rel);
      if (e.dir) {
        const lh = makeLocalHeader(nb, 0, 0);
        FileUtils.appendFile(zipPath, lh);
        cds.push(makeCDEntry(nb, 0, 0, off, (0o40755 << 16) >>> 0));
        off += lh.byteLength;
      } else {
        const fd = FileUtils.readFile(e.fp);
        if (fd === null) { log("[zip] skip " + e.fp); continue; }
        const sz = fd.byteLength;
        const crc = crc32(fd);
        const lh = makeLocalHeader(nb, crc, sz);
        FileUtils.appendFile(zipPath, lh);
        FileUtils.appendFile(zipPath, fd);
        cds.push(makeCDEntry(nb, crc, sz, off, (0o100644 << 16) >>> 0));
        off += lh.byteLength + sz;
      }
      written++;
      if (written % 100 === 0) log("[zip] " + written + "/" + entries.length);
    }

    // Append central directory
    const cdOffset = off;
    let cdTotal = 0;
    for (const cd of cds) { FileUtils.appendFile(zipPath, cd); cdTotal += cd.byteLength; }

    // EOCD
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    p32(ev, 0, 0x06054b50); p16(ev, 4, 0); p16(ev, 6, 0);
    p16(ev, 8, written); p16(ev, 10, written);
    p32(ev, 12, cdTotal); p32(ev, 16, cdOffset); p16(ev, 20, 0);
    FileUtils.appendFile(zipPath, eocd);

    log("[zip] Done: " + zipPath + " (" + off + " bytes data, " + written + " entries)");
    return zipPath;
  }

  globalThis.createZip = createZip;
  globalThis.crc32 = crc32;

  if (typeof skillInput !== "undefined" && skillInput && skillInput.rootDir) {
    const rootDir = String(skillInput.rootDir);
    const prefix = String(skillInput.prefix || "Payload");
    const outputPath = String(skillInput.outputPath || (rootDir + "/" + prefix + ".zip"));
    const result = createZip(outputPath, rootDir, prefix);
    return JSON.stringify({ ok: !!result, path: result });
  }

  return "zip.js loaded — createZip(zipPath, rootDir, prefix) available";
})();
