//! PROJECT BEACON native core.
//!
//! Layering (see ARCHITECTURE.md):
//! * `commands`: thin Tauri IPC surface, the only thing the frontend can reach.
//! * `notes`: Sprint 001 demo record (validation + SQL).
//! * `documents`: imported text originals, FTS5 search.
//! * `scripture`: read-only packaged Scripture reference data and reference lookup.
//! * `watchtower`: events, sources, claims, hypotheses and evidence links (private research).
//! * `db`: connection setup and versioned migrations.
//! * `state`: data directory + connection lifecycle.
//!
//! OFFLINE: this crate has no networking dependency and registers no plugins.

pub mod commands;
pub mod db;
pub mod documents;
pub mod error;
pub mod notes;
pub mod research;
pub mod scripture;
pub mod state;
pub mod watchtower;

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
            commands::research_create_collection,
            commands::research_list_collections,
            commands::research_check_duplicate,
            commands::research_import,
            commands::research_list,
            commands::research_get,
            commands::research_search,
            commands::research_update_metadata,
            commands::research_link_source,
            commands::research_link_excerpt,
            commands::research_links,
            commands::scripture_overview,
            commands::scripture_lookup,
            commands::scripture_chapter,
            commands::watchtower_snapshot,
            commands::watchtower_create_event,
            commands::watchtower_update_event,
            commands::watchtower_create_source,
            commands::watchtower_update_source,
            commands::watchtower_create_claim,
            commands::watchtower_create_hypothesis,
            commands::watchtower_update_hypothesis,
            commands::watchtower_create_link,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PROJECT BEACON");
}
