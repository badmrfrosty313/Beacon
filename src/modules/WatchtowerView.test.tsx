import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext';
import { createBrowserDemoApi } from '../api/browserDemoApi';
import type { BeaconApi } from '../api/beaconApi';
import { WatchtowerView } from './WatchtowerView';

// These tests drive a real IndexedDB through many form fields; a slow Windows runner needs room.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 60000 });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

function mount(api: BeaconApi, extra: Parameters<typeof WatchtowerView>[0] = {}) {
  return render(
    <ApiProvider api={api}>
      <WatchtowerView {...extra} />
    </ApiProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function createEvent(user: User, title: string, date: string) {
  await user.click(await screen.findByRole('button', { name: 'Events' }));
  await user.click(screen.getByRole('button', { name: 'New event' }));
  await user.type(screen.getByLabelText('Event title'), title);
  if (date) await user.type(screen.getByLabelText('Event date'), date);
  await user.click(screen.getByRole('button', { name: 'Create event' }));
  await screen.findByRole('article', { name: `Event: ${title}` });
}

async function addClaim(user: User, kind: string, text: string, attribution = '') {
  const form = screen.getByRole('form', { name: 'Add a statement to this event' });
  await user.selectOptions(within(form).getByLabelText('What kind of statement is this?'), kind);
  await user.type(within(form).getByLabelText('Statement'), text);
  if (attribution) await user.type(within(form).getByLabelText(/^Attribution/), attribution);
  await user.click(within(form).getByRole('button', { name: 'Add statement' }));
  await screen.findByText(text);
}

describe('Watchtower acceptance scenario (artificial data only)', () => {
  it('records an event, a source, classified statements and a hypothesis, links evidence both ways, and shows a timeline', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    mount(api);

    await createEvent(user, 'Artificial bridge closure', '2026-03-10');
    await createEvent(user, 'Artificial earlier event', '2025-12');

    // A source with provenance, entered as data only.
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: 'New source' }));
    await user.type(screen.getByLabelText('Source title'), 'Test County bulletin');
    await user.type(screen.getByLabelText('Publisher (optional)'), 'Test County');
    await user.type(
      screen.getByLabelText('Address (URL, optional)'),
      'https://example.org/bulletin',
    );
    await user.type(screen.getByLabelText('Published date (optional)'), '2026-03-11');
    await user.type(screen.getByLabelText('Retrieved date (optional)'), '2026-03-12');
    await user.click(screen.getByRole('button', { name: 'Create source' }));
    const sourcePane = await screen.findByRole('article', { name: 'Source: Test County bulletin' });
    expect(within(sourcePane).getByText('Metadata only — no offline copy')).toBeInTheDocument();
    expect(within(sourcePane).getByText('https://example.org/bulletin')).toBeInTheDocument();
    // Plain text, never a link the app could follow.
    expect(within(sourcePane).queryByRole('link')).not.toBeInTheDocument();

    // Statements of each kind on the closure event.
    await user.click(screen.getByRole('button', { name: 'Events' }));
    await user.click(screen.getByRole('button', { name: /Artificial bridge closure/ }));
    await addClaim(user, 'observation', 'The bridge was closed to traffic.');
    await addClaim(user, 'attributed_claim', 'Officials say repairs take a month.', 'Test County');
    await addClaim(user, 'interpretation', 'This suggests a budget problem.');
    await addClaim(user, 'forecast', 'The bridge will reopen in April.');
    const event = screen.getByRole('article', { name: 'Event: Artificial bridge closure' });
    for (const label of ['Observation', 'Attributed claim', 'Interpretation', 'Forecast']) {
      expect(within(event).getByText(label, { selector: '.kind-badge' })).toBeInTheDocument();
    }
    expect(within(event).getByText('Attributed to: Test County')).toBeInTheDocument();

    // A hypothesis, then one supporting and one contradicting link.
    await user.click(screen.getByRole('button', { name: 'Hypotheses' }));
    await user.click(screen.getByRole('button', { name: 'New hypothesis' }));
    await user.type(screen.getByLabelText('Hypothesis title'), 'Funding shortfall');
    await user.type(screen.getByLabelText('Proposition'), 'The closure came from a funding gap.');
    await user.click(screen.getByRole('button', { name: 'Create hypothesis' }));
    const hypothesis = await screen.findByRole('article', {
      name: 'Hypothesis: Funding shortfall',
    });
    expect(within(hypothesis).getByText(/a proposition, not a finding/)).toBeInTheDocument();

    async function link(relation: string, evidence: RegExp, why: string) {
      const form = screen.getByRole('form', { name: 'Link evidence to this hypothesis' });
      await user.selectOptions(within(form).getByLabelText('Relationship'), relation);
      const select = within(form).getByLabelText('Evidence');
      const option = within(select).getByRole('option', { name: evidence });
      await user.selectOptions(select, option);
      await user.type(within(form).getByLabelText('Why does it relate this way?'), why);
      await user.click(within(form).getByRole('button', { name: 'Link evidence' }));
      await screen.findByText(`Reason: ${why}`);
    }
    await link('supports', /Interpretation\): This suggests a budget problem/, 'Fits the claim.');
    await link('contradicts', /Forecast\): The bridge will reopen/, 'Implies it was temporary.');

    const supports = screen.getByRole('region', { name: /^Supports/ });
    const contradicts = screen.getByRole('region', { name: /^Contradicts/ });
    expect(within(supports).getByText(/This suggests a budget problem/)).toBeInTheDocument();
    expect(within(contradicts).getByText(/The bridge will reopen/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Context/ })).toHaveTextContent('None linked.');

    // Close and reopen: the status changes only because the person asked.
    await user.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(await screen.findByText('Set aside', { selector: 'strong' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText('Open', { selector: 'strong' })).toBeInTheDocument();

    // The timeline is ordered by EVENT date even though the later event was created first.
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    const items = within(screen.getByRole('list', { name: /Events by event date/ })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.querySelector('time')?.textContent)).toEqual([
      '2025-12',
      '2026-03-10',
    ]);
    expect(items[1]).toHaveTextContent('Funding shortfall (Open)');
    expect(items[1]).toHaveTextContent('Forecast 1');
  });

  it('still shows everything after a restart and makes no network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    const first = mount(createBrowserDemoApi());
    await createEvent(user, 'Artificial persistent event', '2026-01-02T03:04Z');
    first.unmount();

    // A brand-new API and view over the same storage, as after closing and reopening.
    mount(createBrowserDemoApi());
    expect(await screen.findByText('Artificial persistent event')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02T03:04Z')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Watchtower input handling', () => {
  it('explains an invalid date and an attributed claim with no attribution, saving nothing', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    mount(api);

    await user.click(await screen.findByRole('button', { name: 'Events' }));
    await user.click(screen.getByRole('button', { name: 'New event' }));
    await user.type(screen.getByLabelText('Event title'), 'Artificial event');
    await user.type(screen.getByLabelText('Event date'), 'next spring');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/date/i);
    expect((await api.getWatchtower()).events).toEqual([]);

    await user.clear(screen.getByLabelText('Event date'));
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByRole('article', { name: 'Event: Artificial event' });

    const form = screen.getByRole('form', { name: 'Add a statement to this event' });
    await user.selectOptions(
      within(form).getByLabelText('What kind of statement is this?'),
      'attributed_claim',
    );
    await user.type(within(form).getByLabelText('Statement'), 'Someone says so.');
    await user.click(within(form).getByRole('button', { name: 'Add statement' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/attribution/i);
    expect((await api.getWatchtower()).claims).toEqual([]);
  });

  it('lists an event with no date under "Undated" instead of inventing a date', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    await api.createEvent({ title: 'Artificial dated', eventDate: '2026-05-01' });
    await api.createEvent({ title: 'Artificial undated' });
    mount(api);

    expect(await screen.findByRole('heading', { name: 'Undated events' })).toBeInTheDocument();
    const undated = screen.getByRole('list', { name: 'Undated events' });
    expect(within(undated).getByText('Undated')).toBeInTheDocument();
    expect(within(undated).getByText('Artificial undated')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Show events with this kind of statement'),
      'forecast',
    );
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  });

  it('checks a Scripture reference against the packaged text and offers navigation', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const open = vi.fn();
    const event = await api.createEvent({ title: 'Artificial event' });
    await api.createClaim({
      eventId: event.id,
      kind: 'interpretation',
      text: 'A reading.',
      scriptureReference: 'Revelation 13:16-18',
    });
    mount(api, { onOpenScripture: open });

    await user.click(await screen.findByRole('button', { name: 'Events' }));
    await user.click(screen.getByRole('button', { name: /Artificial event/ }));
    await user.click(await screen.findByRole('button', { name: 'Open in Scripture' }));
    expect(open).toHaveBeenCalledWith('Revelation 13:16-18');
  });

  it('labels a source with a linked Archive document as a preserved copy', async () => {
    const api = createBrowserDemoApi();
    const doc = await api.importDocument({
      name: 'copy.txt',
      bytes: Array.from(new TextEncoder().encode('Artificial preserved text')),
    });
    await api.createSource({ title: 'Preserved source', documentId: doc.id });
    const user = userEvent.setup();
    mount(api);
    await user.click(await screen.findByRole('button', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: /Preserved source/ }));
    const pane = await screen.findByRole('article', { name: 'Source: Preserved source' });
    expect(within(pane).getByText('Preserved copy in your Archive')).toBeInTheDocument();
    expect(within(pane).getByText(doc.title)).toBeInTheDocument();
  });

  it('does not carry an unsaved draft from one event or hypothesis to another', async () => {
    const user = userEvent.setup();
    const api = createBrowserDemoApi();
    const a = await api.createEvent({ title: 'Artificial event A' });
    await api.createEvent({ title: 'Artificial event B' });
    await api.createHypothesis({ title: 'Hypothesis A', statement: 'First proposition.' });
    await api.createHypothesis({ title: 'Hypothesis B', statement: 'Second proposition.' });
    mount(api);

    await user.click(await screen.findByRole('button', { name: 'Events' }));
    await user.click(screen.getByRole('button', { name: /Artificial event A/ }));
    await user.type(await screen.findByLabelText('Statement'), 'Draft meant for A');
    await user.click(screen.getByRole('button', { name: /Artificial event B/ }));
    await screen.findByRole('article', { name: 'Event: Artificial event B' });
    expect(screen.getByLabelText('Statement')).toHaveValue('');
    expect(a.id).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Hypotheses' }));
    await user.click(screen.getByRole('button', { name: /Hypothesis A/ }));
    await user.type(await screen.findByLabelText('Why does it relate this way?'), 'Reason for A');
    await user.click(screen.getByRole('button', { name: /Hypothesis B/ }));
    await screen.findByRole('article', { name: 'Hypothesis: Hypothesis B' });
    expect(screen.getByLabelText('Why does it relate this way?')).toHaveValue('');
  });
});
