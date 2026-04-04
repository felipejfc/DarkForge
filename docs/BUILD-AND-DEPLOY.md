# Build and Deploy

This workflow keeps signing details out of the repo. Put your local bundle ID
and team in `Config/Project.local.xcconfig`, then provide a device UDID only for
the shell session that needs it.

## Local Setup

```bash
cp Config/Project.local.xcconfig.example Config/Project.local.xcconfig
export DEVICE_ID=<your-device-udid>
export DERIVED_DATA_PATH="${PWD}/.deriveddata-darkforge"
export APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphoneos/DarkForge.app"
```

Use `--no-wifi` with `ios-deploy` when you want to force USB deployment.

## Project

- **Xcode project**: `DarkForge.xcodeproj`
- **Scheme**: `DarkForge`
- **Signing source**: `Config/Project.local.xcconfig`

## Build

Always use **Debug** configuration for device builds:

```bash
xcodebuild \
  -project DarkForge.xcodeproj \
  -scheme DarkForge \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -quiet \
  build
```

The `-destination 'generic/platform=iOS'` avoids device-lock timeouts.
Use `-destination "id=$DEVICE_ID"` only when the target device is unlocked and
you want Xcode to verify that it is reachable.

Output binary lands at:
```
$APP_PATH
```

## Deploy

```bash
ios-deploy \
  --id "$DEVICE_ID" \
  --bundle "$APP_PATH" \
  --no-wifi
```

The target device must be **unlocked** for install to succeed.

## REPL Server

After the app launches and the exploit completes, the REPL connects to a Mac-side
WebSocket server:

```bash
python3 tools/kserver.py
```

Listens on port 9090 (WebSocket) and 9092 (HTTP API).

### Remote calls via HTTP

```bash
# Call a function in launchd (root) context
curl -s -X POST http://localhost:9092/rcall -d '{"func":"getpid","args":[]}'

# Negative args (e.g. fd=-1) work — parsed via Int64 bitcast
curl -s -X POST http://localhost:9092/rcall -d '{"func":"mmap","args":[0,16384,3,4098,-1,0]}'
```

## Quick one-liner

```bash
xcodebuild -project DarkForge.xcodeproj -scheme DarkForge \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA_PATH" -quiet build && \
ios-deploy --id "$DEVICE_ID" \
  --bundle "$APP_PATH" \
  --no-wifi
```

## GitHub release automation

Release automation lives in [`../.github/workflows/release.yml`](../.github/workflows/release.yml).
It builds:

- an unsigned iOS `.ipa` for Sideloadly-style install flows
- a macOS desktop `.dmg`

Those assets are attached to the GitHub release for a matching `v*` tag. See
[`GITHUB-RELEASES.md`](./GITHUB-RELEASES.md) for the packaging details and the
tag-based release flow.
