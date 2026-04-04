import { TEXT_EXTENSIONS, UPLOAD_CHUNK_SIZE } from "./catalog.js";
import { els, requestJson, showToast, state } from "./shared.js";

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
  if (bytes == null || bytes < 0) return "—";
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
  if (entry.isLink) return entry.linkTargetIsDirectory ? "link→dir" : "link";
  if (entry.isDirectory) return "dir";
  const ext = fileExtension(entry.name);
  return ext || "file";
}

function isTextFile(entry) {
  if (entry.isDirectory) return false;
  const ext = fileExtension(entry.name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext && entry.size < 1048576) return true;
  return false;
}

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
  for (let index = 0; index < parts.length; index++) {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep";
    sep.textContent = "/";
    els.fileBreadcrumbs.append(sep);
    accumulated += "/" + parts[index];
    addSeg(parts[index], accumulated, index === parts.length - 1);
  }

  els.fileBreadcrumbs.scrollLeft = els.fileBreadcrumbs.scrollWidth;
}

function getFilteredSortedEntries() {
  let entries = state.fileEntries;
  if (state.fileFilter) {
    const query = state.fileFilter.toLowerCase();
    entries = entries.filter((entry) => entry.name.toLowerCase().includes(query));
  }

  const direction = state.fileSortAsc ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    switch (state.fileSortKey) {
      case "size":
        return ((a.size || 0) - (b.size || 0)) * direction;
      case "type":
        return fileTypeLabel(a).localeCompare(fileTypeLabel(b)) * direction;
      default:
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction;
    }
  });
}

