import { API_CATALOG, API_CATEGORIES, DEFAULT_SCRIPT, updateApiCatalog } from "./src/catalog.js";
import {
  closeModal,
  confirmAction,
  connectEventStream,
  copyServerLogs,
  els,
  ensureConsoleOpen,
  escapeHtml,
  formatDate,
  installConsoleBehaviors,
  installConfirmBehaviors,
  installModalDismiss,
  openModal,
  refreshServerLogs,
  refreshStatus,
  requestJson,
  setBusy,
  setConsoleTab,
  setRunMeta,
  setView,
  showToast,
  state,
  writeLogs,
  writeResult,
  writeServerLogs,
} from "./src/shared.js";
import { handleConnectionLoss, installFileManagerBehaviors, loadDirectory } from "./src/files.js";

const TOKEN_REGEX = /\/\/.*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:0x[\da-fA-F]+n?|\d+(?:\.\d+)?n?)\b|\b(?:const|let|var|if|else|return|function|class|for|while|try|catch|throw|new|await|async|switch|case|break|continue|typeof|instanceof|in|of)\b|\b(?:true|false|null|undefined|Native|FileUtils|RootFS|Apps|Tasks|TaskMemory|MachO|Staging|Libraries|skillInput|SkillInput|log|require|BigInt)\b/g;

function classifyToken(token) {
  if (token.startsWith("//") || token.startsWith("/*")) return "tok-comment";
  if (token.startsWith("'") || token.startsWith('"') || token.startsWith("`")) return "tok-string";
  if (/^(?:0x[\da-fA-F]+n?|\d+(?:\.\d+)?n?)$/.test(token)) return "tok-number";
  if (/^(?:const|let|var|if|else|return|function|class|for|while|try|catch|throw|new|await|async|switch|case|break|continue|typeof|instanceof|in|of)$/.test(token)) return "tok-keyword";
  return "tok-constant";
}

function highlight(code) {
  let output = "";
  let lastIndex = 0;
  code.replace(TOKEN_REGEX, (...args) => {
    const [token] = args;
    const offset = args.at(-2);
    output += escapeHtml(code.slice(lastIndex, offset));
    output += `<span class="${classifyToken(token)}">${escapeHtml(token)}</span>`;
    lastIndex = offset + token.length;
    return token;
  });
  output += escapeHtml(code.slice(lastIndex));
  return output || " ";
}

function updateDirtyState() {
  const isDirty = els.editorInput.value !== state.lastSavedCode;
  if (isDirty !== state.dirty) {
    state.dirty = isDirty;
    els.dirtyIndicator.hidden = !isDirty;
  }
}

function updateEditorPresentation() {
  const code = els.editorInput.value;
  els.highlightLayer.innerHTML = highlight(code);
  const lineCount = Math.max(code.split("\n").length, 1);
  els.lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  updateDirtyState();
}

function syncEditorScroll() {
  els.highlightLayer.scrollTop = els.editorInput.scrollTop;
  els.highlightLayer.scrollLeft = els.editorInput.scrollLeft;
  els.lineNumbers.scrollTop = els.editorInput.scrollTop;
}

function getSelectOptions(def) {
  if (!Array.isArray(def?.options)) return [];
  return def.options.map(normalizeOptionDefinition);
}

function defaultInputValue(def) {
  if (def.type === "boolean") return Boolean(def.defaultValue);
  if (def.type === "select") {
    const options = getSelectOptions(def);
    const value = String(def.defaultValue || "").trim();
    return options.some((option) => option.value === value) ? value : (options[0]?.value || "");
  }
  if (def.type === "app") return def.defaultValue || "";
  return def.defaultValue || "";
}

function normalizeOptionDefinition(option) {
  if (typeof option === "string") return { value: option, label: option };
  if (!option || typeof option !== "object") throw new Error("Select options must be strings or objects.");
  const value = String(option.value || "").trim();
  if (!value) throw new Error("Select options require a non-empty value.");
  return { value, label: String(option.label || value).trim() || value };
}

