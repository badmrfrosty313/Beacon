import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api/types';
import { DEFAULT_INFO, createFakeApi, note, renderApp } from './test/fakeApi';

describe('navigation and branding', () => {
  it('shows the PROJECT BEACON brand and the four modules', () => {
    renderApp();
    expect(screen.getByText('PROJECT')).toBeInTheDocument();
    expect(screen.getByText('BEACON')).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Modules' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.querySelector('.nav-label')?.textContent);
    expect(labels).toEqual(['Archive', 'Watchtower', 'Lifeline', 'Settings']);
  });

  it('starts on Archive and marks it as the current page', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /^Archive/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Archive' })).toBeInTheDocument();
  });

  it('labels the unimplemented modules in the navigation', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(nav).getAllByText('Not implemented')).toHaveLength(2);
    expect(within(nav).getByRole('button', { name: /Watchtower.*Not implemented/ })).toBeVisible();
    expect(within(nav).getByRole('button', { name: /Lifeline.*Not implemented/ })).toBeVisible();
  });

  it.each([
    ['Watchtower', /Planned for v0\.1, Sprint 004/],
    ['Lifeline', /Planned for v0\.2/],
  ])('shows a clearly labeled placeholder for %s', async (name, plannedFor) => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByText('Not implemented yet')).toBeInTheDocument();
    expect(screen.getByText(/Nothing in this section works yet/)).toBeInTheDocument();
    expect(screen.getByText(plannedFor)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows app information and honest storage limitations in Settings', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));

    expect(await screen.findByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_INFO.dataDir)).toBeInTheDocument();
    expect(screen.getByText('not encrypted')).toBeInTheDocument();
  });

  it('surfaces a database initialization failure in Settings', async () => {
    const user = userEvent.setup();
    const api = createFakeApi([], {
      ...DEFAULT_INFO,
      schemaVersion: null,
      databaseError: 'unable to open database file',
    });
    renderApp(api);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'BEACON could not open its local database: unable to open database file',
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});

