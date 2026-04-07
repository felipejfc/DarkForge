export const state = {
  connected: false,
  appConnected: false,
  launchdAgentConnected: false,
  launchdWorkerReady: false,
  skills: [],
  packages: [],
  libraries: [],
  selectedSkillId: null,
  selectedSkillSourceType: null,
  busy: false,
  fileBusy: false,
  activeView: "skills",
  filesLoadedOnce: false,
  fileCurrentPath: "/",
  fileEntries: [],
  fileSelection: null,
  fileLoadedText: "",
  fileSortKey: "name",
  fileSortAsc: true,
  fileFilter: "",
  fileFocusIndex: -1,
  fileClipboard: null,
  fileMultiSelect: [],
  serverLogs: [],
  activeConsoleTab: "result",
  consoleOpen: false,
  dirty: false,
  lastSavedCode: "",
  skillRuntime: "jscbridge",
  skillExecutionMode: "interactive",
  skillInputs: [],
  skillInputValues: {},
  skillEntryFile: "",
  skillLibraryDependencies: [],
  activeJobId: null,
  activeJobToast: null,
  jobs: {},
  eventSource: null,
  devices: [],
};

export const els = {
  navSkills: document.querySelector("#navSkills"),
  navEditor: document.querySelector("#navEditor"),
  navLogs: document.querySelector("#navLogs"),
  navFiles: document.querySelector("#navFiles"),
  skillsView: document.querySelector("#skillsView"),
  editorView: document.querySelector("#editorView"),
  logsView: document.querySelector("#logsView"),
  filesView: document.querySelector("#filesView"),
  serverLogCount: document.querySelector("#serverLogCount"),
  serverLogMeta: document.querySelector("#serverLogMeta"),
  copyServerLogsButton: document.querySelector("#copyServerLogsButton"),
  clearServerLogsButton: document.querySelector("#clearServerLogsButton"),
  serverLogOutput: document.querySelector("#serverLogOutput"),
  skillGrid: document.querySelector("#skillGrid"),
  skillSearch: document.querySelector("#skillSearch"),
  importPackageButton: document.querySelector("#importPackageButton"),
  managePackagesButton: document.querySelector("#managePackagesButton"),
  newSkillButton: document.querySelector("#newSkillButton"),
  statusSkillCount: document.querySelector("#statusSkillCount"),
  backToSkills: document.querySelector("#backToSkills"),
  skillName: document.querySelector("#skillName"),
  dirtyIndicator: document.querySelector("#dirtyIndicator"),
  formatButton: document.querySelector("#formatButton"),
  toggleApiRefButton: document.querySelector("#toggleApiRefButton"),
  skillSettingsButton: document.querySelector("#skillSettingsButton"),
  exitSkillModeButton: document.querySelector("#exitSkillModeButton"),
  deleteSkillButton: document.querySelector("#deleteSkillButton"),
  saveSkillButton: document.querySelector("#saveSkillButton"),
  runButton: document.querySelector("#runButton"),
  editorHint: document.querySelector(".editor-hint"),
  editorInput: document.querySelector("#editorInput"),
  highlightLayer: document.querySelector("#highlightLayer"),
  lineNumbers: document.querySelector("#lineNumbers"),
  splitWorkspace: document.querySelector("#splitWorkspace"),
  editorAndRef: document.querySelector(".editor-and-ref"),
  consolePanel: document.querySelector("#consolePanel"),
  consoleSplitter: document.querySelector("#consoleSplitter"),
  resultTab: document.querySelector("#resultTab"),
  logsTab: document.querySelector("#logsTab"),
  resultOutput: document.querySelector("#resultOutput"),
  logOutput: document.querySelector("#logOutput"),
  runMeta: document.querySelector("#runMeta"),
  consoleCopyBtn: document.querySelector("#consoleCopyBtn"),
  clearLogsButton: document.querySelector("#clearLogsButton"),
  toggleConsoleButton: document.querySelector("#toggleConsoleButton"),
  apiRefPanel: document.querySelector("#apiRefPanel"),
  apiRefSearch: document.querySelector("#apiRefSearch"),
  apiRefList: document.querySelector("#apiRefList"),
  statusDot: document.querySelector("#statusDot"),
  statusLabel: document.querySelector("#statusLabel"),
  targetSelect: document.querySelector("#targetSelect"),
  deviceSelect: document.querySelector("#deviceSelect"),
  fileRootButton: document.querySelector("#fileRootButton"),
  fileUpButton: document.querySelector("#fileUpButton"),
  fileRefreshButton: document.querySelector("#fileRefreshButton"),
  fileNewFolderButton: document.querySelector("#fileNewFolderButton"),
  fileNewFileButton: document.querySelector("#fileNewFileButton"),
  fileUploadButton: document.querySelector("#fileUploadButton"),
  fileUploadInput: document.querySelector("#fileUploadInput"),
  uploadProgress: document.querySelector("#uploadProgress"),
  uploadProgressLabel: document.querySelector("#uploadProgressLabel"),
  uploadProgressFill: document.querySelector("#uploadProgressFill"),
  fileBrowser: document.querySelector(".file-browser"),
  fileBrowserPanel: document.querySelector("#fileBrowserPanel"),
  fileStatus: document.querySelector("#fileStatus"),
  fileBreadcrumbs: document.querySelector("#fileBreadcrumbs"),
  fileEditPathButton: document.querySelector("#fileEditPathButton"),
  filePathInput: document.querySelector("#filePathInput"),
  fileSearchInput: document.querySelector("#fileSearchInput"),
  fileSortHeader: document.querySelector(".file-sort-header"),
  fileSplitter: document.querySelector("#fileSplitter"),
  filePreviewPanel: document.querySelector("#filePreviewPanel"),
  fileList: document.querySelector("#fileList"),
  fileListMeta: document.querySelector("#fileListMeta"),
  filePreviewTitle: document.querySelector("#filePreviewTitle"),
  filePreviewMeta: document.querySelector("#filePreviewMeta"),
  filePreviewEmpty: document.querySelector("#filePreviewEmpty"),
  fileEditor: document.querySelector("#fileEditor"),
  fileCopyPathButton: document.querySelector("#fileCopyPathButton"),
  fileDownloadButton: document.querySelector("#fileDownloadButton"),
  fileRenameButton: document.querySelector("#fileRenameButton"),
  fileDeleteButton: document.querySelector("#fileDeleteButton"),
  fileReloadButton: document.querySelector("#fileReloadButton"),
  fileSaveButton: document.querySelector("#fileSaveButton"),
  fileItemTemplate: document.querySelector("#fileItemTemplate"),
  fileContextMenu: document.querySelector("#fileContextMenu"),
  filePasteButton: document.querySelector("#filePasteButton"),
  fileNewLinkButton: document.querySelector("#fileNewLinkButton"),
  fileBulkBar: document.querySelector("#fileBulkBar"),
  fileBulkCount: document.querySelector("#fileBulkCount"),
  fileBulkCopy: document.querySelector("#fileBulkCopy"),
  fileBulkCut: document.querySelector("#fileBulkCut"),
  fileBulkDelete: document.querySelector("#fileBulkDelete"),
  fileBulkDeselect: document.querySelector("#fileBulkDeselect"),
  runModal: document.querySelector("#runModal"),
  runModalTitle: document.querySelector("#runModalTitle"),
  runModalBody: document.querySelector("#runModalBody"),
  runModalExecute: document.querySelector("#runModalExecute"),
  settingsModal: document.querySelector("#settingsModal"),
  skillSummary: document.querySelector("#skillSummary"),
  skillRuntime: document.querySelector("#skillRuntime"),
  skillExecutionMode: document.querySelector("#skillExecutionMode"),
  skillInputsSchema: document.querySelector("#skillInputsSchema"),
  skillLibraryDependencies: document.querySelector("#skillLibraryDependencies"),
  skillSchemaStatus: document.querySelector("#skillSchemaStatus"),
  packageModal: document.querySelector("#packageModal"),
  packageSourceInput: document.querySelector("#packageSourceInput"),
  previewPackageButton: document.querySelector("#previewPackageButton"),
  installPackageButton: document.querySelector("#installPackageButton"),
  packageList: document.querySelector("#packageList"),
  libraryList: document.querySelector("#libraryList"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmModalTitle: document.querySelector("#confirmModalTitle"),
  confirmModalMessage: document.querySelector("#confirmModalMessage"),
  confirmModalClose: document.querySelector("#confirmModalClose"),
  confirmModalCancel: document.querySelector("#confirmModalCancel"),
  confirmModalAccept: document.querySelector("#confirmModalAccept"),
  toastContainer: document.querySelector("#toastContainer"),
};

const confirmDialogState = {
  resolve: null,
  previousFocus: null,
};

export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function showToast(message, variant = "info", duration = 3000, options = {}) {
  const { dismissible = duration > 0 } = options;
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = String(message);
  toast.append(icon, text);
  els.toastContainer.append(toast);

  let removed = false;
  let timerId = null;

  const dismiss = () => {
    if (removed || toast.classList.contains("toast-out")) return;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => {
      removed = true;
      toast.remove();
    }, { once: true });
  };
  const update = (nextMessage, nextVariant = variant, nextDuration = duration, nextOptions = {}) => {
    const nextDismissible = nextOptions.dismissible ?? (nextDuration > 0);
    toast.className = `toast ${nextVariant}`;
    text.textContent = String(nextMessage);
    toast.onclick = nextDismissible ? dismiss : null;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (nextDuration > 0) {
      timerId = setTimeout(dismiss, nextDuration);
    }
  };

  toast.onclick = dismissible ? dismiss : null;
  if (duration > 0) {
    timerId = setTimeout(dismiss, duration);
  }

  return { dismiss, update, element: toast };
}

