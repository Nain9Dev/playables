import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  BATTLE_SECONDS,
  CTA_URL,
  END_CARD_DELAY_MS,
  IDLE_NUDGE_SECONDS,
  LEVEL_SEED,
  MAX_ACTIVE_SECONDS,
  RETRIES,
  RETRY_BONUS,
} from "./config.ts";
import {
  RunGame,
  gateLabel,
  generateLevel,
  isPositive,
  starsFor,
  type GameEvent,
} from "./game/rules.ts";
import { RunView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const countLabel = element("count");
const toast = element("toast");
const hint = element("hint");
const caption = element("caption");
const fill = element("fill");
const pops = element("pops");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const level = generateLevel(LEVEL_SEED);
const view = new RunView(canvas);
view.buildLevel(level);

let game = new RunGame(level);
let steer = 0;
let shown = game.count;
let paused = true;
let ended = false;
let lastFrame = 0;
let startedAt = 0;
let activeSeconds = 0;
let idleSeconds = 0;
let hasInput = false;
let nudged = false;
let retriesLeft = RETRIES;
let countAtBoss = 0;

interface Battle {
  t: number;
  startPlayer: number;
  startEnemy: number;
  endPlayer: number;
  endEnemy: number;
  won: boolean;
  nextSpark: number;
}
let battle: Battle | null = null;

// Sound design: a few synthesized notes per event, so the file carries no audio data.
const goodGate = (): void => tone(note(7), 0.16, "sine", 0.18);
const bigGate = (): void => [0, 4, 7, 12].forEach((s, i) => tone(note(s, 392), 0.18, "sine", 0.16, i * 0.05));
const badGate = (): void => tone(140, 0.28, "sawtooth", 0.12);
const hit = (): void => tone(90 + Math.random() * 60, 0.1, "square", 0.07);
const winFanfare = (): void => [0, 4, 7, 12, 16].forEach((s, i) => tone(note(s), 0.28, "sine", 0.18, i * 0.09));
const failThud = (): void => tone(80, 0.45, "sawtooth", 0.14);

function showToast(text: string, tone: "" | "gold" | "red" = ""): void {
  toast.textContent = text;
  toast.className = tone;
  // Reading offsetWidth restarts the CSS animation.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, good: boolean): void {
  const at = view.screenAboveCrowd();
  const pop = document.createElement("span");
  pop.className = `gate-pop ${good ? "good" : "bad"}`;
  pop.textContent = text;
  pop.style.left = `${at.x}px`;
  pop.style.top = `${at.y}px`;
  pops.appendChild(pop);
  window.setTimeout(() => pop.remove(), 1000);
}

function bumpCount(): void {
  countLabel.classList.add("bump");
  window.setTimeout(() => countLabel.classList.remove("bump"), 140);
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
    const remaining = won ? Math.max(0, countAtBoss - level.enemy) : 0;
    const stars = starsFor(won, remaining, countAtBoss);
    endTitle.textContent = won ? "You crushed it!" : outcome === "fail" ? "So close!" : "Nice run!";
    endText.textContent = won ? `${remaining} survivors` : `Crowd ${game.count} vs ${level.enemy}`;
    // A teaser of what comes next pulls the player forward, whatever the result.
    teaser.textContent = won ? "Level 2: a boss three times bigger" : "Beat the boss to unlock Level 2";
    renderStars(stars);
    const canRetry = !won && retriesLeft > 0;
    retryButton.textContent = canRetry ? `TRY AGAIN, +${RETRY_BONUS} CROWD` : "TRY AGAIN";
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, stars, crowd: game.count, enemy: level.enemy });
  }, END_CARD_DELAY_MS);
}

function startRound(bonus: number): void {
  game = new RunGame(level, level.startCount + bonus);
  shown = game.count;
  steer = 0;
  battle = null;
  ended = false;
  activeSeconds = 0;
  idleSeconds = 0;
  countAtBoss = 0;
  view.reset();
  view.setEnemy(false, 0);
  endCard.classList.remove("show");
  hint.classList.toggle("hidden", hasInput);
  fill.style.transform = "scaleX(0)";
}

