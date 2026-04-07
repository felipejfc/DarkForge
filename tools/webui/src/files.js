import { TEXT_EXTENSIONS, UPLOAD_CHUNK_SIZE } from "./catalog.js";
import { confirmAction, els, requestJson, showToast, state } from "./shared.js";

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
  els.filePasteButton.disabled = disabled || !state.fileClipboard;
  els.fileNewLinkButton.disabled = disabled;
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

  const cutPaths = (state.fileClipboard && state.fileClipboard.mode === "cut")
    ? new Set(state.fileClipboard.entries.map(e => e.path))
    : null;

  entries.forEach((entry, idx) => {
    const fragment = els.fileItemTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".file-item");
    const icon = fragment.querySelector(".file-item-icon");
    const name = fragment.querySelector(".file-item-name");
    const sizeEl = fragment.querySelector(".file-item-size");
    const typeEl = fragment.querySelector(".file-item-type");

    // Prepend checkbox for multi-select
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "file-item-check";
    check.checked = state.fileMultiSelect.includes(entry.path);
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMultiSelect(entry, e.shiftKey);
    });
    button.prepend(check);

    button.dataset.index = idx;
    button.classList.toggle("is-active", state.fileSelection?.path === entry.path);
    if (idx === state.fileFocusIndex) button.classList.add("is-focused");
    if (cutPaths && cutPaths.has(entry.path)) button.classList.add("is-cut");
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
      // Fetch stat for permissions info
      fetchStatForPreview(entry);
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
    case "copy":
      copyToClipboard([entry], "copy");
      break;
    case "cut":
      copyToClipboard([entry], "cut");
      break;
    case "moveto":
      moveToPrompt(entry);
      break;
    case "permissions":
      showPermissions(entry);
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
    state.fileMultiSelect = [];
    updateBulkBar();
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
  const confirmed = await confirmAction({
    title: isDir ? "Delete directory" : "Delete file",
    message,
    confirmLabel: isDir ? "Delete directory" : "Delete file",
  });
  if (!confirmed) return;
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

// ---- Clipboard (Copy/Cut/Paste) ----

function copyToClipboard(entries, mode) {
  state.fileClipboard = { entries: [...entries], mode };
  els.filePasteButton.disabled = false;
  showToast(mode === "cut" ? `Cut ${entries.length} item(s)` : `Copied ${entries.length} item(s)`, "info");
  renderFileList();
}

function addCopySuffix(name) {
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    return name.slice(0, dot) + " (copy)" + name.slice(dot);
  }
  return name + " (copy)";
}

