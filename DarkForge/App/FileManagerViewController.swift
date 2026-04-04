import UIKit

private final class NativeFileService {
    private let fm = FileManager.default
    private let maxEditBytes = 262_144

    struct Entry {
        let name: String
        let path: String
        let isDirectory: Bool
        let isLink: Bool
        let linkTargetIsDirectory: Bool
        let size: Int64
    }

    struct DirectoryListing {
        let path: String
        let parent: String
        let entries: [Entry]
    }

    enum ServiceError: LocalizedError {
        case notReady
        case readFailed(String)
        case writeFailed(String)
        case operationFailed(String)

        var errorDescription: String? {
            switch self {
            case .notReady:               return "Exploit hasn't run yet — no filesystem access."
            case .readFailed(let m):      return m
            case .writeFailed(let m):     return m
            case .operationFailed(let m): return m
            }
        }
    }

    var isReady: Bool { true }

    // MARK: - Directory listing

    func list(path: String) throws -> DirectoryListing {
        let resolvedPath = (path as NSString).standardizingPath
        let contents = try fm.contentsOfDirectory(atPath: resolvedPath)
        let sorted = contents.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        var entries: [Entry] = []
        for name in sorted {
            let fullPath = (resolvedPath as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: fullPath, isDirectory: &isDir) else { continue }

            let attrs = try? fm.attributesOfItem(atPath: fullPath)
            let fileType = attrs?[.type] as? FileAttributeType
            let isLink = fileType == .typeSymbolicLink

            var linkTargetIsDir = false
            if isLink {
                // isDirectory already follows the symlink, so it reflects the target
                linkTargetIsDir = isDir.boolValue
            }

            let size = (attrs?[.size] as? Int64) ?? 0

            entries.append(Entry(
                name: name,
                path: fullPath,
                isDirectory: isDir.boolValue,
                isLink: isLink,
                linkTargetIsDirectory: linkTargetIsDir,
                size: size
            ))
        }

        let parent: String
        if resolvedPath == "/" {
            parent = "/"
        } else {
            parent = (resolvedPath as NSString).deletingLastPathComponent
        }
        return DirectoryListing(path: resolvedPath, parent: parent, entries: entries)
    }

    // MARK: - File I/O

    func readText(path: String) throws -> String {
        let attrs = try fm.attributesOfItem(atPath: path)
        let size = (attrs[.size] as? Int64) ?? 0
        guard size <= maxEditBytes else {
            throw ServiceError.readFailed("File too large for in-app viewer (\(size) bytes, limit \(maxEditBytes)).")
        }
        do {
            return try String(contentsOfFile: path, encoding: .utf8)
        } catch {
            throw ServiceError.readFailed(error.localizedDescription)
        }
    }

    func writeText(path: String, text: String) throws {
        try agentExec("RootFS.writeText(\(jsLit(path)), \(jsLit(text)))", label: "writeText")
    }

    // MARK: - Mutations (via agent — needs root uid)

    func createDirectory(path: String) throws {
        try agentExec("RootFS.mkdir(\(jsLit(path)))", label: "mkdir")
    }

    func rename(source: String, destination: String) throws {
        try agentExec("RootFS.rename(\(jsLit(source)), \(jsLit(destination)))", label: "rename")
    }

    func delete(path: String) throws {
        try agentExec("RootFS.remove(\(jsLit(path)), true)", label: "delete")
    }

    // MARK: - Agent helpers

    @discardableResult
    private func agentExec(_ code: String, label: String) throws -> String {
        guard let result = RemoteExec.execute(code, timeout: 30) else {
            throw ServiceError.operationFailed("\(label): agent unavailable")
        }
        guard result.succeeded else {
            let detail = result.logs.isEmpty ? result.value : ([result.value] + result.logs).joined(separator: "\n")
            throw ServiceError.operationFailed("\(label): \(detail)")
        }
        return result.value
    }

