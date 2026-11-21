import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, pauseAudio, resumeAudio, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  CTA_URL,
  DEMO_MOVE_SECONDS,
  END_CARD_DELAY_MS,
  IDLE_NUDGE_SECONDS,
  MAX_ACTIVE_SECONDS,
  RETRIES,
  SEED,
  SWIPE_PIXELS,
} from "./config.ts";
import {
  CONFIG,
  MergeGame,
  demoDirection,
  nearMissLine,
  nearWinMessage,
  starsFor,
  type Direction,
  type MoveResult,
} from "./game/rules.ts";
import { createMusic } from "./music.ts";
import { MergeView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const caption = element("caption");
const hint = element("hint");
const progress = element("progress");
const marks = element("marks");
const fill = element("fill");
const scoreText = element("score");
const movesText = element("moves");
const scoreChip = element("score-chip");
const movesChip = element("moves-chip");
const streakBox = element("streak");
const pips = Array.from(element("pips").children);
const multText = element("mult");
const boosterButton = element<HTMLButtonElement>("booster");
const toast = element("toast");
const pops = element("pops");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const view = new MergeView(canvas);
const music = createMusic();
let attempt = 0;
let game = new MergeGame(SEED);
let paused = true;
let ended = false;
let lastFrame = 0;
let startedAt = 0;
let activeSeconds = 0;
let idleSeconds = 0;
let hasMoved = false;
let demoDone = false;
let nudged = false;
let retriesLeft = RETRIES;
let lockedUntil = 0;
let announcedNearWin = false;
let boosterOffered = false;
let boosterArmed = false;

// Sound design: a few synthesized notes per event, so the file carries no audio data.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19];
function mergeChime(value: number, combo: number, multiplier: number): void {
  const step = SCALE[Math.min(SCALE.length - 1, Math.max(0, Math.log2(value) - 2))] ?? 0;
  tone(note(step, 440), 0.2, "sine", 0.17);
  if (combo >= 2) tone(note(step + 12, 440), 0.25, "sine", 0.09, 0.05);
  if (multiplier >= 2) tone(note(step + 19, 440), 0.22, "triangle", 0.05 + multiplier * 0.01, 0.09);
}
const blockedBuzz = (): void => tone(120, 0.12, "square", 0.06);
const winFanfare = (): void => [0, 4, 7, 12, 16].forEach((s, i) => tone(note(s), 0.28, "sine", 0.18, i * 0.09));
const loseThud = (): void => tone(85, 0.4, "sawtooth", 0.13);
const smashSound = (): void => {
  tone(180, 0.18, "sawtooth", 0.12);
  tone(note(7, 330), 0.2, "sine", 0.12, 0.06);
};
const milestoneSound = (): void => [0, 7, 12].forEach((s, i) => tone(note(s, 392), 0.3, "triangle", 0.14, i * 0.08));

function showToast(text: string, tint: "" | "gold" | "red" = ""): void {
  toast.textContent = text;
  toast.className = tint;
  // Reading offsetWidth restarts the CSS animation.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, row: number, col: number, big: boolean): void {
  const at = view.screenOf(row, col);
  const pop = document.createElement("span");
  pop.className = big ? "pop big" : "pop";
  pop.textContent = text;
  pop.style.left = `${at.x}px`;
  pop.style.top = `${at.y}px`;
  pops.appendChild(pop);
  window.setTimeout(() => pop.remove(), 950);
}

function bump(chip: HTMLElement): void {
  chip.classList.add("bump");
  window.setTimeout(() => chip.classList.remove("bump"), 130);
}

function renderHud(): void {
  scoreText.textContent = String(game.score);
  movesText.textContent = String(game.movesLeft);
  movesChip.classList.toggle("urgent", game.movesLeft <= 5 && game.outcome === "playing");
  fill.style.transform = `scaleX(${game.progress})`;

  const streak = game.streak;
  const multiplier = Math.min(CONFIG.maxMultiplier, 1 + Math.floor(streak / 2));
  streakBox.classList.toggle("on", streak >= 2 && game.outcome === "playing");
  pips.forEach((pip, index) => pip.classList.toggle("lit", index < streak));
  multText.textContent = `x${multiplier}`;
}

/** Music layers follow the streak, near-win tension adds a floor, and a long pause calms it. */
function musicLevel(): number {
  let level = game.streak >= 6 ? 3 : game.streak >= 3 ? 2 : game.streak >= 1 ? 1 : 0;
  if (nearWinMessage(game.tiles) === "ONE MERGE TO WIN!") level = Math.max(level, 2);
  if (idleSeconds > 4 && hasMoved) level = Math.max(0, level - 1);
  return ended ? 0 : level;
}

function renderStars(count: number): void {
  endStars.replaceChildren(
    ...[1, 2, 3].map((n) => {
      const star = document.createElement("span");
      star.textContent = "★";
      if (n > count) star.className = "off";
      return star;
    }),
  );
}

function countUp(target: number, render: (value: number) => void): void {
  const steps = 18;
  for (let i = 1; i <= steps; i += 1) {
    window.setTimeout(() => render(Math.round((target * i) / steps)), i * 35);
  }
}

function hideBooster(): void {
  setBoosterArmed(false);
  boosterButton.classList.add("hidden");
}

function showEndCard(outcome: "win" | "fail" | "time"): void {
  if (ended) return;
  ended = true;
  hideBooster();
  window.setTimeout(() => {
    const won = outcome === "win";
    const stars = starsFor(won, game.movesLeft, game.best);
    endTitle.textContent = won ? `${CONFIG.goal}!` : game.movesLeft <= 0 ? "So close!" : "Nice merging!";
    if (won) {
      countUp(game.score, (value) => {
        endText.textContent = `Score ${value}, ${game.movesLeft} moves to spare`;
      });
    } else {
      endText.textContent = nearMissLine(game.tiles);
    }
    // A teaser of what comes next pulls the player forward, whatever the result.
    teaser.textContent = won ? "Level 2: can you make 256?" : `Reach ${CONFIG.goal} to unlock Level 2`;
    renderStars(stars);
    const canRetry = !won && retriesLeft > 0;
    retryButton.textContent = canRetry ? `TRY AGAIN, +${CONFIG.retryBonusMoves} MOVES` : "TRY AGAIN";
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, stars, best: game.best, score: game.score, movesLeft: game.movesLeft });
  }, END_CARD_DELAY_MS);
}

