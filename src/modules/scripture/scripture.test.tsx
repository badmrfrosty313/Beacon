import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/types';
import { createFakeApi, renderApp } from '../../test/fakeApi';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Storage may be unavailable; the reader must cope with that too.
  }
});

async function openScripture(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Scripture/ }));
  return screen.findByRole('article');
}

async function goTo(user: ReturnType<typeof userEvent.setup>, reference: string) {
  const input = screen.getByLabelText('Go to reference');
  await user.clear(input);
  await user.type(input, reference);
  await user.click(screen.getByRole('button', { name: 'Go' }));
}

describe('Scripture reader', () => {
  it('opens at a readable passage with a visible translation identifier', async () => {
    const user = userEvent.setup();
    renderApp();
    const article = await openScripture(user);
    expect(within(article).getByRole('heading', { level: 2, name: 'Genesis 1' })).toBeVisible();
    expect(within(article).getByText('WEB')).toBeVisible();
    expect(within(article).getByText(/In the beginning, God created/)).toBeVisible();
    expect(within(article).getByRole('button', { name: 'Verse 1' })).toBeVisible();
  });

  it.each([
    ['Genesis 1:1', 'Genesis 1:1', /In the beginning/],
    ['John 3:16', 'John 3:16', /For God so loved the world/],
    ['Psalm 23', 'Psalm 23', /The LORD is my shepherd/],
    ['Revelation 13:16-18', 'Revelation 13:16-18', /six hundred sixty-six/],
    ['Rev 13:18', 'Revelation 13:18', /six hundred sixty-six/],
    ['1 John 4:1', '1 John 4:1', /Beloved, don’t believe every spirit/],
    ['3 John 1:2', '3 John 1:2', /Beloved, I pray/],
  ])('looks up %s', async (input, canonical, text) => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, input);
    expect(await screen.findByRole('heading', { level: 2, name: canonical })).toBeVisible();
    expect(screen.getByRole('article')).toHaveTextContent(text);
  });

  it('explains an invalid reference without losing the current passage', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, 'John 22');
    expect(await screen.findByRole('alert')).toHaveTextContent(/John has 21 chapters/);
    expect(screen.getByRole('heading', { level: 2, name: 'Genesis 1' })).toBeVisible();

    await goTo(user, 'Hezekiah 4');
    expect(await screen.findByRole('alert')).toHaveTextContent(/No book matches/);
  });

  it('treats hostile input as plain text', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, '<img src=x onerror=alert(1)>');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('moves to the next and previous chapter, across book boundaries', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, 'Genesis 50');
    await screen.findByRole('heading', { level: 2, name: 'Genesis 50' });
    await user.click(screen.getAllByRole('button', { name: 'Next chapter: Exodus 1' })[0]!);
    expect(await screen.findByRole('heading', { level: 2, name: 'Exodus 1' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Previous chapter: Genesis 50' })[0]!);
    expect(await screen.findByRole('heading', { level: 2, name: 'Genesis 50' })).toBeVisible();
  });

  it('disables previous at Genesis 1 and next at Revelation 22', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    expect(screen.getAllByRole('button', { name: 'No previous chapter' })[0]).toBeDisabled();
    await goTo(user, 'Revelation 22');
    await screen.findByRole('heading', { level: 2, name: 'Revelation 22' });
    expect(screen.getAllByRole('button', { name: 'No next chapter' })[0]).toBeDisabled();
  });

  it('selects a book and chapter with the pickers', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await user.selectOptions(screen.getByLabelText('Book'), 'Revelation');
    expect(await screen.findByRole('heading', { level: 2, name: 'Revelation 1' })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Chapter'), '13');
    expect(await screen.findByRole('heading', { level: 2, name: 'Revelation 13' })).toBeVisible();
  });

  it('shows the five footnote-only verses honestly instead of inventing text', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, 'Luke 17:36');
    const article = await screen.findByRole('article');
    expect(within(article).getByRole('button', { name: 'Verse 36' })).toBeVisible();
    expect(article.querySelector('.verse-missing')).not.toBeNull();
  });

  it('shows provenance under “About this text”', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await user.click(screen.getByText('About this text'));
    expect(screen.getAllByText(/Public Domain/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/a93df5571009fed56f77e3ac1d3ce71c9a3a3df1486f7570cc7a8f823192fdba/)
        .length,
    ).toBeGreaterThan(0);
  });

  it('reports unavailable Scripture data without touching notes', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.getScriptureOverview.mockRejectedValue(
      new ApiError('scripture_unavailable', 'The Scripture reference data is unavailable (x).'),
    );
    renderApp(api);
    await user.click(screen.getByRole('button', { name: /^Scripture/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/);
    await user.click(screen.getByRole('button', { name: /^Archive/ }));
    expect(await screen.findByText('No documents yet.')).toBeVisible();
  });
});

