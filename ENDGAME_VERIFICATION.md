# Endgame regression and balance evidence

Generated 2026-10-13. Reproduce with `npm test` and `node scripts/endgame-balance.mjs 6`.

Final source-freeze validation: **122 tests passed across five files** in 154.27 seconds. `npx tsc --noEmit` and `git diff --check` passed. This includes 33 dedicated endgame regression cases plus progression, historical-save and chain-trace checks.

## Scope and limitations

Controlled paired engine simulation, not human playtesting or organically attained runs. Identical synthetic post-boss checkpoints branch into the three actual offered rewards, then play five enemies or stop at death. All upper relics and rank-3 primes are equipped. Mana/tokens/overflow start empty. HP starts at 75% of level-derived maximum. Later ordinary rewards prefer training. The policy maximizes guaranteed damage minus twelve times received damage, prioritizes guaranteed kills, and never peeks at procs.

- These controlled loadouts isolate marginal reward value, not the probability of reaching them.
- Engine timings exclude UI/render/animation and are hardware-dependent.
- A deterministic greedy policy is not human play or an optimal solver.
- Different cast counts change subsequent prime outcomes, so paired outcomes include the real strategic consequences of each reward.

No survival or enjoyment claim is inferred from this small sample. All 108 controlled arms survived the five-encounter window; the harder cohort provides meaningful damage and resource differences, not evidence that a boon is required to survive.

## Full-run progression and termination

The ordinary informed-player regression starts new Fuse runs with the starter unlock pool, uses actual deterministic reward offers, and now spends free-skill tokens as well as full mana. Six seeds all ended in genuine counterattack losses; no run approached the test-only 2,000-move diagnostic guard. There is no runtime encounter or chain cap.

| Seed | Kills | Moves | Final level | Best chain | Final incoming attack | Final shield |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 88 | 141 | 383 | 365 | 827 | 99 |
| 2 | 150 | 232 | 866 | 685 | 2563 | 99 |
| 3 | 160 | 234 | 886 | 503 | 2933 | 96 |
| 4 | 100 | 155 | 460 | 358 | 1088 | 99 |
| 5 | 106 | 167 | 522 | 395 | 1232 | 90 |
| 6 | 110 | 168 | 524 | 322 | 1333 | 90 |

Growth is dramatic but did not make these runs immortal. Capacity is not a guarantee of a long cast: real peer-chain dead ends still stop it. For example, seed 3 ended at encounter 161 with level 886 and a 503-cell best chain, but its final cast filled only 70 cells against 5,991,300 HP; the enemy survived and retaliated. Seed 2 had previously achieved 685 cells yet its final cast filled only 71 cells.

Recommendation: keep the approved mechanics for this implementation. These measurements support finite progression with a much longer endgame, but they do not establish whether 88–160 kills feels appropriately paced for human players. Validate pacing through human play before tuning numerical growth. The former 60-second test timeout was exceeded by deeper simulation work, not an endless loop; the regression retains actual-loss and move-budget assertions.

### Prime-free baseline

A second controlled-policy organic regression removes all four prime charms from the frozen run pool. It retains actual ordinary/boss offers and skills. All 12 seeds ended in real retaliation losses in 106–185 moves, confirming long-chain growth does not depend on prime activation.

| Character | Seed | Kills | Moves | Final level | Best chain |
|---|---:|---:|---:|---:|---:|
| fuse | 21 | 112 | 185 | 562 | 431 |
| fuse | 22 | 79 | 131 | 330 | 280 |
| fuse | 23 | 92 | 146 | 415 | 391 |
| fuse | 24 | 85 | 138 | 389 | 369 |
| scribe | 21 | 90 | 148 | 347 | 311 |
| scribe | 22 | 94 | 147 | 393 | 375 |
| scribe | 23 | 83 | 147 | 307 | 269 |
| scribe | 24 | 57 | 106 | 175 | 167 |
| lumen | 21 | 54 | 108 | 167 | 157 |
| lumen | 22 | 77 | 128 | 291 | 275 |
| lumen | 23 | 83 | 143 | 303 | 268 |
| lumen | 24 | 81 | 131 | 307 | 272 |

## Controlled five-encounter choice comparison

