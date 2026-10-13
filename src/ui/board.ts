import Phaser from 'phaser';
import { candidates, UNITS } from '../game/sudoku';
import type { FillEvent, Report, Run, Settings } from '../game/types';

interface Model { run: Run; prediction: Report | null; selected: number | null; skill: boolean; busy: boolean; inspect?: number | null }
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
    const { run, prediction, selected, skill, inspect } = this.model;
    const inspecting = inspect != null && !!prediction?.chain;
    const current = inspecting ? prediction!.chain!.steps[inspect!] : null;
    // Render the state immediately before this fill, leaving the real run untouched.
    const cells = [...run.cells];
    if (inspecting) prediction!.path.slice(0, inspect!).forEach(event => { cells[event.cell] = event.value; });
    const shared = new Set(current?.sharedUnits.flatMap(id => UNITS[id]) ?? []);
    const g = this.ink; g.clear();
    g.fillStyle(0x121e33, 1); g.fillRoundedRect(0, 0, 600, 600, 12);
    const path = inspecting ? prediction!.path.slice(0, inspect! + 1) : prediction?.path ?? [];
    for (let i = 0; i < 81; i++) {
      const x = PAD + (i % 9) * CELL, y = PAD + Math.floor(i / 9) * CELL;
      const step = path.find(e => e.cell === i);
      const possible = !cells[i] && ((!inspecting && skill) || candidates(cells, i).length === 1);
      const lightBlock = (Math.floor(i / 27) + Math.floor((i % 9) / 3)) % 2 === 0;
      g.fillStyle(step ? 0x463e2d : shared.has(i) ? 0x23434d : possible ? (skill && !inspecting ? 0x29273e : 0x1b353c) : lightBlock ? 0x19273d : 0x152238, 1);
      g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      if (possible && !step) { g.lineStyle(1, skill ? 0x9c8cc0 : 0x639d95, 0.4); g.strokeRoundedRect(x + 7, y + 7, CELL - 14, CELL - 14, 6); }
      if (current?.from === i) { g.lineStyle(3, 0x8ee0eb, 1); g.strokeRoundedRect(x + 4, y + 4, CELL - 8, CELL - 8, 5); }
      if (inspecting ? current?.cell === i : selected === i) { g.lineStyle(3, 0xf4cf83, 1); g.strokeRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 5); }
      const value = cells[i] || step?.value || ((!skill || inspecting) && possible ? candidates(cells, i)[0] : 0);
      this.digits[i].setText(value ? String(value) : skill && !inspecting ? '·' : '').setColor(step ? '#ffdc91' : cells[i] ? (run.givens[i] ? '#a5b4cc' : '#ead4a6') : skill && !inspecting ? '#a99ac7' : '#a5e0ce');
      this.digits[i].setAlpha(cells[i] || step ? 1 : 0.83);
      const mark = !cells[i] ? run.marks[i] : null;
      this.marks[i].setText(mark === 'weak' ? '✧' : mark === 'shield' ? '◇' : '').setColor(mark === 'weak' ? '#f2aa89' : '#94cbe0');
      const prefix = current?.from === i ? '前 ' : current?.cell === i ? current.source === 'root' ? '起点 ' : '次 ' : '';
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
    const color = chainColor(report.path.length), ring = this.effect().setPosition(300, 300);
    ring.lineStyle(report.fullClear ? 7 : 4, color, 0.95).strokeCircle(0, 0, 65);
    ring.lineStyle(2, 0xfff4db, 0.75).strokeCircle(0, 0, 78);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      ring.lineStyle(3, color, 0.8).lineBetween(Math.cos(angle) * 88, Math.sin(angle) * 88, Math.cos(angle) * 108, Math.sin(angle) * 108);
    }
    this.fade(ring, fast ? 260 : 440, { scaleX: 4, scaleY: 4 });
    if (report.fullClear) {
      const border = this.effect();
      border.lineStyle(7, 0xffdc8c, 0.9).strokeRoundedRect(8, 8, 584, 584, 8);
      border.lineStyle(2, 0xfff6df, 1).strokeRoundedRect(17, 17, 566, 566, 6);
      this.fade(border, fast ? 300 : 550);
    }
    if (report.path.length >= 8 || report.fullClear) this.cameras.main.shake(fast ? 100 : 160, report.fullClear ? 0.004 : 0.0025);
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
  set(run: Run, prediction: Report | null, selected: number | null, skill: boolean, busy = false, inspect: number | null = null): void {
    if (!busy && this.scene.ready) this.scene.clearEffects();
    this.scene.model = { run, prediction, selected, skill, busy, inspect }; this.scene.draw();
    if (inspect === null) delete this.host.dataset.inspectStep;
    else this.host.dataset.inspectStep = String(inspect);
    this.accessible.setAttribute('aria-label', inspect === null ? '魔法陣、9行9列のナンプレ' : '連鎖を確認中の魔法陣。水色の枠が直前、金の枠が次のマス。前へ・次へボタンで進みます。');
    const first = run.cells.findIndex((v, i) => !v && (skill || candidates(run.cells, i).length === 1));
    const shown = [...run.cells];
    if (inspect !== null) prediction?.path.slice(0, inspect).forEach(event => { shown[event.cell] = event.value; });
    const current = inspect !== null ? prediction?.chain?.steps[inspect] : null;
    this.accessible.innerHTML = shown.map((value, i) => {
      const possible = !value && ((skill && inspect === null) || candidates(shown, i).length === 1);
      const number = value || ((!skill || inspect !== null) && possible ? candidates(shown, i)[0] : 0);
      const status = current?.cell === i ? `次に${run.solution[i]}を入力するマス` : value ? `${run.cells[i] ? '入力済み' : '予告で入力済み'} ${value}${current?.from === i ? '、直前のマス' : ''}` : possible ? (number ? `${number}で確定` : 'スキルで入力可能') : '未確定';
      const label = `${Math.floor(i / 9) + 1}行${i % 9 + 1}列、${status}${!value && run.marks[i] ? run.marks[i] === 'weak' ? '、弱点' : '、盾' : ''}`;
      return `<button class="cell-input" data-cell="${i}" role="gridcell" aria-label="${label}" aria-selected="${selected === i}" aria-disabled="${!possible || busy || inspect !== null}" tabindex="${inspect === null && i === (selected ?? first) ? 0 : -1}" ${busy || inspect !== null ? 'disabled' : ''}></button>`;
    }).join('');
  }
  async animate(before: Run, _after: Run, report: Report, settings: Settings, note: (n: number, completed: boolean) => void, onFill?: (event: FillEvent) => void): Promise<void> {
    const transient = structuredClone(before);
    if (this.scene.ready) this.scene.clearEffects();
    const delay = settings.reducedMotion ? 0 : Math.min(100, (settings.fast ? 360 : 1050) / Math.max(1, report.path.length));
    let previous: number | null = null;
    for (const event of report.path) {
      transient.cells[event.cell] = event.value;
      this.scene.model = { run: transient, prediction: null, selected: event.cell, skill: false, busy: true };
      this.scene.draw();
      if (!settings.reducedMotion) this.scene.flash(event, previous, settings.fast);
      if (settings.sound) note(event.ordinal, event.units.length > 0);
      onFill?.(event);
      previous = event.cell;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    }
    for (const cell of report.sweep) transient.cells[cell] = before.solution[cell];
    // The reducer may already hold the next sheet. Keep this spell's sheet visible
    // until the caller has shown damage and retaliation, then render the real run.
    this.scene.model = { run: transient, prediction: null, selected: null, skill: false, busy: true }; this.scene.draw();
    if (!settings.reducedMotion) {
      this.scene.sweep(report.sweep, settings.fast);
      this.scene.finale(report, settings.fast);
      await new Promise(resolve => setTimeout(resolve, settings.fast ? 100 : 200));
    }
  }
}