    private func jsLit(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        return "\"\(escaped)\""
    }
}

final class FileManagerViewController: UIViewController {

    fileprivate struct Theme {
        static let bg = UIColor(red: 0x0d/255.0, green: 0x0d/255.0, blue: 0x12/255.0, alpha: 1.0)
        static let surface = UIColor(red: 0x16/255.0, green: 0x16/255.0, blue: 0x1f/255.0, alpha: 1.0)
        static let surfaceBorder = UIColor(red: 0x25/255.0, green: 0x25/255.0, blue: 0x30/255.0, alpha: 1.0)
        static let accent = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 1.0)
        static let accentDim = UIColor(red: 0x00/255.0, green: 0x80/255.0, blue: 0x55/255.0, alpha: 1.0)
        static let text = UIColor(red: 0xe0/255.0, green: 0xe0/255.0, blue: 0xe8/255.0, alpha: 1.0)
        static let textDim = UIColor(red: 0x70/255.0, green: 0x70/255.0, blue: 0x80/255.0, alpha: 1.0)
        static let textMuted = UIColor(red: 0x50/255.0, green: 0x50/255.0, blue: 0x5c/255.0, alpha: 1.0)
        static let dirColor = UIColor(red: 0x60/255.0, green: 0xca/255.0, blue: 0xff/255.0, alpha: 1.0)
        static let linkColor = UIColor(red: 0xff/255.0, green: 0xc8/255.0, blue: 0x57/255.0, alpha: 1.0)
        static let fileColor = UIColor(red: 0xb0/255.0, green: 0xb0/255.0, blue: 0xbc/255.0, alpha: 1.0)
        static let cellHover = UIColor(red: 0x1e/255.0, green: 0x1e/255.0, blue: 0x2a/255.0, alpha: 1.0)
        static let separator = UIColor(red: 0x1e/255.0, green: 0x1e/255.0, blue: 0x28/255.0, alpha: 1.0)
        static let danger = UIColor(red: 0xff/255.0, green: 0x72/255.0, blue: 0x72/255.0, alpha: 1.0)
    }

    private let service = NativeFileService()
    private var currentPath = "/"
    private var entries: [NativeFileService.Entry] = []
    private var isLoading = false

    private let headerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "File Manager"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let subtitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Native filesystem"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
        label.textColor = Theme.accentDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let pathCard: UIView = {
        let view = UIView()
        view.backgroundColor = Theme.surface
        view.layer.cornerRadius = 10
        view.layer.borderColor = Theme.surfaceBorder.cgColor
        view.layer.borderWidth = 1
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let pathLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        label.textColor = Theme.textDim
        label.lineBreakMode = .byTruncatingMiddle
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let navToolbar: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 10
        stack.distribution = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let actionToolbar: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 10
        stack.distribution = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let tableCard: UIView = {
        let view = UIView()
        view.backgroundColor = Theme.surface
        view.layer.cornerRadius = 14
        view.layer.borderColor = Theme.surfaceBorder.cgColor
        view.layer.borderWidth = 1
        view.clipsToBounds = true
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let tableView: UITableView = {
        let table = UITableView(frame: .zero, style: .plain)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.separatorColor = Theme.separator
        table.separatorInset = UIEdgeInsets(top: 0, left: 52, bottom: 0, right: 16)
        table.backgroundColor = .clear
        table.register(FileEntryCell.self, forCellReuseIdentifier: FileEntryCell.reuseID)
        return table
    }()

    private let emptyStateLabel: UILabel = {
        let label = UILabel()
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let statusLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textMuted
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRootFSReady(_:)),
                                               name: .darkForgeRootFSReady,
                                               object: nil)
        refreshAvailability()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    private func setupUI() {
        view.backgroundColor = Theme.bg
        tableView.delegate = self
        tableView.dataSource = self

        // Navigation row: Root, Up, Refresh
        navToolbar.addArrangedSubview(makeToolbarButton(title: "Root", icon: "house.fill", action: #selector(goHome)))
        navToolbar.addArrangedSubview(makeToolbarButton(title: "Up", icon: "arrow.up", action: #selector(goUp)))
        navToolbar.addArrangedSubview(makeToolbarButton(title: "Refresh", icon: "arrow.clockwise", action: #selector(refreshDirectory)))
        let navSpacer = UIView()
        navSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        navToolbar.addArrangedSubview(navSpacer)

        // Actions row: New Dir, New File
        actionToolbar.addArrangedSubview(makeToolbarButton(title: "New Folder", icon: "folder.badge.plus", action: #selector(createDirectory)))
        actionToolbar.addArrangedSubview(makeToolbarButton(title: "New File", icon: "doc.badge.plus", action: #selector(createFile)))
        let actionSpacer = UIView()
        actionSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        actionToolbar.addArrangedSubview(actionSpacer)

        view.addSubview(headerView)
        headerView.addSubview(titleLabel)
        headerView.addSubview(subtitleLabel)
        view.addSubview(pathCard)
        pathCard.addSubview(pathLabel)
        view.addSubview(navToolbar)
        view.addSubview(actionToolbar)
        view.addSubview(tableCard)
        tableCard.addSubview(tableView)
        tableCard.addSubview(emptyStateLabel)
        view.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            headerView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            headerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            headerView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            titleLabel.topAnchor.constraint(equalTo: headerView.topAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),
            subtitleLabel.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),
            subtitleLabel.bottomAnchor.constraint(equalTo: headerView.bottomAnchor),

            pathCard.topAnchor.constraint(equalTo: headerView.bottomAnchor, constant: 14),
            pathCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            pathCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            pathCard.heightAnchor.constraint(equalToConstant: 40),

            pathLabel.leadingAnchor.constraint(equalTo: pathCard.leadingAnchor, constant: 12),
            pathLabel.trailingAnchor.constraint(equalTo: pathCard.trailingAnchor, constant: -12),
            pathLabel.centerYAnchor.constraint(equalTo: pathCard.centerYAnchor),

            navToolbar.topAnchor.constraint(equalTo: pathCard.bottomAnchor, constant: 10),
            navToolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            navToolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            navToolbar.heightAnchor.constraint(equalToConstant: 38),

            actionToolbar.topAnchor.constraint(equalTo: navToolbar.bottomAnchor, constant: 8),
            actionToolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            actionToolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            actionToolbar.heightAnchor.constraint(equalToConstant: 38),

            tableCard.topAnchor.constraint(equalTo: actionToolbar.bottomAnchor, constant: 10),
            tableCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            tableCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            tableCard.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -6),

            tableView.topAnchor.constraint(equalTo: tableCard.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: tableCard.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: tableCard.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: tableCard.bottomAnchor),

            emptyStateLabel.centerXAnchor.constraint(equalTo: tableCard.centerXAnchor),
            emptyStateLabel.centerYAnchor.constraint(equalTo: tableCard.centerYAnchor),
            emptyStateLabel.leadingAnchor.constraint(greaterThanOrEqualTo: tableCard.leadingAnchor, constant: 24),
            emptyStateLabel.trailingAnchor.constraint(lessThanOrEqualTo: tableCard.trailingAnchor, constant: -24),

            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            statusLabel.heightAnchor.constraint(equalToConstant: 20)
        ])
    }

    private func makeToolbarButton(title: String, icon: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.title = title
        config.image = UIImage(systemName: icon, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold))
        config.imagePadding = 6
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 14, bottom: 8, trailing: 14)
        config.baseForegroundColor = Theme.text
        config.baseBackgroundColor = Theme.surface
        config.cornerStyle = .medium
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
            return outgoing
        }
        button.configuration = config
        button.layer.borderColor = Theme.surfaceBorder.cgColor
        button.layer.borderWidth = 1
        button.layer.cornerRadius = 10
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    @objc private func handleRootFSReady(_ note: Notification) {
        loadDirectory(path: currentPath)
    }

    private func refreshAvailability() {
        subtitleLabel.text = "Native filesystem"
        emptyStateLabel.isHidden = true
        loadDirectory(path: currentPath)
    }

    @objc private func goHome() {
        loadDirectory(path: "/")
    }

    @objc private func goUp() {
        guard currentPath != "/" else { return }
        let parent = (currentPath as NSString).deletingLastPathComponent
        loadDirectory(path: parent.isEmpty ? "/" : parent)
    }

    @objc private func refreshDirectory() {
        loadDirectory(path: currentPath)
    }

    @objc private func createDirectory() {
        presentNamePrompt(title: "New Directory", message: "Create a folder inside \(currentPath)", actionTitle: "Create") { [weak self] name in
            guard let self else { return }
            self.runFSOperation(startMessage: "Creating folder…") {
                try self.service.createDirectory(path: self.join(self.currentPath, name))
                return "Folder created"
            }
        }
    }

    @objc private func createFile() {
        presentNamePrompt(title: "New File", message: "Create a file inside \(currentPath)", actionTitle: "Create") { [weak self] name in
            guard let self else { return }
            self.runFSOperation(startMessage: "Creating file…") {
                try self.service.writeText(path: self.join(self.currentPath, name), text: "")
                return "File created"
            }
        }
    }

    private func loadDirectory(path: String) {
        isLoading = true
        statusLabel.text = "Loading \(path)…"
        emptyStateLabel.isHidden = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let listing = try self.service.list(path: path)
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.currentPath = listing.path
                    self.entries = listing.entries
                    self.pathLabel.text = listing.path
                    self.statusLabel.text = "\(listing.entries.count) items"
                    self.emptyStateLabel.text = listing.entries.isEmpty ? "This directory is empty." : nil
                    self.emptyStateLabel.isHidden = !listing.entries.isEmpty
                    self.tableView.reloadData()
                }
            } catch {
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.statusLabel.text = error.localizedDescription
                    self.emptyStateLabel.text = error.localizedDescription
                    self.emptyStateLabel.isHidden = false
                    self.entries = []
                    self.tableView.reloadData()
                }
            }
        }
    }

    private func runFSOperation(startMessage: String, work: @escaping () throws -> String) {
        statusLabel.text = startMessage
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let message = try work()
                DispatchQueue.main.async {
                    self.statusLabel.text = message
                    self.loadDirectory(path: self.currentPath)
                }
            } catch {
                DispatchQueue.main.async {
                    self.statusLabel.text = error.localizedDescription
                    self.presentSimpleAlert(title: "File Operation Failed", message: error.localizedDescription)
                }
            }
        }
    }

    private func presentRenamePrompt(for entry: NativeFileService.Entry) {
        presentNamePrompt(title: "Rename", message: entry.path, actionTitle: "Rename", defaultValue: entry.name) { [weak self] newName in
            guard let self else { return }
            self.runFSOperation(startMessage: "Renaming…") {
                let destination = self.join((entry.path as NSString).deletingLastPathComponent, newName)
                try self.service.rename(source: entry.path, destination: destination)
                return "Renamed"
            }
        }
    }

    private func presentDeletePrompt(for entry: NativeFileService.Entry) {
        let message: String
        if entry.isLink {
            message = "This removes the link only and leaves its target untouched."
        } else if entry.isDirectory {
            message = "This removes the directory recursively."
        } else {
            message = "This permanently removes the file."
        }
        let alert = UIAlertController(title: "Delete \(entry.name)?",
                                      message: message,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
            guard let self else { return }
            self.runFSOperation(startMessage: "Deleting…") {
                try self.service.delete(path: entry.path)
                return "Deleted"
            }
        })
        present(alert, animated: true)
    }

    private func presentNamePrompt(title: String, message: String, actionTitle: String, defaultValue: String = "", handler: @escaping (String) -> Void) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addTextField { textField in
            textField.text = defaultValue
            textField.placeholder = "name"
            textField.autocapitalizationType = .none
            textField.autocorrectionType = .no
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: actionTitle, style: .default) { _ in
            let name = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !name.isEmpty else { return }
            handler(name)
        })
        present(alert, animated: true)
    }

    private func presentSimpleAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private static let textExtensions: Set<String> = [
        "txt", "md", "json", "js", "ts", "jsx", "tsx", "css", "html", "htm", "xml",
        "yaml", "yml", "toml", "ini", "cfg", "conf", "sh", "bash", "zsh",
        "py", "rb", "lua", "swift", "m", "h", "c", "cpp", "hpp", "cs", "java",
        "kt", "go", "rs", "sql", "proto", "cmake", "make", "makefile",
        "plist", "entitlements", "strings", "log", "csv", "env", "diff", "patch",
    ]

    private func isTextFile(_ entry: NativeFileService.Entry) -> Bool {
        guard !entry.isDirectory else { return false }
        let ext = (entry.name as NSString).pathExtension.lowercased()
        if Self.textExtensions.contains(ext) { return true }
        // Extensionless files under 1MB are likely scripts/configs
        if ext.isEmpty && entry.size < 1_048_576 { return true }
        return false
    }

    private func shareFile(_ entry: NativeFileService.Entry) {
        let url = URL(fileURLWithPath: entry.path)
        let ac = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        ac.popoverPresentationController?.sourceView = view
        ac.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(ac, animated: true)
    }

    private func openFile(_ entry: NativeFileService.Entry) {
        guard isTextFile(entry) else {
            shareFile(entry)
            return
        }
        let editor = TextFileEditorViewController(service: service, path: entry.path)
        editor.onSave = { [weak self] in
            self?.loadDirectory(path: self?.currentPath ?? "/")
        }
        let nav = UINavigationController(rootViewController: editor)
        nav.modalPresentationStyle = .formSheet
        present(nav, animated: true)
    }

    private func join(_ base: String, _ name: String) -> String {
        if base == "/" { return "/" + name }
        return base + "/" + name
    }

    private func formatSize(_ bytes: Int64) -> String {
        let positive = max(0, bytes)
        if positive < 1024 { return "\(positive) B" }
        let kb = Double(positive) / 1024.0
        if kb < 1024 { return String(format: "%.1f KB", kb) }
        let mb = kb / 1024.0
        if mb < 1024 { return String(format: "%.1f MB", mb) }
        let gb = mb / 1024.0
        return String(format: "%.1f GB", gb)
    }
}