export function copyTextToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    button.textContent = "Copied";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("copied");
    }, 1500);
  }).catch(() => showToast("Copy failed", "error"));
}

export function setView(view, onFilesView = null) {
  state.activeView = view;
  const views = { skills: els.skillsView, editor: els.editorView, logs: els.logsView, files: els.filesView };
  const tabs = { skills: els.navSkills, editor: els.navEditor, logs: els.navLogs, files: els.navFiles };
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== view;
  }
  for (const [key, el] of Object.entries(tabs)) {
    el.classList.toggle("is-active", key === view);
    el.setAttribute("aria-selected", String(key === view));
  }
  if (view === "files" && !state.filesLoadedOnce && state.connected && onFilesView) {
    state.filesLoadedOnce = true;
    onFilesView(state.fileCurrentPath);
  }
}

export function openModal(modalEl) {
  modalEl.hidden = false;
}

export function closeModal(modalEl) {
  modalEl.hidden = true;
}

export function installModalDismiss() {
  document.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(`#${btn.dataset.dismiss}`);
      if (target) closeModal(target);
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(overlay);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-overlay:not([hidden])").forEach(closeModal);
    }
  });
}

function settleConfirmDialog(confirmed) {
  const resolve = confirmDialogState.resolve;
  const previousFocus = confirmDialogState.previousFocus;
  confirmDialogState.resolve = null;
  confirmDialogState.previousFocus = null;
  closeModal(els.confirmModal);
  els.confirmModalAccept.classList.remove("btn-danger", "btn-primary");
  if (resolve) resolve(confirmed);
  if (previousFocus?.focus) {
    window.requestAnimationFrame(() => previousFocus.focus());
  }
}

