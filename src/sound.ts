// Optional synthesized sound effects (Web Audio). Off by default; no audio files.
type Cue = 'jump' | 'double' | 'land' | 'coin' | 'hit' | 'magnet' | 'finish';

const CUES: Record<Cue, Array<[number, number, number]>> = {
  // [frequency Hz, start s, duration s]
  jump: [[520, 0, 0.08]],
  double: [[660, 0, 0.06], [880, 0.05, 0.07]],
  land: [[180, 0, 0.05]],
  coin: [[988, 0, 0.06], [1319, 0.06, 0.1]],
  hit: [[220, 0, 0.12], [150, 0.1, 0.16]],
  magnet: [[523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.12]],
  finish: [[784, 0, 0.1], [659, 0.1, 0.1], [988, 0.2, 0.2]],
};

export class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;

  play(cue: Cue): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      const ac = this.ctx;
      if (ac.state === 'suspended') void ac.resume();
      const t0 = ac.currentTime;
      for (const [f, start, dur] of CUES[cue]) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = cue === 'hit' ? 'sawtooth' : 'triangle';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.02);
      }
    } catch {
      this.enabled = false;
    }
  }
}
