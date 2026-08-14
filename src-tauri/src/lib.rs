mod dock;
mod fs;
mod relay;
mod selectors;
mod terminal;
mod types;

pub fn run() {
    tauri::Builder::default()
        .manage(relay::RelayEngine::default())
        .manage(terminal::TerminalManager::default())
        .manage(dock::DockManager::default())
        // Write the updateable selector registry on first run so users can
        // patch provider selectors without an app update.
        .setup(|_| {
            selectors::ensure_registry_file();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File system (F3 / F5)
            fs::list_dir,
            fs::read_file,
            fs::write_file,
            fs::create_file,
            fs::create_dir,
            fs::rename_path,
            fs::delete_path,
            fs::git_status,
            fs::git_branch,
            fs::pick_project_dir,
            fs::tree_summary,
            fs::search_files,
            // Relay engine (F2)
            relay::session_status,
            relay::set_project,
            relay::handoff,
            relay::packet_inspect,
            // Terminal (F4)
            terminal::spawn_terminal,
            terminal::write_stdin,
            terminal::resize_terminal,
            terminal::kill_terminal,
            terminal::run_command,
            // Embedded webview dock (F1)
            dock::dock_activate,
            dock::dock_set_bounds,
            dock::dock_inject,
            dock::dock_scan,
            dock::dock_context,
            dock::provider_open_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Relay");
}
