#!/usr/bin/env bash
# Build the DarkForge desktop app for the host platform.
#
# Pipeline:
#   1. Freeze tools/kserver.py with PyInstaller -> dist/kserver
#   2. Copy the binary into src-tauri/binaries/kserver-<rust-target-triple>
#   3. Run `cargo tauri build` to produce the .app / .dmg / .exe / AppImage.
#
# Prerequisites:
#   - python3 with pip
#   - pyinstaller (auto-installed into a local venv if missing)
#   - rustc + cargo
#   - tauri-cli 2.x  (cargo install tauri-cli --version '^2.0.0')
#
# Icons must be generated once via `cargo tauri icon ../../../icon.png` from
# src-tauri/ — see README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SPEC="$SCRIPT_DIR/pyinstaller/kserver.spec"
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$SCRIPT_DIR/dist"
BINARIES_DIR="$SCRIPT_DIR/src-tauri/binaries"
VENV_DIR="$SCRIPT_DIR/.venv"

log()  { printf "\033[1;36m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!!\033[0m  %s\n" "$*" >&2; }
die()  { printf "\033[1;31mxx\033[0m  %s\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Ensure PyInstaller is available
# ---------------------------------------------------------------------------

if ! command -v python3 >/dev/null 2>&1; then
  die "python3 not found"
fi

if [ ! -d "$VENV_DIR" ]; then
  log "Creating venv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "Installing PyInstaller + websockets into venv"
pip install --quiet --upgrade pip
pip install --quiet pyinstaller websockets

# ---------------------------------------------------------------------------
# 2. Freeze kserver.py
# ---------------------------------------------------------------------------

log "Freezing kserver.py (PyInstaller)"
pushd "$SCRIPT_DIR" >/dev/null
pyinstaller --clean --noconfirm \
  --workpath "$BUILD_DIR" \
  --distpath "$DIST_DIR" \
  "$SPEC"
popd >/dev/null

FROZEN_BIN="$DIST_DIR/kserver"
[ -x "$FROZEN_BIN" ] || die "PyInstaller did not produce $FROZEN_BIN"

# ---------------------------------------------------------------------------
# 3. Copy binary into Tauri sidecar slot
# ---------------------------------------------------------------------------

TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
[ -n "$TARGET_TRIPLE" ] || die "could not detect rust target triple"

mkdir -p "$BINARIES_DIR"
SIDECAR_DEST="$BINARIES_DIR/kserver-$TARGET_TRIPLE"
cp "$FROZEN_BIN" "$SIDECAR_DEST"
chmod +x "$SIDECAR_DEST"
log "Sidecar installed: $SIDECAR_DEST"

# ---------------------------------------------------------------------------
# 4. Check that icons are in place
# ---------------------------------------------------------------------------

if [ ! -f "$SCRIPT_DIR/src-tauri/icons/icon.icns" ]; then
  warn "No icons found in src-tauri/icons/."
  warn "Run: (cd $SCRIPT_DIR/src-tauri && cargo tauri icon ../../../icon.png)"
  warn "Continuing anyway — Tauri will fail at bundle stage if icons are required."
fi

# ---------------------------------------------------------------------------
# 5. Build the Tauri bundle
# ---------------------------------------------------------------------------

if ! command -v cargo >/dev/null 2>&1; then
  die "cargo not found"
fi

if ! cargo tauri --version >/dev/null 2>&1; then
  die "tauri-cli not installed. Run: cargo install tauri-cli --version '^2.0.0'"
fi

log "Building Tauri bundle"
cd "$SCRIPT_DIR/src-tauri"
cargo tauri build

log "Done. Output: $SCRIPT_DIR/src-tauri/target/release/bundle/"
