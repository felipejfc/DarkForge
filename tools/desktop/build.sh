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
APP_BUNDLE_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle/macos"
DMG_BUNDLE_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle/dmg"

MACOS_SIGN_IDENTITY="${DARKFORGE_MACOS_SIGN_IDENTITY:-}"
MACOS_NOTARY_APPLE_ID="${DARKFORGE_MACOS_NOTARY_APPLE_ID:-}"
MACOS_NOTARY_PASSWORD="${DARKFORGE_MACOS_NOTARY_PASSWORD:-}"
MACOS_NOTARY_TEAM_ID="${DARKFORGE_MACOS_NOTARY_TEAM_ID:-}"

log()  { printf "\033[1;36m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!!\033[0m  %s\n" "$*" >&2; }
die()  { printf "\033[1;31mxx\033[0m  %s\n" "$*" >&2; exit 1; }

validate_notary_config() {
  local provided=0
  local missing=0

  for value in "$MACOS_NOTARY_APPLE_ID" "$MACOS_NOTARY_PASSWORD" "$MACOS_NOTARY_TEAM_ID"; do
    if [ -n "$value" ]; then
      provided=1
    else
      missing=1
    fi
  done

  if [ "$provided" -eq 1 ] && [ "$missing" -eq 1 ]; then
    die "notarization requires DARKFORGE_MACOS_NOTARY_APPLE_ID, DARKFORGE_MACOS_NOTARY_PASSWORD, and DARKFORGE_MACOS_NOTARY_TEAM_ID"
  fi

  if [ "$provided" -eq 1 ] && [ -z "$MACOS_SIGN_IDENTITY" ]; then
    die "notarization requires DARKFORGE_MACOS_SIGN_IDENTITY"
  fi
}

sign_target() {
  local target="$1"

  if [ -n "$MACOS_SIGN_IDENTITY" ]; then
    codesign --force --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$target"
  else
    codesign --force --sign - "$target"
  fi
}

postprocess_macos_bundle() {
  local app_path="$APP_BUNDLE_DIR/DarkForge.app"
  local helper_path="$app_path/Contents/MacOS/kserver"
  local dmg_path
  local dmg_stage
  local notarize_zip

  [ -d "$app_path" ] || die "expected app bundle at $app_path"
  dmg_path="$(find "$DMG_BUNDLE_DIR" -maxdepth 1 -name '*.dmg' -print -quit)"

  log "Signing macOS app bundle"
  xattr -cr "$app_path"
  if [ -e "$helper_path" ]; then
    sign_target "$helper_path"
  fi
  sign_target "$app_path"
  codesign --verify --deep --strict --verbose=2 "$app_path"

  if [ -n "$MACOS_NOTARY_APPLE_ID" ]; then
    log "Submitting DarkForge.app for notarization"
    notarize_zip="$(mktemp "${TMPDIR:-/tmp}/darkforge-notary.XXXXXX.zip")"
    ditto -c -k --keepParent "$app_path" "$notarize_zip"
    xcrun notarytool submit "$notarize_zip" \
      --apple-id "$MACOS_NOTARY_APPLE_ID" \
      --password "$MACOS_NOTARY_PASSWORD" \
      --team-id "$MACOS_NOTARY_TEAM_ID" \
      --wait
    xcrun stapler staple "$app_path"
    rm -f "$notarize_zip"
  else
    warn "No notarization credentials configured; keeping an ad hoc signed local bundle."
  fi

  log "macOS bundle ready: $app_path"

  if [ -n "$dmg_path" ]; then
    log "Rebuilding DMG from the signed app bundle"
    dmg_stage="$(mktemp -d "${TMPDIR:-/tmp}/darkforge-dmg.XXXXXX")"
    ditto "$app_path" "$dmg_stage/DarkForge.app"
    ln -s /Applications "$dmg_stage/Applications"
    rm -f "$dmg_path"
    hdiutil create -quiet -volname "DarkForge" -srcfolder "$dmg_stage" -ov -format UDZO "$dmg_path"
    rm -rf "$dmg_stage"
    log "macOS DMG ready: $dmg_path"
  else
    warn "No DMG was produced by the Tauri build; skipping DMG rebuild."
  fi
}

# ---------------------------------------------------------------------------
# 1. Ensure PyInstaller is available
# ---------------------------------------------------------------------------

validate_notary_config

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
cargo tauri build "$@"

postprocess_macos_bundle

log "Done. Output: $SCRIPT_DIR/src-tauri/target/release/bundle/"
