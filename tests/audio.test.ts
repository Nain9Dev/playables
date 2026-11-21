import { afterEach, describe, expect, it, vi } from "vitest";
import { note, pauseAudio, resumeAudio, setAudioMuted, tone, unlockAudio } from "../kit/audio.ts";

describe("kit/audio", () => {
  afterEach(() => {
    setAudioMuted(false);
    vi.restoreAllMocks();
  });

  it("computes equal-temperament frequencies", () => {
    expect(note(0, 440)).toBeCloseTo(440, 4);
    expect(note(12, 440)).toBeCloseTo(880, 4);
    expect(note(-12, 440)).toBeCloseTo(220, 4);
  });

  it("suspends and resumes the audio context and respects mute", () => {
    let state: "running" | "suspended" = "suspended";
    const suspend = vi.fn(() => {
      state = "suspended";
      return Promise.resolve();
    });
    const resume = vi.fn(() => {
      state = "running";
      return Promise.resolve();
    });
    const start = vi.fn();
    const stop = vi.fn();
    class FakeAudioContext {
      get state() {
        return state;
      }
      currentTime = 0;
      destination = {};
      suspend = suspend;
      resume = resume;
      createOscillator() {
        return {
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: () => ({ connect: vi.fn() }),
          start,
          stop,
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeAudioContext });

    unlockAudio();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(state).toBe("running");

    tone(440);
    expect(start).toHaveBeenCalledTimes(1);

    pauseAudio();
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(state).toBe("suspended");

    resumeAudio();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(state).toBe("running");

    setAudioMuted(true);
    expect(state).toBe("suspended");
    resumeAudio();
    expect(state).toBe("suspended");
    tone(440);
    expect(start).toHaveBeenCalledTimes(1);

    setAudioMuted(false);
    expect(state).toBe("running");
  });
});
