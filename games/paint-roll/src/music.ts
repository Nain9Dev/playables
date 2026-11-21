/**
 * Synthesized upbeat background music for Paint Roll. Starts only after the first
 * user gesture and layers in percussion and melody as more of the board is painted.
 */

export interface Music {
  start(): void;
  pause(): void;
  resume(): void;
  setIntensity(level: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export interface PatternStep {
  bass: number | null;
  lead: number | null;
  kick: boolean;
  hat: boolean;
}

const ROOTS = [0, 7, 9, 5] as const; // C, G, Am, F
const STEPS_PER_BAR = 16;

export function patternStep(step: number, intensity: number): PatternStep {
  const bar = Math.floor(step / STEPS_PER_BAR) % ROOTS.length;
  const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  const root = ROOTS[bar] ?? 0;
  const minor = bar === 2;
  const chord = [0, minor ? 3 : 4, 7, 12];

  const bass = inBar % 4 === 0 ? root - 12 : null;
  let lead: number | null = null;
  if (intensity >= 1 && inBar % 2 === 0) {
    lead = root + (chord[(inBar / 2) % chord.length] ?? 0) + (intensity >= 3 && inBar % 8 === 6 ? 12 : 0);
  }
  const kick = intensity >= 2 && (inBar === 0 || inBar === 8);
  const hat = intensity >= 2 && inBar % 4 === 2;
  return { bass, lead, kick, hat };
}

const BASS_BASE = 130.81;
const LEAD_BASE = 523.25;
const BPM = 120;
const LOOKAHEAD = 0.16;

export function createMusic(): Music {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let nextTime = 0;
  let step = 0;
  let intensity = 0;
  let muted = false;
  let paused = false;

  const freq = (base: number, semitones: number): number => base * 2 ** (semitones / 12);

  function voice(f: number, at: number, duration: number, type: OscillatorType, volume: number): void {
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function kickDrum(at: number): void {
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    gain.gain.setValueAtTime(0.16, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.13);
  }

  function hatTick(at: number): void {
    if (!context || !master || !noise) return;
    const src = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    src.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = 7500;
    gain.gain.setValueAtTime(0.03, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(filter).connect(gain).connect(master);
    src.start(at);
    src.stop(at + 0.05);
  }

  function schedule(): void {
    if (!context || paused) return;
    const stepSeconds = 60 / BPM / 4;
    while (nextTime < context.currentTime + LOOKAHEAD) {
      const s = patternStep(step, intensity);
      if (s.bass !== null) voice(freq(BASS_BASE, s.bass), nextTime, stepSeconds * 3, "triangle", 0.11);
      if (s.lead !== null) voice(freq(LEAD_BASE, s.lead), nextTime, stepSeconds * 1.6, "sine", 0.048);
      if (s.kick) kickDrum(nextTime);
      if (s.hat) hatTick(nextTime);
      nextTime += stepSeconds;
      step += 1;
    }
  }

  return {
    start(): void {
      if (context) {
        void context.resume();
        return;
      }
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.52;
      master.connect(context.destination);
      noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.05), context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      void context.resume();
      nextTime = context.currentTime + 0.05;
      window.setInterval(schedule, 40);
    },
    pause(): void {
      paused = true;
      void context?.suspend();
    },
    resume(): void {
      paused = false;
      if (context) {
        nextTime = context.currentTime + 0.05;
        void context.resume();
      }
    },
    setIntensity(level: number): void {
      intensity = Math.max(0, Math.min(3, Math.round(level)));
    },
    setMuted(value: boolean): void {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.52, context.currentTime, 0.03);
    },
    get muted(): boolean {
      return muted;
    },
  };
}