Six seeds per character, per choice, per cohort. Cells show mean cast count / total HP lost / ending HP. The trial begins with 0 mana, 0 tokens, 0 overflow, all upper relics, rank-three primes, skill rank two and 75% of level-derived maximum HP. Post-boss-35 uses level 65; post-boss-45 uses level 85. Four subsequent ordinary rewards use the same training-first policy.

| Checkpoint | Character | Choice | Casts | HP lost | Ending HP | Skill casts | Maximum chain |
|---|---|---|---:|---:|---:|---:|---:|
| after-boss-35 | fuse | training | 5.50 | 9.67 | 368.50 | 3.83 | 110 |
| after-boss-35 | fuse | magic-boon | 5.00 | 0.00 | 366.67 | 5.00 | 109 |
| after-boss-35 | fuse | defense-boon | 5.50 | 7.33 | 365.17 | 3.83 | 109 |
| after-boss-35 | scribe | training | 5.33 | 3.83 | 364.67 | 3.83 | 105 |
| after-boss-35 | scribe | magic-boon | 5.00 | 0.00 | 360.00 | 5.00 | 104 |
| after-boss-35 | scribe | defense-boon | 5.33 | 2.83 | 360.67 | 3.83 | 104 |
| after-boss-35 | lumen | training | 5.33 | 3.83 | 364.67 | 3.83 | 105 |
| after-boss-35 | lumen | magic-boon | 5.00 | 0.00 | 360.00 | 5.00 | 104 |
| after-boss-35 | lumen | defense-boon | 5.33 | 2.83 | 360.67 | 3.83 | 104 |
| after-boss-45 | fuse | training | 6.33 | 101.83 | 405.67 | 4.00 | 134 |
| after-boss-45 | fuse | magic-boon | 6.17 | 90.83 | 400.00 | 5.17 | 133 |
| after-boss-45 | fuse | defense-boon | 6.50 | 87.33 | 414.33 | 4.17 | 133 |
| after-boss-45 | scribe | training | 5.67 | 57.33 | 409.67 | 3.67 | 125 |
| after-boss-45 | scribe | magic-boon | 5.33 | 32.17 | 419.50 | 5.00 | 124 |
| after-boss-45 | scribe | defense-boon | 5.67 | 44.17 | 415.83 | 3.67 | 124 |
| after-boss-45 | lumen | training | 5.50 | 36.00 | 431.00 | 3.67 | 125 |
| after-boss-45 | lumen | magic-boon | 5.17 | 10.83 | 440.83 | 5.00 | 124 |
| after-boss-45 | lumen | defense-boon | 5.50 | 28.17 | 431.83 | 3.67 | 124 |

Observations:

- Magic boon pays off through real skill availability. After boss 35, every character averaged exactly five casts for five kills and took no damage with magic boon; training and defense averaged 5.33–5.50 casts.
- At the tougher post-boss-45 checkpoint, defense beat training on ending HP for all three characters despite the training arm receiving permanent growth and immediate healing. It lowered average HP loss from 101.83 to 87.33 for Fuse, 57.33 to 44.17 for Scribe, and 36.00 to 28.17 for Lumen.
- Magic produced the fewest casts and HP loss for Scribe and Lumen in the tougher cohort. Fuse had a real trade-off: magic was faster, while defense finished healthier.
- Training supplies permanent level, capacity and max-HP growth beyond this five-enemy window. This experiment does not value that entire long-term benefit.

## Lens performance

Runtime: v24.19.0. 25 cold samples per character/mode, with 100 warm reads per cold sample. Measured inside the Node/Vite production-engine loader, excluding UI/render/animation. Timings vary with hardware and concurrent activity.

| Character | Mode | Cold median ms | Cold p95 ms | Warm median ms | Warm p95 ms | Maximum ties |
|---|---|---:|---:|---:|---:|---:|
| fuse | normal | 5.526 | 11.176 | 0.0061 | 0.0070 | 4 |
| fuse | skill | 29.109 | 49.461 | 0.0060 | 0.0100 | 17 |
| scribe | normal | 6.489 | 11.436 | 0.0063 | 0.0087 | 4 |
| scribe | skill | 18.757 | 35.401 | 0.0065 | 0.0092 | 14 |
| lumen | normal | 5.773 | 12.194 | 0.0059 | 0.0078 | 4 |
| lumen | skill | 16.366 | 32.631 | 0.0060 | 0.0090 | 14 |

### Extreme late-run stress

