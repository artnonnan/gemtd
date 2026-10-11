/**
 * Hash of every source file that decides how a bot game plays out (game, data incl. blueprints, bot).
 * Shared by the AI command line (cache keys) and the dev server (vite.config.ts marks results made under older rules).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** src/ai files that only read results; changing them must not invalidate cached games */
const ANALYSIS_ONLY = new Set(['analyze.ts', 'report.ts', 'advisor.ts', 'tuner.ts', 'autoplay.ts', 'loadWeights.ts']);

function listFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(root, `${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}

export function rulesHash(root: string): string {
  const h = createHash('sha1');
  const files = [...listFiles(root, 'src/game'), ...listFiles(root, 'src/data'), ...listFiles(root, 'src/ai').filter((f) => !ANALYSIS_ONLY.has(f.split('/').pop()!))];
  // line endings differ between checkouts; they must not change the hash
  for (const f of files.sort()) h.update(f).update(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 10);
}
