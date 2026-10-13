export class IncantationAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private voices = new Set<{ source: AudioScheduledSourceNode; gain: GainNode }>();
  unlock(): void {
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
    } catch { /* Silent play remains available. */ }
  }
  private connect(source: AudioScheduledSourceNode, time: number, duration: number, volume: number): void {
    const context = this.context;
    if (!context || !this.output) return;
    // Fast and reduced-motion chains can emit many notes in one frame. Limit
    // polyphony, release old voices gently, and compress the shared output.
    if (this.voices.size >= 28) {
      const old = this.voices.values().next().value!;
      old.gain.gain.cancelScheduledValues(context.currentTime);
      old.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.008);
      old.source.stop(context.currentTime + 0.025);
      this.voices.delete(old);
    }
    const gain = context.createGain(), voice = { source, gain };
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(gain); gain.connect(this.output);
    this.voices.add(voice);
    source.start(time); source.stop(time + duration + 0.03);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
  }
  private tone(frequency: number, time: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency?: number): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency !== undefined) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    this.connect(oscillator, time, duration, volume);
  }
  note(ordinal: number, completion = false): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
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
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const time = context.currentTime, strength = Math.min(1, chainLength / 12);
    this.tone(150 + strength * 50, time, defeated ? 0.5 : 0.32, 0.13, 'sine', 45);
    for (const [i, frequency] of [392, 523.25, 659.25, 783.99].entries()) {
      this.tone(frequency * (defeated ? 1.5 : 1), time + i * 0.018, 0.3 + strength * 0.16, 0.034 + strength * 0.006, 'triangle');
    }
  }
  completion(kind: 'line' | 'box' | 'cross', count = 1): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const time = context.currentTime;
    const root = kind === 'box' ? 440 : kind === 'cross' ? 659.25 : 523.25;
    const volume = 0.027 + Math.min(count, 3) * 0.004;
    for (const [i, ratio] of [1, 1.25, 1.5, 2].entries()) this.tone(root * ratio, time + i * 0.022, 0.23, volume, 'triangle');
    if (kind === 'cross') this.tone(130.81, time, 0.25, 0.05, 'sine', 65.4);
  }
  attack(received: number, blocked = false): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
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
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const time = context.currentTime;
    for (const [i, frequency] of [523.25, 659.25, 783.99, 1046.5, 1318.5].entries()) {
      this.tone(frequency, time + i * 0.04, 0.4, 0.044, 'triangle');
    }
  }
}
