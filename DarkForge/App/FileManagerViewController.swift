import UIKit

// MARK: - NativeFileService

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

    // MARK: - Copy / Move

    func copy(source: String, destination: String) throws {
        let code = """
        (() => {
          const src = \(jsLit(source));
          const dst = \(jsLit(destination));
          const st = FileUtils.stat(src);
          if (!st) throw new Error("Source not found");
          if (st.isDirectory) {
            const copyDir = (s, d) => {
              FileUtils.createDir(d, 0o755);
              const items = FileUtils.listDir(s);
              for (const item of items) {
                const sp = s + "/" + item.name;
                const dp = d + "/" + item.name;
                if (item.isDirectory) copyDir(sp, dp);
                else {
                  const data = FileUtils.readFile(sp);
                  if (data) FileUtils.writeFile(dp, data);
                }
              }
            };
            copyDir(src, dst);
          } else {
            const data = FileUtils.readFile(src);
            if (data) FileUtils.writeFile(dst, data);
            else throw new Error("Read failed");
          }
          return JSON.stringify({ok: true});
        })()
        """
        try agentExec(code, label: "copy")
    }

    func chmod(path: String, mode: Int) throws {
        let code = "(() => { Native.writeString(Native.mem, \(jsLit(path))); const r = Native.callSymbol(\"chmod\", Native.mem, \(mode)); if (r !== 0) throw new Error(\"chmod failed: \" + r); return JSON.stringify({ok: true}); })()"
        try agentExec(code, label: "chmod")
    }

    func createSymlink(target: String, path: String) throws {
        let code = """
        (() => {
          const tgt = \(jsLit(target));
          const lnk = \(jsLit(path));
          const tgtBytes = Native.stringToBytes(tgt, true);
          const lnkBytes = Native.stringToBytes(lnk, true);
          Native.write(Native.mem, tgtBytes);
          const off = BigInt(tgtBytes.byteLength + 16) & ~BigInt(7);
          const lnkPtr = Native.mem + off;
          Native.write(lnkPtr, lnkBytes);
          const r = Native.callSymbol("symlink", Native.mem, lnkPtr);
          if (r !== 0) throw new Error("symlink failed: " + r);
          return JSON.stringify({ok: true});
        })()
        """
        try agentExec(code, label: "symlink")
    }

    func stat(path: String) throws -> String {
        return try agentExec("JSON.stringify(FileUtils.stat(\(jsLit(path))))", label: "stat")
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

// MARK: - FileManagerViewController

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

    // MARK: - Sort / Filter / Clipboard types

    private enum SortKey: String {
        case name, size, type
    }

    private enum CopyMode {
        case copy, cut
    }

    // MARK: - State

    private let service = NativeFileService()
    private var currentPath = "/"
    private var allEntries: [NativeFileService.Entry] = []
    private var isLoading = false

    private var sortKey: SortKey = .name
    private var sortAscending = true
    private var filterText = ""

    private var clipboard: (entry: NativeFileService.Entry, mode: CopyMode)?
    private var isMultiSelectMode = false
    private var selectedPaths = Set<String>()

    /// Filtered + sorted entries that feed the table view.
    private var displayEntries: [NativeFileService.Entry] {
        var result = allEntries

        // Filter
        if !filterText.isEmpty {
            let q = filterText.lowercased()
            result = result.filter { $0.name.lowercased().contains(q) }
        }

        // Sort — directories first, then by chosen key
        result.sort { a, b in
            if a.isDirectory != b.isDirectory { return a.isDirectory }
            switch sortKey {
            case .name:
                let cmp = a.name.localizedStandardCompare(b.name)
                return sortAscending ? cmp == .orderedAscending : cmp == .orderedDescending
            case .size:
                return sortAscending ? a.size < b.size : a.size > b.size
            case .type:
                let extA = (a.name as NSString).pathExtension.lowercased()
                let extB = (b.name as NSString).pathExtension.lowercased()
                if extA == extB {
                    let cmp = a.name.localizedStandardCompare(b.name)
                    return sortAscending ? cmp == .orderedAscending : cmp == .orderedDescending
                }
                return sortAscending ? extA < extB : extA > extB
            }
        }
        return result
    }

    // MARK: - UI elements

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "File Manager"
        label.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private lazy var editButton: UIButton = {
        let btn = UIButton(type: .system)
        btn.setTitle("Edit", for: .normal)
        btn.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        btn.setTitleColor(Theme.accent, for: .normal)
        btn.translatesAutoresizingMaskIntoConstraints = false
        btn.addTarget(self, action: #selector(toggleMultiSelect), for: .touchUpInside)
        return btn
    }()

    // Breadcrumb scroll view
    private let breadcrumbScrollView: UIScrollView = {
        let sv = UIScrollView()
        sv.translatesAutoresizingMaskIntoConstraints = false
        sv.showsHorizontalScrollIndicator = false
        sv.showsVerticalScrollIndicator = false
        sv.alwaysBounceHorizontal = true
        return sv
    }()

    private let breadcrumbStack: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 2
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    // Single merged toolbar
    private let toolbar: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 6
        stack.distribution = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    // Search / filter field
    private lazy var searchField: UITextField = {
        let tf = UITextField()
        tf.translatesAutoresizingMaskIntoConstraints = false
        tf.backgroundColor = Theme.surface
        tf.textColor = Theme.text
        tf.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        tf.attributedPlaceholder = NSAttributedString(
            string: "Filter files...",
            attributes: [.foregroundColor: Theme.textMuted, .font: UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)]
        )
        tf.layer.cornerRadius = 8
        tf.layer.borderColor = Theme.surfaceBorder.cgColor
        tf.layer.borderWidth = 1
        tf.autocapitalizationType = .none
        tf.autocorrectionType = .no
        tf.returnKeyType = .done

        // Magnifying glass icon on the left
        let iconView = UIImageView(image: UIImage(systemName: "magnifyingglass"))
        iconView.tintColor = Theme.textMuted
        iconView.contentMode = .scaleAspectFit
        iconView.frame = CGRect(x: 0, y: 0, width: 28, height: 16)
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 32, height: 16))
        iconView.center = CGPoint(x: 18, y: 8)
        container.addSubview(iconView)
        tf.leftView = container
        tf.leftViewMode = .always

        tf.addTarget(self, action: #selector(filterTextChanged(_:)), for: .editingChanged)
        tf.delegate = nil // we handle via target-action
        return tf
    }()

    private let tableCard: UIView = {
        let view = UIView()
        view.backgroundColor = Theme.surface
        view.layer.cornerRadius = 12
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
        table.separatorInset = UIEdgeInsets(top: 0, left: 48, bottom: 0, right: 14)
        table.backgroundColor = .clear
        table.register(FileEntryCell.self, forCellReuseIdentifier: FileEntryCell.reuseID)
        table.allowsMultipleSelectionDuringEditing = true
        return table
    }()

    private let emptyStateLabel: UILabel = {
        let label = UILabel()
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    // Paste bar (shown when clipboard has content)
    private let pasteBar: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = Theme.surface
        v.layer.borderColor = Theme.accent.cgColor
        v.layer.borderWidth = 1
        v.isHidden = true
        return v
    }()

    private let pasteLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        l.textColor = Theme.text
        l.lineBreakMode = .byTruncatingMiddle
        return l
    }()

    private lazy var pasteButton: UIButton = {
        let b = UIButton(type: .system)
        b.setTitle("Paste", for: .normal)
        b.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        b.setTitleColor(Theme.accent, for: .normal)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.addTarget(self, action: #selector(pasteClipboard), for: .touchUpInside)
        return b
    }()

    private lazy var pasteCancelButton: UIButton = {
        let b = UIButton(type: .system)
        b.setTitle("Cancel", for: .normal)
        b.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .regular)
        b.setTitleColor(Theme.textDim, for: .normal)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.addTarget(self, action: #selector(cancelClipboard), for: .touchUpInside)
        return b
    }()

    // Bulk action bar (shown during multi-select)
    private let bulkBar: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = Theme.surface
        v.layer.borderColor = Theme.surfaceBorder.cgColor
        v.layer.borderWidth = 1
        v.isHidden = true
        return v
    }()

    private let bulkCountLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .semibold)
        l.textColor = Theme.text
        l.text = "0 selected"
        return l
    }()

    private let statusLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textMuted
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    // Constraints that change when bars appear/hide
    private var tableBottomToStatus: NSLayoutConstraint!
    private var tableBottomToPaste: NSLayoutConstraint!
    private var tableBottomToBulk: NSLayoutConstraint!

    // MARK: - Lifecycle

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

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = Theme.bg
        tableView.delegate = self
        tableView.dataSource = self

        // Toolbar buttons (single row)
        toolbar.addArrangedSubview(makeToolbarButton(title: "Root", icon: "house.fill", action: #selector(goHome)))
        toolbar.addArrangedSubview(makeToolbarButton(title: "Up", icon: "arrow.up", action: #selector(goUp)))
        toolbar.addArrangedSubview(makeToolbarButton(title: "Refresh", icon: "arrow.clockwise", action: #selector(refreshDirectory)))
        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        toolbar.addArrangedSubview(spacer)
        toolbar.addArrangedSubview(makeToolbarButton(title: "Sort", icon: "arrow.up.arrow.down", action: #selector(showSortMenu)))
        toolbar.addArrangedSubview(makeToolbarButton(title: "Folder", icon: "folder.badge.plus", action: #selector(createDirectory)))
        toolbar.addArrangedSubview(makeToolbarButton(title: "File", icon: "doc.badge.plus", action: #selector(createFile)))
        toolbar.addArrangedSubview(makeToolbarButton(title: "Link", icon: "link.badge.plus", action: #selector(createSymlink)))

        // Breadcrumb
        breadcrumbScrollView.addSubview(breadcrumbStack)

        // Add subviews
        view.addSubview(titleLabel)
        view.addSubview(editButton)
        view.addSubview(breadcrumbScrollView)
        view.addSubview(toolbar)
        view.addSubview(searchField)
        view.addSubview(tableCard)
        tableCard.addSubview(tableView)
        tableCard.addSubview(emptyStateLabel)
        view.addSubview(pasteBar)
        pasteBar.addSubview(pasteLabel)
        pasteBar.addSubview(pasteButton)
        pasteBar.addSubview(pasteCancelButton)
        view.addSubview(bulkBar)
        setupBulkBar()
        view.addSubview(statusLabel)

        // Constraints
        tableBottomToStatus = tableCard.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -4)
        tableBottomToPaste = tableCard.bottomAnchor.constraint(equalTo: pasteBar.topAnchor, constant: -2)
        tableBottomToBulk = tableCard.bottomAnchor.constraint(equalTo: bulkBar.topAnchor, constant: -2)

        NSLayoutConstraint.activate([
            // Title + Edit button
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),

            editButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            editButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),

            // Breadcrumb
            breadcrumbScrollView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 6),
            breadcrumbScrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            breadcrumbScrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            breadcrumbScrollView.heightAnchor.constraint(equalToConstant: 28),

            breadcrumbStack.topAnchor.constraint(equalTo: breadcrumbScrollView.topAnchor),
            breadcrumbStack.leadingAnchor.constraint(equalTo: breadcrumbScrollView.leadingAnchor),
            breadcrumbStack.trailingAnchor.constraint(equalTo: breadcrumbScrollView.trailingAnchor),
            breadcrumbStack.bottomAnchor.constraint(equalTo: breadcrumbScrollView.bottomAnchor),
            breadcrumbStack.heightAnchor.constraint(equalTo: breadcrumbScrollView.heightAnchor),

            // Toolbar
            toolbar.topAnchor.constraint(equalTo: breadcrumbScrollView.bottomAnchor, constant: 6),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            toolbar.heightAnchor.constraint(equalToConstant: 30),

            // Search field
            searchField.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 6),
            searchField.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            searchField.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            searchField.heightAnchor.constraint(equalToConstant: 32),

            // Table card
            tableCard.topAnchor.constraint(equalTo: searchField.bottomAnchor, constant: 6),
            tableCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            tableCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            tableBottomToStatus,

            tableView.topAnchor.constraint(equalTo: tableCard.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: tableCard.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: tableCard.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: tableCard.bottomAnchor),

            emptyStateLabel.centerXAnchor.constraint(equalTo: tableCard.centerXAnchor),
            emptyStateLabel.centerYAnchor.constraint(equalTo: tableCard.centerYAnchor),
            emptyStateLabel.leadingAnchor.constraint(greaterThanOrEqualTo: tableCard.leadingAnchor, constant: 24),
            emptyStateLabel.trailingAnchor.constraint(lessThanOrEqualTo: tableCard.trailingAnchor, constant: -24),

            // Paste bar
            pasteBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            pasteBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            pasteBar.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -4),
            pasteBar.heightAnchor.constraint(equalToConstant: 36),

            pasteLabel.leadingAnchor.constraint(equalTo: pasteBar.leadingAnchor, constant: 10),
            pasteLabel.centerYAnchor.constraint(equalTo: pasteBar.centerYAnchor),
            pasteLabel.trailingAnchor.constraint(lessThanOrEqualTo: pasteButton.leadingAnchor, constant: -8),

            pasteCancelButton.trailingAnchor.constraint(equalTo: pasteBar.trailingAnchor, constant: -10),
            pasteCancelButton.centerYAnchor.constraint(equalTo: pasteBar.centerYAnchor),

            pasteButton.trailingAnchor.constraint(equalTo: pasteCancelButton.leadingAnchor, constant: -10),
            pasteButton.centerYAnchor.constraint(equalTo: pasteBar.centerYAnchor),

            // Bulk bar
            bulkBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            bulkBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            bulkBar.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -4),
            bulkBar.heightAnchor.constraint(equalToConstant: 36),

            // Status
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            statusLabel.heightAnchor.constraint(equalToConstant: 18)
        ])
    }

    private func setupBulkBar() {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 8
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        stack.addArrangedSubview(bulkCountLabel)
        let bulkSpacer = UIView()
        bulkSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        stack.addArrangedSubview(bulkSpacer)

        let copyAll = makeBulkButton(title: "Copy", action: #selector(bulkCopy))
        let cutAll = makeBulkButton(title: "Cut", action: #selector(bulkCut))
        let deleteAll = makeBulkButton(title: "Delete", color: Theme.danger, action: #selector(bulkDelete))
        let doneBtn = makeBulkButton(title: "Done", action: #selector(toggleMultiSelect))

        stack.addArrangedSubview(copyAll)
        stack.addArrangedSubview(cutAll)
        stack.addArrangedSubview(deleteAll)
        stack.addArrangedSubview(doneBtn)

        bulkBar.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: bulkBar.leadingAnchor, constant: 10),
            stack.trailingAnchor.constraint(equalTo: bulkBar.trailingAnchor, constant: -10),
            stack.centerYAnchor.constraint(equalTo: bulkBar.centerYAnchor),
        ])
    }

    private func makeBulkButton(title: String, color: UIColor = Theme.accent, action: Selector) -> UIButton {
        let btn = UIButton(type: .system)
        btn.setTitle(title, for: .normal)
        btn.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
        btn.setTitleColor(color, for: .normal)
        btn.addTarget(self, action: action, for: .touchUpInside)
        return btn
    }

    private func makeToolbarButton(title: String, icon: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.title = title
        config.image = UIImage(systemName: icon, withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold))
        config.imagePadding = 4
        config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 10)
        config.baseForegroundColor = Theme.text
        config.baseBackgroundColor = Theme.surface
        config.cornerStyle = .medium
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
            return outgoing
        }
        button.configuration = config
        button.layer.borderColor = Theme.surfaceBorder.cgColor
        button.layer.borderWidth = 1
        button.layer.cornerRadius = 8
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    // MARK: - Breadcrumbs

    private func updateBreadcrumbs() {
        breadcrumbStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        let components = currentPath.split(separator: "/", omittingEmptySubsequences: true)
        // Root "/"
        let rootBtn = makeBreadcrumbButton(title: "/", targetPath: "/", isCurrent: components.isEmpty)
        breadcrumbStack.addArrangedSubview(rootBtn)

        var built = ""
        for (i, comp) in components.enumerated() {
            let sep = UILabel()
            sep.text = "/"
            sep.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
            sep.textColor = Theme.textMuted
            sep.setContentHuggingPriority(.required, for: .horizontal)
            breadcrumbStack.addArrangedSubview(sep)

            built += "/\(comp)"
            let isLast = i == components.count - 1
            let btn = makeBreadcrumbButton(title: String(comp), targetPath: built, isCurrent: isLast)
            breadcrumbStack.addArrangedSubview(btn)
        }

        // Scroll to end
        DispatchQueue.main.async {
            let rightEdge = self.breadcrumbScrollView.contentSize.width - self.breadcrumbScrollView.bounds.width
            if rightEdge > 0 {
                self.breadcrumbScrollView.setContentOffset(CGPoint(x: rightEdge, y: 0), animated: false)
            }
        }
    }

    private func makeBreadcrumbButton(title: String, targetPath: String, isCurrent: Bool) -> UIButton {
        let btn = UIButton(type: .system)
        var config = UIButton.Configuration.plain()
        config.title = title
        config.contentInsets = NSDirectionalEdgeInsets(top: 2, leading: 4, bottom: 2, trailing: 4)
        config.baseForegroundColor = isCurrent ? Theme.accent : Theme.textDim
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.monospacedSystemFont(ofSize: 12, weight: isCurrent ? .bold : .regular)
            return outgoing
        }
        btn.configuration = config
        btn.setContentHuggingPriority(.required, for: .horizontal)
        btn.addAction(UIAction { [weak self] _ in
            self?.loadDirectory(path: targetPath)
        }, for: .touchUpInside)
        return btn
    }

    // MARK: - Bottom bar management

    private func updateBottomBars() {
        let showPaste = clipboard != nil && !isMultiSelectMode
        let showBulk = isMultiSelectMode

        pasteBar.isHidden = !showPaste
        bulkBar.isHidden = !showBulk

        tableBottomToStatus.isActive = false
        tableBottomToPaste.isActive = false
        tableBottomToBulk.isActive = false

        if showBulk {
            tableBottomToBulk.isActive = true
        } else if showPaste {
            tableBottomToPaste.isActive = true
        } else {
            tableBottomToStatus.isActive = true
        }

        view.layoutIfNeeded()
    }

    // MARK: - Event handlers

    @objc private func handleRootFSReady(_ note: Notification) {
        loadDirectory(path: currentPath)
    }

    private func refreshAvailability() {
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

    @objc private func filterTextChanged(_ sender: UITextField) {
        filterText = sender.text ?? ""
        tableView.reloadData()
        let displayed = displayEntries.count
        emptyStateLabel.text = displayed == 0 ? (filterText.isEmpty ? "This directory is empty." : "No matches.") : nil
        emptyStateLabel.isHidden = displayed > 0
    }

    // MARK: - Sort

    @objc private func showSortMenu() {
        let sheet = UIAlertController(title: "Sort By", message: nil, preferredStyle: .actionSheet)
        let keys: [(SortKey, String)] = [(.name, "Name"), (.size, "Size"), (.type, "Type")]
        for (key, label) in keys {
            let arrow = sortKey == key ? (sortAscending ? " (A-Z)" : " (Z-A)") : ""
            let check = sortKey == key ? " *" : ""
            sheet.addAction(UIAlertAction(title: label + arrow + check, style: .default) { [weak self] _ in
                guard let self else { return }
                if self.sortKey == key {
                    self.sortAscending.toggle()
                } else {
                    self.sortKey = key
                    self.sortAscending = true
                }
                self.tableView.reloadData()
            })
        }
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }

    // MARK: - Create

    @objc private func createDirectory() {
        presentNamePrompt(title: "New Directory", message: "Create a folder inside \(currentPath)", actionTitle: "Create") { [weak self] name in
            guard let self else { return }
            self.runFSOperation(startMessage: "Creating folder...") {
                try self.service.createDirectory(path: self.join(self.currentPath, name))
                return "Folder created"
            }
        }
    }

    @objc private func createFile() {
        presentNamePrompt(title: "New File", message: "Create a file inside \(currentPath)", actionTitle: "Create") { [weak self] name in
            guard let self else { return }
            self.runFSOperation(startMessage: "Creating file...") {
                try self.service.writeText(path: self.join(self.currentPath, name), text: "")
                return "File created"
            }
        }
    }

    @objc private func createSymlink() {
        let alert = UIAlertController(title: "New Symlink", message: "Create a symbolic link in \(currentPath)", preferredStyle: .alert)
        alert.addTextField { tf in
            tf.placeholder = "Target path (e.g. /var/mobile/...)"
            tf.autocapitalizationType = .none
            tf.autocorrectionType = .no
        }
        alert.addTextField { tf in
            tf.placeholder = "Link name"
            tf.autocapitalizationType = .none
            tf.autocorrectionType = .no
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Create", style: .default) { [weak self] _ in
            guard let self else { return }
            let target = alert.textFields?[0].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let name = alert.textFields?[1].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !target.isEmpty, !name.isEmpty else { return }
            self.runFSOperation(startMessage: "Creating symlink...") {
                try self.service.createSymlink(target: target, path: self.join(self.currentPath, name))
                return "Symlink created"
            }
        })
        present(alert, animated: true)
    }

    // MARK: - Clipboard (Copy/Cut/Paste)

    private func setClipboard(entry: NativeFileService.Entry, mode: CopyMode) {
        clipboard = (entry, mode)
        let icon = mode == .copy ? "Copied" : "Cut"
        pasteLabel.text = "\(icon): \(entry.name)"
        updateBottomBars()
    }

    @objc private func cancelClipboard() {
        clipboard = nil
        updateBottomBars()
    }

    @objc private func pasteClipboard() {
        guard let clip = clipboard else { return }
        let entry = clip.entry
        let mode = clip.mode
        clipboard = nil
        updateBottomBars()

        let destDir = currentPath
        var destName = entry.name
        let destPath = join(destDir, destName)

        // Check for conflict
        if FileManager.default.fileExists(atPath: destPath) && mode == .copy {
            let ext = (destName as NSString).pathExtension
            let base = (destName as NSString).deletingPathExtension
            if ext.isEmpty {
                destName = base + " (copy)"
            } else {
                destName = base + " (copy)." + ext
            }
        }

        let finalDest = join(destDir, destName)

        runFSOperation(startMessage: mode == .copy ? "Copying..." : "Moving...") {
            if mode == .copy {
                try self.service.copy(source: entry.path, destination: finalDest)
                return "Copied"
            } else {
                try self.service.rename(source: entry.path, destination: finalDest)
                return "Moved"
            }
        }
    }

    // MARK: - Multi-select

    @objc private func toggleMultiSelect() {
        isMultiSelectMode.toggle()
        selectedPaths.removeAll()
        tableView.setEditing(isMultiSelectMode, animated: true)
        editButton.setTitle(isMultiSelectMode ? "Done" : "Edit", for: .normal)
        updateBulkCount()
        updateBottomBars()
    }

    private func updateBulkCount() {
        bulkCountLabel.text = "\(selectedPaths.count) selected"
    }

    @objc private func bulkCopy() {
        guard let first = selectedEntries().first else { return }
        if selectedEntries().count == 1 {
            setClipboard(entry: first, mode: .copy)
        }
        // For multiple items, copy them one by one to current dir
        let items = selectedEntries()
        exitMultiSelect()
        guard items.count > 1 else { return }
        runFSOperation(startMessage: "Copying \(items.count) items...") {
            for item in items {
                var destName = item.name
                let destPath = self.join(self.currentPath, destName)
                if FileManager.default.fileExists(atPath: destPath) {
                    let ext = (destName as NSString).pathExtension
                    let base = (destName as NSString).deletingPathExtension
                    destName = ext.isEmpty ? base + " (copy)" : base + " (copy)." + ext
                }
                try self.service.copy(source: item.path, destination: self.join(self.currentPath, destName))
            }
            return "Copied \(items.count) items"
        }
    }

    @objc private func bulkCut() {
        guard let first = selectedEntries().first else { return }
        if selectedEntries().count == 1 {
            setClipboard(entry: first, mode: .cut)
            exitMultiSelect()
            return
        }
        // Multiple cut: store them all — but our clipboard model is single item,
        // so we just do a move operation immediately (not really "cut" to clipboard).
        let items = selectedEntries()
        exitMultiSelect()
        // Ask where to move?
        presentNamePrompt(title: "Move \(items.count) items", message: "Enter destination directory path", actionTitle: "Move", defaultValue: currentPath) { [weak self] dest in
            guard let self else { return }
            self.runFSOperation(startMessage: "Moving \(items.count) items...") {
                for item in items {
                    let target = self.join(dest, item.name)
                    try self.service.rename(source: item.path, destination: target)
                }
                return "Moved \(items.count) items"
            }
        }
    }

    @objc private func bulkDelete() {
        let items = selectedEntries()
        guard !items.isEmpty else { return }
        let alert = UIAlertController(title: "Delete \(items.count) items?",
                                      message: "This cannot be undone.",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
            guard let self else { return }
            self.exitMultiSelect()
            self.runFSOperation(startMessage: "Deleting \(items.count) items...") {
                for item in items {
                    try self.service.delete(path: item.path)
                }
                return "Deleted \(items.count) items"
            }
        })
        present(alert, animated: true)
    }

    private func selectedEntries() -> [NativeFileService.Entry] {
        return displayEntries.filter { selectedPaths.contains($0.path) }
    }

    private func exitMultiSelect() {
        isMultiSelectMode = false
        selectedPaths.removeAll()
        tableView.setEditing(false, animated: true)
        editButton.setTitle("Edit", for: .normal)
        updateBottomBars()
    }

    // MARK: - Permissions (chmod)

    private func presentChmodPrompt(for entry: NativeFileService.Entry) {
        let alert = UIAlertController(title: "Set Permissions", message: entry.path, preferredStyle: .alert)
        alert.addTextField { tf in
            tf.text = "0755"
            tf.placeholder = "Octal mode (e.g. 0755)"
            tf.keyboardType = .numberPad
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Apply", style: .default) { [weak self] _ in
            guard let self else { return }
            let text = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard let mode = Int(text, radix: 8) else {
                self.presentSimpleAlert(title: "Invalid Mode", message: "Enter an octal value like 0755.")
                return
            }
            self.runFSOperation(startMessage: "Setting permissions...") {
                try self.service.chmod(path: entry.path, mode: mode)
                return "Permissions set to \(text)"
            }
        })
        present(alert, animated: true)
    }

    // MARK: - Directory loading

    private func loadDirectory(path: String) {
        isLoading = true
        statusLabel.text = "Loading \(path)..."
        emptyStateLabel.isHidden = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let listing = try self.service.list(path: path)
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.currentPath = listing.path
                    self.allEntries = listing.entries
                    self.statusLabel.text = "\(listing.entries.count) items"
                    let displayed = self.displayEntries
                    self.emptyStateLabel.text = displayed.isEmpty ? "This directory is empty." : nil
                    self.emptyStateLabel.isHidden = !displayed.isEmpty
                    self.tableView.reloadData()
                    self.updateBreadcrumbs()
                }
            } catch {
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.statusLabel.text = error.localizedDescription
                    self.emptyStateLabel.text = error.localizedDescription
                    self.emptyStateLabel.isHidden = false
                    self.allEntries = []
                    self.tableView.reloadData()
                    self.updateBreadcrumbs()
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

    // MARK: - Prompts

    private func presentRenamePrompt(for entry: NativeFileService.Entry) {
        presentNamePrompt(title: "Rename", message: entry.path, actionTitle: "Rename", defaultValue: entry.name) { [weak self] newName in
            guard let self else { return }
            self.runFSOperation(startMessage: "Renaming...") {
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
            self.runFSOperation(startMessage: "Deleting...") {
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

    // MARK: - File utilities

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
        let editor = TextFileEditorViewController(service: service, entry: entry)
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

// MARK: - UITableView DataSource & Delegate

extension FileManagerViewController: UITableViewDataSource, UITableViewDelegate {

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        displayEntries.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: FileEntryCell.reuseID, for: indexPath) as! FileEntryCell
        let entry = displayEntries[indexPath.row]
        let detail: String
        if entry.isLink {
            detail = entry.linkTargetIsDirectory ? "LINK -> DIR" : "LINK -> FILE"
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
        let entry = displayEntries[indexPath.row]
        if isMultiSelectMode {
            selectedPaths.insert(entry.path)
            updateBulkCount()
            return
        }
        tableView.deselectRow(at: indexPath, animated: true)
        if entry.isDirectory {
            loadDirectory(path: entry.path)
        } else {
            openFile(entry)
        }
    }

    func tableView(_ tableView: UITableView, didDeselectRowAt indexPath: IndexPath) {
        if isMultiSelectMode {
            let entry = displayEntries[indexPath.row]
            selectedPaths.remove(entry.path)
            updateBulkCount()
        }
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        44
    }

    // MARK: - Trailing swipe: Delete, Rename, Share, Copy Path, Permissions

    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard !isMultiSelectMode else { return nil }
        let entry = displayEntries[indexPath.row]

        let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
            self?.presentDeletePrompt(for: entry)
            done(true)
        }
        delete.backgroundColor = Theme.danger

        let rename = UIContextualAction(style: .normal, title: "Rename") { [weak self] _, _, done in
            self?.presentRenamePrompt(for: entry)
            done(true)
        }
        rename.backgroundColor = Theme.accentDim

        let copyPath = UIContextualAction(style: .normal, title: "Path") { _, _, done in
            UIPasteboard.general.string = entry.path
            done(true)
        }
        copyPath.backgroundColor = Theme.textDim

        let perms = UIContextualAction(style: .normal, title: "chmod") { [weak self] _, _, done in
            self?.presentChmodPrompt(for: entry)
            done(true)
        }
        perms.backgroundColor = UIColor(red: 0.4, green: 0.4, blue: 0.6, alpha: 1.0)

        var actions = [delete, rename, copyPath, perms]
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

    // MARK: - Leading swipe: Copy, Cut

    func tableView(_ tableView: UITableView, leadingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard !isMultiSelectMode else { return nil }
        let entry = displayEntries[indexPath.row]

        let copy = UIContextualAction(style: .normal, title: "Copy") { [weak self] _, _, done in
            self?.setClipboard(entry: entry, mode: .copy)
            done(true)
        }
        copy.backgroundColor = Theme.accent

        let cut = UIContextualAction(style: .normal, title: "Cut") { [weak self] _, _, done in
            self?.setClipboard(entry: entry, mode: .cut)
            done(true)
        }
        cut.backgroundColor = Theme.accentDim

        return UISwipeActionsConfiguration(actions: [copy, cut])
    }
}

// MARK: - TextFileEditorViewController

private final class TextFileEditorViewController: UIViewController {

    var onSave: (() -> Void)?

    private let service: NativeFileService
    private let path: String
    private let entrySize: Int64
    private let textView = UITextView()
    private let statusLabel = UILabel()
    private var originalText = ""

    init(service: NativeFileService, entry: NativeFileService.Entry) {
        self.service = service
        self.path = entry.path
        self.entrySize = entry.size
        super.init(nibName: nil, bundle: nil)
    }

    init(service: NativeFileService, path: String) {
        self.service = service
        self.path = path
        self.entrySize = 0
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
        statusLabel.text = "Loading..."
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let text = try self.service.readText(path: self.path)
                let size = text.utf8.count

                // Try to get modification date
                let attrs = try? FileManager.default.attributesOfItem(atPath: self.path)
                let modDate = attrs?[.modificationDate] as? Date
                let dateStr: String
                if let d = modDate {
                    let fmt = DateFormatter()
                    fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
                    dateStr = " | mod: \(fmt.string(from: d))"
                } else {
                    dateStr = ""
                }

                DispatchQueue.main.async {
                    self.textView.text = text
                    self.originalText = text
                    self.statusLabel.text = "\(size) bytes\(dateStr)"
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
        statusLabel.text = "Saving..."
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

// MARK: - FileEntryCell

private final class FileEntryCell: UITableViewCell {
    static let reuseID = "FileEntryCell"

    private let iconView: UIImageView = {
        let imageView = UIImageView()
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()

    private let nameLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = FileManagerViewController.Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let detailLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
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
        tintColor = FileManagerViewController.Theme.accent

        contentView.addSubview(iconView)
        contentView.addSubview(nameLabel)
        contentView.addSubview(detailLabel)

        NSLayoutConstraint.activate([
            iconView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            iconView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 20),
            iconView.heightAnchor.constraint(equalToConstant: 20),

            nameLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 10),
            nameLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: detailLabel.leadingAnchor, constant: -6),

            detailLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
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
