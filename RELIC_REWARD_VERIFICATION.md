# Relic reward weighting verification

Verified 2026-10-14. This report covers reward sampling only. It does not measure player selections, campaign win rate, pacing, or enjoyment.

## Rules under test

- Evolution remains boss-only, uses the existing tier eligibility, and advances one tier at a time. Upper → apex still requires Lv.5; Lv.10 cannot receive another level-up; tier 3 cannot evolve again.
- When both an owned level-up and its evolution qualify, evolution gets weight 2 at Lv.1–2, 3 at Lv.3–4, 4 at Lv.5–7, and 5 at Lv.8–9, against level-up weight 1. At Lv.10, only the eligible evolution remains.
- Boss owned-slot selection weights evolution ×2 and character affinity ×1.35. Boss flexible slots weight evolution ×2. Ordinary flexible slots weight owned growth ×1.35 versus new acquisition ×1.
- The missing-relic and owned-upgrade guarantees remain. Missing-slot affinity is unchanged. Wick from battle 3 and eligible greater Wick on bosses keep their existing precedence, even over the new weights.
- A relic contributes only one candidate. Missing acquisition and an evolution of the same relic never consume two choices.

## Reproduction

```sh
npm test -- --run tests/relic-reward-weights.test.ts tests/growth-rewards.test.ts tests/cross-sheet-rewards.test.ts
node scripts/reward-sampling-report.mjs 10000 620a7aea4ec67aa4cd1ce42cfe262f374b8b5a82
```

The public baseline is `620a7aea4ec67aa4cd1ce42cfe262f374b8b5a82`. The original run below used local `65d9bb7`, whose entire source tree is identical (`f34f33095d842138f4613386666b0ee6d565e13b`); use the public SHA to reproduce in a fresh clone.

Environment: Node v24.19.0; Vitest v5.0.4. The report script loads `src/game/rewards.ts` from baseline commit `65d9bb7ac206de04ebb37f66d5501c4cc9eb6f49` beside the current sampler, using the same current content/eligibility dependencies. It does not modify checked-in files. Full machine-readable results are generated at `.runtime/reward-sampling/report.json`.

Each row samples 10,000 identical input states with the same dispersed deterministic seeds for both implementations: `Math.imul(index + 1, 0x9e3779b1) >>> 0`, index 0–9,999. It records actual displayed three-choice menus. A second sampling stage means the per-relic conditional variant probability is **not** generally the probability that a menu contains an evolution.

All fixtures start from `startRun` with run seed 73 and `meta.clears = 99`, so the fixed pool is all 16 relics in content order:

`wick, echo, rekindle, pen, ward, stroke, battery, amplifier, afterglow, lens, glass, trinity, duality, quint, sept, gold`.

The script sets reward phase and relic step, and gives every owned relic acquisition rank 1 and the row's level. Tiers are 1 except where noted. Stage indexes are zero-based.

## Conditional variant probabilities

The single-owned fixture is Fuse at boss stage 4 with only `pen` owned. Its owned slot is guaranteed, so this special fixture also makes its measured menu appearance rate equal to its sampled variant rate.

| Relic level | Conditional evolution probability, before → after | Measured menu appearance, before → after |
| --- | --- | --- |
| 1–2 | 50% → 2/3 (66.67%) | 50.04% → 66.71% |
| 3–4 | 50% → 3/4 (75%) | 50.04% → 75.03% |
| 5–7 | 50% → 4/5 (80%) | 50.04% → 80.03% |
| 8–9 | 50% → 5/6 (83.33%) | 50.04% → 83.35% |
| 10 | Eligible evolution only, both versions | 100% → 100% |

Every level 1–10 was sampled separately. Rates are nondecreasing through the bands; these weights improve low-level access relative to the former 50/50 roll. They do not make low levels more likely to evolve than high levels.

## Actual boss three-choice appearance

