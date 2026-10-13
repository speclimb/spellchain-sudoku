import { spellMultiplier } from '../game/engine';
import { ENEMIES } from '../game/content';
import type { FillEvent, Report, Run, Settings } from '../game/types';
import type { IncantationAudio } from './audio';

const fmt = (value: number) => value.toLocaleString('ja-JP');
const pause = (duration: number) => new Promise<void>(resolve => setTimeout(resolve, duration));

/** Presentation only. The entire action is already committed before these effects start. */
export class CombatEffects {
  private host = document.createElement('div');
  private settings: Settings;
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
    this.position();
    this.host.dataset.intensity = event.ordinal >= 8 ? 'high' : event.ordinal >= 4 ? 'medium' : 'low';
    this.text('.combat-chain strong', String(event.ordinal));
    const label = event.units.length ? `${event.units.length}単位完成！` : event.mark === 'weak' ? '弱点に命中！' : event.mark === 'shield' ? '守護を獲得' : event.ordinal >= 8 ? '連鎖大爆発！' : event.ordinal >= 4 ? '連鎖加速！' : '詠唱をつなげ！';
    this.phase('chain', label);
  }
  private duration(normal: number): number {
    return this.settings.reducedMotion ? 140 : this.settings.fast ? 100 : normal;
  }
  async finish(before: Run, after: Run, report: Report): Promise<void> {
    this.position('enemy');
    this.phase('strike', report.defeated ? '撃破！' : report.skill ? '奥義炸裂！' : '連鎖炸裂！', fmt(report.damage));
    this.text('.combat-score', `SCORE +${fmt(report.attackScore)}`);
    const enemyHp = Math.max(0, before.enemyHp - report.damage);
    const enemyTrack = document.querySelector<HTMLElement>('.enemy-health .health-track i');
    const enemyLabel = document.querySelector<HTMLElement>('.enemy-health > span');
    if (enemyTrack) enemyTrack.style.width = `${Math.min(100, enemyHp / ENEMIES[before.stage].hp * 100)}%`;
    if (enemyLabel) { enemyLabel.firstChild!.textContent = String(enemyHp); }
    const score = document.querySelector<HTMLElement>('.run-score strong');
    if (score) score.textContent = fmt(before.score + report.attackScore);
    if (this.settings.sound) this.audio.impact(report.path.length, report.defeated);
    document.querySelector('.enemy-card')?.classList.add('enemy-struck');
    await pause(this.duration(520));
    document.querySelector('.enemy-card')?.classList.remove('enemy-struck');

    if (!report.defeated) {
      this.position();
      const blocked = report.received === 0;
      const prevented = Math.min(report.incoming, report.shield);
      const strongAttack = report.incoming > 0 && (before.stage === 2 || before.stage === 5) && (before.turn + 1) % 3 === 0;
      this.host.dataset.blocked = String(blocked);
      this.host.dataset.heavy = String(strongAttack);
      this.phase('counter', blocked ? '完全防御' : strongAttack ? '強攻撃！' : '敵の反撃！', blocked ? '0' : `−${report.received}`, prevented ? `盾で ${prevented} 軽減` : '');
      this.text('.combat-score', '');
      document.querySelector('.app-shell')?.classList.add(blocked ? 'player-blocked' : 'player-struck');
      const health = document.querySelector<HTMLElement>('.vital-health strong');
      const healthBar = document.querySelector<HTMLElement>('.health-track.player i');
      if (health) health.firstChild!.textContent = String(Math.max(0, before.hp - report.received));
      if (healthBar) healthBar.style.width = `${Math.max(0, before.hp - report.received) / before.maxHp * 100}%`;
      if (this.settings.sound) this.audio.attack(report.received, blocked);
      await pause(this.duration(560));
      document.querySelector('.app-shell')?.classList.remove('player-struck', 'player-blocked');
    }
    if (report.sheetAdvanced) {
      this.position();
      this.phase('sheet', 'シート完成！', `次のシート ${after.encounterSheet}`, `同じ敵との戦いは続く · 残りHP ${fmt(after.enemyHp)}`);
      if (this.settings.sound) this.audio.sheetClear();
      await pause(this.duration(600));
    }
    if ((report.levelsGained ?? 0) > 0) {
      this.phase('growth', '術式レベルアップ！', `Lv.${after.spellLevel}`, `攻撃 ×${spellMultiplier(after.spellLevel).toFixed(1)} · 最大HP +${report.maxHpGained ?? 0} · 回復 +${report.healed}`);
      await pause(this.duration(550));
    }
  }
  destroy(): void {
    this.host.remove();
    document.querySelector('.app-shell')?.classList.remove('player-struck', 'player-blocked');
    document.querySelector('.enemy-card')?.classList.remove('enemy-struck');
  }
}