extension FileManagerViewController: UITableViewDataSource, UITableViewDelegate {

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        entries.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: FileEntryCell.reuseID, for: indexPath) as! FileEntryCell
        let entry = entries[indexPath.row]
        let detail: String
        if entry.isLink {
            detail = entry.linkTargetIsDirectory ? "LINK → DIR" : "LINK → FILE"
        } else if entry.isDirectory {
            detail = "DIR"
        } else {
            detail = formatSize(entry.size)
        }
        cell.configure(name: entry.name,
                       isDirectory: entry.isDirectory,
                       isLink: entry.isLink,
                       detail: detail)
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let entry = entries[indexPath.row]
        tableView.deselectRow(at: indexPath, animated: true)
        if entry.isDirectory {
            loadDirectory(path: entry.path)
        } else {
            openFile(entry)
        }
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        50
    }

    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let entry = entries[indexPath.row]
        let rename = UIContextualAction(style: .normal, title: "Rename") { [weak self] _, _, done in
            self?.presentRenamePrompt(for: entry)
            done(true)
        }
        rename.backgroundColor = Theme.accentDim

        let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
            self?.presentDeletePrompt(for: entry)
            done(true)
        }
        delete.backgroundColor = Theme.danger

        var actions = [delete, rename]
        if !entry.isDirectory {
            let share = UIContextualAction(style: .normal, title: "Share") { [weak self] _, _, done in
                self?.shareFile(entry)
                done(true)
            }
            share.backgroundColor = Theme.accent
            actions.append(share)
        }

        return UISwipeActionsConfiguration(actions: actions)
    }
}

