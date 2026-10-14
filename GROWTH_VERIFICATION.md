# Growth, loadout, enemy and contribution expansion

Validated locally on 2026-10-14 on branch `feat/combat-growth-expansion`, based on `dca3187502d9ad6e645cadefb0cd6c25669efcb6`. This document describes the implemented rules and local evidence. No push, pull request or deployment was performed; the published site is unchanged.

## Validation status

**Final local validation passed after the last source change.** The final precision correction displays high-level chances/reduction percentages without rounding 75.5% to 76%. All execution counts below are completed results, not progress estimates.

| Check | Reproduction | Final result |
|---|---|---|
| All unit/rule tests | `npm test -- --reporter=dot` | 191 tests / 9 files passed; 187.69 s |
| Type check and production build | `npm run build` | Passed; Vite build 4.80 s |
| Complete browser suite | `npm run test:browser` with system Chromium override | 47 passed; 2.6 min |
| Production repository-path/assets/audio | `node scripts/smoke-audio-pages.mjs` with system Chromium override | Passed; asset/audio/gameplay/license checks |
| Organic growth/skill cohorts | `node scripts/growth-balance.mjs 2` | 18/18 completed, 3,264 casts, all genuine losses |
| Whitespace and patch check | `git diff --check` | Passed |

The normal browser configuration uses Edge on Windows and Playwright Chromium elsewhere. Any environment-specific executable/configuration used for a run should be recorded with its final result. Browser screenshots are written under `.runtime/screenshots/`.

[`ENDGAME_VERIFICATION.md`](ENDGAME_VERIFICATION.md) remains an unchanged historical report for the previous rules. Its test counts, enemy progression samples, reward comparisons and timing claims are not verification of this expansion.

## 1. Player choices and growth

There are still three characters. Each run retains its own intrinsic skill, learns from three new additional skills, and equips at most two of those additional skills. Owning a skill and equipping it are separate. Removing it from a slot preserves its level; the intrinsic skill never consumes a slot. Newly learned additional skills auto-equip only when there is a free slot. Equipment changes are accepted only during reward selection, save immediately, consume no reward and do not advance the encounter.

Every cast uses either no skill or exactly one available skill. An additional skill does not also activate the intrinsic skill. The character's passive remains active. All skills share the same eight-mana cost and free-coupon supply. A coupon is spent before mana, even when mana is full, preserving mana and battery overflow. A paid skill restores existing overflow after spending mana. Neither kind of skill cast recharges itself.

Spell level is distinct from skill and relic levels. Completed sheets and defeated enemies continue to grow spell level after a surviving cast. Skill/relic levels are bounded at 10. Skill evolution milestones are Lv.5 and Lv.10; relic tier is an independent bounded state of normal/upper/apex (1/2/3).

### Exact skill values

The following sequences are in Lv.1 through Lv.10 order and are read from `src/game/growth.ts`.

| Skill | Effect | Values by level |
|---|---|---|
| 星火連環 / `fuse` | Additional automatic inputs | 4, 4, 5, 6, 7, 8, 9, 10, 11, 12 |
| 星火連環 / `fuse` | Same-digit hops after a dead end | 0, 1, 1, 1, 2, 2, 2, 2, 2, 3 |
| 大紋章の詠唱 / `scribe` | Unit-completion multiplier | 3, 4, 4.25, 4.5, 5, 5.2, 5.4, 5.6, 5.8, 6.2 |
| 月光解放 / `lumen` | Normal attack multiplier | 2, 2.5, 2.65, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.75 |
| 連星渡り / `bridge` | Additional automatic inputs | 0, 1, 2, 3, 3, 4, 5, 6, 7, 8 |
| 連星渡り / `bridge` | Global confirmed-cell reconnects | 1, 1, 1, 1, 2, 2, 2, 2, 2, 3 |
| 貫星弾 / `pierce` | Extra attack per filled weakness | 24, 28, 32, 36, 40, 43, 46, 49, 52, 55 |
| 貫星弾 / `pierce` | One bonus at three or more weaknesses | 0, 0, 0, 0, 60, 68, 76, 84, 92, 100 |
| 護星砲 / `bastion` | Extra attack per maximum guard point | 1.5, 1.75, 2, 2.2, 2.5, 2.7, 2.9, 3.1, 3.3, 3.6 |
| 護星砲 / `bastion` | Temporary guard | 0, 0, 0, 0, 6, 7, 8, 9, 10, 14 |

