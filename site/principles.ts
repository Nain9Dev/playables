/**
 * The retention principles every playable is scored against. They are the habits of
 * short-video feeds applied to an ad: grab in the first second, reward early, keep a
 * visible goal, change the rhythm, and make coming back cost nothing.
 *
 * Each playable scores itself on every principle in its playable.json. The score is
 * a plain claim backed by a note that names where it lives in the game, and the
 * site build refuses a playable that skips a principle.
 */

export interface Principle {
  id: string;
  title: string;
  description: string;
}

export const PRINCIPLES: readonly Principle[] = [
  {
    id: "instant-motion",
    title: "Motion from the first frame",
    description: "Something moves before the player does anything. No title screen, no loading.",
  },
  {
    id: "text-hook",
    title: "A text hook",
    description: "A short line that asks or promises something, so the player starts thinking at once.",
  },
  {
    id: "one-control",
    title: "One control",
    description: "A single gesture that needs no explanation beyond a visual cue.",
  },
  {
    id: "first-reward",
    title: "Reward in the first seconds",
    description: "The first input pays off with sound, motion and score, whatever the player does.",
  },
  {
    id: "pattern-interrupt",
    title: "Rhythm changes",
    description: "A scheduled change of pace, stakes or scene breaks the monotony before it sets in.",
  },
  {
    id: "variable-reward",
    title: "Variable rewards",
    description: "Streaks, combos or surprises make some moments bigger than others.",
  },
  {
    id: "open-loop",
    title: "A visible unfinished goal",
    description: "A progress bar or counter shows how far the player is from the end (goal gradient).",
  },
  {
    id: "near-miss",
    title: "Near-win tension",
    description: "Being one step from winning, or losing by a little, is made visible.",
  },
  {
    id: "instant-retry",
    title: "Retry without friction",
    description: "Coming back after a loss takes one tap and comes with a reason to do it.",
  },
  {
    id: "sound-haptics",
    title: "Sound and haptics",
    description: "Every action has a sound and a short vibration, and audio stays off until the first tap.",
  },
  {
    id: "cliffhanger-end",
    title: "An end that pulls forward",
    description: "The end card feels like a reward and points to what comes next.",
  },
  {
    id: "measured",
    title: "Measured",
    description: "The ad reports the events that show where players enter, stay and leave.",
  },
];

/** Short axis labels for the radar chart, one per principle id. */
export const SHORT_LABEL: Record<string, string> = {
  "instant-motion": "Motion",
  "text-hook": "Hook",
  "one-control": "Control",
  "first-reward": "Reward",
  "pattern-interrupt": "Rhythm",
  "variable-reward": "Variety",
  "open-loop": "Goal",
  "near-miss": "Near-win",
  "instant-retry": "Retry",
  "sound-haptics": "Sound",
  "cliffhanger-end": "Ending",
  measured: "Measured",
};

export type Status = "yes" | "partial" | "no";

export interface Score {
  status: Status;
  note: string;
}

export const STATUS_LABEL: Record<Status, string> = {
  yes: "Yes",
  partial: "Partial",
  no: "No",
};

/** Number of principles fully met, and the total. */
export function tally(scorecard: Record<string, Score>): { yes: number; partial: number; total: number } {
  let yes = 0;
  let partial = 0;
  for (const principle of PRINCIPLES) {
    const score = scorecard[principle.id];
    if (score?.status === "yes") yes += 1;
    else if (score?.status === "partial") partial += 1;
  }
  return { yes, partial, total: PRINCIPLES.length };
}