function updateSortHeader() {
  els.fileSortHeader.querySelectorAll(".file-sort-col").forEach((col) => {
    const key = col.dataset.sort;
    const active = key === state.fileSortKey;
    col.classList.toggle("is-active", active);
    const arrow = col.querySelector(".sort-arrow");
    arrow.textContent = active ? (state.fileSortAsc ? "↓" : "↑") : "";
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
  els.fileListMeta.textContent = state.fileFilter ? `${entries.length}/${total}` : `${total} items`;

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
    icon.textContent = entry.isLink ? "↗" : (entry.isDirectory ? "▣" : "·");
    icon.classList.toggle("is-file", !entry.isDirectory);
    icon.classList.toggle("is-link", !!entry.isLink);
    name.textContent = entry.name;
    sizeEl.textContent = entry.isDirectory ? "—" : formatFileSize(entry.size);
    typeEl.textContent = fileTypeLabel(entry);

    button.addEventListener("click", () => {
      state.fileFocusIndex = idx;
      state.fileSelection = entry;
      els.filePreviewTitle.textContent = entry.name;
      if (entry.isDirectory) {
        els.filePreviewMeta.textContent = `${entry.path} · Directory`;
      } else {
        els.filePreviewMeta.textContent = `${entry.path} · ${formatFileSize(entry.size)}` + (isTextFile(entry) ? "" : " · Binary");
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

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFileContextMenu(event.clientX, event.clientY, entry);
    });

    els.fileList.append(fragment);
  });
}

let contextMenuEntry = null;

function showFileContextMenu(x, y, entry) {
  contextMenuEntry = entry;
  const menu = els.fileContextMenu;
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
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

async function downloadFile(entry) {
  if (!entry || entry.isDirectory) return;
  setFileBusy(true);
  setFileStatus(`Downloading ${entry.name}…`, "running");
  try {
    const response = await fetch("/api/fs/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entry.path }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
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

function copySelectionPath() {
  if (!state.fileSelection) return;
  navigator.clipboard.writeText(state.fileSelection.path).then(() => showToast("Path copied", "info"));
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
  if (!state.connected) {
    setFileStatus("Waiting for device", "error");
    return;
  }
  setFileBusy(true);
  setFileStatus(`Listing ${path}…`, "running");
  try {
    const listing = await fsRequest("list", { path });
    state.fileCurrentPath = listing.path;
    state.fileEntries = listing.entries || [];
    state.fileFocusIndex = -1;
    els.filePathInput.value = listing.path;
    if (state.fileSelection && !state.fileEntries.find((entry) => entry.path === state.fileSelection.path)) {
      resetFileSelection();
    }
    renderBreadcrumbs();
    renderFileList();
    setFileStatus(`Ready · ${state.fileEntries.length} items`);
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
  setFileStatus(`Reading ${entry.name}…`, "running");
  try {
    const payload = await fsRequest("read", { path: entry.path, maxBytes: 262144 });
    state.fileSelection = entry;
    state.fileLoadedText = payload.text || "";
    els.filePreviewTitle.textContent = entry.name;
    els.filePreviewMeta.textContent = `${payload.path} · ${formatFileSize(Math.max(0, payload.size || 0))}`;
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
  setFileStatus(`Saving ${state.fileSelection.name}…`, "running");
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
  setFileStatus("Creating folder…", "running");
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
  setFileStatus("Creating file…", "running");
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
  setFileStatus("Renaming…", "running");
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
  const message = isDir
    ? `Delete directory "${label}" and all its contents? This cannot be undone.`
    : `Delete "${label}"? This cannot be undone.`;
  if (!window.confirm(message)) return;
  setFileBusy(true);
  setFileStatus("Deleting…", "running");
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
  for (let index = 0; index < totalChunks; index++) {
    const offset = index * UPLOAD_CHUNK_SIZE;
    const chunkSize = Math.min(UPLOAD_CHUNK_SIZE, file.size - offset);
    const base64 = await readChunkAsBase64(file, offset, chunkSize);
    await fsRequest("write_base64", {
      path: destPath,
      data: base64,
      append: index > 0,
    });
  }
}

async function uploadFiles(files) {
  if (!files || files.length === 0) return;
  if (!state.connected) {
    showToast("Device not connected", "error");
    return;
  }
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
      completed += 1;
      showUploadProgress(completed < total ? `Uploading (${completed}/${total})...` : "Done", (completed / total) * 100);
    }

    const message = total === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${total} files`;
    setFileStatus(message);
    showToast(message, "success");
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

function navigateUp() {
  if (state.fileCurrentPath === "/") return;
  const parts = state.fileCurrentPath.split("/").filter(Boolean);
  parts.pop();
  loadDirectory(`/${parts.join("/")}`);
}

function scrollFocusedIntoView() {
  const focused = els.fileList.querySelector(".is-focused");
  if (focused) focused.scrollIntoView({ block: "nearest" });
}

function installFileSplitter() {
  const splitter = els.fileSplitter;
  const browser = els.fileBrowserPanel;
  let startX;
  let startWidth;

  const onMove = (event) => {
    const dx = event.clientX - startX;
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

  splitter.addEventListener("mousedown", (event) => {
    event.preventDefault();
    startX = event.clientX;
    startWidth = browser.getBoundingClientRect().width;
    splitter.classList.add("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

export function handleConnectionLoss() {
  state.fileEntries = [];
  renderFileList();
  resetFileSelection();
  setFileStatus("Waiting for device", "error");
}

export function installFileManagerBehaviors() {
  resetFileSelection();
  setFileStatus("Idle");
  renderBreadcrumbs();

  els.fileRefreshButton.addEventListener("click", () => loadDirectory(state.fileCurrentPath));
  els.fileRootButton.addEventListener("click", () => loadDirectory("/"));
  els.fileUpButton.addEventListener("click", navigateUp);
  els.fileNewFolderButton.addEventListener("click", promptNewFolder);
  els.fileNewFileButton.addEventListener("click", promptNewFile);
  els.fileUploadButton.addEventListener("click", () => els.fileUploadInput.click());
  els.fileUploadInput.addEventListener("change", () => uploadFiles(Array.from(els.fileUploadInput.files)));
  els.fileCopyPathButton.addEventListener("click", copySelectionPath);
  els.fileDownloadButton.addEventListener("click", () => {
    if (state.fileSelection && !state.fileSelection.isDirectory) downloadFile(state.fileSelection);
  });

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
  els.filePathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadDirectory(els.filePathInput.value || "/");
      els.filePathInput.hidden = true;
      els.fileBreadcrumbs.hidden = false;
      els.fileEditPathButton.textContent = "Edit";
    } else if (event.key === "Escape") {
      els.filePathInput.hidden = true;
      els.fileBreadcrumbs.hidden = false;
      els.fileEditPathButton.textContent = "Edit";
    }
  });

  els.fileSearchInput.addEventListener("input", () => {
    state.fileFilter = els.fileSearchInput.value.trim();
    state.fileFocusIndex = -1;
    renderFileList();
  });

  els.fileSortHeader.addEventListener("click", (event) => {
    const col = event.target.closest("[data-sort]");
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

  const dropZone = els.fileBrowser;
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    if (event.dataTransfer.files.length) uploadFiles(Array.from(event.dataTransfer.files));
  });

  els.fileRenameButton.addEventListener("click", renameSelection);
  els.fileDeleteButton.addEventListener("click", deleteSelection);
  els.fileReloadButton.addEventListener("click", () => {
    if (state.fileSelection && !state.fileSelection.isDirectory && isTextFile(state.fileSelection)) {
      openFileEntry(state.fileSelection);
    }
  });
  els.fileSaveButton.addEventListener("click", saveOpenFile);

  els.fileEditor.addEventListener("input", () => {
    if (!state.fileSelection || state.fileSelection.isDirectory) return;
    const dirty = els.fileEditor.value !== state.fileLoadedText;
    setFileStatus(dirty ? "Unsaved changes" : `Loaded ${state.fileSelection.name}`, dirty ? "running" : "");
  });

  document.addEventListener("click", (event) => {
    if (!els.fileContextMenu.contains(event.target)) hideFileContextMenu();
  });
  els.fileContextMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-action]");
    if (item) handleContextMenuAction(item.dataset.action);
  });

  els.fileList.addEventListener("keydown", (event) => {
    const entries = getFilteredSortedEntries();
    if (!entries.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.fileFocusIndex = Math.min(state.fileFocusIndex + 1, entries.length - 1);
      renderFileList();
      scrollFocusedIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.fileFocusIndex = Math.max(state.fileFocusIndex - 1, 0);
      renderFileList();
      scrollFocusedIntoView();
    } else if (event.key === "Enter" && state.fileFocusIndex >= 0) {
      event.preventDefault();
      const entry = entries[state.fileFocusIndex];
      if (entry.isDirectory) loadDirectory(entry.path);
      else if (isTextFile(entry)) openFileEntry(entry);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      navigateUp();
    } else if (event.key === "Delete" && state.fileFocusIndex >= 0) {
      event.preventDefault();
      state.fileSelection = entries[state.fileFocusIndex];
      deleteSelection();
    } else if (event.key === "F2" && state.fileFocusIndex >= 0) {
      event.preventDefault();
      state.fileSelection = entries[state.fileFocusIndex];
      renameSelection();
    } else if (event.key === "F5") {
      event.preventDefault();
      loadDirectory(state.fileCurrentPath);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (state.activeView !== "files") return;
    if (event.key === "F5") {
      event.preventDefault();
      loadDirectory(state.fileCurrentPath);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "f") {
      event.preventDefault();
      els.fileSearchInput.focus();
      els.fileSearchInput.select();
    }
  });

  installFileSplitter();
}

export { loadDirectory };