function startRound(bonusMoves: number): void {
  attempt += 1;
  game = new MergeGame(SEED + attempt - 1, CONFIG.moves + bonusMoves);
  view.setBoard(game.tiles);
  ended = false;
  activeSeconds = 0;
  idleSeconds = 0;
  announcedNearWin = false;
  boosterOffered = false;
  hideBooster();
  marks.classList.remove("reached");
  endCard.classList.remove("show");
  hint.classList.toggle("hidden", hasMoved);
  renderHud();
}

/** Show the juice for one board change. Shared by the player's moves and the demo move. */
function playResult(result: MoveResult, demo: boolean): void {
  view.applyMove(result, game.tiles);

  for (const merge of result.merges) {
    const big = merge.value >= 64;
    window.setTimeout(() => {
      view.burst(merge.row, merge.col, merge.value, big ? 30 : 12 + Math.min(10, Math.log2(merge.value) * 1.5));
      view.ring(merge.row, merge.col, merge.value);
      showPop(`+${merge.value * result.multiplier}`, merge.row, merge.col, big || result.multiplier > 1);
    }, 110);
    if (!demo) mergeChime(merge.value, result.combo, result.multiplier);
  }
  if (result.merges.length > 0) {
    if (!demo) haptic(result.combo >= 2 ? 30 : 14);
    bump(scoreChip);
    view.punch(0.012 + result.combo * 0.006);
    bump(streakBox);
  }
  bump(movesChip);

  if (result.combo >= 2) {
    showToast(`COMBO x${result.combo}`, "gold");
    view.punch(0.04 + result.combo * 0.015);
    if (!demo) track("combo", { count: result.combo });
  }
  const biggest = result.merges.reduce((max, merge) => Math.max(max, merge.value), 0);
  if (biggest >= 64 && result.combo < 2) {
    showToast("HUGE!", "gold");
    view.punch(0.07);
    view.kick();
  }
}

function perform(direction: Direction, demo: boolean): void {
  const before = game.streak;
  const result = game.move(direction, demo);
  if (!result.moved) {
    if (!demo) {
      blockedBuzz();
      haptic(8);
      track("blocked", { direction });
    }
    return;
  }

  lockedUntil = demo ? 0 : performance.now() + 140;
  playResult(result, demo);

  if (!demo && before >= 2 && result.streak === 0) {
    window.setTimeout(() => showToast("STREAK LOST", "red"), 250);
    track("streak_lost", { was: before });
  } else if (result.streak >= 2 && result.multiplier > Math.min(CONFIG.maxMultiplier, 1 + Math.floor(before / 2))) {
    window.setTimeout(() => showToast(`x${result.multiplier} SCORE!`, "gold"), result.combo >= 2 ? 500 : 0);
    track("streak", { count: result.streak, multiplier: result.multiplier });
  }

  if (demo) {
    track("demo_move", { direction, merges: result.merges.length });
  } else {
    track("move", {
      direction,
      merges: result.merges.length,
      best: game.best,
      movesLeft: game.movesLeft,
      streak: result.streak,
    });
  }
  renderHud();

  if (result.milestone) {
    marks.classList.add("reached");
    progress.classList.remove("flash");
    void progress.offsetWidth;
    progress.classList.add("flash");
    if (!demo) milestoneSound();
    track("milestone", { value: CONFIG.goal / 2 });
  }

  const tease = nearWinMessage(game.tiles);
  if (tease && game.outcome === "playing" && (!announcedNearWin || tease === "ONE MERGE TO WIN!")) {
    announcedNearWin = true;
    window.setTimeout(() => showToast(tease, "gold"), result.combo >= 2 || result.merges.some((m) => m.value >= 64) ? 600 : 0);
    track("near_win", { best: game.best });
  }

  if (!demo && game.boosterReady && !boosterOffered) {
    boosterOffered = true;
    boosterButton.classList.remove("hidden");
    track("booster_offered", { movesMade: game.movesMade });
  }

  if (game.outcome === "won") {
    window.setTimeout(() => {
      view.confetti();
      view.punch(0.1);
    }, 200);
    winFanfare();
    haptic(80);
    track("win", { movesLeft: game.movesLeft, score: game.score });
    showEndCard("win");
  } else if (game.outcome === "lost") {
    view.kick();
    loseThud();
    haptic(50);
    track("fail", { reason: game.movesLeft <= 0 ? "moves" : "stuck", best: game.best });
    showEndCard("fail");
  }
}