function normalizeInputDefinition(def, index) {
  if (!def || typeof def !== "object" || Array.isArray(def)) throw new Error(`Input ${index + 1} must be an object.`);
  const id = String(def.id || def.label || `input-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error(`Input ${index + 1} needs a valid id.`);
  const type = String(def.type || "text").trim().toLowerCase();
  if (!["text", "boolean", "select", "app"].includes(type)) throw new Error(`Unsupported input type: ${type}`);
  const normalized = {
    id,
    label: String(def.label || id.replace(/-/g, " ")).trim() || id,
    type,
    required: Boolean(def.required),
  };
  if (type === "boolean") {
    normalized.defaultValue = Boolean(def.defaultValue);
  } else if (type === "select") {
    const options = Array.isArray(def.options) ? def.options.map(normalizeOptionDefinition) : [];
    if (options.length === 0) throw new Error(`Select input "${id}" requires a non-empty options array.`);
    const allowed = new Set(options.map((option) => option.value));
    const defaultValue = String(def.defaultValue || options[0].value);
    normalized.options = options;
    normalized.defaultValue = allowed.has(defaultValue) ? defaultValue : options[0].value;
  } else {
    normalized.defaultValue = String(def.defaultValue || "");
    normalized.placeholder = String(def.placeholder || "");
  }
  return normalized;
}

function parseSkillInputSchema() {
  const raw = els.skillInputsSchema.value.trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Input schema must be valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("Input schema must be a JSON array.");
  const normalized = parsed.map(normalizeInputDefinition);
  const seen = new Set();
  for (const def of normalized) {
    if (seen.has(def.id)) throw new Error(`Duplicate input id: ${def.id}`);
    seen.add(def.id);
  }
  return normalized;
}

function parseLibraryDependencies() {
  const raw = els.skillLibraryDependencies.value.trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Library dependencies must be valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("Library dependencies must be a JSON array.");
  return parsed.map((value) => String(value || "").trim()).filter(Boolean);
}

function setSchemaStatus(message, variant = "") {
  els.skillSchemaStatus.textContent = message;
  els.skillSchemaStatus.className = "field-help" + (variant ? ` is-${variant}` : "");
}

function refreshSchemaFromEditor() {
  try {
    state.skillInputs = parseSkillInputSchema();
    const count = state.skillInputs.length;
    setSchemaStatus(count > 0 ? `${count} input${count === 1 ? "" : "s"} defined.` : "No structured inputs defined.");
  } catch (error) {
    state.skillInputs = [];
    setSchemaStatus(error.message, "error");
  }
}

const appPickerState = { apps: null, loading: false, error: null };

async function fetchAppList(force = false) {
  if (appPickerState.apps && !force) return appPickerState.apps;
  if (appPickerState.loading) return appPickerState.apps || [];
  appPickerState.loading = true;
  appPickerState.error = null;
  try {
    const response = await fetch("/api/apps");
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    appPickerState.apps = (data.apps || []).map((app) => ({
      ...app,
      isSystem: app.bundlePath.startsWith("/Applications/"),
    }));
    return appPickerState.apps;
  } catch (error) {
    appPickerState.error = error.message;
    return [];
  } finally {
    appPickerState.loading = false;
  }
}

function renderAppPicker(def, onSelect) {
  const container = document.createElement("div");
  container.className = "app-picker";

  const header = document.createElement("div");
  header.className = "app-picker-header";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search apps...";
  searchInput.className = "app-picker-search";
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "app-picker-toggle";
  const toggleCb = document.createElement("input");
  toggleCb.type = "checkbox";
  toggleCb.checked = true;
  const toggleText = document.createElement("span");
  toggleText.textContent = "Hide system apps";
  toggleLabel.append(toggleCb, toggleText);
  header.append(searchInput, toggleLabel);

  const listEl = document.createElement("div");
  listEl.className = "app-picker-list";

  const statusEl = document.createElement("div");
  statusEl.className = "app-picker-status";
  statusEl.textContent = "Loading apps...";

  const selectedEl = document.createElement("div");
  selectedEl.className = "app-picker-selected";
  selectedEl.hidden = true;

  container.append(selectedEl, header, statusEl, listEl);

  let allApps = [];
  let selectedBundleId = "";

  function renderList() {
    listEl.innerHTML = "";
    let apps = allApps;
    if (toggleCb.checked) apps = apps.filter((app) => !app.isSystem);
    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      apps = apps.filter((app) => app.name.toLowerCase().includes(query) || app.bundleId.toLowerCase().includes(query));
    }

    statusEl.textContent = `${apps.length} app${apps.length === 1 ? "" : "s"}`;
    statusEl.hidden = apps.length > 0;

    for (const app of apps) {
      const row = document.createElement("div");
      row.className = "app-picker-row" + (app.bundleId === selectedBundleId ? " selected" : "");
      const fallback = document.createElement("div");
      fallback.className = "app-picker-icon-fallback";
      fallback.textContent = (app.name || "?")[0].toUpperCase();
      fallback.style.display = "flex";
      const info = document.createElement("div");
      info.className = "app-picker-info";
      const nameEl = document.createElement("div");
      nameEl.className = "app-picker-name";
      nameEl.textContent = app.name;
      const idEl = document.createElement("div");
      idEl.className = "app-picker-bundleid";
      idEl.textContent = app.bundleId;
      info.append(nameEl, idEl);
      if (app.isSystem) {
        const badge = document.createElement("span");
        badge.className = "app-picker-sys-badge";
        badge.textContent = "SYS";
        row.append(fallback, info, badge);
      } else {
        row.append(fallback, info);
      }
      row.addEventListener("click", () => {
        selectedBundleId = app.bundleId;
        onSelect(app.bundleId);
        selectedEl.hidden = false;
        selectedEl.innerHTML = "";
        const selectedText = document.createElement("span");
        selectedText.textContent = `${app.name} (${app.bundleId})`;
        selectedEl.append(selectedText);
        renderList();
      });
      listEl.append(row);
    }
  }

  searchInput.addEventListener("input", renderList);
  toggleCb.addEventListener("change", renderList);

  fetchAppList().then((apps) => {
    allApps = apps;
    if (appPickerState.error) {
      statusEl.textContent = `Error: ${appPickerState.error}`;
    } else {
      renderList();
    }
  });

  return container;
}

function renderRunModal(definitions) {
  els.runModalBody.innerHTML = "";
  state.skillInputValues = {};

  if (definitions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "run-inputs-empty";
    empty.textContent = "This skill has no inputs. Click Execute to run.";
    els.runModalBody.append(empty);
    return;
  }

  for (const def of definitions) {
    const value = defaultInputValue(def);
    state.skillInputValues[def.id] = value;

    if (def.type === "boolean") {
      const wrapper = document.createElement("label");
      wrapper.className = "run-checkbox";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.addEventListener("change", () => {
        state.skillInputValues[def.id] = input.checked;
      });
      const text = document.createElement("span");
      text.className = "run-checkbox-label";
      text.textContent = def.label;
      wrapper.append(input, text);
      els.runModalBody.append(wrapper);
      continue;
    }

    if (def.type === "app") {
      const row = document.createElement("div");
      row.className = "run-input-row";
      const label = document.createElement("label");
      label.textContent = def.required ? `${def.label} *` : def.label;
      const picker = renderAppPicker(def, (bundleId) => {
        state.skillInputValues[def.id] = bundleId;
      });
      row.append(label, picker);
      els.runModalBody.append(row);
      continue;
    }

    const row = document.createElement("div");
    row.className = "run-input-row";
    const label = document.createElement("label");
    label.textContent = def.required ? `${def.label} *` : def.label;

    const input = def.type === "select" ? document.createElement("select") : document.createElement("input");
    if (def.type === "select") {
      const options = getSelectOptions(def);
      input.className = "run-select-input";
      for (const opt of options) {
        const optEl = document.createElement("option");
        optEl.value = opt.value;
        optEl.textContent = opt.label;
        input.append(optEl);
      }
      if (options.length === 0) {
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "No options available";
        input.append(emptyOption);
        input.disabled = true;
      }
      input.value = String(value || options[0]?.value || "");
    } else {
      input.type = "text";
      input.value = String(value);
      if (def.placeholder) input.placeholder = def.placeholder;
    }
    input.addEventListener("input", () => {
      state.skillInputValues[def.id] = input.value;
    });
    input.addEventListener("change", () => {
      state.skillInputValues[def.id] = input.value;
    });
    row.append(label, input);
    els.runModalBody.append(row);
  }
}

function showRunModal() {
  const skillName = els.skillName.value.trim() || "Scratch Buffer";
  els.runModalTitle.textContent = `Run: ${skillName}`;
  renderRunModal(state.skillInputs);
  openModal(els.runModal);
  const firstInput = els.runModalBody.querySelector("input, select");
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function filteredSkills() {
  const query = els.skillSearch.value.trim().toLowerCase();
  if (!query) return state.skills;
  return state.skills.filter((skill) => skill.name.toLowerCase().includes(query) || (skill.summary || "").toLowerCase().includes(query));
}

function renderSkillGrid() {
  const skills = filteredSkills();
  els.skillGrid.innerHTML = "";
  els.statusSkillCount.textContent = String(state.skills.length);

  if (skills.length === 0) {
    const empty = document.createElement("div");
    empty.className = "skill-grid-empty";
    const icon = document.createElement("div");
    icon.className = "skill-grid-empty-icon";
    icon.textContent = state.skills.length === 0 ? "{ }" : "?";
    const message = document.createElement("p");
    message.textContent = state.skills.length === 0
      ? "No saved skills yet. Create one with the button above."
      : "No skills match your search.";
    empty.append(icon, message);
    els.skillGrid.append(empty);
    return;
  }

  for (const skill of skills) {
    const card = document.createElement("div");
    card.className = "skill-card";

    const header = document.createElement("div");
    header.className = "skill-card-header";
    const name = document.createElement("strong");
    name.className = "skill-card-name";
    name.textContent = skill.name;
    const date = document.createElement("span");
    date.className = "skill-card-date";
    date.textContent = formatDate(skill.updatedAt);
    header.append(name, date);

    const summary = document.createElement("p");
    summary.className = "skill-card-summary";
    summary.textContent = skill.summary || "No description";

    const tags = document.createElement("div");
    tags.className = "skill-card-tags";
    if (skill.sourceType) {
      const sourceTag = document.createElement("span");
      sourceTag.className = "tag tag-muted";
      sourceTag.textContent = skill.sourceType === "linked" ? `Linked${skill.packageName ? ` · ${skill.packageName}` : ""}` : (skill.sourceType === "local" ? "Local" : "Built-in");
      tags.append(sourceTag);
    }
    if (skill.executionMode === "job") {
      const modeTag = document.createElement("span");
      modeTag.className = "tag tag-warm";
      modeTag.textContent = "Detached Job";
      tags.append(modeTag);
    }
    if (skill.inputCount > 0) {
      const inputTag = document.createElement("span");
      inputTag.className = "tag tag-muted";
      inputTag.textContent = `${skill.inputCount} input${skill.inputCount === 1 ? "" : "s"}`;
      tags.append(inputTag);
    }
    if (Array.isArray(skill.libraryDependencies) && skill.libraryDependencies.length > 0) {
      const depsTag = document.createElement("span");
      depsTag.className = "tag tag-muted";
      depsTag.textContent = `${skill.libraryDependencies.length} libr${skill.libraryDependencies.length === 1 ? "ary" : "aries"}`;
      tags.append(depsTag);
    }

    const footer = document.createElement("div");
    footer.className = "skill-card-footer";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "btn btn-primary btn-sm";
    runBtn.textContent = "Run";
    runBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      quickRunSkill(skill.id);
    });
    footer.append(runBtn);

    if (tags.childElementCount > 0) {
      card.append(header, summary, tags, footer);
    } else {
      card.append(header, summary, footer);
    }
    card.addEventListener("click", () => openSkillInEditor(skill.id));
    els.skillGrid.append(card);
  }
}

function syncSkillModeControls() {
  const attached = Boolean(state.selectedSkillId);
  els.exitSkillModeButton.hidden = !attached;
  els.exitSkillModeButton.disabled = state.busy || !attached;
  els.deleteSkillButton.disabled = state.busy || !attached || state.selectedSkillSourceType !== "local";
}

function setSelectedSkill(skillId, sourceType = null) {
  state.selectedSkillId = skillId || null;
  state.selectedSkillSourceType = sourceType || null;
  syncSkillModeControls();
}

function populateEditor(skill) {
  els.skillName.value = skill?.name || "";
  els.skillSummary.value = skill?.summary || "";
  els.skillRuntime.value = skill?.runtime || "jscbridge";
  els.skillExecutionMode.value = skill?.executionMode || "interactive";
  els.skillInputsSchema.value = JSON.stringify(skill?.inputs || [], null, 2);
  els.skillLibraryDependencies.value = JSON.stringify(skill?.libraryDependencies || [], null, 2);
  els.editorInput.value = skill?.code || DEFAULT_SCRIPT;
  state.skillRuntime = els.skillRuntime.value;
  state.skillExecutionMode = els.skillExecutionMode.value;
  state.skillEntryFile = skill?.entryFile || "";
  state.skillLibraryDependencies = Array.isArray(skill?.libraryDependencies) ? [...skill.libraryDependencies] : [];
  state.skillInputValues = {};
  refreshSchemaFromEditor();
  state.lastSavedCode = els.editorInput.value;
  state.dirty = false;
  els.dirtyIndicator.hidden = true;
  updateEditorPresentation();
}

function exitSkillMode() {
  if (!state.selectedSkillId) return;
  setSelectedSkill(null);
  state.skillEntryFile = "";
  state.skillLibraryDependencies = [];
  state.skillInputValues = {};
  els.skillInputsSchema.value = "";
  els.skillLibraryDependencies.value = "";
  refreshSchemaFromEditor();
  state.lastSavedCode = "";
  updateDirtyState();
  showToast("Exited skill mode. Saved skill inputs were cleared for this draft.", "info");
}

async function openSkillInEditor(skillId) {
  try {
    const skill = await requestJson(`/api/skills/${encodeURIComponent(skillId)}`, { headers: {} });
    setSelectedSkill(skill.id, skill.sourceType);
    populateEditor(skill);
    setView("editor");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function quickRunSkill(skillId) {
  try {
    const skill = await requestJson(`/api/skills/${encodeURIComponent(skillId)}`, { headers: {} });
    setSelectedSkill(skill.id, skill.sourceType);
    populateEditor(skill);
    setView("editor");
    initiateRun();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function resetDraft() {
  setSelectedSkill(null);
  populateEditor({
    name: "",
    summary: "",
    runtime: "jscbridge",
    executionMode: "interactive",
    inputs: [],
    libraryDependencies: [],
    code: DEFAULT_SCRIPT,
  });
}

function initiateRun() {
  let inputs;
  let libraryDependencies;
  try {
    inputs = parseSkillInputSchema();
    libraryDependencies = parseLibraryDependencies();
  } catch (error) {
    setSchemaStatus(error.message, "error");
    showToast(error.message, "error");
    return;
  }
  state.skillInputs = inputs;
  state.skillLibraryDependencies = libraryDependencies;

  if (inputs.length > 0) {
    showRunModal();
  } else {
    state.skillInputValues = {};
    executeRun();
  }
}

function formatJobToastMessage(jobId, status) {
  const label = status === "queued" ? "Async job queued" : "Async job running";
  return `${label}\n${jobId}`;
}

function showActiveJobToast(jobId, status) {
  const message = formatJobToastMessage(jobId, status);
  if (state.activeJobToast) {
    state.activeJobToast.update(message, "running", 0, { dismissible: false });
    return;
  }
  state.activeJobToast = showToast(message, "running", 0, { dismissible: false });
}

function resolveActiveJobToast(message, variant) {
  const duration = variant === "error" ? 5000 : 2200;
  if (state.activeJobToast) {
    const toast = state.activeJobToast;
    state.activeJobToast = null;
    toast.update(message, variant, duration, { dismissible: true });
    return;
  }
  showToast(message, variant, duration);
}

async function executeRun() {
  closeModal(els.runModal);
  const code = els.editorInput.value;
  if (!code.trim()) {
    showToast("Script is empty.", "error");
    return;
  }

  if (state.activeView !== "editor") setView("editor");

  setBusy(true);
  ensureConsoleOpen("result");
  writeResult("Executing…");
  writeLogs([]);
  const startedAt = performance.now();
  setRunMeta("Running", "running");

  try {
    const target = els.targetSelect.value;
    const result = await requestJson("/api/skills/run", {
      method: "POST",
      body: JSON.stringify({
        skillId: state.selectedSkillId,
        name: els.skillName.value.trim(),
        summary: els.skillSummary.value.trim(),
        code,
        runtime: els.skillRuntime.value,
        executionMode: els.skillExecutionMode.value,
        inputs: state.skillInputs,
        inputValues: state.skillInputValues,
        entryFile: state.skillEntryFile || undefined,
        libraryDependencies: state.skillLibraryDependencies,
        target: target !== "auto" ? target : undefined,
      }),
    });
    if (result.jobId) {
      state.activeJobId = result.jobId;
      showActiveJobToast(result.jobId, "queued");
      const elapsed = `${Math.round(performance.now() - startedAt)} ms`;
      setRunMeta(`Job queued in ${elapsed}`, "running");
      writeResult(`Async job started.\njobId: ${result.jobId}`);
      writeLogs([]);
      setConsoleTab("result");
      await refreshJob(result.jobId);
    } else {
      const elapsed = `${Math.round(performance.now() - startedAt)} ms`;
      if (result.error) {
        setRunMeta(`Failed in ${elapsed}`, "error");
        showToast("Execution failed", "error");
      } else {
        setRunMeta(`Completed in ${elapsed}`);
      }
      writeResult(result.error || result.value || "undefined", Boolean(result.error));
      writeLogs(result.logs || []);
      setConsoleTab(result.error ? "result" : ((result.logs || []).length > 0 ? "logs" : "result"));
    }
  } catch (error) {
    setRunMeta("Execution failed", "error");
    writeResult(error.message, true);
    writeLogs([]);
    setConsoleTab("result");
    showToast("Execution failed", "error");
  } finally {
    setBusy(false);
    await refreshStatus(handleConnectionLoss);
  }
}

async function saveSkill() {
  const name = els.skillName.value.trim();
  const code = els.editorInput.value;
  if (!name) {
    showToast("Skill name is required.", "error");
    els.skillName.focus();
    return;
  }
  if (!code.trim()) {
    showToast("Cannot save an empty skill.", "error");
    return;
  }

  let inputs;
  let libraryDependencies;
  try {
    inputs = parseSkillInputSchema();
    libraryDependencies = parseLibraryDependencies();
  } catch (error) {
    setSchemaStatus(error.message, "error");
    showToast(error.message, "error");
    return;
  }

  setBusy(true);
  try {
    const saved = await requestJson("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        id: state.selectedSkillSourceType === "local" ? state.selectedSkillId : undefined,
        previousId: state.selectedSkillSourceType === "local" ? state.selectedSkillId : undefined,
        name,
        summary: els.skillSummary.value.trim(),
        code,
        runtime: els.skillRuntime.value,
        executionMode: els.skillExecutionMode.value,
        inputs,
        entryFile: state.skillEntryFile || undefined,
        libraryDependencies,
      }),
    });
    setSelectedSkill(saved.id, saved.sourceType);
    state.lastSavedCode = code;
    state.dirty = false;
    els.dirtyIndicator.hidden = true;
    els.skillName.value = saved.name;
    state.skillLibraryDependencies = libraryDependencies;
    showToast(`Saved "${saved.name}"`, "success");
    await refreshSkills();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function deleteSkill() {
  if (!state.selectedSkillId) return;
  const skill = state.skills.find((item) => item.id === state.selectedSkillId);
  const confirmed = await confirmAction({
    title: "Delete skill",
    message: `Delete skill "${skill?.name || state.selectedSkillId}"?`,
    confirmLabel: "Delete skill",
  });
  if (!confirmed) return;

  setBusy(true);
  try {
    await requestJson(`/api/skills/${encodeURIComponent(state.selectedSkillId)}`, { method: "DELETE" });
    const deletedName = skill?.name || state.selectedSkillId;
    resetDraft();
    showToast(`Deleted "${deletedName}"`, "info");
    await refreshSkills();
    setView("skills");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshJob(jobId) {
  if (!jobId) return null;
  try {
    const job = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, { headers: {} });
    handleJobEvent(job);
    return job;
  } catch {
    return null;
  }
}

function handleJobEvent(job) {
  if (!job?.jobId) return;
  state.jobs[job.jobId] = job;
  if (state.activeJobId !== job.jobId) return;

  if (Array.isArray(job.logs) && job.logs.length > 0) writeLogs(job.logs);

  if (job.status === "running" || job.status === "queued") {
    showActiveJobToast(job.jobId, job.status);
    setRunMeta(`Job ${job.status}`, "running");
    return;
  }
  if (job.status === "completed") {
    state.activeJobId = null;
    setBusy(false);
    resolveActiveJobToast(`Async job completed\n${job.jobId}`, "success");
    setRunMeta("Job completed");
    writeResult(job.result || "undefined", false);
    setConsoleTab((job.logs || []).length > 0 ? "logs" : "result");
    return;
  }
  if (job.status === "failed" || job.status === "lost") {
    state.activeJobId = null;
    setBusy(false);
    resolveActiveJobToast(`Async job ${job.status}\n${job.jobId}`, "error");
    setRunMeta(`Job ${job.status}`, "error");
    writeResult(job.error || "Job failed", true);
    setConsoleTab("result");
  }
}

async function refreshSkills() {
  const data = await requestJson("/api/skills", { headers: {} });
  state.skills = data.skills || [];
  renderSkillGrid();
}

function renderPackageManager() {
  els.packageList.innerHTML = "";
  els.libraryList.innerHTML = "";

  if (!state.packages.length) {
    const empty = document.createElement("div");
    empty.className = "package-item-empty";
    empty.textContent = "No linked repos installed.";
    els.packageList.append(empty);
  }

  for (const pkg of state.packages) {
    const card = document.createElement("div");
    card.className = "package-item";

    const title = document.createElement("div");
    title.className = "package-item-title";
    title.textContent = pkg.name;

    const meta = document.createElement("div");
    meta.className = "package-item-meta";
    if (pkg.sourceKind === "local") {
      meta.textContent = `${pkg.sourcePath}${pkg.sourceHash ? ` (${pkg.sourceHash.slice(0, 12)})` : ""}`;
    } else {
      meta.textContent = `${pkg.repoUrl} @ ${pkg.sourceRef}${pkg.resolvedCommit ? ` (${pkg.resolvedCommit.slice(0, 12)})` : ""}`;
    }

    const summary = document.createElement("p");
    summary.className = "package-item-summary";
    summary.textContent = pkg.summary || `${pkg.skillCount} skills · ${pkg.libraryCount} libraries`;

    const actions = document.createElement("div");
    actions.className = "package-item-actions";
    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "btn btn-ghost btn-sm";
    checkBtn.textContent = "Check";
    checkBtn.addEventListener("click", () => checkPackageUpdate(pkg.id));
    const updateBtn = document.createElement("button");
    updateBtn.type = "button";
    updateBtn.className = "btn btn-secondary btn-sm";
    updateBtn.textContent = "Update";
    updateBtn.addEventListener("click", () => updatePackage(pkg.id));
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-ghost btn-sm btn-danger";
    deleteBtn.textContent = "Remove";
    deleteBtn.addEventListener("click", () => deletePackage(pkg.id));
    actions.append(checkBtn, updateBtn, deleteBtn);

    card.append(title, meta, summary, actions);
    els.packageList.append(card);
  }

  if (!state.libraries.length) {
    const empty = document.createElement("div");
    empty.className = "package-item-empty";
    empty.textContent = "No libraries available.";
    els.libraryList.append(empty);
  }

  for (const library of state.libraries) {
    const row = document.createElement("label");
    row.className = "package-item library-item";

    const top = document.createElement("div");
    top.className = "library-item-top";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(library.enabled);
    checkbox.disabled = library.sourceType !== "linked";
    checkbox.addEventListener("change", () => toggleLibrary(library.moduleId, checkbox.checked));
    const title = document.createElement("strong");
    title.textContent = `${library.name} (${library.moduleId})`;
    top.append(checkbox, title);

    const meta = document.createElement("div");
    meta.className = "package-item-meta";
    meta.textContent = `${library.exposureMode}${library.namespace ? ` · Libraries.${library.namespace}` : ""}${library.packageName ? ` · ${library.packageName}` : ""}`;

    const summary = document.createElement("p");
    summary.className = "package-item-summary";
    summary.textContent = library.summary || "No description";

    row.append(top, meta, summary);
    els.libraryList.append(row);
  }
}

async function refreshPackagesAndLibraries() {
  const [packages, libraries, runtimeCatalog] = await Promise.all([
    requestJson("/api/packages", { headers: {} }),
    requestJson("/api/libraries", { headers: {} }),
    requestJson("/api/runtime/catalog", { headers: {} }),
  ]);
  state.packages = packages.packages || [];
  state.libraries = libraries.libraries || [];
  updateApiCatalog(runtimeCatalog.apiCatalog || []);
  renderApiRefList(els.apiRefSearch.value.trim());
  renderPackageManager();
}

async function previewPackageSource() {
  const source = els.packageSourceInput.value.trim();
  if (!source) {
    showToast("Enter a repo URL or local path first.", "error");
    return null;
  }
  return requestJson("/api/package-import/preview", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

async function showPackagePreview() {
  const preview = await previewPackageSource();
  if (!preview) return null;
  ensureConsoleOpen("result");
  writeResult(JSON.stringify(preview, null, 2));
  showToast(`Previewed repo "${preview.package.name}"`, "info");
  return preview;
}

async function installPackageSource() {
  const source = els.packageSourceInput.value.trim();
  if (!source) {
    showToast("Enter a repo URL or local path first.", "error");
    return;
  }
  const preview = await previewPackageSource();
  if (!preview) return;
  ensureConsoleOpen("result");
  writeResult(JSON.stringify(preview, null, 2));
  const result = await requestJson("/api/package-import/install", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
  showToast(`Added repo "${result.package.name}"`, "success");
  await Promise.all([refreshSkills(), refreshPackagesAndLibraries()]);
}

async function checkPackageUpdate(packageId) {
  const result = await requestJson(`/api/packages/${encodeURIComponent(packageId)}/check-update`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (result.sourceKind === "local") {
    showToast(result.hasUpdate ? `Local changes detected for ${packageId}` : `${packageId} matches the local repo`, result.hasUpdate ? "info" : "success");
    return;
  }
  showToast(result.hasUpdate ? `Update available for ${packageId}` : `${packageId} is current`, result.hasUpdate ? "info" : "success");
}

async function updatePackage(packageId) {
  await requestJson(`/api/packages/${encodeURIComponent(packageId)}/update`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  showToast(`Updated "${packageId}"`, "success");
  await Promise.all([refreshSkills(), refreshPackagesAndLibraries()]);
}

async function deletePackage(packageId) {
  const confirmed = await confirmAction({
    title: "Remove repo",
    message: `Remove repo "${packageId}"?`,
    confirmLabel: "Remove repo",
  });
  if (!confirmed) return;
  await requestJson(`/api/packages/${encodeURIComponent(packageId)}`, { method: "DELETE" });
  showToast(`Removed repo "${packageId}"`, "info");
  await Promise.all([refreshSkills(), refreshPackagesAndLibraries()]);
}

async function toggleLibrary(moduleId, enabled) {
  await requestJson(`/api/libraries/${encodeURIComponent(moduleId)}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
  showToast(`${enabled ? "Enabled" : "Disabled"} ${moduleId}`, "info");
  await refreshPackagesAndLibraries();
}

function normalizeEditorText() {
  const normalized = els.editorInput.value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[ \t]+$/gm, "");
  els.editorInput.value = normalized.trimEnd() + "\n";
  updateEditorPresentation();
  showToast("Normalized whitespace", "info");
}

