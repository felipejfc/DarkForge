import UIKit

// MARK: - Remote Execution Helper

/// Unified JS execution: tries local bridge first, falls back to agent TCP.
enum RemoteExec {

    struct Result {
        let succeeded: Bool
        let value: String
        let logs: [String]
    }

    /// Execute JS code via the agent TCP connection. Must be called from a background thread.
    static func execute(_ code: String, timeout: TimeInterval = 120) -> Result? {
        return executeViaAgent(code, timeout: timeout)
    }

    static var isAvailable: Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var tv = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(ServerConfiguration.localAgentPort).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let ok = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return ok == 0
    }

    private static func executeViaAgent(_ code: String, timeout: TimeInterval) -> Result? {
        let port = ServerConfiguration.localAgentPort
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }

        // Connect timeout
        var connectTv = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &connectTv, socklen_t(MemoryLayout<timeval>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(port).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let connectResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connectResult == 0 else { return nil }

        // Set read timeout for the response wait
        var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        // Read the initial "alive" message and discard
        var buf = [UInt8](repeating: 0, count: 4096)
        let _ = read(fd, &buf, buf.count)

        // Send exec command as JSON + newline
        let msgId = UUID().uuidString
        let request: [String: Any] = ["type": "exec", "id": msgId, "code": code]
        guard let requestData = try? JSONSerialization.data(withJSONObject: request),
              let requestStr = String(data: requestData, encoding: .utf8) else { return nil }
        let line = requestStr + "\n"
        let sent = line.withCString { ptr in write(fd, ptr, line.utf8.count) }
        guard sent > 0 else { return nil }

        // Read response — may come in chunks, look for newline-terminated JSON
        var accumulated = Data()
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            var readBuf = [UInt8](repeating: 0, count: 65536)
            let n = read(fd, &readBuf, readBuf.count)
            if n <= 0 { break }
            accumulated.append(contentsOf: readBuf[..<n])

            // Response is newline-terminated — try parsing
            if let str = String(data: accumulated, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               !str.isEmpty,
               let jsonData = str.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
               let type = json["type"] as? String, type == "exec_result" {
                let ok = json["ok"] as? Bool ?? false
                let value = (json["value"] as? String) ?? (json["error"] as? String) ?? ""
                let logs = (json["logs"] as? [String]) ?? []
                return Result(succeeded: ok, value: value, logs: logs)
            }
        }
        return nil
    }
}

// MARK: - Installed App Model

struct InstalledAppInfo: Decodable {
    let name: String
    let bundleId: String
    let bundlePath: String

    var isSystemApp: Bool {
        bundlePath.hasPrefix("/Applications/")
    }
}

// MARK: - InstalledAppService

final class InstalledAppService {

    enum ServiceError: LocalizedError {
        case bridgeUnavailable
        case executionFailed(String)
        case decodeFailed(String)

        var errorDescription: String? {
            switch self {
            case .bridgeUnavailable: return "JSCBridge is not active."
            case .executionFailed(let msg): return msg
            case .decodeFailed(let msg): return "Decode failed: \(msg)"
            }
        }
    }

    static func fetchApps(completion: @escaping (Result<[InstalledAppInfo], Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let code = """
            (() => {
                const apps = Apps.listInstalled({ forceRefresh: true });
                return JSON.stringify(apps.map(a => ({
                    name: a.name,
                    bundleId: a.bundleId,
                    bundlePath: a.bundlePath
                })));
            })()
            """

            let result = RemoteExec.execute(code, timeout: 60)

            DispatchQueue.main.async {
                guard let result, result.succeeded else {
                    let msg = result?.value ?? "Agent not reachable"
                    completion(.failure(ServiceError.executionFailed(msg)))
                    return
                }
                guard let data = result.value.data(using: .utf8) else {
                    completion(.failure(ServiceError.decodeFailed("Empty response")))
                    return
                }
                do {
                    let apps = try JSONDecoder().decode([InstalledAppInfo].self, from: data)
                    completion(.success(apps))
                } catch {
                    completion(.failure(ServiceError.decodeFailed(error.localizedDescription)))
                }
            }
        }
    }
}

// MARK: - Skill Data Model

private struct SkillDefinition: Decodable {
    let name: String
    let summary: String
    let runtime: String
    let executionMode: String
    let entryFile: String?
    let inputs: [SkillInput]

    struct SkillInput: Decodable {
        let id: String
        let label: String
        let type: String          // "text", "boolean", "select", "textarea", "app"
        let required: Bool?
        let defaultValue: SkillDefault?
        let placeholder: String?
        let options: [SkillOption]?

        struct SkillOption: Decodable {
            let value: String
            let label: String

            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let value = try? container.decode(String.self) {
                    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.value = trimmed
                    self.label = trimmed
                    return
                }

                let option = try container.decode(OptionObject.self)
                let trimmedValue = option.value.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedLabel = (option.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                self.value = trimmedValue
                self.label = trimmedLabel.isEmpty ? trimmedValue : trimmedLabel
            }

            private struct OptionObject: Decodable {
                let value: String
                let label: String?
            }
        }

        enum SkillDefault: Decodable {
            case string(String)
            case bool(Bool)

            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let b = try? container.decode(Bool.self) { self = .bool(b); return }
                if let s = try? container.decode(String.self) { self = .string(s); return }
                self = .string("")
            }

            var stringValue: String {
                switch self {
                case .string(let s): return s
                case .bool(let b): return b ? "true" : "false"
                }
            }

            var boolValue: Bool {
                switch self {
                case .bool(let b): return b
                case .string(let s): return s == "true" || s == "1"
                }
            }
        }
    }
}

// MARK: - Theme

