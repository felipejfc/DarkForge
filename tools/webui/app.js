/* ---- API Catalog (shared by reference panel + autocomplete) ---- */
const API_CATALOG = [
  { name: "log", signature: "log(msg)", category: "Globals", description: "Log a message to the console", snippet: 'log("hello");' },
  { name: "Native.callSymbol", signature: "Native.callSymbol(name, x0..x7)", category: "Native", description: "Call C function by dlsym name", snippet: 'const pid = Native.callSymbol("getpid");' },
  { name: "Native.callSymbolRetain", signature: "Native.callSymbolRetain(name, x0..x7)", category: "Native", description: "Call with ObjC object retention", snippet: 'const obj = Native.callSymbolRetain("objc_msgSend", cls, sel);' },
  { name: "Native.read", signature: "Native.read(ptr, length)", category: "Native", description: "Read bytes from address", snippet: 'const buf = Native.read(ptr, 64);' },
  { name: "Native.readPtr", signature: "Native.readPtr(ptr)", category: "Native", description: "Read 64-bit pointer value", snippet: 'const val = Native.readPtr(ptr);' },
  { name: "Native.readString", signature: "Native.readString(ptr, len?)", category: "Native", description: "Read null-terminated C string", snippet: 'const str = Native.readString(ptr);' },
  { name: "Native.write", signature: "Native.write(ptr, buff)", category: "Native", description: "Write ArrayBuffer to address", snippet: 'Native.write(ptr, data);' },
  { name: "Native.writeString", signature: "Native.writeString(ptr, str)", category: "Native", description: "Write C string to address", snippet: 'Native.writeString(ptr, "hello");' },
  { name: "Native.mem", signature: "Native.mem", category: "Native", description: "Shared work buffer address (BigInt)", snippet: "log(String(Native.mem));" },
  { name: "Native.memSize", signature: "Native.memSize", category: "Native", description: "Work buffer size (0x4000)", snippet: "log(Native.memSize);" },
  { name: "Native.bytesToString", signature: "Native.bytesToString(bytes, inclNull?)", category: "Native", description: "Uint8Array to string", snippet: "const s = Native.bytesToString(bytes);" },
  { name: "Native.stringToBytes", signature: "Native.stringToBytes(str, nullTerm?)", category: "Native", description: "String to ArrayBuffer", snippet: 'const b = Native.stringToBytes("hello");' },
  { name: "FileUtils.readFile", signature: "FileUtils.readFile(path, seek?, len?)", category: "FileUtils", description: "Read file as ArrayBuffer", snippet: 'const data = FileUtils.readFile("/tmp/test");' },
  { name: "FileUtils.writeFile", signature: "FileUtils.writeFile(path, data)", category: "FileUtils", description: "Write ArrayBuffer to file", snippet: 'FileUtils.writeFile("/tmp/test", data);' },
  { name: "FileUtils.appendFile", signature: "FileUtils.appendFile(path, data)", category: "FileUtils", description: "Append ArrayBuffer to file", snippet: 'FileUtils.appendFile("/tmp/log", data);' },
  { name: "FileUtils.readTextFile", signature: "FileUtils.readTextFile(path, seek?, len?)", category: "FileUtils", description: "Read file as UTF-8 string", snippet: 'const text = FileUtils.readTextFile("/etc/hosts");' },
  { name: "FileUtils.writeTextFile", signature: "FileUtils.writeTextFile(path, text)", category: "FileUtils", description: "Write text to file", snippet: 'FileUtils.writeTextFile("/tmp/out.txt", "hello");' },
  { name: "FileUtils.appendTextFile", signature: "FileUtils.appendTextFile(path, text)", category: "FileUtils", description: "Append text to file", snippet: 'FileUtils.appendTextFile("/tmp/log.txt", "line\\n");' },
  { name: "FileUtils.listDir", signature: "FileUtils.listDir(path)", category: "FileUtils", description: "List directory entries with metadata", snippet: 'const items = FileUtils.listDir("/tmp");\nlog(JSON.stringify(items[0]));' },
  { name: "FileUtils.exists", signature: "FileUtils.exists(path)", category: "FileUtils", description: "Check if path exists", snippet: 'log(FileUtils.exists("/etc/hosts"));' },
  { name: "FileUtils.stat", signature: "FileUtils.stat(path)", category: "FileUtils", description: "Get file metadata (follows symlinks)", snippet: 'const info = FileUtils.stat("/etc/hosts");\nlog(JSON.stringify(info));' },
  { name: "FileUtils.lstat", signature: "FileUtils.lstat(path)", category: "FileUtils", description: "Get metadata (no symlink follow)", snippet: 'const info = FileUtils.lstat("/etc/hosts");' },
  { name: "FileUtils.createDir", signature: "FileUtils.createDir(path, perm?)", category: "FileUtils", description: "Create directory (default 0755)", snippet: 'FileUtils.createDir("/tmp/mydir");' },
  { name: "FileUtils.deleteFile", signature: "FileUtils.deleteFile(path)", category: "FileUtils", description: "Delete a file", snippet: 'FileUtils.deleteFile("/tmp/test");' },
  { name: "FileUtils.deleteDir", signature: "FileUtils.deleteDir(path, recursive?)", category: "FileUtils", description: "Delete directory", snippet: 'FileUtils.deleteDir("/tmp/mydir", true);' },
  { name: "FileUtils.rename", signature: "FileUtils.rename(oldPath, newPath)", category: "FileUtils", description: "Rename/move file or directory", snippet: 'FileUtils.rename("/tmp/a", "/tmp/b");' },
  { name: "FileUtils.open", signature: "FileUtils.open(path)", category: "FileUtils", description: "Open file, return fd", snippet: 'const fd = FileUtils.open("/tmp/test");' },
  { name: "FileUtils.close", signature: "FileUtils.close(fd)", category: "FileUtils", description: "Close file descriptor", snippet: 'FileUtils.close(fd);' },
  { name: "FileUtils.read", signature: "FileUtils.read(fd, size?)", category: "FileUtils", description: "Read from open fd", snippet: 'const buf = FileUtils.read(fd, 1024);' },
  { name: "RootFS.list", signature: "RootFS.list(path)", category: "RootFS", description: "List directory with metadata", snippet: 'const dir = RootFS.list("/");\nlog(JSON.stringify(dir.entries.slice(0, 3)));' },
  { name: "RootFS.readText", signature: "RootFS.readText(path, maxBytes?)", category: "RootFS", description: "Read text file", snippet: 'const result = RootFS.readText("/etc/hosts");\nlog(result.text);' },
  { name: "RootFS.writeText", signature: "RootFS.writeText(path, text)", category: "RootFS", description: "Write/create text file", snippet: 'RootFS.writeText("/tmp/out.txt", "data");' },
  { name: "RootFS.appendText", signature: "RootFS.appendText(path, text)", category: "RootFS", description: "Append text to file", snippet: 'RootFS.appendText("/tmp/log.txt", "line\\n");' },
  { name: "RootFS.mkdir", signature: "RootFS.mkdir(path)", category: "RootFS", description: "Create directory", snippet: 'RootFS.mkdir("/tmp/newdir");' },
  { name: "RootFS.rename", signature: "RootFS.rename(path, destination)", category: "RootFS", description: "Rename file/directory", snippet: 'RootFS.rename("/tmp/a", "/tmp/b");' },
  { name: "RootFS.remove", signature: "RootFS.remove(path, recursive?)", category: "RootFS", description: "Delete file or directory", snippet: 'RootFS.remove("/tmp/test");' },
  { name: "RootFS.stat", signature: "RootFS.stat(path)", category: "RootFS", description: "Get file info with normalized path", snippet: 'const info = RootFS.stat("/etc/hosts");\nlog(JSON.stringify(info));' },
  { name: "RootFS.normalizePath", signature: "RootFS.normalizePath(path)", category: "RootFS", description: "Normalize path (handle .. and .)", snippet: 'const p = RootFS.normalizePath("/tmp/../etc/hosts");' },
  { name: "RootFS.joinPath", signature: "RootFS.joinPath(base, name)", category: "RootFS", description: "Join path components", snippet: 'const p = RootFS.joinPath("/tmp", "test.txt");' },
  { name: "RootFS.parentPath", signature: "RootFS.parentPath(path)", category: "RootFS", description: "Get parent directory", snippet: 'const parent = RootFS.parentPath("/tmp/test");' },
  { name: "Apps.listInstalled", signature: "Apps.listInstalled()", category: "Apps", description: "List installed apps visible to LaunchServices or the filesystem fallback", snippet: "const apps = Apps.listInstalled();\nlog(JSON.stringify(apps.slice(0, 5), null, 2));" },
  { name: "Apps.resolveTarget", signature: "Apps.resolveTarget(query)", category: "Apps", description: "Resolve an installed app by bundle identifier or display name", snippet: 'const app = Apps.resolveTarget(skillInput.target);\nlog(JSON.stringify(app));' },
  { name: "Apps.diagnosticsSummary", signature: "Apps.diagnosticsSummary(limit?)", category: "Apps", description: "Summarize the most recent app-scan diagnostics", snippet: "log(Apps.diagnosticsSummary(10));" },
  { name: "Apps.launch", signature: "Apps.launch(bundleId)", category: "Apps", description: "Ask LaunchServices to launch an installed app", snippet: 'Apps.launch("com.apple.mobilesafari");' },
  { name: "Apps.enumerateMachOFiles", signature: "Apps.enumerateMachOFiles(appInfo, options?)", category: "Apps", description: "Enumerate Mach-O files inside an app bundle, including frameworks and extensions", snippet: 'const files = Apps.enumerateMachOFiles(app, { includeExtensions: true, includeFrameworks: true });' },
  { name: "Tasks.findPid", signature: "Tasks.findPid(appInfo)", category: "Tasks", description: "Find a running PID for an app record returned by Apps.resolveTarget()", snippet: "const pid = Tasks.findPid(app);" },
  { name: "Tasks.waitForProcess", signature: "Tasks.waitForProcess(appInfo, timeoutMs?)", category: "Tasks", description: "Poll until a launched app has a live PID and return { pid, appInfo }", snippet: "const wait = Tasks.waitForProcess(app, 30000);\nlog(JSON.stringify(wait));" },
  { name: "Tasks.waitForPid", signature: "Tasks.waitForPid(appInfo, timeoutMs?)", category: "Tasks", description: "Poll until a launched app has a live PID", snippet: "const pid = Tasks.waitForPid(app, 15000);" },
  { name: "Tasks.openForPid", signature: "Tasks.openForPid(pid)", category: "Tasks", description: "Open a validated task port for a running PID, preferring the host-assisted kernel port forge path", snippet: "const task = Tasks.openForPid(pid);\nlog(task.source); // kernel_port_forge, task_for_pid, ..." },
  { name: "TaskMemory.listImages", signature: "TaskMemory.listImages(task)", category: "TaskMemory", description: "Enumerate dyld images loaded in a task; loadAddress fields are BigInt values", snippet: "const images = TaskMemory.listImages(task);\nlog(String(images[0].loadAddress));" },
  { name: "TaskMemory.read", signature: "TaskMemory.read(task, address, size)", category: "TaskMemory", description: "Read bytes from a task with mach_vm_read_overwrite", snippet: "const bytes = TaskMemory.read(task, image.loadAddress, 0x1000);" },
  { name: "TaskMemory.readCString", signature: "TaskMemory.readCString(task, address, maxLength?)", category: "TaskMemory", description: "Read a C string from task memory", snippet: "const path = TaskMemory.readCString(task, ptr);" },
  { name: "MachO.inspectFile", signature: "MachO.inspectFile(path)", category: "MachO", description: "Inspect Mach-O metadata including encryption info and file segments for on-disk app binaries", snippet: 'const info = MachO.inspectFile("/Applications/Foo.app/Foo");' },
  { name: "MachO.isEncrypted", signature: "MachO.isEncrypted(info)", category: "MachO", description: "Check whether a parsed Mach-O still has an encrypted slice", snippet: "if (MachO.isEncrypted(info)) log('encrypted');" },
  { name: "MachO.fileOffsetToMemoryOffset", signature: "MachO.fileOffsetToMemoryOffset(info, fileOffset)", category: "MachO", description: "Translate a file offset into the loaded image's VM-relative offset", snippet: "const vmOffset = MachO.fileOffsetToMemoryOffset(info, info.encryption.cryptOff);" },
  { name: "MachO.patchRange", signature: "MachO.patchRange(path, offset, data)", category: "MachO", description: "Patch a staged binary at a byte range", snippet: "MachO.patchRange(stagedPath, 0x1000, data);" },
  { name: "MachO.clearCryptId", signature: "MachO.clearCryptId(path, info)", category: "MachO", description: "Clear LC_ENCRYPTION_INFO cryptid in a staged Mach-O", snippet: "MachO.clearCryptId(stagedPath, info);" },
  { name: "Staging.createDumpContext", signature: "Staging.createDumpContext(appInfo, outputSubdir?)", category: "Staging", description: "Create a staged dump under /var/mobile/Downloads/<bundle-id>/<timestamp[-suffix]>", snippet: 'const ctx = Staging.createDumpContext(app, skillInput.outputSubdir || "");' },
  { name: "Staging.stagedPath", signature: "Staging.stagedPath(context, originalPath)", category: "Staging", description: "Map an original bundle path to its staged copy path", snippet: "const staged = Staging.stagedPath(ctx, candidate.originalPath);" },
  { name: "Staging.packageDump", signature: "Staging.packageDump(context)", category: "Staging", description: "Attempt to package a staged Payload directory into an IPA; returns null when packaging is unavailable and keeps the dump directory", snippet: "const ipaPath = Staging.packageDump(ctx);\nif (!ipaPath) log('staged dump preserved');" },
  { name: "Host.acquireTaskPort", signature: "Host.acquireTaskPort(pid)", category: "Host", description: "Low-level host-assisted task port acquisition used by Tasks.openForPid(); returns { pid, taskPort, source, access }", snippet: "const task = Host.acquireTaskPort(pid);\nlog(JSON.stringify(task));" },
];

