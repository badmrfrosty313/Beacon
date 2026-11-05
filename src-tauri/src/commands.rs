//! Tauri commands: the only entry points the frontend can call.
//!
//! Commands stay thin: they unwrap managed state and delegate to the domain modules.
//! Frontend command names and argument shapes are mirrored in `src/api/tauriApi.ts`.

use tauri::State;

use crate::documents::{self, Document, DocumentSummary, SearchHit};
use crate::error::Result;
use crate::notes::{self, Note, NoteSummary};
use crate::research::{
    self, CollectionInput, CollectionRecord, DuplicateCheck, Excerpt, ImportInput, Links,
    MetadataInput, ResearchDocument, ResearchSummary, SourceLink,
};
use crate::scripture::{self, LookupResult, ScriptureOverview, ScripturePassage};
use crate::state::{AppInfo, AppState};
use crate::watchtower::{
    self, ClaimInput, ClaimRecord, EventInput, EventRecord, HypothesisInput, HypothesisRecord,
    LinkInput, LinkRecord, Snapshot, SourceInput, SourceRecord,
};

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

#[tauri::command]
pub fn watchtower_snapshot(state: State<'_, AppState>) -> Result<Snapshot> {
    state.with_db(watchtower::snapshot)
}

#[tauri::command]
pub fn watchtower_create_event(
    state: State<'_, AppState>,
    input: EventInput,
) -> Result<EventRecord> {
    state.with_db(|conn| watchtower::create_event(conn, &input))
}

#[tauri::command]
pub fn watchtower_update_event(
    state: State<'_, AppState>,
    id: i64,
    input: EventInput,
) -> Result<EventRecord> {
    state.with_db(|conn| watchtower::update_event(conn, id, &input))
}

#[tauri::command]
pub fn watchtower_create_source(
    state: State<'_, AppState>,
    input: SourceInput,
) -> Result<SourceRecord> {
    state.with_db(|conn| watchtower::create_source(conn, &input))
}

#[tauri::command]
pub fn watchtower_update_source(
    state: State<'_, AppState>,
    id: i64,
    input: SourceInput,
) -> Result<SourceRecord> {
    state.with_db(|conn| watchtower::update_source(conn, id, &input))
}

#[tauri::command]
pub fn watchtower_create_claim(
    state: State<'_, AppState>,
    input: ClaimInput,
) -> Result<ClaimRecord> {
    state.with_db(|conn| watchtower::create_claim(conn, &input))
}

#[tauri::command]
pub fn watchtower_create_hypothesis(
    state: State<'_, AppState>,
    input: HypothesisInput,
) -> Result<HypothesisRecord> {
    state.with_db(|conn| watchtower::create_hypothesis(conn, &input))
}

#[tauri::command]
pub fn watchtower_update_hypothesis(
    state: State<'_, AppState>,
    id: i64,
    input: HypothesisInput,
) -> Result<HypothesisRecord> {
    state.with_db(|conn| watchtower::update_hypothesis(conn, id, &input))
}

#[tauri::command]
pub fn watchtower_create_link(state: State<'_, AppState>, input: LinkInput) -> Result<LinkRecord> {
    state.with_db(|conn| watchtower::create_link(conn, &input))
}

#[tauri::command]
pub fn research_create_collection(
    state: State<'_, AppState>,
    input: CollectionInput,
) -> Result<CollectionRecord> {
    state.with_db(|conn| research::create_collection(conn, &input))
}

#[tauri::command]
pub fn research_list_collections(state: State<'_, AppState>) -> Result<Vec<CollectionRecord>> {
    state.with_db(research::list_collections)
}

#[tauri::command]
pub fn research_check_duplicate(
    state: State<'_, AppState>,
    sha256: String,
) -> Result<DuplicateCheck> {
    state.with_db(|conn| research::check_duplicate(conn, &sha256))
}

#[tauri::command]
pub fn research_import(state: State<'_, AppState>, input: ImportInput) -> Result<ResearchDocument> {
    state.with_db(|conn| research::import(conn, state.data_dir(), &input))
}

#[tauri::command]
pub fn research_list(
    state: State<'_, AppState>,
    collection_id: Option<i64>,
) -> Result<Vec<ResearchSummary>> {
    state.with_db(|conn| research::list(conn, collection_id))
}

#[tauri::command]
pub fn research_get(state: State<'_, AppState>, id: i64) -> Result<ResearchDocument> {
    state.with_db(|conn| research::get(conn, state.data_dir(), id))
}

#[tauri::command]
pub fn research_search(
    state: State<'_, AppState>,
    query: String,
    collection_id: Option<i64>,
) -> Result<Vec<research::SearchHit>> {
    state.with_db(|conn| research::search(conn, &query, collection_id))
}

#[tauri::command]
pub fn research_update_metadata(
    state: State<'_, AppState>,
    id: i64,
    input: MetadataInput,
) -> Result<ResearchSummary> {
    state.with_db(|conn| research::update_metadata(conn, id, &input))
}

#[tauri::command]
pub fn research_link_source(
    state: State<'_, AppState>,
    document_id: i64,
    source_id: i64,
) -> Result<SourceLink> {
    state.with_db(|conn| research::link_source(conn, document_id, source_id))
}

#[tauri::command]
pub fn research_link_excerpt(
    state: State<'_, AppState>,
    document_id: i64,
    claim_id: i64,
    location: Option<String>,
) -> Result<Excerpt> {
    state.with_db(|conn| research::link_excerpt(conn, document_id, claim_id, location.as_deref()))
}

#[tauri::command]
pub fn research_links(state: State<'_, AppState>) -> Result<Links> {
    state.with_db(research::links)
}