private struct Theme {
    static let bg = UIColor(red: 0x0d/255.0, green: 0x0d/255.0, blue: 0x12/255.0, alpha: 1.0)
    static let surface = UIColor(red: 0x16/255.0, green: 0x16/255.0, blue: 0x1f/255.0, alpha: 1.0)
    static let surfaceHover = UIColor(red: 0x1c/255.0, green: 0x1c/255.0, blue: 0x28/255.0, alpha: 1.0)
    static let surfaceBorder = UIColor(red: 0x25/255.0, green: 0x25/255.0, blue: 0x30/255.0, alpha: 1.0)
    static let accent = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 1.0)
    static let accentDim = UIColor(red: 0x00/255.0, green: 0x80/255.0, blue: 0x55/255.0, alpha: 1.0)
    static let text = UIColor(red: 0xe0/255.0, green: 0xe0/255.0, blue: 0xe8/255.0, alpha: 1.0)
    static let textDim = UIColor(red: 0x70/255.0, green: 0x70/255.0, blue: 0x80/255.0, alpha: 1.0)
    static let textMuted = UIColor(red: 0x50/255.0, green: 0x50/255.0, blue: 0x5c/255.0, alpha: 1.0)
    static let separator = UIColor(red: 0x1e/255.0, green: 0x1e/255.0, blue: 0x28/255.0, alpha: 1.0)
    static let danger = UIColor(red: 0xff/255.0, green: 0x72/255.0, blue: 0x72/255.0, alpha: 1.0)
    static let purple = UIColor(red: 0xa7/255.0, green: 0x8b/255.0, blue: 0xfa/255.0, alpha: 1.0)
    static let blue = UIColor(red: 0x60/255.0, green: 0xca/255.0, blue: 0xff/255.0, alpha: 1.0)
    static let orange = UIColor(red: 0xff/255.0, green: 0xa0/255.0, blue: 0x5c/255.0, alpha: 1.0)

    static func modeColor(for mode: String) -> UIColor {
        mode == "interactive" ? blue : purple
    }

    static func skillIcon(for name: String) -> (String, UIColor) {
        let lower = name.lowercased()
        if lower.contains("decrypt") || lower.contains("ipa") { return ("lock.open.fill", orange) }
        if lower.contains("list") || lower.contains("app") { return ("square.grid.2x2.fill", blue) }
        if lower.contains("dump") || lower.contains("export") { return ("arrow.down.doc.fill", accent) }
        if lower.contains("inject") || lower.contains("hook") { return ("syringe.fill", danger) }
        if lower.contains("zip") || lower.contains("pack") { return ("doc.zipper", purple) }
        return ("bolt.circle.fill", purple)
    }
}

// MARK: - SkillsViewController

final class SkillsViewController: UIViewController {

    private var skills: [(json: String, definition: SkillDefinition)] = []

