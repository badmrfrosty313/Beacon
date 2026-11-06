import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../../api/ApiContext';
import type { BeaconApi } from '../../api/beaconApi';
import { ApiError, type SeedExport, type SeedPreview } from '../../api/types';
import { SeedPanel } from './SeedPanel';

const TABLES = [
  { table: 'notes', total: 2, added: 1, existing: 1 },
  { table: 'documents', total: 1, added: 1, existing: 0 },
];

const PREVIEW: SeedPreview = {
  formatVersion: 1,
  appVersion: '0.1.0',
  schemaVersion: 5,
  createdAt: '2026-01-01T00:00:00Z',
  packageSha256: 'a'.repeat(64),
  byteLength: 10,
  fileCount: 1,
  tables: TABLES,
  warnings: ['SEED packages are not encrypted or signed.'],
};

const EXPORTED: SeedExport = {
  fileName: 'beacon-seed-20260101-000000.beacon',
  bytes: new Uint8Array([1, 2, 3]),
  byteLength: 3,
  packageSha256: 'b'.repeat(64),
  tables: TABLES,
  warnings: [],
};

function setup(overrides: Partial<BeaconApi> = {}) {
  const api = {
    exportSeed: vi.fn(async () => EXPORTED),
    inspectSeed: vi.fn(async () => PREVIEW),
    restoreSeed: vi.fn(async () => PREVIEW),
    ...overrides,
  } as unknown as BeaconApi;
  render(
    <ApiProvider api={api}>
      <SeedPanel />
    </ApiProvider>,
  );
  return api;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SeedPanel', () => {
  it('warns that backups are not encrypted before anything is done', () => {
    setup();
    expect(screen.getByRole('note')).toHaveTextContent(/not encrypted or signed/i);
  });

  it('creates a backup, offers the download and reports the digest', async () => {
    const api = setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    await screen.findByText(/created/i);
    expect(api.exportSeed).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByText(EXPORTED.packageSha256)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('previews a chosen file and restores only after confirmation', async () => {
    const api = setup();
    const file = new File([new Uint8Array([9, 9, 9])], 'my.beacon');
    await userEvent.upload(screen.getByLabelText(/backup file to restore/i), file);
    expect(await screen.findByText(/Ready to restore my\.beacon/)).toBeInTheDocument();
    expect(api.inspectSeed).toHaveBeenCalledOnce();
    expect(api.restoreSeed).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add 2 new records' }));
    await waitFor(() => expect(api.restoreSeed).toHaveBeenCalledOnce());
    expect(api.restoreSeed).toHaveBeenCalledWith(expect.any(Uint8Array), PREVIEW.packageSha256);
    expect(await screen.findByText(/Restore complete: 2 new records added/)).toBeInTheDocument();
  });

  it('can cancel a preview without restoring', async () => {
    const api = setup();
    await userEvent.upload(
      screen.getByLabelText(/backup file to restore/i),
      new File([new Uint8Array([1])], 'x.beacon'),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Ready to restore/)).not.toBeInTheDocument();
    expect(api.restoreSeed).not.toHaveBeenCalled();
  });

  it('shows a rejected package as an error and states that nothing changed', async () => {
    setup({
      inspectSeed: vi.fn(async () => {
        throw new ApiError('validation', 'Invalid SEED package: bad digest.');
      }),
    });
    await userEvent.upload(
      screen.getByLabelText(/backup file to restore/i),
      new File([new Uint8Array([1])], 'bad.beacon'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid SEED package/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was changed/);
    expect(screen.queryByText(/Ready to restore/)).not.toBeInTheDocument();
  });
});
