/**
 * Pure HTML renderers for the portfolio. They take data and return strings, so the
 * generator has no hidden state and the output is the same on every run.
 */
import type { Verdict } from "../kit/validate.ts";
import type { PlayableMeta } from "./meta.ts";
import { PRINCIPLES, SHORT_LABEL, STATUS_LABEL, tally, type Status } from "./principles.ts";

export interface SiteEntry {
  meta: PlayableMeta;
  bytes: number;
  sha256: string;
  verdict: Verdict;
  hasPoster: boolean;
}

export interface SiteInfo {
  /** Public address of the site, with a trailing slash. Used for canonical and social links. */
  siteUrl: string;
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
  /** Absolute public address of site (SiteInfo.siteUrl). */
  siteUrl: string;
  /** Path of this page below the site root, such as "" or "stack-tower/". */
  path: string;
  /** Poster path below the site root for social cards, such as "posters/stack-tower.jpg". */
  image?: string;
  noindex?: boolean;
}

function page({ title, description, root, body, current, siteUrl, path, image, noindex }: PageOptions): string {
  const canonical = `${siteUrl}${path}`;
  const social = image
    ? `<meta property="og:image" content="${esc(siteUrl + image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(siteUrl + image)}">`
    : `<meta name="twitter:card" content="summary">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#002B66">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="NainDev Playables">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${social}
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
    <a href="${root}#scorecard">Scorecard</a>
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
export function phone(
  entry: SiteEntry,
  root: string,
  size: "hero" | "card" | "side" = "card",
  options: { live?: boolean } = {},
): string {
  const { meta } = entry;
  const poster = entry.hasPoster
    ? `<img class="phone-poster" src="${root}posters/${esc(meta.slug)}.jpg" alt="Screenshot of ${esc(meta.title)}" ${options.live ? "" : 'loading="lazy"'}>`
    : "";
  // A live phone runs its game as soon as it is on screen (attract mode) and restarts it every
  // few seconds, so the home never shows an end card. The first tap inside it claims the phone.
  const live = options.live ? ` data-live="1" data-loop="${LIVE_LOOP_MS}"` : "";
  return `<div class="phone phone-${size}" data-src="${root}play/${esc(meta.slug)}.html" data-title="${esc(meta.title)}"${live}>
  <div class="phone-screen">
    ${poster}
    <button class="phone-play" type="button"><span>TAP TO PLAY</span></button>
  </div>
  <button class="phone-full" type="button" aria-label="Open ${esc(meta.title)} fullscreen">&#x2922;</button>
</div>`;
}

/** One or two words per validator rule, for the home page. The full sentence stays in the details. */
const RULE_SHORT: Record<string, string> = {
  "size-hard": "Under 5 MB",
  "size-soft": "Under 2 MB",
  "single-file": "One file",
  "no-network-calls": "No network calls",
  "mraid-ready": "MRAID ready",
  "store-via-mraid": "Store opens right",
  viewport: "Viewport",
  "html-document": "Valid HTML",
};

/** Milliseconds a live phone plays before its game restarts. Shorter than any end card. */
export const LIVE_LOOP_MS = 11000;

const ICONS: Record<string, string> = {
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  burst: "m12 2 2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1z",
  flag: "M5 21V4h13l-2.5 4.5L18 13H7",
  loop: "M4 12a8 8 0 0 1 14-5.3L20 5v6h-6l2.4-2.4A5.5 5.5 0 0 0 6.5 12M20 12a8 8 0 0 1-14 5.3L4 19v-6h6l-2.4 2.4A5.5 5.5 0 0 0 17.5 12",
};

/** Small stroke icon for the highlight row. */
export function icon(name: keyof typeof ICONS | string): string {
  const path = ICONS[name];
  if (!path) throw new Error(`unknown icon: ${name}`);
  return `<svg class="icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
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

const STATUS_VALUE: Record<Status, number> = { yes: 1, partial: 0.5, no: 0.08 };

/** Small ring that shows how many principles a playable fully meets, for the cards. */
export function scoreRing(yes: number, total: number, size = 54): string {
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? yes / total : 0;
  return `<svg class="ring" viewBox="0 0 54 54" width="${size}" height="${size}" role="img" aria-label="${yes} of ${total} retention principles met"><circle cx="27" cy="27" r="${radius}" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="5"/><circle cx="27" cy="27" r="${radius}" fill="none" stroke="var(--nain-green)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(circumference * share).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle" font-size="13" font-weight="800" fill="currentColor">${yes}</text></svg>`;
}

/** Radar chart of the twelve principles: full, half or almost no radius for yes, partial and no. */
export function radar(entry: SiteEntry): string {
  const cx = 160;
  const cy = 150;
  const radius = 92;
  const count = PRINCIPLES.length;
  const point = (index: number, scale: number): [number, number] => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  const fmt = ([x, y]: [number, number]): string => `${x.toFixed(1)},${y.toFixed(1)}`;

  const rings = [0.5, 1]
    .map((scale) => `<polygon class="radar-ring" points="${PRINCIPLES.map((_, i) => fmt(point(i, scale))).join(" ")}"/>`)
    .join("");
  const axes = PRINCIPLES.map((_, i) => `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${point(i, 1)[0].toFixed(1)}" y2="${point(i, 1)[1].toFixed(1)}"/>`).join("");
  const values = PRINCIPLES.map((principle, i) => {
    const status = entry.meta.scorecard[principle.id]?.status ?? "no";
    return point(i, STATUS_VALUE[status]);
  });
  const dots = values.map(([x, y], i) => {
    const status = entry.meta.scorecard[PRINCIPLES[i]?.id ?? ""]?.status ?? "no";
    return `<circle class="radar-dot ${status}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"/>`;
  }).join("");
  const labels = PRINCIPLES.map((principle, i) => {
    const [x, y] = point(i, 1.2);
    const anchor = x < cx - 8 ? "end" : x > cx + 8 ? "start" : "middle";
    return `<text class="radar-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(SHORT_LABEL[principle.id] ?? principle.title)}</text>`;
  }).join("");
  const { yes, partial, total } = tally(entry.meta.scorecard);

  return `<svg class="radar" viewBox="0 0 320 300" role="img" aria-label="Retention radar of ${esc(entry.meta.title)}: ${yes} of ${total} principles fully met, ${partial} partial">${rings}${axes}<polygon class="radar-shape" points="${values.map(fmt).join(" ")}"/>${dots}${labels}</svg>`;
}

/** The previous and next live playable around `index`, for the pager at the end of a detail page. */
export function neighbours<T>(list: readonly T[], index: number): { previous: T | null; next: T | null } {
  return { previous: index > 0 ? (list[index - 1] ?? null) : null, next: index < list.length - 1 ? (list[index + 1] ?? null) : null };
}

function scoreBadge(status: Status): string {
  return `<span class="score ${status}">${STATUS_LABEL[status]}</span>`;
}

/** One playable: every principle, its status, and where it lives in the game. */
export function scorecardTable(entry: SiteEntry): string {
  const rows = PRINCIPLES.map((principle) => {
    const score = entry.meta.scorecard[principle.id];
    if (!score) throw new Error(`${entry.meta.slug}: missing score for ${principle.id}`);
    return `<tr><th scope="row">${esc(principle.title)}<span class="sub">${esc(principle.description)}</span></th><td>${scoreBadge(score.status)}</td><td>${esc(score.note)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="table table-score"><thead><tr><th>Principle</th><th>Met</th><th>Where it lives</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** All playables side by side: one row per principle, one column per playable. */
export function scorecardMatrix(entries: SiteEntry[]): string {
  const head = entries
    .map((entry) => `<th scope="col"><a href="./${esc(entry.meta.slug)}/">${esc(entry.meta.title)}</a></th>`)
    .join("");
  const rows = PRINCIPLES.map((principle) => {
    const cells = entries
      .map((entry) => {
        const score = entry.meta.scorecard[principle.id];
        return `<td>${score ? scoreBadge(score.status) : ""}</td>`;
      })
      .join("");
    return `<tr><th scope="row">${esc(principle.title)}<span class="sub">${esc(principle.description)}</span></th>${cells}</tr>`;
  }).join("");
  const totals = entries
    .map((entry) => {
      const { yes, partial, total } = tally(entry.meta.scorecard);
      return `<td><b>${yes}/${total}</b><span class="sub">${partial} partial</span></td>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="table table-matrix"><thead><tr><th>Principle</th>${head}</tr></thead><tbody>${rows}<tr class="total"><th scope="row">Fully met</th>${totals}</tr></tbody></table></div>`;
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
    <div class="card-head">
      <div>
        <p class="eyebrow">${esc(entry.meta.genre)}</p>
        <h3>${esc(entry.meta.title)}</h3>
      </div>
      <div class="ring-wrap" title="Retention principles fully met">${scoreRing(tally(entry.meta.scorecard).yes, PRINCIPLES.length)}<span>of ${PRINCIPLES.length}</span></div>
    </div>
    <a class="more" href="./${esc(entry.meta.slug)}/">Details <span aria-hidden="true">&rarr;</span></a>
  </div>
</article>`,
    )
    .join("\n");

  // The featured playable sits in the middle and the next two flank it, so the hero shows range at a glance.
  const fan = [live[1], live[0], live[2]]
    .filter((candidate): candidate is SiteEntry => Boolean(candidate))
    .map((candidate) => phone(candidate, "./", candidate === featured ? "hero" : "side", { live: true }))
    .join("");

  // Fixed positions and delays (no randomness) so the build is the same on every run.
  const sparks = Array.from(
    { length: 16 },
    (_, i) => `<i style="--x:${(i * 37 + 11) % 100}%;--d:${((i * 7) % 11) * 0.7}s;--s:${4 + (i % 4)}px"></i>`,
  ).join("");

  const body = `${header("./")}
<main>
<section class="hero hero-home surface-deep blueprint">
  <div class="sparks" aria-hidden="true">${sparks}</div>
  <div class="shell hero-grid">
    <div class="hero-copy">
      <h1>Tap. Play. <em>Repeat.</em></h1>
      <p class="lead">Playable ads you cannot put down.</p>
      <div class="actions">
        <a class="btn btn-green btn-xl" href="#play">Play now</a>
      </div>
    </div>
    <div class="hero-phones">${fan}</div>
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
    <h2>Pick one.</h2>
    <div class="cards">
${cards}
      <article class="card card-next" aria-label="More playables coming">
        <div class="next-frame"><span>NEXT</span></div>
        <div class="card-body"><h3>More soon</h3></div>
      </article>
    </div>
  </div>
</section>

<section class="section surface-deep blueprint" id="juice">
  <div class="shell">
    <h2>Built to keep you tapping.</h2>
    <ul class="icons">
      <li>${icon("bolt")}<b>Moving at frame one</b></li>
      <li>${icon("burst")}<b>Juice on every tap</b></li>
      <li>${icon("flag")}<b>Finish line in sight</b></li>
      <li>${icon("loop")}<b>A second chance</b></li>
    </ul>
  </div>
</section>

<section class="section" id="scorecard">
  <div class="shell">
    <h2>Twelve habits. Scored honestly.</h2>
    <div class="radars">${live.map((entry) => `<a class="radar-card" href="./${esc(entry.meta.slug)}/#scorecard">${radar(entry)}<b>${esc(entry.meta.title)}</b><span>${tally(entry.meta.scorecard).yes} of ${PRINCIPLES.length}</span></a>`).join("")}</div>
    <details class="fold"><summary>Compare every principle</summary>${scorecardMatrix(live)}</details>
  </div>
</section>

<section class="section surface-sunken" id="verified">
  <div class="shell">
    <h2>Checked before every ship.</h2>
    <ul class="passes">${featured.verdict.rules.map((rule) => `<li class="${rule.passed ? "ok" : rule.severity === "error" ? "bad" : "warn"}"><span class="verdict ${rule.passed ? "pass" : rule.severity === "error" ? "fail" : "warn"}">${rule.passed ? "PASS" : rule.severity === "error" ? "FAIL" : "WARN"}</span>${esc(RULE_SHORT[rule.id] ?? rule.id)}</li>`).join("")}</ul>
    <details class="fold"><summary>Details for ${esc(featured.meta.title)}</summary>${ruleTable(featured)}<p class="note mono">SHA-256 ${esc(featured.sha256)}</p></details>
  </div>
</section>

<section class="section surface-deep blueprint" id="built">
  <div class="shell built-row">
    <h2>No engine. One file.</h2>
    ${chips(["TypeScript", `Three.js ${info.threeVersion}`, "Vite", "Vitest", "MRAID 2.0", "Web Audio"])}
    <a class="btn btn-ghost" href="${esc(info.repoUrl)}" rel="noopener">Source</a>
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
    siteUrl: info.siteUrl,
    path: "",
    ...(featured.hasPoster ? { image: `posters/${featured.meta.slug}.jpg` } : {}),
  });
}

/** Minimal not-found page for GitHub Pages. It points back to the home page. */
export function render404(info: SiteInfo): string {
  const body = `${header("/")}
<main>
<section class="section">
  <div class="shell">
    <p class="eyebrow">404</p>
    <h1>That playable is not here.</h1>
    <p class="lead muted">The page may have moved. Every playable is on the home page.</p>
    <div class="actions"><a class="btn btn-ghost" href="/">Back to the playables</a></div>
  </div>
</section>
</main>
${footer(info)}`;
  return page({
    title: "Not found | NainDev Playables",
    description: "This page does not exist.",
    root: "/",
    body,
    current: "Playables",
    siteUrl: info.siteUrl,
    path: "404.html",
    noindex: true,
  });
}

/** sitemap.xml with the home page and one page per live playable. */
export function renderSitemap(entries: SiteEntry[], info: SiteInfo): string {
  const live = entries.filter((entry) => entry.meta.status === "live").sort((a, b) => a.meta.order - b.meta.order);
  const urls = [info.siteUrl, ...live.map((entry) => `${info.siteUrl}${entry.meta.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${esc(url)}</loc></url>`).join("\n")}
</urlset>
`;
}

export function renderRobots(info: SiteInfo): string {
  return `User-agent: *
Allow: /

Sitemap: ${info.siteUrl}sitemap.xml
`;
}

export function renderDetail(entry: SiteEntry, info: SiteInfo, all: readonly SiteEntry[] = [entry]): string {
  const { meta } = entry;
  const live = all.filter((candidate) => candidate.meta.status === "live").sort((a, b) => a.meta.order - b.meta.order);
  const { previous, next } = neighbours(live, live.findIndex((candidate) => candidate.meta.slug === meta.slug));
  const pagerLink = (target: SiteEntry | null, label: string, side: "prev" | "next"): string =>
    target
      ? `<a class="pager-link ${side}" href="../${esc(target.meta.slug)}/"><span class="eyebrow">${label}</span><b>${esc(target.meta.title)}</b><span class="muted">${esc(target.meta.tagline)}</span></a>`
      : `<span class="pager-link ${side} none"></span>`;

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

<nav class="subnav" aria-label="On this page">
  <div class="shell subnav-row">
    <a href="#hook">Hook</a><a href="#levers">Levers</a><a href="#scorecard">Scorecard</a><a href="#telemetry">Telemetry</a><a href="#verified">Spec check</a>
  </div>
</nav>

<section class="section" id="hook">
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

<section class="section surface-sunken" id="levers">
  <div class="shell">
    <p class="eyebrow">Retention levers</p>
    <h2>What keeps the player tapping, and where it lives.</h2>
    <div class="table-wrap"><table class="table table-levers"><thead><tr><th>Lever</th><th>Why it works</th><th>How it is built here</th></tr></thead><tbody>${levers}</tbody></table></div>
  </div>
</section>

<section class="section" id="scorecard">
  <div class="shell">
    <div class="score-head">
      <div>
        <p class="eyebrow">Retention scorecard</p>
        <h2>${tally(meta.scorecard).yes} of ${PRINCIPLES.length} principles fully met.</h2>
        <p class="lead muted">${tally(meta.scorecard).partial === 0 ? "No known gaps." : `${tally(meta.scorecard).partial} partial, each one a known gap.`} Every line says where the principle lives in the game.</p>
      </div>
      <div class="radar-wrap">${radar(entry)}</div>
    </div>
    ${scorecardTable(entry)}
  </div>
</section>

<section class="section surface-sunken" id="telemetry">
  <div class="shell two-col">
    <div>
      <p class="eyebrow">Live telemetry</p>
      <h2>Play the ad and watch its events.</h2>
      <p class="muted">The ad reports what the player does as plain messages. In a campaign these would feed the network's analytics. Here they appear in the panel as you play.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Event</th><th>Meaning</th></tr></thead><tbody>${events}</tbody></table></div>
    </div>
    <div>
      <div class="live-stats" aria-label="Session numbers">
        <div><b id="stat-first">-</b><span>to first input</span></div>
        <div><b id="stat-events">0</b><span>events</span></div>
        <div><b id="stat-span">-</b><span>in the ad</span></div>
      </div>
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

<nav class="pager" aria-label="More playables">
  <div class="shell pager-row">
    ${pagerLink(previous, "Previous", "prev")}
    ${pagerLink(next, "Next", "next")}
  </div>
</nav>
</main>
${footer(info)}`;

  return page({
    title: `${meta.title}, a Three.js playable ad | NainDev Playables`,
    description: `${meta.tagline} ${meta.genre}, ${formatBytes(entry.bytes)}, ${specBadge(entry)} passed.`,
    root: "../",
    body,
    current: "Playables",
    siteUrl: info.siteUrl,
    path: `${meta.slug}/`,
    ...(entry.hasPoster ? { image: `posters/${meta.slug}.jpg` } : {}),
  });
}