let apiRefOpen = false;

function toggleApiRef() {
  apiRefOpen = !apiRefOpen;
  els.apiRefPanel.hidden = !apiRefOpen;
  els.editorAndRef.classList.toggle("ref-open", apiRefOpen);
  els.toggleApiRefButton.textContent = apiRefOpen ? "Hide Ref" : "API Ref";
}

function insertSnippet(snippet) {
  els.editorInput.focus();
  const { selectionStart, selectionEnd, value } = els.editorInput;
  els.editorInput.value = value.slice(0, selectionStart) + snippet + value.slice(selectionEnd);
  els.editorInput.selectionStart = els.editorInput.selectionEnd = selectionStart + snippet.length;
  updateEditorPresentation();
}

function renderApiRefList(filter = "") {
  els.apiRefList.innerHTML = "";
  const lowercaseFilter = filter.toLowerCase();
  for (const category of API_CATEGORIES) {
    const items = API_CATALOG.filter(
      (item) => item.category === category
        && (!lowercaseFilter
          || item.name.toLowerCase().includes(lowercaseFilter)
          || item.signature.toLowerCase().includes(lowercaseFilter)
          || item.description.toLowerCase().includes(lowercaseFilter))
    );
    if (items.length === 0) continue;
    const section = document.createElement("div");
    section.className = "api-ref-category is-open";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "api-ref-category-btn";
    btn.textContent = category;
    btn.addEventListener("click", () => section.classList.toggle("is-open"));
    const list = document.createElement("div");
    list.className = "api-ref-items";
    for (const item of items) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "api-ref-item";
      itemBtn.title = `${item.description}\n\nClick to insert: ${item.snippet}`;
      itemBtn.innerHTML = `<span>${escapeHtml(item.signature)}</span><span class="api-ref-item-desc">${escapeHtml(item.description)}</span>`;
      itemBtn.addEventListener("click", () => insertSnippet(item.snippet));
      list.append(itemBtn);
    }
    section.append(btn, list);
    els.apiRefList.append(section);
  }
}

