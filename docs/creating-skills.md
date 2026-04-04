# Creating Skills

This guide explains how to add a DarkForge skill that can be discovered and run
from the native app or the host API.

## What A Skill Is

A skill is a small JavaScript workflow with structured metadata.

Each skill usually has:

- a JSON manifest in `skills/<id>.json`
- a JavaScript entry file in `skills/<entry>.js`

The manifest describes how the skill appears in the UI and how input values are
collected. The JS file contains the actual runtime logic.

## Where Skills Run

Skills currently run on the connected device through the `jscbridge` runtime.

That means a skill can use the JS helpers exposed by DarkForge, including
higher-level objects such as:

- `Apps`
- `Tasks`
- `TaskMemory`
- `RootFS`
- `FileUtils`
- `MachO`
- `Staging`

It can also use lower-level helpers such as:

- `kread64`, `kwrite64`
- `callSymbol`
- `rcall`
- `hex`, `add`, `sub`, `strip`
- `log` and `print`

Availability depends on the runtime being bootstrapped and connected.

## Skill File Layout

Recommended layout:

```text
skills/
  my-skill.json
  my-skill.js
```

The JSON file is the source of truth for discovery. If it declares an
`entryFile`, DarkForge loads the JavaScript from that file.

## Minimal Working Example

### `skills/hello-runtime.json`

```json
{
  "name": "Hello Runtime",
  "summary": "Log a message and return basic runtime information.",
  "runtime": "jscbridge",
  "executionMode": "interactive",
  "entryFile": "hello-runtime.js",
  "inputs": [
    {
      "id": "message",
      "label": "Message",
      "type": "text",
      "required": false,
      "defaultValue": "hello from DarkForge",
      "placeholder": "Type a message"
    }
  ]
}
```

### `skills/hello-runtime.js`

```js
(() => {
  const message = String(skillInput.message || "hello from DarkForge");
  log(`message: ${message}`);

  return JSON.stringify({
    ok: true,
    message,
    kernelBase,
    pid: typeof getpid_native === "function" ? getpid_native() : null,
  }, null, 2);
})();
```

## Manifest Fields

DarkForge normalizes skill manifests in `tools/kserver.py`.

Supported fields:

| Field | Required | Notes |
|---|---|---|
| `name` | yes when saving through API | User-facing skill name |
| `summary` | no | Short description shown in UI/API |
| `runtime` | no | Must currently be `jscbridge` |
| `executionMode` | no | `interactive` or `job` |
| `entryFile` | recommended | Must point to a `.js` file inside `skills/` |
| `inputs` | no | Array of structured input definitions |
| `libraryDependencies` | no | Array of module IDs or unique aliases for shared libraries |

Notes:

- If `entryFile` is omitted, the server can store inline `code` instead.
- Existing built-in skills use `entryFile`, which is the recommended pattern.
- `entryFile` must stay inside the `skills/` directory and must end in `.js`.

## Supported Input Types

The server currently accepts these input types:

- `text`
- `boolean`
- `select`
- `app`

### Text

```json
{
  "id": "outputSubdir",
  "label": "Output Subdirectory",
  "type": "text",
  "required": false,
  "defaultValue": "",
  "placeholder": "session-notes"
}
```

### Boolean

```json
{
  "id": "launchIfNeeded",
  "label": "Launch App If Needed",
  "type": "boolean",
  "required": false,
  "defaultValue": true
}
```

### Select

```json
{
  "id": "mode",
  "label": "Mode",
  "type": "select",
  "required": true,
  "defaultValue": "fast",
  "options": [
    { "value": "fast", "label": "Fast" },
    { "value": "full", "label": "Full" }
  ]
}
```

You can also provide `options` as plain strings:

```json
["fast", "full"]
```

### App

Use `app` when the user should choose an installed application.

```json
{
  "id": "target",
  "label": "Target App",
  "type": "app",
  "required": true
}
```

## How Inputs Reach Your Code

Before execution, DarkForge wraps the skill and injects:

```js
globalThis.skillInput = Object.freeze({...});
globalThis.SkillInput = globalThis.skillInput;
```

In practice, read inputs through `skillInput`:

