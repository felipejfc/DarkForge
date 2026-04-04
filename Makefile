# DarkForge Makefile
#
# Common build / run / install actions for the desktop app, the iOS app,
# and the Mac-side kserver. Override any variable on the command line:
#
#     make ios-run IOS_DEVICE_ID=<your-device-udid>
#     make desktop-dev TAURI_ARGS=-- --verbose
#
# Run `make` or `make help` for a list of targets.

# ---- Configuration ---------------------------------------------------------

# iOS
IOS_PROJECT    ?= DarkForge.xcodeproj
IOS_SCHEME     ?= DarkForge
IOS_CONFIG     ?= Debug
IOS_ARCHS      ?= arm64e
IOS_DEVICE_ID  ?=
XCODEBUILD_FLAGS ?=
IOS_DEPLOY_FLAGS ?=
IOS_DD         := build/ios-dd
IOS_APP        := $(IOS_DD)/Build/Products/$(IOS_CONFIG)-iphoneos/DarkForge.app

-include Makefile.local

# Desktop (Tauri)
DESKTOP_DIR             := tools/desktop
DESKTOP_TAURI_DIR       := $(DESKTOP_DIR)/src-tauri
DESKTOP_VENV_DIR        := $(DESKTOP_DIR)/.venv
DESKTOP_PY_SPEC         := $(DESKTOP_DIR)/pyinstaller/kserver.spec
DESKTOP_PY_BUILD_DIR    := $(DESKTOP_DIR)/build
DESKTOP_PY_DIST_DIR     := $(DESKTOP_DIR)/dist
DESKTOP_BINARIES_DIR    := $(DESKTOP_TAURI_DIR)/binaries
DESKTOP_TARGET_TRIPLE   ?= $(shell rustc -vV 2>/dev/null | awk '/^host:/ {print $$2}')
DESKTOP_SIDECAR         := $(DESKTOP_BINARIES_DIR)/kserver-$(DESKTOP_TARGET_TRIPLE)
DESKTOP_BUNDLE_DIR      := $(DESKTOP_TAURI_DIR)/target/release/bundle
DESKTOP_APP             := $(DESKTOP_BUNDLE_DIR)/macos/DarkForge Console.app
DESKTOP_DMG             := $(DESKTOP_BUNDLE_DIR)/dmg
TAURI_ARGS              ?=

# Icons
ICON_SRC       := icon.png

.DEFAULT_GOAL := help
.PHONY: help \
        desktop-setup desktop-sidecar desktop-check desktop-dev desktop-build \
        desktop-package desktop-run desktop-install desktop-icon desktop-clean \
        ios-build ios-deploy ios-run ios-clean \
        server server-daemon \
        clean

# ---- Help ------------------------------------------------------------------

help:
	@echo "DarkForge build targets:"
	@echo ""
	@echo "  Desktop (macOS Tauri app):"
	@echo "    desktop-setup       Create the local Python venv and install desktop build deps"
	@echo "    desktop-sidecar     Freeze tools/kserver.py and copy it into Tauri sidecars"
	@echo "    desktop-check       cargo check the Tauri app"
	@echo "    desktop-dev         Run cargo tauri dev with the current sidecar"
	@echo "    desktop-build       Build the Tauri .app + .dmg bundle"
	@echo "    desktop-package     Alias for desktop-build"
	@echo "    desktop-run         Launch the built .app"
	@echo "    desktop-install     Copy .app to /Applications"
	@echo "    desktop-icon        Regenerate Tauri icons from $(ICON_SRC)"
	@echo "    desktop-clean       Remove desktop build artifacts"
	@echo ""
	@echo "  iOS (iPhone / iPad exploit app):"
	@echo "    ios-build           xcodebuild $(IOS_CONFIG) for iOS"
	@echo "    ios-deploy          Push .app to device via ios-deploy"
	@echo "    ios-run             ios-build + ios-deploy"
	@echo "    ios-clean           Remove Xcode build artifacts"
	@echo ""
	@echo "  Server:"
	@echo "    server              Run kserver.py (interactive REPL)"
	@echo "    server-daemon       Run kserver.py -d (no REPL, HTTP + WS only)"
	@echo ""
	@echo "  General:"
	@echo "    clean               desktop-clean + ios-clean"
	@echo ""
	@echo "  Overrides:  IOS_DEVICE_ID, IOS_CONFIG, IOS_SCHEME, IOS_ARCHS, TAURI_ARGS, DESKTOP_TARGET_TRIPLE"

# ---- Desktop ---------------------------------------------------------------

desktop-setup:
	@command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; exit 1; }
	@test -d "$(DESKTOP_VENV_DIR)" || python3 -m venv "$(DESKTOP_VENV_DIR)"
	@. "$(DESKTOP_VENV_DIR)/bin/activate" && \
		pip install --quiet --upgrade pip && \
		pip install --quiet pyinstaller websockets
	@echo "Desktop venv ready: $(DESKTOP_VENV_DIR)"

