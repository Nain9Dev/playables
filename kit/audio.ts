/**
 * Sound is synthesized with the Web Audio API, so the file carries no audio data.
 * The context is created on the first tap: ad networks require the ad to stay
 * muted until the player interacts.
 */
let context: AudioContext | null = null;
let muted = false;

export function unlockAudio(): void {
  if (!context) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context = new Ctor();
  }
  if (!muted) void context.resume();
}

/** Suspend the shared audio context when the ad is hidden or not viewable. */
export function pauseAudio(): void {
  if (context && context.state === "running") void context.suspend();
}

/** Resume the shared audio context if it was already unlocked and is not muted. */
export function resumeAudio(): void {
  if (context && !muted && context.state === "suspended") void context.resume();
}

/** Mute or unmute synthesized sound effects without creating an audio context early. */
export function setAudioMuted(value: boolean): void {
  muted = value;
  if (value) pauseAudio();
  else resumeAudio();
}

export function tone(
  frequency: number,
  duration = 0.14,
  type: OscillatorType = "triangle",
  volume = 0.16,
  delay = 0,
): void {
  if (muted || !context || context.state !== "running") return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

/** Frequency of a note `semitones` above `base` (equal temperament). */
export function note(semitones: number, base = 523.25): number {
  return base * 2 ** (semitones / 12);
}

/** Best-effort haptic tap. Ignored where the browser has no vibration API. */
export function haptic(milliseconds: number): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(milliseconds);
  }
}
