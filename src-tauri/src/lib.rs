//! PROJECT BEACON native core.
//!
//! Layering (see ARCHITECTURE.md):
//! * `commands`: thin Tauri IPC surface, the only thing the frontend can reach.
//! * `notes`: Sprint 001 demo record (validation + SQL).
//! * `db`: connection setup and versioned migrations.
//! * `state`: data directory + connection lifecycle.
//!
//! OFFLINE: this crate has no networking dependency and registers no plugins.

pub mod commands;
pub mod db;
pub mod documents;
pub mod error;
pub mod notes;
pub mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // OS-appropriate per-user data directory, e.g. %APPDATA%\org.projectbeacon.desktop
            // on Windows. The same API resolves the sandboxed app directory on Android.
            let data_dir = app.path().app_data_dir()?;
            app.manage(state::AppState::initialize(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::create_note,
            commands::list_notes,
            commands::get_note,
            commands::import_document,
            commands::list_documents,
            commands::get_document,
            commands::search_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PROJECT BEACON");
}
