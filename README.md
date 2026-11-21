# Playables

[![CI](https://github.com/Nain9Dev/playables/actions/workflows/ci.yml/badge.svg)](https://github.com/Nain9Dev/playables/actions/workflows/ci.yml)
[![Play](https://img.shields.io/badge/Play-playables.naindev.com-0047AB?style=flat-square)](https://playables.naindev.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational)](LICENSE)

A portfolio of **single-file HTML5 playable ads** built with Three.js. Each one is tuned for the first five seconds, instrumented for retention, and **verified against ad-network specs before it ships**. The build fails if a playable breaks a rule, so the site only ever publishes files that pass.

**Portfolio: https://playables.naindev.com/**

## What is in here

| Path | What it is |
| :--- | :--- |
| `games/<slug>/` | One playable: `index.html`, `src/`, `playable.json` (metadata) and `poster.jpg` |
| `kit/` | Shared by every playable: MRAID 2.0 adapter, Web Audio helpers, telemetry, and the fail-closed validator |
| `site/` | The portfolio generator: metadata parser, pure HTML renderers, CSS and JS |
| `scripts/` | Build the games, build the site, serve it locally |
| `tests/` | Rules, MRAID adapter, validator, telemetry and site renderers |

## Playables

| Playable | Mechanic | Size | Spec |
| :--- | :--- | :--- | :--- |
| [Stack Tower](games/stack-tower) | Timing. Tap to drop a swinging block, the overhang is cut off | about 537 KB | 7 of 7 rules |
| [Crowd Rush](games/crowd-rush) | Gate runner. Steer through math gates to grow a crowd, then beat a boss crowd | about 543 KB | 7 of 7 rules |
| [Merge Pop](games/merge-pop) | Puzzle. Swipe to merge tiles and reach 128 in 24 moves | about 540 KB | 7 of 7 rules |

Each playable has its own breakdown page with the hook, the core loop, a table of retention levers, a live telemetry panel and the real spec verdict.

## The spec check

`kit/validate.ts` is a pure function: the same file in, the same verdict out. A rule that cannot run counts as a failure. Rules come from public network specs (AppLovin: one HTML file under 5 MB and MRAID 2.0. Meta: a single HTML file under 2 MB).

| Rule | Severity |
| :--- | :--- |
| File under 5 MB | error |
| File under 2 MB | warning |
| No external script, stylesheet, image or iframe | error |
| No `fetch`, `XMLHttpRequest`, `WebSocket` or beacon | error |
| Waits for MRAID `ready` and `viewableChange` | error |
| Store opens with `mraid.open`, never by redirect | error |
| Viewport meta tag present | error |
| Complete HTML document | error |

On the first build it caught a real bug: Vite injects a module-preload polyfill that calls `fetch()`. `build.modulePreload: false` fixed it.

## Retention scorecard

Every playable scores itself on twelve principles taken from short-video feeds (`site/principles.ts`): motion from the first frame, a text hook, one control, an early reward, rhythm changes, variable rewards, a visible goal, near-win tension, retry without friction, sound and haptics, an end that pulls forward, and measurement. Each score is `yes`, `partial` or `no`, with a note that says where it lives in the game. The site build refuses a playable that skips a principle, and the home page shows all playables side by side, so a partial score stays visible until it is fixed.

The scorecard already paid off: it showed that all three playables had a weak ending, and each now has a Level 2 teaser on the end card.

## Retention and telemetry

Playables report what the player does through `kit/telemetry.ts`: plain `postMessage` events (`impression`, `first_tap`, `drop`, `streak`, `fail`, `retry`, `win`, `end_card`, `cta_click`). There is no network call. On the portfolio they appear in a live panel next to the phone. In a campaign the same hook would feed the network's analytics API.

## Commands

```bash
npm install
npm run dev          # dev server for Stack Tower
npm run check        # typecheck, tests, build the games, build the site (fails on a rule break)
npm run preview      # serve dist/ at http://localhost:4174
```

Requires Node 22.18 or later (the build scripts run TypeScript directly).

## Add a playable

1. Create `games/<slug>/` with `index.html`, `src/main.ts`, a `vite.config.ts` that calls `defineGameConfig` (copy the one from Stack Tower), a `poster.jpg` and a `playable.json`.
2. `npm run check`. The build stops if the metadata is incomplete or the file breaks a network rule.
3. The portfolio page, the fullscreen file and the card on the home page are generated.

## License

MIT
