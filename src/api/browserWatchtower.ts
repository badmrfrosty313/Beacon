/**
 * Watchtower over IndexedDB, for the hosted browser demo ONLY. It applies the same rules as the
 * Rust backend (src-tauri/src/watchtower), through the same shared validation, in a single
 * IndexedDB transaction per write so a rejected write leaves nothing behind. Native builds
 * never use this code.
 */
import type { BeaconApi } from './beaconApi';
import {
  ApiError,
  type EventInput,
  type EvidenceLink,
  type HypothesisInput,
  type LinkInput,
  type ResearchClaim,
  type ResearchEvent,
  type ResearchHypothesis,
  type ResearchSource,
  type SourceInput,
  type WatchtowerSnapshot,
} from './types';
import {
  MAX_EXPLANATION_CHARS,
  MAX_RECORDS_PER_TABLE,
  MAX_TEXT_CHARS,
  ValidationFailure,
  claimKind,
  hypothesisStatus,
  linkRelation,
  optionalCalendarDate,
  optionalEventDate,
  optionalLine,
  optionalScriptureReference,
  optionalText,
  optionalUrl,
  requiredLine,
  requiredText,
} from '../lib/watchtower/validation';

export const WATCHTOWER_STORES = {
  events: 'wt_events',
  sources: 'wt_sources',
  claims: 'wt_claims',
  hypotheses: 'wt_hypotheses',
  links: 'wt_links',
} as const;

/** Runs `work` inside one IndexedDB transaction over `stores`; a thrown error aborts it. */
export type RunTransaction = <T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
) => Promise<T>;

type WatchtowerApi = Pick<
  BeaconApi,
  | 'getWatchtower'
  | 'createEvent'
  | 'updateEvent'
  | 'createSource'
  | 'updateSource'
  | 'createClaim'
  | 'createHypothesis'
  | 'updateHypothesis'
  | 'createEvidenceLink'
>;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

