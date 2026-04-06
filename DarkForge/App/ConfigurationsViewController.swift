import UIKit

class ConfigurationsViewController: UIViewController, UITextFieldDelegate {

    // MARK: - Theme

    private struct Theme {
        static let bg = UIColor(red: 0x0d/255.0, green: 0x0d/255.0, blue: 0x12/255.0, alpha: 1.0)
        static let surface = UIColor(red: 0x16/255.0, green: 0x16/255.0, blue: 0x1f/255.0, alpha: 1.0)
        static let surfaceBorder = UIColor(red: 0x25/255.0, green: 0x25/255.0, blue: 0x30/255.0, alpha: 1.0)
        static let accent = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 1.0)
        static let accentGlow = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 0.15)
        static let text = UIColor(red: 0xe0/255.0, green: 0xe0/255.0, blue: 0xe8/255.0, alpha: 1.0)
        static let textDim = UIColor(red: 0x70/255.0, green: 0x70/255.0, blue: 0x80/255.0, alpha: 1.0)
        static let error = UIColor(red: 0xff/255.0, green: 0x5c/255.0, blue: 0x5c/255.0, alpha: 1.0)
        static let success = UIColor(red: 0x00/255.0, green: 0xff/255.0, blue: 0x9d/255.0, alpha: 1.0)
        static let warning = UIColor(red: 1.0, green: 0.8, blue: 0.0, alpha: 1.0)
        static let inputBackground = UIColor(red: 0x10/255.0, green: 0x10/255.0, blue: 0x18/255.0, alpha: 1.0)
    }

    // MARK: - UI Elements

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Configurations"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let replCard: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.surface
        v.layer.cornerRadius = 14
        v.layer.borderColor = Theme.surfaceBorder.cgColor
        v.layer.borderWidth = 1
        v.clipsToBounds = true
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let replHeaderView: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0x1c/255.0, green: 0x1c/255.0, blue: 0x26/255.0, alpha: 1.0)
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let replHeaderLabel: UILabel = {
        let label = UILabel()
        label.text = "REPL"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let replStatusDot: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.textDim
        v.layer.cornerRadius = 4
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let replStatusLabel: UILabel = {
        let label = UILabel()
        label.text = "not started"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let replButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("  Reconnect", for: .normal)
        button.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        button.tintColor = .black
        button.setTitleColor(.black, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = Theme.accent
        button.layer.cornerRadius = 10
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private let replDisconnectButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("  Disconnect", for: .normal)
        button.setImage(UIImage(systemName: "xmark.circle"), for: .normal)
        button.tintColor = Theme.error
        button.setTitleColor(Theme.error, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = UIColor(red: 1.0, green: 0.36, blue: 0.36, alpha: 0.12)
        button.layer.cornerRadius = 10
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private let serverCard: UIView = {
        let v = UIView()
        v.backgroundColor = Theme.surface
        v.layer.cornerRadius = 14
        v.layer.borderColor = Theme.surfaceBorder.cgColor
        v.layer.borderWidth = 1
        v.clipsToBounds = true
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let serverHeaderView: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0x1c/255.0, green: 0x1c/255.0, blue: 0x26/255.0, alpha: 1.0)
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let serverHeaderLabel: UILabel = {
        let label = UILabel()
        label.text = "NETWORK"
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let serverTitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Server Connection"
        label.font = UIFont.systemFont(ofSize: 18, weight: .semibold)
        label.textColor = Theme.text
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let serverDescriptionLabel: UILabel = {
        let label = UILabel()
        label.text = "Enter the Mac host and the host-facing WebSocket, agent, and HTTP ports."
        label.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        label.textColor = Theme.textDim
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let serverAddressField: UITextField = {
        let field = UITextField()
        field.attributedPlaceholder = NSAttributedString(
            string: "10.0.0.193 or lab-host.local",
            attributes: [.foregroundColor: Theme.textDim]
        )
        field.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .medium)
        field.textColor = Theme.text
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .URL
        field.returnKeyType = .done
        field.clearButtonMode = .whileEditing
        field.backgroundColor = Theme.inputBackground
        field.layer.cornerRadius = 10
        field.layer.borderWidth = 1
        field.layer.borderColor = Theme.surfaceBorder.cgColor
        field.translatesAutoresizingMaskIntoConstraints = false
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.rightViewMode = .always
        return field
    }()

    private let replPortTitleLabel: UILabel = {
        let label = UILabel()
        label.text = "WebSocket Port"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let replPortField: UITextField = {
        let field = UITextField()
        field.attributedPlaceholder = NSAttributedString(
            string: String(ServerConfiguration.defaultReplPort),
            attributes: [.foregroundColor: Theme.textDim]
        )
        field.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .medium)
        field.textColor = Theme.text
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .numbersAndPunctuation
        field.returnKeyType = .next
        field.backgroundColor = Theme.inputBackground
        field.layer.cornerRadius = 10
        field.layer.borderWidth = 1
        field.layer.borderColor = Theme.surfaceBorder.cgColor
        field.translatesAutoresizingMaskIntoConstraints = false
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.rightViewMode = .always
        return field
    }()

    private let agentPortTitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Agent TCP Port"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let agentPortField: UITextField = {
        let field = UITextField()
        field.attributedPlaceholder = NSAttributedString(
            string: String(ServerConfiguration.defaultAgentPort),
            attributes: [.foregroundColor: Theme.textDim]
        )
        field.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .medium)
        field.textColor = Theme.text
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .numbersAndPunctuation
        field.returnKeyType = .next
        field.backgroundColor = Theme.inputBackground
        field.layer.cornerRadius = 10
        field.layer.borderWidth = 1
        field.layer.borderColor = Theme.surfaceBorder.cgColor
        field.translatesAutoresizingMaskIntoConstraints = false
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.rightViewMode = .always
        return field
    }()

    private let logPortTitleLabel: UILabel = {
        let label = UILabel()
        label.text = "HTTP / UI Port"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let logPortField: UITextField = {
        let field = UITextField()
        field.attributedPlaceholder = NSAttributedString(
            string: String(ServerConfiguration.defaultLogPort),
            attributes: [.foregroundColor: Theme.textDim]
        )
        field.font = UIFont.monospacedSystemFont(ofSize: 15, weight: .medium)
        field.textColor = Theme.text
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardType = .numbersAndPunctuation
        field.returnKeyType = .done
        field.backgroundColor = Theme.inputBackground
        field.layer.cornerRadius = 10
        field.layer.borderWidth = 1
        field.layer.borderColor = Theme.surfaceBorder.cgColor
        field.translatesAutoresizingMaskIntoConstraints = false
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 0))
        field.rightViewMode = .always
        return field
    }()

    private let syncLoggingLabel: UILabel = {
        let label = UILabel()
        label.text = "Synchronous HTTP Logs"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        label.textColor = Theme.textDim
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let syncLoggingSwitch: UISwitch = {
        let toggle = UISwitch()
        toggle.onTintColor = Theme.accent
        toggle.translatesAutoresizingMaskIntoConstraints = false
        return toggle
    }()

    private let syncLoggingDescLabel: UILabel = {
        let label = UILabel()
        label.text = "Block until each log is delivered (retries on failure)."
        label.font = UIFont.systemFont(ofSize: 11, weight: .regular)
        label.textColor = Theme.textDim
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let serverHintLabel: UILabel = {
        let label = UILabel()
        label.text = "Uses ws://<address>:\(ServerConfiguration.defaultReplPort) and http://<address>:\(ServerConfiguration.defaultLogPort)/log.html"
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        label.textColor = Theme.textDim
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let serverSaveButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Save Network Settings", for: .normal)
        button.tintColor = .black
        button.setTitleColor(.black, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = Theme.accent
        button.layer.cornerRadius = 10
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private let serverStatusLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        label.textColor = Theme.textDim
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadServerSettings()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshReplStatus()
        if !isEditingServerSettings {
            loadServerSettings()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Setup

    private func setupUI() {
        view.backgroundColor = Theme.bg

        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tapGesture.cancelsTouchesInView = false
        view.addGestureRecognizer(tapGesture)

        view.addSubview(titleLabel)

        view.addSubview(replCard)
        replCard.addSubview(replHeaderView)
        replHeaderView.addSubview(replHeaderLabel)
        replCard.addSubview(replStatusDot)
        replCard.addSubview(replStatusLabel)
        replCard.addSubview(replButton)
        replCard.addSubview(replDisconnectButton)

        view.addSubview(serverCard)
        serverCard.addSubview(serverHeaderView)
        serverHeaderView.addSubview(serverHeaderLabel)
        serverCard.addSubview(serverTitleLabel)
        serverCard.addSubview(serverDescriptionLabel)
        serverCard.addSubview(serverAddressField)
        serverCard.addSubview(replPortTitleLabel)
        serverCard.addSubview(replPortField)
        serverCard.addSubview(agentPortTitleLabel)
        serverCard.addSubview(agentPortField)
        serverCard.addSubview(logPortTitleLabel)
        serverCard.addSubview(logPortField)
        serverCard.addSubview(syncLoggingLabel)
        serverCard.addSubview(syncLoggingSwitch)
        serverCard.addSubview(syncLoggingDescLabel)
        serverCard.addSubview(serverHintLabel)
        serverCard.addSubview(serverSaveButton)
        serverCard.addSubview(serverStatusLabel)

        serverAddressField.delegate = self
        serverAddressField.addTarget(self, action: #selector(serverAddressEditingChanged), for: .editingChanged)
        replPortField.delegate = self
        replPortField.addTarget(self, action: #selector(serverPortsEditingChanged), for: .editingChanged)
        agentPortField.delegate = self
        agentPortField.addTarget(self, action: #selector(serverPortsEditingChanged), for: .editingChanged)
        logPortField.delegate = self
        logPortField.addTarget(self, action: #selector(serverPortsEditingChanged), for: .editingChanged)
        replButton.addTarget(self, action: #selector(reconnectTapped), for: .touchUpInside)
        replDisconnectButton.addTarget(self, action: #selector(disconnectTapped), for: .touchUpInside)
        syncLoggingSwitch.addTarget(self, action: #selector(syncLoggingSwitchChanged), for: .valueChanged)
        serverSaveButton.addTarget(self, action: #selector(saveServerAddressTapped), for: .touchUpInside)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),

            replCard.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 20),
            replCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            replCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),

            replHeaderView.topAnchor.constraint(equalTo: replCard.topAnchor),
            replHeaderView.leadingAnchor.constraint(equalTo: replCard.leadingAnchor),
            replHeaderView.trailingAnchor.constraint(equalTo: replCard.trailingAnchor),
            replHeaderView.heightAnchor.constraint(equalToConstant: 32),

            replHeaderLabel.centerYAnchor.constraint(equalTo: replHeaderView.centerYAnchor),
            replHeaderLabel.leadingAnchor.constraint(equalTo: replHeaderView.leadingAnchor, constant: 14),

            replStatusDot.topAnchor.constraint(equalTo: replHeaderView.bottomAnchor, constant: 14),
            replStatusDot.leadingAnchor.constraint(equalTo: replCard.leadingAnchor, constant: 16),
            replStatusDot.widthAnchor.constraint(equalToConstant: 8),
            replStatusDot.heightAnchor.constraint(equalToConstant: 8),

            replStatusLabel.centerYAnchor.constraint(equalTo: replStatusDot.centerYAnchor),
            replStatusLabel.leadingAnchor.constraint(equalTo: replStatusDot.trailingAnchor, constant: 8),

            replButton.topAnchor.constraint(equalTo: replStatusLabel.bottomAnchor, constant: 14),
            replButton.leadingAnchor.constraint(equalTo: replCard.leadingAnchor, constant: 14),
            replButton.heightAnchor.constraint(equalToConstant: 40),
            replButton.bottomAnchor.constraint(equalTo: replCard.bottomAnchor, constant: -14),

            replDisconnectButton.topAnchor.constraint(equalTo: replButton.topAnchor),
            replDisconnectButton.leadingAnchor.constraint(equalTo: replButton.trailingAnchor, constant: 10),
            replDisconnectButton.trailingAnchor.constraint(equalTo: replCard.trailingAnchor, constant: -14),
            replDisconnectButton.heightAnchor.constraint(equalToConstant: 40),
            replDisconnectButton.widthAnchor.constraint(equalTo: replButton.widthAnchor),

            serverCard.topAnchor.constraint(equalTo: replCard.bottomAnchor, constant: 16),
            serverCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            serverCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            serverCard.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),

            serverHeaderView.topAnchor.constraint(equalTo: serverCard.topAnchor),
            serverHeaderView.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor),
            serverHeaderView.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor),
            serverHeaderView.heightAnchor.constraint(equalToConstant: 32),

            serverHeaderLabel.centerYAnchor.constraint(equalTo: serverHeaderView.centerYAnchor),
            serverHeaderLabel.leadingAnchor.constraint(equalTo: serverHeaderView.leadingAnchor, constant: 14),

            serverTitleLabel.topAnchor.constraint(equalTo: serverHeaderView.bottomAnchor, constant: 14),
            serverTitleLabel.leadingAnchor.constraint(equalTo: serverCard.leadingAnchor, constant: 16),
            serverTitleLabel.trailingAnchor.constraint(equalTo: serverCard.trailingAnchor, constant: -16),

            serverDescriptionLabel.topAnchor.constraint(equalTo: serverTitleLabel.bottomAnchor, constant: 6),
            serverDescriptionLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            serverDescriptionLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            serverAddressField.topAnchor.constraint(equalTo: serverDescriptionLabel.bottomAnchor, constant: 14),
            serverAddressField.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            serverAddressField.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            serverAddressField.heightAnchor.constraint(equalToConstant: 44),

            replPortTitleLabel.topAnchor.constraint(equalTo: serverAddressField.bottomAnchor, constant: 14),
            replPortTitleLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            replPortTitleLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            replPortField.topAnchor.constraint(equalTo: replPortTitleLabel.bottomAnchor, constant: 6),
            replPortField.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            replPortField.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            replPortField.heightAnchor.constraint(equalToConstant: 44),

            agentPortTitleLabel.topAnchor.constraint(equalTo: replPortField.bottomAnchor, constant: 12),
            agentPortTitleLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            agentPortTitleLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            agentPortField.topAnchor.constraint(equalTo: agentPortTitleLabel.bottomAnchor, constant: 6),
            agentPortField.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            agentPortField.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            agentPortField.heightAnchor.constraint(equalToConstant: 44),

            logPortTitleLabel.topAnchor.constraint(equalTo: agentPortField.bottomAnchor, constant: 12),
            logPortTitleLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            logPortTitleLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            logPortField.topAnchor.constraint(equalTo: logPortTitleLabel.bottomAnchor, constant: 6),
            logPortField.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            logPortField.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            logPortField.heightAnchor.constraint(equalToConstant: 44),

            syncLoggingLabel.topAnchor.constraint(equalTo: logPortField.bottomAnchor, constant: 14),
            syncLoggingLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),

            syncLoggingSwitch.centerYAnchor.constraint(equalTo: syncLoggingLabel.centerYAnchor),
            syncLoggingSwitch.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            syncLoggingDescLabel.topAnchor.constraint(equalTo: syncLoggingLabel.bottomAnchor, constant: 4),
            syncLoggingDescLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            syncLoggingDescLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            serverHintLabel.topAnchor.constraint(equalTo: syncLoggingDescLabel.bottomAnchor, constant: 10),
            serverHintLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            serverHintLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),

            serverSaveButton.topAnchor.constraint(equalTo: serverHintLabel.bottomAnchor, constant: 14),
            serverSaveButton.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            serverSaveButton.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            serverSaveButton.heightAnchor.constraint(equalToConstant: 40),

            serverStatusLabel.topAnchor.constraint(equalTo: serverSaveButton.bottomAnchor, constant: 10),
            serverStatusLabel.leadingAnchor.constraint(equalTo: serverTitleLabel.leadingAnchor),
            serverStatusLabel.trailingAnchor.constraint(equalTo: serverTitleLabel.trailingAnchor),
            serverStatusLabel.bottomAnchor.constraint(equalTo: serverCard.bottomAnchor, constant: -16),
        ])
    }

    // MARK: - Actions

    @objc private func reconnectTapped() {
        guard let repl = KExploit.activeREPL else {
            setStatus("not started", color: Theme.textDim)
            return
        }
        repl.reconnect()
        setStatus("connecting...", color: Theme.warning)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            self?.refreshReplStatus()
        }
    }

    @objc private func disconnectTapped() {
        guard let repl = KExploit.activeREPL else {
            setStatus("not started", color: Theme.textDim)
            return
        }
        repl.disconnect()
        setStatus("disconnected", color: Theme.error)
    }

    @objc private func saveServerAddressTapped() {
        view.endEditing(true)

        let rawAddress = serverAddressField.text ?? ""
        guard let normalizedAddress = ServerConfiguration.normalizeAddress(rawAddress) else {
            setServerStatus("enter a valid host or domain", color: Theme.error)
            return
        }

        guard let replPort = ServerConfiguration.parsePort(replPortField.text) else {
            setServerStatus("enter a valid WebSocket port (1-65535)", color: Theme.error)
            return
        }

        guard let agentPort = ServerConfiguration.parsePort(agentPortField.text) else {
            setServerStatus("enter a valid agent port (1-65535)", color: Theme.error)
            return
        }

        guard let logPort = ServerConfiguration.parsePort(logPortField.text) else {
            setServerStatus("enter a valid HTTP port (1-65535)", color: Theme.error)
            return
        }

        let distinctPorts = Set([replPort, agentPort, logPort])
        guard distinctPorts.count == 3 else {
            setServerStatus("WebSocket, agent, and HTTP ports must be distinct", color: Theme.error)
            return
        }

        ServerConfiguration.serverAddress = normalizedAddress
        ServerConfiguration.replPort = replPort
        ServerConfiguration.agentPort = agentPort
        ServerConfiguration.logPort = logPort
        ServerConfiguration.synchronousLogging = syncLoggingSwitch.isOn

        serverAddressField.text = ServerConfiguration.serverAddress
        replPortField.text = String(ServerConfiguration.replPort)
        agentPortField.text = String(ServerConfiguration.agentPort)
        logPortField.text = String(ServerConfiguration.logPort)
        refreshServerHint()

        if KExploit.activeREPL?.isConnected == true {
            setServerStatus("saved, reconnect REPL to switch host/ports", color: Theme.warning)
        } else {
            setServerStatus("saved", color: Theme.success)
        }
    }

    @objc private func serverAddressEditingChanged() {
        refreshServerHint()
        setServerStatus(nil, color: Theme.textDim)
    }

    @objc private func serverPortsEditingChanged() {
        refreshServerHint()
        setServerStatus(nil, color: Theme.textDim)
    }

    @objc private func syncLoggingSwitchChanged() {
        ServerConfiguration.synchronousLogging = syncLoggingSwitch.isOn
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    // MARK: - Helpers

    private func loadServerSettings() {
        serverAddressField.text = ServerConfiguration.serverAddress
        replPortField.text = String(ServerConfiguration.replPort)
        agentPortField.text = String(ServerConfiguration.agentPort)
        logPortField.text = String(ServerConfiguration.logPort)
        syncLoggingSwitch.isOn = ServerConfiguration.synchronousLogging
        refreshServerHint()
        setServerStatus(nil, color: Theme.textDim)
    }

    private func refreshReplStatus() {
        guard let repl = KExploit.activeREPL else {
            setStatus("not started", color: Theme.textDim)
            return
        }
        if repl.isConnected {
            setStatus("connected", color: Theme.success)
        } else if repl.shouldReconnect {
            setStatus("reconnecting...", color: Theme.warning)
        } else {
            setStatus("disconnected", color: Theme.error)
        }
    }

    private func setStatus(_ text: String, color: UIColor) {
        replStatusLabel.text = text
        replStatusLabel.textColor = color
        replStatusDot.backgroundColor = color
    }

    private func setServerStatus(_ text: String?, color: UIColor) {
        serverStatusLabel.text = text
        serverStatusLabel.textColor = color
    }

    private func refreshServerHint() {
        let host = ServerConfiguration.normalizeAddress(serverAddressField.text)
            ?? serverAddressField.text?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? ServerConfiguration.serverAddress
        let displayHost = host.isEmpty ? "<address>" : host
        let replPort = ServerConfiguration.parsePort(replPortField.text) ?? ServerConfiguration.replPort
        let logPort = ServerConfiguration.parsePort(logPortField.text) ?? ServerConfiguration.logPort
        serverHintLabel.text = "Uses ws://\(displayHost):\(replPort) and http://\(displayHost):\(logPort)/log.html"
    }

    private var isEditingServerSettings: Bool {
        serverAddressField.isFirstResponder ||
        replPortField.isFirstResponder ||
        agentPortField.isFirstResponder ||
        logPortField.isFirstResponder
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        switch textField {
        case serverAddressField:
            replPortField.becomeFirstResponder()
        case replPortField:
            agentPortField.becomeFirstResponder()
        case agentPortField:
            logPortField.becomeFirstResponder()
        case logPortField:
            saveServerAddressTapped()
        default:
            return true
        }
        return true
    }
}
