import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  BATTLE_SECONDS,
  BATTLE_SECONDS_CLOSE,
  BOSS_FINISH_SECONDS,
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
  battleCounts,
  gateLabel,
  generateLevel,
  isCloseFight,
  isPositive,
  starsFor,
  type GameEvent,
} from "./game/rules.ts";
import { createMusic, intensityFor } from "./music.ts";
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
const flash = element("flash");
const chainLabel = element("chain");
const bossBar = element("bossbar");
const barYou = element("bar-you");
const barBoss = element("bar-boss");
const youCount = element("you-n");
const bossCount = element("boss-n");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStats = element("end-stats");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const level = generateLevel(LEVEL_SEED);
const view = new RunView(canvas);
view.buildLevel(level);
const music = createMusic();
const musicReference = Math.max(60, level.enemy * 1.3);

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
let pickups = 0;
let bestChain = 0;
let sawHits = 0;
let lastIntensity = -1;
let heartbeat = 0;

interface Battle {
  t: number;
  player: number;
  enemy: number;
  won: boolean;
  close: boolean;
  seconds: number;
  nextHit: number;
}
let battle: Battle | null = null;
/** Boss animation after the fight: how far it has fallen, and who won. */
let finish = { t: 0, won: false, active: false };

// Sound design: a few synthesized notes per event, so the file carries no audio data.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const goodGate = (): void => tone(note(7), 0.16, "sine", 0.18);
const bigGate = (): void => [0, 4, 7, 12].forEach((s, i) => tone(note(s, 392), 0.18, "sine", 0.16, i * 0.05));
const badGate = (): void => tone(140, 0.28, "sawtooth", 0.12);
const hit = (): void => tone(90 + Math.random() * 60, 0.1, "square", 0.07);
const winFanfare = (): void => [0, 4, 7, 12, 16].forEach((s, i) => tone(note(s), 0.28, "sine", 0.18, i * 0.09));
const failThud = (): void => tone(80, 0.45, "sawtooth", 0.14);
const sawSound = (): void => {
  tone(170, 0.26, "sawtooth", 0.16);
  tone(78, 0.3, "square", 0.1, 0.03);
};
const whoosh = (): void => {
  tone(1300, 0.08, "sine", 0.05);
  tone(760, 0.15, "sine", 0.04, 0.04);
};
const coinSound = (chain: number, recruit: boolean): void => {
  const step = PENTATONIC[Math.min(chain - 1, PENTATONIC.length - 1)] ?? 0;
  tone(note(step, 523.25), 0.11, "triangle", 0.12);
  if (chain >= 5) tone(note(step + 12, 523.25), 0.09, "sine", 0.05, 0.02);
  if (recruit) [0, 4, 7].forEach((s, i) => tone(note(step + s, 784), 0.1, "sine", 0.07, i * 0.04));
};

function showToast(text: string, tone: "" | "gold" | "red" = ""): void {
  toast.textContent = text;
  toast.className = tone;
  // Reading offsetWidth restarts the CSS animation.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, kind: "good" | "bad" | "coin"): void {
  const at = view.screenAboveCrowd();
  const pop = document.createElement("span");
  pop.className = `gate-pop ${kind}`;
  pop.textContent = text;
  // Pickups pop to the side so a fast chain stays readable.
  pop.style.left = `${at.x + (kind === "coin" ? 46 : 0)}px`;
  pop.style.top = `${at.y}px`;
  pops.appendChild(pop);
  window.setTimeout(() => pop.remove(), 1000);
}

function flashScreen(kind: "red" | "white" | "gold"): void {
  flash.className = kind;
  void flash.offsetWidth;
  flash.classList.add("go");
}

function bumpCount(): void {
  countLabel.classList.add("bump");
  window.setTimeout(() => countLabel.classList.remove("bump"), 140);
}

