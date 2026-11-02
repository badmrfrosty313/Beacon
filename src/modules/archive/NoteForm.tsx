import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { Note } from '../../api/types';
import {
  MAX_BODY_BYTES,
  MAX_TITLE_CHARS,
  countCodePoints,
  countUtf8Bytes,
  validateNote,
  type NoteFieldErrors,
} from '../../lib/validation';

export interface NoteDraft {
  title: string;
  body: string;
}

interface NoteFormProps {
  draft: NoteDraft;
  onDraftChange: (draft: NoteDraft) => void;
  onCreated: (note: Note) => void;
  onCancel: () => void;
}

export function NoteForm({ draft, onDraftChange, onCreated, onCancel }: NoteFormProps) {
  const api = useApi();
  const titleRef = useRef<HTMLInputElement>(null);
  const { title, body } = draft;
  const [fieldErrors, setFieldErrors] = useState<NoteFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const errors = validateNote(title, body);
    setFieldErrors(errors);
    setSubmitError(null);
    if (errors.title || errors.body) {
      if (errors.title) titleRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const note = await api.createNote({ title, body });
      onCreated(note);
    } catch (error) {
      // Keep what the user typed so nothing is lost on a failed save.
      setSubmitError(errorMessage(error));
      setSaving(false);
    }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit} noValidate aria-labelledby="new-note-title">
      <h2 id="new-note-title">New note</h2>
      <p className="muted">
        Unsaved drafts are kept while navigating, but are lost when BEACON closes.
      </p>

      <div className="field">
        <label htmlFor="note-title">Title</label>
        <input
          id="note-title"
          ref={titleRef}
          type="text"
          autoComplete="off"
          value={title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          aria-invalid={fieldErrors.title ? true : undefined}
          aria-describedby={
            fieldErrors.title ? 'note-title-error note-title-count' : 'note-title-count'
          }
        />
        <div className="field-meta">
          {fieldErrors.title ? (
            <p id="note-title-error" className="field-error" role="alert">
              {fieldErrors.title}
            </p>
          ) : (
            <span />
          )}
          <span id="note-title-count" className="field-hint">
            {countCodePoints(title)} / {MAX_TITLE_CHARS}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="note-body">Note text</label>
        <textarea
          id="note-body"
          rows={12}
          value={body}
          onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
          aria-invalid={fieldErrors.body ? true : undefined}
          aria-describedby={
            fieldErrors.body ? 'note-body-error note-body-count' : 'note-body-count'
          }
        />
        <div className="field-meta">
          {fieldErrors.body ? (
            <p id="note-body-error" className="field-error" role="alert">
              {fieldErrors.body}
            </p>
          ) : (
            <span />
          )}
          <span id="note-body-count" className="field-hint">
            {countUtf8Bytes(body).toLocaleString('en-US')} /{' '}
            {MAX_BODY_BYTES.toLocaleString('en-US')} bytes
          </span>
        </div>
      </div>

      {submitError ? (
        <div className="banner banner-error" role="alert">
          <p>{submitError}</p>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
