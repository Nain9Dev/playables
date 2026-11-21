/**
 * Where the install button sends the player. In a real campaign this is the store
 * link of the advertised game. For the portfolio it points to the source.
 */
export const CTA_URL = "https://github.com/Nain9Dev/playables/tree/main/games/stack-tower";

/** Playable ads run 15 to 60 seconds. The end card shows after this many active seconds. */
export const MAX_ACTIVE_SECONDS = 45;

/** Pause between the last drop and the end card, so the player sees the result. */
export const END_CARD_DELAY_MS = 900;

/** The first failure offers one more try before the install button takes over. */
export const RETRIES = 1;

/** Idle seconds before the hint starts to shake. */
export const IDLE_NUDGE_SECONDS = 2.5;
