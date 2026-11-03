import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/types';
import { MAX_DOCUMENT_BYTES } from '../../lib/documentValidation';
import { createFakeApi, renderApp, textFile } from '../../test/fakeApi';

const picker = () => screen.getByLabelText('Choose documents to import');

async function importFiles(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  await user.upload(picker(), files);
}

describe('Archive documents: import and library', () => {
  it('starts with an empty library and explains what to do', async () => {
    renderApp();
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Start a library' })).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/)).toBeInTheDocument();
  });

  it('imports a Markdown file, lists it and opens it in the reader', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await importFiles(user, textFile('Field notes.md', '# Heading\nLine two\r\nLine three'));

    expect(await screen.findByRole('heading', { level: 2, name: 'Field notes' })).toBeVisible();
    expect(api.importDocument).toHaveBeenCalledTimes(1);
    const list = await screen.findByRole('list', { name: 'Documents' });
    expect(within(list).getByText('Field notes')).toBeInTheDocument();
    expect(await screen.findByText(/Imported .Field notes./)).toBeInTheDocument();
  });

  it('shows file name, format, size, timestamp and the SHA-256 fingerprint', async () => {
    const user = userEvent.setup();
    renderApp();
    await importFiles(user, textFile('Radio.txt', 'abc'));
    const article = await screen.findByRole('article');
    expect(within(article).getByText('Radio.txt')).toBeInTheDocument();
    expect(within(article).getByText('Plain text (.txt)')).toBeInTheDocument();
    expect(within(article).getByText('3 B')).toBeInTheDocument();
    // SHA-256 of "abc".
    expect(
      within(article).getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    ).toBeInTheDocument();
    expect(article.querySelector('time')).not.toBeNull();
  });

  it('preserves line breaks and the exact original text', async () => {
    const user = userEvent.setup();
    renderApp();
    const text = 'first\n\n  indented\r\nlast\ttabbed';
    await importFiles(user, textFile('lines.txt', text));
    const body = await screen.findByRole('region', { name: 'Document text' });
    expect(body.textContent).toBe(text);
  });

  it('shows hostile HTML and Markdown as inert text', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    const hostile =
      '<script>window.pwned = true</script><img src=x onerror="window.pwned=true">\n[x](javascript:alert(1))';
    await importFiles(user, textFile('hostile.md', hostile));
    const body = await screen.findByRole('region', { name: 'Document text' });
    expect(body.textContent).toBe(hostile);
    expect(container.querySelector('script, img, a[href^="javascript"]')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('reports a duplicate without adding a second record', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await importFiles(user, textFile('one.txt', 'identical bytes'));
    await screen.findByRole('article');
    await importFiles(user, textFile('renamed copy.md', 'identical bytes'));

    expect(await screen.findByText(/already in your library as .one./)).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Documents' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Documents' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(api.listDocuments).toHaveBeenCalled();
  });

  it('rejects unsupported file types before reading or sending them', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { api } = renderApp();
    await importFiles(user, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    expect(
      await screen.findByText(/Only Markdown \(\.md\) and text \(\.txt\)/),
    ).toBeInTheDocument();
    expect(api.importDocument).not.toHaveBeenCalled();
  });

  it('rejects files over 1 MiB without sending their contents', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    const big = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1).fill(65)], 'big.txt');
    await importFiles(user, big);
    expect(await screen.findByText(/at most 1 MiB/)).toBeInTheDocument();
    expect(api.importDocument).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 and binary content', async () => {
    const user = userEvent.setup();
    renderApp();
    await importFiles(
      user,
      new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'bad.txt'),
      new File([new Uint8Array([0x61, 0x00, 0x62])], 'binary.md'),
    );
    expect(await screen.findByText(/not valid UTF-8/)).toBeInTheDocument();
    expect(screen.getByText(/unsupported control characters/)).toBeInTheDocument();
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
  });

  it('imports several files, reporting each result separately', async () => {
    const user = userEvent.setup();
    renderApp();
    await importFiles(
      user,
      textFile('good.md', 'fine'),
      new File(['x'], 'bad.html'),
      textFile('also good.txt', 'fine too'),
    );
    const results = await screen.findByRole('list', { name: 'Import results' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(3);
    expect(await screen.findByRole('list', { name: 'Documents' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Documents' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('recovers from a backend failure: shows it, leaves the library alone, and allows a retry', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.importDocument.mockRejectedValueOnce(
      new ApiError('io', 'BEACON could not access its local storage.'),
    );
    renderApp(api);
    await importFiles(user, textFile('retry.txt', 'content'));
    expect(
      await screen.findByText('BEACON could not access its local storage.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No documents yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import documents' })).toBeEnabled();

    await importFiles(user, textFile('retry.txt', 'content'));
    expect(await screen.findByRole('heading', { level: 2, name: 'retry' })).toBeInTheDocument();
  });

  it('shows a list failure with a working Retry', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.listDocuments.mockRejectedValueOnce(
      new ApiError('database', 'Could not read the library.'),
    );
    renderApp(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the library.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
  });

  it('keeps documents after the app is reopened (new render over the same storage)', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const first = renderApp(api);
    await importFiles(user, textFile('persist.md', 'still here'));
    await screen.findByRole('article');
    first.unmount();

    renderApp(api);
    const list = await screen.findByRole('list', { name: 'Documents' });
    await user.click(within(list).getByRole('button', { name: /persist/ }));
    expect((await screen.findByRole('region', { name: 'Document text' })).textContent).toBe(
      'still here',
    );
  });

  it('shows an integrity failure instead of untrusted text', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api);
    await importFiles(user, textFile('proof.txt', 'original'));
    await screen.findByRole('article');
    api.getDocument.mockRejectedValueOnce(
      new ApiError(
        'integrity',
        'An archived original is missing or failed its SHA-256 integrity check.',
      ),
    );
    const list = screen.getByRole('list', { name: 'Documents' });
    await user.click(within(list).getByRole('button', { name: /proof/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/integrity check/);
    expect(screen.queryByRole('region', { name: 'Document text' })).toBeNull();
  });
});

