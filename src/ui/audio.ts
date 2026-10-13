export class IncantationAudio {
  private context: AudioContext | null = null;
  unlock(): void {
    try { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); } catch { /* Silent play remains available. */ }
  }
  note(ordinal: number, completion = false): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const frequencies = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];
    const time = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = completion ? 'sine' : 'triangle';
    oscillator.frequency.value = frequencies[(ordinal - 1) % frequencies.length] * (ordinal > 9 ? 1.5 : 1);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.045, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(time); oscillator.stop(time + 0.26);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