describe('Archive notes', () => {
  it('shows an empty state when there are no notes', async () => {
    renderApp();
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Start with a note' }),
    ).toBeInTheDocument();
  });

  it('clearly labels notes as a demo and defers import/search', () => {
    renderApp();
    expect(screen.getByText('Sprint 001 demo')).toBeInTheDocument();
    expect(screen.getByText(/not implemented yet/i)).toBeInTheDocument();
  });

  it('lists saved notes newest first and shows the selected note', async () => {
    const user = userEvent.setup();
    renderApp(
      createFakeApi([note(1, 'Older note', 'old body'), note(2, 'Newer note', 'new body')]),
    );

    const list = await screen.findByRole('list', { name: 'Notes' });
    const titles = within(list)
      .getAllByRole('button')
      .map((button) => button.querySelector('.note-item-title')?.textContent);
    expect(titles).toEqual(['Newer note', 'Older note']);

    await user.click(within(list).getByRole('button', { name: /Older note/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Older note' }),
    ).toBeInTheDocument();
    expect(screen.getByText('old body')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Older note/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('creates a note and then displays it', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Water plan');
    await user.type(
      screen.getByLabelText('Note text'),
      'Store 4 liters per person.{Enter}Rotate yearly.',
    );
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(api.createNote).toHaveBeenCalledTimes(1);
    expect(api.createNote).toHaveBeenCalledWith({
      title: 'Water plan',
      body: 'Store 4 liters per person.\nRotate yearly.',
    });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Water plan' }),
    ).toBeInTheDocument();
    expect(document.querySelector('.note-body')).toHaveTextContent(
      'Store 4 liters per person. Rotate yearly.',
    );
    // The list refreshes to include the new note.
    const list = await screen.findByRole('list', { name: 'Notes' });
    expect(within(list).getByRole('button', { name: /Water plan/ })).toBeInTheDocument();
    // And the form is gone.
    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
  });

  it('allows a note with an empty body', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Just a title');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(api.createNote).toHaveBeenCalledWith({ title: 'Just a title', body: '' });
    expect(await screen.findByText('This note has no body.')).toBeInTheDocument();
  });

  it('rejects an empty title without calling the backend', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A title is required.');
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it('rejects an over-long title without calling the backend', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByLabelText('Title'));
    await user.paste('x'.repeat(201));
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 200 characters');
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it('shows a backend failure and keeps what the user typed', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.createNote.mockRejectedValueOnce(
      new ApiError('database', 'BEACON could not read or write its local database.'),
    );
    renderApp(api);

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Keep me');
    await user.type(screen.getByLabelText('Note text'), 'important text');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'BEACON could not read or write its local database.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Keep me');
    expect(screen.getByLabelText('Note text')).toHaveValue('important text');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled();

    // The user can simply try again.
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Keep me' })).toBeInTheDocument();
  });

  it('shows a list failure with a working Retry', async () => {
    const user = userEvent.setup();
    const api = createFakeApi([note(1, 'Recovered note')]);
    api.listNotes.mockRejectedValueOnce(
      new ApiError('unavailable', 'BEACON could not open its local database: disk is full'),
    );
    renderApp(api);

    expect(await screen.findByRole('alert')).toHaveTextContent('disk is full');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Recovered note/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error if a note cannot be loaded', async () => {
    const user = userEvent.setup();
    const api = createFakeApi([note(1, 'Fragile')]);
    api.getNote.mockRejectedValueOnce(new ApiError('not_found', 'That note could not be found.'));
    renderApp(api);

    await user.click(await screen.findByRole('button', { name: /Fragile/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That note could not be found.');
  });

  it('renders note content as inert text, never as HTML', async () => {
    const user = userEvent.setup();
    const hostile = '<img src=x onerror="window.pwned=true"><b>bold</b>';
    const { container } = renderApp(
      createFakeApi([note(1, '<script>window.pwned=true</script>', hostile)]),
    );

    await user.click(await screen.findByRole('button', { name: /script/ }));
    const body = await screen.findByText(hostile);
    expect(body).toBeInTheDocument();
    expect(container.querySelector('.note-body img')).toBeNull();
    expect(container.querySelector('.note-body b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('preserves a draft when viewing another note and returning to New note', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(createFakeApi([note(1, 'Saved note')]));

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Unfinished');
    await user.type(screen.getByLabelText('Note text'), 'Do not lose this');
    await user.click(await screen.findByRole('button', { name: /Saved note/ }));
    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(screen.getByLabelText('Title')).toHaveValue('Unfinished');
    expect(screen.getByLabelText('Note text')).toHaveValue('Do not lose this');
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it('preserves a draft across module navigation', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Research draft');
    await user.type(screen.getByLabelText('Note text'), 'Source to review');
    await user.click(screen.getByRole('button', { name: /^Watchtower/ }));
    await user.click(screen.getByRole('button', { name: /^Archive/ }));

    expect(screen.getByLabelText('Title')).toHaveValue('Research draft');
    expect(screen.getByLabelText('Note text')).toHaveValue('Source to review');
  });

  it('clears the draft after a successful save', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Saved title');
    await user.type(screen.getByLabelText('Note text'), 'Saved body');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Saved title' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Note text')).toHaveValue('');
  });

  it('keeps a save pending across module navigation without allowing duplicate saves', async () => {
    const user = userEvent.setup();
    const api = createFakeApi([note(1, 'Existing note')]);
    const performSave = api.createNote.getMockImplementation()!;
    let completeSave!: () => void;
    api.createNote.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        completeSave = resolve;
      });
      return performSave(input);
    });
    renderApp(api);

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'In-flight save');
    await user.type(screen.getByLabelText('Note text'), 'The original body');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(api.createNote).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /^Watchtower/ }));
    await user.click(screen.getByRole('button', { name: /^Archive/ }));

    // A remounted form must not reset saving state or permit cancelling/replacing its draft.
    expect(screen.getByLabelText('Title')).toHaveValue('In-flight save');
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Note text')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(api.createNote).toHaveBeenCalledTimes(1);

    // The user can navigate to a different saved note; completion must not hijack it.
    await user.click(await screen.findByRole('button', { name: /Existing note/ }));
    await act(async () => completeSave());

    expect(await screen.findByRole('heading', { level: 2, name: 'Existing note' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /In-flight save/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Note text')).toHaveValue('');
    expect(api.createNote).toHaveBeenCalledTimes(1);
  });

  it('preserves a draft and save error after navigating away during a failed save', async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    let rejectSave!: (error: Error) => void;
    api.createNote.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    renderApp(api);

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'Keep after failure');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await act(async () => rejectSave(new Error('Unable to save right now')));
    await user.click(screen.getByRole('button', { name: /^Archive/ }));

    expect(screen.getByLabelText('Title')).toHaveValue('Keep after failure');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save right now');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled();
  });

  it('cancelling the form returns to the empty state without saving', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), 'draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(api.createNote).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Note text')).toHaveValue('');
  });
});

describe('offline behaviour', () => {
  it('makes no network calls while navigating and saving a note', async () => {
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

      for (const name of ['Watchtower', 'Lifeline', 'Settings', 'Archive']) {
        await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      }
      await user.click(await screen.findByRole('button', { name: 'New note' }));
      await user.type(screen.getByLabelText('Title'), 'offline note');
      await user.click(screen.getByRole('button', { name: 'Save note' }));
      expect(
        await screen.findByRole('heading', { level: 2, name: 'offline note' }),
      ).toBeInTheDocument();

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
