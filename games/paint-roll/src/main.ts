import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  CTA_URL,
  DEMO_MOVE_SECONDS,
  END_CARD_DELAY_MS,
  IDLE_NUDGE_SECONDS,
  MAX_ACTIVE_SECONDS,
  RETRIES,
  RETRY_BONUS_MOVES,
  SEED,
  SWIPE_PIXELS,
} from "./config.ts";
import { PaintGame, generateLevel, nearWinMessage, starsFor, type Direction } from "./game/rules.ts";
import { createMusic } from "./music.ts";
import { PaintView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const caption = element("caption");
const fill = element("fill");
const pctText = element("pct");
const movesText = element("moves");
const pctChip = element("pct-chip");
const movesChip = element("moves-chip");
const toast = element("toast");
const pops = element("pops");
const hint = element("hint");
const soundButton = element("sound");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const level = generateLevel(SEED);
const view = new PaintView(canvas);
view.setLevel(level);
const music = createMusic();

let game = new PaintGame(level);
let paused = true;
let ended = false;
let lastFrame = 0;
let startedAt = 0;
let activeSeconds = 0;
let introSeconds = 0;
let idleSeconds = 0;
let hasMoved = false;
let demoDone = false;
let nudged = false;
let retriesLeft = RETRIES;
let lastNearWin = "";
let sfxMuted = false;

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
function paintNote(index: number): void {
  if (sfxMuted) return;
  const step = SCALE[Math.min(SCALE.length - 1, index)] ?? 0;
  tone(note(step, 440), 0.12, "triangle", 0.13);
}
const wallThud = (): void => { if (!sfxMuted) tone(150, 0.09, "sine", 0.12); };
const blockedBuzz = (): void => { if (!sfxMuted) tone(110, 0.1, "square", 0.05); };
const starChime = (): void => {
  if (sfxMuted) return;
  [0, 4, 7, 12].forEach((s, i) => tone(note(s, 587.33), 0.2, "sine", 0.14, i * 0.045));
};
const milestoneChord = (): void => {
  if (sfxMuted) return;
  [0, 4, 7, 12].forEach((s, i) => tone(note(s, 392), 0.24, "triangle", 0.14, i * 0.06));
};
const winFanfare = (): void => {
  if (sfxMuted) return;
  [0, 4, 7, 12, 16, 19].forEach((s, i) => tone(note(s), 0.28, "sine", 0.16, i * 0.08));
};
const loseThud = (): void => { if (!sfxMuted) tone(85, 0.36, "sawtooth", 0.12); };

function showToast(text: string, tint: "" | "gold" | "red" = ""): void {
  toast.textContent = text;
  toast.className = tint;
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, r: number, c: number, big = false): void {
  const at = view.screenOf({ r, c });
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
  const pct = Math.round(game.progress * 100);
  pctText.textContent = `${pct}%`;
  movesText.textContent = String(game.movesLeft);
  movesChip.classList.toggle("urgent", game.movesLeft <= 3 && game.outcome === "playing");
  fill.style.transform = `scaleX(${Math.max(0.05, game.progress)})`;
  view.setRemaining(game.remaining);
  music.setIntensity(pct >= 80 ? 3 : pct >= 50 ? 2 : pct >= 20 ? 1 : 0);
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
    const stars = starsFor(won, game.movesLeft, game.progress);
    const pct = Math.round(game.progress * 100);
    endTitle.textContent = won ? "Painted!" : pct >= 80 ? "So close!" : "Out of moves!";
    endText.textContent = won
      ? `${game.score} pts, ${game.movesLeft} ${game.movesLeft === 1 ? "move" : "moves"} left`
      : `${pct}% painted (${game.remaining} ${game.remaining === 1 ? "tile" : "tiles"} left)`;
    teaser.textContent = won ? "Level 2: giant neon maze" : "Paint every tile to unlock Level 2";
    renderStars(stars);
    const canRetry = !won && retriesLeft > 0;
    retryButton.textContent = canRetry ? `TRY AGAIN, +${RETRY_BONUS_MOVES} MOVES` : "TRY AGAIN";
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, stars, pct, score: game.score, movesLeft: game.movesLeft });
  }, END_CARD_DELAY_MS);
}

function startRound(bonusMoves: number): void {
  game = new PaintGame(level, bonusMoves);
  view.reset(level.start);
  ended = false;
  activeSeconds = 0;
  introSeconds = 0;
  idleSeconds = 0;
  lastNearWin = "";
  endCard.classList.remove("show");
  hint.classList.toggle("hidden", hasMoved);
  renderHud();
}