const API_CATEGORIES = [];
const _catSet = new Set();
for (const item of API_CATALOG) {
  if (!_catSet.has(item.category)) {
    _catSet.add(item.category);
    API_CATEGORIES.push(item.category);
  }
}

const DEFAULT_SCRIPT = `// JSCBridge scratchpad
log("bridge online");

const pid = Native.callSymbol("getpid");
log("launchd pid: " + pid);

({
  pid: String(pid),
  when: new Date().toISOString()
});
`;

/* ---- State ---- */
const state = {
  connected: false,
  appConnected: false,
  launchdAgentConnected: false,
  launchdWorkerReady: false,
  skills: [],
  selectedSkillId: null,
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
  activeConsoleTab: "result",
  consoleOpen: false,
  dirty: false,
  lastSavedCode: "",
  skillRuntime: "jscbridge",
  skillExecutionMode: "interactive",
  skillInputs: [],
  skillInputValues: {},
  skillEntryFile: "",
  activeJobId: null,
  jobs: {},
  eventSource: null,
};

/* ---- Element refs ---- */
const els = {
  // Nav
  navSkills: document.querySelector("#navSkills"),
  navEditor: document.querySelector("#navEditor"),
  navFiles: document.querySelector("#navFiles"),
  // Views
  skillsView: document.querySelector("#skillsView"),
  editorView: document.querySelector("#editorView"),
  filesView: document.querySelector("#filesView"),
  // Skills view
  skillGrid: document.querySelector("#skillGrid"),
  skillSearch: document.querySelector("#skillSearch"),
  newSkillButton: document.querySelector("#newSkillButton"),
  statusSkillCount: document.querySelector("#statusSkillCount"),
  // Editor view
  backToSkills: document.querySelector("#backToSkills"),
  skillName: document.querySelector("#skillName"),
  dirtyIndicator: document.querySelector("#dirtyIndicator"),
  formatButton: document.querySelector("#formatButton"),
  toggleApiRefButton: document.querySelector("#toggleApiRefButton"),
  skillSettingsButton: document.querySelector("#skillSettingsButton"),
  deleteSkillButton: document.querySelector("#deleteSkillButton"),
  saveSkillButton: document.querySelector("#saveSkillButton"),
  runButton: document.querySelector("#runButton"),
  editorHint: document.querySelector(".editor-hint"),
  editorInput: document.querySelector("#editorInput"),
  highlightLayer: document.querySelector("#highlightLayer"),
  lineNumbers: document.querySelector("#lineNumbers"),
  splitWorkspace: document.querySelector("#splitWorkspace"),
  editorAndRef: document.querySelector(".editor-and-ref"),
  // Console
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
  // API Ref
  apiRefPanel: document.querySelector("#apiRefPanel"),
  apiRefSearch: document.querySelector("#apiRefSearch"),
  apiRefList: document.querySelector("#apiRefList"),
  // Status
  statusDot: document.querySelector("#statusDot"),
  statusLabel: document.querySelector("#statusLabel"),
  targetSelect: document.querySelector("#targetSelect"),
  // Files
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
  // Modals
  runModal: document.querySelector("#runModal"),
  runModalTitle: document.querySelector("#runModalTitle"),
  runModalBody: document.querySelector("#runModalBody"),
  runModalExecute: document.querySelector("#runModalExecute"),
  settingsModal: document.querySelector("#settingsModal"),
  skillSummary: document.querySelector("#skillSummary"),
  skillRuntime: document.querySelector("#skillRuntime"),
  skillExecutionMode: document.querySelector("#skillExecutionMode"),
  skillInputsSchema: document.querySelector("#skillInputsSchema"),
  skillSchemaStatus: document.querySelector("#skillSchemaStatus"),
  // Toast
  toastContainer: document.querySelector("#toastContainer"),
};