let acPopup = null;
let acItems = [];
let acSelectedIndex = -1;
let acVisible = false;

function createAutocompletePopup() {
  acPopup = document.createElement("div");
  acPopup.className = "autocomplete-popup";
  const editorCard = els.editorInput.closest(".editor-and-ref") || els.editorView;
  editorCard.style.position = "relative";
  editorCard.append(acPopup);
}

function getWordAtCursor() {
  const { value, selectionStart } = els.editorInput;
  if (selectionStart === 0) return { word: "", start: 0 };
  let index = selectionStart - 1;
  while (index >= 0 && /[a-zA-Z0-9_.]/.test(value[index])) index -= 1;
  return { word: value.slice(index + 1, selectionStart), start: index + 1 };
}

function getCaretCoordinates() {
  const textarea = els.editorInput;
  const { value, selectionStart } = textarea;
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(textarea);
  const props = [
    "fontFamily", "fontSize", "fontWeight", "letterSpacing", "wordSpacing",
    "lineHeight", "tabSize", "paddingTop", "paddingLeft", "paddingRight",
    "borderTopWidth", "borderLeftWidth", "whiteSpace", "overflowWrap",
    "wordWrap", "wordBreak",
  ];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre";
  mirror.style.overflow = "hidden";
  for (const prop of props) mirror.style[prop] = computed[prop];
  mirror.style.width = `${textarea.clientWidth}px`;
  document.body.append(mirror);
  mirror.textContent = value.slice(0, selectionStart);
  const span = document.createElement("span");
  span.textContent = "|";
  mirror.append(span);
  const spanRect = span.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const relX = spanRect.left - mirrorRect.left;
  const relY = spanRect.top - mirrorRect.top;
  mirror.remove();
  return {
    x: relX - textarea.scrollLeft,
    y: relY - textarea.scrollTop + parseFloat(computed.lineHeight || "21"),
  };
}

