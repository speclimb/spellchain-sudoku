// Optional asset preparation; npm run build uses the already prepared MP3s.
// Download/extract the source packs listed in SOURCES.json to .runtime/cc0-audio
// before running this script. Requires ffmpeg on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const rate = 44100;
const sourceRoot = '.runtime/cc0-audio';
const outputRoot = 'src/assets/audio';
const packs = {
  interface: { author: 'Kenney', title: 'Interface Sounds 1.0', page: 'https://kenney.nl/assets/interface-sounds', download: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip' },
  impact: { author: 'Kenney', title: 'Impact Sounds 1.0', page: 'https://kenney.nl/assets/impact-sounds', download: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip' },
  magic: { author: 'JaggedStone', title: 'Magic Spell SFX', page: 'https://opengameart.org/content/magic-spell-sfx' },
};
const choices = [
  ['ui-select', 'interface', 'interface/Audio/click_001.ogg', .10],
  ['ui-confirm', 'interface', 'interface/Audio/confirmation_002.ogg', .42],
  ['ui-reward', 'interface', 'interface/Audio/confirmation_004.ogg', .49],
  ['hit-light', 'impact', 'impact/Audio/impactPunch_medium_001.ogg', .35],
  ['hit-heavy', 'impact', 'impact/Audio/impactPunch_heavy_002.ogg', .45],
  ['shield', 'impact', 'impact/Audio/impactMetal_light_002.ogg', .23],
  ['spell-line', 'magic', 'magical_1.ogg', .48],
  ['spell-box', 'magic', 'magical_2.ogg', .58],
  ['spell-cross', 'magic', 'magical_3.ogg', .68],
  ['sheet-clear', 'magic', 'magical_4.ogg', .78],
  ['growth', 'magic', 'magical_6.ogg', .65],
  ['cast', 'magic', 'magical_7.ogg', .32],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(outputRoot, { recursive: true });
const files = [];
for (const [key, pack, original, maxDuration] of choices) {
  const input = path.join(sourceRoot, original);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1']);
  const count = Math.min(pcm.length / 4, Math.floor(rate * maxDuration));
  const fadeIn = Math.min(Math.floor(rate * .003), Math.floor(count / 4));
  const fadeOut = Math.min(Math.floor(rate * .045), Math.floor(count / 4));
  const prepared = Buffer.alloc(count * 4);
  let peak = 0, sum = 0;
  for (let i = 0; i < count; i++) {
    const sample = pcm.readFloatLE(i * 4) * Math.min(1, i / fadeIn, (count - 1 - i) / fadeOut);
    prepared.writeFloatLE(sample, i * 4);
    peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
  }
  if (!peak) throw new Error(`Empty audio: ${original}`);
  // Target -20 dB RMS with a conservative -4 dB sample-peak ceiling.
  const rms = Math.sqrt(sum / count), gain = Math.min(.1 / rms, Math.pow(10, -4 / 20) / peak);
  for (let i = 0; i < count; i++) prepared.writeFloatLE(prepared.readFloatLE(i * 4) * gain, i * 4);
  const output = path.join(outputRoot, `${key}.mp3`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '96k', output], { input: prepared });
  const encoded = fs.readFileSync(output);
  const download = packs[pack].download ?? `https://opengameart.org/sites/default/files/${original === 'magical_1.ogg' ? 'magical_1_0.ogg' : original}`;
  files.push({ file: `${key}.mp3`, ...packs[pack], download, original, sourceSha256: hash(fs.readFileSync(input)), sha256: hash(encoded), bytes: encoded.length, duration: count / rate, gain, license: 'CC0-1.0', modifications: 'Mono 44.1 kHz; excerpt from the start; 3 ms fade-in and up to 45 ms fade-out; bounded RMS normalization; MP3 96 kbps' });
}
fs.writeFileSync(path.join(outputRoot, 'SOURCES.json'), JSON.stringify({ license: 'https://creativecommons.org/publicdomain/zero/1.0/', preparedOn: '2026-10-13', files }, null, 2) + '\n');
console.log(`Prepared ${files.length} CC0 sounds, ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes total.`);
