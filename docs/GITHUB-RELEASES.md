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

## iOS packaging notes

The GitHub workflow does not sign the iOS IPA. It builds the Release app with
`CODE_SIGNING_ALLOWED=NO`, wraps `Payload/DarkForge.app` into an `.ipa`, and
publishes that archive as a release asset.

That output is intended for tools such as Sideloadly that re-sign the IPA at
install time using the operator's Apple ID or developer account.

No Apple signing secrets are required for the GitHub iOS build job.