function showAutocomplete(matches) {
  if (!acPopup) createAutocompletePopup();
  acItems = matches;
  acSelectedIndex = 0;
  acVisible = true;
  acPopup.innerHTML = "";
  const { word } = getWordAtCursor();
  const lowercaseWord = word.toLowerCase();
  for (let index = 0; index < matches.length; index++) {
    const item = matches[index];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "autocomplete-item" + (index === 0 ? " is-selected" : "");
    const name = item.name;
    const lowercaseName = name.toLowerCase();
    const matchIndex = lowercaseName.indexOf(lowercaseWord);
    const nameHtml = matchIndex >= 0 && lowercaseWord.length > 0
      ? escapeHtml(name.slice(0, matchIndex))
        + `<span class="ac-match">${escapeHtml(name.slice(matchIndex, matchIndex + lowercaseWord.length))}</span>`
        + escapeHtml(name.slice(matchIndex + lowercaseWord.length))
      : escapeHtml(name);
    btn.innerHTML = `<span class="ac-name">${nameHtml}</span><span class="ac-desc">${escapeHtml(item.description)}</span>`;
    const selectedIndex = index;
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      acceptAutocomplete(selectedIndex);
    });
    btn.addEventListener("mouseenter", () => {
      acSelectedIndex = selectedIndex;
      updateAcSelection();
    });
    acPopup.append(btn);
  }

  const coords = getCaretCoordinates();
  const editorFrame = document.getElementById("editorFrame");
  const frameRect = editorFrame.getBoundingClientRect();
  const parentRect = acPopup.parentElement.getBoundingClientRect();
  const left = frameRect.left - parentRect.left + coords.x;
  const top = frameRect.top - parentRect.top + coords.y;
  acPopup.style.left = `${Math.max(0, Math.min(left, parentRect.width - 240))}px`;
  acPopup.style.top = `${Math.min(top, parentRect.height - 60)}px`;
  acPopup.classList.add("is-visible");
}

