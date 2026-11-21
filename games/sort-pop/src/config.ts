/**
 * Where the install button sends the player. In a real campaign this is the store link
 * of the advertised game. For the portfolio it points to the source.
 */
export const CTA_URL = "https://github.com/Nain9Dev/playables/tree/main/games/sort-pop";

/**
 * Seed of the level. The same seed always gives the same scramble and the same solution.
 * Chosen from a search: the shortest solution finishes its first tube on the third pour
 * (an early reward), then finishes four in a row (a combo), and the move limit leaves a
 * few spare pours.
 */
export const SEED = 93;

/** Distinct colors, and tubes left empty at the start. */
export const COLORS = 5;
export const EMPTY_TUBES = 2;

/**
 * Reverse moves applied to the solved state. The walk stops by itself at a state with
 * no reverse move left, which is about 12 pours from solved with 5 colors.
 */
export const SCRAMBLE_STEPS = 20;

/** Moves allowed on top of the length of the known solution. */
export const MOVE_SLACK = 1;

/** The first failure offers one more try with an extra empty tube and a few more moves. */
export const RETRY_EXTRA_TUBES = 1;
export const RETRY_EXTRA_MOVES = 2;
export const RETRIES = 1;

/** Playable ads run 15 to 60 seconds. The end card shows after this many active seconds. */
export const MAX_ACTIVE_SECONDS = 55;

/** Pause between the last pour and the end card, so the player sees the result. */
export const END_CARD_DELAY_MS = 1100;

/** Idle seconds before the hint pulse and the finger come back. */
export const IDLE_HINT_SECONDS = 4;

/** Delay before the opening finger starts, in milliseconds. */
export const FINGER_START_MS = 350;