async function pasteFromClipboard() {
  if (!state.fileClipboard) return;
  const { entries, mode } = state.fileClipboard;
  setFileBusy(true);
  setFileStatus(`${mode === "cut" ? "Moving" : "Copying"} ${entries.length} item(s)…`, "running");
  try {
    for (const entry of entries) {
      let destName = entry.name;
      if (state.fileEntries.some(e => e.name === destName)) {
        destName = mode === "copy" ? addCopySuffix(entry.name) : entry.name;
      }
      const destination = joinFsPath(state.fileCurrentPath, destName);
      if (mode === "cut") {
        await fsRequest("move", { path: entry.path, destination });
      } else {
        await fsRequest("copy", { path: entry.path, destination });
      }
    }
    if (mode === "cut") state.fileClipboard = null;
    els.filePasteButton.disabled = !state.fileClipboard;
    await loadDirectory(state.fileCurrentPath);
    showToast(`${mode === "cut" ? "Moved" : "Copied"} ${entries.length} item(s)`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

// ---- Multi-select ----

function toggleMultiSelect(entry, shiftKey) {
  const idx = state.fileMultiSelect.findIndex(p => p === entry.path);
  if (shiftKey && state.fileMultiSelect.length > 0) {
    const entries = getFilteredSortedEntries();
    const lastPath = state.fileMultiSelect[state.fileMultiSelect.length - 1];
    const lastIdx = entries.findIndex(e => e.path === lastPath);
    const curIdx = entries.findIndex(e => e.path === entry.path);
    const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
    for (let i = from; i <= to; i++) {
      if (!state.fileMultiSelect.includes(entries[i].path)) {
        state.fileMultiSelect.push(entries[i].path);
      }
    }
  } else if (idx >= 0) {
    state.fileMultiSelect.splice(idx, 1);
  } else {
    state.fileMultiSelect.push(entry.path);
  }
  updateBulkBar();
  renderFileList();
}

function updateBulkBar() {
  const count = state.fileMultiSelect.length;
  els.fileBulkBar.hidden = count === 0;
  els.fileBulkCount.textContent = `${count} item${count === 1 ? "" : "s"} selected`;
}

function clearMultiSelect() {
  state.fileMultiSelect = [];
  updateBulkBar();
  renderFileList();
}

function getSelectedEntries() {
  return state.fileEntries.filter(e => state.fileMultiSelect.includes(e.path));
}

async function bulkDeleteSelected() {
  const selected = getSelectedEntries();
  if (selected.length === 0) return;
  const confirmed = await confirmAction({
    title: "Delete selected",
    message: `Delete ${selected.length} item(s)? This cannot be undone.`,
    confirmLabel: `Delete ${selected.length} item(s)`,
  });
  if (!confirmed) return;
  setFileBusy(true);
  setFileStatus(`Deleting ${selected.length} item(s)…`, "running");
  try {
    for (const entry of selected) {
      await fsRequest("delete", { path: entry.path, recursive: true });
    }
    clearMultiSelect();
    resetFileSelection();
    await loadDirectory(state.fileCurrentPath);
    showToast(`Deleted ${selected.length} item(s)`, "info");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

// ---- Permissions (chmod) ----

async function showPermissions(entry) {
  const mode = window.prompt("Set permissions (octal, e.g. 0755)", "0755");
  if (!mode) return;
  const parsed = parseInt(mode, 8);
  if (isNaN(parsed) || parsed < 0 || parsed > 0o7777) {
    showToast("Invalid octal permissions", "error");
    return;
  }
  setFileBusy(true);
  try {
    await fsRequest("chmod", { path: entry.path, mode: parsed });
    showToast(`Permissions set to ${mode}`, "success");
    await loadDirectory(state.fileCurrentPath);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

// ---- Stat for preview permissions ----

async function fetchStatForPreview(entry) {
  try {
    const stat = await fsRequest("stat", { path: entry.path });
    let meta = entry.path;
    if (entry.isDirectory) {
      meta += " · Directory";
    } else {
      meta += ` · ${formatFileSize(entry.size)}` + (isTextFile(entry) ? "" : " · Binary");
    }
    if (stat.mode != null) {
      meta += ` · ${("0000" + stat.mode.toString(8)).slice(-4)}`;
    }
    if (stat.owner) {
      meta += ` · ${stat.owner}`;
    }
    if (stat.modified) {
      const d = new Date(stat.modified);
      if (!isNaN(d.getTime())) {
        meta += ` · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
      }
    }
    // Only update if this entry is still selected
    if (state.fileSelection?.path === entry.path) {
      els.filePreviewMeta.textContent = meta;
    }
  } catch {
    // stat not supported or failed; keep existing meta
  }
}

// ---- Move to ----

async function moveToPrompt(entry) {
  const dest = window.prompt("Move to (full path)", entry.path);
  if (!dest || dest === entry.path) return;
  setFileBusy(true);
  setFileStatus("Moving…", "running");
  try {
    await fsRequest("move", { path: entry.path, destination: dest.trim() });
    resetFileSelection();
    await loadDirectory(state.fileCurrentPath);
    showToast(`Moved to ${dest.trim()}`, "success");
  } catch (error) {
    setFileStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    setFileBusy(false);
  }
}

// ---- Symlink creation ----

async function promptNewLink() {
  const target = window.prompt("Symlink target path");
  if (!target) return;
  const name = window.prompt("Link name");
  if (!name) return;
  setFileBusy(true);
  setFileStatus("Creating symlink…", "running");
  try {
    await fsRequest("symlink", { target: target.trim(), path: joinFsPath(state.fileCurrentPath, name.trim()) });
    await loadDirectory(state.fileCurrentPath);
    showToast(`Created link ${name}`, "success");
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
  els.filePasteButton.addEventListener("click", pasteFromClipboard);
  els.fileNewLinkButton.addEventListener("click", promptNewLink);

  // Bulk action bar
  els.fileBulkCopy.addEventListener("click", () => {
    const selected = getSelectedEntries();
    if (selected.length) copyToClipboard(selected, "copy");
  });
  els.fileBulkCut.addEventListener("click", () => {
    const selected = getSelectedEntries();
    if (selected.length) copyToClipboard(selected, "cut");
  });
  els.fileBulkDelete.addEventListener("click", bulkDeleteSelected);
  els.fileBulkDeselect.addEventListener("click", clearMultiSelect);
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

    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key === "c") {
      event.preventDefault();
      const selected = getSelectedEntries();
      if (selected.length) copyToClipboard(selected, "copy");
      else if (state.fileSelection) copyToClipboard([state.fileSelection], "copy");
    } else if (mod && event.key === "x") {
      event.preventDefault();
      const selected = getSelectedEntries();
      if (selected.length) copyToClipboard(selected, "cut");
      else if (state.fileSelection) copyToClipboard([state.fileSelection], "cut");
    } else if (mod && event.key === "v") {
      event.preventDefault();
      pasteFromClipboard();
    } else if (mod && event.key === "a") {
      event.preventDefault();
      state.fileMultiSelect = entries.map(e => e.path);
      updateBulkBar();
      renderFileList();
    } else if (event.key === "ArrowDown") {
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
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "f") {
      event.preventDefault();
      els.fileSearchInput.focus();
      els.fileSearchInput.select();
    }
    // Global Ctrl/Cmd+V for paste when in files view
    if (mod && event.key === "v" && document.activeElement !== els.fileEditor && document.activeElement !== els.filePathInput && document.activeElement !== els.fileSearchInput) {
      event.preventDefault();
      pasteFromClipboard();
    }
  });

  installFileSplitter();
}

export { loadDirectory };
