# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for DarkForge kserver.
#
# Produces a single-file executable that bundles kserver.py along with
# the webui/ static assets and built-in skills/ and libraries/ directories. At runtime, kserver
# resolves those paths via sys._MEIPASS (handled in kserver.py).
#
# Build:
#   pyinstaller --clean --noconfirm tools/desktop/pyinstaller/kserver.spec
#
# Output: dist/kserver (single-file executable)

from pathlib import Path

# SPECPATH is set by PyInstaller to the directory containing this spec file.
SPEC_DIR = Path(SPECPATH).resolve()
PROJECT_ROOT = SPEC_DIR.parent.parent.parent  # tools/desktop/pyinstaller -> repo root
TOOLS_DIR = PROJECT_ROOT / "tools"

datas = [
    (str(TOOLS_DIR / "webui"), "webui"),
    (str(PROJECT_ROOT / "skills"), "skills"),
    (str(PROJECT_ROOT / "libraries"), "libraries"),
]

a = Analysis(
    [str(TOOLS_DIR / "kserver.py")],
    pathex=[str(TOOLS_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "websockets",
        "websockets.asyncio.server",
        "websockets.legacy",
        "websockets.legacy.server",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "test",
        "unittest",
        "pydoc",
        "doctest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="kserver",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