private final class TextFileEditorViewController: UIViewController {

    var onSave: (() -> Void)?

    private let service: NativeFileService
    private let path: String
    private let textView = UITextView()
    private let statusLabel = UILabel()
    private var originalText = ""

    init(service: NativeFileService, path: String) {
        self.service = service
        self.path = path
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = FileManagerViewController.Theme.bg
        navigationItem.title = (path as NSString).lastPathComponent
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeSelf))
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "Reload", style: .plain, target: self, action: #selector(reloadFile)),
            UIBarButtonItem(title: "Save", style: .done, target: self, action: #selector(saveFile))
        ]

        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.backgroundColor = FileManagerViewController.Theme.surface
        textView.textColor = FileManagerViewController.Theme.text
        textView.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.autocapitalizationType = .none
        textView.autocorrectionType = .no

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        statusLabel.textColor = FileManagerViewController.Theme.textDim
        statusLabel.textAlignment = .center

        view.addSubview(textView)
        view.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            textView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -8),

            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            statusLabel.heightAnchor.constraint(equalToConstant: 20)
        ])

        reloadFile()
    }

    @objc private func closeSelf() {
        dismiss(animated: true)
    }

    @objc private func reloadFile() {
        statusLabel.text = "Loading…"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let text = try self.service.readText(path: self.path)
                let size = text.utf8.count
                DispatchQueue.main.async {
                    self.textView.text = text
                    self.originalText = text
                    self.statusLabel.text = "\(size) bytes"
                }
            } catch {
                DispatchQueue.main.async {
                    self.statusLabel.text = error.localizedDescription
                }
            }
        }
    }

    @objc private func saveFile() {
        let nextText = textView.text ?? ""
        statusLabel.text = "Saving…"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.service.writeText(path: self.path, text: nextText)
                DispatchQueue.main.async {
                    self.originalText = nextText
                    self.statusLabel.text = "Saved"
                    self.onSave?()
                }
            } catch {
                DispatchQueue.main.async {
                    self.statusLabel.text = error.localizedDescription
                }
            }
        }
    }
}

