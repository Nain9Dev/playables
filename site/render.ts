/**
 * Pure HTML renderers for the portfolio. They take data and return strings, so the
 * generator has no hidden state and the output is the same on every run.
 */
import type { Verdict } from "../kit/validate.ts";
import type { PlayableMeta } from "./meta.ts";

export interface SiteEntry {
  meta: PlayableMeta;
  bytes: number;
  sha256: string;
  verdict: Verdict;
  hasPoster: boolean;
}

export interface SiteInfo {
  repoUrl: string;
  contactEmail: string;
  threeVersion: string;
  testCount: number;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The NainDev N isotype, drawn from the brandbook geometry (stroke 113, round caps). */
export function nMark(size: number): string {
  return `<svg viewBox="0 0 1000 1000" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="113" stroke-linecap="round" fill="none"><line x1="148" y1="148" x2="148" y2="848"/><line x1="308" y1="288" x2="686" y2="738"/><line x1="848" y1="148" x2="848" y2="848"/></g></svg>`;
}

interface PageOptions {
  title: string;
  description: string;
  /** Relative path from this page back to the site root: "./" or "../". */
  root: string;
  body: string;
  current: string;
}

function page({ title, description, root, body, current }: PageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#002B66">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Urbanist:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/tokens.css">
<link rel="stylesheet" href="${root}assets/site.css">
<script src="https://www.naindev.com/assets/js/ecosystem-bar.js" defer></script>
<script src="${root}assets/site.js" defer></script>
</head>
<body>
<nain-ecosystem-bar current-project="${esc(current)}" collapsed="true"></nain-ecosystem-bar>
${body}
</body>
</html>
`;
}

function header(root: string): string {
  return `<header class="topbar">
  <a class="brand" href="${root}" aria-label="NainDev Playables, home">
    <span class="brand-mark">${nMark(26)}</span>
    <span class="brand-text">NAINDEV <b>PLAYABLES</b></span>
  </a>
  <nav class="topnav" aria-label="Sections">
    <a href="${root}#play">Play</a>
    <a href="${root}#verified">Spec check</a>
    <a href="${root}#built">Stack</a>
    <button class="theme-toggle" type="button" aria-label="Switch light or dark theme">Theme</button>
  </nav>
</header>`;
}

function footer(info: SiteInfo): string {
  return `<footer class="footer">
  <div class="shell footer-grid">
    <div>
      <p class="eyebrow">NainDev Playables</p>
      <p class="muted">Single-file playable ads built with Three.js and checked against ad-network specs.</p>
    </div>
    <ul class="footer-links">
      <li><a href="${esc(info.repoUrl)}" rel="noopener">Source on GitHub</a></li>
      <li><a href="https://brand.naindev.com/" rel="noopener">Brandbook</a></li>
      <li><a href="mailto:${esc(info.contactEmail)}">${esc(info.contactEmail)}</a></li>
    </ul>
  </div>
</footer>`;
}

/** Phone frame with a lazy iframe. The game loads only after the first tap. */
export function phone(entry: SiteEntry, root: string, size: "hero" | "card" = "card"): string {
  const { meta } = entry;
  const poster = entry.hasPoster
    ? `<img class="phone-poster" src="${root}posters/${esc(meta.slug)}.jpg" alt="Screenshot of ${esc(meta.title)}" loading="lazy">`
    : "";
  return `<div class="phone phone-${size}" data-src="${root}play/${esc(meta.slug)}.html" data-title="${esc(meta.title)}">
  <div class="phone-screen">
    ${poster}
    <button class="phone-play" type="button"><span>TAP TO PLAY</span></button>
  </div>
  <button class="phone-full" type="button" aria-label="Open ${esc(meta.title)} fullscreen">&#x2922;</button>
</div>`;
}

function chips(items: string[]): string {
  return `<ul class="chips">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function specBadge(entry: SiteEntry): string {
  const errors = entry.verdict.rules.filter((rule) => rule.severity === "error");
  const passed = errors.filter((rule) => rule.passed).length;
  return `${passed}/${errors.length} spec rules`;
}

export function ruleTable(entry: SiteEntry): string {
  const rows = entry.verdict.rules
    .map((rule) => {
      const mark = rule.passed ? "PASS" : rule.severity === "error" ? "FAIL" : "WARN";
      const cls = rule.passed ? "pass" : rule.severity === "error" ? "fail" : "warn";
      return `<tr><td><span class="verdict ${cls}">${mark}</span></td><td>${esc(rule.description)}</td><td class="mono">${esc(rule.detail)}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Result</th><th>Rule</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderIndex(entries: SiteEntry[], info: SiteInfo): string {
  const live = entries.filter((entry) => entry.meta.status === "live").sort((a, b) => a.meta.order - b.meta.order);
  const featured = live[0];
  if (!featured) throw new Error("the site needs at least one live playable");

  const totalBytes = live.reduce((sum, entry) => sum + entry.bytes, 0);
  const allPass = live.every((entry) => entry.verdict.passed);

  const cards = live
    .map(
      (entry) => `<article class="card" id="${esc(entry.meta.slug)}">
  ${phone(entry, "./", "card")}
  <div class="card-body">
    <p class="eyebrow">${esc(entry.meta.genre)}</p>
    <h3>${esc(entry.meta.title)}</h3>
    <p>${esc(entry.meta.tagline)}</p>
    ${chips([formatBytes(entry.bytes), specBadge(entry), entry.meta.duration])}
    <a class="btn btn-ghost" href="./${esc(entry.meta.slug)}/">See the breakdown</a>
  </div>
</article>`,
    )
    .join("\n");

  const body = `${header("./")}
<main>
<section class="hero surface-deep blueprint">
  <div class="shell hero-grid">
    <div class="hero-copy">
      <p class="eyebrow on-deep">Playable ads, built to be replayed</p>
      <h1>Playables that make you tap one more time.</h1>
      <p class="lead">Single-file HTML5 ads built with Three.js. Tuned for the first five seconds, instrumented for retention, and checked against ad-network specs before they ship.</p>
      <div class="actions">
        <a class="btn btn-green" href="#play">Play ${esc(featured.meta.title)}</a>
        <a class="btn btn-line" href="#verified">See the spec check</a>
      </div>
    </div>
    <div class="hero-phone">${phone(featured, "./", "hero")}</div>
  </div>
</section>

<section class="strip">
  <div class="shell strip-grid">
    <div><b>${live.length}</b><span>playable${live.length === 1 ? "" : "s"} live</span></div>
    <div><b>${formatBytes(Math.round(totalBytes / live.length))}</b><span>average file size</span></div>
    <div><b>${allPass ? "0" : "!"}</b><span>network calls${allPass ? "" : ", check failed"}</span></div>
    <div><b>${info.testCount}</b><span>automated tests</span></div>
  </div>
</section>

<section class="section" id="play">
  <div class="shell">
    <p class="eyebrow">See it live</p>
    <h2>Play it for yourself.</h2>
    <p class="lead muted">Tap a phone to start. Each one is the real file an ad network would receive.</p>
    <div class="cards">
${cards}
      <article class="card card-next" aria-label="More playables coming">
        <div class="next-frame"><span>NEXT</span></div>
        <div class="card-body">
          <p class="eyebrow">In the queue</p>
          <h3>More playables</h3>
          <p>New mechanics, one at a time. Each gets the same breakdown and the same spec check.</p>
        </div>
      </article>
    </div>
  </div>
</section>

<section class="section surface-deep blueprint" id="juice">
  <div class="shell">
    <p class="eyebrow on-deep">What keeps people tapping</p>
    <h2>Four ideas behind every playable.</h2>
    <div class="grid-4">
      <article class="panel"><h3>The first five seconds</h3><p>No title screen. The game is already moving when the ad appears, and the first tap pays off at once.</p></article>
      <article class="panel"><h3>Juice on every tap</h3><p>Squash, sparks, sound, a zoom punch and a short vibration. The mechanic answers the player every time.</p></article>
      <article class="panel"><h3>A finish line in sight</h3><p>A progress bar and a near-goal message use the goal-gradient effect, so people speed up near the end.</p></article>
      <article class="panel"><h3>A second chance</h3><p>A failure offers a retry before the install button takes over, so a miss does not end the ad.</p></article>
    </div>
  </div>
</section>

<section class="section" id="verified">
  <div class="shell">
    <p class="eyebrow">Verified before it ships</p>
    <h2>The build fails if the file breaks a network rule.</h2>
    <p class="lead muted">A fail-closed validator runs on every build and publishes nothing that breaks the AppLovin and Meta limits. The table is the real result for ${esc(featured.meta.title)}.</p>
    ${ruleTable(featured)}
    <p class="note mono">SHA-256 ${esc(featured.sha256)}</p>
  </div>
</section>

<section class="section surface-sunken" id="built">
  <div class="shell two-col">
    <div>
      <p class="eyebrow">How it is built</p>
      <h2>No engine. No runtime assets.</h2>
      <p class="muted">TypeScript with Three.js named imports, bundled by Vite into one HTML file. Sound is synthesized with Web Audio. Game rules live in pure modules with unit tests, and rendering stays separate. Events leave the ad as plain messages, so the same hook can feed a network's analytics.</p>
      <a class="btn btn-ghost" href="${esc(info.repoUrl)}" rel="noopener">Read the source</a>
    </div>
    ${chips(["TypeScript", `Three.js ${info.threeVersion}`, "Vite", "Vitest", "MRAID 2.0", "Web Audio", "GitHub Actions"])}
  </div>
</section>
</main>
${footer(info)}`;

  return page({
    title: "NainDev Playables, playable ads built with Three.js",
    description:
      "A portfolio of single-file HTML5 playable ads built with Three.js. Each one is instrumented for retention and verified against ad-network specs before it ships.",
    root: "./",
    body,
    current: "Playables",
  });
}

export function renderDetail(entry: SiteEntry, info: SiteInfo): string {
  const { meta } = entry;

  const levers = meta.levers
    .map(
      (lever) =>
        `<tr><th scope="row">${esc(lever.name)}</th><td>${esc(lever.why)}</td><td>${esc(lever.how)}</td></tr>`,
    )
    .join("");

  const events = meta.events
    .map((event) => `<tr><td class="mono">${esc(event.name)}</td><td>${esc(event.meaning)}</td></tr>`)
    .join("");

  const body = `${header("../")}
<main>
<section class="hero surface-deep blueprint">
  <div class="shell hero-grid">
    <div class="hero-copy">
      <p class="eyebrow on-deep"><a href="../">Playables</a> / ${esc(meta.title)}</p>
      <h1>${esc(meta.title)}</h1>
      <p class="lead">${esc(meta.tagline)}</p>
      ${chips([meta.genre, meta.duration, meta.orientation, formatBytes(entry.bytes), specBadge(entry)])}
      <div class="actions">
        <a class="btn btn-green" href="../play/${esc(meta.slug)}.html">Open fullscreen</a>
        <a class="btn btn-line" href="${esc(meta.source)}" rel="noopener">Source</a>
      </div>
    </div>
    <div class="hero-phone">${phone(entry, "../", "hero")}</div>
  </div>
</section>

<section class="section">
  <div class="shell two-col">
    <div>
      <p class="eyebrow">The hook</p>
      <h2>The first five seconds.</h2>
      <p>${esc(meta.hook)}</p>
    </div>
    <div>
      <p class="eyebrow">The loop</p>
      <h2>One tap, one decision.</h2>
      <p>${esc(meta.coreLoop)}</p>
    </div>
  </div>
</section>

<section class="section surface-sunken">
  <div class="shell">
    <p class="eyebrow">Retention levers</p>
    <h2>What keeps the player tapping, and where it lives.</h2>
    <div class="table-wrap"><table class="table table-levers"><thead><tr><th>Lever</th><th>Why it works</th><th>How it is built here</th></tr></thead><tbody>${levers}</tbody></table></div>
  </div>
</section>

<section class="section" id="telemetry">
  <div class="shell two-col">
    <div>
      <p class="eyebrow">Live telemetry</p>
      <h2>Play the ad and watch its events.</h2>
      <p class="muted">The ad reports what the player does as plain messages. In a campaign these would feed the network's analytics. Here they appear in the panel as you play.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Event</th><th>Meaning</th></tr></thead><tbody>${events}</tbody></table></div>
    </div>
    <div>
      <div class="console" aria-live="polite">
        <div class="console-head"><span class="mono">EVENT LOG</span><button class="console-clear" type="button">Clear</button></div>
        <ol class="console-body" id="telemetry-log"><li class="console-empty">Waiting for the first tap. Press TAP TO PLAY above.</li></ol>
      </div>
    </div>
  </div>
</section>

<section class="section surface-deep blueprint" id="verified">
  <div class="shell">
    <p class="eyebrow on-deep">Spec verdict</p>
    <h2>${entry.verdict.passed ? "Passes every network rule." : "Fails a network rule."}</h2>
    ${ruleTable(entry)}
    <p class="note mono">${esc(formatBytes(entry.bytes))} (${entry.bytes} bytes) / SHA-256 ${esc(entry.sha256)}</p>
  </div>
</section>

<section class="section" id="built">
  <div class="shell two-col">
    <div>
      <p class="eyebrow">Stack</p>
      <h2>What it is made of.</h2>
      ${chips(meta.stack)}
    </div>
    <div>
      <p class="eyebrow">Next</p>
      <h2>Read the code.</h2>
      <p class="muted">Rules, rendering, MRAID adapter and validator are separate modules, each with tests.</p>
      <a class="btn btn-ghost" href="${esc(meta.source)}" rel="noopener">${esc(meta.source.replace("https://", ""))}</a>
    </div>
  </div>
</section>
</main>
${footer(info)}`;

  return page({
    title: `${meta.title}, a Three.js playable ad | NainDev Playables`,
    description: `${meta.tagline} ${meta.genre}, ${formatBytes(entry.bytes)}, ${specBadge(entry)} passed.`,
    root: "../",
    body,
    current: "Playables",
  });
}
