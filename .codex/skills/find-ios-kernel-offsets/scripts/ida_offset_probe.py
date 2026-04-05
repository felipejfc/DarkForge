import json
import re

import ida_funcs
import ida_name
import idaapi
import idautils
import idc


DEFAULT_NAMES = [
    "_mach_exception_ast",
    "guard_ast",
    "thread_terminate",
    "exception_triage_thread",
    "task_threads",
    "get_thread_ro",
    "machine_switch_context",
    "Switch_context",
    "_Xtask_set_special_port_from_user",
    "convert_port_to_space_read",
    "ipc_space_terminate",
    "_Xtask_set_exc_guard_behavior",
    "icmp6_dgram_attach",
    "soclose",
    "task_init",
    "task_suspend_internal",
    "machine_thread_state_convert_from_user",
]

DEFAULT_STRINGS = [
    "guard_exc_info %llx %llx @%s:%d",
    "called exception_triage when it was forbidden by the boot environment @%s:%d",
    "initproc",
]


def parse_args(argv):
    out_path = None
    symbols_path = None
    stay_open = False
    names = DEFAULT_NAMES[:]
    strings = DEFAULT_STRINGS[:]
    immediates = []
    name_substrs = []
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--out" and i + 1 < len(argv):
            out_path = argv[i + 1]
            i += 2
            continue
        if arg == "--symbols" and i + 1 < len(argv):
            symbols_path = argv[i + 1]
            i += 2
            continue
        if arg == "--name" and i + 1 < len(argv):
            names.append(argv[i + 1])
            i += 2
            continue
        if arg == "--string" and i + 1 < len(argv):
            strings.append(argv[i + 1])
            i += 2
            continue
        if arg == "--imm" and i + 1 < len(argv):
            immediates.append(argv[i + 1].lower())
            i += 2
            continue
        if arg == "--name-substr" and i + 1 < len(argv):
            name_substrs.append(argv[i + 1].lower())
            i += 2
            continue
        if arg == "--stay-open":
            stay_open = True
            i += 1
            continue
        i += 1
    return out_path, symbols_path, stay_open, names, strings, immediates, name_substrs


def apply_symbol_map(symbols_path):
    if not symbols_path:
        return {"path": None, "applied": 0, "errors": []}

    errors = []
    applied = 0
    try:
        with open(symbols_path, "r", encoding="utf-8") as fh:
            addr2sym = json.load(fh)
    except Exception as exc:
        return {"path": symbols_path, "applied": 0, "errors": [f"load failed: {exc}"]}

    for addr, sym in addr2sym.items():
        try:
            ea = int(addr, 10)
            if not idaapi.is_loaded(ea):
                errors.append(f"{sym}: {addr} not loaded")
                continue
            if not ida_funcs.get_func(ea) and not ida_funcs.add_func(ea):
                errors.append(f"{sym}: failed to create function at {ea:#x}")
                continue
            if ida_name.set_name(ea, sym, idaapi.SN_FORCE):
                applied += 1
            else:
                errors.append(f"{sym}: failed to name {ea:#x}")
        except Exception as exc:
            errors.append(f"{sym}: {exc}")
    return {"path": symbols_path, "applied": applied, "errors": errors[:64]}


def disasm_window(start_ea, max_instructions=96):
    lines = []
    immediates = set()
    cur = start_ea
    for _ in range(max_instructions):
        if cur == idaapi.BADADDR:
            break
        dis = idc.generate_disasm_line(cur, 0) or ""
        lines.append({"ea": f"{cur:#x}", "disasm": dis})
        for match in re.findall(r"#0x[0-9a-fA-F]+", dis):
            immediates.add(match.lower())
        nxt = idc.next_head(cur, idaapi.BADADDR)
        if nxt == idaapi.BADADDR or nxt <= cur:
            break
        cur = nxt
    return lines, sorted(immediates)


def find_name_hits(target):
    hits = []
    exact = ida_name.get_name_ea(idaapi.BADADDR, target)
    if exact != idaapi.BADADDR:
        hits.append(exact)
    for ea, name in idautils.Names():
        if target in name and ea not in hits:
            hits.append(ea)
    return hits[:12]


def string_hits(target):
    results = []
    strings = idautils.Strings()
    strings.setup()
    for s in strings:
        value = str(s)
        if target not in value:
            continue
        refs = []
        for xref in idautils.XrefsTo(s.ea):
            func = ida_funcs.get_func(xref.frm)
            refs.append({
                "from": f"{xref.frm:#x}",
                "func_start": f"{func.start_ea:#x}" if func else None,
                "func_name": ida_name.get_ea_name(func.start_ea) if func else None,
            })
        results.append({
            "ea": f"{s.ea:#x}",
            "value": value,
            "xrefs": refs[:16],
        })
    return results


def immediate_scan(target_immediates, name_substrs):
    matches = []
    for ea in idautils.Functions():
        name = ida_name.get_ea_name(ea) or ""
        lname = name.lower()
        if name_substrs and not any(substr in lname for substr in name_substrs):
            continue
        func = ida_funcs.get_func(ea)
        cur = ea
        hits = []
        while cur != idaapi.BADADDR and cur < func.end_ea:
            dis = idc.generate_disasm_line(cur, 0) or ""
            dis_lower = dis.lower()
            if any(imm in dis_lower for imm in target_immediates):
                hits.append({"ea": f"{cur:#x}", "disasm": dis})
            cur = idc.next_head(cur, func.end_ea)
        if hits:
            matches.append({
                "name": name,
                "ea": f"{ea:#x}",
                "hits": hits[:20],
            })
    return matches


def main():
    out_path, symbols_path, stay_open, names, strings, immediates, name_substrs = parse_args(idc.ARGV)
    idaapi.auto_wait()
    symbolicate = apply_symbol_map(symbols_path)
    idaapi.auto_wait()

    result = {
        "input_path": idaapi.get_input_file_path(),
        "database_path": idaapi.get_path(idaapi.PATH_TYPE_IDB),
        "symbolicate": symbolicate,
        "names": {},
        "strings": {},
        "scan_matches": [],
    }

    for target in names:
        hits = []
        for ea in find_name_hits(target):
            func = ida_funcs.get_func(ea)
            start = func.start_ea if func else ea
            end = func.end_ea if func else ea
            window, immediates = disasm_window(start)
            hits.append({
                "requested": target,
                "ea": f"{ea:#x}",
                "func_start": f"{start:#x}",
                "func_end": f"{end:#x}",
                "name": ida_name.get_ea_name(start) if start != idaapi.BADADDR else None,
                "immediates": immediates,
                "window": window,
            })
        result["names"][target] = hits

    for target in strings:
        result["strings"][target] = string_hits(target)

    if immediates:
        result["scan_matches"] = immediate_scan(immediates, name_substrs)

    payload = json.dumps(result, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(payload)
    print(payload)

    if not stay_open:
        idc.qexit(0)


if __name__ == "__main__":
    main()
