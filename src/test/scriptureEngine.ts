import canonText from '../../data/scripture/canon-protestant66.txt?raw';
import metaText from '../../data/scripture/engwebp.meta.txt?raw';
import tsv from '../../data/scripture/engwebp.tsv?raw';

import { verifyPackaged } from '../lib/scripture/data';
import { createScriptureEngine, type ScriptureEngine } from '../lib/scripture/engine';

let engine: ScriptureEngine | null = null;

/** The genuine packaged Bible, parsed and verified once per test worker. */
export function testScriptureEngine(): ScriptureEngine {
  engine ??= createScriptureEngine(verifyPackaged(canonText, metaText, tsv));
  return engine;
}
