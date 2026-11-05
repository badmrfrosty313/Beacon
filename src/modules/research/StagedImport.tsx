import type { DuplicateCheck } from '../../api/types';
import type { PreparedFile } from '../../lib/research/prepare';
import { formatBytes } from '../../lib/format';
import { TextAreaField, TextField } from '../watchtower/fields';

export interface Staged {
  key: number;
  name: string;
  status: 'reading' | 'ready' | 'error' | 'imported';
  error?: string;
  prepared?: PreparedFile;
  duplicate?: DuplicateCheck;
  include: boolean;
  title: string;
  author: string;
  publisher: string;
  publishedDate: string;
  attributionNote: string;
  rightsNote: string;
  outcome?: string;
}

const PREVIEW_CHARS = 20_000;

/**
 * Review of one staged file BEFORE anything is stored: what will be kept, its checksum, what
 * extraction can and cannot do, and the provenance fields the person fills in. All text is
 * untrusted and rendered only as text.
 */
export function StagedPreview({
  item,
  onChange,
}: {
  item: Staged;
  onChange: (patch: Partial<Staged>) => void;
}) {
  const prepared = item.prepared;
  if (item.status === 'reading') {
    return (
      <p className="muted pad" role="status">
        Reading “{item.name}” on this device…
      </p>
    );
  }
  if (item.status === 'error' || !prepared) {
    return (
      <div className="banner banner-error" role="alert">
        <p>
          <strong>{item.name}</strong>: {item.error ?? 'This file could not be read.'}
        </p>
      </div>
    );
  }
  const shown = Array.from(prepared.text).slice(0, PREVIEW_CHARS).join('');
  const total = Array.from(prepared.text).length;
  return (
    <article className="note" aria-labelledby="staged-heading">
      <header className="note-header">
        <h2 id="staged-heading">Review before importing</h2>
        <p className="muted">
          Nothing is stored until you press “Import selected files”. Everything stays private on
          this device.
        </p>
        <dl className="doc-meta">
          <div>
            <dt>Original file name</dt>
            <dd>{prepared.name}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{prepared.format.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(prepared.byteLength)}</dd>
          </div>
          <div>
            <dt>SHA-256 fingerprint</dt>
            <dd>
              <code className="doc-hash">{prepared.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Text extraction</dt>
            <dd>
              {prepared.method}
              {prepared.pageCount !== null ? ` · ${prepared.pageCount} pages` : ''}
            </dd>
          </div>
        </dl>
        {item.duplicate?.research ? (
          <p className="banner banner-error" role="alert">
            Already in your private library as “{item.duplicate.research.title}”. This file will be
            skipped and nothing will be duplicated.
          </p>
        ) : null}
        {item.duplicate?.archive && !item.duplicate.research ? (
          <p className="banner" role="status">
            The same bytes are already in Archive Documents as “{item.duplicate.archive.title}”.
            Importing here keeps a separate private research copy.
          </p>
        ) : null}
        <ul className="muted" aria-label="Extraction limitations">
          {prepared.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </header>

      <div className="doc-body" role="region" aria-label="Extracted text preview" tabIndex={0}>
        {shown}
      </div>
      <p className="muted doc-footnote">
        {total > PREVIEW_CHARS
          ? `Showing the first ${PREVIEW_CHARS.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} characters. `
          : ''}
        This is derivative text; the original file is kept unchanged. Shown as text only; nothing is
        rendered or run.
      </p>

      <fieldset className="form-section" disabled={item.duplicate?.research != null}>
        <legend>Details for this file</legend>
        <TextField
          label="Title"
          value={item.title}
          maxLength={200}
          onChange={(title) => onChange({ title })}
        />
        <TextField label="Author" value={item.author} onChange={(author) => onChange({ author })} />
        <TextField
          label="Publisher or source"
          value={item.publisher}
          onChange={(publisher) => onChange({ publisher })}
        />
        <TextField
          label="Date written or published"
          value={item.publishedDate}
          hint="YYYY, YYYY-MM or YYYY-MM-DD. This is the document’s own date, not today’s date."
          onChange={(publishedDate) => onChange({ publishedDate })}
        />
        <TextAreaField
          label="Attribution note"
          value={item.attributionNote}
          hint="Who this came from and how you obtained it."
          onChange={(attributionNote) => onChange({ attributionNote })}
        />
        <TextAreaField
          label="Rights and redistribution note"
          value={item.rightsNote}
          hint="Kept separate from private use. Importing never grants permission to share."
          onChange={(rightsNote) => onChange({ rightsNote })}
        />
      </fieldset>
    </article>
  );
}
