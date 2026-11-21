/**
 * Procedural background music, synthesized with Web Audio so the file carries no audio data.
 * It sits behind a tiny interface so it can move to `kit/` later. Intensity (0 to 3) adds
 * layers: 0 is a soft pad and bass, 1 adds an arpeggio, 2 adds a kick and hats, 3 adds a lead.
 * The context is created on `start()`, which must run inside a user gesture.
 */
export interface Music {
  /** Create the context on first call and start the loop. Safe to call again. */
  start(): void;
  /** Layers to play, 0 to 3. Takes effect at the next step. */
  setIntensity(level: number): void;
  /** Pause or resume without losing the position. */
  setPaused(paused: boolean): void;
  /** Stop the loop for good. */
  stop(): void;
}

const BPM = 112;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.25;
const MASTER_VOLUME = 0.55;

/** One chord per bar, in semitones above A3 (220 Hz). A minor, F, C, G. */
const CHORDS: readonly (readonly number[])[] = [
  [0, 3, 7],
  [-4, 0, 3],
  [3, 7, 10],
  [-2, 2, 5],
];
const BASS_ROOTS = [-12, -16, -9, -14];
const LEAD_STEPS = [12, 15, 19, 15, 24, 19, 15, 12];

const hz = (semitones: number): number => 220 * 2 ** (semitones / 12);

export function createMusic(): Music {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: number | null = null;
  let nextTime = 0;
  let step = 0;
  let level = 0;
  let paused = false;
  let stopped = false;

  function voice(
    when: number,
    frequency: number,
    length: number,
    type: OscillatorType,
    volume: number,
    attack = 0.01,
  ): void {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(volume, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
    oscillator.connect(gain).connect(master);
    oscillator.start(when);
    oscillator.stop(when + length + 0.02);
  }

  function noise(when: number, length: number, volume: number): void {
    if (!context || !master) return;
    const frames = Math.max(1, Math.floor(context.sampleRate * length));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(master);
    source.start(when);
  }

  function kick(when: number): void {
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(150, when);
    oscillator.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    gain.gain.setValueAtTime(0.32, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    oscillator.connect(gain).connect(master);
    oscillator.start(when);
    oscillator.stop(when + 0.18);
  }

  function schedule(when: number, index: number): void {
    const bar = Math.floor(index / 16) % CHORDS.length;
    const inBar = index % 16;
    const chord = CHORDS[bar] ?? CHORDS[0] ?? [0, 3, 7];

    if (inBar === 0) {
      for (const semitones of chord) voice(when, hz(semitones), STEP_SECONDS * 15, "triangle", 0.05, 0.12);
      voice(when, hz(BASS_ROOTS[bar] ?? -12), STEP_SECONDS * 4, "sine", 0.16);
    }
    if (inBar === 8) voice(when, hz(BASS_ROOTS[bar] ?? -12), STEP_SECONDS * 3, "sine", 0.12);

    if (level >= 1 && inBar % 2 === 0) {
      const tone = chord[(inBar / 2) % chord.length] ?? 0;
      voice(when, hz(tone + 12), STEP_SECONDS * 1.6, "triangle", 0.06);
    }
    if (level >= 2) {
      if (inBar % 4 === 0) kick(when);
      if (inBar % 4 === 2) noise(when, 0.05, 0.06);
    }
    if (level >= 3 && inBar % 2 === 1) {
      const lead = LEAD_STEPS[(inBar >> 1) % LEAD_STEPS.length] ?? 12;
      voice(when, hz(lead + (CHORDS[bar]?.[0] ?? 0)), STEP_SECONDS * 1.4, "square", 0.035);
    }
  }

  function pump(): void {
    if (!context || paused || stopped) return;
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      schedule(Math.max(nextTime, context.currentTime), step);
      nextTime += STEP_SECONDS;
      step += 1;
    }
  }

  return {
    start() {
      if (stopped) return;
      if (!context) {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        context = new Ctor();
        master = context.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(context.destination);
        nextTime = context.currentTime + 0.05;
        timer = window.setInterval(pump, 80);
      }
      if (!paused) void context.resume();
    },
    setIntensity(value) {
      level = Math.max(0, Math.min(3, Math.round(value)));
    },
    setPaused(value) {
      paused = value;
      if (!context) return;
      if (value) void context.suspend();
      else {
        nextTime = context.currentTime + 0.05;
        void context.resume();
      }
    },
    stop() {
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (context) void context.close();
      context = null;
    },
  };
}
