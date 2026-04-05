use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_WS_PORT: u16 = 9090;
const DEFAULT_AGENT_PORT: u16 = 9091;
const DEFAULT_HTTP_PORT: u16 = 9092;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const PORT_RELEASE_TIMEOUT: Duration = Duration::from_secs(2);
const CONFIG_FILE_NAME: &str = "server-config.json";

struct ServerState {
    inner: Mutex<ServerInner>,
}

struct ServerInner {
    config: ServerConfig,
    active_config: ServerConfig,
    child: Option<CommandChild>,
    child_pid: Option<u32>,
    launch_id: u64,
    starting: bool,
    running: bool,
    managed_child: bool,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
    ws_port: u16,
    agent_port: u16,
    http_port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            ws_port: DEFAULT_WS_PORT,
            agent_port: DEFAULT_AGENT_PORT,
            http_port: DEFAULT_HTTP_PORT,
        }
    }
}

impl ServerConfig {
    fn validate(&self) -> Result<(), String> {
        let ports = [self.ws_port, self.agent_port, self.http_port];
        if ports.iter().any(|port| *port == 0) {
            return Err("ports must be between 1 and 65535".into());
        }
        if ports[0] == ports[1] || ports[0] == ports[2] || ports[1] == ports[2] {
            return Err("WebSocket, agent, and HTTP ports must be distinct".into());
        }
        Ok(())
    }

    fn server_url(&self) -> String {
        format!("http://{SERVER_HOST}:{}/", self.http_port)
    }