    private let headerStack: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let titleRow: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 10
        return stack
    }()

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Skills"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textColor = Theme.text
        return label
    }()

    private let countBadge: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .bold)
        label.textColor = Theme.bg
        label.backgroundColor = Theme.accent
        label.textAlignment = .center
        label.layer.cornerRadius = 10
        label.clipsToBounds = true
        return label
    }()

    private let subtitleLabel: UILabel = {
        let label = UILabel()
        label.text = "JSCBridge runtime"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
        label.textColor = Theme.accentDim
        return label
    }()

    private let accentLine: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let tableView: UITableView = {
        let table = UITableView(frame: .zero, style: .plain)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.separatorStyle = .none
        table.backgroundColor = .clear
        table.showsVerticalScrollIndicator = false
        table.contentInset = UIEdgeInsets(top: 4, left: 0, bottom: 16, right: 0)
        table.register(SkillCell.self, forCellReuseIdentifier: SkillCell.reuseID)
        return table
    }()

    private let emptyLabel: UILabel = {
        let label = UILabel()
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadSkills()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    private func setupUI() {
        view.backgroundColor = Theme.bg
        tableView.delegate = self
        tableView.dataSource = self

        titleRow.addArrangedSubview(titleLabel)
        titleRow.addArrangedSubview(countBadge)
        titleRow.addArrangedSubview(UIView()) // spacer
        headerStack.addArrangedSubview(titleRow)
        headerStack.addArrangedSubview(subtitleLabel)

        view.addSubview(headerStack)
        view.addSubview(accentLine)
        view.addSubview(tableView)
        view.addSubview(emptyLabel)

        // Gradient accent line
        let gradient = CAGradientLayer()
        gradient.colors = [Theme.accent.cgColor, Theme.accent.withAlphaComponent(0).cgColor]
        gradient.startPoint = CGPoint(x: 0, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        accentLine.layer.addSublayer(gradient)
        accentLine.tag = 999 // for layout callback

        NSLayoutConstraint.activate([
            headerStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            headerStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            headerStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            accentLine.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 12),
            accentLine.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            accentLine.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            accentLine.heightAnchor.constraint(equalToConstant: 1),

            tableView.topAnchor.constraint(equalTo: accentLine.bottomAnchor, constant: 8),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),

            emptyLabel.centerXAnchor.constraint(equalTo: tableView.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: tableView.centerYAnchor, constant: -20),
            emptyLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),
            emptyLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -40),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if let gradient = accentLine.layer.sublayers?.first as? CAGradientLayer {
            gradient.frame = accentLine.bounds
        }
        // Size the count badge
        let text = countBadge.text ?? ""
        let width = max(20, text.size(withAttributes: [.font: countBadge.font!]).width + 14)
        countBadge.frame.size = CGSize(width: width, height: 20)
        countBadge.widthAnchor.constraint(equalToConstant: width).isActive = false
    }

    private func loadSkills() {
        skills = []
        guard let skillURLs = Bundle.main.urls(forResourcesWithExtension: "json", subdirectory: "skills") else {
            emptyLabel.text = "No skills found in bundle."
            emptyLabel.isHidden = false
            countBadge.text = "0"
            tableView.reloadData()
            return
        }
        let decoder = JSONDecoder()
        for url in skillURLs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard let data = try? Data(contentsOf: url),
                  let def = try? decoder.decode(SkillDefinition.self, from: data) else { continue }
            let jsonName = url.deletingPathExtension().lastPathComponent
            skills.append((json: jsonName, definition: def))
        }
        emptyLabel.text = skills.isEmpty ? "No skills available." : nil
        emptyLabel.isHidden = !skills.isEmpty
        countBadge.text = "\(skills.count)"
        // Constrain badge width
        countBadge.translatesAutoresizingMaskIntoConstraints = false
        let badgeWidth = max(20, "\(skills.count)".size(withAttributes: [.font: countBadge.font!]).width + 14)
        for c in countBadge.constraints where c.firstAttribute == .width { c.isActive = false }
        countBadge.widthAnchor.constraint(equalToConstant: badgeWidth).isActive = true
        countBadge.heightAnchor.constraint(equalToConstant: 20).isActive = true
        tableView.reloadData()
    }

    private func runSkill(_ skill: (json: String, definition: SkillDefinition), inputs: [String: Any]) {
        guard let entryFile = skill.definition.entryFile else {
            presentAlert(title: "No Entry File", message: "This skill has no entryFile defined.")
            return
        }
        guard let jsURL = Bundle.main.url(forResource: entryFile.replacingOccurrences(of: ".js", with: ""),
                                           withExtension: "js",
                                           subdirectory: "skills"),
              let jsCode = try? String(contentsOf: jsURL, encoding: .utf8) else {
            presentAlert(title: "Missing JS", message: "Could not load \(entryFile) from bundle.")
            return
        }

        let inputJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: inputs, options: []),
           let str = String(data: data, encoding: .utf8) {
            inputJSON = str
        } else {
            inputJSON = "{}"
        }
        let wrappedCode = "var skillInput = \(inputJSON);\n\(jsCode)"

        let resultVC = SkillResultViewController(skillName: skill.definition.name, code: wrappedCode)
        let nav = UINavigationController(rootViewController: resultVC)
        nav.modalPresentationStyle = .formSheet
        styleNavBar(nav)
        present(nav, animated: true)
    }

    private func presentInputForm(for skill: (json: String, definition: SkillDefinition)) {
        let inputs = skill.definition.inputs
        if inputs.isEmpty {
            runSkill(skill, inputs: [:])
            return
        }
        let formVC = SkillInputFormViewController(skill: skill.definition) { [weak self] values in
            self?.runSkill(skill, inputs: values)
        }
        let nav = UINavigationController(rootViewController: formVC)
        nav.modalPresentationStyle = .formSheet
        styleNavBar(nav)
        present(nav, animated: true)
    }

    private func styleNavBar(_ nav: UINavigationController) {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = Theme.surface
        appearance.titleTextAttributes = [.foregroundColor: Theme.text, .font: UIFont.systemFont(ofSize: 17, weight: .semibold)]
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.tintColor = Theme.accent
    }

    private func presentAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - Table View

extension SkillsViewController: UITableViewDataSource, UITableViewDelegate {

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        skills.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: SkillCell.reuseID, for: indexPath) as! SkillCell
        let skill = skills[indexPath.row]
        cell.configure(name: skill.definition.name,
                       summary: skill.definition.summary,
                       inputCount: skill.definition.inputs.count,
                       mode: skill.definition.executionMode)
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: false)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        presentInputForm(for: skills[indexPath.row])
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        UITableView.automaticDimension
    }

    func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
        88
    }
}

// MARK: - Skill Cell

private final class SkillCell: UITableViewCell {
    static let reuseID = "SkillCell"

    private let card: UIView = {
        let view = UIView()
        view.backgroundColor = Theme.surface
        view.layer.cornerRadius = 14
        view.layer.borderColor = Theme.surfaceBorder.cgColor
        view.layer.borderWidth = 1
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let accentBar: UIView = {
        let view = UIView()
        view.layer.cornerRadius = 1.5
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let iconCircle: UIView = {
        let view = UIView()
        view.layer.cornerRadius = 18
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let iconView: UIImageView = {
        let iv = UIImageView()
        iv.translatesAutoresizingMaskIntoConstraints = false
        iv.contentMode = .scaleAspectFit
        return iv
    }()

    private let nameLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let summaryLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        label.textColor = Theme.textDim
        label.numberOfLines = 2
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let modePill: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .bold)
        label.textAlignment = .center
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let inputsLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textMuted
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let chevron: UIImageView = {
        let iv = UIImageView(image: UIImage(systemName: "chevron.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)))
        iv.tintColor = Theme.textMuted
        iv.translatesAutoresizingMaskIntoConstraints = false
        return iv
    }()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .none

        contentView.addSubview(card)
        card.addSubview(accentBar)
        card.addSubview(iconCircle)
        iconCircle.addSubview(iconView)
        card.addSubview(nameLabel)
        card.addSubview(summaryLabel)
        card.addSubview(modePill)
        card.addSubview(inputsLabel)
        card.addSubview(chevron)

        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),

            accentBar.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 0),
            accentBar.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            accentBar.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            accentBar.widthAnchor.constraint(equalToConstant: 3),

            iconCircle.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            iconCircle.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            iconCircle.widthAnchor.constraint(equalToConstant: 36),
            iconCircle.heightAnchor.constraint(equalToConstant: 36),

            iconView.centerXAnchor.constraint(equalTo: iconCircle.centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: iconCircle.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 18),
            iconView.heightAnchor.constraint(equalToConstant: 18),

            nameLabel.leadingAnchor.constraint(equalTo: iconCircle.trailingAnchor, constant: 12),
            nameLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: modePill.leadingAnchor, constant: -8),

            summaryLabel.leadingAnchor.constraint(equalTo: nameLabel.leadingAnchor),
            summaryLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 3),
            summaryLabel.trailingAnchor.constraint(equalTo: chevron.leadingAnchor, constant: -8),

