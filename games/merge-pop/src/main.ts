import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  CTA_URL,
  END_CARD_DELAY_MS,
  IDLE_NUDGE_SECONDS,
  MAX_ACTIVE_SECONDS,
  RETRIES,
  SEED,
  SWIPE_PIXELS,
} from "./config.ts";
import { CONFIG, MergeGame, nearWinMessage, starsFor, type Direction } from "./game/rules.ts";
import { MergeView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const caption = element("caption");
const hint = element("hint");
const fill = element("fill");
const scoreText = element("score");
const movesText = element("moves");
const scoreChip = element("score-chip");
const movesChip = element("moves-chip");
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
let attempt = 0;
let game = new MergeGame(SEED);
let paused = true;
let ended = false;
let lastFrame = 0;
let startedAt = 0;
let activeSeconds = 0;
let idleSeconds = 0;
let hasMoved = false;
let nudged = false;
let retriesLeft = RETRIES;
let lockedUntil = 0;
let announcedNearWin = false;

// Sound design: a few synthesized notes per event, so the file carries no audio data.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19];
function mergeChime(value: number, combo: number): void {
  const step = SCALE[Math.min(SCALE.length - 1, Math.max(0, Math.log2(value) - 2))] ?? 0;
  tone(note(step, 440), 0.2, "sine", 0.17);
  if (combo >= 2) tone(note(step + 12, 440), 0.25, "sine", 0.09, 0.05);
}
const blockedBuzz = (): void => tone(120, 0.12, "square", 0.06);
const winFanfare = (): void => [0, 4, 7, 12, 16].forEach((s, i) => tone(note(s), 0.28, "sine", 0.18, i * 0.09));
const loseThud = (): void => tone(85, 0.4, "sawtooth", 0.13);

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

function showEndCard(outcome: "win" | "fail" | "time"): void {
  if (ended) return;
  ended = true;
  window.setTimeout(() => {
    const won = outcome === "win";
    const stars = starsFor(won, game.movesLeft, game.best);
    endTitle.textContent = won ? `${CONFIG.goal}!` : game.movesLeft <= 0 ? "So close!" : "Nice merging!";
    endText.textContent = won
      ? `Score ${game.score}, ${game.movesLeft} moves to spare`
      : `Best tile ${game.best}, goal ${CONFIG.goal}`;
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
  endCard.classList.remove("show");
  hint.classList.toggle("hidden", hasMoved);
  renderHud();
}

function move(direction: Direction): void {
  const now = performance.now();
  if (paused || ended || now < lockedUntil) return;
  unlockAudio();

  if (!hasMoved) {
    hasMoved = true;
    hint.classList.add("hidden");
    window.setTimeout(() => caption.classList.add("gone"), 600);
    track("first_move", { ms: Math.round(now - startedAt) });
  }
  idleSeconds = 0;

  const result = game.move(direction);
  if (!result.moved) {
    blockedBuzz();
    haptic(8);
    track("blocked", { direction });
    return;
  }

  lockedUntil = now + 140;
  view.applyMove(result, game.tiles);

  for (const merge of result.merges) {
    const big = merge.value >= 64;
    window.setTimeout(() => {
      view.burst(merge.row, merge.col, merge.value, big ? 26 : 12);
      showPop(`+${merge.value}`, merge.row, merge.col, big);
    }, 110);
    mergeChime(merge.value, result.combo);
  }
  if (result.merges.length > 0) {
    haptic(result.combo >= 2 ? 30 : 14);
    bump(scoreChip);
  }
  bump(movesChip);

  if (result.combo >= 2) {
    showToast(`COMBO x${result.combo}`, "gold");
    view.punch(0.04 + result.combo * 0.015);
    track("combo", { count: result.combo });
  }
  const biggest = result.merges.reduce((max, merge) => Math.max(max, merge.value), 0);
  if (biggest >= 64 && result.combo < 2) {
    showToast("HUGE!", "gold");
    view.punch(0.07);
    view.kick();
  }

  track("move", {
    direction,
    merges: result.merges.length,
    best: game.best,
    movesLeft: game.movesLeft,
  });
  renderHud();

  const tease = nearWinMessage(game.tiles);
  if (tease && game.outcome === "playing" && (!announcedNearWin || tease === "ONE MERGE TO WIN!")) {
    announcedNearWin = true;
    window.setTimeout(() => showToast(tease, "gold"), result.combo >= 2 || biggest >= 64 ? 600 : 0);
    track("near_win", { best: game.best });
  }

  if (game.outcome === "won") {
    window.setTimeout(() => {
      for (let i = 0; i < 6; i += 1) {
        view.burst(Math.floor(Math.random() * 4), Math.floor(Math.random() * 4), CONFIG.goal, 20);
      }
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

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  if (!paused && !ended) {
    activeSeconds += dt;
    if (!hasMoved) {
      idleSeconds += dt;
      if (!nudged && idleSeconds >= IDLE_NUDGE_SECONDS) {
        nudged = true;
        hint.classList.add("nudge");
        track("idle_nudge");
      }
    }
    if (activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
  }

  if (!paused) view.update(dt);
  view.render();
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  lastFrame = performance.now();
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

// One swipe makes one move. The swipe fires as soon as the pointer has travelled far
// enough, so the board answers while the finger is still moving.
let swipe: { x: number; y: number; done: boolean } | null = null;
window.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
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