describe('Archive documents: search', () => {
  async function seed(user: ReturnType<typeof userEvent.setup>) {
    const utils = renderApp();
    await importFiles(
      user,
      textFile('Bridge report.txt', 'Crews inspected the north bridge on Tuesday morning.'),
      textFile('Water plan.md', 'Store two litres per person per day.'),
    );
    await screen.findByRole('list', { name: 'Documents' });
    return utils;
  }

  it('finds a phrase, highlights it, and opens the matching document', async () => {
    const user = userEvent.setup();
    const { api } = await seed(user);
    await user.type(screen.getByLabelText('Search documents'), '"north bridge"');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(api.searchDocuments).toHaveBeenCalledWith('"north bridge"');
    const items = within(results).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0] as HTMLElement).getByText('Bridge report')).toBeInTheDocument();
    const mark = items[0]?.querySelector('mark');
    expect(mark?.textContent).toBe('north');
    expect(screen.getByText(/1 match for/)).toBeInTheDocument();

    await user.click(within(results).getByRole('button', { name: /Bridge report/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Bridge report' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Document text' })).toHaveTextContent(/north bridge/);
  });

  it('submits with the Enter key and says when nothing matches', async () => {
    const user = userEvent.setup();
    await seed(user);
    await user.type(screen.getByLabelText('Search documents'), 'volcano{Enter}');
    expect(await screen.findByText(/No documents match/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
  });

  it('does not call the backend for a blank search and Clear restores the library', async () => {
    const user = userEvent.setup();
    const { api } = await seed(user);
    await user.type(screen.getByLabelText('Search documents'), '   {Enter}');
    expect(api.searchDocuments).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Search documents'), 'water{Enter}');
    expect(await screen.findByRole('list', { name: 'Search results' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('list', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search documents')).toHaveValue('');
  });

  it('passes hostile queries through untouched and shows backend rejections safely', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.searchDocuments.mockRejectedValueOnce(
      new ApiError('validation', 'That search could not be understood.'),
    );
    renderApp(api);
    const hostile = `"; DROP TABLE documents; -- <img src=x onerror=alert(1)> OR *`;
    await user.type(screen.getByLabelText('Search documents'), hostile.replaceAll('{', '{{'));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That search could not be understood.',
    );
    expect(api.searchDocuments).toHaveBeenCalledWith(hostile);
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders snippets containing markup as plain text', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.searchDocuments.mockResolvedValueOnce([
      {
        id: 1,
        title: 'x',
        format: 'md',
        snippet: '<b>bold</b> \u0001<script>x</script>\u0002 end',
        importedAt: '2026-11-03T12:00:00.000Z',
      },
    ]);
    const { container } = renderApp(api);
    await user.type(screen.getByLabelText('Search documents'), 'x{Enter}');
    await screen.findByRole('list', { name: 'Search results' });
    expect(container.querySelector('b, script')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('<script>x</script>');
  });

  it('labels native search as SQLite FTS5 and the browser demo as a separate word scan', async () => {
    renderApp();
    expect(screen.getByTestId('search-engine-note')).toHaveTextContent(
      /SQLite full-text search \(FTS5\)/,
    );
    vi.stubEnv('MODE', 'browser-demo');
    try {
      const demo = renderApp();
      const notes = demo.getAllByTestId('search-engine-note');
      expect(notes[notes.length - 1]).toHaveTextContent(/not SQLite FTS5/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Archive documents: offline', () => {
  it('makes no network calls while importing, searching and reading', async () => {
    const forbidden = {
      fetch: vi.fn(),
      XMLHttpRequest: vi.fn(),
      WebSocket: vi.fn(),
      EventSource: vi.fn(),
    };
    for (const [name, stub] of Object.entries(forbidden)) vi.stubGlobal(name, stub);
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    try {
      const user = userEvent.setup();
      renderApp();
      await importFiles(user, textFile('offline.md', 'works without a network'));
      await screen.findByRole('article');
      await user.type(screen.getByLabelText('Search documents'), 'network{Enter}');
      await user.click(await screen.findByRole('button', { name: /offline/ }));
      for (const [name, stub] of Object.entries(forbidden)) {
        expect(stub, `${name} must never be called`).not.toHaveBeenCalled();
      }
      expect(sendBeacon).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'sendBeacon');
    }
  });
});