export function installConfirmBehaviors() {
  if (!els.confirmModal) return;
  const cancel = () => settleConfirmDialog(false);
  const accept = () => settleConfirmDialog(true);
  els.confirmModalClose.addEventListener("click", cancel);
  els.confirmModalCancel.addEventListener("click", cancel);
  els.confirmModalAccept.addEventListener("click", accept);
  els.confirmModal.addEventListener("click", (event) => {
    if (event.target === els.confirmModal) cancel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || els.confirmModal.hidden) return;
    event.preventDefault();
    cancel();
  });
}

export function confirmAction({
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
} = {}) {
  if (!message) throw new Error("Confirmation message is required.");
  if (confirmDialogState.resolve) settleConfirmDialog(false);

  els.confirmModalTitle.textContent = title;
  els.confirmModalMessage.textContent = message;
  els.confirmModalCancel.textContent = cancelLabel;
  els.confirmModalAccept.textContent = confirmLabel;
  els.confirmModalAccept.classList.remove("btn-danger", "btn-primary");
  els.confirmModalAccept.classList.add(variant === "primary" ? "btn-primary" : "btn-danger");
  confirmDialogState.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  openModal(els.confirmModal);
  window.requestAnimationFrame(() => els.confirmModalCancel.focus());
  return new Promise((resolve) => {
    confirmDialogState.resolve = resolve;
  });
}