function hideAutocomplete() {
  if (!acPopup) return;
  acVisible = false;
  acPopup.classList.remove("is-visible");
  acItems = [];
  acSelectedIndex = -1;
}

function updateAcSelection() {
  if (!acPopup) return;
  acPopup.querySelectorAll(".autocomplete-item").forEach((el, index) => {
    el.classList.toggle("is-selected", index === acSelectedIndex);
    if (index === acSelectedIndex) el.scrollIntoView({ block: "nearest" });
  });
}

function acceptAutocomplete(index) {
  if (index < 0 || index >= acItems.length) return;
  const item = acItems[index];
  const { start } = getWordAtCursor();
  const { value, selectionStart } = els.editorInput;
  const snippet = item.snippet;
  els.editorInput.value = value.slice(0, start) + snippet + value.slice(selectionStart);
  const openParen = snippet.indexOf("(");
  const closeParen = snippet.indexOf(")");
  if (openParen >= 0 && closeParen > openParen + 1) {
    els.editorInput.selectionStart = start + openParen + 1;
    els.editorInput.selectionEnd = start + closeParen;
  } else if (openParen >= 0 && closeParen === openParen + 1) {
    els.editorInput.selectionStart = els.editorInput.selectionEnd = start + openParen + 1;
  } else {
    els.editorInput.selectionStart = els.editorInput.selectionEnd = start + snippet.length;
  }
  updateEditorPresentation();
  hideAutocomplete();
}