Bridge checks for an ordinary peer connection first. Only when none exists may it reconnect to the nearest confirmed empty cell anywhere on the current sheet, using Manhattan distance and then row/column tie-breaking. It spends one remaining automatic input; it neither fills an unconfirmed cell nor creates free fuel. Fuse's same-digit hops also spend one automatic input. Hop/reconnect limits apply to the whole cast, including sheet transitions.

Pierce uses actual weakness fills across the cast. Its threshold bonus occurs at most once. Bastion uses the maximum sheet guard encountered, plus its temporary guard, without summing guards across sheets. Its temporary guard affects both this cast's attack and retaliation, then disappears. Both skills' extra attacks are multiplied only by the cast-start spell multiplier and rounded down. They do not receive normal-damage relic multipliers, Trinity or sheet-clear bonuses.

### Relic levels and tiers

There are 16 relics. Let `n = level − 1`, `t = tier − 1`, and `d[n] = [0, .05, .1, .14, .18, .21, .24, .265, .29, .31]`. Each effect is calculated once from the current level and tier. Upgrading replaces an old value rather than stacking its old and new multipliers.

| Relic | Current growth rule |
|---|---|
| 長い導火線 / Wick | Automatic inputs `2+n`, plus 2 at apex; sheet carry at upper or apex |
| 共鳴石 / Echo | At most 1/2/3 free same-root-digit inputs at Lv.1/5/10; extra raw damage per Echo input `2n+6t` |
| 再燃の輪 / Rekindle | `3+n+2t` fuel at the cast's first completed unit, once per cast |
| 刻印のペン / Pen | `20+5n+10t` completion damage per unit |
| 守護の紋章 / Ward | `3+n+2t` persistent sheet guard per completed unit |
| 一筆の杖 / Stroke | First `[3,5,7][t]+floor(n/3)` inputs at multiplier `2+d[n]` |
| 蓄電石 / Battery | Normal-cast charge `2+n+t`; overflow capacity `min(6,2+floor(n/3)+t)` |
| 魔力増幅器 / Amplifier | Skill-cast normal attack multiplier `1.5+d[n]+.2t` |
| 残光の灯 / Afterglow | Reserve `2+n+2t` automatic inputs for the next normal cast; refresh, never stack |
| 弱点のレンズ / Lens | Weakness extra damage `20+4n`, plus 12 at apex; all longest-origin markers at upper/apex |
| 硝子の杖 / Glass | Normal attack multiplier `1.25+.5d[n]+.1t`; maximum HP −8 only on first acquisition |
| 黄金のインク / Gold | Attack-derived score multiplier `1.5+d[n]+.25t`; damage and fixed kill score unchanged |

The four primes use separately persisted acquisition rank, level and tier. The first three acquisitions retain exactly 30/45/60% and their established normal/upper effect values. Migration does not infer rank from tier or reroll outcomes. Further relic-level growth is available after acquisition rank reaches three.

For primes, the chance bonus for Lv.1–10 is `0, 0, 0, .06, .10, .13, .155, .175, .19, .20`, added to the acquisition-rank base and capped at .8. Therefore a naturally acquired rank-three prime at Lv.3–10 has chances 60, 66, 70, 73, 75.5, 77.5, 79 and 80%. Tier does not change these odds. Define `g = d[max(0,n−2)]` for effect growth:

| Prime | Current effect |
|---|---|
| 二 / Duality | Post-guard retaliation reduction `min(.6,[.25,.5,.6][t]+.25g)`; together with the defense boon, capped at 60% |
| 三 / Trinity | Normal attack multiplier `[1.5,2,2.4][t]+g`; excludes sheet-clear bonus and additive skill attacks |
| 五 / Quint | Grant and hold at most 1/2/3 coupons by tier; never rolls while holding or spending coupons |
| 七 / Sept | Reserve `[7,14,21][t]+max(0,n−2)` automatic inputs for the next cast; one reservation, no stacking |

Each prime rolls at most once per cast, independently, only after its digit was actually filled. More copies of a digit or more sheets do not add rolls. Rolls retain the saved seed/cast-index/effect-domain scheme and do not consume the board/reward random stream. Predictions do not perform rolls.

## 2. Rewards and interruption safety

Ordinary victories offer three relic/growth choices. Each boss victory at encounters 5, 10, 15, etc. now grants two separate choices:

1. Choose one skill acquisition/upgrade from three offers.
2. Choose one relic acquisition/level/tier upgrade from three offers.

While eligible categories remain, skill offers guarantee one unowned skill and one owned skill upgrade. Relic offers guarantee one unowned relic and one owned upgrade. A run can learn its own intrinsic skill plus Bridge, Pierce and Bastion, never another character's intrinsic skill. One relic contributes at most one candidate variant to an offer; its level and tier alternatives cannot occupy two slots together. Character affinity biases the guaranteed relic category choice but does not force selection.

