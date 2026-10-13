# Audio asset notices

All 12 bundled sample effects are CC0-1.0 assets. Attribution is optional under CC0; this record preserves provenance for source and static-site distribution. License/source verification date: 2026-10-13.

| Source pack | Author | Source license evidence |
|---|---|---|
| [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | [Original pack notice](public/audio-licenses/Kenney-Interface.txt) |
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | [Original pack notice](public/audio-licenses/Kenney-Impact.txt) |
| [Magic Spell SFX](https://opengameart.org/content/magic-spell-sfx) | JaggedStone | Original upload explicitly lists CC0 and “None needed” attribution. |

[CC0 1.0 legal code](public/audio-licenses/CC0-1.0.txt), retrieved from https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt.

## Selected files and preparation

| Bundled sample | Original file | Duration |
|---|---|---|
| ui-select.mp3 | Kenney: interface/Audio/click_001.ogg | 0.097 s |
| ui-confirm.mp3 | Kenney: interface/Audio/confirmation_002.ogg | 0.420 s |
| ui-reward.mp3 | Kenney: interface/Audio/confirmation_004.ogg | 0.490 s |
| hit-light.mp3 | Kenney: impact/Audio/impactPunch_medium_001.ogg | 0.350 s |
| hit-heavy.mp3 | Kenney: impact/Audio/impactPunch_heavy_002.ogg | 0.450 s |
| shield.mp3 | Kenney: impact/Audio/impactMetal_light_002.ogg | 0.230 s |
| spell-line.mp3 | JaggedStone: magical_1.ogg | 0.480 s |
| spell-box.mp3 | JaggedStone: magical_2.ogg | 0.580 s |
| spell-cross.mp3 | JaggedStone: magical_3.ogg | 0.680 s |
| sheet-clear.mp3 | JaggedStone: magical_4.ogg | 0.780 s |
| growth.mp3 | JaggedStone: magical_6.ogg | 0.650 s |
| cast.mp3 | JaggedStone: magical_7.ogg | 0.320 s |

Preparation: beginning excerpts, mono 44.1 kHz, 3 ms fade-in and up to 45 ms fade-out, RMS normalization limited by a -4 dB sample peak, MP3 96 kbps. No other samples were mixed into these files.

[SOURCES.json](src/assets/audio/SOURCES.json) records per-file source/download URLs, original and prepared SHA-256 hashes, exact durations and gain. [prepare-audio.mjs](scripts/prepare-audio.mjs) reproduces processing from the original downloads in `.runtime/cc0-audio` using FFmpeg. Prepared MP3 files are checked in; FFmpeg and network access are not required to build or play.

`public/audio-licenses/` is copied unchanged into the static build. The settings screen links to its credits file. Only the selected audio and notices ship, not the full downloaded packs. Original synthesis remains in the game for pitched chains and immediate fallback if a sample is unavailable.
