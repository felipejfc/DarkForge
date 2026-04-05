# Creating Repo-Linked Repositories

This guide explains how to structure a GitHub repository so DarkForge users can
add it as a shared repo and install both skills and reusable libraries.

For skill authoring details, also read
[`creating-skills.md`](./creating-skills.md).

## What A Repo Publishes

A DarkForge repo can publish:

- skills
- libraries
- shared package metadata

The repo root must contain `darkforge-package.json`.

## Minimal Layout

```text
my-darkforge-repo/
  darkforge-package.json
  skills/
    hello-skill.json
    hello-skill.js
  libraries/
    zip.json
    zip.js
```

## Root Index

Example `darkforge-package.json`:

```json
{
  "schemaVersion": 1,
  "package": {
    "id": "example-tools",
    "name": "Example Tools",
    "summary": "Shared DarkForge skills and libraries",
    "author": "DarkForge",
    "homepage": "https://github.com/example/example-tools"
  },
  "skills": [
    { "id": "hello-skill", "manifestPath": "skills/hello-skill.json" }
  ],
  "libraries": [
    { "id": "zip", "manifestPath": "libraries/zip.json" }
  ]
}
```

Rules:

- `schemaVersion` is currently `1`
- `manifestPath` values must stay inside the repo
- skill and library IDs should be stable and unique inside the repo

## Skill Manifests

Repo skills use the same manifest shape as built-in skills.

Useful fields:

- `id`
- `name`
- `summary`
- `runtime`
- `executionMode`
- `entryFile`
- `inputs`
- `libraryDependencies`

Example:

```json
{
  "id": "hello-skill",
  "name": "Hello Skill",
  "summary": "Calls a shared helper library",
  "runtime": "jscbridge",
  "executionMode": "interactive",
  "entryFile": "hello-skill.js",
  "libraryDependencies": ["example-tools/zip"]
}
```

## Library Manifests

Libraries are JavaScript entry files plus metadata.

Example:

```json
{
  "id": "zip",
  "name": "ZIP Utilities",
  "summary": "Shared ZIP helpers",
  "entryFile": "zip.js",
  "version": "1.0.0",
  "exposureMode": "hybrid",
  "namespace": "zip",
  "moduleId": "example-tools/zip",
  "dependencies": [],
  "enabledByDefault": true,
  "exports": ["createZip", "crc32"],
  "apiReference": [
    {
      "name": "Libraries.zip.createZip",
      "signature": "Libraries.zip.createZip(zipPath, rootDir, prefix)",
      "category": "Libraries",
      "description": "Create a ZIP archive",
      "snippet": "Libraries.zip.createZip(\"/tmp/out.zip\", \"/tmp\", \"Payload\");"
    }
  ]
}
```

Important fields:

- `exposureMode`
  - `global`: auto-loaded into `Libraries.<namespace>`
  - `module`: loaded on `require(...)`
  - `hybrid`: available both ways
- `moduleId`
  - use a package-scoped ID such as `example-tools/zip`
- `apiReference`
  - powers the Web UI API reference for installed enabled libraries

## Library Entry Files

Libraries use a small CommonJS-style contract:

```js
function createZip(zipPath, rootDir, prefix) {
  return { zipPath, rootDir, prefix };
}

module.exports = {
  createZip,
};
```

Rules:

- `require()` is synchronous
- only string-literal module IDs are supported
- no relative imports or npm-style resolution
- bare aliases only work when they are unique among enabled libraries

## Adding The Repo In DarkForge

Users can add a repo from:

- `https://github.com/<owner>/<repo>`
- `https://github.com/<owner>/<repo>/tree/<ref>/<path>`
- `<owner>/<repo>@<ref>`
- `file:///absolute/path/to/repo`
- `/absolute/path/to/repo`
- `./relative/path/to/repo`

For GitHub sources, DarkForge resolves the requested ref to a commit SHA and
records that commit in the installed repo metadata.

For local repo testing, point DarkForge at a local directory that already
contains `darkforge-package.json`. Re-adding or updating that repo will refresh
the installed copy from local disk.
