import './completion-effects.css';
import './enemy-effects.css';
import { chainBonus, spellMultiplier } from '../game/engine';
import { enemyForRun, enemyIntent } from '../game/enemies';
import { enemyAttackArt } from './enemy-attack-art';
import type { FillEvent, Report, Run, Settings } from '../game/types';
import type { IncantationAudio } from './audio';

const fmt = (value: number) => value.toLocaleString('ja-JP');
const pause = (duration: number) => new Promise<void>(resolve => setTimeout(resolve, duration));
type CompletionKind = 'line' | 'box' | 'cross';
const completionKind = (units: Set<number>): CompletionKind => {
  const line = [...units].some(unit => unit < 18), box = [...units].some(unit => unit >= 18);
  return line && box ? 'cross' : box ? 'box' : 'line';
};

/** Presentation only. The entire action is already committed before these effects start. */
export class CombatEffects {
  private host = document.createElement('div');
  private settings: Settings;
  private cutin: HTMLElement | null = null;
  private cutinTimer: number | null = null;
  private cutinUnits = new Set<number>();
  private cutinCount = 0;
  private cutinBudget = 0;
  private destroyed = false;
  private skipped = false;
  constructor(settings: Settings, private audio: IncantationAudio) {
    this.settings = { ...settings };
    this.host.className = 'combat-effects';
    this.host.dataset.phase = 'chain';
    this.host.setAttribute('aria-hidden', 'true');
    this.host.innerHTML = '<div class="combat-vignette"></div><div class="combat-slash"></div><div class="combat-halo"></div><div class="combat-rays"></div><div class="combat-readout"><div class="combat-chain"><strong>1</strong><span>CHAIN</span></div><span class="combat-caption"></span><strong class="combat-number"></strong><span class="combat-shield"></span></div><div class="combat-score"></div>';
    this.host.classList.toggle('fx-still', settings.reducedMotion);
    this.host.classList.toggle('fx-fast', settings.fast);
    document.body.append(this.host);
    this.position();
  }
  private position(target: 'board' | 'enemy' = 'board'): void {
    const area = document.querySelector(target === 'enemy' ? '.enemy-card' : '.board-surface')?.getBoundingClientRect();
    const score = document.querySelector('.run-score')?.getBoundingClientRect();
    this.host.style.setProperty('--fx-x', `${area ? area.left + area.width / 2 : innerWidth / 2}px`);
    this.host.style.setProperty('--fx-y', `${area ? Math.max(60, Math.min(innerHeight - 150, area.top + area.height * (target === 'enemy' ? 0.5 : 0.35))) : innerHeight / 3}px`);
    this.host.style.setProperty('--score-x', `${score ? score.right : innerWidth - 24}px`);
    this.host.style.setProperty('--score-y', `${score ? score.bottom + 10 : 80}px`);
  }
  private text(selector: string, value: string): void {
    this.host.querySelector<HTMLElement>(selector)!.textContent = value;
  }
  private phase(phase: string, caption: string, number = '', shield = ''): void {
    this.host.dataset.phase = phase;
    this.text('.combat-caption', caption);
    this.text('.combat-number', number);
    this.text('.combat-shield', shield);
    // Restart the short accent when the chain number or phase changes.
    this.host.classList.remove('fx-pulse');
    void this.host.offsetWidth;
    this.host.classList.add('fx-pulse');
  }
  fill(event: FillEvent): void {
    if (this.destroyed || this.skipped) return;
    this.position();
    this.host.dataset.intensity = event.ordinal >= 8 ? 'high' : event.ordinal >= 4 ? 'medium' : 'low';
    this.text('.combat-chain strong', String(event.ordinal));
    const label = event.hop ? '星火連環 · 飛び火！' : event.units.length ? `${event.units.length}単位完成！` : event.mark === 'weak' ? '弱点に命中！' : event.mark === 'shield' ? '守護を獲得' : event.ordinal >= 8 ? '連鎖大爆発！' : event.ordinal >= 4 ? '連鎖加速！' : '詠唱をつなげ！';
    this.phase('chain', label);
    this.complete(event.units);
  }
  private complete(units: number[]): void {
    if (!units.length) return;
    if (this.cutin) {
      // Nearby completions become one larger spell, without restarting its timer
      // or holding up the chain. This also preserves simultaneous line + box hits.
      const previous = completionKind(this.cutinUnits);
      for (const unit of units) this.cutinUnits.add(unit);
      this.updateCutin();
      if (previous !== 'cross' && completionKind(this.cutinUnits) === 'cross' && this.settings.sound) this.audio.completion('cross', this.cutinUnits.size);
      return;
    }
    const duration = this.settings.fast || this.settings.reducedMotion ? 180 : 320;
    if (this.cutinCount >= 3 || this.cutinBudget + duration > 960) return;
    this.cutinCount++; this.cutinBudget += duration;
    this.cutinUnits = new Set(units);
    this.cutin = document.createElement('div');
    this.cutin.className = `completion-cutin${this.settings.reducedMotion ? ' completion-still' : ''}`;
    this.cutin.setAttribute('aria-hidden', 'true');
    this.cutin.style.setProperty('--completion-duration', `${duration}ms`);
    this.cutin.innerHTML = '<div class="completion-veil"></div><div class="completion-beam completion-beam-one"></div><div class="completion-beam completion-beam-two"></div><div class="completion-streaks"></div><div class="completion-seal"><svg viewBox="0 0 320 320" fill="none"><circle cx="160" cy="160" r="143"/><circle cx="160" cy="160" r="126"/><circle cx="160" cy="160" r="92"/><path d="M160 31 272 224 48 224Z M160 289 48 96 272 96Z M160 17V42 M160 278V303 M17 160H42 M278 160H303 M59 59 78 78 M242 242 261 261 M59 261 78 242 M242 78 261 59"/><path d="M160 111 188 160 160 209 132 160Z"/></svg><div class="completion-runes">✦ · Ⅸ · ✧ · Ⅲ · ✦ · Ⅵ · ✧ · Ⅰ</div></div><div class="completion-copy"><span class="completion-kicker"></span><strong class="completion-title"></strong><span class="completion-count"></span></div>';
    this.updateCutin();
    document.body.append(this.cutin);
    if (this.settings.sound) this.audio.completion(completionKind(this.cutinUnits), this.cutinUnits.size);
    this.cutinTimer = window.setTimeout(() => this.clearCutin(), duration);
  }
  private updateCutin(): void {
    if (!this.cutin) return;
    const kind = completionKind(this.cutinUnits);
    const rows = [...this.cutinUnits].filter(unit => unit < 9).length;
    const columns = [...this.cutinUnits].filter(unit => unit >= 9 && unit < 18).length;
    const boxes = [...this.cutinUnits].filter(unit => unit >= 18).length;
    const detail = [rows ? `${rows}行` : '', columns ? `${columns}列` : '', boxes ? `${boxes}区画` : ''].filter(Boolean).join(' ＋ ');
    this.cutin.dataset.completion = kind;
    this.cutin.dataset.unitCount = String(this.cutinUnits.size);
    this.cutin.dataset.direction = rows && columns ? 'both' : columns ? 'column' : 'row';
    this.cutin.querySelector('.completion-kicker')!.textContent = kind === 'cross' ? 'CROSS CAST' : kind === 'box' ? 'ARCANE SEAL' : 'LINE SPELL';
    this.cutin.querySelector('.completion-title')!.textContent = kind === 'cross' ? '複合詠唱 完成！' : kind === 'box' ? '3×3区画 完成！' : 'ライン 完成！';
    this.cutin.querySelector('.completion-count')!.textContent = `${this.cutinUnits.size}単位完成 · ${detail}`;
  }
  private clearCutin(): void {
    if (this.cutinTimer !== null) window.clearTimeout(this.cutinTimer);
    this.cutinTimer = null;
    this.cutin?.remove(); this.cutin = null;
    this.cutinUnits.clear();
  }
  private duration(normal: number): number {
    return this.settings.reducedMotion ? 140 : this.settings.fast ? 100 : normal;
  }
  skip(): void {
    this.skipped = true;
    this.clearCutin();
    this.host.style.display = 'none';
  }
  async sheetComplete(segment: NonNullable<Report['segments']>[number], continues: boolean): Promise<void> {
    if (this.skipped) return;
    this.clearCutin();
    this.position();
    this.host.dataset.sheet = String(segment.sheet);
    this.host.dataset.oneCast = String(segment.oneCastClear);
    this.phase(segment.oneCastClear ? 'one-cast' : 'sheet', segment.oneCastClear ? '一詠全成！' : 'シート完成！', `シート ${segment.sheet} · ${segment.pathEnd - segment.pathStart}マス`, `完成加算 ＋${fmt(segment.clearBonus)}${continues ? ' · 余った回数で次のシートへ' : ''}`);
    if (this.settings.sound) { if (segment.oneCastClear) this.audio.oneCastClear(); else this.audio.sheetClear(); }
    await pause(this.duration(segment.oneCastClear ? 420 : 220));
  }
  async finish(before: Run, after: Run, report: Report): Promise<void> {
    if (this.skipped) return;
    // Reduced-motion fills happen in one frame. Let their final static completion
    // banner be painted once before switching to the strike result.
    if (this.settings.reducedMotion && this.cutin) await pause(180);
    this.clearCutin();
    const enemy = enemyForRun(before), intent = enemyIntent(before);
    if (report.oneCastClear && !report.segments?.length) {
      this.position();
      this.phase('one-cast', '一詠全成！', `${report.path.length}マスを、一度の詠唱で。`, `基礎攻撃 ${fmt(report.baseDamage ?? report.damage)} · 完成加算 ＋${fmt(report.clearBonus ?? 0)}`);
      if (this.settings.sound) this.audio.oneCastClear();
      await pause(this.duration(620));
    }
    if (this.skipped) return;
    this.position('enemy');
    const detail = [report.procs?.length ? report.procs.map(proc => `${({ duality: '二の護符', trinity: '三の護符', quint: '五の護符', sept: '七の護符' })[proc.id]} ${proc.triggered ? '発動' : '不発'}`).join(' · ') : report.proc ? `三の護符 ${report.proc.triggered ? `発動 ×${report.proc.multiplier}` : '不発'}` : '', report.clearBonus ? `完成加算 ＋${fmt(report.clearBonus)}` : '', report.relicHealed ? `反撃前回復 ＋${report.relicHealed}` : '', report.armorBroken ? '鏡甲を解除！' : report.armorPrevented ? `鏡甲が ${fmt(report.armorPrevented)} 軽減` : ''].filter(Boolean).join(' · ');
    this.phase('strike', report.defeated ? '撃破！' : report.proc?.triggered ? '三の護符 発動！' : report.skill ? '奥義炸裂！' : '連鎖炸裂！', fmt(report.damage), detail);
    this.text('.combat-score', `SCORE +${fmt(report.attackScore)}`);
    const health = document.querySelector<HTMLElement>('.vital-health strong');
    const healthBar = document.querySelector<HTMLElement>('.health-track.player i');
    const beforeCounterHp = before.hp + (report.relicHealed ?? 0);
    if (report.relicHealed) {
      if (health) health.firstChild!.textContent = String(beforeCounterHp);
      if (healthBar) healthBar.style.width = `${beforeCounterHp / before.maxHp * 100}%`;
    }
    const enemyHp = Math.max(0, before.enemyHp - report.damage);
    const enemyTrack = document.querySelector<HTMLElement>('.enemy-health .health-track i');
    const enemyLabel = document.querySelector<HTMLElement>('.enemy-health > span');
    if (enemyTrack) enemyTrack.style.width = `${Math.min(100, enemyHp / enemy.hp * 100)}%`;
    if (enemyLabel) { enemyLabel.firstChild!.textContent = String(enemyHp); }
    const score = document.querySelector<HTMLElement>('.run-score strong');
    if (score) score.textContent = fmt(before.score + report.attackScore);
    if (this.settings.sound) this.audio.impact(report.path.length, report.defeated);
    document.querySelector('.enemy-card')?.classList.add('enemy-struck');
    await pause(this.duration(380));
    document.querySelector('.enemy-card')?.classList.remove('enemy-struck');

    if (this.skipped) return;
    if (!report.defeated) {
      this.position();
      const ward = document.querySelector('.sheet-ward b');
      if (ward) ward.textContent = String(report.shield);
      const charging = intent.state === 'charge' && report.incoming === 0;
      const blocked = !charging && report.received === 0;
      const prevented = Math.min(report.incoming, report.shield);
      const strongAttack = report.incoming > enemy.attack;
      this.host.dataset.enemyStyle = enemy.attackStyle;
      this.host.querySelector('.enemy-attack-art')?.remove();
      this.host.insertAdjacentHTML('afterbegin', enemyAttackArt(enemy.attackStyle));
      this.host.dataset.blocked = String(blocked);
      this.host.dataset.heavy = String(strongAttack);
      const healingDetail = report.relicHealed ? ` · 反撃前回復 ＋${report.relicHealed}` : '';
      this.phase(charging ? 'charge' : 'counter', charging ? '霜牙の狼は力を溜める' : blocked ? '完全防御' : strongAttack ? '強攻撃！' : '敵の反撃！', charging || blocked ? '0' : `−${report.received}`, charging ? `次の手は ${fmt(intent.nextIncoming)} の突進${healingDetail}` : `${enemy.attackName}${prevented ? ` · 守護で ${prevented} 軽減` : ''}${healingDetail}`);
      this.text('.combat-score', '');
      if (!charging) document.querySelector('.app-shell')?.classList.add(blocked ? 'player-blocked' : 'player-struck');
      if (health) health.firstChild!.textContent = String(Math.max(0, beforeCounterHp - report.received));
      if (healthBar) healthBar.style.width = `${Math.max(0, beforeCounterHp - report.received) / before.maxHp * 100}%`;
      if (this.settings.sound && !charging) this.audio.attack(report.received, blocked);
      await pause(this.duration(360));
      document.querySelector('.app-shell')?.classList.remove('player-struck', 'player-blocked');
    }
    if (this.skipped) return;
    if (report.sheetAdvanced && (!report.segments?.length || report.segments.at(-1)?.fullClear)) {
      this.position();
      this.phase('sheet', 'シート完成！', `次のシート ${after.encounterSheet}`, `同じ敵との戦いは続く · 残りHP ${fmt(after.enemyHp)}`);
      if (this.settings.sound && !report.oneCastClear) this.audio.sheetClear();
      await pause(this.duration(320));
    }
    if (this.skipped) return;
    if ((report.levelsGained ?? 0) > 0) {
      const chainGained = chainBonus(after.spellLevel) - chainBonus(report.spellLevelBefore ?? before.spellLevel);
      this.phase('growth', '術式レベルアップ！', `Lv.${after.spellLevel}`, `攻撃 ×${spellMultiplier(after.spellLevel).toFixed(1)} · 自動連鎖 +${chainGained} · 最大HP +${report.maxHpGained ?? 0} · 成長回復 +${report.healed - (report.relicHealed ?? 0)}`);
      if (this.settings.sound) this.audio.growth();
      await pause(this.duration(340));
    }
  }
  destroy(): void {
    this.destroyed = true;
    this.clearCutin();
    this.host.remove();
    document.querySelector('.app-shell')?.classList.remove('player-struck', 'player-blocked');
    document.querySelector('.enemy-card')?.classList.remove('enemy-struck');
  }
}
