import { longestOrigins, previewAction } from './engine';
import type { Preview, Run } from './types';

/** Choose an ordinary cast without spending a skill or a reconnect item.
 * Shared previews include carried sheets and armor, but never roll relic procs. */
export function selectAutoplayOrigin(run: Run): { cell: number; preview: Preview } | null {
  if (run.phase !== 'battle') return null;
  let best: { cell: number; preview: Preview } | null = null;
  for (const cell of longestOrigins(run, false, undefined, false).cells) {
    const preview = previewAction(run, cell, false, undefined, false);
    const damage = preview.guaranteedDamage ?? preview.damage;
    const bestDamage = best ? best.preview.guaranteedDamage ?? best.preview.damage : -Infinity;
    if (!best || damage > bestDamage || damage === bestDamage && cell < best.cell) best = { cell, preview };
  }
  return best;
}