function checkAutocomplete() {
  const { word } = getWordAtCursor();
  if (word.length < 2) {
    hideAutocomplete();
    return;
  }
  const lowercaseWord = word.toLowerCase();
  const matches = API_CATALOG.filter((item) => item.name.toLowerCase().includes(lowercaseWord)).slice(0, 8);
  if (matches.length === 0) {
    hideAutocomplete();
    return;
  }
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(lowercaseWord) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(lowercaseWord) ? 0 : 1;
    return aStarts - bStarts;
  });
  showAutocomplete(matches);
}

function installEditorBehaviors() {
  els.editorInput.addEventListener("input", updateEditorPresentation);
  els.editorInput.addEventListener("scroll", syncEditorScroll);
  els.editorInput.addEventListener("focus", () => els.editorHint.classList.add("faded"));
  els.editorInput.addEventListener("blur", () => els.editorHint.classList.remove("faded"));

  els.editorInput.addEventListener("keydown", (event) => {
    if (acVisible && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape")) return;
    if (acVisible && event.key === "Tab" && acSelectedIndex >= 0) return;
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = els.editorInput;
      els.editorInput.value = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
      els.editorInput.selectionStart = els.editorInput.selectionEnd = selectionStart + 4;
      updateEditorPresentation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      initiateRun();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveSkill();
    }
  });
}