const now = () => new Date().toISOString();

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function createBrowserWatchtower(
  run: RunTransaction,
  documentsStore: string,
): WatchtowerApi {
  const S = WATCHTOWER_STORES;

  /** Turn validation failures into the same `validation` error the native backend reports. */
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ValidationFailure) throw new ApiError('validation', error.message);
      throw error;
    }
  }

  async function exists(tx: IDBTransaction, store: string, id: unknown): Promise<boolean> {
    if (!isId(id)) return false;
    return (await request(tx.objectStore(store).count(IDBKeyRange.only(id)))) > 0;
  }

  async function require_(
    tx: IDBTransaction,
    store: string,
    id: unknown,
    message: string,
  ): Promise<void> {
    if (!(await exists(tx, store, id))) throw new ValidationFailure(message);
  }

  async function ensureRoom(tx: IDBTransaction, store: string): Promise<void> {
    const count = await request(tx.objectStore(store).count());
    if (count >= MAX_RECORDS_PER_TABLE) {
      throw new ValidationFailure(
        `This workspace already holds the maximum of ${MAX_RECORDS_PER_TABLE} records of this kind.`,
      );
    }
  }

  async function insert<T extends { id: number }>(
    tx: IDBTransaction,
    store: string,
    record: Omit<T, 'id'>,
  ): Promise<T> {
    const key = await request(tx.objectStore(store).add(record));
    return { ...record, id: Number(key) } as T;
  }

  async function replace<T extends { id: number }>(
    tx: IDBTransaction,
    store: string,
    id: number,
    change: (existing: T) => T,
  ): Promise<T> {
    if (!isId(id)) throw new ApiError('validation', 'That item could not be found.');
    const existing = (await request(tx.objectStore(store).get(id))) as T | undefined;
    if (existing === undefined) throw new ApiError('not_found', 'That item could not be found.');
    const next = change(existing);
    await request(tx.objectStore(store).put(next));
    return next;
  }

  // ---- events ---------------------------------------------------------------------------

  function eventFields(input: EventInput) {
    const date = optionalEventDate(input.eventDate);
    return {
      title: requiredLine('The title', input.title),
      description: optionalText('The description', input.description),
      eventDate: date?.text ?? null,
      datePrecision: date?.precision ?? null,
      eventSort: date?.sort ?? null,
    };
  }

  // ---- sources --------------------------------------------------------------------------

  async function sourceFields(tx: IDBTransaction, input: SourceInput) {
    const fields = {
      title: requiredLine('The title', input.title),
      author: optionalLine('The author', input.author),
      publisher: optionalLine('The publisher', input.publisher),
      url: optionalUrl(input.url),
      publishedDate: optionalCalendarDate('Published date', input.publishedDate),
      retrievedDate: optionalCalendarDate('Retrieved date', input.retrievedDate),
      documentId: input.documentId ?? null,
      note: optionalText('The note', input.note),
    };
    if (
      fields.author === null &&
      fields.publisher === null &&
      fields.url === null &&
      fields.documentId === null
    ) {
      throw new ValidationFailure(
        'Give at least one way to identify the source: an author, a publisher, a URL or an Archive document.',
      );
    }
    if (fields.documentId !== null) {
      await require_(
        tx,
        documentsStore,
        fields.documentId,
        'That Archive document does not exist.',
      );
    }
    return fields;
  }

  // ---- hypotheses -----------------------------------------------------------------------

  function hypothesisFields(input: HypothesisInput) {
    return {
      title: requiredLine('The title', input.title),
      statement: requiredText('The statement', input.statement, MAX_TEXT_CHARS),
      status: input.status === undefined ? ('open' as const) : hypothesisStatus(input.status),
      scriptureReference: optionalScriptureReference(input.scriptureReference),
    };
  }

  // ---- compare helpers ------------------------------------------------------------------

  const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

  function byEventTime(a: ResearchEvent, b: ResearchEvent): number {
    if (a.eventSort === null && b.eventSort === null) return a.id - b.id;
    if (a.eventSort === null) return 1;
    if (b.eventSort === null) return -1;
    return a.eventSort - b.eventSort || a.id - b.id;
  }

  return {
    getWatchtower: () =>
      run(Object.values(S), 'readonly', async (tx): Promise<WatchtowerSnapshot> => {
        const all = async <T>(store: string) =>
          (await request(tx.objectStore(store).getAll())) as T[];
        const [events, sources, claims, hypotheses, links] = await Promise.all([
          all<ResearchEvent>(S.events),
          all<ResearchSource>(S.sources),
          all<ResearchClaim>(S.claims),
          all<ResearchHypothesis>(S.hypotheses),
          all<EvidenceLink>(S.links),
        ]);
        const cap = <T>(rows: T[]) => rows.slice(0, MAX_RECORDS_PER_TABLE);
        return {
          events: cap(events.sort(byEventTime)),
          sources: cap(sources.sort(byId)),
          claims: cap(claims.sort(byId)),
          hypotheses: cap(hypotheses.sort(byId)),
          links: cap(links.sort(byId)),
        };
      }),

    createEvent: (input) =>
      guarded(() =>
        run([S.events], 'readwrite', async (tx) => {
          const fields = eventFields(input);
          await ensureRoom(tx, S.events);
          const stamp = now();
          return insert<ResearchEvent>(tx, S.events, {
            ...fields,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }),
      ),

    updateEvent: (id, input) =>
      guarded(() =>
        run([S.events], 'readwrite', async (tx) => {
          const fields = eventFields(input);
          return replace<ResearchEvent>(tx, S.events, id, (existing) => ({
            ...existing,
            ...fields,
            updatedAt: now(),
          }));
        }),
      ),

    createSource: (input) =>
      guarded(() =>
        run([S.sources, documentsStore], 'readwrite', async (tx) => {
          const fields = await sourceFields(tx, input);
          await ensureRoom(tx, S.sources);
          const stamp = now();
          return insert<ResearchSource>(tx, S.sources, {
            ...fields,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }),
      ),

    updateSource: (id, input) =>
      guarded(() =>
        run([S.sources, documentsStore], 'readwrite', async (tx) => {
          const fields = await sourceFields(tx, input);
          return replace<ResearchSource>(tx, S.sources, id, (existing) => ({
            ...existing,
            ...fields,
            updatedAt: now(),
          }));
        }),
      ),

    createClaim: (input) =>
      guarded(() =>
        run([S.claims, S.events, S.sources], 'readwrite', async (tx) => {
          const kind = claimKind(input.kind);
          const text = requiredText('The statement', input.text, MAX_TEXT_CHARS);
          const attribution = optionalLine('The attribution', input.attribution);
          const scriptureReference = optionalScriptureReference(input.scriptureReference);
          if (kind === 'attributed_claim' && attribution === null) {
            throw new ValidationFailure(
              'An attributed claim must say who made the claim. Fill in the attribution.',
            );
          }
          await require_(tx, S.events, input.eventId, 'That event does not exist.');
          const sourceId = input.sourceId ?? null;
          if (sourceId !== null) {
            await require_(tx, S.sources, sourceId, 'That source does not exist.');
          }
          await ensureRoom(tx, S.claims);
          const stamp = now();
          return insert<ResearchClaim>(tx, S.claims, {
            eventId: input.eventId,
            sourceId,
            kind,
            text,
            attribution,
            scriptureReference,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }),
      ),

    createHypothesis: (input) =>
      guarded(() =>
        run([S.hypotheses], 'readwrite', async (tx) => {
          const fields = hypothesisFields(input);
          await ensureRoom(tx, S.hypotheses);
          const stamp = now();
          return insert<ResearchHypothesis>(tx, S.hypotheses, {
            ...fields,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }),
      ),

    updateHypothesis: (id, input) =>
      guarded(() =>
        run([S.hypotheses], 'readwrite', async (tx) => {
          const fields = hypothesisFields(input);
          return replace<ResearchHypothesis>(tx, S.hypotheses, id, (existing) => ({
            ...existing,
            ...fields,
            updatedAt: now(),
          }));
        }),
      ),

    createEvidenceLink: (input: LinkInput) =>
      guarded(() =>
        run([S.links, S.hypotheses, S.claims, S.sources, S.events], 'readwrite', async (tx) => {
          const relation = linkRelation(input.relation);
          const explanation = requiredText(
            'The explanation',
            input.explanation,
            MAX_EXPLANATION_CHARS,
          );
          const claimId = input.claimId ?? null;
          const sourceId = input.sourceId ?? null;
          const eventId = input.eventId ?? null;
          if (claimId === null && sourceId === null) {
            throw new ValidationFailure('Choose the evidence: a claim, a source, or both.');
          }
          if (claimId !== null && eventId !== null) {
            throw new ValidationFailure(
              'A claim already belongs to an event. Choose the claim or an event, not both.',
            );
          }
          await require_(tx, S.hypotheses, input.hypothesisId, 'That hypothesis does not exist.');
          if (claimId !== null) await require_(tx, S.claims, claimId, 'That claim does not exist.');
          if (sourceId !== null) {
            await require_(tx, S.sources, sourceId, 'That source does not exist.');
          }
          if (eventId !== null) await require_(tx, S.events, eventId, 'That event does not exist.');

          const existing = (await request(tx.objectStore(S.links).getAll())) as EvidenceLink[];
          const duplicate = existing.some(
            (link) =>
              link.hypothesisId === input.hypothesisId &&
              link.relation === relation &&
              link.claimId === claimId &&
              link.sourceId === sourceId &&
              link.eventId === eventId,
          );
          if (duplicate) {
            throw new ValidationFailure(
              'This evidence is already linked to that hypothesis with the same relationship.',
            );
          }
          await ensureRoom(tx, S.links);
          return insert<EvidenceLink>(tx, S.links, {
            hypothesisId: input.hypothesisId,
            relation,
            claimId,
            sourceId,
            eventId,
            explanation,
            createdAt: now(),
          });
        }),
      ),
  };
}
