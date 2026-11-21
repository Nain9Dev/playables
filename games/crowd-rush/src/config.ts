/**
 * Where the install button sends the player. In a real campaign this is the store
 * link of the advertised game. For the portfolio it points to the source.
 */
export const CTA_URL = "https://github.com/Nain9Dev/playables/tree/main/games/crowd-rush";

/** Seed of the level. The same seed always gives the same gates. */
export const LEVEL_SEED = 7;

/** Playable ads run 15 to 60 seconds. The end card shows after this many active seconds. */
export const MAX_ACTIVE_SECONDS = 50;

/** Pause between the end of the run and the end card, so the player sees the result. */
export const END_CARD_DELAY_MS = 1100;

/** Length of the final crowd fight, in seconds. */
export const BATTLE_SECONDS = 1.7;

/** The first failure offers one more try before the install button takes over. */
export const RETRIES = 1;

/** Extra crowd members the retry starts with, as a reward for coming back. */
export const RETRY_BONUS = 12;

/** Idle seconds before the hint starts to shake. */
export const IDLE_NUDGE_SECONDS = 2.5;
