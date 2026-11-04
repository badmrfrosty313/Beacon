/**
 * Loads the packaged Scripture text for the BROWSER DEMO only.
 *
 * The files live in data/scripture/ and are bundled with the site as a separate, lazily loaded
 * chunk served from the same origin: no external Bible service is ever contacted, and once the
 * chunk has loaded every lookup is in memory, so reading works with the network switched off.
 * The desktop app never uses this module: it reads the same files in Rust, and the guard below
 * lets the bundler drop the import (and the 4 MB of text) from the production desktop build.
 */
import { ApiError } from '../../api/types';
import { verifyPackaged } from './data';
import { createScriptureEngine, type ScriptureEngine } from './engine';

let engine: Promise<ScriptureEngine> | null = null;

async function load(): Promise<ScriptureEngine> {
  // `production` is the native build; the hosted demo builds with `--mode browser-demo`. The
  // constant condition lets the bundler drop the dynamic imports (and the text) from the
  // desktop build entirely.
  if (import.meta.env.MODE === 'production') {
    throw new ApiError(
      'scripture_unavailable',
      'Packaged Scripture is only bundled into the browser demo; the desktop app reads it natively.',
    );
  } else {
    const [canon, meta, tsv] = await Promise.all([
      import('../../../data/scripture/canon-protestant66.txt?raw'),
      import('../../../data/scripture/engwebp.meta.txt?raw'),
      import('../../../data/scripture/engwebp.tsv?raw'),
    ]);
    return createScriptureEngine(verifyPackaged(canon.default, meta.default, tsv.default));
  }
}

/** The shared engine; the first call loads and verifies the data, later calls reuse it. */
export function loadScriptureEngine(): Promise<ScriptureEngine> {
  if (engine === null) {
    engine = load().catch((error: unknown) => {
      engine = null; // allow a retry after a transient failure
      throw error instanceof ApiError
        ? error
        : new ApiError(
            'scripture_unavailable',
            `The packaged Scripture text could not be loaded (${error instanceof Error ? error.message : 'unknown error'}).`,
          );
    });
  }
  return engine;
}