            inputsLabel.leadingAnchor.constraint(equalTo: nameLabel.leadingAnchor),
            inputsLabel.topAnchor.constraint(equalTo: summaryLabel.bottomAnchor, constant: 6),
            inputsLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),

            modePill.trailingAnchor.constraint(equalTo: chevron.leadingAnchor, constant: -10),
            modePill.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            modePill.heightAnchor.constraint(equalToConstant: 18),

            chevron.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            chevron.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 12),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(name: String, summary: String, inputCount: Int, mode: String) {
        nameLabel.text = name
        summaryLabel.text = summary

        let modeColor = Theme.modeColor(for: mode)
        accentBar.backgroundColor = modeColor

        let (iconName, iconColor) = Theme.skillIcon(for: name)
        iconCircle.backgroundColor = iconColor.withAlphaComponent(0.15)
        iconView.image = UIImage(systemName: iconName, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium))
        iconView.tintColor = iconColor

        modePill.text = "  \(mode.uppercased())  "
        modePill.textColor = modeColor
        modePill.backgroundColor = modeColor.withAlphaComponent(0.12)
        let pillWidth = modePill.intrinsicContentSize.width + 4
        for c in modePill.constraints where c.firstAttribute == .width { c.isActive = false }
        modePill.widthAnchor.constraint(equalToConstant: pillWidth).isActive = true

        if inputCount > 0 {
            inputsLabel.text = "\(inputCount) input\(inputCount == 1 ? "" : "s")"
        } else {
            inputsLabel.text = "no inputs"
        }
    }

    override func setHighlighted(_ highlighted: Bool, animated: Bool) {
        super.setHighlighted(highlighted, animated: animated)
        UIView.animate(withDuration: highlighted ? 0.08 : 0.25,
                       delay: 0,
                       usingSpringWithDamping: 0.8,
                       initialSpringVelocity: 0,
                       options: .allowUserInteraction) {
            self.card.transform = highlighted ? CGAffineTransform(scaleX: 0.97, y: 0.97) : .identity
            self.card.backgroundColor = highlighted ? Theme.surfaceHover : Theme.surface
        }
    }
}

// MARK: - Skill Input Form

private final class SkillInputFormViewController: UIViewController {

    private let skill: SkillDefinition
    private let onSubmit: ([String: Any]) -> Void
    private var fieldViews: [(id: String, type: String, view: UIView)] = []
    private var appSelections: [String: InstalledAppInfo] = [:]