    fn sidecar_args(&self) -> Vec<String> {
        vec![
            "-d".into(),
            "--ws-port".into(),
            self.ws_port.to_string(),
            "--agent-port".into(),
            self.agent_port.to_string(),
            "--http-port".into(),
            self.http_port.to_string(),
        ]
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRuntime {
    config: ServerConfig,
    active_config: ServerConfig,
    configured_server_url: String,
    active_server_url: String,
    starting: bool,
    running: bool,
    managed_child: bool,
    restart_required: bool,
    last_error: Option<String>,
}

fn port_open(host: &str, port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("{host}:{port}").parse().unwrap(),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn wait_for_port_to_close(host: &str, port: u16, timeout: Duration) {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !port_open(host, port) {
            return;
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn bundled_sidecar_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.join("kserver")))
}

#[cfg(unix)]
fn process_command(pid: u32) -> Option<String> {
    let output = StdCommand::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if command.is_empty() {
        None
    } else {
        Some(command)
    }
}

#[cfg(not(unix))]
fn process_command(_pid: u32) -> Option<String> {
    None
}

#[cfg(unix)]
fn child_pids(pid: u32) -> Vec<u32> {
    let output = match StdCommand::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(not(unix))]
fn child_pids(_pid: u32) -> Vec<u32> {
    Vec::new()
}

#[cfg(unix)]
fn descendant_pids(pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    for child_pid in child_pids(pid) {
        descendants.push(child_pid);
        descendants.extend(descendant_pids(child_pid));
    }
    descendants
}

#[cfg(not(unix))]
fn descendant_pids(_pid: u32) -> Vec<u32> {
    Vec::new()
}

#[cfg(unix)]
fn send_signal(pid: u32, signal: &str) {
    let _ = StdCommand::new("kill")
        .args([signal, &pid.to_string()])
        .status();
}

#[cfg(unix)]
fn terminate_pid_tree(pid: u32) {
    let mut pids = descendant_pids(pid);
    pids.sort_unstable();
    pids.dedup();
    for child_pid in pids.into_iter().rev() {
        send_signal(child_pid, "-TERM");
    }
    send_signal(pid, "-TERM");
}

#[cfg(not(unix))]
fn terminate_pid_tree(_pid: u32) {}

#[cfg(unix)]
fn force_terminate_pid_tree(pid: u32) {
    let mut pids = descendant_pids(pid);
    pids.sort_unstable();
    pids.dedup();
    for child_pid in pids.into_iter().rev() {
        send_signal(child_pid, "-KILL");
    }
    send_signal(pid, "-KILL");
}

#[cfg(not(unix))]
fn force_terminate_pid_tree(_pid: u32) {}

fn is_bundled_sidecar_process(pid: u32) -> bool {
    let expected = match bundled_sidecar_path() {
        Some(path) => path,
        None => return false,
    };
    let expected = expected.to_string_lossy();
    process_command(pid)
        .map(|command| command.starts_with(expected.as_ref()))
        .unwrap_or(false)
}

#[cfg(unix)]
fn listener_pid(port: u16) -> Option<u32> {
    let output = StdCommand::new("lsof")
        .args(["-tiTCP", &port.to_string(), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

#[cfg(not(unix))]
fn listener_pid(_port: u16) -> Option<u32> {
    None
}

#[cfg(unix)]
fn terminate_stale_bundled_sidecar(port: u16) -> bool {
    let Some(pid) = listener_pid(port) else {
        return false;
    };
    if !is_bundled_sidecar_process(pid) {
        return false;
    }
    terminate_pid_tree(pid);
    thread::sleep(Duration::from_millis(200));
    force_terminate_pid_tree(pid);
    true
}

#[cfg(not(unix))]
fn terminate_stale_bundled_sidecar(_port: u16) -> bool {
    false
}

fn stop_managed_server(app: &AppHandle) {
    let (maybe_child, child_pid) = {
        let state = app.state::<ServerState>();
        let mut inner = state.inner.lock().unwrap();
        inner.starting = false;
        inner.running = false;
        inner.managed_child = false;
        (inner.child.take(), inner.child_pid.take())
    };
    if let Some(child) = maybe_child {
        let _ = child.kill();
    }
    if let Some(pid) = child_pid {
        terminate_pid_tree(pid);
        thread::sleep(Duration::from_millis(200));
        force_terminate_pid_tree(pid);
    }
}

fn runtime_from_inner(inner: &ServerInner) -> ServerRuntime {
    ServerRuntime {
        config: inner.config.clone(),
        active_config: inner.active_config.clone(),
        configured_server_url: inner.config.server_url(),
        active_server_url: inner.active_config.server_url(),
        starting: inner.starting,
        running: inner.running,
        managed_child: inner.managed_child,
        restart_required: (inner.running || inner.starting || inner.managed_child)
            && inner.config != inner.active_config,
        last_error: inner.last_error.clone(),
    }
}

fn get_runtime(state: &State<'_, ServerState>) -> ServerRuntime {
    let inner = state.inner.lock().unwrap();
    runtime_from_inner(&inner)
}

fn update_if_current<F>(app: &AppHandle, launch_id: u64, update: F)
where
    F: FnOnce(&mut ServerInner),
{
    let state = app.state::<ServerState>();
    let mut inner = state.inner.lock().unwrap();
    if inner.launch_id == launch_id {
        update(&mut inner);
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CONFIG_FILE_NAME))
        .map_err(|e| format!("failed to resolve app config directory: {e}"))
}

fn load_server_config(app: &AppHandle) -> ServerConfig {
    let path = match config_path(app) {
        Ok(path) => path,
        Err(err) => {
            eprintln!("[kserver] {err}");
            return ServerConfig::default();
        }
    };

    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return ServerConfig::default(),
        Err(err) => {
            eprintln!("[kserver] failed to read {}: {err}", path.display());
            return ServerConfig::default();
        }
    };

    match serde_json::from_str::<ServerConfig>(&raw) {
        Ok(config) => match config.validate() {
            Ok(()) => config,
            Err(err) => {
                eprintln!("[kserver] invalid config in {}: {err}", path.display());
                ServerConfig::default()
            }
        },
        Err(err) => {
            eprintln!("[kserver] failed to parse {}: {err}", path.display());
            ServerConfig::default()
        }
    }
}

fn persist_server_config(app: &AppHandle, config: &ServerConfig) -> Result<(), String> {
    config.validate()?;
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let payload = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize server config: {e}"))?;
    fs::write(&path, format!("{payload}\n"))
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(())
}

fn spawn_sidecar(
    app: &AppHandle,
    config: &ServerConfig,
    launch_id: u64,
) -> Result<CommandChild, String> {
    let sidecar = app
        .shell()
        .sidecar("kserver")
        .map_err(|e| format!("failed to resolve kserver sidecar: {e}"))?
        .args(config.sidecar_args())
        .env("DARKFORGE_EXIT_WHEN_ORPHANED", "1");
    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("failed to spawn kserver: {e}"))?;

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    eprintln!("[kserver] {line}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[kserver] exited: {:?}", payload);
                    let exit_message = match (payload.code, payload.signal) {
                        (Some(code), _) => format!("kserver exited with status {code}"),
                        (None, Some(signal)) => format!("kserver exited after signal {signal}"),
                        _ => "kserver exited".into(),
                    };
                    update_if_current(&app_clone, launch_id, |inner| {
                        inner.child = None;
                        inner.child_pid = None;
                        inner.starting = false;
                        inner.running = false;
                        inner.managed_child = false;
                        inner.last_error = Some(exit_message);
                    });
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

fn wait_for_server(app: AppHandle, http_port: u16, launch_id: u64) {
    thread::spawn(move || {
        let start = Instant::now();
        while start.elapsed() < READY_TIMEOUT {
            if port_open(SERVER_HOST, http_port) {
                update_if_current(&app, launch_id, |inner| {
                    inner.starting = false;
                    inner.running = true;
                    inner.last_error = None;
                });
                return;
            }
            thread::sleep(POLL_INTERVAL);
        }

        let timeout_message = format!(
            "kserver failed to bind {SERVER_HOST}:{http_port} within {}s. Check Console.app for [kserver] logs.",
            READY_TIMEOUT.as_secs()
        );
        let maybe_child = {
            let state = app.state::<ServerState>();
            let mut inner = state.inner.lock().unwrap();
            if inner.launch_id != launch_id {
                return;
            }
            inner.starting = false;
            inner.running = false;
            inner.managed_child = false;
            inner.last_error = Some(timeout_message);
            inner.child.take()
        };
        if let Some(child) = maybe_child {
            let _ = child.kill();
        }
    });
}

fn ensure_server_running(app: &AppHandle) -> Result<ServerRuntime, String> {
    let config = {
        let state = app.state::<ServerState>();
        let inner = state.inner.lock().unwrap();
        inner.config.clone()
    };
    config.validate()?;

    let (previous_child, previous_child_pid, launch_id) = {
        let state = app.state::<ServerState>();
        let mut inner = state.inner.lock().unwrap();
        inner.launch_id += 1;
        let launch_id = inner.launch_id;
        inner.active_config = config.clone();
        inner.starting = false;
        inner.running = false;
        inner.managed_child = false;
        inner.last_error = None;
        (inner.child.take(), inner.child_pid.take(), launch_id)
    };

    let had_managed_child = previous_child.is_some();
    if let Some(child) = previous_child {
        let _ = child.kill();
    }
    if let Some(pid) = previous_child_pid {
        terminate_pid_tree(pid);
        thread::sleep(Duration::from_millis(200));
        force_terminate_pid_tree(pid);
    }

    if had_managed_child {
        wait_for_port_to_close(SERVER_HOST, config.http_port, PORT_RELEASE_TIMEOUT);
    } else if port_open(SERVER_HOST, config.http_port) {
        if terminate_stale_bundled_sidecar(config.http_port) {
            wait_for_port_to_close(SERVER_HOST, config.http_port, PORT_RELEASE_TIMEOUT);
        } else {
            let state = app.state::<ServerState>();
            let mut inner = state.inner.lock().unwrap();
            if inner.launch_id == launch_id {
                inner.running = true;
                inner.starting = false;
                inner.managed_child = false;
            }
            return Ok(runtime_from_inner(&inner));
        }
    }

    if port_open(SERVER_HOST, config.http_port) {
        let state = app.state::<ServerState>();
        let mut inner = state.inner.lock().unwrap();
        if inner.launch_id == launch_id {
            inner.running = true;
            inner.starting = false;
            inner.managed_child = false;
        }
        return Ok(runtime_from_inner(&inner));
    }

    let child = match spawn_sidecar(app, &config, launch_id) {
        Ok(child) => child,
        Err(err) => {
            update_if_current(app, launch_id, |inner| {
                inner.starting = false;
                inner.running = false;
                inner.managed_child = false;
                inner.last_error = Some(err.clone());
            });
            return Err(err);
        }
    };

    {
        let state = app.state::<ServerState>();
        let mut inner = state.inner.lock().unwrap();
        if inner.launch_id != launch_id {
            let _ = child.kill();
            return Ok(runtime_from_inner(&inner));
        }
        let child_pid = child.pid();
        inner.child = Some(child);
        inner.child_pid = Some(child_pid);
        inner.starting = true;
        inner.running = false;
        inner.managed_child = true;
    }

    wait_for_server(app.clone(), config.http_port, launch_id);
    Ok(get_runtime(&app.state::<ServerState>()))
}

#[tauri::command]
fn get_server_runtime(state: State<'_, ServerState>) -> ServerRuntime {
    get_runtime(&state)
}

#[tauri::command]
fn save_server_config(
    app: AppHandle,
    state: State<'_, ServerState>,
    config: ServerConfig,
) -> Result<ServerRuntime, String> {
    persist_server_config(&app, &config)?;
    let mut inner = state.inner.lock().unwrap();
    inner.config = config.clone();
    if !inner.running && !inner.starting && inner.child.is_none() {
        inner.active_config = config;
    }
    Ok(runtime_from_inner(&inner))
}

#[tauri::command]
fn restart_server(app: AppHandle) -> Result<ServerRuntime, String> {
    ensure_server_running(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_config = ServerConfig::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState {
            inner: Mutex::new(ServerInner {
                config: initial_config.clone(),
                active_config: initial_config,
                child: None,
                child_pid: None,
                launch_id: 0,
                starting: false,
                running: false,
                managed_child: false,
                last_error: None,
            }),
        })
        .invoke_handler(tauri::generate_handler![
            get_server_runtime,
            save_server_config,
            restart_server
        ])
        .setup(|app| {
            let loaded_config = load_server_config(app.handle());
            {
                let state: tauri::State<ServerState> = app.state();
                let mut inner = state.inner.lock().unwrap();
                inner.config = loaded_config.clone();
                inner.active_config = loaded_config;
            }
            ensure_server_running(app.handle())
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    window.app_handle().exit(0);
                }
                tauri::WindowEvent::Destroyed => {
                    window.app_handle().exit(0);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            stop_managed_server(app_handle);
        }
    });
}