```js
const enabled = skillInput.launchIfNeeded !== false;
const target = String(skillInput.target || "").trim();
```

Behavior to know:

- boolean values are coerced by the server
- missing optional values fall back to `defaultValue`
- required values are validated before execution
- input IDs are slugified and must be unique

## Execution Modes

### `interactive`

Use this when the skill should return a result directly.

Typical cases:

- listing installed apps
- quick inspections
- small transformations

### `job`

Use this when the skill may take time, produce artifacts, or run as a
background task.

Typical cases:

- app dumping
- packaging
- staged filesystem workflows

When a job skill is started, the server returns a `jobId` and tracks logs and
status separately.

## Returning Results

DarkForge accepts plain strings, JSON strings, and structured JS values.

Recommended pattern:

- use `log(...)` for progress updates
- return `JSON.stringify(result, null, 2)` for human-readable structured output

Example:

```js
return JSON.stringify({
  ok: true,
  artifactPath,
  count,
}, null, 2);
```

## Writing Good Skill Code

Recommended style:

- wrap the skill body in an IIFE
- validate required assumptions early
- log major phases
- return a structured result
- keep side effects explicit

Good pattern:

```js
(() => {
  const target = String(skillInput.target || "").trim();
  if (!target) throw new Error("Missing target");

  log(`resolving ${target}`);
  const app = Apps.resolveTarget(target, { forceRefresh: true });

  return JSON.stringify({
    ok: true,
    bundleId: app.bundleId,
    bundlePath: app.bundlePath,
  }, null, 2);
})();
```

## Testing Skills

### 1. Start The Host Server

```bash
python3 tools/kserver.py
```

### 2. List Installed Skills

```bash
curl -s http://localhost:9092/api/skills | jq
```

### 3. Fetch One Skill

```bash
curl -s http://localhost:9092/api/skills/list-installed-apps | jq
```

### 4. Run A Skill By ID

```bash
curl -s -X POST http://localhost:9092/api/skills/run \
  -H 'Content-Type: application/json' \
  -d '{
    "skillId": "list-installed-apps",
    "inputValues": {}
  }' | jq
```

### 5. Run Ad Hoc Skill Code Without Saving

```bash
curl -s -X POST http://localhost:9092/api/skills/run \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Ad Hoc Test",
    "runtime": "jscbridge",
    "executionMode": "interactive",
    "code": "(() => { log(\"hi\"); return JSON.stringify({ok:true}, null, 2); })()",
    "inputs": []
  }' | jq
```

### 6. Save A New Skill Through The API

```bash
curl -s -X POST http://localhost:9092/api/skills \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Hello Runtime",
    "summary": "Simple sanity-check skill",
    "runtime": "jscbridge",
    "executionMode": "interactive",
    "entryFile": "hello-runtime.js",
    "code": "(() => { return JSON.stringify({ok:true}, null, 2); })()",
    "inputs": []
  }' | jq
```

## Common Failure Cases

### `JSCBridge runtime requires a connected device`

The host has no active device runtime. Start the app, bootstrap the runtime, and
ensure the host connection is alive.

### `Skill entryFile escaped the skills directory`

Your `entryFile` must remain under `skills/`. Do not use `../` or absolute paths.

### `Unsupported skill input type`

Use only the currently supported types:

- `text`
- `boolean`
- `select`
- `app`

### `Missing required input`

The manifest marks that input as required and the provided `inputValues` object
did not include a valid value.

## Recommended Conventions

- Use kebab-case filenames.
- Keep manifest names user-friendly and short.
- Prefer one skill per JSON manifest.
- Put most logic in the `.js` file instead of inline JSON `code`.
- Return machine-readable JSON even for human-facing workflows.
- Write artifacts to stable paths and include those paths in the result object.

## Built-In Examples To Copy

Good reference skills in this repository:

- `skills/list-installed-apps.json`
- `skills/list-installed-apps.js`
- `skills/decrypt-ipa.json`
- `skills/decrypt-ipa.js`

For repo-linked package and library sharing, see
[`REPO.md`](./REPO.md).

Those examples show:

- manifest structure
- input handling
- app resolution
- logging
- structured JSON output
- longer-running job-style behavior
