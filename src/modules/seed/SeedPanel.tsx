import { useId, useRef, useState } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import { ApiError, type SeedExport, type SeedPreview, type SeedTableCount } from '../../api/types';
import { readAsArrayBuffer } from '../../lib/readImportFile';
import { downloadBytes } from '../../lib/saveFile';
import { MAX_PACKAGE_BYTES } from '../../lib/seed/format';

const TABLE_LABELS: Record<string, string> = {
  notes: 'Notes',
  documents: 'Archive documents',
  research_collections: 'Research collections',
  research_documents: 'Research documents',
  watchtower_events: 'Watchtower events',
  watchtower_sources: 'Watchtower sources',
  watchtower_claims: 'Watchtower claims',
  watchtower_hypotheses: 'Watchtower hypotheses',
  watchtower_links: 'Evidence links',
  research_source_links: 'Research ↔ source links',
  research_excerpts: 'Research excerpts',
};

function CountsTable({ tables, mode }: { tables: SeedTableCount[]; mode: 'export' | 'restore' }) {
  return (
    <table className="seed-table">
      <caption className="visually-hidden">
        {mode === 'export' ? 'Records in the backup' : 'What restoring would do'}
      </caption>
      <thead>
        <tr>
          <th scope="col">Records</th>
          <th scope="col">In package</th>
          {mode === 'restore' ? (
            <>
              <th scope="col">New</th>
              <th scope="col">Already here</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {tables.map((row) => (
          <tr key={row.table}>
            <th scope="row">{TABLE_LABELS[row.table] ?? row.table}</th>
            <td>{row.total}</td>
            {mode === 'restore' ? (
              <>
                <td>{row.added}</td>
                <td>{row.existing}</td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Staged {
  fileName: string;
  bytes: Uint8Array;
  preview: SeedPreview;
}

type Outcome =
  | { kind: 'exported'; result: SeedExport }
  | { kind: 'restored'; report: SeedPreview }
  | null;

export function SeedPanel() {
  const api = useApi();
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const [busy, setBusy] = useState<'export' | 'inspect' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function exportLibrary() {
    setBusy('export');
    setError(null);
    setOutcome(null);
    try {
      const result = await api.exportSeed();
      downloadBytes(result.fileName, result.bytes);
      setOutcome({ kind: 'exported', result });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setOutcome(null);
    setStaged(null);
    setBusy('inspect');
    try {
      if (file.size > MAX_PACKAGE_BYTES) {
        throw new ApiError(
          'validation',
          `Backups larger than ${MAX_PACKAGE_BYTES / (1024 * 1024)} MiB cannot be restored in this version.`,
        );
      }
      const bytes = new Uint8Array(await readAsArrayBuffer(file));
      const preview = await api.inspectSeed(bytes);
      setStaged({ fileName: file.name, bytes, preview });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function confirmRestore() {
    if (!staged) return;
    setBusy('restore');
    setError(null);
    try {
      const report = await api.restoreSeed(staged.bytes, staged.preview.packageSha256);
      setOutcome({ kind: 'restored', report });
      setStaged(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  const newRecords = staged ? staged.preview.tables.reduce((sum, t) => sum + t.added, 0) : 0;

  return (
    <section aria-labelledby={headingId} className="seed-panel">
      <h2 className="section-heading" id={headingId}>
        Backup and restore (SEED)
      </h2>
      <div className="banner banner-warning" role="note">
        <p>
          <strong>A SEED backup is not encrypted or signed.</strong> It contains every note,
          document and research record in plain form, plus the original files. Anyone who can read
          the file can read your library. Keep it somewhere private. A checksum shows a file was not
          damaged; it does not prove who made it.
        </p>
      </div>

      <div className="seed-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={() => void exportLibrary()}
          disabled={busy !== null}
        >
          {busy === 'export' ? 'Preparing backup…' : 'Create backup'}
        </button>
      </div>
      <div className="field">
        <label htmlFor="seed-file">Backup file to restore (.beacon)</label>
        <input
          id="seed-file"
          ref={fileInput}
          type="file"
          accept=".beacon"
          disabled={busy !== null}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </div>
      <p className="muted">
        Restoring only adds records. Nothing you already have is changed or deleted, and records
        already present are skipped, so restoring the same backup twice adds nothing.
      </p>

      <div aria-live="polite">
        {busy === 'inspect' ? <p role="status">Checking the backup…</p> : null}
        {busy === 'restore' ? <p role="status">Restoring…</p> : null}
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          <p>{error}</p>
          <p className="muted">Nothing was changed.</p>
        </div>
      ) : null}

      {outcome?.kind === 'exported' ? (
        <div className="banner" role="status">
          <p>
            Backup <span className="mono">{outcome.result.fileName}</span> created (
            {outcome.result.byteLength.toLocaleString()} bytes). SHA-256:{' '}
            <span className="mono">{outcome.result.packageSha256}</span>
          </p>
          <CountsTable tables={outcome.result.tables} mode="export" />
          <p className="muted">
            Check your browser or system downloads for the file. Treat it as private.
          </p>
        </div>
      ) : null}

      {outcome?.kind === 'restored' ? (
        <div className="banner" role="status">
          <p>
            Restore complete: {outcome.report.tables.reduce((sum, t) => sum + t.added, 0)} new
            records added.
          </p>
          <CountsTable tables={outcome.report.tables} mode="restore" />
        </div>
      ) : null}

      {staged ? (
        <div className="banner" role="region" aria-label="Restore preview">
          <h3>Ready to restore {staged.fileName}</h3>
          <p>
            Written by BEACON {staged.preview.appVersion} on{' '}
            <span className="mono">{staged.preview.createdAt}</span>, {staged.preview.fileCount}{' '}
            original file(s). Package SHA-256:{' '}
            <span className="mono">{staged.preview.packageSha256}</span>
          </p>
          <CountsTable tables={staged.preview.tables} mode="restore" />
          {staged.preview.warnings.map((warning) => (
            <p key={warning} className="muted">
              {warning}
            </p>
          ))}
          <div className="seed-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void confirmRestore()}
              disabled={busy !== null}
            >
              {newRecords === 0 ? 'Nothing new to add' : `Add ${newRecords} new records`}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setStaged(null)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
