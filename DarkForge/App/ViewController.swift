import UIKit

// ExploitLogDelegate is defined in KExploit.swift

class ViewController: UIViewController, ExploitLogDelegate {

    // MARK: - State

    private enum UIState {
        case checkingAgent
        case agentActive(pid: Int)
        case ready
        case running
        case success
        case failed
    }

    private var uiState: UIState = .checkingAgent

    // MARK: - Theme

    private struct Theme {
        static let bg = UIColor(red: 0x0d/255.0, green: 0x0d/255.0, blue: 0x12/255.0, alpha: 1.0)
        static let surface = UIColor(red: 0x16/255.0, green: 0x16/255.0, blue: 0x1f/255.0, alpha: 1.0)
        static let surfaceBorder = UIColor(red: 0x25/255.0, green: 0x25/255.0, blue: 0x30/255.0, alpha: 1.0)
        static let accent = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 1.0)
        static let accentDim = UIColor(red: 0x00/255.0, green: 0x80/255.0, blue: 0x55/255.0, alpha: 1.0)
        static let accentGlow = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 0.15)
        static let text = UIColor(red: 0xe0/255.0, green: 0xe0/255.0, blue: 0xe8/255.0, alpha: 1.0)
        static let textDim = UIColor(red: 0x70/255.0, green: 0x70/255.0, blue: 0x80/255.0, alpha: 1.0)
        static let logText = UIColor(red: 0x8a/255.0, green: 0xd4/255.0, blue: 0xb0/255.0, alpha: 1.0)
        static let phaseText = UIColor(red: 0x00/255.0, green: 0xe6/255.0, blue: 0xa0/255.0, alpha: 1.0)
        static let error = UIColor(red: 0xff/255.0, green: 0x5c/255.0, blue: 0x5c/255.0, alpha: 1.0)
        static let success = UIColor(red: 0x00/255.0, green: 0xff/255.0, blue: 0x9d/255.0, alpha: 1.0)
        static let disabledBg = UIColor(red: 0x25/255.0, green: 0x25/255.0, blue: 0x30/255.0, alpha: 1.0)
        static let agentActive = UIColor(red: 0x00/255.0, green: 0xb4/255.0, blue: 0xd8/255.0, alpha: 1.0)
        static let agentActiveGlow = UIColor(red: 0x00/255.0, green: 0xb4/255.0, blue: 0xd8/255.0, alpha: 0.15)
        static let stopRed = UIColor(red: 0xff/255.0, green: 0x45/255.0, blue: 0x45/255.0, alpha: 1.0)
    }

    // MARK: - UI Elements

    private let headerView: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "DarkForge"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let subtitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Root JS Runtime"
        label.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        label.textColor = Theme.accentDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let replPill: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0.5, green: 0.5, blue: 0.5, alpha: 0.12)
        v.layer.cornerRadius = 10
        v.translatesAutoresizingMaskIntoConstraints = false
        v.isHidden = true
        return v
    }()

    private let replDot: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.textDim
        v.layer.cornerRadius = 3
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let replLabel: UILabel = {
        let label = UILabel()
        label.text = "Control Center"
        label.font = UIFont.monospacedSystemFont(ofSize: 9, weight: .semibold)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let statusPill: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.accentGlow
        v.layer.cornerRadius = 12
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let statusDot: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.accent
        v.layer.cornerRadius = 4
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let statusText: UILabel = {
        let label = UILabel()
        label.text = "CHECKING"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .semibold)
        label.textColor = Theme.accent
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let startButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("  Start Runtime", for: .normal)
        button.setImage(UIImage(systemName: "bolt.fill"), for: .normal)
        button.tintColor = .black
        button.setTitleColor(.black, for: .normal)
        button.setTitleColor(Theme.textDim, for: .disabled)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
        button.backgroundColor = Theme.accent
        button.layer.cornerRadius = 12
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private let logCard: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.surface
        v.layer.cornerRadius = 14
        v.layer.borderColor = Theme.surfaceBorder.cgColor
        v.layer.borderWidth = 1
        v.clipsToBounds = true
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let logHeaderView: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0x1c/255.0, green: 0x1c/255.0, blue: 0x26/255.0, alpha: 1.0)
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let logHeaderLabel: UILabel = {
        let label = UILabel()
        label.text = "Console Output"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let logTextView: UITextView = {
        let textView = UITextView()
        textView.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.textColor = Theme.logText
        textView.backgroundColor = .clear
        textView.isEditable = false
        textView.isScrollEnabled = true
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        textView.translatesAutoresizingMaskIntoConstraints = false
        return textView
    }()

    private var hasAppeared = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        startButton.isEnabled = false
        updateStatus("CHECKING", running: true)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleAgentReady),
                                               name: .darkForgeAgentReady,
                                               object: nil)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleREPLStateChanged(_:)),
                                               name: .darkForgeREPLStateChanged,
                                               object: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasAppeared else { return }
        hasAppeared = true
        appendLog("[*] Checking for existing agent...\n")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.checkAgentStatus()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Setup

    private func setupUI() {
        view.backgroundColor = Theme.bg

        // Header
        view.addSubview(headerView)
        headerView.addSubview(titleLabel)
        headerView.addSubview(subtitleLabel)
        headerView.addSubview(replPill)
        replPill.addSubview(replDot)
        replPill.addSubview(replLabel)

        // Status pill
        view.addSubview(statusPill)
        statusPill.addSubview(statusDot)
        statusPill.addSubview(statusText)

        // Button
        view.addSubview(startButton)
        startButton.addTarget(self, action: #selector(buttonTapped), for: .touchUpInside)

        // Log card
        view.addSubview(logCard)
        logCard.addSubview(logHeaderView)
        logHeaderView.addSubview(logHeaderLabel)
        logCard.addSubview(logTextView)

        NSLayoutConstraint.activate([
            // Header
            headerView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            headerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),

            titleLabel.topAnchor.constraint(equalTo: headerView.topAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            subtitleLabel.leadingAnchor.constraint(equalTo: headerView.leadingAnchor),
            subtitleLabel.bottomAnchor.constraint(equalTo: headerView.bottomAnchor),

            replPill.centerYAnchor.constraint(equalTo: subtitleLabel.centerYAnchor),
            replPill.leadingAnchor.constraint(equalTo: subtitleLabel.trailingAnchor, constant: 8),
            replPill.heightAnchor.constraint(equalToConstant: 20),

            replDot.leadingAnchor.constraint(equalTo: replPill.leadingAnchor, constant: 7),
            replDot.centerYAnchor.constraint(equalTo: replPill.centerYAnchor),
            replDot.widthAnchor.constraint(equalToConstant: 6),
            replDot.heightAnchor.constraint(equalToConstant: 6),

            replLabel.leadingAnchor.constraint(equalTo: replDot.trailingAnchor, constant: 5),
            replLabel.centerYAnchor.constraint(equalTo: replPill.centerYAnchor),
            replLabel.trailingAnchor.constraint(equalTo: replPill.trailingAnchor, constant: -7),

            // Status pill
            statusPill.centerYAnchor.constraint(equalTo: headerView.centerYAnchor),
            statusPill.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            statusPill.heightAnchor.constraint(equalToConstant: 24),

            statusDot.leadingAnchor.constraint(equalTo: statusPill.leadingAnchor, constant: 10),
            statusDot.centerYAnchor.constraint(equalTo: statusPill.centerYAnchor),
            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8),

            statusText.leadingAnchor.constraint(equalTo: statusDot.trailingAnchor, constant: 6),
            statusText.centerYAnchor.constraint(equalTo: statusPill.centerYAnchor),
            statusText.trailingAnchor.constraint(equalTo: statusPill.trailingAnchor, constant: -10),

            // Button
            startButton.topAnchor.constraint(equalTo: headerView.bottomAnchor, constant: 20),
            startButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            startButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            startButton.heightAnchor.constraint(equalToConstant: 50),

            // Log card
            logCard.topAnchor.constraint(equalTo: startButton.bottomAnchor, constant: 16),
            logCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            logCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            logCard.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),

            // Log header
            logHeaderView.topAnchor.constraint(equalTo: logCard.topAnchor),
            logHeaderView.leadingAnchor.constraint(equalTo: logCard.leadingAnchor),
            logHeaderView.trailingAnchor.constraint(equalTo: logCard.trailingAnchor),
            logHeaderView.heightAnchor.constraint(equalToConstant: 32),

            logHeaderLabel.centerYAnchor.constraint(equalTo: logHeaderView.centerYAnchor),
            logHeaderLabel.leadingAnchor.constraint(equalTo: logHeaderView.leadingAnchor, constant: 14),

            // Log text
            logTextView.topAnchor.constraint(equalTo: logHeaderView.bottomAnchor),
            logTextView.leadingAnchor.constraint(equalTo: logCard.leadingAnchor),
            logTextView.trailingAnchor.constraint(equalTo: logCard.trailingAnchor),
            logTextView.bottomAnchor.constraint(equalTo: logCard.bottomAnchor),
        ])
    }

    // MARK: - Status Updates

    private func updateStatus(_ text: String, running: Bool) {
        statusText.text = text
        if running {
            statusDot.backgroundColor = UIColor(red: 1.0, green: 0.8, blue: 0.0, alpha: 1.0)
            statusText.textColor = UIColor(red: 1.0, green: 0.8, blue: 0.0, alpha: 1.0)
            statusPill.backgroundColor = UIColor(red: 1.0, green: 0.8, blue: 0.0, alpha: 0.12)
        } else {
            statusDot.backgroundColor = Theme.accent
            statusText.textColor = Theme.accent
            statusPill.backgroundColor = Theme.accentGlow
        }
    }

    private func updateStatusError() {
        statusText.text = "FAILED"
        statusDot.backgroundColor = Theme.error
        statusText.textColor = Theme.error
        statusPill.backgroundColor = UIColor(red: 1.0, green: 0.36, blue: 0.36, alpha: 0.12)
    }

    private func updateStatusAgentActive() {
        statusText.text = "AGENT ACTIVE"
        statusDot.backgroundColor = Theme.agentActive
        statusText.textColor = Theme.agentActive
        statusPill.backgroundColor = Theme.agentActiveGlow
    }

    // MARK: - Agent Detection

    private func checkAgentStatus() {
        let port = ServerConfiguration.localAgentPort
        let response = pingLocalAgent(port: port, timeoutSec: 2)

        if let response = response {
            let pid = response["pid"] as? Int ?? 0
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.uiState = .agentActive(pid: pid)
                self.updateStatusAgentActive()
                self.appendColoredLog("[+] Existing root agent detected (PID \(pid)) on port \(port)\n", color: Theme.agentActive)
                self.appendLog("[*] Acquiring sandbox tokens via agent...\n")
                self.configureButtonForStop()
            }

            // Ask agent to issue sandbox tokens, then consume them locally
            let tokenCount = acquireSandboxTokensViaAgent()

            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                if tokenCount > 0 {
                    self.appendColoredLog("[+] Sandbox tokens acquired: \(tokenCount) paths\n", color: Theme.success)
                } else {
                    self.appendColoredLog("[!] Failed to acquire sandbox tokens\n", color: Theme.error)
                }
                self.appendLog("[*] Tap 'Stop Agent' to shut it down, then run exploit again.\n")
                NotificationCenter.default.post(name: .darkForgeRootFSReady,
                                                object: nil,
                                                userInfo: ["ready": tokenCount > 0])
            }
        } else {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.appendLog("[*] No existing agent found. Auto-starting exploit...\n")
                self.uiState = .ready
                self.startExploit()
            }
        }
    }

    /// Ask the agent to issue a sandbox_extension token for "/" and consume it locally.
    private func acquireSandboxTokensViaAgent() -> Int {
        let code = "Host.issueSandboxToken(\(jsStringLiteral("/")))"
        guard let result = RemoteExec.execute(code, timeout: 10),
              result.succeeded else { return 0 }
        let token = result.value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, token != "null", token != "undefined" else { return 0 }
        let handle = token.withCString { sandbox_extension_consume($0) }
        return handle != -1 ? 1 : 0
    }

    private func jsStringLiteral(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }

    /// Try to connect to the local agent TCP server and read its status response.
    private func pingLocalAgent(port: Int, timeoutSec: Int) -> [String: Any]? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }

        // Set connect timeout via SO_SNDTIMEO
        var tv = timeval(tv_sec: timeoutSec, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

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

        // Read response
        var buffer = [UInt8](repeating: 0, count: 1024)
        let bytesRead = read(fd, &buffer, buffer.count)
        guard bytesRead > 0 else { return nil }

        let data = Data(buffer[..<bytesRead])
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["status"] as? String == "alive" else {
            return nil
        }
        return json
    }

    /// Send a stop command to the local agent.
    private func sendStopToAgent(port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }

        var tv = timeval(tv_sec: 3, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

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
        guard connectResult == 0 else { return false }

        // Read the initial alive message
        var buffer = [UInt8](repeating: 0, count: 1024)
        let _ = read(fd, &buffer, buffer.count)

        // Send stop command
        let cmd = "{\"cmd\":\"stop\"}\n"
        let sent = cmd.withCString { ptr in
            write(fd, ptr, cmd.utf8.count)
        }
        guard sent > 0 else { return false }

        // Read ack
        var ackBuf = [UInt8](repeating: 0, count: 1024)
        let ackRead = read(fd, &ackBuf, ackBuf.count)
        if ackRead > 0,
           let json = try? JSONSerialization.jsonObject(with: Data(ackBuf[..<ackRead])) as? [String: Any],
           json["ok"] as? Bool == true {
            return true
        }
        // Even if we don't get an ack, the stop was likely sent
        return true
    }

    // MARK: - Button Configuration

    private func configureButtonForStop() {
        startButton.isEnabled = true
        startButton.setTitle("  Stop Agent", for: .normal)
        startButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
        startButton.backgroundColor = Theme.stopRed
        startButton.tintColor = .white
        startButton.setTitleColor(.white, for: .normal)
    }

    private func configureButtonForRuntime() {
        startButton.isEnabled = true
        if case .failed = uiState {
            startButton.setTitle("  Retry", for: .normal)
            startButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        } else {
            startButton.setTitle("  Start Runtime", for: .normal)
            startButton.setImage(UIImage(systemName: "bolt.fill"), for: .normal)
        }
        startButton.backgroundColor = Theme.accent
        startButton.tintColor = .black
        startButton.setTitleColor(.black, for: .normal)
    }

    private func configureButtonDisabled() {
        startButton.isEnabled = false
        startButton.backgroundColor = Theme.disabledBg
        startButton.tintColor = Theme.textDim
    }

    // MARK: - Actions

    @objc private func buttonTapped() {
        switch uiState {
        case .agentActive, .success:
            stopAgent()
        case .ready, .failed:
            startExploit()
        default:
            break
        }
    }

    private func stopAgent() {
        configureButtonDisabled()
        updateStatus("STOPPING", running: true)
        appendLog("[*] Stopping agent and cleaning up...\n")

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            // Shut down local REPL + bridge if we ran the exploit this session
            KExploit.shutdownActiveREPL(reason: "user stopped agent")

            // Send stop to the remote agent in launchd
            let port = ServerConfiguration.localAgentPort
            let ok = self.sendStopToAgent(port: port)

            DispatchQueue.main.async {
                if ok {
                    self.appendColoredLog("[+] Agent stopped successfully.\n", color: Theme.success)
                } else {
                    self.appendColoredLog("[*] Agent may already be stopped.\n", color: Theme.textDim)
                }
                self.uiState = .ready
                self.updateStatus("READY", running: false)
                self.configureButtonForRuntime()
                // Disable Files/Skills tabs
                NotificationCenter.default.post(name: .darkForgeRootFSReady,
                                                object: nil,
                                                userInfo: ["ready": false])
            }
        }
    }

    private func startExploit() {
        // Clean up any partial state from a previous failed attempt
        KExploit.shutdownActiveREPL(reason: "retry")

        uiState = .running
        configureButtonDisabled()
        logTextView.text = ""
        updateStatus("RUNNING", running: true)

        appendLog("[*] Initializing exploit...\n")

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let exploit = KExploit()
            exploit.delegate = self
            do {
                try exploit.run()
            } catch {
                DispatchQueue.main.async {
                    self.appendColoredLog("[-] Exploit failed: \(error.localizedDescription)\n", color: Theme.error)
                    self.uiState = .failed
                    self.configureButtonForRuntime()
                    self.updateStatusError()
                }
            }
        }
    }

    // MARK: - ExploitLogDelegate

    func exploit(_ exploit: KExploit, didLog message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.appendLog(message + "\n")
        }
    }

    func exploit(_ exploit: KExploit, didCompletePhase phase: String) {
        DispatchQueue.main.async { [weak self] in
            self?.appendColoredLog("[phase] \(phase)\n", color: Theme.phaseText)
        }
    }

    func exploit(_ exploit: KExploit, didFinishWithSuccess success: Bool,
                 kernelBase: UInt64, kernelSlide: UInt64) {
        if success {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                let successMsg = String(
                    format: "[+] kernel_base  = 0x%llx\n[+] kernel_slide = 0x%llx\n",
                    kernelBase, kernelSlide
                )
                self.appendColoredLog(successMsg, color: Theme.success)
                self.appendColoredLog("[+] Exploit succeeded!\n", color: Theme.success)
                self.appendLog("[*] Acquiring sandbox tokens...\n")
                self.uiState = .success
                self.updateStatus("SUCCESS", running: false)
                self.configureButtonForStop()
            }

        } else {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.appendColoredLog("[-] Exploit failed.\n", color: Theme.error)
                self.uiState = .failed
                self.updateStatusError()
                self.configureButtonForRuntime()
            }
        }
    }

    // MARK: - REPL Connection State

    @objc private func handleREPLStateChanged(_ notification: Notification) {
        guard let state = notification.userInfo?["state"] as? String else { return }
        if state == "connected" {
            replPill.isHidden = false
            replDot.backgroundColor = Theme.agentActive
            replLabel.text = "Control Center"
            replLabel.textColor = Theme.agentActive
            replPill.backgroundColor = Theme.agentActiveGlow
        } else {
            replPill.isHidden = true
        }
    }

    // MARK: - Agent Ready (post-bootstrap)

    @objc private func handleAgentReady() {
        appendLog("[*] Agent ready, acquiring sandbox tokens...\n")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let tokenCount = self.acquireSandboxTokensViaAgent()
            DispatchQueue.main.async {
                if tokenCount > 0 {
                    self.appendColoredLog("[+] Sandbox tokens acquired\n", color: Theme.success)
                } else {
                    self.appendColoredLog("[!] Failed to acquire sandbox tokens\n", color: Theme.error)
                }
                NotificationCenter.default.post(name: .darkForgeRootFSReady,
                                                object: nil,
                                                userInfo: ["ready": tokenCount > 0])
            }
        }
    }

    // MARK: - Logging Helpers

    private func appendLog(_ text: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: Theme.logText,
            .font: UIFont.monospacedSystemFont(ofSize: 12, weight: .regular),
        ]
        let attributed = NSAttributedString(string: text, attributes: attrs)
        logTextView.textStorage.append(attributed)
        scrollToBottom()
    }

    private func appendColoredLog(_ text: String, color: UIColor) {
        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: color,
            .font: UIFont.monospacedSystemFont(ofSize: 12, weight: .regular),
        ]
        let attributed = NSAttributedString(string: text, attributes: attrs)
        logTextView.textStorage.append(attributed)
        scrollToBottom()
    }

    private var scrollPending = false

    private func scrollToBottom() {
        guard !scrollPending else { return }
        scrollPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.scrollPending = false
            self.logTextView.layoutManager.ensureLayout(
                forCharacterRange: NSRange(location: 0, length: self.logTextView.textStorage.length)
            )
            let bottom = self.logTextView.contentSize.height - self.logTextView.bounds.height
            if bottom > 0 {
                self.logTextView.setContentOffset(CGPoint(x: 0, y: bottom), animated: false)
            }
        }
    }
}
