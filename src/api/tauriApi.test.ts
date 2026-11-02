import { afterEach, describe, expect, it, vi } from 'vitest';

import { toApiError, errorMessage } from './errors';
import { createTauriApi, isTauriRuntime, type InvokeFn } from './tauriApi';
import { ApiError } from './types';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

afterEach(() => {
  invokeMock.mockReset();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

function fakeInvoke(result: unknown = undefined) {
  const fn = vi.fn(async () => result);
  return { fn, invoke: fn as unknown as InvokeFn };
}

describe('createTauriApi: command contract with src-tauri/src/commands.rs', () => {
  it('maps getAppInfo to app_info with no arguments', async () => {
    const { fn, invoke } = fakeInvoke({ appVersion: '0.1.0' });
    await expect(createTauriApi(invoke).getAppInfo()).resolves.toEqual({ appVersion: '0.1.0' });
    expect(fn).toHaveBeenCalledWith('app_info', undefined);
  });

  it('maps listNotes to list_notes', async () => {
    const { fn, invoke } = fakeInvoke([]);
    await createTauriApi(invoke).listNotes();
    expect(fn).toHaveBeenCalledWith('list_notes', undefined);
  });

  it('maps getNote to get_note with an `id` argument', async () => {
    const { fn, invoke } = fakeInvoke({ id: 7 });
    await createTauriApi(invoke).getNote(7);
    expect(fn).toHaveBeenCalledWith('get_note', { id: 7 });
  });

  it('maps createNote to create_note with exactly `title` and `body`', async () => {
    const { fn, invoke } = fakeInvoke({ id: 1 });
    await createTauriApi(invoke).createNote({ title: 'T', body: 'B' });
    expect(fn).toHaveBeenCalledWith('create_note', { title: 'T', body: 'B' });
  });
});

describe('error handling', () => {
  it('turns the backend { code, message } payload into an ApiError', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'validation', message: 'A title is required.' };
    }) as unknown as InvokeFn;

    const error = await createTauriApi(invoke)
      .createNote({ title: '', body: '' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'validation', message: 'A title is required.' });
  });

  it('maps an unrecognized code to "unknown" but keeps the message', () => {
    expect(toApiError({ code: 'brand_new_code', message: 'hello' })).toMatchObject({
      code: 'unknown',
      message: 'hello',
    });
  });

  it('accepts plain string rejections', () => {
    expect(toApiError('boom')).toMatchObject({ code: 'unknown', message: 'boom' });
  });

  it('falls back to a generic message for anything else', () => {
    expect(errorMessage(undefined)).toBe('An unexpected error occurred.');
    expect(errorMessage(42)).toBe('An unexpected error occurred.');
    expect(errorMessage({ code: 'x' })).toBe('An unexpected error occurred.');
  });

  it('passes an existing ApiError through unchanged', () => {
    const original = new ApiError('not_found', 'gone');
    expect(toApiError(original)).toBe(original);
  });
});

describe('running outside the Tauri shell', () => {
  it('detects the runtime via __TAURI_INTERNALS__', () => {
    expect(isTauriRuntime()).toBe(false);
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    expect(isTauriRuntime()).toBe(true);
  });

  it('fails with a clear backend_unavailable error instead of a TypeError', async () => {
    const error = await createTauriApi()
      .listNotes()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'backend_unavailable' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('uses the real invoke when the Tauri runtime is present', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    invokeMock.mockResolvedValueOnce([]);
    await expect(createTauriApi().listNotes()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('list_notes', undefined);
  });
});
