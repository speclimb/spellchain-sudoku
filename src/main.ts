import './style.css';
import './ui/readability.css';
import { CHARACTERS, RELICS, characterOf, relicOf, rewardOf, relicDescription } from './game/content';
import { canUseSkill, chainBonus, dispatch, incomingAttack, legalOrigins, longestOrigins, newSave, previewAction, sheetShield, spellMultiplier, startRun } from './game/engine';
import { enemyAt, enemyForRun, enemyIntent } from './game/enemies';
import { ownedSkills, relicGrowthDescription, relicLevel, relicTierLabel, relicValues, skillDescriptionFor, skillLevel, skillOf } from './game/growth';
import { contributionReport } from './ui/contribution-report';
import { downloadPlayHistory, historyBattleDetails, historyCastDetails, playHistory, selectedHistoryRun, type HistoryView } from './ui/play-history';
import { enemyEmblem as emblem } from './ui/enemy-art';
import { HistoryStorage } from './game/history-storage';
import { candidates } from './game/sudoku';
import { RELIC_CAPACITY, rewardRelicId, needsRelicReplacement } from './game/relic-slots';
import type { CharacterId, RelicId, RewardId, Preview, Report, Run, SkillId } from './game/types';
import type { Board } from './ui/board';
import { IncantationAudio } from './ui/audio';
import { CombatEffects } from './ui/combat-effects';
import { capacityText, explainStep, stopText } from './ui/chain-guide';
import { accessiblePrediction, damageBreakdown, outcomeText, percentText, procEffect, procName, retaliationText } from './ui/report-presentation';

