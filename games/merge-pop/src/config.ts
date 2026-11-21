/**
 * Where the install button sends the player. In a real campaign this is the store
 * link of the advertised game. For the portfolio it points to the source.
 */
export const CTA_URL = "https://github.com/Nain9Dev/playables/tree/main/games/merge-pop";

/** Seed of the tile spawns. The same seed and the same moves always give the same game. */
export const SEED = 12;

/** Playable ads run 15 to 60 seconds. The end card shows after this many active seconds. */
export const MAX_ACTIVE_SECONDS = 55;

/** Pause between the last move and the end card, so the player sees the result. */
export const END_CARD_DELAY_MS = 900;

/** The first failure offers one more try before the install button takes over. */
export const RETRIES = 1;

/** Active seconds before the automatic demo move, if the player has not swiped yet. */
export const DEMO_MOVE_SECONDS = 0.7;

/** Idle seconds before the swipe hint speeds up. */
export const IDLE_NUDGE_SECONDS = 2.5;

/** Pixels a pointer must travel before a drag counts as a swipe. */
export const SWIPE_PIXELS = 24;