export function setStatus(status, { onDisconnect, onConnectionChange } = {}) {
  const wasConnected = state.connected;
  state.connected = Boolean(status.connected);
  state.appConnected = Boolean(status.appConnected);
  state.launchdAgentConnected = Boolean(status.launchdAgentConnected);
  state.launchdWorkerReady = Boolean(status.launchdWorkerReady);
  state.devices = status.devices || [];
  els.statusDot.classList.toggle("online", state.connected);
  els.statusDot.classList.toggle("offline", !state.connected);

  // Update device selector dropdown
  const connectedDevices = state.devices.filter(d => d.connected);
  const reconnectingDevices = state.devices.filter(d => d.reconnecting);
  if (els.deviceSelect) {
    const currentValue = els.deviceSelect.value;
    const availableDevices = state.devices.filter(d => d.connected || d.reconnecting);
    els.deviceSelect.innerHTML = "";
    if (availableDevices.length === 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "No devices";
      els.deviceSelect.append(placeholder);
    }
    for (const device of availableDevices) {
      const opt = document.createElement("option");
      opt.value = device.deviceId;
      const suffix = device.reconnecting ? " (reconnecting)" : "";
      opt.textContent = device.deviceName + suffix;
      els.deviceSelect.append(opt);
    }
    // Restore previous selection if still available, otherwise auto-select first
    if (availableDevices.some(d => d.deviceId === currentValue)) {
      els.deviceSelect.value = currentValue;
    } else if (availableDevices.length > 0) {
      els.deviceSelect.value = availableDevices[0].deviceId;
    }
  }

  // Update status label
  if (connectedDevices.length > 1) {
    els.statusLabel.textContent = status.activeJobs
      ? `${connectedDevices.length} devices · ${status.activeJobs} jobs`
      : `${connectedDevices.length} devices live`;
  } else if (connectedDevices.length === 1) {
    const name = connectedDevices[0].deviceName;
    els.statusLabel.textContent = status.activeJobs
      ? `${name} · ${status.activeJobs} jobs`
      : `${name} live`;
  } else if (reconnectingDevices.length > 0) {
    els.statusLabel.textContent = "Device reconnecting\u2026";
  } else if (state.appConnected) {
    els.statusLabel.textContent = "App bridge only";
  } else {
    els.statusLabel.textContent = "Waiting for device";
  }

  const details = [
    status.transport ? `transport ${status.transport}` : null,
    status.pid ? `pid ${status.pid}` : null,
    status.agentPid ? `agent ${status.agentPid}` : null,
    status.kernelBase ? `base ${status.kernelBase}` : null,
    status.kernelSlide ? `slide ${status.kernelSlide}` : null,
  ].filter(Boolean).join(" | ");
  els.statusLabel.title = details;
  for (const opt of els.targetSelect.options) {
    if (opt.value === "agent") opt.disabled = !state.launchdAgentConnected;
    if (opt.value === "bridge") opt.disabled = !state.appConnected;
  }
  if (!state.connected && onDisconnect) onDisconnect();
  if (wasConnected !== state.connected && onConnectionChange) onConnectionChange();
}

