fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_server_runtime",
            "save_server_config",
            "restart_server",
        ]));

    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
