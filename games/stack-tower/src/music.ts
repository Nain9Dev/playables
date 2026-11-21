/**
 * Procedural ambient music for the playable. Nothing is downloaded: every note is
 * synthesized with the Web Audio API, so the file carries no audio data.
 *
 * The game only talks to the small `Music` interface, so this module can move to
 * `kit/` later without touching the game code. It owns a private AudioContext
 * created on the first call to `start()`, which must come from a player gesture
 * (ad networks keep playables muted until the first tap).
 */
export type MusicTier = 0 | 1 | 2 | 3;

export interface Music {
  /** Create the audio graph and start the loop. Call from a user gesture. */
  start(): void;
  /** Layers fade in with the tier: 0 pad and bass, 1 arpeggio, 2 drums, 3 sparkle lead. */
  setIntensity(tier: MusicTier): void;
  /** Silence the music (tab hidden, ad not viewable) or bring it back. */
  setPaused(paused: boolean): void;
  /** Mute everything for good, for example a player toggle. */
  setMuted(muted: boolean): void;
}

const BPM = 116;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.14;
const TICK_MS = 30;
const MASTER_VOLUME = 0.5;

/** Am, F, C, G: one bar each. Roots in Hz and the chord tones as semitones above the root. */
const BARS: { root: number; chord: number[] }[] = [
  { root: 110, chord: [0, 3, 7] },
  { root: 87.31, chord: [0, 4, 7] },
  { root: 130.81, chord: [0, 4, 7] },
  { root: 98, chord: [0, 4, 7] },
];

const hz = (root: number, semitones: number): number => root * 2 ** (semitones / 12);

export function createMusic(): Music {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let tier: MusicTier = 0;
  let paused = false;
  let muted = false;
  let step = 0;
  let nextTime = 0;

  function applyVolume(): void {
    if (!master || !context) return;
    master.gain.setTargetAtTime(paused || muted ? 0 : MASTER_VOLUME, context.currentTime, 0.08);
  }

  function voice(
    type: OscillatorType,
    frequency: number,
    start: number,
    length: number,
    volume: number,
  ): void {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + length + 0.02);
  }

  function kick(start: number): void {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(130, start);
    oscillator.frequency.exponentialRampToValueAtTime(42, start + 0.12);
    gain.gain.setValueAtTime(0.5, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  }

  function hat(start: number, volume: number): void {
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.04);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
    source.stop(start + 0.05);
  }

  function scheduleStep(index: number, time: number): void {
    const bar = BARS[Math.floor(index / 16) % BARS.length];
    if (!bar) return;
    const inBar = index % 16;

    // Layer 0: a soft pad once per bar and a bass note on every beat.
    if (inBar === 0) {
      for (const tone of bar.chord) voice("sine", hz(bar.root * 2, tone), time, STEP_SECONDS * 15, 0.05);
    }
    if (inBar % 4 === 0) voice("triangle", bar.root, time, STEP_SECONDS * 3, 0.16);

    // Layer 1: eighth-note arpeggio over the chord.
    if (tier >= 1 && inBar % 2 === 0) {
      const tone = bar.chord[(inBar / 2) % bar.chord.length] ?? 0;
      voice("triangle", hz(bar.root * 4, tone), time, STEP_SECONDS * 1.6, 0.07);
    }

    // Layer 2: four on the floor and sixteenth hats with an open accent off the beat.
    if (tier >= 2) {
      if (inBar % 4 === 0) kick(time);
      hat(time, inBar % 4 === 2 ? 0.09 : 0.04);
    }

    // Layer 3: a bright lead that climbs the chord on the off sixteenths.
    if (tier >= 3 && inBar % 2 === 1) {
      const tone = bar.chord[Math.floor(inBar / 2) % bar.chord.length] ?? 0;
      voice("square", hz(bar.root * 8, tone + (inBar > 8 ? 12 : 0)), time, STEP_SECONDS * 1.2, 0.035);
    }
  }

  function tick(): void {
    if (!context || paused || muted) return;
    // After a long pause the clock may be far behind: skip ahead instead of bursting.
    if (nextTime < context.currentTime) nextTime = context.currentTime + 0.05;
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      scheduleStep(step, nextTime);
      step += 1;
      nextTime += STEP_SECONDS;
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
      noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.1), context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      void context.resume();
      nextTime = context.currentTime + 0.05;
      applyVolume();
      window.setInterval(tick, TICK_MS);
    },
    setIntensity(next: MusicTier): void {
      tier = next;
    },
    setPaused(value: boolean): void {
      paused = value;
      applyVolume();
      if (context) {
        if (value) void context.suspend();
        else void context.resume();
      }
    },
    setMuted(value: boolean): void {
      muted = value;
      applyVolume();
    },
  };
}