export function setBusy(nextBusy) {
  state.busy = nextBusy;
  els.runButton.disabled = nextBusy;
  els.runButton.classList.toggle("is-running", nextBusy);
  els.saveSkillButton.disabled = nextBusy;
  if (els.exitSkillModeButton) els.exitSkillModeButton.disabled = nextBusy || !state.selectedSkillId;
  els.deleteSkillButton.disabled = nextBusy || !state.selectedSkillId || state.selectedSkillSourceType !== "local";
  els.runModalExecute.disabled = nextBusy;
  els.runModalExecute.classList.toggle("is-running", nextBusy);
  if (els.previewPackageButton) els.previewPackageButton.disabled = nextBusy;
  if (els.installPackageButton) els.installPackageButton.disabled = nextBusy;
}

export function setRunMeta(label, variant = "") {
  els.runMeta.textContent = label;
  els.runMeta.className = "run-meta" + (variant ? ` is-${variant}` : "");
}

export function setConsoleTab(tab) {
  state.activeConsoleTab = tab;
  const resultActive = tab === "result";
  els.resultTab.classList.toggle("is-active", resultActive);
  els.logsTab.classList.toggle("is-active", !resultActive);
  els.resultTab.setAttribute("aria-selected", String(resultActive));
  els.logsTab.setAttribute("aria-selected", String(!resultActive));
  els.resultOutput.classList.toggle("is-active", resultActive);
  els.logOutput.classList.toggle("is-active", !resultActive);
}

export function setConsoleOpen(open) {
  state.consoleOpen = open;
  els.splitWorkspace.classList.toggle("console-collapsed", !open);
  els.toggleConsoleButton.textContent = open ? "Hide" : "Show";
}

export function ensureConsoleOpen(tab = state.activeConsoleTab) {
  setConsoleOpen(true);
  setConsoleTab(tab);
}

export function writeResult(result, isError = false) {
  els.resultOutput.textContent = result;
  els.resultOutput.classList.toggle("error", isError);
}

export function writeLogs(logs) {
  if (!logs || logs.length === 0) {
    els.logOutput.textContent = "No logs emitted.";
    return;
  }
  els.logOutput.textContent = logs.join("\n");
}