Half-owned fixture: `echo, rekindle, pen, ward, battery, glass, trinity, sept` owned, all tier 1, at boss stage 4. Wick is missing and retains its guaranteed acquisition slot. Each cell below is the observed range across Fuse, Scribe, and Lumen, 10,000 menus per character and level.

| Owned relic level | Menus containing an evolution, baseline | Menus containing an evolution, new |
| --- | --- | --- |
| 1 | 61.15–62.20% | 88.75–89.05% |
| 3 | 61.15–62.20% | 92.80–93.14% |
| 5 | 61.15–62.20% | 94.64–94.87% |
| 8 | 61.15–62.20% | 95.78–95.98% |
| 10 | 100% | 100% |

All these menus included at least one new relic (100%). For Fuse, mean evolution choices per menu changed from 0.7328 to 1.2691 at Lv.1 and to 1.4748 at Lv.8. Thus the new acquisition slot survives even while bosses show evolutions more often.

Additional cohorts, also sampled for all three characters at Lv.1/3/5/8/10:

- All 16 relics owned, Wick already tier 2, boss stage 9. Fuse's evolution-menu rate at Lv.1 changed 84.31% → 98.56%; mean evolution choices changed 1.3615 → 2.2578. Lv.10 gives three eligible evolutions in both versions. Wick's own apex is still absent below Lv.5.
- Wick plus the eight half-owned relics, all tier 1, boss stage 4. The greater-Wick guarantee keeps evolution-menu rate at 100% in both versions. Fuse's Lv.1 mean evolution choices changed 1.2903 → 1.5393. A probability already guaranteed is not reported as an improvement in appearance rate.

## Actual ordinary growth appearance

The same half-owned inventory at Lv.3 and ordinary stage 5 has one new relic and one owned upgrade guaranteed. The measured percentage below is the probability of a second owned choice in the flexible slot.

| Character | Two-owned menus, baseline → new | Mean owned choices, baseline → new |
| --- | --- | --- |
| Fuse | 46.17% → 56.67% | 1.4617 → 1.5667 |
| Scribe | 43.37% → 57.27% | 1.4337 → 1.5727 |
| Lumen | 49.91% → 56.46% | 1.4991 → 1.5646 |

New relic appeared in 100% of menus; evolution appeared in 0%. Baseline percentages differ by character because its guaranteed affinity choice is taken from the shuffled order. The new 1.35 weight applies to each remaining owned candidate, not to an independent 57% category coin in arbitrary inventories.

## Regression checks and scope

- 19 new tests passed: exact variant thresholds, all Lv.1–10 progression, tier/boss eligibility, ordinary weighting, boss non-affinity evolution selection, all three characters' eligibility/duplicate guarantees, exhaustion, deterministic caller-only RNG, and fixed-seed legacy/initial replay.
- Existing `growth-rewards.test.ts` and `cross-sheet-rewards.test.ts`: 55 tests passed. These include greater-Wick guarantees, both boss reward steps, pre-change pending choices surviving reload and skill selection, legacy migration, and exact wick-only RNG consumption.
- The report separately compared 15,000 no-owned offer arrays **and** final RNG states (three characters × stages 0/1/2/4/9 × 1,000 seeds). All were unchanged. It compared 1,500 legacy rolls and final RNG states at the same characters/stages; all were unchanged.
- Fully exhausted Lv.10/tier-3 inventories retain the ordinary `training/vitality/recovery` fallback and boss `training/magic-boon/defense-boon` fallback. Capped growth candidates are removed before weighting.
- Sampling does not mutate the supplied run, saved choices, or pending choices. It uses only the caller's `Random`; no global or combat/proc RNG is touched. Mixed weighted slots may consume additional caller-stream draws, so newly rolled rewards and subsequent board/reward stream positions can differ from the baseline. This does not promise identical RNG states for changed owned-relic sampling.
- The combined unit/build/browser results, including standard starting guidance, are in [RELIC_GUIDANCE_VERIFICATION.md](RELIC_GUIDANCE_VERIFICATION.md).