    init(skill: SkillDefinition, onSubmit: @escaping ([String: Any]) -> Void) {
        self.skill = skill
        self.onSubmit = onSubmit
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.bg
        navigationItem.title = skill.name
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeSelf))

        let runButton = UIBarButtonItem(title: "Run", style: .done, target: self, action: #selector(submitForm))
        runButton.tintColor = Theme.accent
        navigationItem.rightBarButtonItem = runButton

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactiveWithAccessory
        view.addSubview(scroll)

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            stack.topAnchor.constraint(equalTo: scroll.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.widthAnchor, constant: -40)
        ])

        // Summary card
        let summaryCard = UIView()
        summaryCard.backgroundColor = Theme.surface
        summaryCard.layer.cornerRadius = 12
        summaryCard.layer.borderColor = Theme.surfaceBorder.cgColor
        summaryCard.layer.borderWidth = 1
        summaryCard.translatesAutoresizingMaskIntoConstraints = false

        let summaryLabel = UILabel()
        summaryLabel.text = skill.summary
        summaryLabel.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        summaryLabel.textColor = Theme.textDim
        summaryLabel.numberOfLines = 0
        summaryLabel.translatesAutoresizingMaskIntoConstraints = false
        summaryCard.addSubview(summaryLabel)

        NSLayoutConstraint.activate([
            summaryLabel.topAnchor.constraint(equalTo: summaryCard.topAnchor, constant: 14),
            summaryLabel.leadingAnchor.constraint(equalTo: summaryCard.leadingAnchor, constant: 14),
            summaryLabel.trailingAnchor.constraint(equalTo: summaryCard.trailingAnchor, constant: -14),
            summaryLabel.bottomAnchor.constraint(equalTo: summaryCard.bottomAnchor, constant: -14),
        ])
        stack.addArrangedSubview(summaryCard)

        // Inputs
        for input in skill.inputs {
            let container = UIView()
            container.translatesAutoresizingMaskIntoConstraints = false

            let label = UILabel()
            let requiredMark = (input.required == true)
                ? NSAttributedString(string: " *", attributes: [.foregroundColor: Theme.danger, .font: UIFont.systemFont(ofSize: 13, weight: .bold)])
                : NSAttributedString()
            let attrStr = NSMutableAttributedString(string: input.label, attributes: [
                .foregroundColor: Theme.text,
                .font: UIFont.systemFont(ofSize: 13, weight: .semibold)
            ])
            attrStr.append(requiredMark)
            label.attributedText = attrStr
            label.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(label)

            NSLayoutConstraint.activate([
                label.topAnchor.constraint(equalTo: container.topAnchor),
                label.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                label.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            ])

            switch input.type {
            case "boolean":
                let row = UIView()
                row.translatesAutoresizingMaskIntoConstraints = false
                let toggle = UISwitch()
                toggle.isOn = input.defaultValue?.boolValue ?? false
                toggle.onTintColor = Theme.accent
                toggle.translatesAutoresizingMaskIntoConstraints = false
                row.addSubview(toggle)
                container.addSubview(row)
                NSLayoutConstraint.activate([
                    row.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
                    row.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    row.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    row.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                    toggle.topAnchor.constraint(equalTo: row.topAnchor),
                    toggle.leadingAnchor.constraint(equalTo: row.leadingAnchor),
                    toggle.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                ])
                fieldViews.append((id: input.id, type: input.type, view: toggle))

            case "textarea":
                let tv = UITextView()
                tv.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
                tv.textColor = Theme.text
                tv.backgroundColor = Theme.surface
                tv.layer.cornerRadius = 10
                tv.layer.borderColor = Theme.surfaceBorder.cgColor
                tv.layer.borderWidth = 1
                tv.text = input.defaultValue?.stringValue ?? ""
                tv.autocapitalizationType = .none
                tv.autocorrectionType = .no
                tv.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
                tv.translatesAutoresizingMaskIntoConstraints = false
                container.addSubview(tv)
                NSLayoutConstraint.activate([
                    tv.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
                    tv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    tv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    tv.heightAnchor.constraint(equalToConstant: 100),
                    tv.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                ])
                fieldViews.append((id: input.id, type: input.type, view: tv))

            case "app":
                let selector = AppSelectorButton()
                selector.translatesAutoresizingMaskIntoConstraints = false
                selector.addTarget(self, action: #selector(appSelectorTapped(_:)), for: .touchUpInside)
                selector.accessibilityIdentifier = input.id
                container.addSubview(selector)
                NSLayoutConstraint.activate([
                    selector.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
                    selector.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    selector.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    selector.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
                    selector.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                ])
                fieldViews.append((id: input.id, type: "app", view: selector))

            case "select":
                let options = input.options ?? []
                let selector = SelectFieldButton(
                    options: options,
                    selectedValue: input.defaultValue?.stringValue,
                    placeholder: input.placeholder ?? "Select an option"
                )
                selector.translatesAutoresizingMaskIntoConstraints = false
                container.addSubview(selector)
                NSLayoutConstraint.activate([
                    selector.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
                    selector.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    selector.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    selector.heightAnchor.constraint(greaterThanOrEqualToConstant: 48),
                    selector.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                ])
                fieldViews.append((id: input.id, type: "select", view: selector))

            default: // "text" and unknown types
                let tf = UITextField()
                tf.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
                tf.textColor = Theme.text
                tf.backgroundColor = Theme.surface
                tf.layer.cornerRadius = 10
                tf.layer.borderColor = Theme.surfaceBorder.cgColor
                tf.layer.borderWidth = 1
                tf.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
                tf.leftViewMode = .always
                tf.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
                tf.rightViewMode = .always
                tf.text = input.defaultValue?.stringValue ?? ""
                tf.placeholder = input.placeholder ?? ""
                tf.autocapitalizationType = .none
                tf.autocorrectionType = .no
                tf.translatesAutoresizingMaskIntoConstraints = false
                container.addSubview(tf)
                NSLayoutConstraint.activate([
                    tf.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 8),
                    tf.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    tf.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                    tf.heightAnchor.constraint(equalToConstant: 44),
                    tf.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                ])
                fieldViews.append((id: input.id, type: input.type, view: tf))
            }

            stack.addArrangedSubview(container)
        }
    }

    @objc private func closeSelf() { dismiss(animated: true) }

    @objc private func appSelectorTapped(_ sender: AppSelectorButton) {
        guard let inputId = sender.accessibilityIdentifier else { return }
        let picker = AppPickerViewController()
        picker.onSelect = { [weak self] app in
            guard let self else { return }
            self.appSelections[inputId] = app
            sender.setSelectedApp(name: app.name, bundleId: app.bundleId)
        }
        let nav = UINavigationController(rootViewController: picker)
        nav.modalPresentationStyle = .formSheet
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = Theme.surface
        appearance.titleTextAttributes = [.foregroundColor: Theme.text, .font: UIFont.systemFont(ofSize: 17, weight: .semibold)]
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.tintColor = Theme.accent
        present(nav, animated: true)
    }

    @objc private func submitForm() {
        var values: [String: Any] = [:]
        for field in fieldViews {
            switch field.type {
            case "boolean":
                values[field.id] = (field.view as? UISwitch)?.isOn ?? false
            case "textarea":
                values[field.id] = (field.view as? UITextView)?.text ?? ""
            case "app":
                values[field.id] = appSelections[field.id]?.bundleId ?? ""
            case "select":
                values[field.id] = (field.view as? SelectFieldButton)?.selectedValue ?? ""
            default:
                values[field.id] = (field.view as? UITextField)?.text ?? ""
            }
        }
        dismiss(animated: true) { [onSubmit] in
            onSubmit(values)
        }
    }
}

// MARK: - App Selector Button

private final class SelectFieldButton: UIButton {

    private let placeholder: String
    private let valueLabel = UILabel()
    private let chevronView = UIImageView()
    private let options: [SkillDefinition.SkillInput.SkillOption]

    private(set) var selectedValue: String?