Upper upgrades are available at bosses. All owned relics can eventually reach upper and apex; apex requires upper tier and Lv.5. A tier reward does not also raise level. New and owned guarantees apply only when their respective categories have eligible candidates.

Both boss pools are sampled when the boss dies. The second pool is saved as pending data before the first selection. Choosing the skill persists the result, exposes the same saved relic pool and keeps the encounter unchanged. Choosing the relic advances to the next enemy. Equipment changes and reloads do not reroll either pool. Revision checks reject replayed actions.

Insufficient choices are filled with training, vitality or recovery. Fully capped skills produce those three basic repeatables. When no relic growth candidates remain at a boss, the relic step offers training, magic boon and defense boon. The old condition of merely owning seven upper relics no longer exhausts new-run growth. Each boon lasts five encounters, refreshes instead of stacking and decrements only on the transition to the next battle, not twice for the two boss choices.

## 3. Eight enemies, readable exact intents

`src/game/enemies.ts` versions enemy rules separately from HP/attack balance. The existing opening four and alternating fifth-encounter bosses stay recognizable. The ordinary encounter cycle adds Frost Fang and Mirror Carapace; the new forms first appear in encounters six and seven. All eight forms have distinct local silhouette/attack artwork and named attacks.

| Form | Attack | Rule |
|---|---|---|
| 迷い火の精 | 灯火の火球 | Steady retaliation |
| 書架の使い魔 | 羽刃の連撃 | Steady retaliation |
| 紋章の番人 | 紋章の石柱 | Double retaliation every third turn |
| 夜を読む眼 | 夜光の眼差し | Steady retaliation |
| 星喰いの影 | 星喰いの吸引 | Boss; double retaliation every third turn |
| 零の古竜 | 零の竜息 | Boss; double retaliation every third turn |
| 霜牙の狼 | 氷牙の突進 | Alternates zero-attack charge and double-attack strike, starting with charge |
| 鏡甲の甲虫 | 鏡片の斬撃 | Steady retaliation; final outgoing damage reduced by `floor(total/5)` unless at least one unit is completed |

Mirror armor applies once after normal damage, prime amplification, sheet-clear bonuses and additive skill attacks. Completing any row, column or box removes armor for that cast only. It does not permanently mutate the enemy or board. The same rounding is used for preview, proc outcomes, actual damage, score and contribution comparisons.

Intents use the same pure counter calculation as settlement, display the current and next action and explicitly describe the harmless Frost charge. Victory suppresses retaliation. Existing HP/attack progression, maximum-sheet guard semantics and lethal-counter-before-growth ordering remain in place.

## 4. Contribution accounting and interpretation

The ledger is updated only by committed casts. It retains at most the latest five encounters, including the current encounter; the boss reward UI can select that recent window or the just-completed boss alone. Both boss reward steps use the retained battle history. A headline shows up to three active examples, with all details behind an expandable section.

### Separate quantities

- Total output damage equals actual enemy HP removed plus overkill. Score is a separate quantity and includes the fixed 500 points on a kill.
- Skill totals are the outcomes of whole casts that selected that skill: uses, damage, average damage, HP removed and overkill. They include the character, relics and environment; they are not isolated marginal skill damage.
- Damage-producing relics show the difference after removing that one effect from the same actual path and retaining other effects. The calculation includes sheet bonuses, proc state and enemy armor where applicable, and includes overkill. Ward's contribution to a Bastion extra attack is included.
- These single-effect differences overlap. They must not be added into a total, turned into a 100% allocation or presented as an unbiased strength ranking. Damage prevention also uses single-effect removal and can overlap with other defenses.
- Fuel granted and fuel used are recorded separately. Automatic inputs consume grant buckets in first-in-first-out order, including ordinary/character/spell fuel before later relic buckets. Unused capacity is not a filled cell, and the whole path is not credited to a fuel relic.
- Echo's free direct fills are a separate metric from automatic-input fuel. Echo damage differences remove its damage bonus on the same path; they do not simulate a different path without its free fill.
- Sept records generation on the granting cast and FIFO use on the next cast. Afterglow records newly reserved fuel once; another skill while its reservation is already active does not claim another grant. A window may include use of resources granted before its start.
- Battery mana, prevented HP damage, coupon grants/uses and Gold's extra score retain their own units. They are not combined into one score.
- Held-cast count, opportunities and triggers accompany the figures. Fewer than ten casts/opportunities are labeled as a small sample. Unused skills and effects with no opportunities are explicitly distinguished from weak effects.