function perform(dir: Direction, demo: boolean): void {
  if (view.animating) return;
  const result = game.slide(dir, demo);
  if (!result.moved) {
    if (!demo) {
      blockedBuzz();
      haptic(8);
      track("blocked", { direction: dir });
    }
    return;
  }

  let paintedIndex = 0;
  const freshSet = new Set(result.newlyPainted.map((c) => `${c.r},${c.c}`));
  const starSet = new Set(result.starsHit.map((c) => `${c.r},${c.c}`));

  view.animateSlide(
    result.from,
    result.path,
    (stepIdx) => {
      const cell = result.path[stepIdx];
      if (!cell) return;
      const key = `${cell.r},${cell.c}`;
      if (freshSet.has(key)) {
        view.markPainted(cell);
        if (!demo) paintNote(paintedIndex);
        paintedIndex += 1;
      }
      if (starSet.has(key)) {
        view.collectStar(cell);
        if (!demo) {
          starChime();
          haptic(22);
        }
        showPop("+50", cell.r, cell.c, true);
      }
    },
    () => {
      if (!demo) {
        wallThud();
        haptic(result.newlyPainted.length >= 4 ? 18 : 10);
      }
      if (result.newlyPainted.length > 0) bump(pctChip);
      bump(movesChip);
      renderHud();

      if (demo) {
        track("demo_move", { direction: dir, painted: result.newlyPainted.length });
      } else {
        track("swipe", {
          direction: dir,
          painted: result.newlyPainted.length,
          stars: result.starsHit.length,
          remaining: result.remaining,
          movesLeft: result.movesLeft,
        });
      }

      if (result.milestone && result.outcome === "playing") {
        showToast("HALFWAY!", "gold");
        view.punch(0.08);
        view.ring(0, 0, 0xffe14d, 4.2);
        if (!demo) {
          milestoneChord();
          haptic(30);
        }
        track("milestone", { pct: Math.round(game.progress * 100) });
      } else if (result.newlyPainted.length >= 4 && result.outcome === "playing") {
        showToast(`SPLASH x${result.newlyPainted.length}!`, "gold");
        view.punch(0.05);
      }

      if (result.outcome === "won") {
        view.confetti();
        view.punch(0.1);
        winFanfare();
        haptic(70);
        track("win", { movesLeft: result.movesLeft, score: game.score });
        showEndCard("win");
        return;
      }
      if (result.outcome === "lost") {
        view.kick(0.5);
        loseThud();
        haptic(50);
        track("fail", { remaining: result.remaining });
        showEndCard("fail");
        return;
      }

      const tease = nearWinMessage(result.remaining, result.movesLeft);
      if (tease && tease !== lastNearWin && !result.milestone) {
        lastNearWin = tease;
        showToast(tease, tease.endsWith("LEFT") ? "red" : "gold");
        track("near_win", { message: tease, remaining: result.remaining });
      }
    },
  );
}

function swipeDir(dir: Direction): void {
  if (paused || ended || view.animating) return;
  unlockAudio();
  music.start();
  if (!hasMoved) {
    hasMoved = true;
    hint.classList.add("hidden");
    window.setTimeout(() => caption.classList.add("gone"), 500);
    track("first_swipe", { ms: Math.round(performance.now() - startedAt) });
  }
  idleSeconds = 0;
  perform(dir, false);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  if (!paused && !ended) {
    if (hasMoved) activeSeconds += dt;
    else introSeconds += dt;
    idleSeconds += dt;
    if (!hasMoved) {
      if (!demoDone && introSeconds >= DEMO_MOVE_SECONDS) {
        demoDone = true;
        const dir = game.hintDirection();
        if (dir) perform(dir, true);
      }
      if (!nudged && idleSeconds >= IDLE_NUDGE_SECONDS) {
        nudged = true;
        hint.classList.add("nudge");
        track("idle_nudge");
      }
    }
    if (hasMoved && activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
  }

  if (!paused) view.update(dt);
  view.render();
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  lastFrame = performance.now();
  if (value) music.pause();
  else if (hasMoved) music.resume();
}

function openFrom(origin: "top" | "end_card"): void {
  track("cta_click", { from: origin });
  openStore(CTA_URL);
}

element("install").addEventListener("click", () => openFrom("top"));
element("end-install").addEventListener("click", () => openFrom("end_card"));
retryButton.addEventListener("click", () => {
  retriesLeft -= 1;
  track("retry", { left: retriesLeft, bonusMoves: RETRY_BONUS_MOVES });
  startRound(RETRY_BONUS_MOVES);
});
againButton.addEventListener("click", () => {
  track("replay");
  startRound(0);
});
soundButton.addEventListener("click", () => {
  unlockAudio();
  music.start();
  sfxMuted = !sfxMuted;
  music.setMuted(sfxMuted);
  soundButton.classList.toggle("muted", sfxMuted);
});

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
  swipeDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
});
window.addEventListener("pointerup", () => { swipe = null; });
window.addEventListener("pointercancel", () => { swipe = null; });

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
  const dir = KEYS[event.code];
  if (dir) {
    event.preventDefault();
    swipeDir(dir);
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