    init(options: [SkillDefinition.SkillInput.SkillOption], selectedValue: String?, placeholder: String) {
        self.options = options.filter { !$0.value.isEmpty }
        self.placeholder = placeholder
        super.init(frame: .zero)

        backgroundColor = Theme.surface
        layer.cornerRadius = 10
        layer.borderColor = Theme.surfaceBorder.cgColor
        layer.borderWidth = 1
        showsMenuAsPrimaryAction = true

        valueLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        valueLabel.textColor = Theme.textMuted
        valueLabel.numberOfLines = 1
        valueLabel.translatesAutoresizingMaskIntoConstraints = false

        chevronView.image = UIImage(
            systemName: "chevron.down",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        )
        chevronView.tintColor = Theme.textMuted
        chevronView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(valueLabel)
        addSubview(chevronView)

        NSLayoutConstraint.activate([
            valueLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            valueLabel.trailingAnchor.constraint(lessThanOrEqualTo: chevronView.leadingAnchor, constant: -8),
            valueLabel.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            valueLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),

            chevronView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            chevronView.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])

        rebuildMenu()
        let initialValue = self.options.contains(where: { $0.value == selectedValue }) ? selectedValue : self.options.first?.value
        setSelectedValue(initialValue, animated: false)
        if self.options.isEmpty {
            isEnabled = false
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    private func rebuildMenu() {
        guard !options.isEmpty else {
            menu = nil
            return
        }
        menu = UIMenu(children: options.map { option in
            UIAction(
                title: option.label,
                state: option.value == selectedValue ? .on : .off
            ) { [weak self] _ in
                self?.setSelectedValue(option.value)
            }
        })
    }

    private func setSelectedValue(_ value: String?, animated: Bool = true) {
        selectedValue = value
        if let value,
           let option = options.first(where: { $0.value == value }) {
            valueLabel.text = option.label
            valueLabel.textColor = Theme.text
            layer.borderColor = Theme.accent.withAlphaComponent(0.5).cgColor
            accessibilityValue = option.label
            if animated {
                UIView.animate(withDuration: 0.2) {
                    self.backgroundColor = Theme.accent.withAlphaComponent(0.06)
                }
            } else {
                backgroundColor = Theme.accent.withAlphaComponent(0.06)
            }
        } else {
            valueLabel.text = options.isEmpty ? "No options available" : placeholder
            valueLabel.textColor = Theme.textMuted
            layer.borderColor = Theme.surfaceBorder.cgColor
            accessibilityValue = valueLabel.text
            backgroundColor = Theme.surface
        }
        rebuildMenu()
        sendActions(for: .valueChanged)
    }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: isHighlighted ? 0.05 : 0.2) {
                self.alpha = self.isHighlighted ? 0.7 : 1.0
            }
        }
    }
}

private final class AppSelectorButton: UIButton {

    private let placeholderText = "Tap to select app..."
    private let nameLabel2 = UILabel()
    private let bundleLabel = UILabel()
    private let chevronView = UIImageView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Theme.surface
        layer.cornerRadius = 10
        layer.borderColor = Theme.surfaceBorder.cgColor
        layer.borderWidth = 1

        nameLabel2.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        nameLabel2.textColor = Theme.textMuted
        nameLabel2.text = placeholderText
        nameLabel2.translatesAutoresizingMaskIntoConstraints = false

        bundleLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        bundleLabel.textColor = Theme.textDim
        bundleLabel.translatesAutoresizingMaskIntoConstraints = false
        bundleLabel.isHidden = true

        chevronView.image = UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold))
        chevronView.tintColor = Theme.textMuted
        chevronView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(nameLabel2)
        addSubview(bundleLabel)
        addSubview(chevronView)

        NSLayoutConstraint.activate([
            nameLabel2.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            nameLabel2.trailingAnchor.constraint(lessThanOrEqualTo: chevronView.leadingAnchor, constant: -8),
            nameLabel2.topAnchor.constraint(equalTo: topAnchor, constant: 10),

            bundleLabel.leadingAnchor.constraint(equalTo: nameLabel2.leadingAnchor),
            bundleLabel.trailingAnchor.constraint(lessThanOrEqualTo: chevronView.leadingAnchor, constant: -8),
            bundleLabel.topAnchor.constraint(equalTo: nameLabel2.bottomAnchor, constant: 2),
            bundleLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),

            chevronView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            chevronView.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func setSelectedApp(name: String, bundleId: String) {
        nameLabel2.text = name
        nameLabel2.textColor = Theme.text
        nameLabel2.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        bundleLabel.text = bundleId
        bundleLabel.isHidden = false
        layer.borderColor = Theme.accent.withAlphaComponent(0.5).cgColor

        UIView.animate(withDuration: 0.2) {
            self.backgroundColor = Theme.accent.withAlphaComponent(0.06)
        }
    }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: isHighlighted ? 0.05 : 0.2) {
                self.alpha = self.isHighlighted ? 0.7 : 1.0
            }
        }
    }
}

// MARK: - App Picker

final class AppPickerViewController: UIViewController {

    var onSelect: ((InstalledAppInfo) -> Void)?

    private var allApps: [InstalledAppInfo] = []
    private var filteredApps: [InstalledAppInfo] = []
    private var hideSystemApps = true
    private var searchText = ""
    private var isLoading = true
    private var loadError: String?

    private let searchBar: UISearchBar = {
        let bar = UISearchBar()
        bar.placeholder = "Search apps..."
        bar.searchBarStyle = .minimal
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.barTintColor = Theme.bg
        if let tf = bar.searchTextField as UITextField? {
            tf.textColor = Theme.text
            tf.font = UIFont.systemFont(ofSize: 14, weight: .regular)
            tf.backgroundColor = Theme.surface
            tf.layer.cornerRadius = 10
            tf.clipsToBounds = true
        }
        return bar
    }()