/* ---- Utilities ---- */
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function showToast(message, variant = "info", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  toast.innerHTML = `<span class="toast-icon"></span><span>${escapeHtml(message)}</span>`;
  els.toastContainer.append(toast);
  const dismiss = () => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };
  toast.addEventListener("click", dismiss);
  setTimeout(dismiss, duration);
}

/* ---- Syntax highlighting ---- */
const TOKEN_REGEX = /\/\/.*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:0x[\da-fA-F]+n?|\d+(?:\.\d+)?n?)\b|\b(?:const|let|var|if|else|return|function|class|for|while|try|catch|throw|new|await|async|switch|case|break|continue|typeof|instanceof|in|of)\b|\b(?:true|false|null|undefined|Native|FileUtils|RootFS|Apps|Tasks|TaskMemory|MachO|Staging|skillInput|SkillInput|log|BigInt)\b/g;

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

function updateEditorPresentation() {
  const code = els.editorInput.value;
  els.highlightLayer.innerHTML = highlight(code);
  const lineCount = Math.max(code.split("\n").length, 1);
  els.lineNumbers.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join("\n");
  updateDirtyState();
}

function syncEditorScroll() {
  els.highlightLayer.scrollTop = els.editorInput.scrollTop;
  els.highlightLayer.scrollLeft = els.editorInput.scrollLeft;
  els.lineNumbers.scrollTop = els.editorInput.scrollTop;
}

function updateDirtyState() {
  const isDirty = els.editorInput.value !== state.lastSavedCode;
  if (isDirty !== state.dirty) {
    state.dirty = isDirty;
    els.dirtyIndicator.hidden = !isDirty;
  }
}

/* ---- View management ---- */
function setView(view) {
  state.activeView = view;
  const views = { skills: els.skillsView, editor: els.editorView, files: els.filesView };
  const tabs = { skills: els.navSkills, editor: els.navEditor, files: els.navFiles };
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== view;
  }
  for (const [key, el] of Object.entries(tabs)) {
    el.classList.toggle("is-active", key === view);
    el.setAttribute("aria-selected", String(key === view));
  }
  if (view === "files" && !state.filesLoadedOnce && state.connected) {
    state.filesLoadedOnce = true;
    loadDirectory(state.fileCurrentPath);
  }
}

/* ---- Modal management ---- */
function openModal(modalEl) {
  modalEl.hidden = false;
}

function closeModal(modalEl) {
  modalEl.hidden = true;
}

function installModalDismiss() {
  document.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(`#${btn.dataset.dismiss}`);
      if (target) closeModal(target);
    });
  });
  // Close on overlay click
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });
  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay:not([hidden])").forEach(closeModal);
    }
  });
}

/* ---- Status ---- */
function setStatus(status) {
  state.connected = Boolean(status.connected);
  state.appConnected = Boolean(status.appConnected);
  state.launchdAgentConnected = Boolean(status.launchdAgentConnected);
  state.launchdWorkerReady = Boolean(status.launchdWorkerReady);
  els.statusDot.classList.toggle("online", state.connected);
  els.statusDot.classList.toggle("offline", !state.connected);
  if (state.launchdAgentConnected) {
    els.statusLabel.textContent = status.activeJobs ? `Agent live \u00b7 ${status.activeJobs} jobs` : "Agent live";
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
  // Update target selector availability
  for (const opt of els.targetSelect.options) {
    if (opt.value === "agent") opt.disabled = !state.launchdAgentConnected;
    if (opt.value === "bridge") opt.disabled = !state.appConnected;
  }
  if (!state.connected) {
    state.fileEntries = [];
    renderFileList();
    resetFileSelection();
    setFileStatus("Waiting for device", "error");
  }
  setFileBusy(state.fileBusy);
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  els.runButton.disabled = nextBusy;
  els.runButton.classList.toggle("is-running", nextBusy);
  els.saveSkillButton.disabled = nextBusy;
  els.deleteSkillButton.disabled = nextBusy || !state.selectedSkillId;
  els.runModalExecute.disabled = nextBusy;
  els.runModalExecute.classList.toggle("is-running", nextBusy);
}

function setRunMeta(label, variant = "") {
  els.runMeta.textContent = label;
  els.runMeta.className = "run-meta" + (variant ? ` is-${variant}` : "");
}

/* ---- Console ---- */
function setConsoleTab(tab) {
  state.activeConsoleTab = tab;
  const resultActive = tab === "result";
  els.resultTab.classList.toggle("is-active", resultActive);
  els.logsTab.classList.toggle("is-active", !resultActive);
  els.resultTab.setAttribute("aria-selected", String(resultActive));
  els.logsTab.setAttribute("aria-selected", String(!resultActive));
  els.resultOutput.classList.toggle("is-active", resultActive);
  els.logOutput.classList.toggle("is-active", !resultActive);
}

function setConsoleOpen(open) {
  state.consoleOpen = open;
  els.splitWorkspace.classList.toggle("console-collapsed", !open);
  els.toggleConsoleButton.textContent = open ? "Hide" : "Show";
}

function ensureConsoleOpen(tab = state.activeConsoleTab) {
  setConsoleOpen(true);
  setConsoleTab(tab);
}

function writeResult(result, isError = false) {
  els.resultOutput.textContent = result;
  els.resultOutput.classList.toggle("error", isError);
}

function writeLogs(logs) {
  if (!logs || logs.length === 0) {
    els.logOutput.textContent = "No logs emitted.";
    return;
  }
  els.logOutput.textContent = logs.join("\n");
}

function appendLog(msg) {
  if (!msg) return;
  const cur = els.logOutput.textContent;
  if (cur === "No logs yet." || cur === "No logs emitted.") {
    els.logOutput.textContent = msg;
  } else {
    els.logOutput.textContent += "\n" + msg;
  }
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function copyConsoleOutput() {
  const activeOutput = state.activeConsoleTab === "result" ? els.resultOutput : els.logOutput;
  navigator.clipboard.writeText(activeOutput.textContent).then(() => {
    els.consoleCopyBtn.textContent = "Copied";
    els.consoleCopyBtn.classList.add("copied");
    setTimeout(() => {
      els.consoleCopyBtn.textContent = "Copy";
      els.consoleCopyBtn.classList.remove("copied");
    }, 1500);
  }).catch(() => showToast("Copy failed", "error"));
}

/* ---- Input Schema ---- */
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
    const allowed = new Set(options.map((o) => o.value));
    const dv = String(def.defaultValue || options[0].value);
    normalized.options = options;
    normalized.defaultValue = allowed.has(dv) ? dv : options[0].value;
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
  try { parsed = JSON.parse(raw); } catch { throw new Error("Input schema must be valid JSON."); }
  if (!Array.isArray(parsed)) throw new Error("Input schema must be a JSON array.");
  const normalized = parsed.map(normalizeInputDefinition);
  const seen = new Set();
  for (const def of normalized) {
    if (seen.has(def.id)) throw new Error(`Duplicate input id: ${def.id}`);
    seen.add(def.id);
  }
  return normalized;
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

/* ---- App Picker (for "app" input type) ---- */
const appPickerState = { apps: null, loading: false, error: null };

async function fetchAppList(force = false) {
  if (appPickerState.apps && !force) return appPickerState.apps;
  if (appPickerState.loading) return appPickerState.apps || [];
  appPickerState.loading = true;
  appPickerState.error = null;
  try {
    const res = await fetch("/api/apps");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    appPickerState.apps = (data.apps || []).map((a) => ({
      ...a,
      isSystem: a.bundlePath.startsWith("/Applications/"),
    }));
    return appPickerState.apps;
  } catch (err) {
    appPickerState.error = err.message;
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
    if (toggleCb.checked) apps = apps.filter((a) => !a.isSystem);
    const q = searchInput.value.trim().toLowerCase();
    if (q) apps = apps.filter((a) => a.name.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q));

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
        const selText = document.createElement("span");
        selText.textContent = `${app.name} (${app.bundleId})`;
        selectedEl.append(selText);
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

/* ---- Run Modal ---- */
function renderRunModal(definitions) {
  els.runModalBody.innerHTML = "";
  state.skillInputValues = {};

  if (definitions.length === 0) {
    const p = document.createElement("p");
    p.className = "run-inputs-empty";
    p.textContent = "This skill has no inputs. Click Execute to run.";
    els.runModalBody.append(p);
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
      input.addEventListener("change", () => { state.skillInputValues[def.id] = input.checked; });
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
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "No options available";
        input.append(empty);
        input.disabled = true;
      }
      input.value = String(value || options[0]?.value || "");
    } else {
      input.type = "text";
      input.value = String(value);
      if (def.placeholder) input.placeholder = def.placeholder;
    }
    input.addEventListener("input", () => { state.skillInputValues[def.id] = input.value; });
    input.addEventListener("change", () => { state.skillInputValues[def.id] = input.value; });
    row.append(label, input);
    els.runModalBody.append(row);
  }
}

function showRunModal() {
  const skillName = els.skillName.value.trim() || "Scratch Buffer";
  els.runModalTitle.textContent = `Run: ${skillName}`;
  renderRunModal(state.skillInputs);
  openModal(els.runModal);
  // Focus first input in the modal
  const firstInput = els.runModalBody.querySelector("input, select");
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

/* ---- Skills Grid ---- */
function filteredSkills() {
  const query = els.skillSearch.value.trim().toLowerCase();
  if (!query) return state.skills;
  return state.skills.filter((s) => s.name.toLowerCase().includes(query) || (s.summary || "").toLowerCase().includes(query));
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
    const msg = document.createElement("p");
    msg.textContent = state.skills.length === 0
      ? "No saved skills yet. Create one with the button above."
      : "No skills match your search.";
    empty.append(icon, msg);
    els.skillGrid.append(empty);
    return;
  }

  for (const skill of skills) {
    const card = document.createElement("div");
    card.className = "skill-card";

    // Header
    const header = document.createElement("div");
    header.className = "skill-card-header";
    const name = document.createElement("strong");
    name.className = "skill-card-name";
    name.textContent = skill.name;
    const date = document.createElement("span");
    date.className = "skill-card-date";
    date.textContent = formatDate(skill.updatedAt);
    header.append(name, date);

    // Summary
    const summary = document.createElement("p");
    summary.className = "skill-card-summary";
    summary.textContent = skill.summary || "No description";

    // Tags
    const tags = document.createElement("div");
    tags.className = "skill-card-tags";
    const runtimeTag = document.createElement("span");
    runtimeTag.className = "tag";
    runtimeTag.textContent = skill.runtime === "jscbridge" ? "JSCBridge" : skill.runtime;
    tags.append(runtimeTag);
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

    // Footer with actions
    const footer = document.createElement("div");
    footer.className = "skill-card-footer";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "btn btn-primary btn-sm";
    runBtn.textContent = "Run";
    runBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickRunSkill(skill.id);
    });
    footer.append(runBtn);

    card.append(header, summary, tags, footer);
    card.addEventListener("click", () => openSkillInEditor(skill.id));
    els.skillGrid.append(card);
  }
}

