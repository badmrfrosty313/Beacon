//! Tauri commands: the only entry points the frontend can call.
//!
//! Commands stay thin: they unwrap managed state and delegate to the domain modules.
//! Frontend command names and argument shapes are mirrored in `src/api/tauriApi.ts`.

use tauri::State;

use crate::error::Result;
use crate::notes::{self, Note, NoteSummary};
use crate::state::{AppInfo, AppState};

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    state.info()
}

#[tauri::command]
pub fn create_note(state: State<'_, AppState>, title: String, body: String) -> Result<Note> {
    state.with_db(|conn| notes::create(conn, &title, &body))
}

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteSummary>> {
    state.with_db(notes::list)
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: i64) -> Result<Note> {
    state.with_db(|conn| notes::get(conn, id))
}