desktop-sidecar: desktop-setup
	@command -v rustc >/dev/null 2>&1 || { echo "rustc not found"; exit 1; }
	@test -n "$(DESKTOP_TARGET_TRIPLE)" || { echo "Unable to detect rust target triple"; exit 1; }
	@mkdir -p "$(DESKTOP_BINARIES_DIR)"
	@cd "$(DESKTOP_DIR)" && \
		. .venv/bin/activate && \
		pyinstaller --clean --noconfirm \
			--workpath "$(notdir $(DESKTOP_PY_BUILD_DIR))" \
			--distpath "$(notdir $(DESKTOP_PY_DIST_DIR))" \
			"pyinstaller/$(notdir $(DESKTOP_PY_SPEC))"
	@test -x "$(DESKTOP_PY_DIST_DIR)/kserver" || { echo "PyInstaller did not produce $(DESKTOP_PY_DIST_DIR)/kserver"; exit 1; }
	@cp "$(DESKTOP_PY_DIST_DIR)/kserver" "$(DESKTOP_SIDECAR)"
	@chmod +x "$(DESKTOP_SIDECAR)"
	@echo "Desktop sidecar ready: $(DESKTOP_SIDECAR)"

desktop-check:
	@command -v cargo >/dev/null 2>&1 || { echo "cargo not found"; exit 1; }
	@cd "$(DESKTOP_TAURI_DIR)" && cargo check

desktop-dev: desktop-sidecar
	@command -v cargo >/dev/null 2>&1 || { echo "cargo not found"; exit 1; }
	@cd "$(DESKTOP_TAURI_DIR)" && cargo tauri --version >/dev/null 2>&1 || { echo "tauri-cli not installed. Run: cargo install tauri-cli --version '^2.0.0'"; exit 1; }
	@cd "$(DESKTOP_TAURI_DIR)" && cargo tauri dev $(TAURI_ARGS)

desktop-build: desktop-sidecar
	@command -v cargo >/dev/null 2>&1 || { echo "cargo not found"; exit 1; }
	@cd "$(DESKTOP_TAURI_DIR)" && cargo tauri --version >/dev/null 2>&1 || { echo "tauri-cli not installed. Run: cargo install tauri-cli --version '^2.0.0'"; exit 1; }
	@cd "$(DESKTOP_TAURI_DIR)" && cargo tauri build $(TAURI_ARGS)

desktop-package: desktop-build

desktop-run:
	@test -d "$(DESKTOP_APP)" || { echo "Not built. Run: make desktop-build"; exit 1; }
	@open "$(DESKTOP_APP)"

desktop-install:
	@test -d "$(DESKTOP_APP)" || { echo "Not built. Run: make desktop-build"; exit 1; }
	@ditto "$(DESKTOP_APP)" "/Applications/DarkForge Console.app"
	@echo "Installed: /Applications/DarkForge Console.app"

desktop-icon:
	@test -f $(ICON_SRC) || { echo "Missing $(ICON_SRC)"; exit 1; }
	@cd $(DESKTOP_TAURI_DIR) && cargo tauri --version >/dev/null 2>&1 || { echo "tauri-cli not installed. Run: cargo install tauri-cli --version '^2.0.0'"; exit 1; }
	@cd $(DESKTOP_TAURI_DIR) && cargo tauri icon ../../../$(ICON_SRC)
	@echo "Icons regenerated. Run 'make desktop-build' to rebundle."

desktop-clean:
	@rm -rf "$(DESKTOP_PY_BUILD_DIR)" "$(DESKTOP_PY_DIST_DIR)"
	@rm -rf "$(DESKTOP_TAURI_DIR)/target"
	@rm -rf "$(DESKTOP_TAURI_DIR)/gen"
	@rm -f "$(DESKTOP_BINARIES_DIR)/kserver" "$(DESKTOP_BINARIES_DIR)"/kserver-*
	@echo "Cleaned desktop build artifacts"

# ---- iOS -------------------------------------------------------------------

ios-build:
	@xcodebuild \
		-project $(IOS_PROJECT) \
		-scheme $(IOS_SCHEME) \
		-configuration $(IOS_CONFIG) \
		-destination 'generic/platform=iOS' \
		-derivedDataPath $(IOS_DD) \
		ARCHS=$(IOS_ARCHS) \
		$(XCODEBUILD_FLAGS) \
		-quiet \
		build
	@echo "Built: $(IOS_APP)"

ios-deploy:
	@test -d "$(IOS_APP)" || { echo "Not built. Run: make ios-build"; exit 1; }
	@command -v ios-deploy >/dev/null 2>&1 || { echo "ios-deploy not installed. brew install ios-deploy"; exit 1; }
	@test -n "$(IOS_DEVICE_ID)" || { echo "Set IOS_DEVICE_ID or create Makefile.local from Makefile.local.example"; exit 1; }
	@ios-deploy --id $(IOS_DEVICE_ID) --bundle "$(IOS_APP)" --no-wifi $(IOS_DEPLOY_FLAGS)

ios-run: ios-build ios-deploy

ios-clean:
	@rm -rf $(IOS_DD)
	@echo "Cleaned: $(IOS_DD)"

# ---- Server ----------------------------------------------------------------

server:
	@python3 tools/kserver.py

server-daemon:
	@python3 tools/kserver.py -d

# ---- General ---------------------------------------------------------------

clean: desktop-clean ios-clean