function handle(event: GameEvent): void {
  if (event.type === "gate") {
    const positive = isPositive(event.gate);
    view.passRow(event.row);
    const crowd = view.crowdPosition();
    view.burst(crowd.x, crowd.z, positive ? 0x6dd5ff : 0xff6b7b, positive ? 16 : 10);
    showPop(gateLabel(event.gate), positive);
    bumpCount();
    haptic(positive ? 14 : 35);
    if (positive && event.after >= event.before * 1.8) {
      view.kickFov(11);
      bigGate();
    } else if (positive) {
      goodGate();
    } else {
      badGate();
      view.kick();
    }
    track("gate", {
      row: event.row,
      op: event.gate.op,
      value: event.gate.value,
      before: event.before,
      after: event.after,
    });
    if (!positive) track("bad_gate", { row: event.row });
    // Pattern interrupt at the halfway row: a burst, a field-of-view kick and a chord.
    if (event.row === Math.floor(level.rows.length / 2) - 1 && event.after > 0) {
      showToast("HALFWAY!", "gold");
      view.kickFov(13);
      [0, 4, 7].forEach((step, i) => tone(note(step, 392), 0.25, "sine", 0.14, i * 0.06));
      track("milestone", { name: "halfway", row: event.row });
    }
    if (event.row === level.rows.length - 1 && event.after > 0) showToast("BOSS AHEAD", "red");
  } else if (event.type === "boss") {
    countAtBoss = event.count;
    track("boss_start", { crowd: event.count, enemy: event.enemy });
    view.setEnemy(true, event.enemy);
    battle = {
      t: 0,
      startPlayer: event.count,
      startEnemy: event.enemy,
      endPlayer: event.won ? event.remaining : 0,
      endEnemy: event.won ? 0 : event.enemy - event.count,
      won: event.won,
      nextSpark: 0,
    };
  } else if (event.reason === "crowd") {
    view.kick();
    failThud();
    haptic(60);
    track("fail", { reason: "crowd" });
    showEndCard("fail");
  } else {
    track("fail", { reason: "boss" });
  }
}

function stepBattle(dt: number): void {
  if (!battle) return;
  battle.t = Math.min(1, battle.t + dt / BATTLE_SECONDS);
  const eased = battle.t * battle.t * (3 - 2 * battle.t);
  shown = battle.startPlayer + (battle.endPlayer - battle.startPlayer) * eased;
  view.setEnemy(true, Math.round(battle.startEnemy + (battle.endEnemy - battle.startEnemy) * eased));

  battle.nextSpark -= dt;
  if (battle.nextSpark <= 0 && battle.t < 1) {
    battle.nextSpark = 0.1;
    view.burst((Math.random() - 0.5) * 3, level.bossZ + 3, Math.random() < 0.5 ? 0x6dd5ff : 0xff6b7b, 6);
    hit();
    haptic(8);
  }

  if (battle.t >= 1) {
    const won = battle.won;
    battle = null;
    if (won) {
      view.burst(0, level.bossZ + 4, 0xffe14d, 60);
      view.kickFov(14);
      winFanfare();
      haptic(80);
      track("win", { survivors: Math.max(0, countAtBoss - level.enemy) });
      showEndCard("win");
    } else {
      view.kick();
      failThud();
      showEndCard("fail");
    }
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  if (!paused && !ended) {
    activeSeconds += dt;
    if (game.phase === "run") {
      for (const event of game.update(dt, steer)) handle(event);
      shown += (game.count - shown) * Math.min(1, dt * 10);
      if (!hasInput) {
        idleSeconds += dt;
        if (!nudged && idleSeconds >= IDLE_NUDGE_SECONDS) {
          nudged = true;
          hint.classList.add("nudge");
          track("idle_nudge");
        }
      }
      if (activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
    } else {
      stepBattle(dt);
    }
    fill.style.transform = `scaleX(${game.progress})`;
  }

  const crowdZ = battle ? level.bossZ + battle.t * 3.5 : game.z;
  view.setPlayer(game.x, crowdZ, Math.max(0, Math.round(shown)));
  if (!paused) view.update(dt);
  view.render();

  const at = view.screenAboveCrowd();
  countLabel.textContent = String(Math.max(0, Math.round(shown)));
  countLabel.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
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

function steerFrom(clientX: number): void {
  steer = Math.max(-1, Math.min(1, ((clientX / window.innerWidth) * 2 - 1) * 1.15));
  if (!hasInput) {
    hasInput = true;
    hint.classList.add("hidden");
    unlockAudio();
    window.setTimeout(() => caption.classList.add("gone"), 700);
    track("first_input", { ms: Math.round(performance.now() - startedAt) });
  }
  idleSeconds = 0;
}

element("install").addEventListener("click", () => openFrom("top"));
element("end-install").addEventListener("click", () => openFrom("end_card"));
retryButton.addEventListener("click", () => {
  retriesLeft -= 1;
  track("retry", { left: retriesLeft, bonus: RETRY_BONUS });
  startRound(RETRY_BONUS);
});
againButton.addEventListener("click", () => {
  track("replay");
  startRound(0);
});

// Touch and pen steer while pressed. A mouse steers on hover, since a desktop
// visitor has no finger to hold down. Buttons and the end card never steer.
window.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
  steerFrom(event.clientX);
});
window.addEventListener("pointermove", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
  if (event.pointerType === "mouse" || event.buttons > 0) steerFrom(event.clientX);
});
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") steer = -1;
  if (event.code === "ArrowRight" || event.code === "KeyD") steer = 1;
  if (event.code.startsWith("Arrow") || event.code === "KeyA" || event.code === "KeyD") {
    if (!hasInput) {
      hasInput = true;
      hint.classList.add("hidden");
      unlockAudio();
      track("first_input", { ms: Math.round(performance.now() - startedAt) });
    }
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
