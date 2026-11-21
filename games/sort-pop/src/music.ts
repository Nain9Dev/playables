/**
 * Background music, synthesized with Web Audio so the file carries no audio data.
 * It lives behind the small `Music` interface so it can move to `kit/` later and be
 * shared by other playables. Intensity (0 to 3) adds layers as the player makes progress.
 * It has its own audio context and starts only after the first tap, as the networks require.
 */

export interface Music {
  /** Create the audio context and start the loop. Call it from a user gesture. */
  start(): void;
  pause(): void;
  resume(): void;
  /** 0 is a calm bed, 3 is the busiest. */
  setIntensity(level: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export interface PatternStep {
  /** Semitones above the bass base note, or null for a rest. */
  bass: number | null;
  /** Semitones above the arpeggio base note, or null for a rest. */
  arp: number | null;
  /** A hi-hat tick. */
  hat: boolean;
}

/** One chord per bar: C, A minor, F, G. Roots are in semitones above C. */
const ROOTS = [0, 9, 5, 7] as const;
const MINOR = [true, false, false, false] as const;
const STEPS_PER_BAR = 16;

/** The pure pattern: what plays on a 16th-note step, for an intensity level. */
export function patternStep(step: number, intensity: number): PatternStep {
  const bar = Math.floor(step / STEPS_PER_BAR) % ROOTS.length;
  const inBar = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  const root = ROOTS[bar] ?? 0;
  const third = MINOR[bar] ? 3 : 4;
  const chord = [0, third, 7, 12];

  const bass = inBar % 4 === 0 ? root - 12 : null;
  const arpEvery = intensity >= 1 ? 2 : 4;
  const arpOffset = intensity >= 1 ? 0 : 2;
  let arp: number | null = null;
  if (inBar % arpEvery === arpOffset) {
    const index = (inBar / arpEvery) % chord.length;
    arp = root + (chord[Math.floor(index)] ?? 0) + (intensity >= 3 && inBar % 8 === 6 ? 12 : 0);
  }
  const hat = intensity >= 3 ? inBar % 2 === 0 : intensity >= 2 ? inBar % 4 === 2 : false;
  return { bass, arp, hat };
}

const BASS_BASE = 130.81; // C3
const ARP_BASE = 523.25; // C5
const BPM = 112;
const LOOKAHEAD_SECONDS = 0.16;

export function createMusic(): Music {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let nextTime = 0;
  let step = 0;
  let intensity = 0;
  let muted = false;
  let paused = false;

  const frequency = (base: number, semitones: number): number => base * 2 ** (semitones / 12);

  function voice(freq: number, at: number, duration: number, type: OscillatorType, volume: number): void {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  function tick(at: number): void {
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(0.03, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + 0.05);
  }

  function schedule(): void {
    if (!context || paused) return;
    const stepSeconds = 60 / BPM / 4;
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const now = patternStep(step, intensity);
      if (now.bass !== null) voice(frequency(BASS_BASE, now.bass), nextTime, stepSeconds * 3, "triangle", 0.1);
      if (now.arp !== null) voice(frequency(ARP_BASE, now.arp), nextTime, stepSeconds * 1.8, "sine", 0.045);
      if (now.hat) tick(nextTime);
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
      master.gain.value = muted ? 0 : 0.55;
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
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.55, context.currentTime, 0.03);
    },
    get muted(): boolean {
      return muted;
    },
  };
}