Preview, root selection, animation, reload and rejected replay must not add to these observations. Statistics are retained from actual reducer reports, not inferred from score or old save totals.

## 5. Save compatibility

The localStorage key and outer save version remain unchanged. Expanded state adds explicit skill levels/equipment, relic levels, enemy-rule version, reward step/pending rewards and the contribution window.

On loading a pre-expansion save:

- Keep the current board, solution, marks, HP, enemy HP, mana, overflow, coupon/reservation state and board/reward random state.
- Keep the current enemy's previous identity, attack pattern and HP balance until the next encounter transition. It does not turn into a new enemy mid-fight.
- Seed the intrinsic skill level from its old rank and leave extra slots empty. Existing Lv.1/2 intrinsic effects are unchanged.
- Map owned relic levels from their old acquisition ranks, preserve independent tiers, and exactly retain all prime rank-one/two/three probabilities and normal/upper effects.
- Keep already rolled rewards byte-for-byte as choices. A saved legacy boss offer remains one legacy choice, not a newly generated two-step reward. Existing rewards retain their original meaning; selecting an old prime acquisition upgrades acquisition rank without reinterpreting it as an additional level bonus.
- Start contribution recording at the saved cast counter, with an empty partial history. The UI says it covers post-resume observations. No missing historical damage, opportunities or uses are invented.

New reports and ledger arithmetic, owned/equipped skill validity, level/tier limits and pending reward shape are validated on load. Old reports may lack the new fields. At the next encounter transition, the expanded enemy rules take effect; future boss victories use the new reward flow.

## 6. Verification coverage

The following coverage is implemented in the test sources; execution results are recorded separately above:

- `tests/growth-rewards.test.ts`: level values, evolution, caps, equipment, independent prime rank/level/tier retention, all 16 relics, tier eligibility, first-acquisition Glass cost, guaranteed new/owned choices across seeded offers, no duplicate relic variants, exhausted pools, legacy reward descriptions and current-to-next descriptions.
- `tests/combat-growth.test.ts`: one selected skill, shared resource payment, equipped-only use, reward-only equipment changes, exact reconnect cost, additive weak/guard damage, temporary guard, both persisted boss steps, repeated-action rejection, HP/overkill/score reconciliation, overlapping single-effect differences, Ward/Bastion attribution, no duplicate Afterglow grants, exactly five recorded encounters, old-save migration and malformed growth data.
- `tests/enemies.test.ts`: all eight identities, preserved opening/boss slots and HP curve, exact current/next intentions, old rules, charge/strike timing, one-time armor rounding/break and self-contained unique artwork.
- `tests/contribution-ui.test.ts`: recent/current-boss windows, distinct units, no fuel-as-direct-fill claim, overlap/small-sample/no-opportunity wording, missing history, next-growth detail and armor/extra-attack breakdown.
- Existing engine, chain, progression, endgame and historical-save tests remain relevant for deterministic paths, no artificial chain cap, sheet accounting, one settlement per cast, prime behavior, fatal retaliation and migration.
- `tests/browser/growth-report.spec.ts`: interruption between boss steps, equipment retention, selected skill's preview, free-coupon priority, mobile report layout and boss window, and legacy one-step rewards. The complete browser suite also covers every enemy attack, existing gameplay, chain guide, completion effects, audio, save/resume and responsive controls.

### Organic balance protocol

`node scripts/growth-balance.mjs 2` creates 18 initial-state runs: three characters × three preferred additional skills × two seeds (102 and 103). The unlock pool is fully available, but inventory/skills are not pre-granted. It chooses from actual sampled rewards, prioritizing the cohort's desired skill, relevant growth and recovery at low HP. Action selection compares guaranteed damage/kill outcome, received damage and completion; it never reads hidden proc results.

The script records kills, casts, reward steps, per-skill uses, desired-skill uses, best chain, spell level, HP, final incoming/guard/received damage, total/HP/overkill damage and cross-sheet casts. It verifies damage reconciliation on every cast and reload-validates regular checkpoints and final losses. A 2,000-cast diagnostic guard throws rather than pretending a stalled run is a normal loss. Raw results accumulate in `.runtime/growth-balance.json`; confirm all expected samples exist before summarizing them.

All 18 cohorts completed through genuine lethal-counter losses, without diagnostic stops or reconciliation errors. A zero-use cohort does not demonstrate that the preferred skill is ineffective: the policy can choose the intrinsic skill instead and the raw artifact does not retain a separate acquired-at timestamp. This is a deterministic greedy simulation, not optimal play or human playtesting. Cohort preference is not a clean isolated causal comparison; reward choices, subsequent paths and cast-indexed procs can diverge. No claim about enjoyable pacing, comparative skill strength or human win rate follows from a small automated sample.

