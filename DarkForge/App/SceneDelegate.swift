import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?
    private let tabBar = UITabBarController()
    private let exploitVC = ViewController()
    private let filesVC = FileManagerViewController()
    private let skillsVC = SkillsViewController()
    private let configVC = ConfigurationsViewController()

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)

        exploitVC.tabBarItem = UITabBarItem(title: "Exploit", image: UIImage(systemName: "bolt.fill"), tag: 0)
        filesVC.tabBarItem = UITabBarItem(title: "Files", image: UIImage(systemName: "folder.fill"), tag: 1)
        skillsVC.tabBarItem = UITabBarItem(title: "Skills", image: UIImage(systemName: "sparkles"), tag: 2)
        configVC.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gearshape.fill"), tag: 3)
        applyTabConfiguration(rootFSReady: KExploit.activeREPL?.jscBridge != nil)

        // Theme colors
        let bgColor = UIColor(red: 0x0d/255.0, green: 0x0d/255.0, blue: 0x12/255.0, alpha: 1.0)
        let accentColor = UIColor(red: 0x00/255.0, green: 0xd6/255.0, blue: 0x8f/255.0, alpha: 1.0)
        let dimColor = UIColor(red: 0x40/255.0, green: 0x40/255.0, blue: 0x4c/255.0, alpha: 1.0)

        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = bgColor

        let itemAppearance = UITabBarItemAppearance()
        itemAppearance.selected.iconColor = accentColor
        itemAppearance.selected.titleTextAttributes = [
            .foregroundColor: accentColor,
            .font: UIFont.systemFont(ofSize: 10, weight: .semibold)
        ]
        itemAppearance.normal.iconColor = dimColor
        itemAppearance.normal.titleTextAttributes = [
            .foregroundColor: dimColor,
            .font: UIFont.systemFont(ofSize: 10, weight: .medium)
        ]

        appearance.stackedLayoutAppearance = itemAppearance
        tabBar.tabBar.standardAppearance = appearance
        tabBar.tabBar.scrollEdgeAppearance = appearance

        window.rootViewController = tabBar
        window.makeKeyAndVisible()
        self.window = window

        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRootFSReady(_:)),
                                               name: .darkForgeRootFSReady,
                                               object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        KExploit.resumeActiveREPLTransport(reason: "sceneDidBecomeActive")
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        KExploit.suspendActiveREPLTransport(reason: "sceneDidEnterBackground")
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        KExploit.shutdownActiveREPL(reason: "sceneDidDisconnect")
    }

    @objc private func handleRootFSReady(_ note: Notification) {
        let ready = (note.userInfo?["ready"] as? Bool) ?? false
        applyTabConfiguration(rootFSReady: ready)
    }

    private func applyTabConfiguration(rootFSReady: Bool) {
        let controllers: [UIViewController] = rootFSReady
            ? [exploitVC, filesVC, skillsVC, configVC]
            : [exploitVC, configVC]
        tabBar.setViewControllers(controllers, animated: true)
    }
}
