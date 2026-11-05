import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../../api/ApiContext';
import { createBrowserDemoApi } from '../../api/browserDemoApi';
import type { BeaconApi } from '../../api/beaconApi';
import { ApiError } from '../../api/types';
import type { PdfExtractor } from '../../lib/research/pdfText';
import { sha256Hex } from '../../lib/sha256';
import { ResearchPanel } from './ResearchPanel';

configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60000 });

const PDF_TEXT = 'Invented passage about a synthetic comet.';
const PDF_BYTES = '%PDF-1.4\nsynthetic stand-in bytes\n%%EOF';

const extractor = (): PdfExtractor =>
  vi.fn(async () => ({
    text: PDF_TEXT,
    pageCount: 3,
    truncated: false,
    method: 'pdfjs-text-layer',
  }));

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  expect(fetchSpy, 'research import must never touch the network').not.toHaveBeenCalled();
});

function mount(api: BeaconApi, extractPdf: PdfExtractor = extractor()) {
  return render(
    <ApiProvider api={api}>
      <ResearchPanel extractPdf={extractPdf} />
    </ApiProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

const file = (name: string, text: string, type = 'application/octet-stream') =>
  new File([text], name, { type });

async function makeCollection(user: User, name = 'Convergence research') {
  await user.type(screen.getByLabelText('New collection name'), name);
  await user.click(screen.getByRole('button', { name: 'Create collection' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Import into collection')).toHaveDisplayValue(name),
  );
}

async function stage(user: User, ...files: File[]) {
  await user.upload(screen.getByLabelText('Choose research files'), files);
}

describe('research import: preview before commit', () => {
  it('shows the preview and stores nothing until a collection is chosen and the import is confirmed', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    mount(api);

    await stage(user, file('Invented source.pdf', PDF_BYTES));
    const preview = await screen.findByRole('article', { name: 'Review before importing' });
    expect(within(preview).getByText('Invented source.pdf')).toBeInTheDocument();
    expect(within(preview).getByText('PDF')).toBeInTheDocument();
    expect(
      within(preview).getByText(sha256Hex(new TextEncoder().encode(PDF_BYTES))),
    ).toBeInTheDocument();
    expect(within(preview).getByText(/no OCR/i)).toBeInTheDocument();
    expect(
      within(preview).getByRole('region', { name: 'Extracted text preview' }),
    ).toHaveTextContent(PDF_TEXT);
    expect(await api.listResearch()).toEqual([]);

    // No collection yet: the import is refused with an explanation.
    await user.click(screen.getByRole('button', { name: /Import selected files/ }));
    expect(await screen.findByText(/Choose a collection first/)).toBeInTheDocument();
    expect(await api.listResearch()).toEqual([]);

    await makeCollection(user);
    await user.click(screen.getByRole('button', { name: /Import selected files/ }));
    const reader = await screen.findByRole('article', { name: 'Invented source' });
    expect(within(reader).getByLabelText('Provenance')).toHaveTextContent('Invented source.pdf');
    expect(within(reader).getByLabelText('Provenance')).toHaveTextContent(
      'pdfjs-text-layer · 3 pages',
    );
    expect(within(reader).getByRole('region', { name: 'Imported text' })).toHaveTextContent(
      PDF_TEXT,
    );
    expect(await api.listResearch()).toHaveLength(1);
  });

  it('explains a PDF with no readable text and imports nothing', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const scanned: PdfExtractor = async () => ({
      text: '   ',
      pageCount: 1,
      truncated: false,
      method: 'pdfjs-text-layer',
    });
    mount(api, scanned);
    await stage(user, file('Scanned.pdf', PDF_BYTES));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No text could be read.*OCR/);
    expect(screen.getByRole('button', { name: /Import selected files \(0\)/ })).toBeDisabled();
    expect(await api.listResearch()).toEqual([]);
  });

  it('rejects an unreadable PDF and a wrong file type without importing', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const broken: PdfExtractor = async () => {
      throw new ApiError('validation', 'This PDF could not be read. It may be damaged.');
    };
    mount(api, broken);
    await stage(user, file('Broken.pdf', PDF_BYTES), file('page.html', '<script>1</script>'));
    expect(await screen.findAllByText(/could not be read|Only PDF/)).not.toHaveLength(0);
    expect(await api.listResearch()).toEqual([]);
  });

  it('reviews a batch and imports only the files left included', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    mount(api);
    await makeCollection(user);
    await stage(user, file('One.md', '# One\nalpha words'), file('Two.txt', 'beta words'));
    await screen.findByRole('article', { name: 'Review before importing' });
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox', { name: /Include/ })).toHaveLength(2),
    );
    await user.click(screen.getByRole('checkbox', { name: /Include Two\.txt/ }));
    await user.click(screen.getByRole('button', { name: /Import selected files \(1\)/ }));
    await screen.findByRole('article', { name: 'One' });
    expect((await api.listResearch()).map((d) => d.title)).toEqual(['One']);
  });
});

