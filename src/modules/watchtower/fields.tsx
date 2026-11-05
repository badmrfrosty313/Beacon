import { useId, useState, type ReactNode } from 'react';

import { errorMessage } from '../../api/errors';
import type { BeaconApi } from '../../api/beaconApi';
import { ApiError } from '../../api/types';
import { CLAIM_KIND_LABEL } from '../../lib/watchtower/model';
import type { ClaimKind } from '../../api/types';

/** A labelled control. `render` receives the generated id so the label is always connected. */
export function Field({
  label,
  hint,
  render,
}: {
  label: string;
  hint?: string;
  render: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {render(id, hintId)}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <Field
      label={props.label}
      hint={props.hint}
      render={(id, describedBy) => (
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={props.value}
          maxLength={props.maxLength}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    />
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <Field
      label={props.label}
      hint={props.hint}
      render={(id, describedBy) => (
        <textarea
          id={id}
          rows={props.rows ?? 3}
          value={props.value}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    />
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <Field
      label={props.label}
      hint={props.hint}
      render={(id, describedBy) => (
        <select
          id={id}
          value={props.value}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    />
  );
}

/** Shared submit handling: one request at a time, with a safe message on failure. */
export function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="banner banner-error">
      {message}
    </p>
  ) : null;
}

/** Trim to null so blank optional fields are stored as "not stated". */
export const blankToNull = (value: string): string | null => (value.trim() === '' ? null : value);

/**
 * Turn typed Scripture text into the canonical citation through the packaged-text engine, or
 * fail with the engine's own explanation. Blank means "no reference".
 */
export async function canonicalReference(api: BeaconApi, text: string): Promise<string | null> {
  if (text.trim() === '') return null;
  const result = await api.lookupScripture(text);
  if (!result.ok) throw new ApiError('validation', result.problem.message);
  return result.passage.canonical;
}

export function ClaimKindBadge({ kind }: { kind: ClaimKind }) {
  const GLYPH: Record<ClaimKind, string> = {
    observation: '◉',
    attributed_claim: '❝',
    interpretation: '◇',
    forecast: '▷',
  };
  return (
    <span className={`kind-badge kind-${kind}`}>
      <span aria-hidden="true">{GLYPH[kind]} </span>
      {CLAIM_KIND_LABEL[kind]}
    </span>
  );
}