describe('Revelation 13:18 workflow (definition of done)', () => {
  it('reads, selects, copies, creates a note, saves it and returns to the passage', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await openScripture(user);

    await user.selectOptions(screen.getByLabelText('Book'), 'Revelation');
    await user.selectOptions(screen.getByLabelText('Chapter'), '13');
    await screen.findByRole('heading', { level: 2, name: 'Revelation 13' });

    const verse18 = screen.getByRole('button', { name: 'Verse 18' });
    await user.click(verse18);
    expect(verse18).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Revelation 13:18', { selector: 'strong' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Copy reference' }));
    expect(await navigator.clipboard.readText()).toBe('Revelation 13:18');
    expect(await screen.findByText(/Copied/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create note from reference' }));
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Revelation 13:18');
    expect(screen.getByLabelText('Note text')).toHaveValue(
      'Scripture reference: Revelation 13:18 (WEB)\n\nMy notes:\n',
    );

    await user.type(screen.getByLabelText('Note text'), 'Compare with Daniel 7.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Revelation 13:18' }),
    ).toBeVisible();
    expect(api.createNote).toHaveBeenCalledWith({
      title: 'Revelation 13:18',
      body: 'Scripture reference: Revelation 13:18 (WEB)\n\nMy notes:\nCompare with Daniel 7.',
    });

    // The note links back to the passage.
    await user.click(screen.getByRole('button', { name: 'Open Revelation 13:18 in Scripture' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Revelation 13:18' }),
    ).toBeVisible();
    expect(screen.getByRole('article')).toHaveTextContent(/six hundred sixty-six/);
  });

  it('remembers the reading position after leaving and returning', async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await openScripture(user);
    await goTo(user, 'Revelation 13');
    await screen.findByRole('heading', { level: 2, name: 'Revelation 13' });
    first.unmount();

    renderApp();
    await openScripture(userEvent.setup());
    expect(await screen.findByRole('heading', { level: 2, name: 'Revelation 13' })).toBeVisible();
  });

  it('copies a range and offers the canonical form', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    await goTo(user, 'Revelation 13');
    await screen.findByRole('heading', { level: 2, name: 'Revelation 13' });
    await user.click(screen.getByRole('button', { name: 'Verse 16' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: 'Verse 18' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByText('Revelation 13:16-18', { selector: 'strong' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Copy reference' }));
    expect(await navigator.clipboard.readText()).toBe('Revelation 13:16-18');
  });

  it('does not overwrite an unsaved note draft', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'my draft');

    await openScripture(user);
    const create = screen.getByRole('button', { name: 'Create note from reference' });
    expect(create).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open the unsaved note' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('my draft');
  });

  it('is operable from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();
    await openScripture(user);
    const input = screen.getByLabelText('Go to reference');
    input.focus();
    await user.keyboard('Psalm 23{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Psalm 23' })).toBeVisible();
    await user.tab();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});

describe('Scripture and the offline guarantee', () => {
  it('never calls fetch, XHR, WebSocket or sendBeacon while reading', async () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const wsSpy = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    try {
      const user = userEvent.setup();
      renderApp();
      await openScripture(user);
      await goTo(user, 'Revelation 13:16-18');
      await screen.findByRole('heading', { level: 2, name: 'Revelation 13:16-18' });
      await user.click(screen.getByRole('button', { name: 'Copy reference' }));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();
      expect(wsSpy).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