    private let toggleRow: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let toggleLabel: UILabel = {
        let label = UILabel()
        label.text = "Hide System Apps"
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let systemToggle: UISwitch = {
        let toggle = UISwitch()
        toggle.isOn = true
        toggle.onTintColor = Theme.accent
        toggle.translatesAutoresizingMaskIntoConstraints = false
        return toggle
    }()

    private let appCountLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textMuted
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let divider: UIView = {
        let view = UIView()
        view.backgroundColor = Theme.separator
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let tableView: UITableView = {
        let table = UITableView(frame: .zero, style: .plain)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.backgroundColor = .clear
        table.separatorColor = Theme.separator
        table.separatorInset = UIEdgeInsets(top: 0, left: 56, bottom: 0, right: 16)
        table.register(AppCell.self, forCellReuseIdentifier: AppCell.reuseID)
        table.keyboardDismissMode = .onDrag
        return table
    }()

    private let spinner: UIActivityIndicatorView = {
        let s = UIActivityIndicatorView(style: .medium)
        s.color = Theme.accent
        s.translatesAutoresizingMaskIntoConstraints = false
        s.hidesWhenStopped = true
        return s
    }()

    private let loadingLabel: UILabel = {
        let label = UILabel()
        label.text = "Loading apps..."
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let errorLabel: UILabel = {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = Theme.danger
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    private let retryButton: UIButton = {
        let btn = UIButton(type: .system)
        btn.setTitle("Retry", for: .normal)
        btn.tintColor = Theme.accent
        btn.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        btn.translatesAutoresizingMaskIntoConstraints = false
        btn.isHidden = true
        return btn
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.bg
        navigationItem.title = "Select App"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeSelf))

        searchBar.delegate = self
        systemToggle.addTarget(self, action: #selector(toggleChanged), for: .valueChanged)
        retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        tableView.delegate = self
        tableView.dataSource = self

        toggleRow.addSubview(toggleLabel)
        toggleRow.addSubview(systemToggle)
        toggleRow.addSubview(appCountLabel)

        view.addSubview(searchBar)
        view.addSubview(toggleRow)
        view.addSubview(divider)
        view.addSubview(tableView)
        view.addSubview(spinner)
        view.addSubview(loadingLabel)
        view.addSubview(errorLabel)
        view.addSubview(retryButton)

        NSLayoutConstraint.activate([
            searchBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            searchBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            searchBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),

            toggleRow.topAnchor.constraint(equalTo: searchBar.bottomAnchor, constant: 4),
            toggleRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            toggleRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            toggleRow.heightAnchor.constraint(equalToConstant: 36),

            toggleLabel.leadingAnchor.constraint(equalTo: toggleRow.leadingAnchor, constant: 4),
            toggleLabel.centerYAnchor.constraint(equalTo: toggleRow.centerYAnchor),

            appCountLabel.centerYAnchor.constraint(equalTo: toggleRow.centerYAnchor),
            appCountLabel.trailingAnchor.constraint(equalTo: systemToggle.leadingAnchor, constant: -10),

            systemToggle.trailingAnchor.constraint(equalTo: toggleRow.trailingAnchor, constant: -4),
            systemToggle.centerYAnchor.constraint(equalTo: toggleRow.centerYAnchor),

            divider.topAnchor.constraint(equalTo: toggleRow.bottomAnchor, constant: 8),
            divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            divider.heightAnchor.constraint(equalToConstant: 1),

            tableView.topAnchor.constraint(equalTo: divider.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),

            loadingLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),

            errorLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
            errorLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            errorLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),

            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            retryButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 16),
        ])

        fetchApps()
    }

    @objc private func closeSelf() { dismiss(animated: true) }

    @objc private func toggleChanged() {
        hideSystemApps = systemToggle.isOn
        applyFilter()
    }

    @objc private func retryLoad() {
        errorLabel.isHidden = true
        retryButton.isHidden = true
        fetchApps()
    }

    private func fetchApps() {
        isLoading = true
        tableView.isHidden = true
        spinner.startAnimating()
        loadingLabel.isHidden = false

        InstalledAppService.fetchApps { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            self.spinner.stopAnimating()
            self.loadingLabel.isHidden = true

            switch result {
            case .success(let apps):
                self.allApps = apps
                self.loadError = nil
                self.applyFilter()
                self.tableView.isHidden = false
            case .failure(let error):
                self.loadError = error.localizedDescription
                self.errorLabel.text = error.localizedDescription
                self.errorLabel.isHidden = false
                self.retryButton.isHidden = false
            }
        }
    }

    private func applyFilter() {
        var apps = allApps
        if hideSystemApps {
            apps = apps.filter { !$0.isSystemApp }
        }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            apps = apps.filter {
                $0.name.lowercased().contains(q) || $0.bundleId.lowercased().contains(q)
            }
        }
        filteredApps = apps
        let userCount = allApps.filter { !$0.isSystemApp }.count
        let systemCount = allApps.filter { $0.isSystemApp }.count
        appCountLabel.text = hideSystemApps
            ? "\(filteredApps.count) of \(userCount) user"
            : "\(filteredApps.count) of \(userCount + systemCount)"
        tableView.reloadData()
    }
}

extension AppPickerViewController: UISearchBarDelegate {
    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
        self.searchText = searchText
        applyFilter()
    }
    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        searchBar.resignFirstResponder()
    }
}

extension AppPickerViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        filteredApps.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: AppCell.reuseID, for: indexPath) as! AppCell
        cell.configure(with: filteredApps[indexPath.row])
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        let app = filteredApps[indexPath.row]
        dismiss(animated: true) { [weak self] in
            self?.onSelect?(app)
        }
    }

    func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
        60
    }
}

// MARK: - App Cell

private final class AppCell: UITableViewCell {
    static let reuseID = "AppCell"