/* ---- Skill loading / editing ---- */
function populateEditor(skill) {
  els.skillName.value = skill?.name || "";
  els.skillSummary.value = skill?.summary || "";
  els.skillRuntime.value = skill?.runtime || "jscbridge";
  els.skillExecutionMode.value = skill?.executionMode || "interactive";
  els.skillInputsSchema.value = JSON.stringify(skill?.inputs || [], null, 2);
  els.editorInput.value = skill?.code || DEFAULT_SCRIPT;
  state.skillRuntime = els.skillRuntime.value;
  state.skillExecutionMode = els.skillExecutionMode.value;
  state.skillEntryFile = skill?.entryFile || "";
  state.skillInputValues = {};
  refreshSchemaFromEditor();
  state.lastSavedCode = els.editorInput.value;
  state.dirty = false;
  els.dirtyIndicator.hidden = true;
  updateEditorPresentation();
}

async function openSkillInEditor(skillId) {
  try {
    const skill = await requestJson(`/api/skills/${encodeURIComponent(skillId)}`, { headers: {} });
    state.selectedSkillId = skill.id;
    populateEditor(skill);
    els.deleteSkillButton.disabled = false;
    setView("editor");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function quickRunSkill(skillId) {
  try {
    const skill = await requestJson(`/api/skills/${encodeURIComponent(skillId)}`, { headers: {} });
    state.selectedSkillId = skill.id;
    populateEditor(skill);
    setView("editor");
    els.deleteSkillButton.disabled = false;
    // Trigger run (will show modal if inputs exist)
    initiateRun();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function resetDraft() {
  state.selectedSkillId = null;
  populateEditor({
    name: "",
    summary: "",
    runtime: "jscbridge",
    executionMode: "interactive",
    inputs: [],
    code: DEFAULT_SCRIPT,
  });
  els.deleteSkillButton.disabled = true;
}

/* ---- Run flow ---- */
function initiateRun() {
  let inputs;
  try {
    inputs = parseSkillInputSchema();
  } catch (error) {
    setSchemaStatus(error.message, "error");
    showToast(error.message, "error");
    return;
  }
  state.skillInputs = inputs;

  if (inputs.length > 0) {
    showRunModal();
  } else {
    state.skillInputValues = {};
    executeRun();
  }
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
  writeResult("Executing\u2026");
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
        target: target !== "auto" ? target : undefined,
      }),
    });
    if (result.jobId) {
      state.activeJobId = result.jobId;
      const elapsed = `${Math.round(performance.now() - startedAt)} ms`;
      setRunMeta(`Job queued in ${elapsed}`, "running");
      writeResult(`Detached job started.\njobId: ${result.jobId}`);
      writeLogs([]);
      setConsoleTab("result");
      showToast("Detached job started", "info");
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
    await refreshStatus();
  }
}

/* ---- Save / Delete ---- */
async function saveSkill() {
  const name = els.skillName.value.trim();
  const code = els.editorInput.value;
  if (!name) { showToast("Skill name is required.", "error"); els.skillName.focus(); return; }
  if (!code.trim()) { showToast("Cannot save an empty skill.", "error"); return; }

  let inputs;
  try { inputs = parseSkillInputSchema(); } catch (error) {
    setSchemaStatus(error.message, "error");
    showToast(error.message, "error");
    return;
  }

  setBusy(true);
  try {
    const saved = await requestJson("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        id: state.selectedSkillId,
        previousId: state.selectedSkillId,
        name,
        summary: els.skillSummary.value.trim(),
        code,
        runtime: els.skillRuntime.value,
        executionMode: els.skillExecutionMode.value,
        inputs,
        entryFile: state.skillEntryFile || undefined,
      }),
    });
    state.selectedSkillId = saved.id;
    state.lastSavedCode = code;
    state.dirty = false;
    els.dirtyIndicator.hidden = true;
    els.skillName.value = saved.name;
    els.deleteSkillButton.disabled = false;
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
  const skill = state.skills.find((s) => s.id === state.selectedSkillId);
  if (!window.confirm(`Delete skill "${skill?.name || state.selectedSkillId}"?`)) return;

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

/* ---- Network / API ---- */
async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

async function refreshStatus() {
  try {
    const status = await requestJson("/api/status", { headers: {} });
    setStatus(status);
  } catch {
    setStatus({ connected: false, appConnected: false, launchdAgentConnected: false, launchdWorkerReady: false, activeJobs: 0 });
    setRunMeta("Status unavailable");
  }
}

async function refreshJob(jobId) {
  if (!jobId) return null;
  try {
    const job = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, { headers: {} });
    handleJobEvent(job);
    return job;
  } catch { return null; }
}

function handleJobEvent(job) {
  if (!job?.jobId) return;
  state.jobs[job.jobId] = job;
  if (state.activeJobId !== job.jobId) return;

  if (Array.isArray(job.logs) && job.logs.length > 0) writeLogs(job.logs);

  if (job.status === "running" || job.status === "queued") {
    setRunMeta(`Job ${job.status}`, "running");
    return;
  }
  if (job.status === "completed") {
    setBusy(false);
    setRunMeta("Job completed");
    writeResult(job.result || "undefined", false);
    setConsoleTab((job.logs || []).length > 0 ? "logs" : "result");
    return;
  }
  if (job.status === "failed" || job.status === "lost") {
    setBusy(false);
    setRunMeta(`Job ${job.status}`, "error");
    writeResult(job.error || "Detached job failed", true);
    setConsoleTab("result");
  }
}

