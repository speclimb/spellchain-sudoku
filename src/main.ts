import './style.css';
import { CHARACTERS, RELICS, ENEMIES, characterOf, relicOf } from './game/content';
import { dispatch, incomingAttack, newSave, previewAction, startRun } from './game/engine';
import { loadSave, persist } from './game/storage';
import { candidates } from './game/sudoku';
import type { CharacterId, RelicId, Report, Run } from './game/types';
import type { Board } from './ui/board';
import { IncantationAudio } from './ui/audio';
import { capacityText, explainStep, stopText } from './ui/chain-guide';

const app = document.querySelector<HTMLDivElement>('#app')!;
const loaded = loadSave();
let save = loaded.save, warning = loaded.warning;
let view: 'home' | 'battle' = 'home';
let chosen: CharacterId = save.run?.character ?? 'fuse';
let selected: number | null = null, prediction: Report | null = null, skill = false, busy = false;
let modal: 'help' | 'settings' | 'codex' | 'restart' | null = null;
let tutorialHidden = save.meta.tutorialDone;
let feedback = '';
let guideOpen = false, guideIndex = 0;
let board: Board | null = null;
let boardLoading = false;
const demoRun = startRun(newSave(), 'fuse', 21).run!;
const demoRoot = demoRun.cells.findIndex((n, i) => !n && candidates(demoRun.cells, i).length === 1);
const demoPath = previewAction(demoRun, demoRoot).path;
const audio = new IncantationAudio();
const fmt = (n: number) => n.toLocaleString('ja-JP');
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const activeRun = () => save.run && (save.run.phase === 'battle' || save.run.phase === 'reward');
const persistNow = () => { warning = persist(save); };