function installAutocompleteBehaviors() {
  createAutocompletePopup();
  els.editorInput.addEventListener("input", checkAutocomplete);
  els.editorInput.addEventListener("keydown", (event) => {
    if (!acVisible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      acSelectedIndex = Math.min(acSelectedIndex + 1, acItems.length - 1);
      updateAcSelection();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      acSelectedIndex = Math.max(acSelectedIndex - 1, 0);
      updateAcSelection();
      return;
    }
    if (event.key === "Tab" && acSelectedIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      acceptAutocomplete(acSelectedIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideAutocomplete();
    }
  });
  els.editorInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (!acPopup?.matches(":hover")) hideAutocomplete();
    }, 150);
  });
  els.editorInput.addEventListener("scroll", hideAutocomplete);
  document.addEventListener("mousedown", (event) => {
    if (acVisible && acPopup && !acPopup.contains(event.target) && event.target !== els.editorInput) {
      hideAutocomplete();
    }
  });
}

function installApiRefBehaviors() {
  els.toggleApiRefButton.addEventListener("click", toggleApiRef);
  els.apiRefSearch.addEventListener("input", () => renderApiRefList(els.apiRefSearch.value.trim()));
  renderApiRefList();
}

function activateView(view) {
  setView(view, view === "files" ? () => loadDirectory(state.fileCurrentPath) : null);
}

async function init() {
  installConfirmBehaviors();
  installModalDismiss();
  installEditorBehaviors();
  installAutocompleteBehaviors();
  installConsoleBehaviors();
  installApiRefBehaviors();
  installFileManagerBehaviors();

  els.navSkills.addEventListener("click", () => activateView("skills"));
  els.navEditor.addEventListener("click", () => activateView("editor"));
  els.navLogs.addEventListener("click", () => activateView("logs"));
  els.navFiles.addEventListener("click", () => activateView("files"));

  els.backToSkills.addEventListener("click", () => activateView("skills"));
  els.runButton.addEventListener("click", initiateRun);
  els.saveSkillButton.addEventListener("click", saveSkill);
  els.deleteSkillButton.addEventListener("click", deleteSkill);
  els.formatButton.addEventListener("click", normalizeEditorText);
  els.clearLogsButton.addEventListener("click", () => {
    els.logOutput.textContent = "No logs yet.";
  });
  els.copyServerLogsButton.addEventListener("click", copyServerLogs);
  els.clearServerLogsButton.addEventListener("click", async () => {
    try {
      await requestJson("/api/logs", { method: "DELETE", headers: {} });
      writeServerLogs([]);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  els.newSkillButton.addEventListener("click", () => {
    resetDraft();
    activateView("editor");
  });
  els.importPackageButton.addEventListener("click", () => openModal(els.packageModal));
  els.managePackagesButton.addEventListener("click", () => openModal(els.packageModal));
  els.previewPackageButton.addEventListener("click", async () => {
    try {
      await showPackagePreview();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  els.installPackageButton.addEventListener("click", async () => {
    try {
      await installPackageSource();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  els.skillSearch.addEventListener("input", renderSkillGrid);

  els.skillSettingsButton.addEventListener("click", () => openModal(els.settingsModal));
  els.exitSkillModeButton.addEventListener("click", exitSkillMode);
  els.skillRuntime.addEventListener("change", () => {
    state.skillRuntime = els.skillRuntime.value;
  });
  els.skillExecutionMode.addEventListener("change", () => {
    state.skillExecutionMode = els.skillExecutionMode.value;
  });
  els.skillInputsSchema.addEventListener("input", refreshSchemaFromEditor);
  els.runModalExecute.addEventListener("click", executeRun);

  resetDraft();
  writeResult("No script executed yet.");
  writeLogs([]);
  activateView("skills");
  connectEventStream({ onJob: handleJobEvent, onDisconnect: handleConnectionLoss });

  await Promise.all([
    refreshStatus(handleConnectionLoss),
    refreshSkills(),
    refreshPackagesAndLibraries(),
    refreshServerLogs(),
  ]);
  window.setInterval(async () => {
    await refreshStatus(handleConnectionLoss);
    if (state.activeJobId) await refreshJob(state.activeJobId);
  }, 3000);
}

init().catch((error) => writeResult(error.message, true));