const app = document.querySelector<HTMLDivElement>('#app')!;
const storage = new HistoryStorage();
app.innerHTML = '<p class="loading" role="status">保存した冒険を読み込んでいます…</p>';
const loaded = await storage.load();
let save = loaded.save, warning = loaded.warning;
let view: 'home' | 'battle' = 'home';
let chosen: CharacterId = save.run?.character ?? 'fuse';
let selected: number | null = null, prediction: Preview | null = null, skill = false, busy = false;
let selectedSkill: SkillId = save.run?.character ?? 'fuse';
let reportBossOnly = false;
let modal: 'quick-help' | 'help' | 'settings' | 'codex' | 'restart' | 'history' | null = null;
let modalTriggerAction: string | null = null;
let historyView: HistoryView = { page: 0 };
let historyReturn: { scroll: number; reportOpen: boolean; equipmentOpen: boolean; breakdownOpen: boolean } | null = null;
let tutorialHidden = save.meta.tutorialDone;
let feedback = '';
let pendingReward: RewardId | null = null;
let rewardReturn: { scroll: number; reportOpen: boolean; equipmentOpen: boolean; breakdownOpen: boolean } | null = null;
let guideOpen = false, guideIndex = 0;
let board: Board | null = null;
let boardLoading = false;
let skipAnimation = false, activeEffects: CombatEffects | null = null;
const demoRun = startRun(newSave(), 'fuse', 21).run!;
const demoRoot = demoRun.cells.findIndex((n, i) => !n && candidates(demoRun.cells, i).length === 1);
const demoPath = previewAction(demoRun, demoRoot).path;
const audio = new IncantationAudio();
audio.setEnabled(save.settings.sound);
const fmt = (n: number) => n.toLocaleString('ja-JP');
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const activeRun = () => save.run && (save.run.phase === 'battle' || save.run.phase === 'reward');
let saving = false, saveBlocked = false;
const persistNow = async () => {
  saving = true; app.setAttribute('aria-busy', 'true');
  const controls = [...app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
  const focusedControl = controls.find(control => control === document.activeElement);
  for (const control of controls) control.disabled = true;
  try {
    const result = await storage.persist(save);
    if (result.history) save.history = result.history;
    warning = result.warning; saveBlocked ||= !!result.conflict;
  } finally {
    saving = false; app.setAttribute('aria-busy', 'false');
    for (const control of controls) if (control.isConnected) control.disabled = false;
    if (focusedControl?.isConnected && document.activeElement === document.body) focusedControl.focus({ preventScroll: true });
  }
};

function header(): string {
  return `<header class="site-header"><button class="brand" data-action="home" aria-label="タイトルへ"><span class="brand-seal">✧</span><span>連鎖詠唱<span class="brand-sub">ナンプレ / NUMERAL GRIMOIRE</span></span></button><nav aria-label="メニュー"><button class="nav-button history-launch" data-action="history" aria-label="プレイ履歴" aria-haspopup="dialog">履歴</button><button class="nav-button" data-action="codex">遺物図鑑</button><button class="icon-button" data-action="help" aria-label="遊び方">?</button><button class="icon-button sound-button" data-action="sound" aria-label="${save.settings.sound ? '消音する' : '音をオンにする'}">${save.settings.sound ? '♪' : '♫̸'}</button><button class="icon-button" data-action="settings" aria-label="設定">⚙</button></nav></header>`;
}
function home(): string {
  const previewDigits = demoRun.cells.map((n, i) => n || demoPath.find(e => e.cell === i)?.value || 0).join('');
  return `<section class="home-hero"><div class="hero-copy"><p class="eyebrow"><span></span> A SMALL PUZZLE. AN EXTRAORDINARY SPELL.</p><h1>一手が、<br><em>魔法になる。</em></h1><p class="hero-description">ひとつの数字から、連鎖する詠唱。<br>遺物を集めて、あなただけの魔法を紡ぐ。<br>連鎖を育てて挑む、果てしない連戦。</p><div class="hero-actions"><div class="hero-main-actions">${activeRun() ? '<button class="primary" data-action="resume">冒険の続きへ <span>↗</span></button>' : '<button class="primary" data-action="new">冒険をはじめる <span>↗</span></button>'}<button class="secondary home-help" data-action="quick-help" aria-haspopup="dialog"><span aria-hidden="true">?</span> 遊び方</button></div>${activeRun() ? '<button class="text-button" data-action="new">新たな冒険をはじめる</button>' : '<span class="quiet">時間制限なし · 数字の知識は不要</span>'}</div><div class="home-record"><div><span>BEST SCORE</span><strong>${fmt(save.meta.bestScore)}</strong></div><div><span>敵の撃破</span><strong>${save.meta.clears}<small> 体</small></strong></div><div><span>最高撃破数</span><strong>${save.meta.bestKills}<small> 体</small></strong></div></div></div><div class="hero-art" aria-hidden="true"><div class="astral-ring ring-one"></div><div class="astral-ring ring-two"></div><div class="hero-star star-one">✧</div><div class="hero-star star-two">✦</div><div class="hero-star star-three">⋆</div><div class="decorative-board">${[...previewDigits].map((n, i) => `<span class="${demoPath.some(e => e.cell === i) ? 'lit' : ''}">${n !== '0' ? n : demoPath.some(e => e.cell === i) ? demoRun.solution[i] : ''}</span>`).join('')}</div><div class="art-caption"><span class="gold">✦</span> 小さな正解が、大きな力に。</div></div></section><section class="character-section"><div class="section-label"><span>01 / 術師を選ぶ</span><span class="quiet">冒険ごとに、違う詠唱を。</span></div><div class="character-grid">${CHARACTERS.map(c => { const locked = save.meta.clears < c.unlock; return `<button class="character-card ${chosen === c.id ? 'chosen' : ''} ${locked ? 'locked' : ''}" data-character="${c.id}" ${locked ? 'disabled' : ''} aria-pressed="${chosen === c.id}"><span class="character-symbol">${locked ? '⌑' : c.symbol}</span><span class="character-info"><span class="micro">${c.title}</span><strong>${c.name}</strong><span>${locked ? `累計${c.unlock}戦クリアで解放（${save.meta.clears}/${c.unlock}）` : c.passive}</span></span><span class="card-check">${chosen === c.id ? '✓' : locked ? '' : '↗'}</span></button>`; }).join('')}</div><div class="chosen-skill"><span>固有スキル / ${characterOf(chosen).skillName}</span>${characterOf(chosen).skill}</div></section><footer class="site-footer"><span>連鎖を育て、限界のその先へ。</span><span>進行はこのブラウザに自動保存されます</span></footer>`;
}
function tutorial(run: Run): string {
  if (tutorialHidden || run.stage > 0) return '';
  const text = canUseSkill(run) ? '固有スキルを使えます。無料回数があれば先に使い、魔力を残せます。未確定のマスからも詠唱できます。' : run.turn > 0 ? '◇で得た守護は、このシートの間ずっと反撃を軽減します。✧は追加ダメージの弱点です。' : selected !== null ? '金の線は連鎖予告。○は別の起点に選べます。' : '青緑の数字は、入る数字が1つに決まったマス。1つ選ぶと、そこから同じ行・列・区画へ連鎖を予告します。';
  return `<aside class="tutorial"><span>✧</span><p>${text}</p><button data-action="tutorial-close" aria-label="ガイドを閉じる">×</button></aside>`;
}
function chainGuide(report: Preview): string {
  if (!guideOpen || !report.chain || busy) return '';
  const step = explainStep(report, guideIndex);
  const end = guideIndex >= report.path.length;
  return `<section id="chain-guide" class="chain-guide" aria-label="連鎖のしくみ"><div class="guide-heading"><span>水色の枠＝直前 → 金の枠＝次</span><button class="text-button" data-action="chain-close">全体の予告へ ×</button></div><div class="guide-explanation" aria-live="polite" aria-atomic="true"><h3 id="chain-step-title">${esc(step.title)}</h3><p id="chain-step-detail">${esc(step.detail)}</p><p id="chain-budget">${esc(step.budget)}</p><p class="chain-note">${esc(step.note)}</p></div><div class="chain-navigation"><button data-action="chain-prev" ${guideIndex === 0 ? 'disabled' : ''} aria-label="連鎖の前の段階">← 前へ</button><span class="chain-position">${end ? '連鎖終了' : `${guideIndex + 1} / ${report.path.length}`}</span><button data-action="chain-next" ${end ? 'disabled' : ''} aria-label="連鎖の次の段階">${guideIndex === report.path.length - 1 ? '終了の理由 →' : '次へ →'}</button></div><p class="guide-footnote">確認中は手数も魔力も使いません。起点を変えるときは「全体の予告へ」。</p></section>`;
}
function breakdown(report: Preview, preview = false): string {
  const rows = damageBreakdown(report, preview);
  return rows.length ? `<dl class="damage-breakdown">${rows.map(row => `<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join('')}</dl>${report.fullClear ? '<p class="breakdown-note">完成加算は、この手で実際に埋めた割合に比例します。確率倍率はかかりません。</p>' : ''}` : '';
}
function relicBadge(run: Run, id: RelicId): string {
  return `<span class="relic-rank">${esc(relicTierLabel(run, id))} · Lv.${relicLevel(run, id)}${!run.expansionVersion && ['duality', 'trinity', 'quint', 'sept'].includes(id) ? ` · 取得 ${run.acquisitionRank[id] ?? 1}/3` : ''}</span>`;
}
function stowedInventory(run: Run): string {
  const stored = Object.entries(run.stowedRelics ?? {}) as [RelicId, { level: number; rank: number; tier: number }][];
  if (!stored.length) return '';
  return `<div class="stowed-inventory"><p>保管した育成記録 · 報酬で再取得すると復帰</p>${stored.map(([id, state]) => `<span>${relicOf(id).symbol} ${esc(relicOf(id).name)} <small>Lv.${state.level} · ${['通常', '上位', '極位'][state.tier - 1]}</small></span>`).join('')}<small>保管中は効果がありません。所持枠には数えません。</small></div>`;
}
function replacementLoss(run: Run, id: RelicId): string {
  if (id === 'glass') return '最大HPが8戻ります。現在HPは回復しません。';
  if (id === 'battery' && run.manaOverflow) return `蓄電 ${run.manaOverflow} は失われます。`;
  if (id === 'quint' && run.freeSkillTokens) return `無料スキル券 ${run.freeSkillTokens}回分は失われます。`;
  if (id === 'sept' && run.reservedAuto) return `次の手の予約＋${run.reservedAuto}回は失われます。`;
  if (id === 'afterglow' && run.afterglow) return '次の通常詠唱への残光の予約は失われます。';
  return '';
}
function replacementReward(run: Run, id: RewardId): string {
  const incoming = rewardOf(id, run), baseId = rewardRelicId(run, id)!;
  return `<div class="modal-eyebrow">RELIC EXCHANGE · ${run.inventory.length} / ${Math.max(RELIC_CAPACITY, run.inventory.length)}</div>${run.rewardStep === 'relic' && enemyForRun(run).isBoss ? '<p class="replacement-stage">✓ スキル選択は保存済み · 2/2 遺物</p>' : ''}<h2>入れ替える遺物を選ぶ</h2><p class="modal-intro">所持枠が満杯です。交換する1つを選んでください。<br>外した遺物の育成は保存し、報酬で再取得すると復帰します。</p><article class="replacement-incoming"><span class="relic-symbol">${incoming.symbol}</span><div><span class="relic-kind">迎え入れる遺物${run.stowedRelics?.[baseId] ? ' · 育成状態を復元' : ''}</span><h3>${esc(incoming.name)}</h3><p>${esc(incoming.description)}</p></div></article><p class="replacement-label">手放す遺物を選ぶ · クリックで交換を確定</p><div class="replacement-grid">${run.inventory.map(relicId => { const item = relicOf(relicId), loss = replacementLoss(run, relicId); return `<button class="replacement-card" data-replace="${relicId}"><span class="relic-symbol">${item.symbol}</span><span class="replacement-copy"><span class="relic-kind">${item.kind}</span><strong>${esc(item.name)}</strong>${relicBadge(run, relicId)}<span class="replacement-description">${esc(relicDescription(relicId, run))}</span>${loss ? `<span class="replacement-loss">${esc(loss)}</span>` : ''}</span><span class="take-relic">この遺物と入れ替える <b>↗</b></span></button>`; }).join('')}</div><div class="replacement-actions"><button class="secondary" data-action="reward-back">報酬の選択に戻る</button><p class="quiet">確定するまで遺物は変わりません。</p></div><div class="history-entry"><button class="text-button" data-action="history-reward" aria-haspopup="dialog">プレイ履歴を見る →</button></div>${run.inventory.length > RELIC_CAPACITY ? '<p class="quiet modal-footnote">以前の冒険の遺物は保持されています。入れ替えても所持数は変わりません。</p>' : ''}`;
}
function usableSkills(run: Run): SkillId[] {
  return [run.character, ...(run.equippedSkills ?? []).filter(id => id !== run.character)];
}
function currentSkill(run: Run): SkillId {
  if (!usableSkills(run).includes(selectedSkill)) selectedSkill = run.character;
  return selectedSkill;
}
function skillPicker(run: Run): string {
  const available = usableSkills(run);
  if (available.length < 2) return '';
  return `<div class="skill-picker" role="group" aria-label="使うスキル"><span>1詠唱に1つ</span>${available.map(id => `<button data-select-skill="${id}" aria-pressed="${currentSkill(run) === id}" ${busy ? 'disabled' : ''}><b>${skillOf(id).symbol}</b>${esc(skillOf(id).name)}<small>Lv.${skillLevel(run, id)}</small></button>`).join('')}</div>`;
}
function equipmentEditor(run: Run): string {
  if (!run.expansionVersion) return '';
  const extra = ownedSkills(run).filter(id => id !== run.character), equipped = run.equippedSkills ?? [];
  const intrinsic = skillOf(run.character);
  return `<details class="equipment-editor" ${extra.length && !matchMedia('(max-width: 760px)').matches ? 'open' : ''}><summary>次の戦いのスキル装備 <span>固有＋${equipped.length}/2枠</span></summary><p>装備の変更は戦闘の合間だけ。外したスキルも、所持とレベルは残ります。</p><div class="equipment-slots"><span class="intrinsic-slot"><b>${intrinsic.symbol} ${esc(intrinsic.name)}</b><small>固有 · Lv.${skillLevel(run, run.character)} · 常に使用可能</small></span>${[0, 1].map(index => { const id = equipped[index]; return `<span class="${id ? 'filled-slot' : 'empty-slot'}">${id ? `<b>${skillOf(id).symbol} ${esc(skillOf(id).name)}</b><small>追加${index + 1} · Lv.${skillLevel(run, id)}</small>` : `<b>追加スロット ${index + 1}</b><small>空き</small>`}</span>`; }).join('')}</div>${extra.length ? `<div class="equipment-options">${extra.map(id => { const active = equipped.includes(id), item = skillOf(id); return `<button data-equip-skill="${id}" aria-pressed="${active}" ${!active && equipped.length >= 2 ? 'disabled' : ''}><span>${item.symbol}</span><span><strong>${esc(item.name)} <small>Lv.${skillLevel(run, id)}</small></strong><small>${active ? '装備中 · 外す' : equipped.length >= 2 ? '先に1つ外してください' : 'このスキルを装備'}</small></span><b>${active ? '✓' : '＋'}</b></button>`; }).join('')}</div>` : '<p class="equipment-empty">ボス報酬でスキルを取得すると、追加スロットに装備できます。</p>'}<p class="equipment-saved" role="status">装備は選ぶたびに自動保存されます。</p></details>`;
}
function predictionCard(run: Run, report: Preview | null): string {
  const forecast = report?.forecast;
  const outcome = report ? outcomeText(report) : '';
  const chainText = report ? String(report.path.length) : '—';
  const damageText = report ? fmt(report.damage) : '—';
  const receivedText = report ? retaliationText(report) : '—';
  return `<div class="prediction-card ${report ? 'has-prediction' : ''}" data-forecast="${forecast ? 'chance' : 'certain'}">
    <div class="section-label"><span>${skill ? '✦ スキルの予告' : '詠唱の予告'}</span><button class="guide-toggle" data-action="chain-guide" aria-expanded="${guideOpen}" aria-controls="chain-guide" ${!report || busy ? 'disabled' : ''}>${guideOpen ? '全体の予告へ' : '連鎖のしくみ →'}</button></div>
    <div class="prediction-numbers"><div><strong id="prediction-chain" style="--number-length:${chainText.length}">${chainText}</strong><span>連鎖</span></div><div><strong id="prediction-damage" style="--number-length:${damageText.length}">${damageText}</strong><span>${forecast ? '確定ダメージ' : 'ダメージ'}</span></div><div class="${(forecast?.receivedMax ?? report?.received) ? 'hurt' : 'safe'}"><strong id="prediction-received" style="--number-length:${receivedText.length}">${receivedText}</strong><span>被ダメージ${forecast && forecast.receivedMin !== forecast.receivedMax ? 'の範囲' : ''}</span></div></div>
    ${forecast ? `<div class="chance-forecast">${forecast.procs?.length ? forecast.procs.map(proc => `<span data-proc="${proc.id}">${esc(procName(proc.id))} <b>${percentText(proc.chance)}%で発動</b><small>${esc(procEffect(proc.id, proc.value))}</small></span>`).join('') : forecast.chance ? `<span>Ⅲ 三の護符 <b>${percentText(forecast.chance)}%で発動</b></span>` : ''}${forecast.damageMax !== report!.damage ? `<strong>発動時 最大${fmt(forecast.damageMax)} ダメージ</strong>` : ''}<small>各護符の抽選は詠唱の確定時に1回。予告・起点の変更では抽選しません。</small></div>` : ''}
    <p class="prediction-detail">${report ? `${report.units ? `完成 ${report.units}単位` : '完成ボーナスなし'}<span>·</span>${report.shield ? `守護 ${sheetShield(run)}→${report.shield}` : '守護なし'}<span>·</span>${skill ? run.freeSkillTokens > 0 ? '無料スキル1回を優先使用 · 魔力を温存' : `魔力8消費${run.manaOverflow ? ` · 蓄電${run.manaOverflow}を引継ぎ` : ''}` : `魔力 ＋${report.charge}${run.inventory.includes('battery') ? ` · 蓄電${report.manaOverflow ?? run.manaOverflow}/${relicValues(run, 'battery').overflow}` : ''}`}` : '数字を選ぶと、連鎖と攻撃を予告します。'}</p>
    ${report ? `${outcome ? `<p class="prediction-outcome ${forecast?.survival === 'possible' || forecast?.survival === 'none' ? 'risk' : ''}">${esc(outcome)}</p>` : ''}${(report.segments?.length ?? 0) > 1 ? `<p class="sheet-forecast">${report.segments!.length}シートにまたがる連鎖 · 攻撃と反撃は最後に1回</p>` : ''}<div class="prediction-footer"><p class="chain-stop">${esc(stopText(report))}</p><details class="prediction-breakdown"><summary>攻撃の内訳</summary>${breakdown(report, true)}</details></div>` : ''}
  </div>`;
}
function castControls(run: Run): string {
  const label = busy ? '詠唱中…' : selected === null ? '起点を選んでください' : skill ? 'スキルを詠唱する' : `「${run.solution[selected]}」を詠唱する`;
  return `<div class="cast-controls"><button class="primary cast-button" data-action="cast" aria-keyshortcuts="C" title="C キーで詠唱" ${!prediction || busy ? 'disabled' : ''}><span class="cast-label">${label}</span><span class="cast-shortcut"><kbd>C</kbd><span aria-hidden="true">${busy ? '⋯' : '↗'}</span></span></button></div>`;
}
function lastSpell(report: Report): string {
  return `<details class="last-spell" ${report.oneCastClear ? 'open' : ''}><summary>${report.oneCastClear ? '✦ 一詠全成！ 前の詠唱' : '前の詠唱'}</summary><p>${report.path.length}連鎖 · ${fmt(report.damage)}ダメージ<br>完成 ${report.units}単位 · 反撃 ${report.received}<br>回復 ${report.healed}${report.relicHealed ? `（反撃前 ${report.relicHealed}・成長 ${report.healed - report.relicHealed}）` : ''}<br>${report.skill ? `${report.freeSkill ? '無料スキルを使用 · 魔力を温存' : `${report.skillId ? skillOf(report.skillId).name : '固有スキル'}を使用`}${report.manaRestored ? ` · 蓄電から魔力${report.manaRestored}を引継ぎ` : ''}` : `魔力 ＋${report.charge}`} ${report.manaOverflow ? `· 蓄電 ${report.manaOverflow}` : ''}<br>${esc(stopText(report))}${report.sweep.length ? `<br>敵撃破の一掃 ${report.sweep.length}マス（連鎖・完成加算の対象外）` : ''}</p>${breakdown(report)}</details>`;
}
function battle(run: Run): string {
  const enemy = enemyForRun(run), character = characterOf(run.character), intent = enemyIntent(run), activeSkill = currentSkill(run), selectedSpell = skillOf(activeSkill);
  const attack = incomingAttack(run), p = prediction, ready = canUseSkill(run), lens = relicValues(run, 'lens');
  const longest = !busy && !guideOpen ? longestOrigins(run, skill, activeSkill) : null;
  const previewSheet = guideOpen && p ? p.path[Math.min(guideIndex, p.path.length - 1)]?.sheet ?? run.sheet : run.sheet;
  const shownEncounterSheet = run.encounterSheet + previewSheet - run.sheet;
  const guideOnSide = matchMedia('(min-width: 761px)').matches;
  const guidance = p ? chainGuide(p) : '';
  const cycleLength = run.balanceVersion === 1 ? 6 : 5;
  const milestone = Math.floor(run.stage / cycleLength) * cycleLength + cycleLength;
  const track = Array.from({ length: cycleLength }, (_, index) => `<i class="${index < run.stage % cycleLength ? 'cleared' : index === run.stage % cycleLength ? 'current' : ''} ${index === cycleLength - 1 ? 'milestone' : ''}" aria-hidden="true">${index === cycleLength - 1 ? '✦' : '·'}</i>`).join('');
  return `<section class="adventure-heading"><div class="endless-track" aria-label="第${run.stage + 1}戦、第${enemy.cycle}巡"><strong>第${run.stage + 1}戦</strong><span>第${enemy.cycle}巡</span><div class="boss-track" title="第${milestone}戦はボス">${track}</div><small>${enemy.isBoss ? 'BOSS' : `ボスまで ${milestone - run.stage - 1}戦`}</small></div><div class="run-score"><span>SCORE</span><strong>${fmt(run.score)}</strong></div></section>
  <section class="game-layout"><div class="battlefield"><div class="enemy-card ${enemy.isBoss ? 'boss' : ''}"><div class="enemy-portrait">${emblem(enemy.symbol)}</div><div class="enemy-info"><div class="enemy-overline"><span>${enemy.isBoss ? `第${enemy.cycle}巡のボス` : `ENCOUNTER ${String(run.stage + 1).padStart(2, '0')}`}</span><span>${run.turn + 1}手目</span></div><h1>${enemy.name}</h1><div class="enemy-health"><div class="health-track"><i style="width:${run.enemyHp / enemy.hp * 100}%"></i>${p ? `<b title="確定ダメージの予告" style="width:${Math.min(run.enemyHp, p.damage) / enemy.hp * 100}%;left:${Math.max(0, run.enemyHp - p.damage) / enemy.hp * 100}%"></b>` : ''}</div><span>${fmt(run.enemyHp)}<small> / ${fmt(enemy.hp)}</small></span></div></div><div class="enemy-intent ${attack > enemy.attack ? 'danger' : ''}"><span>${esc(intent.label)}</span><strong>⚔ ${attack}</strong><small>${esc(intent.warning)}</small></div></div>
  <p class="enemy-behavior"><span>${esc(enemy.attackName)}</span>${esc(enemy.behavior)}</p><div class="sheet-status"><span>${guideOpen ? '予告シート' : 'シート'} <b>${shownEncounterSheet}</b><small>通算 ${previewSheet}枚目</small></span><span class="spell-growth" title="シート完成と敵撃破でレベルアップ。自動入力回数、攻撃倍率、最大HPが上がります。">術式 Lv.${run.spellLevel}<b>自動＋${chainBonus(run.spellLevel)}</b><b>攻撃 ×${spellMultiplier(run.spellLevel).toFixed(1)}</b></span></div>${tutorial(run)}<div id="board-slot"></div>${longest ? `<p class="longest-origins" data-length="${longest.length}" data-count="${longest.cells.length}"><span>★ 最長の起点</span> 最長 <b>${longest.length}連鎖</b> · 起点 <b>${longest.cells.length}マス</b><small>ダメージは各予告で比較</small></p>` : ''}${guideOnSide ? '' : guidance}
  <div class="board-legend"><span class="root-legend"><i>○</i>${skill ? '選べる起点' : '確定した起点'}（線の中でも選び直せます）</span><span class="selected-legend">● 選択中</span><span class="path-legend">─ 連鎖の予告</span><span class="weak-text">✧ 弱点 ＋${lens.weakDamage}${lens.weakRootDamage ? `（起点ならさらに＋${lens.weakRootDamage}）` : ''}</span><span class="shield-text">◇ 守護 ＋6</span><span class="sheet-ward" title="獲得した守護は、シート完成時の反撃まで毎回有効。次のシートで0に戻ります。">守護 <b>${sheetShield(run)}</b><small>シート内で継続</small></span></div><p class="battle-lore">${enemy.lore}</p></div>
  <aside class="command-panel">${castControls(run)}<div class="player-heading"><span class="player-symbol">${character.symbol}</span><div><span class="micro">YOUR INCANTATION</span><h2>${character.name}</h2></div><button class="tiny-button" data-action="home">中断</button></div><div class="vitals"><div class="vital-health"><div><span>生命力</span><strong>${run.hp}<small> / ${run.maxHp}</small></strong></div><div class="health-track player"><i style="width:${run.hp / run.maxHp * 100}%"></i></div></div><div class="vital-mana"><div><span>魔力</span><strong>${run.mana}<small> / 8</small></strong></div><div class="mana-pips">${Array.from({ length: 8 }, (_, i) => `<i class="${i < run.mana ? 'full' : ''}"></i>`).join('')}</div>${run.inventory.includes('battery') ? `<div class="mana-reserve" title="魔力8を超えた充電を${relicValues(run, 'battery').overflow}まで蓄え、有料スキル使用後に引き継ぎます。"><span>蓄電</span><b>${run.manaOverflow} / ${relicValues(run, 'battery').overflow}</b><small>スキル後に引継ぎ</small></div>` : ''}</div></div>${run.freeSkillTokens || run.reservedAuto || run.boons.defense || run.boons.magic ? `<div class="spell-resources" aria-label="予約と祝福">${run.freeSkillTokens ? `<span class="free-skill-tokens">Ⅴ 無料スキル <b>${run.freeSkillTokens}回</b><small>魔力より先に使います</small></span>` : ''}${run.reservedAuto ? `<span class="reserved-auto">Ⅶ 次の手 <b>自動＋${run.reservedAuto}回</b></span>` : ''}${run.boons.defense ? `<span class="defense-boon">守護の祝福 <b>残り${run.boons.defense}戦</b></span>` : ''}${run.boons.magic ? `<span class="magic-boon">魔力の祝福 <b>残り${run.boons.magic}戦</b></span>` : ''}</div>` : ''}${guideOnSide ? guidance : ''}${predictionCard(run, p)}${skillPicker(run)}
  <button class="skill-button ${skill ? 'active' : ''} ${ready ? 'ready' : ''}" data-action="skill" ${!ready || busy ? 'disabled' : ''} aria-pressed="${skill}"><span class="skill-icon">${selectedSpell.symbol}</span><span><strong>${esc(selectedSpell.name)} <em class="skill-rank">Lv.${skillLevel(run, activeSkill)}</em></strong><small>${skill ? 'スキル選択中 · 解除する' : ready ? run.freeSkillTokens > 0 ? '無料回数を優先 · 魔力を温存' : '共通の魔力8で発動' : 'スキル · 数字を埋めて充電'}</small></span><b>${skill ? '✓' : ready ? '↗' : `${run.mana}/8`}</b></button><p class="skill-description">${esc(capacityText(run, skill, p, activeSkill))}<br>${skill ? esc(skillDescriptionFor(run, activeSkill)) : '直前のマスと同じ行・列・3×3区画の確定マスへ。'}</p>${busy ? '<button class="animation-skip" data-action="skip-animation">演出をスキップ →</button>' : ''}<p class="feedback" role="status">${esc(feedback || (run.afterglow ? `残光の灯：次の通常入力は自動入力＋${relicValues(run, 'afterglow').afterglowAuto}` : '考えている間、敵は動きません。'))}</p>
  <details class="inventory" ${run.inventory.length ? '' : 'open'}><summary>所持している遺物 <span>${run.inventory.length} / ${Math.max(RELIC_CAPACITY, run.inventory.length)}</span></summary><div>${run.inventory.length ? run.inventory.map(id => { const relic = relicOf(id); return `<div class="inventory-item" data-relic="${id}"><span>${relic.symbol}</span><div><strong>${relic.name}</strong>${relicBadge(run, id)}<p>${esc(relicDescription(id, run))}</p></div></div>`; }).join('') : '<p class="quiet empty-inventory">戦闘に勝つと、遺物や修練から<br>次の力を選べます。</p>'}</div>${stowedInventory(run)}</details>${run.lastReport ? lastSpell(run.lastReport) : ''}</aside></section>`;
}
function reward(run: Run): string {
  const enemy = enemyForRun(run), staged = enemy.isBoss && (run.rewardStep === 'skill' || run.rewardStep === 'relic');
  const unlocked = CHARACTERS.filter(c => c.unlock > 0 && c.unlock === save.meta.clears).map(c => c.name);
  if (pendingReward && run.rewards.includes(pendingReward) && needsRelicReplacement(run, pendingReward)) return replacementReward(run, pendingReward);
  const heading = run.rewardStep === 'skill' ? '使いこなす術式を、選ぶ。' : staged && run.rewardStep === 'relic' ? '次は、遺物を育てる。' : enemy.isBoss ? '詠唱は、さらに先へ。' : '新たな力を、ひとつ。';
  return `<div class="modal-eyebrow">${enemy.isBoss ? 'BOSS' : 'ENCOUNTER'} ${String(run.stage + 1).padStart(2, '0')} COMPLETE</div>${staged ? `<div class="reward-progress" aria-label="ボス報酬 ${run.rewardStep === 'skill' ? '1/2 スキル' : '2/2 遺物'}"><span class="${run.rewardStep === 'skill' ? 'current' : 'complete'}">${run.rewardStep === 'skill' ? '1/2' : '✓'} スキル</span><i>→</i><span class="${run.rewardStep === 'relic' ? 'current' : ''}">2/2 遺物</span></div>` : ''}<h2>${heading}</h2><p class="modal-intro">${run.rewardStep === 'skill' ? 'スキルを1つ取得・強化。そのあと遺物を1つ選べます。' : staged && run.rewardStep === 'relic' ? 'スキルの選択は保存済み。遺物を選ぶと、次の戦いへ進みます。' : enemy.isBoss ? 'ボスを撃破！ 鍛えた詠唱と新たな力で、さらに先へ。' : '敵を撃破しました。新しい力を選んで、さらに先へ。'}</p><div class="reward-summary"><span>✧ 撃破 ＋500</span>${run.lastReport ? `<span>♡ 生命力 ＋${run.lastReport.healed}</span>` : ''}<span>術式 Lv.${run.spellLevel}</span></div>${run.lastReport?.oneCastClear ? `<div class="one-cast-summary">✦ 一詠全成！ ${run.lastReport.segments?.filter(part => part.oneCastClear).length ?? 1}枚を一度の詠唱で完成<div>完成加算 合計 ＋${fmt(run.lastReport.clearBonus ?? 0)} ダメージ</div></div>` : ''}
  <div class="history-entry"><button class="text-button" data-action="history-reward" aria-haspopup="dialog">プレイ履歴を見る →</button></div>
  ${enemy.isBoss ? contributionReport(run, reportBossOnly).replace('</section>', '<button class="text-button report-history-link" data-action="history-report" aria-haspopup="dialog">詠唱ごとのプレイ履歴を見る →</button></section>') : ''}${equipmentEditor(run)}
  <p class="reward-slots">遺物 ${run.inventory.length} / ${Math.max(RELIC_CAPACITY, run.inventory.length)} 枠 · 所持遺物の強化・進化とスキルは枠を使いません。${run.inventory.length >= RELIC_CAPACITY ? '新しい遺物は1つと入れ替えます。' : ''}</p>
  ${!run.relicBalanceVersion ? '<p class="quiet reward-balance-note">次の戦闘から新しい遺物バランスに切り替わります。</p>' : ''}
  <div class="reward-grid">${run.rewards.map(id => {
    const relic = rewardOf(id, run), baseId = id.replace(/^(greater:|apex:)/, '');
    const isSkill = id.startsWith('skill:'), skillId = isSkill ? id.slice(6) as SkillId : null;
    const needsReplacement = needsRelicReplacement(run, id);
    const stowed = run.stowedRelics?.[baseId as RelicId];
    const upgrade = id === 'skill-upgrade' || id.startsWith('greater:') || id.startsWith('apex:') || (skillId && skillLevel(run, skillId) > 0) || (run.expansionVersion && run.inventory.includes(id as RelicId));
    const repeated = !run.expansionVersion && ['duality', 'trinity', 'quint', 'sept'].includes(id) && run.inventory.includes(id as RelicId);
    const progression = skillId ? `${skillLevel(run, skillId) ? `Lv.${skillLevel(run, skillId)}` : '未所持'} → Lv.${Math.min(10, skillLevel(run, skillId) + 1)}` : id === 'skill-upgrade' ? `${characterOf(run.character).skillName} · Rank 1 → 2` : id.startsWith('apex:') ? `${relicTierLabel(run, baseId as RelicId)} → ${relicTierLabel({ ...run, tier: { ...run.tier, [baseId]: Math.min(3, (run.tier[baseId as RelicId] ?? 1) + 1) } }, baseId as RelicId)}` : id.startsWith('greater:') ? '通常 → 上位' : run.expansionVersion && run.inventory.includes(id as RelicId) ? `Lv.${relicLevel(run, id as RelicId)} → Lv.${Math.min(10, relicLevel(run, id as RelicId) + 1)}` : repeated ? `取得 ${run.acquisitionRank[id as RelicId] ?? 1} → ${(run.acquisitionRank[id as RelicId] ?? 1) + 1} / 3` : '';
    return `<button class="reward-card ${upgrade ? 'upgrade-reward' : ''}" data-reward="${id}"><span class="relic-kind">${isSkill ? skillLevel(run, skillId!) ? 'スキル強化' : '新しいスキル' : upgrade ? '成長' : repeated ? '再取得 · 確率強化' : relic.kind}</span><span class="relic-symbol">${relic.symbol}</span><strong>${esc(relic.name)}</strong>${progression ? `<span class="upgrade-path">${esc(progression)}</span>` : ''}<p>${esc(relic.description)}</p><span class="take-relic">${needsReplacement ? '入れ替える遺物を選ぶ' : stowed ? '以前の育成状態で迎える' : upgrade ? 'この力を強化する' : 'この力を選ぶ'} <b>↗</b></span></button>`;
  }).join('')}</div>${run.lastReport ? `<details class="reward-breakdown"><summary>今の詠唱の内訳</summary>${breakdown(run.lastReport)}</details>` : ''}${unlocked.length ? `<div class="unlock-notice">✧ ${unlocked.join('・')} を解放！ 次の冒険から使えます。</div>` : ''}<p class="quiet modal-footnote">次の相手：${enemyAt(run.stage + 1).name}（第${run.stage + 2}戦） · 取得・強化はこの冒険の間だけ有効です</p>`;
}
function result(run: Run): string {
  const won = run.phase === 'won';
  return `<div class="result-seal">${won ? '✧' : '☾'}</div><div class="modal-eyebrow">${won ? 'THE GRIMOIRE IS COMPLETE' : 'A SPELL TO REMEMBER'}</div><h2>${won ? 'あなたの詠唱が、夜を明かした。' : 'この詠唱は、次の一手へ。'}</h2><p class="modal-intro">${won ? '以前の六連戦を踏破した記録です。次の冒険は、果てしない連戦へ。' : `第${run.stage + 1}戦で挑戦終了。${run.stats.kills}体を撃破し、術式 Lv.${run.spellLevel}まで成長しました。`}</p><div class="result-score"><span>FINAL SCORE</span><strong>${fmt(run.score)}</strong><small>${run.score >= save.meta.bestScore ? '✦ 自己ベスト' : `BEST ${fmt(save.meta.bestScore)}`}</small></div><div class="result-stats"><div><strong>${run.stats.bestChain}</strong><span>最大連鎖</span></div><div><strong>${run.stats.moves}</strong><span>詠唱した手数</span></div><div><strong>${run.stats.filled}</strong><span>連鎖で埋めた数字</span></div></div><p class="result-growth">完成シート ${run.stats.sheets}枚 · 自動入力＋${chainBonus(run.spellLevel)} · 攻撃 ×${spellMultiplier(run.spellLevel).toFixed(1)}</p>${run.lastReport ? `<details class="reward-breakdown"><summary>最後の詠唱${run.lastReport.oneCastClear ? ' · 一詠全成' : ''}</summary>${breakdown(run.lastReport)}</details>` : ''}<div class="result-relics">${run.inventory.map(id => `<span title="${relicOf(id).name}">${relicOf(id).symbol}</span>`).join('')}</div><div class="history-entry"><button class="text-button" data-action="history-result" aria-haspopup="dialog">プレイ履歴を見る →</button></div><button class="primary" data-action="result-home">次の冒険へ <span>↗</span></button><p class="quiet modal-footnote">戦績と解放した要素を保存しました。</p>`;
}
function quickHelp(): string {
  return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button>
    <div class="modal-eyebrow">HOW TO PLAY</div><h2>かんたんな遊び方</h2>
    <p class="quick-help-flow">マスを選ぶ <span aria-hidden="true">→</span> 予告を見る <span aria-hidden="true">→</span> 詠唱する</p>
    <ol class="help-steps">
      <li><strong>青緑の数字を選ぶ</strong><p>○がついた青緑の数字は、入る数字が1つに決まったマス。タップすると連鎖を予告します。</p></li>
      <li><strong>予告を見て「詠唱する」</strong><p>連鎖・ダメージ・受ける反撃を確認。起点は何度でも選び直せます。「詠唱する」で数字が入り、敵を攻撃します。</p></li>
      <li><strong>同じ行・列・区画へ連鎖</strong><p>基本は、直前に埋めたマスと同じ行・列・3×3区画の、最も近い確定マスへ自動でつながります。行・列・区画の完成で追加ダメージ。</p></li>
      <li><strong>魔力をためて、スキルを使う</strong><p>通常の詠唱で魔力をため、魔力8か無料券でスキルを使えます。未確定の空きマスからも始められます。</p></li>
      <li><strong>敵を倒して、力を育てる</strong><p>撃破後は3択から報酬を選び、次の戦いへ。ボスではスキルと遺物を1つずつ獲得。シート完成や撃破で術式レベルが上がり、連鎖も育ちます。</p></li>
    </ol>
    <p class="help-note">時間制限なし。考えている間は敵も待ちます。<br>PCは矢印キーでマスを移動、Enterで選択。Cキー、または「詠唱する」で確定します。</p>
    <div class="quick-help-actions"><button class="text-button" data-action="help-details">詳しいルール</button><button class="secondary" data-action="close">タイトルへ戻る</button></div>`;
}
function closeModal(): void {
  const trigger = modalTriggerAction, returning = modal === 'history' ? historyReturn : null;
  modal = null; modalTriggerAction = null; historyReturn = null; render();
  const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
  if (returning && dialog) {
    for (const [selector, open] of [['.contribution-details', returning.reportOpen], ['.equipment-editor', returning.equipmentOpen], ['.reward-breakdown', returning.breakdownOpen]] as const) {
      const details = dialog.querySelector<HTMLDetailsElement>(selector);
      if (details) details.open = open;
    }
    dialog.scrollTop = returning.scroll;
  }
  if (trigger) (dialog ?? app).querySelector<HTMLElement>(`[data-action="${trigger}"]`)?.focus({ preventScroll: true });
}
function openHistory(trigger: string): void {
  const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
  historyReturn = dialog ? { scroll: dialog.scrollTop, reportOpen: !!dialog.querySelector<HTMLDetailsElement>('.contribution-details')?.open, equipmentOpen: !!dialog.querySelector<HTMLDetailsElement>('.equipment-editor')?.open, breakdownOpen: !!dialog.querySelector<HTMLDetailsElement>('.reward-breakdown')?.open } : null;
  historyView = { runKey: save.history?.runs.at(-1)?.key, page: 0 };
  modalTriggerAction = trigger; modal = 'history'; render();
}
function renderHistoryPage(): void {
  // Replacing only the dialog keeps the board and reward state untouched.
  const dialog = app.querySelector<HTMLElement>('.history-modal');
  if (!dialog) return;
  dialog.innerHTML = playHistory(save.history, historyView);
  dialog.scrollTop = 0;
  dialog.querySelector<HTMLElement>('[data-history-run]')?.focus({ preventScroll: true });
}
function modalBody(): string | null {
  if (modal === 'history') return playHistory(save.history, historyView);
  if (modal === 'quick-help') return quickHelp();
  if (modal === 'help') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">HOW TO PLAY</div><h2>数字をつなぎ、魔法を紡ぐ。</h2><ol class="help-steps"><li><strong>青緑の数字から、起点を選ぶ</strong><p>候補が1つのマスに○と細い枠がつきます。連鎖の予告線の中でも、○のマスへ起点を選び直せます。●は選択中、金色の数字と線はその連鎖の予告です。★は、現在の通常・スキルで最長の連鎖になるすべての起点です。冒険の最初から表示されます。</p></li><li><strong>予告を見比べて、詠唱する</strong><p>「連鎖のしくみ」で1マスずつ確認できます。直前に埋めたマスと同じ行・列・3×3区画にある確定マスへ進みます。最初から確定していたマスも対象です。縦の距離＋横の距離が近い順、同距離なら上の行・左の列を優先します。</p></li><li><strong>術式が育つほど、連鎖も長くなる</strong><p>Lv.1の導火術師は起点1＋自動4で最大5連鎖。レベルが1上がるたび、自動入力がさらに1回増えます。たとえば術式Lv.10・固有スキルLv.1なら、通常最大14連鎖、スキルで最大18連鎖。残り回数が0か、直前のマスからつながる確定マスがなくなると終了。1マス埋まるたびに候補を計算し直します。遺物で回数や飛び先が増えることもあります。</p></li><li><strong>完成・弱点・盾を狙う</strong><p>行・列の完成は光の奔流、3×3区画の完成は魔法陣のカットインと追加攻撃。シート完成時は、この一手で埋めた割合に応じて基礎攻撃の最大25%を加算。初期の空きマスを一度で埋め切る「一詠全成」が最大の完成加算です。✧は弱点、◇は守護＋6。守護は同じシートの間ずっと蓄積し、毎回の反撃を軽減します。残り数マスになっても消えません。敵が生き残ると、連鎖の後に反撃します。</p></li><li><strong>魔力8、または無料券でスキル</strong><p>未確定の空きマスからも始動できます。通常詠唱は埋めた1マスにつき魔力＋1、マス由来の充電は1詠唱最大5です。蓄光術師・蓄電石の追加分はこの上限とは別に加算します。無料スキルの回数があるときは先に使い、魔力を温存します。無料回数がなければ魔力8を消費し、スキルの手は充電されません。固有スキルと追加2枠から、1詠唱に1つだけ選べます。魔力8と無料券はすべてのスキルで共通です。追加スキルの装備変更は報酬画面で行い、外しても所持とレベルは残ります。遺物の${RELIC_CAPACITY}枠とは別の装備枠です。スキルはLv.10まで成長し、Lv.5・10で進化します。蓄電石の余剰魔力は、有料スキルの発動後に引き継ぎます。</p></li><li><strong>シートを重ね、どこまでも連戦</strong><p>上位・長い導火線があると、シート完成時に自動入力回数が残っていれば次のシートへ連鎖を続けます。新しいシートの最初の入力も自動入力1回を使います。攻撃と敵の反撃は全シートの連鎖が終わってから1回だけ。守護はシートごとに0に戻り、反撃にはこの詠唱中に得た最も高いシート守護を使います。シート完成と敵撃破で術式レベルが1ずつ上がり、自動入力＋1回、攻撃倍率＋0.2、最大HP＋4、HPを最大10回復。敵撃破で残りの盤面を一掃し、3択で新しい力を選びます。基本は遺物3択で、回復や修練がときどき候補に加わります。5戦ごとにボスが登場し、スキルを選ぶ1/2、遺物を選ぶ2/2の順に、両方の報酬を受け取れます。選択は段階ごとに保存されます。遺物は全${RELICS.length}種が最初の冒険から報酬候補に入り、${RELIC_CAPACITY}枠まで同時に使えます。満杯で新しい遺物を選ぶと、効果を比較して1つと入れ替えます。外した遺物のレベル・取得回数・段階はこの冒険中は保存され、報酬で再取得するとその状態へ戻ります（再取得だけではレベルは上がりません）。蓄電や無料券、次の詠唱への予約効果は外すと消えます。所持遺物の強化・進化は枠を使いません。遺物はLv.10まで育ち、通常・上位・極位の段階はレベルと別に成長します。二・三・五・七の護符は、最初の3回で発動確率が30%、45%、60%と育ち、その後もレベルに応じて成長します。二は反撃軽減、三は攻撃倍率、五は無料スキル、七は次の手の自動入力を予約します。無料スキルの所持中・使用中は五の護符を抽選しないため、無料回数はそのまま使い切れます。それぞれの数字を含む連鎖で、各護符を詠唱確定時に1回抽選。確定ダメージと発動時ダメージを分けて予告します。遺物が出尽くしても修練・最大HP強化・5戦の祝福などの選択が続きます。祝福は再取得すると残り5戦に更新され、重複しません。HPが尽きるまで連戦は続き、一掃はシート完成の成長・得点・充電の対象外です。</p></li></ol><p class="help-note">時間制限はありません。PCでは矢印キーでマスを移動し、Enterで選択できます。通常・スキルともに、Cキーまたは「詠唱する」で確定します。</p>`;
  if (modal === 'settings') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">PREFERENCES</div><h2>詠唱のひとときを整える。</h2><div class="settings-list">${[{ key: 'largeText', name: '文字を大きく', text: '説明文とPCの操作表示を、標準よりさらに大きくします。' }, { key: 'sound', name: '効果音', text: '操作・魔法・打撃・防御・成長を異なる音で演出します。' }, { key: 'fast', name: '演出を短く', text: '連鎖・魔法カットイン・反撃・シート切替を短縮します。' }, { key: 'reducedMotion', name: '動きを抑える', text: '揺れや閃光を止め、攻撃と成長を文字で表示します。' }].map(s => `<label><span><strong>${s.name}</strong><small>${s.text}</small></span><input type="checkbox" data-setting="${s.key}" ${save.settings[s.key as keyof typeof save.settings] ? 'checked' : ''}></label>`).join('')}</div><p class="help-note">進行はこのブラウザに自動保存されます。別の端末とは共有されません。サイトデータを削除すると記録も消えます。</p><p class="help-note">効果音素材：Kenney / JaggedStone（CC0）。<a href="./audio-licenses/CREDITS.txt" target="_blank" rel="noopener">出典とライセンス</a></p>`;
  if (modal === 'codex') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">THE RELIC ARCHIVE</div><h2>詠唱を育てる、${RELICS.length}の遺物。</h2><p class="modal-intro">全${RELICS.length}種が最初の冒険から報酬候補に入ります。同時に使えるのは${RELIC_CAPACITY}枠。選んで集め、各遺物をLv.10まで育て、通常・上位・極位へ進化させられます。</p><div class="codex-grid">${RELICS.map(r => `<article class="codex-item"><span>${r.symbol}</span><div><small>${r.kind}</small><h3>${r.name}</h3><p>${esc(relicGrowthDescription({ ...demoRun, inventory: [r.id], relicLevels: { [r.id]: 1 }, acquisitionRank: {}, tier: {} }, r.id))}</p><b class="unlocked">最初から報酬候補</b></div></article>`).join('')}</div>`;
  if (modal === 'restart') return `<div class="modal-eyebrow">A NEW JOURNEY</div><h2>新しい冒険をはじめますか？</h2><p class="modal-intro">今の冒険の進行は置き換わります。これまでの戦績と解放した要素は残ります。プレイ履歴は保存上限の範囲で残ります。</p><div class="dialog-actions"><button class="secondary" data-action="close">戻る</button><button class="primary" data-action="restart">新しい冒険をはじめる ↗</button></div>`;
  if (view === 'battle' && save.run?.phase === 'reward') return reward(save.run);
  if (view === 'battle' && save.run && ['won', 'lost'].includes(save.run.phase)) return result(save.run);
  return null;
}
function render(displayRun = save.run): void {
  const focus = document.activeElement as HTMLElement | null;
  const cellFocus = focus?.dataset.cell;
  const actionFocus = focus?.dataset.action;
  const rewardFocus = focus?.dataset.reward, replacementFocus = focus?.dataset.replace;
  const oldDialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const hadModal = !!oldDialog, modalScroll = oldDialog?.scrollTop ?? 0;
  const sameModal = oldDialog?.dataset.modalKind === (modal ?? save.run?.phase ?? '');
  const sameRewardStep = sameModal && oldDialog?.dataset.rewardStep === (save.run?.rewardStep ?? '') && oldDialog?.dataset.pendingReward === (pendingReward ?? '');
  const reportDetailsOpen = !!app.querySelector<HTMLDetailsElement>('.contribution-details')?.open;
  const equipmentOpen = app.querySelector<HTMLDetailsElement>('.equipment-editor')?.open;
  const focusedData = ['select-skill', 'equip-skill', 'report-window'].find(key => focus?.hasAttribute(`data-${key}`));
  const focusedValue = focusedData ? focus?.getAttribute(`data-${focusedData}`) : null;
  // Async board loading and responsive redraws must not close a read-only
  // history tree or discard its nested pagination/focus while it is being read.
  const keepHistoryDialog = !busy && modal === 'history' && sameModal ? oldDialog : null;
  const body = busy ? null : keepHistoryDialog ? ' ' : modalBody();
  document.documentElement.classList.toggle('large-text', !!save.settings.largeText);
  document.documentElement.classList.toggle('reduced-motion', save.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
  app.innerHTML = `<div class="app-shell" ${body ? 'inert' : ''}>${header()}${warning && !body ? `<div class="warning" role="alert">${esc(warning)}</div>` : ''}<main>${view === 'battle' && displayRun ? battle(displayRun) : home()}</main></div><div id="modal-layer">${body ? `<div class="modal-backdrop"><section class="modal ${modal === 'quick-help' ? 'quick-help' : ''} ${modal === 'history' ? 'history-modal' : ''} ${modal === 'codex' ? 'wide' : ''} ${!modal && save.run?.phase === 'reward' ? 'reward-modal' : ''}" role="dialog" data-modal-kind="${modal ?? save.run?.phase ?? ''}" data-reward-step="${save.run?.rewardStep ?? ''}" data-pending-reward="${pendingReward ?? ''}" aria-modal="true" aria-label="${modal === 'history' ? 'プレイ履歴' : modal === 'codex' ? '遺物図鑑' : modal === 'settings' ? '設定' : modal === 'help' || modal === 'quick-help' ? '遊び方' : modal === 'restart' ? '新しい冒険' : save.run?.phase === 'reward' ? '成長の選択' : '冒険の結果'}" tabindex="-1">${warning ? `<div class="warning" role="alert">${esc(warning)}</div>` : ''}${body}</section></div>` : ''}</div><div class="sr-only" aria-live="polite">${busy ? '連鎖を詠唱しています' : prediction ? `${esc(accessiblePrediction(prediction))}` : ''}</div>`;
  if (keepHistoryDialog) app.querySelector('[role="dialog"]')?.replaceWith(keepHistoryDialog);
  if (view === 'battle' && displayRun) {
    if (board) {
      board.mount(document.getElementById('board-slot')!);
      board.set(displayRun, prediction, selected, skill, busy || displayRun.phase !== 'battle', guideOpen && prediction && !busy ? guideIndex : null, currentSkill(displayRun));
    } else {
      document.getElementById('board-slot')!.innerHTML = '<div class="board-loading">✧<span>魔法陣を開いています…</span></div>';
      if (!boardLoading) {
        boardLoading = true;
        void import('./ui/board').then(module => { board = new module.Board(); render(); }).catch(() => {
          boardLoading = false; warning = '盤面を読み込めませんでした。ページを再読み込みしてください。';
          const slot = document.getElementById('board-slot');
          if (slot) slot.innerHTML = '<div class="board-loading"><span>読み込めませんでした。再読み込みしてください。</span></div>';
        });
      }
    }
  }
  if (body && hadModal && sameRewardStep) {
    const newDetails = app.querySelector<HTMLDetailsElement>('.contribution-details');
    if (newDetails && reportDetailsOpen) newDetails.open = true;
    const equipment = app.querySelector<HTMLDetailsElement>('.equipment-editor');
    if (equipment && equipmentOpen !== undefined) equipment.open = equipmentOpen;
    const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) dialog.scrollTop = modalScroll;
  }
  if (keepHistoryDialog && focus && keepHistoryDialog.contains(focus)) focus.focus({ preventScroll: true });
  else if (body && !modal && (rewardFocus || replacementFocus)) app.querySelector<HTMLElement>(pendingReward ? replacementFocus ? `[data-replace="${replacementFocus}"]` : '[data-replace]' : `[data-reward="${rewardFocus}"]`)?.focus({ preventScroll: true });
  else if (focusedData && focusedValue) app.querySelector<HTMLElement>(`[data-${focusedData}="${focusedValue}"]`)?.focus({ preventScroll: true });
  else if (body && hadModal && !sameRewardStep) {
    const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
    (modal === 'history' ? dialog?.querySelector<HTMLElement>('button') : dialog)?.focus({ preventScroll: true });
  }
  else if (body && !hadModal) {
    const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
    (dialog?.querySelector<HTMLElement>('button') ?? dialog)?.focus({ preventScroll: true });
  }
  else if (!body && cellFocus !== undefined) app.querySelector<HTMLElement>(`[data-cell="${cellFocus}"]`)?.focus({ preventScroll: true });
  else if (actionFocus && actionFocus !== 'cast') {
    const action = actionFocus === 'chain-close' ? 'chain-guide' : actionFocus;
    const target = app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else if (guideOpen) app.querySelector<HTMLElement>('.chain-navigation button:not([disabled])')?.focus({ preventScroll: true });
  }
}
async function begin(): Promise<void> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  save = startRun(save, chosen, seed);
  guideOpen = false; guideIndex = 0;
  pendingReward = null; rewardReturn = null; modal = null; view = 'battle'; selected = null; prediction = null; skill = false; selectedSkill = chosen; reportBossOnly = false; feedback = '';
  tutorialHidden = save.meta.tutorialDone; await persistNow(); render(); window.scrollTo({ top: 0 });
}
function select(cell: number): void {
  const run = save.run;
  if (!run || run.phase !== 'battle' || run.cells[cell]) return;
  if (!legalOrigins(run, skill, currentSkill(run)).includes(cell)) { feedback = 'このマスはまだ未確定です。青緑の枠の数字を選ぶか、スキルを使いましょう。'; render(); return; }
  if (save.settings.sound) { audio.unlock(); audio.ui('select'); }
  selected = cell; prediction = previewAction(run, cell, skill, currentSkill(run)); guideIndex = 0; feedback = ''; render();
}
async function cast(): Promise<void> {
  if (view !== 'battle' || modal || busy || saving || saveBlocked || !board || save.run?.phase !== 'battle' || selected === null || !prediction) return;
  if (save.settings.sound) audio.unlock();
  const before = save.run;
  let effects: CombatEffects | null = null;
  skipAnimation = false;
  try {
    const next = dispatch(save, { type: 'play', cell: selected, skill, skillId: skill ? currentSkill(before) : undefined, revision: before.revision });
    save = next;
    if (save.run?.phase === 'reward') reportBossOnly = false;
    if (before.stage > 0 || (skill && before.stage === 0)) { save.meta.tutorialDone = true; tutorialHidden = true; }
    // Commit before animation: reload resumes the resolved action, never repeats a reward.
    busy = true; guideOpen = false; await persistNow(); render(before);
    const effectsSettings = { ...save.settings, reducedMotion: save.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches };
    effects = new CombatEffects(effectsSettings, audio); activeEffects = effects;
    const report = save.run!.lastReport!;
    if (save.settings.sound) audio.cast();
    await board!.animate(before, save.run!, report, effectsSettings, (n, complete) => audio.note(n, complete), event => effects!.fill(event), (segment, continues) => effects!.sheetComplete(segment, continues), () => skipAnimation);
    await effects.finish(before, save.run!, report);
    feedback = report.defeated ? '' : `${report.oneCastClear ? '✦ 一詠全成！ ' : ''}${report.fullClear ? `完成加算 ＋${fmt(report.clearBonus ?? 0)}。` : ''}${report.path.length}連鎖、${fmt(report.damage)}ダメージ、得点 ＋${fmt(report.attackScore)}。${report.relicHealed ? `黄金のインクで反撃前にHPを${report.relicHealed}回復。` : ''}${report.received ? `反撃でHP −${report.received}。` : '反撃を防ぎました。'}${report.healed > (report.relicHealed ?? 0) ? `成長でHPを${report.healed - (report.relicHealed ?? 0)}回復。` : ''}${report.sheetAdvanced ? `${report.sheetsCompleted ?? 1}シート完成！ 現在はシート${save.run!.encounterSheet}。術式 Lv.${save.run!.spellLevel}、自動＋${chainBonus(save.run!.spellLevel)}回、攻撃 ×${spellMultiplier(save.run!.spellLevel).toFixed(1)}。` : stopText(report)}`;
  } catch (error) { feedback = error instanceof Error ? error.message : '詠唱を完了できませんでした。'; }
  finally { effects?.destroy(); activeEffects = null; busy = false; selected = null; prediction = null; skill = false; render(); }
}
async function setSound(enabled: boolean): Promise<void> {
  save.settings.sound = enabled;
  audio.setEnabled(enabled);
  if (enabled) { audio.unlock(); audio.ui('confirm'); }
  await persistNow();
  if (warning) render();
  const button = app.querySelector<HTMLButtonElement>('[data-action="sound"]');
  if (button) { button.textContent = enabled ? '♪' : '♫̸'; button.setAttribute('aria-label', enabled ? '消音する' : '音をオンにする'); }
}
function startReplacement(id: RewardId): void {
  const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
  rewardReturn = dialog ? { scroll: dialog.scrollTop, reportOpen: !!dialog.querySelector<HTMLDetailsElement>('.contribution-details')?.open, equipmentOpen: !!dialog.querySelector<HTMLDetailsElement>('.equipment-editor')?.open, breakdownOpen: !!dialog.querySelector<HTMLDetailsElement>('.reward-breakdown')?.open } : null;
  pendingReward = id;
  if (save.settings.sound) audio.ui('select');
  render();
}
function returnToRewards(): void {
  const previous = pendingReward, returning = rewardReturn;
  pendingReward = null; rewardReturn = null; render();
  const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
  if (returning && dialog) {
    for (const [selector, open] of [['.contribution-details', returning.reportOpen], ['.equipment-editor', returning.equipmentOpen], ['.reward-breakdown', returning.breakdownOpen]] as const) {
      const details = dialog.querySelector<HTMLDetailsElement>(selector);
      if (details) details.open = open;
    }
    dialog.scrollTop = returning.scroll;
  }
  if (previous) dialog?.querySelector<HTMLElement>(`[data-reward="${previous}"]`)?.focus({ preventScroll: true });
}
async function takeReward(relic: RewardId, replace?: RelicId): Promise<void> {
  if (!save.run || save.run.phase !== 'reward' || saving || saveBlocked) return;
  save = dispatch(save, { type: 'reward', relic, replace, revision: save.run.revision });
  if (save.settings.sound) audio.ui('reward');
  pendingReward = null; rewardReturn = null; guideOpen = false; guideIndex = 0; selected = null; prediction = null; skill = false; feedback = '';
  currentSkill(save.run!); await persistNow(); render(); window.scrollTo({ top: 0 });
}
app.addEventListener('click', async event => {
  if (saving) return;
  if ((event.target as HTMLElement).classList.contains('modal-backdrop') && (modal === 'quick-help' || modalTriggerAction === 'quick-help' || modal === 'history')) { closeModal(); return; }
  const element = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (!element || element.hasAttribute('disabled')) return;
  // Muting stays available during the committed animation; keep its DOM intact.
  if (element.dataset.action === 'sound' && !saveBlocked) { void setSound(!save.settings.sound); return; }
  if (element.dataset.action === 'skip-animation' && busy) { skipAnimation = true; activeEffects?.skip(); element.setAttribute('disabled', ''); return; }
  if (busy) return;
  if (saveBlocked && element.dataset.historyPage === undefined && element.dataset.historyCastsPage === undefined && !['history', 'history-export', 'close', 'home', 'result-home'].includes(element.dataset.action ?? '')) return;
  if (save.settings.sound) audio.unlock();
  if (element.dataset.cell !== undefined) { if (!guideOpen) return select(Number(element.dataset.cell)); return; }
  if (element.dataset.character) { if (save.settings.sound) audio.ui('select'); chosen = element.dataset.character as CharacterId; render(); return; }
  if (element.dataset.historyPage !== undefined) { historyView.page = Number(element.dataset.historyPage); renderHistoryPage(); return; }
  if (element.dataset.historyCastsPage !== undefined) {
    const details = element.closest<HTMLDetailsElement>('[data-history-battle]');
    const battle = selectedHistoryRun(save.history, historyView)?.battles.find(item => item.stage === Number(details?.dataset.historyBattle));
    const content = details?.querySelector<HTMLElement>('.history-battle-content');
    if (battle && content) {
      content.innerHTML = historyBattleDetails(battle, Number(element.dataset.historyCastsPage));
      content.querySelector<HTMLElement>('.history-cast>summary')?.focus();
    }
    return;
  }
  if (element.dataset.reportWindow) { reportBossOnly = element.dataset.reportWindow === 'boss'; render(); return; }
  if (element.dataset.equipSkill && save.run?.phase === 'reward') {
    const id = element.dataset.equipSkill as SkillId, equipped = save.run.equippedSkills ?? [];
    save = dispatch(save, { type: 'equip', skills: equipped.includes(id) ? equipped.filter(value => value !== id) : [...equipped, id], revision: save.run.revision });
    currentSkill(save.run!); await persistNow(); render(); return;
  }
  if (element.dataset.selectSkill && save.run?.phase === 'battle') {
    const id = element.dataset.selectSkill as SkillId;
    if (!usableSkills(save.run).includes(id)) return;
    selectedSkill = id; skill = canUseSkill(save.run); guideOpen = false; guideIndex = 0; selected = null; prediction = null;
    feedback = skill ? `${skillOf(id).name}を選択。起点を選ぶと予告できます。` : `${skillOf(id).name}を選択。魔力8か無料券で使えます。`;
    render(); return;
  }
  if (element.dataset.replace && pendingReward && save.run?.phase === 'reward') {
    await takeReward(pendingReward, element.dataset.replace as RelicId); return;
  }
  if (element.dataset.reward && save.run?.phase === 'reward') {
    const id = element.dataset.reward as RewardId;
    if (needsRelicReplacement(save.run, id)) startReplacement(id);
    else await takeReward(id);
    return;
  }
  if (element.dataset.action && element.dataset.action !== 'cast' && save.settings.sound) {
    audio.ui(['new', 'restart', 'resume', 'skill'].includes(element.dataset.action) ? 'confirm' : 'select');
  }
  switch (element.dataset.action) {
    case 'new': if (activeRun()) { modalTriggerAction = 'new'; modal = 'restart'; render(); } else await begin(); break;
    case 'restart': await begin(); break;
    case 'resume': pendingReward = null; rewardReturn = null; guideOpen = false; view = 'battle'; selected = null; prediction = null; skill = false; render(); break;
    case 'home': case 'result-home': pendingReward = null; rewardReturn = null; guideOpen = false; view = 'home'; modal = null; selected = null; prediction = null; skill = false; render(); break;
    case 'quick-help': case 'help': case 'settings': case 'codex': modalTriggerAction = element.dataset.action; modal = element.dataset.action; render(); break;
    case 'help-details': modal = 'help'; render(); app.querySelector<HTMLElement>('[role="dialog"]')?.scrollTo({ top: 0 }); app.querySelector<HTMLElement>('.modal-close')?.focus({ preventScroll: true }); break;
    case 'history': case 'history-reward': case 'history-report': case 'history-result': openHistory(element.dataset.action); break;
    case 'history-export': if (save.history) downloadPlayHistory(save.history); break;
    case 'close': closeModal(); break;
    case 'reward-back': returnToRewards(); break;
    case 'tutorial-close': tutorialHidden = true; save.meta.tutorialDone = true; await persistNow(); render(); break;
    case 'skill':
      if (save.run && canUseSkill(save.run)) { guideOpen = false; guideIndex = 0; skill = !skill; prediction = null; selected = null; feedback = skill ? '任意の空きマスを選んで、スキルの起点にできます。' : ''; render(); }
      break;
    case 'chain-close':
    case 'chain-guide':
      if (!prediction?.chain) break;
      guideOpen = !guideOpen; guideIndex = 0; render();
      if (guideOpen && matchMedia('(max-width: 760px)').matches) document.getElementById('board-slot')?.scrollIntoView({ block: 'start' });
      break;
    case 'chain-next':
      if (guideOpen && prediction) { guideIndex = Math.min(prediction.path.length, guideIndex + 1); render(); }
      break;
    case 'chain-prev':
      if (guideOpen) { guideIndex = Math.max(0, guideIndex - 1); render(); }
      break;
    case 'cast': void cast(); break;
  }
});
app.addEventListener('change', async event => {
  if (saving) return;
  const element = event.target as HTMLInputElement;
  if (element.hasAttribute('data-history-run')) { historyView = { runKey: element.value, page: 0 }; renderHistoryPage(); return; }
  if (saveBlocked) return;
  if (!element.dataset.setting) return;
  if (element.dataset.setting === 'sound') setSound(element.checked);
  else {
    save.settings[element.dataset.setting as keyof typeof save.settings] = element.checked;
    document.documentElement.classList.toggle('large-text', !!save.settings.largeText);
    if (save.settings.sound) { audio.unlock(); audio.ui('select'); }
    await persistNow();
    if (warning) render();
  }
  document.documentElement.classList.toggle('reduced-motion', save.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
});
app.addEventListener('toggle', event => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.open || modal !== 'history') return;
  const content = details.querySelector<HTMLElement>(':scope > [data-history-content]');
  if (!content || content.dataset.loaded) return;
  const run = selectedHistoryRun(save.history, historyView);
  const battleDetails = details.closest<HTMLDetailsElement>('[data-history-battle]');
  const battle = run?.battles.find(item => item.stage === Number(battleDetails?.dataset.historyBattle));
  if (!battle) return;
  if (details.dataset.historyCast !== undefined) {
    const cast = battle.casts.find(item => item.id === Number(details.dataset.historyCast));
    if (cast) content.innerHTML = historyCastDetails(cast);
  } else if (details.dataset.historyBattle !== undefined) content.innerHTML = historyBattleDetails(battle);
  content.dataset.loaded = 'true';
}, true);
document.addEventListener('keydown', event => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) {
    if (event.key === 'Escape' && pendingReward && !modal) { event.preventDefault(); if (!saving) returnToRewards(); return; }
    if (event.key === 'Escape' && modal) { event.preventDefault(); closeModal(); return; }
    if (event.key === 'Tab') {
      const stops = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
      if (!stops.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === stops[0] || document.activeElement === dialog)) { event.preventDefault(); stops.at(-1)!.focus(); }
      else if (!event.shiftKey && document.activeElement === stops.at(-1)) { event.preventDefault(); stops[0].focus(); }
    }
    return;
  }
  const target = event.target as HTMLElement;
  if (event.key.toLowerCase() === 'c' && !event.defaultPrevented && !event.repeat && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
    !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]') &&
    view === 'battle' && save.run?.phase === 'battle' && !busy && !saving && !saveBlocked && board && selected !== null && prediction) {
    event.preventDefault();
    void cast();
    return;
  }
  if (target.dataset.cell !== undefined && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const step = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[event.key]!;
    const next = (Number(target.dataset.cell) + step + 81) % 81;
    app.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
  }
});
render();

matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { if (!busy) render(); });
matchMedia('(min-width: 761px)').addEventListener('change', () => { if (!busy && view === 'battle') render(); });
window.addEventListener('pagehide', event => { if (event.persisted) audio.setEnabled(false); else audio.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) audio.setEnabled(save.settings.sound); });