function emblem(kind = 'ember'): string {
  const shapes: Record<string, string> = {
    ember: '<path d="M80 30 C105 63 113 82 97 106 C86 123 55 121 46 101 C34 78 57 66 58 47 C65 60 71 65 74 74 C84 57 75 45 80 30Z"/><path d="M77 78 C95 94 91 110 78 112 C61 110 60 96 77 78Z" class="solid"/>',
    wing: '<path d="M77 77 Q44 28 21 50 L37 100 L64 90 L80 121 L96 90 L123 100 L139 50 Q116 28 83 77Z"/><path d="M56 52 L65 83 M104 52 L95 83 M70 98 L90 98"/>',
    guardian: '<path d="M80 24 L120 47 L113 101 L80 132 L47 101 L40 47Z"/><path d="M80 45 L100 78 L80 111 L60 78Z M57 65 H103 M55 91 H105"/>',
    eye: '<path d="M20 80 Q80 14 140 80 Q80 146 20 80Z"/><circle cx="80" cy="80" r="26"/><path d="M80 58 L91 80 L80 102 L69 80Z" class="solid"/><path d="M80 24 V12 M80 148 V136"/>',
    star: '<path d="M80 17 L95 60 L140 55 L110 88 L128 132 L83 113 L46 140 L50 97 L17 71 L62 62Z"/><circle cx="80" cy="83" r="18"/><path d="M77 55 L89 88 L64 100"/>',
    dragon: '<path d="M80 122 L47 96 L36 42 L64 56 L80 23 L96 56 L124 42 L113 96Z"/><path d="M38 70 L13 49 L26 104 L59 114 M122 70 L147 49 L134 104 L101 114 M62 77 L74 85 M98 77 L86 85 M70 103 L80 110 L90 103"/><path d="M80 47 L86 65 L80 77 L74 65Z" class="solid"/>',
  };
  return `<svg class="enemy-emblem" viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="73" class="orbit"/><circle cx="80" cy="80" r="62" class="orbit faint"/>${shapes[kind] ?? shapes.ember}<path d="M80 3 V9 M80 151 V157 M3 80 H9 M151 80 H157" class="orbit"/></svg>`;
}
function header(): string {
  return `<header class="site-header"><button class="brand" data-action="home" aria-label="タイトルへ"><span class="brand-seal">✧</span><span>連鎖詠唱<span class="brand-sub">ナンプレ / NUMERAL GRIMOIRE</span></span></button><nav aria-label="メニュー"><button class="nav-button" data-action="codex">遺物図鑑</button><button class="icon-button" data-action="help" aria-label="遊び方">?</button><button class="icon-button sound-button" data-action="sound" aria-label="${save.settings.sound ? '消音する' : '音をオンにする'}">${save.settings.sound ? '♪' : '♫̸'}</button><button class="icon-button" data-action="settings" aria-label="設定">⚙</button></nav></header>`;
}
function home(): string {
  const previewDigits = demoRun.cells.map((n, i) => n || demoPath.find(e => e.cell === i)?.value || 0).join('');
  return `<section class="home-hero"><div class="hero-copy"><p class="eyebrow"><span></span> A SMALL PUZZLE. AN EXTRAORDINARY SPELL.</p><h1>一手が、<br><em>魔法になる。</em></h1><p class="hero-description">ひとつの数字から、連鎖する詠唱。<br>遺物を集めて、あなただけの魔法を紡ぐ。<br>約10分の、ナンプレ・ローグライト。</p><div class="hero-actions">${activeRun() ? '<button class="primary" data-action="resume">冒険の続きへ <span>↗</span></button><button class="text-button" data-action="new">新たな冒険をはじめる</button>' : '<button class="primary" data-action="new">冒険をはじめる <span>↗</span></button><span class="quiet">時間制限なし · 数字の知識は不要</span>'}</div><div class="home-record"><div><span>BEST SCORE</span><strong>${fmt(save.meta.bestScore)}</strong></div><div><span>魔法陣の踏破</span><strong>${save.meta.clears}<small> 枚</small></strong></div><div><span>冒険のクリア</span><strong>${save.meta.wins}<small> 回</small></strong></div></div></div><div class="hero-art" aria-hidden="true"><div class="astral-ring ring-one"></div><div class="astral-ring ring-two"></div><div class="hero-star star-one">✧</div><div class="hero-star star-two">✦</div><div class="hero-star star-three">⋆</div><div class="decorative-board">${[...previewDigits].map((n, i) => `<span class="${demoPath.some(e => e.cell === i) ? 'lit' : ''}">${n !== '0' ? n : demoPath.some(e => e.cell === i) ? demoRun.solution[i] : ''}</span>`).join('')}</div><div class="art-caption"><span class="gold">✦</span> 小さな正解が、大きな力に。</div></div></section><section class="character-section"><div class="section-label"><span>01 / 術師を選ぶ</span><span class="quiet">冒険ごとに、違う詠唱を。</span></div><div class="character-grid">${CHARACTERS.map(c => { const locked = save.meta.clears < c.unlock; return `<button class="character-card ${chosen === c.id ? 'chosen' : ''} ${locked ? 'locked' : ''}" data-character="${c.id}" ${locked ? 'disabled' : ''} aria-pressed="${chosen === c.id}"><span class="character-symbol">${locked ? '⌑' : c.symbol}</span><span class="character-info"><span class="micro">${c.title}</span><strong>${c.name}</strong><span>${locked ? `累計${c.unlock}戦クリアで解放（${save.meta.clears}/${c.unlock}）` : c.passive}</span></span><span class="card-check">${chosen === c.id ? '✓' : locked ? '' : '↗'}</span></button>`; }).join('')}</div><div class="chosen-skill"><span>固有スキル / ${characterOf(chosen).skillName}</span>${characterOf(chosen).skill}</div></section><footer class="site-footer"><span>六つの魔法陣、その先へ。</span><span>進行はこのブラウザに自動保存されます</span></footer>`;
}
function tutorial(run: Run): string {
  if (tutorialHidden || run.stage > 0) return '';
  const text = run.mana >= 8 ? '魔力がたまりました。「固有スキル」を選ぶと、未確定のマスからも詠唱できます。' : run.turn > 0 ? '◇は反撃を軽減する盾、✧は追加ダメージの弱点。起点を変えて、攻撃と守りを比べてみましょう。' : selected !== null ? '金色の線が連鎖の予告です。「連鎖のしくみ」で、なぜそこへつながるかを1マスずつ確認できます。' : '青緑の数字は、入る数字が1つに決まったマス。1つ選ぶと、そこから同じ行・列・区画へ連鎖を予告します。';
  return `<aside class="tutorial"><span>✧</span><p>${text}</p><button data-action="tutorial-close" aria-label="ガイドを閉じる">×</button></aside>`;
}
function chainGuide(report: Report): string {
  if (!guideOpen || !report.chain || busy) return '';
  const step = explainStep(report, guideIndex);
  const end = guideIndex >= report.path.length;
  return `<section id="chain-guide" class="chain-guide" aria-label="連鎖のしくみ"><div class="guide-heading"><span>水色の枠＝直前 → 金の枠＝次</span><button class="text-button" data-action="chain-close">全体の予告へ ×</button></div><div class="guide-explanation" aria-live="polite" aria-atomic="true"><h3 id="chain-step-title">${esc(step.title)}</h3><p id="chain-step-detail">${esc(step.detail)}</p><p id="chain-budget">${esc(step.budget)}</p><p class="chain-note">${esc(step.note)}</p></div><div class="chain-navigation"><button data-action="chain-prev" ${guideIndex === 0 ? 'disabled' : ''} aria-label="連鎖の前の段階">← 前へ</button><span class="chain-position">${end ? '連鎖終了' : `${guideIndex + 1} / ${report.path.length}`}</span><button data-action="chain-next" ${end ? 'disabled' : ''} aria-label="連鎖の次の段階">${guideIndex === report.path.length - 1 ? '終了の理由 →' : '次へ →'}</button></div><p class="guide-footnote">確認中は手数も魔力も使いません。起点を変えるときは「全体の予告へ」。</p></section>`;
}
function battle(run: Run): string {
  const enemy = ENEMIES[run.stage], character = characterOf(run.character);
  const attack = incomingAttack(run), p = prediction;
  const ready = run.mana === 8;
  const guideOnSide = matchMedia('(min-width: 761px)').matches;
  const guidance = p ? chainGuide(p) : '';
  return `<section class="adventure-heading"><div class="chapter-track" aria-label="第${run.stage + 1}戦、全6戦">${ENEMIES.map((_, i) => `<span class="${i < run.stage ? 'passed' : i === run.stage ? 'current' : ''}">${i < run.stage ? '✓' : i === 5 ? '♛' : String(i + 1).padStart(2, '0')}</span>${i < 5 ? '<i></i>' : ''}`).join('')}</div><div class="run-score"><span>SCORE</span><strong>${fmt(run.score)}</strong></div></section><section class="game-layout"><div class="battlefield"><div class="enemy-card ${run.stage === 5 ? 'boss' : ''}"><div class="enemy-portrait">${emblem(enemy.symbol)}</div><div class="enemy-info"><div class="enemy-overline"><span>${run.stage === 5 ? 'FINAL CHAPTER' : `CHAPTER ${String(run.stage + 1).padStart(2, '0')}`}</span><span>${run.turn + 1}手目</span></div><h1>${enemy.name}</h1><div class="enemy-health"><div class="health-track"><i style="width:${run.enemyHp / enemy.hp * 100}%"></i>${p ? `<b style="width:${Math.min(run.enemyHp, p.damage) / enemy.hp * 100}%;left:${Math.max(0, run.enemyHp - p.damage) / enemy.hp * 100}%"></b>` : ''}</div><span>${run.enemyHp}<small> / ${enemy.hp}</small></span></div></div><div class="enemy-intent ${attack > enemy.attack ? 'danger' : ''}"><span>${attack > enemy.attack ? '強攻撃' : '次の反撃'}</span><strong>⚔ ${attack}</strong><small>${run.stage === 2 || run.stage === 5 ? '3手ごとに2倍' : '詠唱の後に攻撃'}</small></div></div>${tutorial(run)}<div id="board-slot"></div>${guideOnSide ? '' : guidance}<div class="board-legend"><span><i class="available-dot"></i>確定マス（選べます）</span><span class="weak-text">✧ 弱点 ＋${run.inventory.includes('lens') ? 20 : 8}</span><span class="shield-text">◇ 盾 −6</span></div><p class="battle-lore">${enemy.lore}</p></div><aside class="command-panel"><div class="player-heading"><span class="player-symbol">${character.symbol}</span><div><span class="micro">YOUR INCANTATION</span><h2>${character.name}</h2></div><button class="tiny-button" data-action="home">中断</button></div><div class="vitals"><div class="vital-health"><div><span>生命力</span><strong>${run.hp}<small> / ${run.maxHp}</small></strong></div><div class="health-track player"><i style="width:${run.hp / run.maxHp * 100}%"></i></div></div><div class="vital-mana"><div><span>魔力</span><strong>${run.mana}<small> / 8</small></strong></div><div class="mana-pips">${Array.from({ length: 8 }, (_, i) => `<i class="${i < run.mana ? 'full' : ''}"></i>`).join('')}</div></div></div>${guideOnSide ? guidance : ''}<div class="prediction-card ${p ? 'has-prediction' : ''}"><div class="section-label"><span>${skill ? '✦ スキルの予告' : '詠唱の予告'}</span><button class="guide-toggle" data-action="chain-guide" aria-expanded="${guideOpen}" aria-controls="chain-guide" ${!p || busy ? 'disabled' : ''}>${guideOpen ? '全体の予告へ' : '連鎖のしくみ →'}</button></div><div class="prediction-numbers"><div><strong id="prediction-chain">${p ? p.path.length : '—'}</strong><span>連鎖</span></div><div><strong id="prediction-damage">${p ? fmt(p.damage) : '—'}</strong><span>ダメージ</span></div><div class="${p?.received ? 'hurt' : 'safe'}"><strong>${p ? p.received ? `−${p.received}` : '0' : '—'}</strong><span>被ダメージ</span></div></div><p class="prediction-detail">${p ? `${p.units ? `完成 ${p.units}単位` : '完成ボーナスなし'}<span>·</span>${p.shield ? `盾 ${p.shield}` : '盾なし'}<span>·</span>${skill ? '魔力を全消費' : `魔力 ＋${p.charge}`}` : '数字を選ぶと、連鎖と攻撃を予告します。'}</p>${p ? `<p class="chain-stop">${p.defeated ? '✦ 撃破 · ' : ''}${esc(stopText(p))}</p>` : ''}</div><button class="skill-button ${skill ? 'active' : ''} ${ready ? 'ready' : ''}" data-action="skill" ${!ready || busy ? 'disabled' : ''} aria-pressed="${skill}"><span class="skill-icon">${character.symbol}</span><span><strong>${character.skillName}</strong><small>${skill ? 'スキル選択中 · 解除する' : ready ? '固有スキル · 魔力8で発動' : '固有スキル · 数字を埋めて充電'}</small></span><b>${skill ? '✓' : ready ? '↗' : `${run.mana}/8`}</b></button><p class="skill-description">${esc(capacityText(run, skill, p))}<br>${skill ? character.skill : '直前のマスと同じ行・列・3×3区画の確定マスへ。'}</p><button class="primary cast-button" data-action="cast" ${!p || busy ? 'disabled' : ''}>${busy ? '詠唱中…' : selected === null ? '起点を選んでください' : skill ? 'スキルを詠唱する' : `「${run.solution[selected]}」を詠唱する`}<span>${busy ? '⋯' : '↗'}</span></button><p class="feedback" role="status">${esc(feedback || (run.afterglow ? '残光の灯：次の通常入力は自動入力＋2' : '考えている間、敵は動きません。'))}</p><details class="inventory" ${run.inventory.length ? '' : 'open'}><summary>所持している遺物 <span>${run.inventory.length} / 5</span></summary><div>${run.inventory.length ? run.inventory.map(id => { const relic = relicOf(id); return `<div class="inventory-item"><span>${relic.symbol}</span><div><strong>${relic.name}</strong><p>${relic.description}</p></div></div>`; }).join('') : '<p class="quiet empty-inventory">戦闘に勝つと、3つの遺物から<br>ひとつを選べます。</p>'}</div></details>${run.lastReport ? `<details class="last-spell"><summary>前の詠唱</summary><p>${run.lastReport.path.length}連鎖 · ${run.lastReport.damage}ダメージ<br>完成 ${run.lastReport.units}単位 · 反撃 ${run.lastReport.received}<br>${run.lastReport.skill ? '固有スキルを使用' : `魔力 ＋${run.lastReport.charge}`}<br>${esc(stopText(run.lastReport))}</p></details>` : ''}</aside></section>`;
}
function reward(run: Run): string {
  const unlocked = [...CHARACTERS.filter(c => c.unlock > 0 && c.unlock === save.meta.clears).map(c => c.name), ...RELICS.filter(r => r.unlock > 0 && r.unlock === save.meta.clears).map(r => r.name)];
  return `<div class="modal-eyebrow">CHAPTER ${String(run.stage + 1).padStart(2, '0')} COMPLETE</div><h2>新たな力を、ひとつ。</h2><p class="modal-intro">魔法陣を踏破しました。次の詠唱を変える遺物を選びましょう。</p><div class="reward-summary"><span>✧ 撃破 ＋500</span><span>♡ 生命力 ＋${run.lastReport?.healed ?? 0}</span><span>${run.lastReport?.path.length ?? 0}連鎖</span></div><div class="reward-grid">${run.rewards.map(id => { const relic = relicOf(id); const affinity = characterOf(run.character).affinity.includes(id); return `<button class="reward-card ${affinity ? 'affinity' : ''}" data-reward="${id}"><span class="relic-kind">${relic.kind}${affinity ? ' / おすすめ' : ''}</span><span class="relic-symbol">${relic.symbol}</span><strong>${relic.name}</strong><p>${relic.description}</p><span class="take-relic">この遺物を選ぶ <b>↗</b></span></button>`; }).join('')}</div>${unlocked.length ? `<div class="unlock-notice">✧ ${unlocked.join('・')} を解放！ 次の冒険から使えます。</div>` : ''}<p class="quiet modal-footnote">次の相手：${ENEMIES[run.stage + 1].name} · 取得はこの冒険の間だけ有効です</p>`;
}
function result(run: Run): string {
  const won = run.phase === 'won';
  return `<div class="result-seal">${won ? '✧' : '☾'}</div><div class="modal-eyebrow">${won ? 'THE GRIMOIRE IS COMPLETE' : 'A SPELL TO REMEMBER'}</div><h2>${won ? 'あなたの詠唱が、夜を明かした。' : 'この詠唱は、次の一手へ。'}</h2><p class="modal-intro">${won ? '六つの魔法陣を踏破。集めた力が、ひとつの魔法になりました。' : `${run.stats.kills}つの魔法陣を踏破。手にした経験と解放した力は、次の冒険へ。`}</p><div class="result-score"><span>FINAL SCORE</span><strong>${fmt(run.score)}</strong><small>${run.score >= save.meta.bestScore ? '✦ 自己ベスト' : `BEST ${fmt(save.meta.bestScore)}`}</small></div><div class="result-stats"><div><strong>${run.stats.bestChain}</strong><span>最大連鎖</span></div><div><strong>${run.stats.moves}</strong><span>詠唱した手数</span></div><div><strong>${run.stats.filled}</strong><span>連鎖で埋めた数字</span></div></div><div class="result-relics">${run.inventory.map(id => `<span title="${relicOf(id).name}">${relicOf(id).symbol}</span>`).join('')}</div><button class="primary" data-action="result-home">次の冒険へ <span>↗</span></button><p class="quiet modal-footnote">戦績と解放した要素を保存しました。</p>`;
}
function modalBody(): string | null {
  if (modal === 'help') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">HOW TO PLAY</div><h2>数字をつなぎ、魔法を紡ぐ。</h2><ol class="help-steps"><li><strong>青緑の数字から、起点を選ぶ</strong><p>候補が1つのマスだけが光ります。どれも正解なので、数字を推測する必要はありません。</p></li><li><strong>予告を見比べて、詠唱する</strong><p>「連鎖のしくみ」で1マスずつ確認できます。直前に埋めたマスと同じ行・列・3×3区画にある確定マスへ進みます。最初から確定していたマスも対象です。縦の距離＋横の距離が近い順、同距離なら上の行・左の列を優先します。</p></li><li><strong>導火術師は起点1＋自動4で最大5連鎖</strong><p>基本の自動3回に、導火術師の常時効果で1回追加。スキルの手はさらに4回追加され最大9連鎖です。残り回数が0か、直前のマスからつながる確定マスがなくなると終了。1マス埋まるたびに候補を計算し直します。遺物で回数や飛び先が増えることもあります。</p></li><li><strong>完成・弱点・盾を狙う</strong><p>行・列・区画の完成で追加攻撃。✧は弱点、◇は盾です。敵が生き残ると、連鎖の後に反撃します。</p></li><li><strong>魔力が8たまったら固有スキル</strong><p>未確定の空きマスからも始動できます。スキルの手は充電されません。</p></li><li><strong>遺物を選び、六つの魔法陣を進む</strong><p>敵撃破で残りの盤面を一掃。通常戦の勝利時にHPを6回復し、3択から強化を選びます。一掃そのものは得点・充電の対象外です。</p></li></ol><p class="help-note">時間制限はありません。PCでは矢印キーでマスを移動し、Enterで選択できます。入力は「詠唱する」で確定します。</p>`;
  if (modal === 'settings') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">PREFERENCES</div><h2>詠唱のひとときを整える。</h2><div class="settings-list">${[{ key: 'sound', name: '連鎖の音', text: '数字に合わせて、音が重なります。' }, { key: 'fast', name: '演出を短く', text: '連鎖と盤面一掃の演出を短縮します。' }, { key: 'reducedMotion', name: '動きを抑える', text: '連鎖を即座に表示し、装飾の動きを抑えます。' }].map(s => `<label><span><strong>${s.name}</strong><small>${s.text}</small></span><input type="checkbox" data-setting="${s.key}" ${save.settings[s.key as keyof typeof save.settings] ? 'checked' : ''}></label>`).join('')}</div><p class="help-note">進行はこのブラウザに自動保存されます。別の端末とは共有されません。サイトデータを削除すると記録も消えます。</p>`;
  if (modal === 'codex') return `<button class="modal-close" data-action="close" aria-label="閉じる">×</button><div class="modal-eyebrow">THE RELIC ARCHIVE</div><h2>詠唱を変える、十二の遺物。</h2><p class="modal-intro">累計 ${save.meta.clears} 戦クリア · 解放した遺物は次の冒険から出現します。</p><div class="codex-grid">${RELICS.map(r => `<article class="codex-item ${r.unlock > save.meta.clears ? 'locked' : ''}"><span>${r.symbol}</span><div><small>${r.kind}</small><h3>${r.name}</h3><p>${r.description}</p>${r.unlock > save.meta.clears ? `<b>累計${r.unlock}戦クリアで解放</b>` : '<b class="unlocked">解放済み</b>'}</div></article>`).join('')}</div>`;
  if (modal === 'restart') return `<div class="modal-eyebrow">A NEW JOURNEY</div><h2>新しい冒険をはじめますか？</h2><p class="modal-intro">今の冒険の進行は置き換わります。これまでの戦績と解放した要素は残ります。</p><div class="dialog-actions"><button class="secondary" data-action="close">戻る</button><button class="primary" data-action="restart">新しい冒険をはじめる ↗</button></div>`;
  if (view === 'battle' && save.run?.phase === 'reward') return reward(save.run);
  if (view === 'battle' && save.run && ['won', 'lost'].includes(save.run.phase)) return result(save.run);
  return null;
}
function render(displayRun = save.run): void {
  const focus = document.activeElement as HTMLElement | null;
  const cellFocus = focus?.dataset.cell;
  const actionFocus = focus?.dataset.action;
  const hadModal = !!document.querySelector('[role="dialog"]');
  const body = busy ? null : modalBody();
  document.documentElement.classList.toggle('reduced-motion', save.settings.reducedMotion);
  app.innerHTML = `<div class="app-shell" ${body ? 'inert' : ''}>${header()}${warning ? `<div class="warning" role="alert">${esc(warning)}</div>` : ''}<main>${view === 'battle' && displayRun ? battle(displayRun) : home()}</main></div><div id="modal-layer">${body ? `<div class="modal-backdrop"><section class="modal ${modal === 'codex' ? 'wide' : ''} ${!modal && save.run?.phase === 'reward' ? 'reward-modal' : ''}" role="dialog" aria-modal="true" aria-label="${modal === 'codex' ? '遺物図鑑' : modal === 'settings' ? '設定' : modal === 'help' ? '遊び方' : modal === 'restart' ? '新しい冒険' : save.run?.phase === 'reward' ? '遺物の選択' : '冒険の結果'}" tabindex="-1">${body}</section></div>` : ''}</div><div class="sr-only" aria-live="polite">${busy ? '連鎖を詠唱しています' : prediction ? `${prediction.path.length}連鎖、${prediction.damage}ダメージ、被ダメージ${prediction.received}` : ''}</div>`;
  if (view === 'battle' && displayRun) {
    if (board) {
      board.mount(document.getElementById('board-slot')!);
      board.set(displayRun, prediction, selected, skill, busy || displayRun.phase !== 'battle', guideOpen && prediction && !busy ? guideIndex : null);
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
  if (body && !hadModal) document.querySelector<HTMLElement>('[role="dialog"] button, [role="dialog"]')?.focus({ preventScroll: true });
  else if (!body && cellFocus !== undefined) app.querySelector<HTMLElement>(`[data-cell="${cellFocus}"]`)?.focus({ preventScroll: true });
  else if (actionFocus && actionFocus !== 'cast') {
    const action = actionFocus === 'chain-close' ? 'chain-guide' : actionFocus;
    const target = app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else if (guideOpen) app.querySelector<HTMLElement>('.chain-navigation button:not([disabled])')?.focus({ preventScroll: true });
  }
}
function begin(): void {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  save = startRun(save, chosen, seed);
  guideOpen = false; guideIndex = 0;
  modal = null; view = 'battle'; selected = null; prediction = null; skill = false; feedback = '';
  tutorialHidden = save.meta.tutorialDone; persistNow(); render(); window.scrollTo({ top: 0 });
}
function select(cell: number): void {
  const run = save.run;
  if (!run || run.phase !== 'battle' || run.cells[cell]) return;
  if (!skill && candidates(run.cells, cell).length !== 1) { feedback = 'このマスはまだ未確定です。青緑の枠の数字を選ぶか、固有スキルを使いましょう。'; render(); return; }
  selected = cell; prediction = previewAction(run, cell, skill); guideIndex = 0; feedback = ''; render();
}
async function cast(): Promise<void> {
  if (busy || !save.run || selected === null || !prediction) return;
  if (save.settings.sound) audio.unlock();
  const before = save.run;
  try {
    const next = dispatch(save, { type: 'play', cell: selected, skill, revision: before.revision });
    save = next;
    if (before.stage > 0 || (skill && before.stage === 0)) { save.meta.tutorialDone = true; tutorialHidden = true; }
    // Commit before animation: reload resumes the resolved action, never repeats a reward.
    persistNow(); busy = true; guideOpen = false; render(before);
    await board!.animate(before, save.run!, save.run!.lastReport!, save.settings, (n, complete) => audio.note(n, complete));
    feedback = save.run!.lastReport!.defeated ? '' : `${save.run!.lastReport!.path.length}連鎖、${save.run!.lastReport!.damage}ダメージ。${stopText(save.run!.lastReport!)}。${save.run!.lastReport!.received ? `反撃でHP −${save.run!.lastReport!.received}` : '反撃を防ぎました。'}`;
  } catch (error) { feedback = error instanceof Error ? error.message : '詠唱を完了できませんでした。'; }
  finally { busy = false; selected = null; prediction = null; skill = false; render(); }
}
app.addEventListener('click', event => {
  if (busy) return;
  const element = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (!element || element.hasAttribute('disabled')) return;
  if (element.dataset.cell !== undefined) { if (!guideOpen) return select(Number(element.dataset.cell)); return; }
  if (element.dataset.character) { chosen = element.dataset.character as CharacterId; render(); return; }
  if (element.dataset.reward && save.run) {
    save = dispatch(save, { type: 'reward', relic: element.dataset.reward as RelicId, revision: save.run.revision });
    guideOpen = false; guideIndex = 0; selected = null; prediction = null; skill = false; feedback = ''; persistNow(); render(); window.scrollTo({ top: 0 }); return;
  }
  switch (element.dataset.action) {
    case 'new': if (activeRun()) { modal = 'restart'; render(); } else begin(); break;
    case 'restart': begin(); break;
    case 'resume': guideOpen = false; view = 'battle'; selected = null; prediction = null; skill = false; render(); break;
    case 'home': case 'result-home': guideOpen = false; view = 'home'; modal = null; selected = null; prediction = null; skill = false; render(); break;
    case 'help': case 'settings': case 'codex': modal = element.dataset.action; render(); break;
    case 'close': modal = null; render(); break;
    case 'sound': save.settings.sound = !save.settings.sound; if (save.settings.sound) { audio.unlock(); audio.note(1); } persistNow(); render(); break;
    case 'tutorial-close': tutorialHidden = true; save.meta.tutorialDone = true; persistNow(); render(); break;
    case 'skill':
      if (save.run?.mana === 8) { guideOpen = false; guideIndex = 0; skill = !skill; prediction = null; selected = null; feedback = skill ? '任意の空きマスを選んで、固有スキルの起点にできます。' : ''; render(); }
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
app.addEventListener('change', event => {
  const element = event.target as HTMLInputElement;
  if (!element.dataset.setting) return;
  save.settings[element.dataset.setting as keyof typeof save.settings] = element.checked;
  if (save.settings.sound) audio.unlock(); persistNow();
  document.documentElement.classList.toggle('reduced-motion', save.settings.reducedMotion);
});
app.addEventListener('keydown', event => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) {
    if (event.key === 'Escape' && modal) { modal = null; render(); return; }
    if (event.key === 'Tab') {
      const stops = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')];
      if (!stops.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === stops[0] || document.activeElement === dialog)) { event.preventDefault(); stops.at(-1)!.focus(); }
      else if (!event.shiftKey && document.activeElement === stops.at(-1)) { event.preventDefault(); stops[0].focus(); }
    }
    return;
  }
  const target = event.target as HTMLElement;
  if (target.dataset.cell !== undefined && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const step = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[event.key]!;
    const next = (Number(target.dataset.cell) + step + 81) % 81;
    app.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
  }
});
render();

matchMedia('(min-width: 761px)').addEventListener('change', () => { if (!busy && view === 'battle') render(); });
