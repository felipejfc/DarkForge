# Creating Repo-Linked Packages

DarkForge packages let users share both skills and reusable libraries from a
public GitHub repository.

## Package Layout

At the package root, add `darkforge-package.json`:

```json
{
  "schemaVersion": 1,
  "package": {
    "id": "example-tools",
    "name": "Example Tools",
    "summary": "Example shared DarkForge skills and libraries",
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

## Skill Manifests

Package skills use the same manifest shape as built-in skills, with one added
field:

- `libraryDependencies`: optional array of module IDs or unique aliases

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

Libraries are JavaScript entry files with metadata:

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

`exposureMode` values:

- `global`: auto-loaded into `Libraries.<namespace>`
- `module`: loaded lazily through `require(...)`
- `hybrid`: available through both forms

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
- canonical module IDs should be package-scoped, for example
  `require("example-tools/zip")`
- bare aliases work only when unique among enabled libraries

## Importing

Host Web UI and the iOS Skills tab can import a package from:

- `https://github.com/<owner>/<repo>`
- `https://github.com/<owner>/<repo>/tree/<ref>/<path>`
- `<owner>/<repo>@<ref>`

DarkForge resolves the source ref to a commit SHA and records that commit in the
installed package metadata.