## Independent accounting and compatibility review

The independent review generated 216 real old-rule reports from the pinned pre-expansion engine, loaded them with the new reader, and compared 216 resumed casts before the encounter boundary. All agreed. Additional checks passed:

- 540 expanded combat/save round trips.
- 2,700 same-path single-effect removal comparisons, including overlapping multipliers and Bastion/Ward.
- 250 encounter transitions and 770 reward/equipment/reload snapshots.
- Two legacy boss-identity cases using the saved HP/balance version.
- No unresolved review failures. Artifacts: `growth-review-verify.mjs` and `growth-review-results.json` in the verification bundle. Re-running the independent script requires the pinned Git baseline and placement under the repository's `.runtime/` directory.

## Organic balance results

All 18 initial-state runs finished normally in loss: 50–384 defeated enemies, 143–478 casts, 3,264 casts in total. Seven runs crossed sheets within a cast; the longest actual chain was 681. Every cast satisfied output = actual HP damage + overkill. Checkpoint/final saves validated. The full simulation took 494 seconds on Node 24.19.0.

| Character | Preferred extra skill | Seed | Kills | Casts | Preferred skill uses | Best chain |
|---|---|---:|---:|---:|---:|---:|
| fuse | bridge | 102 | 59 | 173 | 19 | 36 |
| fuse | bridge | 103 | 384 | 478 | 32 | 681 |
| fuse | pierce | 102 | 50 | 155 | 38 | 36 |
| fuse | pierce | 103 | 97 | 182 | 36 | 347 |
| fuse | bastion | 102 | 52 | 149 | 43 | 36 |
| fuse | bastion | 103 | 138 | 233 | 34 | 504 |
| scribe | bridge | 102 | 70 | 143 | 0 | 36 |
| scribe | bridge | 103 | 98 | 173 | 1 | 286 |
| scribe | pierce | 102 | 75 | 149 | 0 | 66 |
| scribe | pierce | 103 | 82 | 160 | 0 | 36 |
| scribe | bastion | 102 | 83 | 178 | 0 | 36 |
| scribe | bastion | 103 | 82 | 147 | 0 | 243 |
| lumen | bridge | 102 | 72 | 156 | 1 | 36 |
| lumen | bridge | 103 | 81 | 165 | 1 | 36 |
| lumen | pierce | 102 | 98 | 161 | 0 | 295 |
| lumen | pierce | 103 | 79 | 164 | 0 | 36 |
| lumen | bastion | 102 | 63 | 143 | 6 | 36 |
| lumen | bastion | 103 | 69 | 155 | 0 | 36 |

The wide Fuse seed spread and often-unused Scribe/Lumen additional skills are explicit balancing caveats. These results support finite progression and safe long casts, not equal skill strength, typical player survival, human pacing, or enjoyment. No numeric balancing change was inferred from two seeds per cohort. Extra attacks avoid multiplier/proc loops, max levels and tier bounds are explicit, and the existing enemy curve eventually produces genuine lethal retaliation. Human playtesting remains appropriate before treating the chosen coefficients as final game balance.

## Delivery and residual limitations

- Browser environment: dot cloud desktop, Node 24.19.0, `/usr/bin/chromium`, headless Playwright with a local executable override, isolated Vite port 5185. Browser processes were started through the supported cloud Terminal. No security/network settings were changed.
- The production smoke uses the built `/spellchain-sudoku/` path: JavaScript, CSS, 12 MP3 HTTP responses, 12 non-silent WebAudio decodes, five sample starts, a persisted gameplay action and four credit/license HTTP responses.
- TypeScript and Vite complete successfully. Vite retains the known warning that the Phaser board chunk is larger than 500 kB (about 1.22 MB minified, 337 kB gzip); this is not a build failure.
- The two delivery screenshots show an organically reached tenth boss: 390×844 mobile report and 1440×1200 desktop skill choices. Both have been visually reviewed. The report's latest five battles contain 60,250 actual HP damage and 6,194 overkill, independently displayed from 68,944 score.
- Existing sampled legacy boss offers intentionally stay a single step. Current legacy enemy rules change only at the next enemy; historical contribution totals begin on resume and are marked partial.
- Tests use desktop/mobile viewport emulation rather than physical iOS/Android hardware. No live deployment or public CI run is claimed.
- Source snapshot, base-to-final patch, compiled `dist/`, SHA-256 manifest, test logs, review data, balance data and screenshots are included in the delivery ZIP. `.git/`, dependencies, old runtime files and credentials are excluded.
