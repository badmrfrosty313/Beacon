//! Tauri commands: the only entry points the frontend can call.
//!
//! Commands stay thin: they unwrap managed state and delegate to the domain modules.
//! Frontend command names and argument shapes are mirrored in `src/api/tauriApi.ts`.

use tauri::State;

use crate::documents::{self, Document, DocumentSummary, SearchHit};
use crate::error::Result;
use crate::notes::{self, Note, NoteSummary};
use crate::scripture::{self, LookupResult, ScriptureOverview, ScripturePassage};
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

#[tauri::command]
pub fn import_document(
    state: State<'_, AppState>,
    name: String,
    bytes: Vec<u8>,
) -> Result<Document> {
    state.with_db(|conn| documents::import(conn, state.data_dir(), &name, &bytes))
}

#[tauri::command]
pub fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentSummary>> {
    state.with_db(documents::list)
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>, id: i64) -> Result<Document> {
    state.with_db(|conn| documents::get(conn, state.data_dir(), id))
}

#[tauri::command]
pub fn search_documents(state: State<'_, AppState>, query: String) -> Result<Vec<SearchHit>> {
    state.with_db(|conn| documents::search(conn, &query))
}

#[tauri::command]
pub fn scripture_overview(state: State<'_, AppState>) -> Result<ScriptureOverview> {
    state.with_scripture(|_, index| Ok(scripture::overview(index)))
}

#[tauri::command]
pub fn scripture_lookup(state: State<'_, AppState>, input: String) -> Result<LookupResult> {
    state.with_scripture(|conn, index| scripture::lookup(conn, index, &input))
}

#[tauri::command]
pub fn scripture_chapter(
    state: State<'_, AppState>,
    book_id: String,
    chapter: u32,
) -> Result<ScripturePassage> {
    state.with_scripture(|conn, index| scripture::chapter(conn, index, &book_id, chapter))
}
