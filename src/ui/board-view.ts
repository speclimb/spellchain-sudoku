import { legalOrigins, longestOrigins } from '../game/engine';
import type { FillEvent, Report, Run } from '../game/types';

/** A sheet-local projection only. Never let a preview mutate the committed run. */
export function boardView(run: Run, prediction: Report | null, inspect: number | null = null) {
  const event = inspect === null ? undefined : prediction?.path[Math.min(inspect, prediction.path.length - 1)];
  const segment = inspect === null ? undefined : prediction?.segments?.find(part => part.sheet === event?.sheet);
  const display = segment ? { ...run, cells: [...segment.cells], solution: segment.solution, givens: segment.givens, marks: segment.marks, sheet: segment.sheet } : { ...run, cells: [...run.cells] };
  const path = (prediction?.path ?? []).filter(fill => (fill.sheet ?? run.sheet) === display.sheet);
  if (inspect !== null) {
    for (const fill of prediction?.path.slice(0, inspect) ?? []) {
      if ((fill.sheet ?? run.sheet) === display.sheet) display.cells[fill.cell] = fill.value;
    }
  }
  const visiblePath = inspect === null ? path : path.filter(fill => prediction!.path.indexOf(fill) <= inspect);
  const current = inspect === null ? null : prediction?.chain?.steps[inspect] ?? null;
  return { display, path: visiblePath, current, sheet: display.sheet };
}

export function originView(run: Run, skill: boolean, busy: boolean) {
  const legal = new Set(busy ? [] : legalOrigins(run, skill));
  const maximum = !busy && run.inventory.includes('lens') && run.tier.lens === 2 ? longestOrigins(run, skill) : null;
  return { legal, maximum, longest: new Set(maximum?.cells ?? []) };
}

export function fillSheet(event: FillEvent, fallback: number): number { return event.sheet ?? fallback; }