Five additional seeds per character/mode at level 850, all upper relics and skill rank two. Cold recalculation can become perceptible when an exceptionally long Fuse skill path is available. The longest sampled path was 539 cells: its first full-origin scan took 246 ms, while subsequent cached reads stayed about 0.006–0.010 ms. This is a cold-path performance caveat, not a universal sub-50-ms claim. Warm cache behavior protects repeated selection/render operations.

| Character | Mode | Cold median ms | Cold maximum ms | Warm median ms | Longest path |
|---|---|---:|---:|---:|---:|
| fuse | normal | 17.814 | 49.950 | 0.0097 | 286 |
| fuse | skill | 57.314 | 246.419 | 0.0096 | 539 |
| scribe | normal | 4.723 | 31.358 | 0.0060 | 286 |
| scribe | skill | 19.282 | 85.995 | 0.0061 | 286 |
| lumen | normal | 5.289 | 32.567 | 0.0057 | 286 |
| lumen | skill | 17.490 | 75.702 | 0.0060 | 286 |

## Seeded prime frequency check

12,000 distinct seeds per effect at cast index 23. Each effect uses an independent deterministic domain. Unit tests require each observed rate within 1.5 percentage points of its configured chance and check one draw per effect per cast, including multiple digits and multiple sheets.

| Effect | Rank 1 (30%) | Rank 2 (45%) | Rank 3 (60%) |
|---|---:|---:|---:|
| duality | 30.38% | 45.12% | 60.15% |
| trinity | 30.74% | 44.87% | 59.72% |
| quint | 30.38% | 44.98% | 60.20% |
| sept | 29.58% | 45.00% | 59.72% |

## Regression coverage

- Exact zero-fuel boundary and one-auto new-sheet entry; independently computed longest-entry choice with upper-left tie resolution.
- Cross-sheet casts beyond 36, 72 and 108 fills; continuous ordinal damage; base contribution capped at 80 without capping the chain.
- Snapshot multiplier and budget; once-per-cast Echo, Rekindle and hop; per-sheet clear-bonus arithmetic; maximum shield across segments rather than shield summation.
- Exactly one current-enemy settlement, counterattack, score award and reward; retained overkill; no growth/healing after lethal retaliation.
- All four digit gates and acquisition ranks; independent upper tiers; capped post-shield reduction; additive clear bonus outside Trinity amplification.
- Token-first payment, preserved mana/overflow, token-only skill availability, no Quint while holding/spending tokens, one-use Sept reservation with replacement rather than stacking.
- Read-only preview state and cloned board RNG; deterministic execution path; honest damage/retaliation bounds; all Lens maximum ties, cache hits, invalidation and defensive copies.
- Every boss offers an outstanding Lens/Wick upgrade; capped prime duplicates; exact all-upper fallback offers; boon duration, refresh and expiry.

Raw per-encounter measurements are reproducibly written to `.runtime/endgame-balance.json`; they are intentionally not committed as a large generated fixture.

## Final implementation checks

The frozen final source passed:

- `npm test -- --reporter=dot`: 122 tests across five files, 154.27 seconds.
- TypeScript checking and production Vite build: pass. Existing Phaser chunk-size warning remains.
- Full Chromium browser suite: 41 tests, 2.2 minutes. A separate focused mobile/endgame run passed all 10 tests, including the 844px cast-button boundary.
- Production repository-path smoke: `/spellchain-sudoku/` works; all 12 MP3 assets returned HTTP 200 and decoded to non-silent WebAudio buffers; seven samples started; one gameplay action persisted; all four license/credit resources returned HTTP 200.
- Final source and build checksums remained unchanged during browser/production verification.
- Read-only independent review found no blocking issue after checking 7,500 current reducer actions and 3,957 historical reducer-generated saves across six revisions.

Screenshot review covered dense 36-cell root reselection without relics, all tied upper-Lens roots, a later-sheet guide, reduced-motion completion, free-token/reservation/boon displays, and the final boss boon choices. Legal origins retain a thin teal outline and hollow circle even within the gold chain; selection and upper-Lens maxima have separate non-color markers. The compact mobile control layout preserves board and touch-target sizes.

Browser tests used the installed Chromium on the cloud computer with an ignored local Playwright configuration. No browser/security settings changed. The normal project configuration and published site remain untouched. This deliverable is a local implementation and review package; no push, pull request, merge, or deployment was performed.