function connectEventStream() {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource("/api/events");
  source.addEventListener("status", (e) => { try { setStatus(JSON.parse(e.data)); } catch {} });
  source.addEventListener("job", (e) => { try { handleJobEvent(JSON.parse(e.data)); } catch {} });
  source.addEventListener("log", (e) => { try { appendLog(JSON.parse(e.data).msg); } catch {} });
  source.onerror = () => setRunMeta("Live updates reconnecting");
  state.eventSource = source;
}

async function refreshSkills() {
  const data = await requestJson("/api/skills", { headers: {} });
  state.skills = data.skills || [];
  renderSkillGrid();
}

/* ---- File Manager ---- */
function setFileBusy(nextBusy) {
  state.fileBusy = nextBusy;
  const disabled = nextBusy || !state.connected;
  els.fileRefreshButton.disabled = disabled;
  els.fileRootButton.disabled = disabled;
  els.fileUpButton.disabled = disabled;
  els.fileNewFolderButton.disabled = disabled;
  els.fileNewFileButton.disabled = disabled;
  els.fileUploadButton.disabled = disabled;
  els.filePathInput.disabled = disabled;
  els.fileRenameButton.disabled = disabled || !state.fileSelection;
  els.fileDeleteButton.disabled = disabled || !state.fileSelection;
  els.fileReloadButton.disabled = disabled || !state.fileSelection || state.fileSelection.isDirectory || !isTextFile(state.fileSelection);
  els.fileSaveButton.disabled = disabled || !state.fileSelection || state.fileSelection.isDirectory || !isTextFile(state.fileSelection);
  els.fileCopyPathButton.disabled = disabled || !state.fileSelection;
  els.fileDownloadButton.disabled = disabled || !state.fileSelection || state.fileSelection.isDirectory;
  els.fileSaveButton.classList.toggle("is-running", nextBusy);
}

function setFileStatus(label, variant = "") {
  els.fileStatus.textContent = label;
  els.fileStatus.className = "run-meta" + (variant ? ` is-${variant}` : "");
}

