# Standard guidance and lens update verification

Verified 2026-10-14 against local source based on `65d9bb7` (same source tree as published history commit `620a7aea`). No deployment is part of this change.

## Changes

- Enemy current/max HP use the existing Japanese-locale comma formatter. Health labels can wrap rather than overlap enemy intent at narrow widths.
- Longest-origin stars are available from the first turn without owning the lens. Both the board and summary use the existing cached `longestOrigins` function, which calls the same `planCast` as committed casting. All equally longest legal origins are shown, including equipped skills and cross-sheet chains. Busy/inspection views suppress interactive root guidance as before.
- Lens ordinary weak damage remains `20 + 4 × (Lv − 1)`. Upper adds 12 and apex adds 24 relative to ordinary. Its effect description no longer promises an exclusive star display. Pre-expansion upper lenses also use the new 32 weak damage.
- Preview, contribution accounting and history consume the shared lens effect values. Historical recorded damage/text are not recalculated. Save schema and already sampled reward IDs are unchanged.
- Mobile spacing around the guidance/legend is reduced without shrinking cells or controls, preserving the initial cast button in a 390×844 viewport.

## Automated evidence

- `npm test -- --maxWorkers=1`: 269 tests passed across 14 files. Includes all existing legacy/pending/history tests and 22 added tests covering weighted rewards, relic-free standard guidance, tier damage at every level, and preview/committed/history accounting.
- `npm run build`: TypeScript and Vite production build passed. Existing Phaser chunk-size advisory remains.
- `git diff --check`: passed.
- Final browser regression: 68/68 passed in 3.3 minutes using dot's cloud Chromium. Covers 320/390/1440px HP and root display, initial 390×844 cast visibility, all previous history/reward interruption/reload flows, and keyboard/selection behavior. Screenshots were visually checked at 320px and 390px. This is not a physical mobile-device test.
- At 4× CPU throttling on cloud Chromium, uncached first-turn longest search measured 20.4 ms for normal input and 35.4 ms for skill input; mean of 100 cached reads was 0.020/0.009 ms. Both left the run byte-for-byte unchanged. These are one-fixture timings and evidence of cache effectiveness, not a device-wide latency guarantee.
- Reward distribution method, exact fixtures, seeded rates and RNG compatibility limitations are in [RELIC_REWARD_VERIFICATION.md](RELIC_REWARD_VERIFICATION.md).

## Organic progression smoke

Original local command (a fresh clone can use the identical-tree public baseline `620a7aea4ec67aa4cd1ce42cfe262f374b8b5a82` instead of `65d9bb7`):

```sh
CHARACTERS=fuse,scribe,lumen SEEDS=102 POLICIES=early MODES=production STAGE_LIMIT=30 BASELINE_REF=65d9bb7 BASELINE_ROOT=.runtime/relic-baseline OUTPUT=.runtime/relic-organic-smoke.json node scripts/cross-sheet-balance.mjs
```

Every run starts at level 1, uses only actually offered rewards, and chooses actions by guaranteed preview outcomes. The limit is explicitly 30 victories, not an asserted complete endurance run. All three reached that limit alive and their final saves passed validation:

| Character | Victories | Casts | Best chain | Cross-sheet casts |
|---|---:|---:|---:|---:|
| Fuse | 30 | 64 | 105 | 31 |
| Scribe | 30 | 70 | 90 | 32 |
| Lumen | 30 | 70 | 86 | 30 |

This is a progression/compatibility smoke test, not proof of final difficulty, human play time, enjoyment, or optimal play. The separate fixed-state sampling experiment measures reward appearance rather than campaign balance.