function move(direction: Direction): void {
  const now = performance.now();
  if (paused || ended || now < lockedUntil) return;
  unlockAudio();
  music.start();

  if (boosterArmed) return;
  if (!hasMoved) {
    hasMoved = true;
    hint.classList.add("hidden");
    window.setTimeout(() => caption.classList.add("gone"), 600);
    track("first_move", { ms: Math.round(now - startedAt) });
  }
  idleSeconds = 0;
  perform(direction, false);
}

/** An automatic first move at about 0.7 s, so the board is never still. Control returns at once. */
function demoMove(): void {
  demoDone = true;
  const direction = demoDirection(game.tiles);
  if (direction) perform(direction, true);
}

function trySmash(clientX: number, clientY: number): void {
  const at = view.cellAt(clientX, clientY);
  const tile = at ? game.smash(at.row, at.col) : null;
  if (tile) {
    view.smash(tile.id, tile.row, tile.col, tile.value);
    smashSound();
    haptic(40);
    track("booster_used", { value: tile.value, movesMade: game.movesMade });
    hideBooster();
    renderHud();
  } else {
    // A tap on an empty cell cancels targeting, so the player is never stuck in it.
    setBoosterArmed(false);
  }
}

function setBoosterArmed(armed: boolean): void {
  boosterArmed = armed;
  view.setTargeting(armed);
  boosterButton.classList.toggle("armed", armed);
  boosterButton.replaceChildren(
    document.createTextNode(armed ? "TAP A TILE" : "FREE SMASH"),
    Object.assign(document.createElement("small"), { textContent: armed ? "IT WILL BE REMOVED" : "REMOVE ANY TILE" }),
  );
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  if (!paused && !ended) {
    activeSeconds += dt;
    idleSeconds += dt;
    if (!hasMoved) {
      if (!demoDone && activeSeconds >= DEMO_MOVE_SECONDS) demoMove();
      if (!nudged && idleSeconds >= IDLE_NUDGE_SECONDS) {
        nudged = true;
        hint.classList.add("nudge");
        track("idle_nudge");
      }
    }
    if (activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
    music.setIntensity(musicLevel());
  }

  if (!paused) view.update(dt);
  view.render();
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  lastFrame = performance.now();
  music.setPaused(value);
  if (value) pauseAudio();
  else if (hasMoved) resumeAudio();
}

function openFrom(origin: "top" | "end_card"): void {
  track("cta_click", { from: origin });
  openStore(CTA_URL);
}

element("install").addEventListener("click", () => openFrom("top"));
element("end-install").addEventListener("click", () => openFrom("end_card"));
retryButton.addEventListener("click", () => {
  retriesLeft -= 1;
  track("retry", { left: retriesLeft, bonusMoves: CONFIG.retryBonusMoves });
  startRound(CONFIG.retryBonusMoves);
});
againButton.addEventListener("click", () => {
  track("replay");
  startRound(0);
});
boosterButton.addEventListener("click", () => {
  unlockAudio();
  music.start();
  setBoosterArmed(!boosterArmed);
});

// One swipe makes one move. The swipe fires as soon as the pointer has travelled far
// enough, so the board answers while the finger is still moving.
let swipe: { x: number; y: number; done: boolean } | null = null;
window.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
  if (boosterArmed && !paused && !ended) {
    trySmash(event.clientX, event.clientY);
    return;
  }
  swipe = { x: event.clientX, y: event.clientY, done: false };
});
window.addEventListener("pointermove", (event) => {
  if (!swipe || swipe.done) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PIXELS) return;
  swipe.done = true;
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
});
window.addEventListener("pointerup", () => {
  swipe = null;
  // Audio may only start inside a user gesture, and a release is one on every browser.
  unlockAudio();
  music.start();
});
window.addEventListener("pointercancel", () => {
  swipe = null;
});

const KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
};
window.addEventListener("keydown", (event) => {
  const direction = KEYS[event.code];
  if (direction) {
    event.preventDefault();
    move(direction);
  }
});

document.addEventListener("visibilitychange", () => setPaused(document.hidden));
onViewableChange((viewable) => setPaused(!viewable));

startRound(0);
whenAdReady(() => {
  startedAt = performance.now();
  track("impression");
  setPaused(false);
});
requestAnimationFrame(frame);