export function appendLog(msg) {
  if (!msg) return;
  const current = els.logOutput.textContent;
  if (current === "No logs yet." || current === "No logs emitted.") {
    els.logOutput.textContent = msg;
  } else {
    els.logOutput.textContent += `\n${msg}`;
  }
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

export function copyConsoleOutput() {
  const activeOutput = state.activeConsoleTab === "result" ? els.resultOutput : els.logOutput;
  copyTextToClipboard(activeOutput.textContent, els.consoleCopyBtn);
}

export function updateServerLogSummary() {
  const count = state.serverLogs.length;
  els.serverLogCount.textContent = String(count);
  els.serverLogMeta.textContent = count ? `${count} line${count === 1 ? "" : "s"} buffered` : "Waiting for host activity";
}

export function writeServerLogs(logs) {
  state.serverLogs = Array.isArray(logs) ? logs.map((msg) => String(msg)) : [];
  els.serverLogOutput.textContent = state.serverLogs.length ? state.serverLogs.join("\n") : "No server logs yet.";
  updateServerLogSummary();
  els.serverLogOutput.scrollTop = els.serverLogOutput.scrollHeight;
}

export function appendServerLog(msg) {
  if (msg == null) return;
  const text = String(msg);
  const pinnedToBottom = (els.serverLogOutput.scrollHeight - els.serverLogOutput.scrollTop - els.serverLogOutput.clientHeight) < 24;
  state.serverLogs.push(text);
  updateServerLogSummary();
  if (state.serverLogs.length === 1) {
    els.serverLogOutput.textContent = text;
  } else {
    els.serverLogOutput.textContent += `\n${text}`;
  }
  if (pinnedToBottom || state.serverLogs.length === 1) {
    els.serverLogOutput.scrollTop = els.serverLogOutput.scrollHeight;
  }
}

export function copyServerLogs() {
  copyTextToClipboard(els.serverLogOutput.textContent, els.copyServerLogsButton);
}

export function installConsoleBehaviors() {
  setConsoleTab("result");
  setConsoleOpen(false);
  els.resultTab.addEventListener("click", () => ensureConsoleOpen("result"));
  els.logsTab.addEventListener("click", () => ensureConsoleOpen("logs"));
  els.toggleConsoleButton.addEventListener("click", () => {
    state.consoleOpen ? setConsoleOpen(false) : ensureConsoleOpen(state.activeConsoleTab);
  });
  els.consoleCopyBtn.addEventListener("click", copyConsoleOutput);

  let resizing = false;
  const stopResize = () => {
    resizing = false;
    document.body.style.userSelect = "";
  };
  els.consoleSplitter.addEventListener("pointerdown", (event) => {
    resizing = true;
    document.body.style.userSelect = "none";
    els.consoleSplitter.setPointerCapture(event.pointerId);
    setConsoleOpen(true);
  });
  els.consoleSplitter.addEventListener("click", () => {
    if (!state.consoleOpen) ensureConsoleOpen(state.activeConsoleTab);
  });
  els.consoleSplitter.addEventListener("pointermove", (event) => {
    if (!resizing) return;
    const rect = els.splitWorkspace.getBoundingClientRect();
    const bounded = Math.max(120, Math.min(rect.bottom - event.clientY, rect.height - 220));
    els.splitWorkspace.style.setProperty("--console-height", `${bounded}px`);
    setConsoleOpen(true);
  });
  els.consoleSplitter.addEventListener("pointerup", (event) => {
    if (els.consoleSplitter.hasPointerCapture(event.pointerId)) {
      els.consoleSplitter.releasePointerCapture(event.pointerId);
    }
    stopResize();
  });
  els.consoleSplitter.addEventListener("pointercancel", stopResize);
  els.consoleSplitter.addEventListener("lostpointercapture", stopResize);
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

export async function refreshStatus(callbacks = {}) {
  const opts = typeof callbacks === "function" ? { onDisconnect: callbacks } : callbacks;
  try {
    const status = await requestJson("/api/status", { headers: {} });
    setStatus(status, opts);
    return status;
  } catch {
    const offline = {
      connected: false,
      appConnected: false,
      launchdAgentConnected: false,
      launchdWorkerReady: false,
      activeJobs: 0,
    };
    setStatus(offline, opts);
    setRunMeta("Status unavailable");
    return offline;
  }
}

export async function refreshServerLogs() {
  try {
    const data = await requestJson("/api/logs", { headers: {} });
    writeServerLogs(data.logs || []);
  } catch {
    els.serverLogMeta.textContent = "Log history unavailable";
  }
}

export function connectEventStream({ onJob, onDisconnect, onConnectionChange } = {}) {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource("/api/events");
  source.addEventListener("status", (event) => {
    try {
      setStatus(JSON.parse(event.data), { onDisconnect, onConnectionChange });
    } catch {}
  });
  source.addEventListener("job", (event) => {
    try {
      onJob?.(JSON.parse(event.data));
    } catch {}
  });
  source.addEventListener("log", (event) => {
    try {
      appendLog(JSON.parse(event.data).msg);
    } catch {}
  });
  source.addEventListener("server-log", (event) => {
    try {
      appendServerLog(JSON.parse(event.data).msg);
    } catch {}
  });
  source.addEventListener("server-log-reset", () => writeServerLogs([]));
  source.onerror = () => setRunMeta("Live updates reconnecting");
  state.eventSource = source;
}