function formatFileSize(bytes) {
  if (bytes == null || bytes < 0) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function joinFsPath(base, name) {
  if (!base || base === "/") return `/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function fileTypeLabel(entry) {
  if (entry.isLink) return entry.linkTargetIsDirectory ? "link\u2192dir" : "link";
  if (entry.isDirectory) return "dir";
  const ext = fileExtension(entry.name);
  return ext || "file";
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "js", "ts", "jsx", "tsx", "css", "html", "htm", "xml",
  "yaml", "yml", "toml", "ini", "cfg", "conf", "sh", "bash", "zsh", "fish",
  "py", "rb", "pl", "lua", "swift", "m", "h", "c", "cpp", "hpp", "cs", "java",
  "kt", "go", "rs", "zig", "r", "sql", "graphql", "proto", "cmake", "make",
  "makefile", "dockerfile", "gitignore", "gitattributes", "env", "log", "csv",
  "tsv", "plist", "entitlements", "pbxproj", "xcscheme", "strings", "storyboard",
  "xib", "modulemap", "def", "map", "lock", "patch", "diff",
]);

function isTextFile(entry) {
  if (entry.isDirectory) return false;
  const ext = fileExtension(entry.name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Files without extension under ~1MB are likely text (scripts, configs)
  if (!ext && entry.size < 1048576) return true;
  return false;
}

/* Breadcrumbs */
function renderBreadcrumbs() {
  els.fileBreadcrumbs.innerHTML = "";
  const path = state.fileCurrentPath || "/";
  const parts = path.split("/").filter(Boolean);

  const addSeg = (label, targetPath, isCurrent) => {
    const btn = document.createElement("button");
    btn.className = "breadcrumb-seg" + (isCurrent ? " is-current" : "");
    btn.textContent = label;
    btn.type = "button";
    if (!isCurrent) btn.addEventListener("click", () => loadDirectory(targetPath));
    els.fileBreadcrumbs.append(btn);
  };

  addSeg("/", "/", parts.length === 0);

  let accumulated = "";
  for (let i = 0; i < parts.length; i++) {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep";
    sep.textContent = "/";
    els.fileBreadcrumbs.append(sep);
    accumulated += "/" + parts[i];
    addSeg(parts[i], accumulated, i === parts.length - 1);
  }

  // scroll to end
  els.fileBreadcrumbs.scrollLeft = els.fileBreadcrumbs.scrollWidth;
}

/* Sorting */
function getFilteredSortedEntries() {
  let entries = state.fileEntries;

  // Filter
  if (state.fileFilter) {
    const q = state.fileFilter.toLowerCase();
    entries = entries.filter((e) => e.name.toLowerCase().includes(q));
  }

  // Sort: directories always first
  const dir = state.fileSortAsc ? 1 : -1;
  entries = [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    switch (state.fileSortKey) {
      case "size":
        return ((a.size || 0) - (b.size || 0)) * dir;
      case "type":
        return fileTypeLabel(a).localeCompare(fileTypeLabel(b)) * dir;
      default: // name
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * dir;
    }
  });

  return entries;
}

function updateSortHeader() {
  els.fileSortHeader.querySelectorAll(".file-sort-col").forEach((col) => {
    const key = col.dataset.sort;
    const active = key === state.fileSortKey;
    col.classList.toggle("is-active", active);
    const arrow = col.querySelector(".sort-arrow");
    arrow.textContent = active ? (state.fileSortAsc ? "\u2193" : "\u2191") : "";
  });
}

function resetFileSelection() {
  state.fileSelection = null;
  state.fileLoadedText = "";
  state.fileFocusIndex = -1;
  els.filePreviewTitle.textContent = "Select a file";
  els.filePreviewMeta.textContent = "No file selected";
  els.filePreviewEmpty.hidden = false;
  els.fileEditor.value = "";
  els.fileEditor.disabled = true;
  setFileBusy(state.fileBusy);
}

function renderFileList() {
  els.fileList.innerHTML = "";
  const entries = getFilteredSortedEntries();
  const total = state.fileEntries.length;
  els.fileListMeta.textContent = state.fileFilter
    ? `${entries.length}/${total}`
    : `${total} items`;

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "file-list-empty";
    empty.innerHTML = state.fileFilter
      ? '<div class="file-list-empty-icon">?</div><p>No matches.</p>'
      : '<div class="file-list-empty-icon">/</div><p>This directory is empty.</p>';
    els.fileList.append(empty);
    return;
  }

  entries.forEach((entry, idx) => {
    const fragment = els.fileItemTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".file-item");
    const icon = fragment.querySelector(".file-item-icon");
    const name = fragment.querySelector(".file-item-name");
    const sizeEl = fragment.querySelector(".file-item-size");
    const typeEl = fragment.querySelector(".file-item-type");

    button.dataset.index = idx;
    button.classList.toggle("is-active", state.fileSelection?.path === entry.path);
    if (idx === state.fileFocusIndex) button.classList.add("is-focused");
    icon.textContent = entry.isLink ? "\u2197" : (entry.isDirectory ? "\u25a3" : "\u00b7");
    icon.classList.toggle("is-file", !entry.isDirectory);
    icon.classList.toggle("is-link", !!entry.isLink);
    name.textContent = entry.name;
    sizeEl.textContent = entry.isDirectory ? "\u2014" : formatFileSize(entry.size);
    typeEl.textContent = fileTypeLabel(entry);

    button.addEventListener("click", () => {
      state.fileFocusIndex = idx;
      state.fileSelection = entry;
      els.filePreviewTitle.textContent = entry.name;
      if (entry.isDirectory) {
        els.filePreviewMeta.textContent = `${entry.path} \u00b7 Directory`;
      } else {
        els.filePreviewMeta.textContent = `${entry.path} \u00b7 ${formatFileSize(entry.size)}` + (isTextFile(entry) ? "" : " \u00b7 Binary");
      }
      els.filePreviewEmpty.hidden = false;
      els.fileEditor.value = "";
      els.fileEditor.disabled = true;
      setFileBusy(state.fileBusy);
      renderFileList();
    });

    button.addEventListener("dblclick", () => {
      if (entry.isDirectory) loadDirectory(entry.path);
      else if (isTextFile(entry)) openFileEntry(entry);
    });

    // Right-click context menu
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showFileContextMenu(e.clientX, e.clientY, entry);
    });

    els.fileList.append(fragment);
  });
}

/* Context Menu */
let contextMenuEntry = null;

function showFileContextMenu(x, y, entry) {
  contextMenuEntry = entry;
  const menu = els.fileContextMenu;
  menu.hidden = false;
  // Position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  // Adjust if overflows
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
  // Show/hide download for dirs
  const dlItem = menu.querySelector('[data-action="download"]');
  if (dlItem) dlItem.hidden = entry.isDirectory;
}

function hideFileContextMenu() {
  els.fileContextMenu.hidden = true;
  contextMenuEntry = null;
}

function handleContextMenuAction(action) {
  const entry = contextMenuEntry;
  hideFileContextMenu();
  if (!entry) return;
  switch (action) {
    case "open":
      if (entry.isDirectory) loadDirectory(entry.path);
      else if (isTextFile(entry)) openFileEntry(entry);
      else downloadFile(entry);
      break;
    case "copypath":
      navigator.clipboard.writeText(entry.path).then(() => showToast("Path copied", "info"));
      break;
    case "download":
      if (!entry.isDirectory) downloadFile(entry);
      break;
    case "rename":
      state.fileSelection = entry;
      renameSelection();
      break;
    case "delete":
      state.fileSelection = entry;
      deleteSelection();
      break;
  }
}

/* Download */
async function downloadFile(entry) {
  if (!entry || entry.isDirectory) return;
  setFileBusy(true);
  setFileStatus(`Downloading ${entry.name}\u2026`, "running");
  try {
    const resp = await fetch("/api/fs/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entry.path }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Download failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.name;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFileStatus(`Downloaded ${entry.name} (${formatFileSize(blob.size)})`);
    showToast(`Downloaded ${entry.name}`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

/* Copy path */
function copySelectionPath() {
  if (!state.fileSelection) return;
  navigator.clipboard.writeText(state.fileSelection.path)
    .then(() => showToast("Path copied", "info"));
}

async function fsRequest(op, payload = {}) {
  const response = await requestJson("/api/fs", {
    method: "POST",
    body: JSON.stringify({ op, ...payload }),
  });
  if (!response.ok) throw new Error(response.error || "FS request failed");
  return response.result;
}

async function loadDirectory(path = state.fileCurrentPath) {
  if (!state.connected) { setFileStatus("Waiting for device", "error"); return; }
  setFileBusy(true);
  setFileStatus(`Listing ${path}\u2026`, "running");
  try {
    const listing = await fsRequest("list", { path });
    state.fileCurrentPath = listing.path;
    state.fileEntries = listing.entries || [];
    state.fileFocusIndex = -1;
    els.filePathInput.value = listing.path;
    if (state.fileSelection && !state.fileEntries.find((e) => e.path === state.fileSelection.path)) resetFileSelection();
    renderBreadcrumbs();
    renderFileList();
    setFileStatus(`Ready \u00b7 ${state.fileEntries.length} items`);
  } catch (error) {
    state.fileEntries = [];
    renderBreadcrumbs();
    renderFileList();
    resetFileSelection();
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function openFileEntry(entry) {
  setFileBusy(true);
  setFileStatus(`Reading ${entry.name}\u2026`, "running");
  try {
    const payload = await fsRequest("read", { path: entry.path, maxBytes: 262144 });
    state.fileSelection = entry;
    state.fileLoadedText = payload.text || "";
    els.filePreviewTitle.textContent = entry.name;
    els.filePreviewMeta.textContent = `${payload.path} \u00b7 ${formatFileSize(Math.max(0, payload.size || 0))}`;
    els.filePreviewEmpty.hidden = true;
    els.fileEditor.disabled = false;
    els.fileEditor.value = payload.text || "";
    renderFileList();
    setFileStatus(`Loaded ${entry.name}`);
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function saveOpenFile() {
  if (!state.fileSelection || state.fileSelection.isDirectory) return;
  if (new TextEncoder().encode(els.fileEditor.value).length > 2800) {
    setFileStatus("Inline editor limit is 2800 bytes", "error");
    showToast("Inline editor limit is 2800 bytes", "error");
    return;
  }
  setFileBusy(true);
  setFileStatus(`Saving ${state.fileSelection.name}\u2026`, "running");
  try {
    await fsRequest("write", { path: state.fileSelection.path, text: els.fileEditor.value });
    state.fileLoadedText = els.fileEditor.value;
    setFileStatus(`Saved ${state.fileSelection.name}`);
    showToast(`Saved ${state.fileSelection.name}`, "success");
    await loadDirectory(state.fileCurrentPath);
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function promptNewFolder() {
  const name = window.prompt("New folder name");
  if (!name) return;
  setFileBusy(true);
  setFileStatus("Creating folder\u2026", "running");
  try {
    await fsRequest("mkdir", { path: joinFsPath(state.fileCurrentPath, name.trim()) });
    await loadDirectory(state.fileCurrentPath);
    showToast(`Created ${name}`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function promptNewFile() {
  const name = window.prompt("New file name");
  if (!name) return;
  setFileBusy(true);
  setFileStatus("Creating file\u2026", "running");
  try {
    const path = joinFsPath(state.fileCurrentPath, name.trim());
    await fsRequest("write", { path, text: "" });
    await loadDirectory(state.fileCurrentPath);
    const entry = state.fileEntries.find((item) => item.path === path);
    if (entry) await openFileEntry(entry);
    showToast(`Created ${name}`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function renameSelection() {
  if (!state.fileSelection) return;
  const nextName = window.prompt("Rename to", state.fileSelection.name);
  if (!nextName || nextName.trim() === state.fileSelection.name) return;
  setFileBusy(true);
  setFileStatus("Renaming\u2026", "running");
  try {
    const current = state.fileSelection.path;
    const base = current.split("/").slice(0, -1).join("/") || "/";
    await fsRequest("rename", { path: current, destination: joinFsPath(base, nextName.trim()) });
    resetFileSelection();
    await loadDirectory(state.fileCurrentPath);
    showToast(`Renamed to ${nextName.trim()}`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

async function deleteSelection() {
  if (!state.fileSelection) return;
  const label = state.fileSelection.name;
  const isDir = state.fileSelection.isDirectory;
  const msg = isDir
    ? `Delete directory "${label}" and all its contents? This cannot be undone.`
    : `Delete "${label}"? This cannot be undone.`;
  if (!window.confirm(msg)) return;
  setFileBusy(true);
  setFileStatus("Deleting\u2026", "running");
  try {
    await fsRequest("delete", { path: state.fileSelection.path, recursive: true });
    resetFileSelection();
    await loadDirectory(state.fileCurrentPath);
    showToast(`Deleted ${label}`, "info");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

/* ---- File Upload ---- */
const UPLOAD_CHUNK_SIZE = 512 * 1024; // 512KB raw per chunk

function showUploadProgress(label, percent) {
  els.uploadProgress.hidden = false;
  els.uploadProgressLabel.textContent = label;
  els.uploadProgressFill.style.width = `${Math.round(percent)}%`;
}

function hideUploadProgress() {
  els.uploadProgress.hidden = true;
  els.uploadProgressFill.style.width = "0%";
}

function readChunkAsBase64(file, offset, size) {
  return new Promise((resolve, reject) => {
    const chunk = file.slice(offset, offset + size);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(new Error("Failed to read file chunk"));
    reader.readAsDataURL(chunk);
  });
}

async function uploadSingleFile(file) {
  const destPath = joinFsPath(state.fileCurrentPath, file.name);

  if (file.size === 0) {
    await fsRequest("write", { path: destPath, text: "" });
    return;
  }

  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * UPLOAD_CHUNK_SIZE;
    const chunkSize = Math.min(UPLOAD_CHUNK_SIZE, file.size - offset);
    const base64 = await readChunkAsBase64(file, offset, chunkSize);

    await fsRequest("write_base64", {
      path: destPath,
      data: base64,
      append: i > 0,
    });
  }
}

async function uploadFiles(files) {
  if (!files || files.length === 0) return;
  if (!state.connected) { showToast("Device not connected", "error"); return; }

  setFileBusy(true);
  const total = files.length;
  let completed = 0;

  try {
    for (const file of files) {
      const label = total > 1
        ? `Uploading ${file.name} (${completed + 1}/${total})...`
        : `Uploading ${file.name}...`;
      showUploadProgress(label, (completed / total) * 100);
      setFileStatus(label, "running");

      await uploadSingleFile(file);
      completed++;
      showUploadProgress(
        completed < total ? `Uploading (${completed}/${total})...` : "Done",
        (completed / total) * 100
      );
    }

    const msg = total === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${total} files`;
    setFileStatus(msg);
    showToast(msg, "success");
    await loadDirectory(state.fileCurrentPath);
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    hideUploadProgress();
    setFileBusy(false);
    els.fileUploadInput.value = "";
  }
}