private final class FileEntryCell: UITableViewCell {
    static let reuseID = "FileEntryCell"

    private let iconView: UIImageView = {
        let imageView = UIImageView()
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()

    private let nameLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        label.textColor = FileManagerViewController.Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let detailLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        label.textColor = FileManagerViewController.Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        let selectedBg = UIView()
        selectedBg.backgroundColor = FileManagerViewController.Theme.cellHover
        selectedBackgroundView = selectedBg

        contentView.addSubview(iconView)
        contentView.addSubview(nameLabel)
        contentView.addSubview(detailLabel)

        NSLayoutConstraint.activate([
            iconView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 14),
            iconView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 22),
            iconView.heightAnchor.constraint(equalToConstant: 22),

            nameLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 12),
            nameLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: detailLabel.leadingAnchor, constant: -8),

            detailLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -14),
            detailLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(name: String, isDirectory: Bool, isLink: Bool, detail: String) {
        nameLabel.text = name
        detailLabel.text = detail
        if isLink {
            iconView.image = UIImage(systemName: "link.circle.fill")
            iconView.tintColor = FileManagerViewController.Theme.linkColor
        } else if isDirectory {
            iconView.image = UIImage(systemName: "folder.fill")
            iconView.tintColor = FileManagerViewController.Theme.dirColor
        } else {
            iconView.image = UIImage(systemName: "doc.text.fill")
            iconView.tintColor = FileManagerViewController.Theme.fileColor
        }
    }
}
