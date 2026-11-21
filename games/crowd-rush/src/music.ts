/**
 * Ambient music that follows the crowd. Everything is synthesized with the Web
 * Audio API, so the file carries no audio data. The interface is tiny on purpose:
 * `kit/` can adopt this module later without touching the game.
 *
 * Layers fade in as the intensity rises: a soft pad first, then bass and kick,
 * then hats, then the arpeggio. The module creates its own AudioContext on
 * `start()`, which must be called from a user gesture.
 */

export interface Music {
  /** Create the audio context and begin the loop. Call it from a user gesture. */
  start(): void;
  /** Set how busy the music is, from 0 (calm) to 1 (full). It eases in, never jumps. */
  setIntensity(value: number): void;
  /** Duck the whole mix, for example for a boss warning or the end card. */
  setLevel(value: number): void;
  pause(): void;
  resume(): void;
}

export const BPM = 126;

/** Intensity from a crowd size on a log scale: 10 members is calm, `reference` is full. */
export function intensityFor(count: number, reference: number, floor = 10): number {
  if (count <= floor) return 0;
  if (reference <= floor) return 1;
  return Math.max(0, Math.min(1, Math.log(count / floor) / Math.log(reference / floor)));
}

export interface Layers {
  pad: number;
  bass: number;
  kick: number;
  hat: number;
  arp: number;
}

function ramp(value: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (value - from) / (to - from)));
}

/** Gain of every layer for an intensity from 0 to 1. Layers enter one after another. */
export function layersFor(intensity: number): Layers {
  const i = Math.max(0, Math.min(1, intensity));
  return {
    pad: 0.6 + 0.4 * i,
    bass: ramp(i, 0.05, 0.3),
    kick: ramp(i, 0.2, 0.45),
    hat: ramp(i, 0.4, 0.65),
    arp: ramp(i, 0.6, 0.85),
  };
}

/** Chord roots in semitones above A, one per bar: Am, F, C, G. */
export const PROGRESSION: readonly number[] = [0, -4, 3, -2];

/** Chord tones above the root, used by the arpeggio. */
export const CHORD: readonly number[] = [0, 3, 7, 12];

/** Frequency of a note `semitones` above A (220 Hz). */
export function pitch(semitones: number, base = 220): number {
  return base * 2 ** (semitones / 12);
}

const STEPS_PER_BAR = 16;
const LOOKAHEAD_SECONDS = 0.18;
const TICK_MS = 30;

export function createMusic(): Music {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  const buses: Record<keyof Layers, GainNode | null> = { pad: null, bass: null, kick: null, hat: null, arp: null };
  let noise: AudioBuffer | null = null;
  let step = 0;
  let nextTime = 0;
  let intensity = 0;
  let level = 1;

  const stepSeconds = 60 / BPM / 4;

  function applyMix(): void {
    if (!context || !master) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(0.5 * level, now, 0.25);
    const layers = layersFor(intensity);
    for (const key of Object.keys(layers) as (keyof Layers)[]) {
      buses[key]?.gain.setTargetAtTime(layers[key], now, 0.4);
    }
  }

  function voice(
    bus: GainNode,
    type: OscillatorType,
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    sweepTo?: number,
  ): void {
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (sweepTo) oscillator.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function hat(bus: GainNode, start: number, accent: boolean): void {
    if (!context || !noise) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(accent ? 0.22 : 0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    source.connect(filter).connect(gain).connect(bus);
    source.start(start);
    source.stop(start + 0.06);
  }

  function schedule(index: number, time: number): void {
    const bar = Math.floor(index / STEPS_PER_BAR) % PROGRESSION.length;
    const inBar = index % STEPS_PER_BAR;
    const root = PROGRESSION[bar] ?? 0;
    const { pad, bass, kick, hat: hats, arp } = buses;

    if (inBar === 0 && pad && context) {
      const length = stepSeconds * STEPS_PER_BAR;
      for (const tone of [0, 7, 12]) {
        voice(pad, "sine", pitch(root + tone + 12), time, length, 0.09);
        voice(pad, "triangle", pitch(root + tone + 12) * 1.004, time, length, 0.05);
      }
    }
    if (kick && inBar % 4 === 0) voice(kick, "sine", 150, time, 0.16, 0.9, 42);
    if (bass && (inBar % 4 === 0 || inBar % 8 === 6)) {
      voice(bass, "triangle", pitch(root - 12), time, stepSeconds * 3, 0.55);
    }
    if (hats && inBar % 2 === 1) hat(hats, time, inBar % 4 === 3);
    if (arp) {
      const tone = CHORD[(inBar * 3 + Math.floor(inBar / 4)) % CHORD.length] ?? 0;
      voice(arp, "square", pitch(root + tone + 24), time, stepSeconds * 1.6, 0.06);
    }
  }

  function tick(): void {
    if (!context) return;
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      schedule(step, nextTime);
      step += 1;
      nextTime += stepSeconds;
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
      master.gain.value = 0;
      master.connect(context.destination);
      for (const key of Object.keys(buses) as (keyof Layers)[]) {
        const bus = context.createGain();
        bus.gain.value = 0;
        bus.connect(master);
        buses[key] = bus;
      }
      noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.08), context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      void context.resume();
      nextTime = context.currentTime + 0.05;
      applyMix();
      window.setInterval(tick, TICK_MS);
    },
    setIntensity(value: number): void {
      intensity = Math.max(0, Math.min(1, value));
      applyMix();
    },
    setLevel(value: number): void {
      level = Math.max(0, Math.min(1, value));
      applyMix();
    },
    pause(): void {
      if (context) void context.suspend();
    },
    resume(): void {
      if (context) {
        void context.resume();
        nextTime = Math.max(nextTime, context.currentTime + 0.05);
      }
    },
  };
}