describe('research import: duplicates, search and restart', () => {
  it('detects the same bytes imported again and creates no second record', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    mount(api);
    await makeCollection(user);
    await stage(user, file('Same.md', 'identical bytes here'));
    await user.click(await screen.findByRole('button', { name: /Import selected files \(1\)/ }));
    await screen.findByRole('article', { name: 'Same' });

    await stage(user, file('Renamed copy.md', 'identical bytes here'));
    expect(
      await screen.findByText(/Already in your private library as “Same”/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import selected files \(0\)/ })).toBeDisabled();
    expect(await api.listResearch()).toHaveLength(1);
  });

  it('searches imported text locally and keeps the library after a restart', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const first = mount(api);
    await makeCollection(user);
    await stage(user, file('Orbit notes.md', 'The invented comet follows a long orbit.'));
    await user.click(await screen.findByRole('button', { name: /Import selected files \(1\)/ }));
    await screen.findByRole('article', { name: 'Orbit notes' });
    first.unmount();

    // "Restart": a brand-new adapter and UI over the same IndexedDB.
    mount(createBrowserDemoApi());
    await user.type(await screen.findByLabelText('Search imported research'), 'comet');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const results = await screen.findByRole('list', { name: 'Research search results' });
    await user.click(within(results).getByRole('button', { name: /Orbit notes/ }));
    const reader = await screen.findByRole('article', { name: 'Orbit notes' });
    expect(within(reader).getByRole('region', { name: 'Imported text' })).toHaveTextContent(
      'long orbit',
    );
  });

  it('shows an integrity failure instead of text when the preserved original changed', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const first = mount(api);
    await makeCollection(user);
    await stage(user, file('Fragile.md', 'original text'));
    await user.click(await screen.findByRole('button', { name: /Import selected files \(1\)/ }));
    await screen.findByRole('article', { name: 'Fragile' });
    const [doc] = await api.listResearch();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('beacon-browser-demo-v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('rs_documents', 'readwrite');
        const store = tx.objectStore('rs_documents');
        const get = store.get(doc?.id ?? 0);
        get.onsuccess = () =>
          store.put({ ...get.result, original: new TextEncoder().encode('tampered').buffer });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    first.unmount();
    mount(api);
    await user.click(await screen.findByRole('button', { name: /Fragile/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/integrity/i);
  });
});

describe('research import: deliberate Watchtower mapping', () => {
  it('maps a source and an excerpt only after explicit classification and confirmation', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    await api.createHypothesis({ title: 'Synthetic hypothesis', statement: 'Invented.' });
    mount(api);
    await makeCollection(user);
    await stage(user, file('Mapped.md', 'A passage the owner chooses to keep.'));
    await user.click(await screen.findByRole('button', { name: /Import selected files \(1\)/ }));
    const reader = await screen.findByRole('article', { name: 'Mapped' });

    // Importing alone creates nothing in Watchtower.
    await screen.findByText('Map into Watchtower');
    const snapshot = await api.getWatchtower();
    expect([snapshot.events, snapshot.sources, snapshot.claims, snapshot.links]).toEqual([
      [],
      [],
      [],
      [],
    ]);

    await user.click(
      within(reader).getByRole('button', { name: 'Create a Watchtower source from this document' }),
    );
    const sourceForm = await screen.findByRole('form', { name: 'Create source from document' });
    expect(
      within(sourceForm).getByRole('button', { name: 'Create source and link it' }),
    ).toBeDisabled();
    await user.type(within(sourceForm).getByLabelText('Author'), 'A. Author');
    await user.click(
      within(sourceForm).getByLabelText('I confirm creating this source in Watchtower'),
    );
    await user.click(within(sourceForm).getByRole('button', { name: 'Create source and link it' }));
    await screen.findByRole('list', { name: 'Linked Watchtower sources' });

    const form = await screen.findByRole('form', { name: 'Record excerpt' });
    const save = within(form).getByRole('button', { name: 'Save excerpt' });
    const source = within(form).getByLabelText('Source');
    await user.selectOptions(source, within(source).getByRole('option', { name: 'Mapped' }));
    await user.selectOptions(within(form).getByLabelText('Event'), 'Create a new event…');
    await user.type(within(form).getByLabelText('New event title'), 'Synthetic event');
    // There is no default classification, and saving needs the explicit confirmation.
    expect(within(form).getByLabelText('How do you classify this excerpt?')).toHaveValue('');
    await user.type(
      within(form).getByLabelText('Excerpt text'),
      'A passage the owner chooses to keep.',
    );
    await user.type(
      within(form).getByLabelText('Location in the document (optional)'),
      'section 1',
    );
    await user.selectOptions(
      within(form).getByLabelText('How do you classify this excerpt?'),
      'Interpretation',
    );
    await user.selectOptions(
      within(form).getByLabelText('Attach to a hypothesis (optional)'),
      'Synthetic hypothesis',
    );
    await user.selectOptions(
      within(form).getByLabelText('Relationship to the hypothesis'),
      'Contradicts',
    );
    await user.type(
      within(form).getByLabelText('Why does it relate this way?'),
      'Invented reasoning.',
    );
    expect(save).toBeDisabled();
    await user.click(within(form).getByLabelText('I confirm this classification'));
    await user.click(save);

    const recorded = await screen.findByRole('list', { name: 'Recorded excerpts' });
    expect(recorded).toHaveTextContent('Interpretation');
    expect(recorded).toHaveTextContent('(section 1)');

    const after = await api.getWatchtower();
    expect(after.claims).toMatchObject([
      { kind: 'interpretation', text: 'A passage the owner chooses to keep.' },
    ]);
    expect(after.links).toMatchObject([{ relation: 'contradicts' }]);
    expect(after.sources[0]?.note).toContain('SHA-256');
    const links = await api.getResearchLinks();
    expect([links.sourceLinks.length, links.excerpts.length]).toEqual([1, 1]);
  });
});