/* ---- Normalize ---- */
function normalizeEditorText() {
  const normalized = els.editorInput.value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[ \t]+$/gm, "");
  els.editorInput.value = normalized.trimEnd() + "\n";
  updateEditorPresentation();
  showToast("Normalized whitespace", "info");
}

/* ---- API Reference Panel ---- */
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
  const lf = filter.toLowerCase();
  for (const category of API_CATEGORIES) {
    const items = API_CATALOG.filter(
      (item) => item.category === category &&
        (!lf || item.name.toLowerCase().includes(lf) || item.signature.toLowerCase().includes(lf) || item.description.toLowerCase().includes(lf))
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

/* ---- Autocomplete ---- */
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
  let i = selectionStart - 1;
  while (i >= 0 && /[a-zA-Z0-9_.]/.test(value[i])) i--;
  return { word: value.slice(i + 1, selectionStart), start: i + 1 };
}

function getCaretCoordinates() {
  const ta = els.editorInput;
  const { value, selectionStart } = ta;
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(ta);
  const props = [
    "fontFamily", "fontSize", "fontWeight", "letterSpacing", "wordSpacing",
    "lineHeight", "tabSize", "paddingTop", "paddingLeft", "paddingRight",
    "borderTopWidth", "borderLeftWidth", "whiteSpace", "overflowWrap",
    "wordWrap", "wordBreak"
  ];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre";
  mirror.style.overflow = "hidden";
  for (const prop of props) mirror.style[prop] = computed[prop];
  mirror.style.width = ta.clientWidth + "px";
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
    x: relX - ta.scrollLeft,
    y: relY - ta.scrollTop + parseFloat(computed.lineHeight || "21"),
  };
}

function showAutocomplete(matches) {
  if (!acPopup) createAutocompletePopup();
  acItems = matches;
  acSelectedIndex = 0;
  acVisible = true;
  acPopup.innerHTML = "";
  const { word } = getWordAtCursor();
  const lw = word.toLowerCase();
  for (let i = 0; i < matches.length; i++) {
    const item = matches[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "autocomplete-item" + (i === 0 ? " is-selected" : "");
    const name = item.name;
    const ln = name.toLowerCase();
    const mi = ln.indexOf(lw);
    let nameHtml = mi >= 0 && lw.length > 0
      ? escapeHtml(name.slice(0, mi)) + '<span class="ac-match">' + escapeHtml(name.slice(mi, mi + lw.length)) + '</span>' + escapeHtml(name.slice(mi + lw.length))
      : escapeHtml(name);
    btn.innerHTML = `<span class="ac-name">${nameHtml}</span><span class="ac-desc">${escapeHtml(item.description)}</span>`;
    const idx = i;
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); acceptAutocomplete(idx); });
    btn.addEventListener("mouseenter", () => { acSelectedIndex = idx; updateAcSelection(); });
    acPopup.append(btn);
  }

  const coords = getCaretCoordinates();
  const editorFrame = document.getElementById("editorFrame");
  const frameRect = editorFrame.getBoundingClientRect();
  const parentRect = acPopup.parentElement.getBoundingClientRect();
  const left = frameRect.left - parentRect.left + coords.x;
  const top = frameRect.top - parentRect.top + coords.y;
  acPopup.style.left = Math.max(0, Math.min(left, parentRect.width - 240)) + "px";
  acPopup.style.top = Math.min(top, parentRect.height - 60) + "px";
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
  acPopup.querySelectorAll(".autocomplete-item").forEach((el, i) => {
    el.classList.toggle("is-selected", i === acSelectedIndex);
    if (i === acSelectedIndex) el.scrollIntoView({ block: "nearest" });
  });
}

function acceptAutocomplete(index) {
  if (index < 0 || index >= acItems.length) return;
  const item = acItems[index];
  const { start } = getWordAtCursor();
  const { value, selectionStart } = els.editorInput;
  const snippet = item.snippet;
  els.editorInput.value = value.slice(0, start) + snippet + value.slice(selectionStart);
  const po = snippet.indexOf("(");
  const pc = snippet.indexOf(")");
  if (po >= 0 && pc > po + 1) {
    els.editorInput.selectionStart = start + po + 1;
    els.editorInput.selectionEnd = start + pc;
  } else if (po >= 0 && pc === po + 1) {
    els.editorInput.selectionStart = els.editorInput.selectionEnd = start + po + 1;
  } else {
    els.editorInput.selectionStart = els.editorInput.selectionEnd = start + snippet.length;
  }
  updateEditorPresentation();
  hideAutocomplete();
}

function checkAutocomplete() {
  const { word } = getWordAtCursor();
  if (word.length < 2) { hideAutocomplete(); return; }
  const lw = word.toLowerCase();
  const matches = API_CATALOG.filter((item) => item.name.toLowerCase().includes(lw)).slice(0, 8);
  if (matches.length === 0) { hideAutocomplete(); return; }
  matches.sort((a, b) => {
    const as = a.name.toLowerCase().startsWith(lw) ? 0 : 1;
    const bs = b.name.toLowerCase().startsWith(lw) ? 0 : 1;
    return as - bs;
  });
  showAutocomplete(matches);
}

/* ---- Install behaviors ---- */
function installConsoleBehaviors() {
  setConsoleTab("result");
  setConsoleOpen(false);
  els.resultTab.addEventListener("click", () => ensureConsoleOpen("result"));
  els.logsTab.addEventListener("click", () => ensureConsoleOpen("logs"));
  els.toggleConsoleButton.addEventListener("click", () => {
    state.consoleOpen ? setConsoleOpen(false) : ensureConsoleOpen(state.activeConsoleTab);
  });
  els.consoleCopyBtn.addEventListener("click", copyConsoleOutput);

  let resizing = false;
  const stopResize = () => { resizing = false; document.body.style.userSelect = ""; };
  els.consoleSplitter.addEventListener("pointerdown", (e) => {
    resizing = true;
    document.body.style.userSelect = "none";
    els.consoleSplitter.setPointerCapture(e.pointerId);
    setConsoleOpen(true);
  });
  els.consoleSplitter.addEventListener("click", () => {
    if (!state.consoleOpen) ensureConsoleOpen(state.activeConsoleTab);
  });
  els.consoleSplitter.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const rect = els.splitWorkspace.getBoundingClientRect();
    const bounded = Math.max(120, Math.min(rect.bottom - e.clientY, rect.height - 220));
    els.splitWorkspace.style.setProperty("--console-height", `${bounded}px`);
    setConsoleOpen(true);
  });
  els.consoleSplitter.addEventListener("pointerup", (e) => {
    if (els.consoleSplitter.hasPointerCapture(e.pointerId)) els.consoleSplitter.releasePointerCapture(e.pointerId);
    stopResize();
  });
  els.consoleSplitter.addEventListener("pointercancel", stopResize);
  els.consoleSplitter.addEventListener("lostpointercapture", stopResize);
}

function installEditorBehaviors() {
  els.editorInput.addEventListener("input", updateEditorPresentation);
  els.editorInput.addEventListener("scroll", syncEditorScroll);
  els.editorInput.addEventListener("focus", () => els.editorHint.classList.add("faded"));
  els.editorInput.addEventListener("blur", () => els.editorHint.classList.remove("faded"));

  els.editorInput.addEventListener("keydown", (e) => {
    if (acVisible && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape")) return;
    if (acVisible && e.key === "Tab" && acSelectedIndex >= 0) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = els.editorInput;
      els.editorInput.value = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
      els.editorInput.selectionStart = els.editorInput.selectionEnd = selectionStart + 4;
      updateEditorPresentation();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); initiateRun(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveSkill(); }
  });
}

function installAutocompleteBehaviors() {
  createAutocompletePopup();
  els.editorInput.addEventListener("input", checkAutocomplete);
  els.editorInput.addEventListener("keydown", (e) => {
    if (!acVisible) return;
    if (e.key === "ArrowDown") { e.preventDefault(); acSelectedIndex = Math.min(acSelectedIndex + 1, acItems.length - 1); updateAcSelection(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); acSelectedIndex = Math.max(acSelectedIndex - 1, 0); updateAcSelection(); return; }
    if (e.key === "Tab" && acSelectedIndex >= 0) { e.preventDefault(); e.stopPropagation(); acceptAutocomplete(acSelectedIndex); return; }
    if (e.key === "Escape") { e.preventDefault(); hideAutocomplete(); }
  });
  els.editorInput.addEventListener("blur", () => {
    setTimeout(() => { if (!acPopup?.matches(":hover")) hideAutocomplete(); }, 150);
  });
  els.editorInput.addEventListener("scroll", hideAutocomplete);
  document.addEventListener("mousedown", (e) => {
    if (acVisible && acPopup && !acPopup.contains(e.target) && e.target !== els.editorInput) hideAutocomplete();
  });
}

