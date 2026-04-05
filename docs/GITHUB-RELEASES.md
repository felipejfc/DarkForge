# GitHub Releases

The repository ships a tag-driven release workflow at
`.github/workflows/release.yml`.

## What it builds

- a macOS desktop `.dmg` using `tools/desktop/build.sh`
- an unsigned iOS `.ipa` from `DarkForge.xcodeproj` for Sideloadly-style install flows

Both artifacts are uploaded as workflow artifacts first, then attached to the
GitHub release for the matching tag.

## Triggering a release

Push a version tag that matches `v*`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also re-run the workflow manually with `workflow_dispatch` by providing
an existing tag name.

## macOS signing and notarization

By default, the macOS release DMG is ad hoc signed. That keeps the app bundle
internally valid and avoids the "damaged" Gatekeeper failure, but it still ships
as an unidentified developer app.

On another Mac, users may need to:

- open the app once
- go to System Settings -> Privacy & Security
- use `Open Anyway` for `DarkForge`

If you want a Developer ID signed and notarized DMG instead, configure these
GitHub Actions secrets:

- `MACOS_CERTIFICATE_P12_BASE64`: base64-encoded Developer ID Application `.p12`
- `MACOS_CERTIFICATE_PASSWORD`: password for that `.p12`
- `MACOS_SIGNING_IDENTITY`: full codesign identity name, for example
  `Developer ID Application: Example Corp (TEAMID)`
- `MACOS_NOTARY_APPLE_ID`: Apple ID used with `notarytool`
- `MACOS_NOTARY_PASSWORD`: app-specific password for that Apple ID
- `MACOS_NOTARY_TEAM_ID`: Apple Developer Team ID

When those secrets are absent, the workflow still publishes the ad hoc signed
DMG. When they are present, `tools/desktop/build.sh` upgrades the bundle to the
full Developer ID + notarized path.

## iOS packaging notes

The GitHub workflow does not sign the iOS IPA. It builds the Debug app with
`CODE_SIGNING_ALLOWED=NO`, wraps `Payload/DarkForge.app` into an `.ipa`, and
publishes that archive as a release asset.

That output is intended for tools such as Sideloadly that re-sign the IPA at
install time using the operator's Apple ID or developer account.

No Apple signing secrets are required for the GitHub iOS build job.
