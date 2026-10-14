import Phaser from 'phaser';
import { candidates, UNITS } from '../game/sudoku';
import type { FillEvent, Report, Run, Settings, SkillId } from '../game/types';
import { boardView, fillSheet, originView } from './board-view';

interface Model { run: Run; prediction: Report | null; selected: number | null; skill: boolean; busy: boolean; inspect?: number | null; legal?: Set<number>; longest?: Set<number> }
const CELL = 64, PAD = 12;
const center = (cell: number) => ({ x: PAD + (cell % 9) * CELL + CELL / 2, y: PAD + Math.floor(cell / 9) * CELL + CELL / 2 });
const chainColor = (ordinal: number) => ordinal >= 12 ? 0xf8edff : ordinal >= 8 ? 0xd6a2ff : ordinal >= 4 ? 0xffbd72 : 0xf2d58d;
class BoardScene extends Phaser.Scene {
  model: Model | null = null;
  ready = false;
  private ink!: Phaser.GameObjects.Graphics;
  private digits: Phaser.GameObjects.Text[] = [];
  private marks: Phaser.GameObjects.Text[] = [];
  private ordinals: Phaser.GameObjects.Text[] = [];
  private effects = new Set<Phaser.GameObjects.Graphics>();
  constructor() { super('grimoire'); }
  create(): void {
    this.ink = this.add.graphics();
    for (let i = 0; i < 81; i++) {
      const x = PAD + (i % 9) * CELL, y = PAD + Math.floor(i / 9) * CELL;
      this.digits.push(this.add.text(x + CELL / 2, y + CELL / 2 + 1, '', { fontFamily: 'Georgia, "Yu Mincho", serif', fontSize: '29px', color: '#d9dfeb' }).setOrigin(0.5));
      this.marks.push(this.add.text(x + CELL - 10, y + 11, '', { fontFamily: 'serif', fontSize: '16px' }).setOrigin(0.5));
      this.ordinals.push(this.add.text(x + 11, y + CELL - 10, '', { fontFamily: 'sans-serif', fontSize: '11px', color: '#e5c783' }).setOrigin(0.5));
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.clearEffects(); this.ready = false; });
    this.ready = true; this.draw();
  }
  draw(): void {
    if (!this.ready || !this.model) return;
    const { prediction, selected, skill, inspect, legal = new Set<number>(), longest = new Set<number>() } = this.model;
    const inspecting = inspect != null && !!prediction?.chain;
    const projected = boardView(this.model.run, prediction, inspecting ? inspect! : null);
    const { display: run, path, current } = projected;
    const cells = run.cells;
    const shared = new Set(current?.sharedUnits.flatMap(id => UNITS[id]) ?? []);
    const g = this.ink; g.clear();
    g.fillStyle(0x121e33, 1); g.fillRoundedRect(0, 0, 600, 600, 12);
    for (let i = 0; i < 81; i++) {
      const x = PAD + (i % 9) * CELL, y = PAD + Math.floor(i / 9) * CELL;
      const step = path.find(e => e.cell === i);
      const possible = !cells[i] && (inspecting ? candidates(cells, i).length === 1 : legal.has(i));
      const chosen = !inspecting && selected === i;
      const origin = !inspecting && legal.has(i);
      const best = !inspecting && longest.has(i);
      const lightBlock = (Math.floor(i / 27) + Math.floor((i % 9) / 3)) % 2 === 0;
      g.fillStyle(chosen ? 0x57472f : step && origin ? 0x35493f : step ? 0x3e392d : shared.has(i) ? 0x23434d : possible ? (skill && !inspecting ? 0x302c43 : 0x203f40) : lightBlock ? 0x19273d : 0x152238, 1);
      g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      if (origin && !chosen) { g.lineStyle(1.2, best ? 0xc8b5ff : skill ? 0xb6a3d1 : 0x92c7b9, 0.9); g.strokeRoundedRect(x + 5, y + 5, CELL - 10, CELL - 10, 5); }
      if (best) { g.lineStyle(1, 0xddccff, 0.85); g.strokeRoundedRect(x + 8, y + 8, CELL - 16, CELL - 16, 3); }
      if (current?.from === i) { g.lineStyle(3, 0x8ee0eb, 1); g.strokeRoundedRect(x + 4, y + 4, CELL - 8, CELL - 8, 5); }
      if (inspecting ? current?.cell === i : selected === i) { g.lineStyle(3, 0xf4cf83, 1); g.strokeRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 5); }
      const value = cells[i] || step?.value || ((!skill || inspecting) && possible ? candidates(cells, i)[0] : 0);
      this.digits[i].setText(value ? String(value) : skill && !inspecting ? '·' : '').setColor(step ? '#ffdc91' : cells[i] ? (run.givens[i] ? '#a5b4cc' : '#ead4a6') : skill && !inspecting ? '#a99ac7' : '#a5e0ce');
      this.digits[i].setAlpha(cells[i] || step ? 1 : 0.83);
      const mark = !cells[i] ? run.marks[i] : null;
      this.marks[i].setText(mark === 'weak' ? '✧' : mark === 'shield' ? '◇' : '').setColor(mark === 'weak' ? '#f2aa89' : '#94cbe0');
      const prefix = current?.from === i ? '前 ' : current?.cell === i ? current.source === 'root' ? '起点 ' : '次 ' : chosen ? '起点 ' : '';
      this.ordinals[i].setText(step ? `${prefix}${step.ordinal}` : '').setOrigin(prefix ? 0 : 0.5, 0.5).setColor(current?.from === i ? '#a0e9f0' : '#e5c783');
    }
    if (path.length > 1) {
      g.lineStyle(2, 0xe4bd72, 0.42);
      g.beginPath();
      path.forEach((event, n) => {
        const x = PAD + (event.cell % 9) * CELL + CELL / 2, y = PAD + Math.floor(event.cell / 9) * CELL + CELL / 2;
        if (!n) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.strokePath();
    }
    if (current?.from != null) {
      const from = current.from, to = current.cell;
      const x1 = PAD + (from % 9) * CELL + CELL / 2, y1 = PAD + Math.floor(from / 9) * CELL + CELL / 2;
      const x2 = PAD + (to % 9) * CELL + CELL / 2, y2 = PAD + Math.floor(to / 9) * CELL + CELL / 2;
      const angle = Math.atan2(y2 - y1, x2 - x1), inset = 21;
      const endX = x2 - Math.cos(angle) * inset, endY = y2 - Math.sin(angle) * inset;
      g.lineStyle(3, 0xffd98d, 0.95);
      g.lineBetween(x1 + Math.cos(angle) * inset, y1 + Math.sin(angle) * inset, endX, endY);
      g.fillStyle(0xffd98d, 1);
      g.fillTriangle(endX, endY, endX - Math.cos(angle - 0.5) * 12, endY - Math.sin(angle - 0.5) * 12, endX - Math.cos(angle + 0.5) * 12, endY - Math.sin(angle + 0.5) * 12);
    }
    for (let n = 0; n <= 9; n++) {
      g.lineStyle(n % 3 === 0 ? 2 : 1, n % 3 === 0 ? 0x968366 : 0x637087, n % 3 === 0 ? 0.65 : 0.2);
      g.lineBetween(PAD + n * CELL, PAD, PAD + n * CELL, 588);
      g.lineBetween(PAD, PAD + n * CELL, 588, PAD + n * CELL);
    }
  }
  private effect(): Phaser.GameObjects.Graphics {
    // A long chain can fill the entire sheet. Bound view objects even at fast speed.
    if (this.effects.size >= 96) this.removeEffect(this.effects.values().next().value!);
    const graphic = this.add.graphics().setDepth(10);
    this.effects.add(graphic);
    return graphic;
  }
  private removeEffect(graphic: Phaser.GameObjects.Graphics): void {
    this.tweens.killTweensOf(graphic);
    this.effects.delete(graphic);
    graphic.destroy();
  }
  private fade(graphic: Phaser.GameObjects.Graphics, duration: number, options: Record<string, unknown> = {}): void {
    this.tweens.add({ targets: graphic, alpha: 0, duration, ease: 'Cubic.easeOut', ...options, onComplete: () => this.removeEffect(graphic) });
  }
  clearEffects(): void {
    for (const graphic of [...this.effects]) this.removeEffect(graphic);
    for (const digit of this.digits) { this.tweens.killTweensOf(digit); digit.setScale(1); }
    this.cameras.main?.resetFX();
  }
  flash(event: FillEvent, previous: number | null, fast: boolean): void {
    if (!this.ready) return;
    const { cell, ordinal, units, mark } = event;
    const position = center(cell), color = mark === 'shield' ? 0x8ce9f2 : chainColor(ordinal);
    const strength = Math.min(1, ordinal / 12), duration = fast ? 240 : 420;
    const glow = this.effect();
    glow.fillStyle(color, 0.32 + strength * 0.15);
    glow.fillRoundedRect(PAD + (cell % 9) * CELL + 3, PAD + Math.floor(cell / 9) * CELL + 3, CELL - 6, CELL - 6, 5);
    this.fade(glow, duration);

    if (previous !== null) {
      const from = center(previous), trail = this.effect();
      trail.lineStyle(13 + strength * 6, color, 0.16).lineBetween(from.x, from.y, position.x, position.y);
      trail.lineStyle(5 + strength * 2, color, 0.68).lineBetween(from.x, from.y, position.x, position.y);
      trail.lineStyle(2, 0xfff5de, 0.95).lineBetween(from.x, from.y, position.x, position.y);
      this.fade(trail, duration + 110);
    }
    const burst = this.effect().setPosition(position.x, position.y);
    burst.lineStyle(3 + strength, color, 0.9).strokeCircle(0, 0, 17);
    burst.lineStyle(1, 0xfff7e7, 0.85).strokeCircle(0, 0, 23);
    const rays = 6 + Math.floor(strength * 6);
    for (let i = 0; i < rays; i++) {
      const angle = (Math.PI * 2 * i) / rays + ordinal * 0.37;
      const length = 8 + strength * 13;
      burst.lineStyle(i % 2 ? 2 : 3, i % 2 ? 0xfff6df : color, 0.88);
      burst.lineBetween(Math.cos(angle) * 27, Math.sin(angle) * 27, Math.cos(angle) * (27 + length), Math.sin(angle) * (27 + length));
    }
    this.fade(burst, duration + 100, { scaleX: 1.6 + strength * 0.8, scaleY: 1.6 + strength * 0.8 });
    const digit = this.digits[cell];
    this.tweens.killTweensOf(digit);
    digit.setScale(1.32 + strength * 0.2);
    this.tweens.add({ targets: digit, scale: 1, duration: fast ? 180 : 300, ease: 'Back.easeOut' });

    for (const unit of units) this.completeUnit(unit, color, fast);
    if (ordinal === 4 || ordinal === 8 || ordinal === 12) this.cameras.main.shake(fast ? 80 : 130, 0.0015 + strength * 0.0015);
  }
  private completeUnit(unit: number, color: number, fast: boolean): void {
    const glow = this.effect();
    glow.fillStyle(color, 0.22);
    for (const cell of UNITS[unit]) glow.fillRoundedRect(PAD + (cell % 9) * CELL + 3, PAD + Math.floor(cell / 9) * CELL + 3, CELL - 6, CELL - 6, 4);
    this.fade(glow, fast ? 340 : 600);
    const sweep = this.effect();
    const first = center(UNITS[unit][0]), last = center(UNITS[unit][8]);
    if (unit < 9) {
      sweep.fillStyle(0xfff5d6, 0.8).fillRect(PAD + 2, first.y - 27, 7, 54);
      this.fade(sweep, fast ? 220 : 380, { x: 560 });
    } else if (unit < 18) {
      sweep.fillStyle(0xfff5d6, 0.8).fillRect(first.x - 27, PAD + 2, 54, 7);
      this.fade(sweep, fast ? 220 : 380, { y: 560 });
    } else {
      const x = (first.x + last.x) / 2, y = (first.y + last.y) / 2;
      sweep.setPosition(x, y);
      sweep.lineStyle(4, color, 0.9).strokeRoundedRect(-91, -91, 182, 182, 8);
      sweep.lineStyle(1, 0xfff5d6, 0.8).strokeRoundedRect(-84, -84, 168, 168, 6);
      this.fade(sweep, fast ? 280 : 450, { scaleX: 1.12, scaleY: 1.12 });
    }
  }
  finale(report: Report, fast: boolean): void {
    if (!this.ready || (!report.fullClear && !report.defeated && report.path.length < 6)) return;
    const completeStrength = report.oneCastClear ? 1 : Math.min(0.8, report.clearRatio ?? 0.25);
    const color = chainColor(report.path.length), ring = this.effect().setPosition(300, 300);
    ring.lineStyle(report.fullClear ? 3 + completeStrength * 4 : 4, color, 0.8).strokeCircle(0, 0, 65);
    ring.lineStyle(2, 0xfff4db, 0.75).strokeCircle(0, 0, 78);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      ring.lineStyle(3, color, 0.8).lineBetween(Math.cos(angle) * 88, Math.sin(angle) * 88, Math.cos(angle) * 108, Math.sin(angle) * 108);
    }
    const expansion = report.fullClear ? 2.5 + completeStrength * 1.5 : 4;
    this.fade(ring, fast ? 260 : 440, { scaleX: expansion, scaleY: expansion });
    if (report.fullClear) {
      const border = this.effect();
      border.lineStyle(3 + completeStrength * 4, 0xffdc8c, 0.4 + completeStrength * 0.5).strokeRoundedRect(8, 8, 584, 584, 8);
      border.lineStyle(2, 0xfff6df, 0.4 + completeStrength * 0.6).strokeRoundedRect(17, 17, 566, 566, 6);
      this.fade(border, fast ? 300 : 550);
    }
    if (report.path.length >= 8 || report.oneCastClear) this.cameras.main.shake(fast ? 100 : 160, report.oneCastClear ? 0.004 : 0.0025);
  }
  sweep(cells: number[], fast: boolean): void {
    if (!this.ready || !cells.length) return;
    const glow = this.effect();
    glow.fillStyle(0xd6a2ff, 0.28);
    for (const cell of cells) glow.fillRoundedRect(PAD + (cell % 9) * CELL + 3, PAD + Math.floor(cell / 9) * CELL + 3, CELL - 6, CELL - 6, 4);
    this.fade(glow, fast ? 260 : 460);
  }
}
export class Board {
  readonly host = document.createElement('div');
  private canvasHost = document.createElement('div');
  private accessible = document.createElement('div');
  private scene = new BoardScene();
  private game: Phaser.Game | null = null;
  constructor() {
    this.host.className = 'board-surface';
    this.canvasHost.className = 'canvas-host';
    this.accessible.className = 'board-input';
    this.accessible.setAttribute('role', 'grid');
    this.accessible.setAttribute('aria-label', '魔法陣、9行9列のナンプレ');
    this.host.append(this.canvasHost, this.accessible);
  }
  mount(parent: HTMLElement): void {
    parent.append(this.host);
    if (!this.game) this.game = new Phaser.Game({
      type: Phaser.CANVAS, width: 600, height: 600, parent: this.canvasHost,
      transparent: true, antialias: true, scene: this.scene,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      audio: { noAudio: true }, banner: false,
    });
    requestAnimationFrame(() => this.game?.scale.refresh());
  }
  set(run: Run, prediction: Report | null, selected: number | null, skill: boolean, busy = false, inspect: number | null = null, skillId?: SkillId): void {
    if (!busy && this.scene.ready) this.scene.clearEffects();
    const origins = originView(run, skill, busy, skillId);
    this.scene.model = { run, prediction, selected, skill, busy, inspect, ...origins }; this.scene.draw();
    if (inspect === null) delete this.host.dataset.inspectStep;
    else this.host.dataset.inspectStep = String(inspect);
    const { display, path, current, sheet } = boardView(run, prediction, inspect);
    this.host.dataset.sheet = String(sheet);
    this.host.dataset.legalCount = String(origins.legal.size);
    this.host.dataset.longestCount = String(origins.longest.size);
    this.accessible.setAttribute('aria-label', inspect === null ? '魔法陣、9行9列のナンプレ。○は選び直せる起点、●は選択中、★は最長連鎖の起点。' : `シート${sheet}の連鎖を確認中。水色の枠が直前、金の枠が次のマス。前へ・次へボタンで進みます。`);
    const first = origins.legal.values().next().value;
    this.accessible.innerHTML = display.cells.map((value, i) => {
      const possible = inspect === null && origins.legal.has(i);
      const number = value || ((!skill || inspect !== null) && !value && candidates(display.cells, i).length === 1 ? candidates(display.cells, i)[0] : 0);
      const isSelected = inspect === null && selected === i;
      const isLongest = inspect === null && origins.longest.has(i);
      const inPath = path.some(event => event.cell === i);
      const status = current?.cell === i ? `次に${display.solution[i]}を入力するマス` : value ? `${run.sheet === sheet && run.cells[i] ? '入力済み' : '予告で入力済み'} ${value}${current?.from === i ? '、直前のマス' : ''}` : possible ? (number ? `${number}で確定` : 'スキルで入力可能') : '未確定';
      const originLabel = isSelected ? '、選択中の起点' : possible ? '、選び直せる起点' : '';
      const label = `${Math.floor(i / 9) + 1}行${i % 9 + 1}列、${status}${originLabel}${isLongest ? `、最長${origins.maximum!.length}連鎖の起点` : ''}${inPath ? '、連鎖の予告内' : ''}${!value && display.marks[i] ? display.marks[i] === 'weak' ? '、弱点' : '、盾' : ''}`;
      return `<button class="cell-input" data-cell="${i}" data-root="${isSelected ? 'selected' : possible ? 'legal' : 'none'}" data-path="${inPath}" data-longest="${isLongest}" role="gridcell" aria-label="${label}" aria-selected="${selected === i && sheet === run.sheet}" aria-disabled="${!possible || busy || inspect !== null}" tabindex="${inspect === null && i === (selected ?? first) ? 0 : -1}" ${busy || inspect !== null ? 'disabled' : ''}><span class="origin-mark" aria-hidden="true">${isLongest ? '★' : isSelected ? '●' : possible ? '○' : ''}</span></button>`;
    }).join('');
  }
  async animate(before: Run, _after: Run, report: Report, settings: Settings, note: (n: number, completed: boolean) => void, onFill?: (event: FillEvent) => void, onSegment?: (segment: NonNullable<Report['segments']>[number], continues: boolean) => Promise<void>, shouldSkip = () => false): Promise<void> {
    let transient = structuredClone(before);
    if (this.scene.ready) this.scene.clearEffects();
    const delay = settings.reducedMotion ? 0 : Math.min(100, (settings.fast ? 360 : 1050) / Math.max(1, report.path.length));
    let previous: number | null = null;
    for (let index = 0; index < report.path.length; index++) {
      if (shouldSkip()) break;
      const event = report.path[index];
      const sheet = fillSheet(event, before.sheet);
      const segment = report.segments?.find(part => part.sheet === sheet);
      if (segment && (index === 0 || transient.sheet !== sheet)) {
        if (this.scene.ready) this.scene.clearEffects();
        transient = { ...transient, cells: [...segment.cells], solution: [...segment.solution], givens: [...segment.givens], marks: [...segment.marks], sheet, encounterSheet: before.encounterSheet + sheet - before.sheet };
        previous = null;
        this.set(transient, null, null, false, true);
        const sheetLabel = document.querySelector('.sheet-status > span:first-child');
        if (sheetLabel) sheetLabel.innerHTML = `シート <b>${transient.encounterSheet}</b><small>通算 ${sheet}枚目</small>`;
      }
      transient.cells[event.cell] = event.value;
      this.scene.model = { run: transient, prediction: null, selected: event.cell, skill: false, busy: true };
      this.scene.draw();
      if (!settings.reducedMotion) this.scene.flash(event, previous, settings.fast);
      if (settings.sound) note(event.ordinal, event.units.length > 0);
      onFill?.(event);
      previous = event.cell;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (segment?.fullClear && index + 1 === segment.pathEnd && !shouldSkip()) {
        if (!settings.reducedMotion) this.scene.finale({ ...report, fullClear: true, oneCastClear: segment.oneCastClear, clearRatio: segment.clearRatio }, settings.fast);
        await onSegment?.(segment, index + 1 < report.path.length);
      }
    }
    if (shouldSkip()) { if (this.scene.ready) this.scene.clearEffects(); return; }
    for (const cell of report.sweep) transient.cells[cell] = transient.solution[cell];
    // Keep the terminal sheet visible until the one final attack/counter resolves.
    this.set(transient, null, null, false, true);
    if (!settings.reducedMotion) {
      this.scene.sweep(report.sweep, settings.fast);
      if (!report.segments?.at(-1)?.fullClear) this.scene.finale({ ...report, fullClear: false, oneCastClear: false }, settings.fast);
      await new Promise(resolve => setTimeout(resolve, settings.fast ? 100 : 200));
    }
  }
}