function showChain(chain: number): void {
  if (chain < 2) {
    chainLabel.classList.remove("show");
    return;
  }
  chainLabel.textContent = `CHAIN x${chain}`;
  chainLabel.classList.remove("show");
  void chainLabel.offsetWidth;
  chainLabel.classList.add("show");
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

function setBossBar(player: number, enemy: number): void {
  const total = player + enemy;
  const share = total > 0 ? player / total : 0.5;
  barYou.style.flexGrow = String(Math.max(0.001, share));
  barBoss.style.flexGrow = String(Math.max(0.001, 1 - share));
  youCount.textContent = String(Math.max(0, Math.round(player)));
  bossCount.textContent = String(Math.max(0, Math.round(enemy)));
}

function showEndCard(outcome: "win" | "fail" | "time"): void {
  if (ended) return;
  ended = true;
  music.setLevel(0.45);
  window.setTimeout(() => {
    bossBar.classList.remove("show");
    const won = outcome === "win";
    const remaining = won ? Math.max(0, countAtBoss - level.enemy) : 0;
    const stars = starsFor(won, remaining, countAtBoss);
    endTitle.textContent = won ? "You crushed it!" : outcome === "fail" ? "So close!" : "Nice run!";
    endText.textContent = won ? `${remaining} survivors` : `Crowd ${countAtBoss || game.count} vs ${level.enemy}`;
    endStats.textContent = pickups > 0 ? `${pickups} pickups, best chain x${bestChain}` : "";
    // A teaser of what comes next pulls the player forward, whatever the result.
    teaser.textContent = won ? "Level 2: a boss three times bigger" : "Beat the boss to unlock Level 2";
    renderStars(stars);
    const canRetry = !won && retriesLeft > 0;
    retryButton.textContent = canRetry ? `TRY AGAIN, +${RETRY_BONUS} CROWD` : "TRY AGAIN";
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, stars, crowd: game.count, enemy: level.enemy, pickups, best_chain: bestChain, saw_hits: sawHits });
  }, END_CARD_DELAY_MS);
}

function startRound(bonus: number): void {
  game = new RunGame(level, level.startCount + bonus);
  shown = game.count;
  steer = 0;
  battle = null;
  finish = { t: 0, won: false, active: false };
  ended = false;
  activeSeconds = 0;
  idleSeconds = 0;
  countAtBoss = 0;
  pickups = 0;
  bestChain = 0;
  sawHits = 0;
  heartbeat = 0;
  view.reset();
  endCard.classList.remove("show");
  bossBar.classList.remove("show", "close");
  chainLabel.classList.remove("show");
  music.setLevel(1);
  hint.classList.toggle("hidden", hasInput);
  fill.style.transform = "scaleX(0)";
}

