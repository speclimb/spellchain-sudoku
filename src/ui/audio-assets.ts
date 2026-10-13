/** Bundled CC0 effects. Literal URLs let Vite include the files and honor its base path. */
export const AUDIO_ASSETS = {
  'ui-select': new URL('../assets/audio/ui-select.mp3', import.meta.url).href,
  'ui-confirm': new URL('../assets/audio/ui-confirm.mp3', import.meta.url).href,
  'ui-reward': new URL('../assets/audio/ui-reward.mp3', import.meta.url).href,
  'hit-light': new URL('../assets/audio/hit-light.mp3', import.meta.url).href,
  'hit-heavy': new URL('../assets/audio/hit-heavy.mp3', import.meta.url).href,
  shield: new URL('../assets/audio/shield.mp3', import.meta.url).href,
  'spell-line': new URL('../assets/audio/spell-line.mp3', import.meta.url).href,
  'spell-box': new URL('../assets/audio/spell-box.mp3', import.meta.url).href,
  'spell-cross': new URL('../assets/audio/spell-cross.mp3', import.meta.url).href,
  'sheet-clear': new URL('../assets/audio/sheet-clear.mp3', import.meta.url).href,
  growth: new URL('../assets/audio/growth.mp3', import.meta.url).href,
  cast: new URL('../assets/audio/cast.mp3', import.meta.url).href,
} as const;

export type AudioAssetId = keyof typeof AUDIO_ASSETS;
