/**
 * Where the install button sends the player. In a real campaign this is the store
 * link of the advertised game. For the portfolio it points to the source.
 */
export const CTA_URL = "https://github.com/Nain9Dev/playables/tree/main/games/paint-roll";

/** Seed for the opening level. The same seed always gives the same maze. */
export const SEED = 17;

/** Active gameplay cap in seconds (starts after first user input). */
export const MAX_ACTIVE_SECONDS = 45;

/** Seconds before an automatic demo swipe shows the paint rolling if untouched. */
export const DEMO_MOVE_SECONDS = 0.7;

/** Idle seconds before the swipe hint nudges again. */
export const IDLE_NUDGE_SECONDS = 2.8;

/** Minimum pointer travel in CSS pixels to register a swipe. */
export const SWIPE_PIXELS = 24;

/** Pause between win/fail and the end card so the player sees the finish. */
export const END_CARD_DELAY_MS = 900;

/** One frictionless second chance with bonus moves before the install button takes over. */
export const RETRIES = 1;

/** Extra moves awarded on the first retry. */
export const RETRY_BONUS_MOVES = 3;