function handle(event: GameEvent): void {
  if (event.type === "gate") {
    const positive = isPositive(event.gate);
    view.passRow(event.row);
    const crowd = view.crowdPosition();
    view.burst(crowd.x, crowd.z, positive ? 0x6dd5ff : 0xff6b7b, positive ? 16 : 10);
    view.shockwave(crowd.x, crowd.z + 0.5, positive ? 0x6dd5ff : 0xff6b7b, positive ? 5 : 3);
    showPop(gateLabel(event.gate), positive ? "good" : "bad");
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
    if (event.row === level.rows.length - 1 && event.after > 0) showToast("BOSS AHEAD", "red");
  } else if (event.type === "pickup") {
    const index = level.pickups?.indexOf(event.pickup) ?? -1;
    view.collectPickup(index);
    const crowd = view.crowdPosition();
    view.burst(event.pickup.x * 3.2, event.pickup.z, event.pickup.kind === "coin" ? 0xffd23f : 0x66f0ff, 6, 0.6);
    pickups += 1;
    bestChain = Math.max(bestChain, event.chain);
    coinSound(event.chain, event.pickup.kind === "recruit");
    haptic(event.bonus > 0 ? 18 : 6);
    showPop(`+${event.value}`, "coin");
    showChain(event.chain);
    bumpCount();
    if (event.bonus > 0) {
      view.shockwave(crowd.x, crowd.z, 0xffd23f, 4);
      view.kickFov(5);
      track("chain_bonus", { chain: event.chain });
    }
    track("pickup", { kind: event.pickup.kind, value: event.value, chain: event.chain });
  } else if (event.type === "chainBreak") {
    showChain(0);
    track("chain_break", { chain: event.chain });
  } else if (event.type === "saw") {
    view.hitSaw(level.saws?.indexOf(event.saw) ?? -1);
    const crowd = view.crowdPosition();
    view.burst(crowd.x, crowd.z, 0xff4458, 18);
    view.shockwave(crowd.x, crowd.z, 0xff4458, 3);
    view.kick(0.7);
    flashScreen("red");
    sawSound();
    haptic(40);
    showPop(`-${event.loss}`, "bad");
    bumpCount();
    sawHits += 1;
    showChain(0);
    track("saw_hit", { loss: event.loss, before: event.before, after: event.after });
  } else if (event.type === "nearMiss") {
    whoosh();
    haptic(8);
    view.kickFov(5);
    showToast("CLOSE!", "gold");
    track("near_miss");
  } else if (event.type === "halfway") {
    // Pattern interrupt at the halfway arch: a speed boost, a field-of-view kick and a chord.
    showToast("HALFWAY! SPEED UP", "gold");
    view.kickFov(13);
    flashScreen("gold");
    [0, 4, 7, 12, 16].forEach((step, i) => tone(note(step, 392), 0.22, "sine", 0.14, i * 0.05));
    haptic(30);
    track("milestone", { name: "halfway", z: Math.round(event.z) });
    track("speed_boost", { multiplier: 1.4 });
  } else if (event.type === "boss") {
    countAtBoss = event.count;
    const close = isCloseFight(event.count, event.enemy);
    track("boss_start", { crowd: event.count, enemy: event.enemy, close });
    battle = {
      t: 0,
      player: event.count,
      enemy: event.enemy,
      won: event.won,
      close,
      seconds: close ? BATTLE_SECONDS_CLOSE : BATTLE_SECONDS,
      nextHit: 0,
    };
    bossBar.classList.add("show");
    bossBar.classList.toggle("close", close);
    showToast(close ? "BOSS FIGHT: TOO CLOSE!" : "BOSS FIGHT", "red");
    [70, 62, 55].forEach((f, i) => tone(f, 0.35, "sine", 0.22, i * 0.16));
    view.kick(0.6);
    haptic(50);
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

/** Slow the last stretch of a narrow fight so the player feels it hang in the balance. */
function fightProgress(t: number, close: boolean): number {
  if (!close) return t * t * (3 - 2 * t);
  if (t < 0.55) return (t / 0.55) * 0.72;
  return 0.72 + ((t - 0.55) / 0.45) ** 1.6 * 0.28;
}

function stepBattle(dt: number): void {
  if (!battle) return;
  battle.t = Math.min(1, battle.t + dt / battle.seconds);
  const u = fightProgress(battle.t, battle.close);
  const state = battleCounts(battle.player, battle.enemy, u);
  shown = state.player;
  setBossBar(state.player, state.enemy);

  battle.nextHit -= dt;
  const slow = battle.close && battle.t > 0.55 && battle.t < 1;
  if (battle.nextHit <= 0 && battle.t < 1) {
    battle.nextHit = slow ? 0.22 : 0.1;
    view.burst((Math.random() - 0.5) * 3, level.bossZ + 5, Math.random() < 0.5 ? 0x6dd5ff : 0xff6b7b, slow ? 10 : 6, 1.4);
    view.flashBoss();
    view.kick(slow ? 0.45 : 0.18);
    hit();
    haptic(slow ? 14 : 8);
  }
  if (slow) {
    heartbeat -= dt;
    if (heartbeat <= 0) {
      heartbeat = 0.42;
      tone(58, 0.18, "sine", 0.3);
      tone(52, 0.2, "sine", 0.25, 0.13);
    }
  }

  if (battle.t >= 1) {
    const won = battle.won;
    battle = null;
    finish = { t: 0, won, active: true };
    if (won) {
      view.burst(0, level.bossZ + 8, 0xffe14d, 70, 3);
      view.shockwave(0, level.bossZ + 8, 0xffe14d, 9);
      view.kickFov(14);
      flashScreen("gold");
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
    if (hasInput) activeSeconds += dt;
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
      if (hasInput && activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
    } else {
      stepBattle(dt);
    }
    fill.style.transform = `scaleX(${game.progress})`;
  }
  if (!paused && finish.active) finish.t = Math.min(1, finish.t + dt / BOSS_FINISH_SECONDS);

  const blend = battle ? Math.min(1, battle.t * 3) : finish.active ? 1 : 0;
  const crowdZ = game.phase === "run" ? game.z : level.bossZ + blend * 3.5;
  view.setPlayer(game.x, crowdZ, Math.max(0, Math.round(shown)));
  view.setBoost(game.phase === "run" ? Math.min(1, game.boost / 1.4) : 0);
  view.setBoss(battle ? 1 : 0, finish.active && finish.won ? finish.t : 0, finish.active && !finish.won, blend);
  view.setFocus(blend);
  if (!paused) view.update(dt);
  view.render();

  const intensity = battle || finish.active ? 1 : intensityFor(shown, musicReference);
  if (Math.abs(intensity - lastIntensity) > 0.02) {
    lastIntensity = intensity;
    music.setIntensity(intensity);
  }

  const at = view.screenAboveCrowd();
  countLabel.textContent = String(Math.max(0, Math.round(shown)));
  countLabel.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  lastFrame = performance.now();
  if (value) music.pause();
  else if (hasInput) music.resume();
}

function openFrom(origin: "top" | "end_card"): void {
  track("cta_click", { from: origin });
  openStore(CTA_URL);
}

function firstInput(): void {
  if (hasInput) return;
  hasInput = true;
  hint.classList.add("hidden");
  unlockAudio();
  music.start();
  window.setTimeout(() => caption.classList.add("gone"), 700);
  track("first_input", { ms: Math.round(performance.now() - startedAt) });
}

function steerFrom(clientX: number): void {
  steer = Math.max(-1, Math.min(1, ((clientX / window.innerWidth) * 2 - 1) * 1.15));
  firstInput();
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
  if (event.code.startsWith("Arrow") || event.code === "KeyA" || event.code === "KeyD") firstInput();
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
