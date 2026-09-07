/** Every sound is synthesised - the game ships no audio files, so there is
 *  nothing to license and nothing to download.
 *
 *  The backing track is the interesting part. A one-button runner lives or
 *  dies on rhythm, so instead of looping a sample the track is *scheduled*:
 *  a lookahead loop queues kicks, hats and bass notes onto the WebAudio clock
 *  a fraction of a second early, at the level's own BPM. Scheduling ahead on
 *  the audio clock rather than firing from requestAnimationFrame is what keeps
 *  the beat steady when the frame rate is not. */
const BASS_PATTERN = [0, 0, 7, 0, 5, 0, 7, 3];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  muted = false;

  private bpm = 128;
  private root = 110;
  private playing = false;
  /** Next beat index still to be scheduled, and its time on the audio clock. */
  private nextBeat = 0;
  private nextBeatTime = 0;
  private timer: number | null = null;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.55;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.3;
    if (m) this.stopMusic();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when?: number,
    slideTo?: number,
    dest?: GainNode,
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest ?? this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, hz: number, type: BiquadFilterType, when?: number, dest?: GainNode): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = when ?? ctx.currentTime;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.master);
    src.start(t);
  }

  /** Start the backing track at this tempo, `fromBeat` into the pattern, so a
   *  checkpoint respawn drops you back in on the same bar rather than at 1. */
  startMusic(bpm: number, fromBeat = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stopMusic();
    this.bpm = bpm;
    this.root = 110 * Math.pow(2, ((bpm - 128) / 24) * (1 / 12)); // faster levels sit slightly higher
    this.nextBeat = Math.floor(fromBeat);
    this.nextBeatTime = ctx.currentTime + 0.06;
    this.playing = true;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 40);
  }

  stopMusic(): void {
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Queue every beat that falls inside the next 150ms of audio time. */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing || !this.musicGain) return;
    const spb = 60 / this.bpm;
    while (this.nextBeatTime < ctx.currentTime + 0.15) {
      const b = this.nextBeat;
      const t = this.nextBeatTime;
      // Kick on every beat, a snappy hat on the off-beat, bass on the pattern.
      this.tone(150, 0.13, 'sine', 0.5, t, 44, this.musicGain);
      this.noise(0.045, 0.1, 7000, 'highpass', t + spb / 2, this.musicGain);
      if (b % 4 === 2) this.noise(0.12, 0.16, 1800, 'bandpass', t, this.musicGain);
      const semi = BASS_PATTERN[b % BASS_PATTERN.length];
      this.tone(this.root * Math.pow(2, semi / 12), spb * 0.42, 'sawtooth', 0.13, t, undefined, this.musicGain);
      this.nextBeat = b + 1;
      this.nextBeatTime = t + spb;
    }
  }

  jump(): void {
    this.tone(420, 0.09, 'square', 0.14, undefined, 760);
  }
  land(): void {
    this.tone(120, 0.05, 'sine', 0.1, undefined, 80);
  }
  pad(): void {
    this.tone(300, 0.22, 'triangle', 0.2, undefined, 1200);
  }
  checkpoint(): void {
    [660, 990].forEach((f, i) => window.setTimeout(() => this.tone(f, 0.12, 'triangle', 0.16), i * 70));
  }
  die(): void {
    this.stopMusic();
    this.noise(0.5, 0.45, 700, 'lowpass');
    this.tone(180, 0.45, 'sawtooth', 0.24, undefined, 44);
  }
  clear(): void {
    this.stopMusic();
    [523, 659, 784, 1047].forEach((f, i) =>
      window.setTimeout(() => this.tone(f, 0.22, 'square', 0.2), i * 110),
    );
  }
}