function installApiRefBehaviors() {
  els.toggleApiRefButton.addEventListener("click", toggleApiRef);
  els.apiRefSearch.addEventListener("input", () => renderApiRefList(els.apiRefSearch.value.trim()));
  renderApiRefList();
}

function navigateUp() {
  if (state.fileCurrentPath === "/") return;
  const parts = state.fileCurrentPath.split("/").filter(Boolean);
  parts.pop();
  loadDirectory(`/${parts.join("/")}`);
}

function installFileManagerBehaviors() {
  resetFileSelection();
  setFileStatus("Idle");
  renderBreadcrumbs();

  // Toolbar buttons
  els.fileRefreshButton.addEventListener("click", () => loadDirectory(state.fileCurrentPath));
  els.fileRootButton.addEventListener("click", () => loadDirectory("/"));
  els.fileUpButton.addEventListener("click", navigateUp);
  els.fileNewFolderButton.addEventListener("click", promptNewFolder);
  els.fileNewFileButton.addEventListener("click", promptNewFile);
  els.fileUploadButton.addEventListener("click", () => els.fileUploadInput.click());
  els.fileUploadInput.addEventListener("change", () => uploadFiles(Array.from(els.fileUploadInput.files)));

  // New buttons
  els.fileCopyPathButton.addEventListener("click", copySelectionPath);
  els.fileDownloadButton.addEventListener("click", () => {
    if (state.fileSelection && !state.fileSelection.isDirectory) downloadFile(state.fileSelection);
  });

  // Breadcrumb path editing
  els.fileEditPathButton.addEventListener("click", () => {
    const editing = !els.filePathInput.hidden;
    els.filePathInput.hidden = editing;
    els.fileBreadcrumbs.hidden = !editing;
    els.fileEditPathButton.textContent = editing ? "Edit" : "Done";
    if (!editing) {
      els.filePathInput.value = state.fileCurrentPath;
      els.filePathInput.focus();
      els.filePathInput.select();
    }
  });
  els.filePathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadDirectory(els.filePathInput.value || "/");
      els.filePathInput.hidden = true;
      els.fileBreadcrumbs.hidden = false;
      els.fileEditPathButton.textContent = "Edit";
    } else if (e.key === "Escape") {
      els.filePathInput.hidden = true;
      els.fileBreadcrumbs.hidden = false;
      els.fileEditPathButton.textContent = "Edit";
    }
  });

  // Search / filter
  els.fileSearchInput.addEventListener("input", () => {
    state.fileFilter = els.fileSearchInput.value.trim();
    state.fileFocusIndex = -1;
    renderFileList();
  });

  // Sort header
  els.fileSortHeader.addEventListener("click", (e) => {
    const col = e.target.closest("[data-sort]");
    if (!col) return;
    const key = col.dataset.sort;
    if (state.fileSortKey === key) {
      state.fileSortAsc = !state.fileSortAsc;
    } else {
      state.fileSortKey = key;
      state.fileSortAsc = true;
    }
    updateSortHeader();
    renderFileList();
  });

  // Drag-and-drop upload
  const dropZone = els.fileBrowser;
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) uploadFiles(Array.from(e.dataTransfer.files));
  });

  els.fileRenameButton.addEventListener("click", renameSelection);
  els.fileDeleteButton.addEventListener("click", deleteSelection);
  els.fileReloadButton.addEventListener("click", () => {
    if (state.fileSelection && !state.fileSelection.isDirectory && isTextFile(state.fileSelection)) openFileEntry(state.fileSelection);
  });
  els.fileSaveButton.addEventListener("click", saveOpenFile);

  els.fileEditor.addEventListener("input", () => {
    if (!state.fileSelection || state.fileSelection.isDirectory) return;
    const dirty = els.fileEditor.value !== state.fileLoadedText;
    setFileStatus(dirty ? "Unsaved changes" : `Loaded ${state.fileSelection.name}`, dirty ? "running" : "");
  });

  // Context menu
  document.addEventListener("click", (e) => {
    if (!els.fileContextMenu.contains(e.target)) hideFileContextMenu();
  });
  els.fileContextMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-action]");
    if (item) handleContextMenuAction(item.dataset.action);
  });

  // Keyboard navigation on file list
  els.fileList.addEventListener("keydown", (e) => {
    const entries = getFilteredSortedEntries();
    if (!entries.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.fileFocusIndex = Math.min(state.fileFocusIndex + 1, entries.length - 1);
      renderFileList();
      scrollFocusedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.fileFocusIndex = Math.max(state.fileFocusIndex - 1, 0);
      renderFileList();
      scrollFocusedIntoView();
    } else if (e.key === "Enter" && state.fileFocusIndex >= 0) {
      e.preventDefault();
      const entry = entries[state.fileFocusIndex];
      if (entry.isDirectory) loadDirectory(entry.path);
      else if (isTextFile(entry)) openFileEntry(entry);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      navigateUp();
    } else if (e.key === "Delete" && state.fileFocusIndex >= 0) {
      e.preventDefault();
      state.fileSelection = entries[state.fileFocusIndex];
      deleteSelection();
    } else if (e.key === "F2" && state.fileFocusIndex >= 0) {
      e.preventDefault();
      state.fileSelection = entries[state.fileFocusIndex];
      renameSelection();
    } else if (e.key === "F5") {
      e.preventDefault();
      loadDirectory(state.fileCurrentPath);
    }
  });

  // Global keyboard shortcuts when Files view is active
  document.addEventListener("keydown", (e) => {
    if (state.activeView !== "files") return;
    if (e.key === "F5") { e.preventDefault(); loadDirectory(state.fileCurrentPath); }
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      els.fileSearchInput.focus();
      els.fileSearchInput.select();
    }
  });

  // Resizable splitter
  installFileSplitter();
}

function scrollFocusedIntoView() {
  const focused = els.fileList.querySelector(".is-focused");
  if (focused) focused.scrollIntoView({ block: "nearest" });
}

function installFileSplitter() {
  const splitter = els.fileSplitter;
  const browser = els.fileBrowserPanel;
  let startX, startWidth;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    const newWidth = Math.max(200, Math.min(startWidth + dx, window.innerWidth - 300));
    browser.style.width = `${newWidth}px`;
  };

  const onUp = () => {
    splitter.classList.remove("is-dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = browser.getBoundingClientRect().width;
    splitter.classList.add("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/* ---- Init ---- */
async function init() {
  installModalDismiss();
  installEditorBehaviors();
  installAutocompleteBehaviors();
  installConsoleBehaviors();
  installApiRefBehaviors();
  installFileManagerBehaviors();

  // Nav
  els.navSkills.addEventListener("click", () => setView("skills"));
  els.navEditor.addEventListener("click", () => setView("editor"));
  els.navFiles.addEventListener("click", () => setView("files"));

  // Editor bar actions
  els.backToSkills.addEventListener("click", () => setView("skills"));
  els.runButton.addEventListener("click", initiateRun);
  els.saveSkillButton.addEventListener("click", saveSkill);
  els.deleteSkillButton.addEventListener("click", deleteSkill);
  els.formatButton.addEventListener("click", normalizeEditorText);
  els.clearLogsButton.addEventListener("click", () => { els.logOutput.textContent = "No logs yet."; });

  // Skills view
  els.newSkillButton.addEventListener("click", () => { resetDraft(); setView("editor"); });
  els.skillSearch.addEventListener("input", renderSkillGrid);

  // Settings modal
  els.skillSettingsButton.addEventListener("click", () => openModal(els.settingsModal));
  els.skillRuntime.addEventListener("change", () => { state.skillRuntime = els.skillRuntime.value; });
  els.skillExecutionMode.addEventListener("change", () => { state.skillExecutionMode = els.skillExecutionMode.value; });
  els.skillInputsSchema.addEventListener("input", refreshSchemaFromEditor);

  // Run modal
  els.runModalExecute.addEventListener("click", executeRun);

  // Boot
  resetDraft();
  writeResult("No script executed yet.");
  writeLogs([]);
  setView("skills");
  connectEventStream();

  await Promise.all([refreshStatus(), refreshSkills()]);
  window.setInterval(async () => {
    await refreshStatus();
    if (state.activeJobId) await refreshJob(state.activeJobId);
  }, 3000);
}

init().catch((error) => writeResult(error.message, true));