    private let avatar: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        label.textAlignment = .center
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let nameLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let bundleLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let systemBadge: UILabel = {
        let label = UILabel()
        label.text = "  SYS  "
        label.font = UIFont.monospacedSystemFont(ofSize: 9, weight: .bold)
        label.textColor = Theme.textMuted
        label.backgroundColor = Theme.separator
        label.layer.cornerRadius = 6
        label.clipsToBounds = true
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()

    private static let avatarColors: [UIColor] = [
        UIColor(red: 0.36, green: 0.55, blue: 0.97, alpha: 1),
        UIColor(red: 0.65, green: 0.42, blue: 0.98, alpha: 1),
        UIColor(red: 0.00, green: 0.75, blue: 0.60, alpha: 1),
        UIColor(red: 0.95, green: 0.55, blue: 0.30, alpha: 1),
        UIColor(red: 0.90, green: 0.35, blue: 0.45, alpha: 1),
        UIColor(red: 0.30, green: 0.72, blue: 0.85, alpha: 1),
        UIColor(red: 0.75, green: 0.62, blue: 0.35, alpha: 1),
        UIColor(red: 0.55, green: 0.75, blue: 0.35, alpha: 1),
    ]

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        let selectedBg = UIView()
        selectedBg.backgroundColor = Theme.surfaceHover
        selectedBackgroundView = selectedBg

        contentView.addSubview(avatar)
        contentView.addSubview(nameLabel)
        contentView.addSubview(bundleLabel)
        contentView.addSubview(systemBadge)

        NSLayoutConstraint.activate([
            avatar.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            avatar.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            avatar.widthAnchor.constraint(equalToConstant: 36),
            avatar.heightAnchor.constraint(equalToConstant: 36),

            nameLabel.leadingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 12),
            nameLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: systemBadge.leadingAnchor, constant: -8),

            bundleLabel.leadingAnchor.constraint(equalTo: nameLabel.leadingAnchor),
            bundleLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 2),
            bundleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),

            systemBadge.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            systemBadge.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(with app: InstalledAppInfo) {
        nameLabel.text = app.name
        bundleLabel.text = app.bundleId
        systemBadge.isHidden = !app.isSystemApp

        let letter = String(app.name.prefix(1)).uppercased()
        avatar.text = letter
        let hash = abs(app.bundleId.hashValue)
        let color = Self.avatarColors[hash % Self.avatarColors.count]
        avatar.backgroundColor = color.withAlphaComponent(0.2)
        avatar.textColor = color
    }
}

// MARK: - Skill Result View

private final class SkillResultViewController: UIViewController {

    private let skillName: String
    private let code: String
    private let textView = UITextView()
    private let statusPill = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    init(skillName: String, code: String) {
        self.skillName = skillName
        self.code = code
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.bg
        navigationItem.title = skillName
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeSelf))

        let copyButton = UIBarButtonItem(image: UIImage(systemName: "doc.on.doc"), style: .plain, target: self, action: #selector(copyOutput))
        copyButton.tintColor = Theme.textDim
        navigationItem.rightBarButtonItem = copyButton

        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.backgroundColor = Theme.surface
        textView.textColor = Theme.text
        textView.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.isEditable = false
        textView.layer.cornerRadius = 12
        textView.layer.borderColor = Theme.surfaceBorder.cgColor
        textView.layer.borderWidth = 1
        textView.textContainerInset = UIEdgeInsets(top: 14, left: 10, bottom: 14, right: 10)

        statusPill.translatesAutoresizingMaskIntoConstraints = false
        statusPill.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .bold)
        statusPill.textAlignment = .center
        statusPill.layer.cornerRadius = 10
        statusPill.clipsToBounds = true

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = Theme.accent
        spinner.hidesWhenStopped = true

        let bottomRow = UIStackView(arrangedSubviews: [spinner, statusPill, UIView()])
        bottomRow.axis = .horizontal
        bottomRow.spacing = 8
        bottomRow.alignment = .center
        bottomRow.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(textView)
        view.addSubview(bottomRow)

        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            textView.bottomAnchor.constraint(equalTo: bottomRow.topAnchor, constant: -10),

            bottomRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            bottomRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            bottomRow.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
            bottomRow.heightAnchor.constraint(equalToConstant: 24),

            statusPill.heightAnchor.constraint(equalToConstant: 20),
        ])

        executeSkill()
    }

    @objc private func closeSelf() { dismiss(animated: true) }

    @objc private func copyOutput() {
        UIPasteboard.general.string = textView.text
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)

        // Flash the copy button
        navigationItem.rightBarButtonItem?.tintColor = Theme.accent
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.navigationItem.rightBarButtonItem?.tintColor = Theme.textDim
        }
    }

    private func setStatus(_ text: String, color: UIColor) {
        statusPill.text = "  \(text)  "
        statusPill.textColor = color
        statusPill.backgroundColor = color.withAlphaComponent(0.12)
        let w = statusPill.intrinsicContentSize.width + 4
        for c in statusPill.constraints where c.firstAttribute == .width { c.isActive = false }
        statusPill.widthAnchor.constraint(equalToConstant: w).isActive = true
    }

    private func executeSkill() {
        spinner.startAnimating()
        setStatus("RUNNING", color: Theme.blue)
        textView.text = ""

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            let result = RemoteExec.execute(self.code, timeout: 600)

            DispatchQueue.main.async {
                self.spinner.stopAnimating()

                guard let result else {
                    self.setStatus("ERROR", color: Theme.danger)
                    self.textView.text = "No bridge or agent available."
                    return
                }

                var output = ""
                if !result.logs.isEmpty {
                    output += result.logs.joined(separator: "\n") + "\n\n"
                }
                output += result.value

                self.textView.text = output

                if result.succeeded {
                    self.setStatus("COMPLETED", color: Theme.accent)
                } else {
                    self.setStatus("FAILED", color: Theme.danger)
                }
            }
        }
    }
}
