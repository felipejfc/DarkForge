export const API_CATALOG = [
  { name: "log", signature: "log(msg)", category: "Globals", description: "Log a message to the console", snippet: 'log("hello");' },
  { name: "Native.callSymbol", signature: "Native.callSymbol(name, x0..x7)", category: "Native", description: "Call C function by dlsym name", snippet: 'const pid = Native.callSymbol("getpid");' },
  { name: "Native.callSymbolRetain", signature: "Native.callSymbolRetain(name, x0..x7)", category: "Native", description: "Call with ObjC object retention", snippet: 'const obj = Native.callSymbolRetain("objc_msgSend", cls, sel);' },
  { name: "Native.read", signature: "Native.read(ptr, length)", category: "Native", description: "Read bytes from address", snippet: 'const buf = Native.read(ptr, 64);' },
  { name: "Native.readPtr", signature: "Native.readPtr(ptr)", category: "Native", description: "Read 64-bit pointer value", snippet: 'const val = Native.readPtr(ptr);' },
  { name: "Native.readString", signature: "Native.readString(ptr, len?)", category: "Native", description: "Read null-terminated C string", snippet: 'const str = Native.readString(ptr);' },
  { name: "Native.write", signature: "Native.write(ptr, buff)", category: "Native", description: "Write ArrayBuffer to address", snippet: "Native.write(ptr, data);" },
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
  { name: "FileUtils.close", signature: "FileUtils.close(fd)", category: "FileUtils", description: "Close file descriptor", snippet: "FileUtils.close(fd);" },
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

export const API_CATEGORIES = [];
const seenCategories = new Set();
for (const item of API_CATALOG) {
  if (!seenCategories.has(item.category)) {
    seenCategories.add(item.category);
    API_CATEGORIES.push(item.category);
  }
}

export const DEFAULT_SCRIPT = `// JSCBridge scratchpad
log("bridge online");

const pid = Native.callSymbol("getpid");
log("launchd pid: " + pid);

({
  pid: String(pid),
  when: new Date().toISOString()
});
`;

export const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "js", "ts", "jsx", "tsx", "css", "html", "htm", "xml",
  "yaml", "yml", "toml", "ini", "cfg", "conf", "sh", "bash", "zsh", "fish",
  "py", "rb", "pl", "lua", "swift", "m", "h", "c", "cpp", "hpp", "cs", "java",
  "kt", "go", "rs", "zig", "r", "sql", "graphql", "proto", "cmake", "make",
  "makefile", "dockerfile", "gitignore", "gitattributes", "env", "log", "csv",
  "tsv", "plist", "entitlements", "pbxproj", "xcscheme", "strings", "storyboard",
  "xib", "modulemap", "def", "map", "lock", "patch", "diff",
]);

export const UPLOAD_CHUNK_SIZE = 512 * 1024;
