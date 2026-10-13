import { AUDIO_ASSETS, type AudioAssetId } from './audio-assets';

interface Voice { source: AudioScheduledSourceNode; gain: GainNode }

export class IncantationAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Set<Voice>();
  private enabled = true;
  private disposed = false;
  private buffers = new Map<AudioAssetId, AudioBuffer>();
  private loading = new Map<AudioAssetId, Promise<void>>();
  private requests = new AbortController();
  private lastCue = new Map<string, number>();
  private burst: number[] = [];
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      for (const voice of [...this.voices]) this.stopVoice(voice);
      this.lastCue.clear(); this.burst = [];
    }
  }
  unlock(): void {
    if (!this.enabled || this.disposed) return;
    try {
      this.context ??= new AudioContext();
      if (!this.output) {
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -15; compressor.knee.value = 12;
        compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.16;
        this.output = this.context.createGain(); this.output.gain.value = 0.65;
        this.output.connect(compressor); compressor.connect(this.context.destination);
      }
      void this.context.resume().catch(() => {});
      this.loadAssets(this.context);
    } catch { /* Silent play remains available. */ }
  }
  private loadAssets(context: AudioContext): void {
    for (const id of Object.keys(AUDIO_ASSETS) as AudioAssetId[]) {
      if (this.loading.has(id) || this.buffers.has(id)) continue;
      const loading = (async () => {
        try {
          const response = await fetch(AUDIO_ASSETS[id], { signal: this.requests.signal });
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!this.disposed && context === this.context) this.buffers.set(id, buffer);
        } catch { /* Unavailable assets keep the synthesized fallback. */ }
      })();
      this.loading.set(id, loading);
    }
  }
  private playingContext(): AudioContext | null {
    return this.enabled && !this.disposed && this.context?.state === 'running' && this.output ? this.context : null;
  }
  private allowCue(id: string, interval: number, important = true): boolean {
    const context = this.playingContext();
    if (!context) return false;
    const time = context.currentTime;
    if (time - (this.lastCue.get(id) ?? -Infinity) < interval) return false;
    this.burst = this.burst.filter(previous => time - previous < 0.12);
    // Frequent grid ticks leave four slots for completion, hit and growth cues.
    if (this.burst.length >= (important ? 10 : 6)) return false;
    this.lastCue.set(id, time); this.burst.push(time);
    return true;
  }
  private stopVoice(voice: Voice): void {
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* Already stopped sources are harmless. */ }
    voice.source.disconnect(); voice.gain.disconnect();
    this.voices.delete(voice);
  }
  private connect(source: AudioScheduledSourceNode, time: number, duration: number, volume: number, sample = false): void {
    const context = this.playingContext();
    if (!context || !this.output) { source.disconnect(); return; }
    // Stop and disconnect an old voice before creating its replacement, so
    // releasing tails cannot exceed the actual simultaneous playback limit.
    if (this.voices.size >= 24) this.stopVoice(this.voices.values().next().value!);
    const gain = context.createGain(), voice = { source, gain };
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + Math.min(0.008, duration / 4));
    if (sample) {
      gain.gain.setValueAtTime(volume, time + Math.max(duration / 2, duration - 0.04));
      gain.gain.linearRampToValueAtTime(0.0001, time + duration);
    } else gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(gain); gain.connect(this.output);
    this.voices.add(voice);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
    source.start(time); source.stop(time + duration + 0.01);
  }
  private sample(id: AudioAssetId, volume: number, pitch = 1): boolean {
    const context = this.playingContext(), buffer = this.buffers.get(id);
    if (!context || !buffer) return false;
    const source = context.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = pitch;
    this.connect(source, context.currentTime, Math.max(0.02, buffer.duration / pitch), volume, true);
    return true;
  }
  private tone(frequency: number, time: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency?: number): void {
    const context = this.playingContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency !== undefined) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    this.connect(oscillator, time, duration, volume);
  }
  note(ordinal: number, completion = false): void {
    if (!this.allowCue('note', 0.018, false)) return;
    const context = this.playingContext()!;
    const frequencies = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
    const time = context.currentTime;
    const octave = 1 + Math.min(2, Math.floor((ordinal - 1) / frequencies.length)) * 0.5;
    const frequency = frequencies[(ordinal - 1) % frequencies.length] * octave;
    this.tone(frequency, time, completion ? 0.3 : 0.19, 0.05 + Math.min(ordinal, 12) * 0.0015, 'triangle');
    if (ordinal >= 4) this.tone(frequency * 2, time + 0.006, 0.14, 0.012, 'sine');
    if (completion) {
      this.tone(frequency * 1.25, time + 0.015, 0.26, 0.027);
      this.tone(frequency * 1.5, time + 0.035, 0.28, 0.023);
    }
  }
  impact(chainLength: number, defeated = false): void {
    if (!this.allowCue('impact', 0.06)) return;
    const heavy = defeated || chainLength >= 8;
    if (this.sample(heavy ? 'hit-heavy' : 'hit-light', heavy ? 0.4 : 0.34)) return;
    const context = this.playingContext()!;
    const time = context.currentTime, strength = Math.min(1, chainLength / 12);
    this.tone(150 + strength * 50, time, defeated ? 0.5 : 0.32, 0.13, 'sine', 45);
    for (const [i, frequency] of [392, 523.25, 659.25, 783.99].entries()) {
      this.tone(frequency * (defeated ? 1.5 : 1), time + i * 0.018, 0.3 + strength * 0.16, 0.034 + strength * 0.006, 'triangle');
    }
  }
  completion(kind: 'line' | 'box' | 'cross', count = 1): void {
    if (!this.allowCue(`completion-${kind}`, 0.065)) return;
    if (this.sample(`spell-${kind}`, kind === 'cross' ? 0.38 : 0.32, 1 + Math.min(Math.max(count - 1, 0), 3) * 0.025)) return;
    const context = this.playingContext()!;
    const time = context.currentTime;
    const root = kind === 'box' ? 440 : kind === 'cross' ? 659.25 : 523.25;
    const volume = 0.027 + Math.min(count, 3) * 0.004;
    for (const [i, ratio] of [1, 1.25, 1.5, 2].entries()) this.tone(root * ratio, time + i * 0.022, 0.23, volume, 'triangle');
    if (kind === 'cross') this.tone(130.81, time, 0.25, 0.05, 'sine', 65.4);
  }
  attack(received: number, blocked = false): void {
    if (!this.allowCue('attack', 0.08)) return;
    const guarded = blocked || received <= 0;
    if (this.sample(guarded ? 'shield' : received >= 8 ? 'hit-heavy' : 'hit-light', guarded ? 0.3 : 0.38, guarded ? 1 : 0.9)) return;
    const context = this.playingContext()!;
    const time = context.currentTime;
    if (blocked || received <= 0) {
      this.tone(880, time, 0.16, 0.07, 'triangle');
      this.tone(1320, time + 0.025, 0.2, 0.034);
      return;
    }
    this.tone(155, time, 0.27, 0.11, 'triangle', 42);
    this.tone(84, time, 0.32, 0.11, 'sine', 38);
    const duration = 0.14, buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < samples.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * 0.3) / 1.3;
      samples[i] = previous;
    }
    const noise = context.createBufferSource(); noise.buffer = buffer;
    this.connect(noise, time, duration, 0.19);
  }
  sheetClear(): void {
    if (!this.allowCue('sheet-clear', 0.16)) return;
    if (this.sample('sheet-clear', 0.3)) return;
    const context = this.playingContext()!;
    const time = context.currentTime;
    for (const [i, frequency] of [523.25, 659.25, 783.99, 1046.5, 1318.5].entries()) {
      this.tone(frequency, time + i * 0.04, 0.4, 0.044, 'triangle');
    }
  }
  oneCastClear(): void {
    if (!this.allowCue('one-cast-clear', 0.5)) return;
    // One bounded fanfare, using existing licensed assets and tracked voices.
    // Muting stops even the notes scheduled a few milliseconds ahead.
    this.sample('sheet-clear', 0.32, 0.94);
    const context = this.playingContext()!;
    const time = context.currentTime;
    this.tone(130.81, time, 0.52, 0.07, 'sine', 65.4);
    for (const [i, frequency] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      this.tone(frequency, time + i * 0.045, 0.48, 0.037, 'triangle');
    }
    this.tone(1567.98, time + 0.16, 0.48, 0.019);
  }
  ui(kind: 'select' | 'confirm' | 'reward'): void {
    if (!this.allowCue(`ui-${kind}`, kind === 'select' ? 0.045 : 0.1, kind !== 'select')) return;
    if (this.sample(`ui-${kind}`, kind === 'select' ? 0.22 : 0.27)) return;
    const context = this.playingContext()!, time = context.currentTime;
    const frequency = kind === 'select' ? 660 : kind === 'confirm' ? 880 : 1046.5;
    this.tone(frequency, time, 0.1, 0.04, 'triangle');
    if (kind === 'reward') this.tone(frequency * 1.5, time + 0.035, 0.15, 0.025);
  }
  cast(): void {
    if (!this.allowCue('cast', 0.12)) return;
    if (this.sample('cast', 0.28)) return;
    const context = this.playingContext()!;
    this.tone(220, context.currentTime, 0.19, 0.05, 'triangle', 880);
  }
  growth(): void {
    if (!this.allowCue('growth', 0.16)) return;
    if (this.sample('growth', 0.3)) return;
    const context = this.playingContext()!, time = context.currentTime;
    for (const [i, frequency] of [659.25, 783.99, 1046.5].entries()) this.tone(frequency, time + i * 0.04, 0.23, 0.035, 'triangle');
  }
  dispose(): void {
    if (this.disposed) return;
    this.setEnabled(false);
    this.disposed = true; this.requests.abort();
    this.buffers.clear(); this.loading.clear(); this.lastCue.clear(); this.burst = [];
    this.output?.disconnect(); this.output = null;
    const context = this.context; this.context = null;
    if (context) void context.close().catch(() => {});
  }
}
