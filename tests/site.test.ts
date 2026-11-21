import { describe, expect, it } from "vitest";
import { validatePlayable } from "../kit/validate.ts";
import { parseMeta } from "../site/meta.ts";
import { PRINCIPLES, SHORT_LABEL, tally } from "../site/principles.ts";
import {
  LIVE_LOOP_MS,
  esc,
  formatBytes,
  icon,
  neighbours,
  radar,
  render404,
  scoreRing,
  renderDetail,
  renderIndex,
  renderRobots,
  renderSitemap,
  scorecardMatrix,
  scorecardTable,
  type SiteEntry,
  type SiteInfo,
} from "../site/render.ts";

const SCORECARD = Object.fromEntries(
  PRINCIPLES.map((principle, i) => [
    principle.id,
    { status: i % 4 === 3 ? "partial" : "yes", note: `Note for ${principle.id}.` },
  ]),
);

const GOOD_META = {
  scorecard: SCORECARD,
  slug: "demo-game",
  title: "Demo <Game>",
  order: 1,
  status: "live",
  tagline: "A tagline.",
  genre: "Puzzle",
  duration: "30 seconds",
  orientation: "Portrait",
  hook: "A hook.",
  coreLoop: "A loop.",
  levers: [{ name: "Lever", why: "Because.", how: "Like this." }],
  events: [{ name: "impression", meaning: "Shown." }],
  stack: ["TypeScript"],
  source: "https://github.com/example/demo",
  accent: "#80FF00",
};

const INFO: SiteInfo = {
  siteUrl: "https://example.com/",
  repoUrl: "https://github.com/example/site",
  contactEmail: "hello@example.com",
  threeVersion: "0.1.0",
  testCount: 12,
};

function entry(): SiteEntry {
  const html = `<!doctype html><html><head><meta name="viewport" content="x"></head><body><script>
    const m = window.mraid; m.addEventListener("ready", () => {}); m.addEventListener("viewableChange", () => {});
    m.open("https://example.com");</script></body></html>`;
  return {
    meta: parseMeta(GOOD_META, "demo-game"),
    bytes: html.length,
    sha256: "a".repeat(64),
    verdict: validatePlayable(html, html.length),
    hasPoster: false,
  };
}

describe("parseMeta", () => {
  it("accepts complete metadata", () => {
    expect(parseMeta(GOOD_META, "demo-game").title).toBe("Demo <Game>");
  });

  it("rejects a slug that does not match the folder", () => {
    expect(() => parseMeta(GOOD_META, "other")).toThrow(/must match the folder/);
  });

  it("rejects a missing or empty field instead of rendering an empty section", () => {
    expect(() => parseMeta({ ...GOOD_META, hook: "  " }, "demo-game")).toThrow(/hook/);
    expect(() => parseMeta({ ...GOOD_META, levers: [] }, "demo-game")).toThrow(/levers/);
  });

  it("rejects an invalid slug, status, source and accent", () => {
    expect(() => parseMeta({ ...GOOD_META, slug: "Bad Slug" }, "Bad Slug")).toThrow(/slug/);
    expect(() => parseMeta({ ...GOOD_META, status: "soon" }, "demo-game")).toThrow(/status/);
    expect(() => parseMeta({ ...GOOD_META, source: "http://x" }, "demo-game")).toThrow(/https/);
    expect(() => parseMeta({ ...GOOD_META, accent: "green" }, "demo-game")).toThrow(/accent/);
  });

  it("rejects something that is not an object", () => {
    expect(() => parseMeta(null, "demo-game")).toThrow(/expected an object/);
  });

  it("requires a score for every retention principle", () => {
    const missing = { ...SCORECARD };
    delete missing["measured"];
    expect(() => parseMeta({ ...GOOD_META, scorecard: missing }, "demo-game")).toThrow(/measured/);
  });

  it("rejects an unknown principle, a bad status and an empty note", () => {
    expect(() => parseMeta({ ...GOOD_META, scorecard: { ...SCORECARD, invented: { status: "yes", note: "x" } } }, "demo-game")).toThrow(/unknown principle/);
    expect(() => parseMeta({ ...GOOD_META, scorecard: { ...SCORECARD, measured: { status: "great", note: "x" } } }, "demo-game")).toThrow(/status/);
    expect(() => parseMeta({ ...GOOD_META, scorecard: { ...SCORECARD, measured: { status: "yes", note: " " } } }, "demo-game")).toThrow(/note/);
  });
});

describe("scorecard", () => {
  it("tallies met and partial principles", () => {
    const meta = parseMeta(GOOD_META, "demo-game");
    const { yes, partial, total } = tally(meta.scorecard);
    expect(total).toBe(PRINCIPLES.length);
    expect(yes + partial).toBe(PRINCIPLES.length);
    expect(partial).toBe(Math.floor(PRINCIPLES.length / 4));
  });

  it("renders every principle in the table and the matrix", () => {
    const table = scorecardTable(entry());
    const matrix = scorecardMatrix([entry()]);
    for (const principle of PRINCIPLES) {
      expect(table).toContain(esc(principle.title));
      expect(matrix).toContain(esc(principle.title));
    }
    expect(table).toContain("Note for measured.");
  });
});

describe("visual summaries", () => {
  it("has a short axis label for every principle", () => {
    for (const principle of PRINCIPLES) {
      const label = SHORT_LABEL[principle.id];
      expect(label, principle.id).toBeTruthy();
      expect((label ?? "").length).toBeLessThanOrEqual(10);
    }
  });

  it("draws the ring in proportion to the principles met", () => {
    const full = scoreRing(12, 12);
    const half = scoreRing(6, 12);
    const circumference = 2 * Math.PI * 21;
    expect(full).toContain(`stroke-dasharray="${circumference.toFixed(1)} ${circumference.toFixed(1)}"`);
    expect(half).toContain(`stroke-dasharray="${(circumference / 2).toFixed(1)} ${circumference.toFixed(1)}"`);
    expect(half).toContain("6 of 12 retention principles met");
    expect(scoreRing(0, 0)).toContain("0 of 0");
  });

  it("draws one axis, one label and one dot per principle in the radar", () => {
    const svg = radar(entry());
    expect(svg.match(/class="radar-axis"/g)).toHaveLength(PRINCIPLES.length);
    expect(svg.match(/class="radar-label"/g)).toHaveLength(PRINCIPLES.length);
    expect(svg.match(/class="radar-dot /g)).toHaveLength(PRINCIPLES.length);
    expect(svg).toContain("principles fully met");
  });

  it("puts a partial score closer to the center than a full one", () => {
    const meta = parseMeta(GOOD_META, "demo-game");
    const all = (status: "yes" | "partial") =>
      ({ ...entry(), meta: { ...meta, scorecard: Object.fromEntries(PRINCIPLES.map((p) => [p.id, { status, note: "x" }])) } });
    const area = (svg: string): number => {
      const points = (svg.match(/class="radar-shape" points="([^"]+)"/)?.[1] ?? "").split(" ").map((pair) => pair.split(",").map(Number));
      return points.reduce((sum, [x = 0, y = 0], i) => {
        const [nx = 0, ny = 0] = points[(i + 1) % points.length] ?? [];
        return sum + (x * ny - nx * y);
      }, 0) / 2;
    };
    expect(Math.abs(area(radar(all("partial"))))).toBeLessThan(Math.abs(area(radar(all("yes")))));
  });

  it("finds the neighbours of a playable", () => {
    expect(neighbours(["a", "b", "c"], 0)).toEqual({ previous: null, next: "b" });
    expect(neighbours(["a", "b", "c"], 1)).toEqual({ previous: "a", next: "c" });
    expect(neighbours(["a", "b", "c"], 2)).toEqual({ previous: "b", next: null });
    expect(neighbours(["a"], 0)).toEqual({ previous: null, next: null });
  });

  it("shows a fan of phones in the hero with the featured one in the middle", () => {
    const a = entry();
    const b = { ...entry(), meta: { ...a.meta, slug: "second", title: "Second", order: 2 } };
    const c = { ...entry(), meta: { ...a.meta, slug: "third", title: "Third", order: 3 } };
    const hero = renderIndex([a, b, c], INFO).match(/<div class="hero-phones">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/)?.[1] ?? "";
    const order = [...hero.matchAll(/data-title="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["Second", "Demo &lt;Game&gt;", "Third"]);
    expect(hero).toContain("phone-hero");
    expect(hero.match(/phone-side/g)).toHaveLength(2);
  });

  it("shows a ring on every card", () => {
    expect(renderIndex([entry()], INFO)).toContain('class="ring"');
  });

  it("links the previous and next playable at the end of a detail page", () => {
    const a = entry();
    const b = { ...entry(), meta: { ...a.meta, slug: "second", title: "Second", order: 2 } };
    const c = { ...entry(), meta: { ...a.meta, slug: "third", title: "Third", order: 3 } };
    const html = renderDetail(b, INFO, [c, a, b]);
    expect(html).toContain('class="pager-link prev" href="../demo-game/"');
    expect(html).toContain('class="pager-link next" href="../third/"');
    const first = renderDetail(a, INFO, [a, b, c]);
    expect(first).toContain('class="pager-link prev none"');
  });

  it("gives the detail page section anchors for its sticky nav", () => {
    const html = renderDetail(entry(), INFO);
    for (const id of ["hook", "levers", "scorecard", "telemetry", "verified"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    for (const stat of ["stat-first", "stat-events", "stat-span"]) expect(html).toContain(`id="${stat}"`);
  });
});

describe("home design", () => {
  const three = (): SiteEntry[] => {
    const a = entry();
    return [
      a,
      { ...entry(), meta: { ...a.meta, slug: "second", title: "Second", order: 2 } },
      { ...entry(), meta: { ...a.meta, slug: "third", title: "Third", order: 3 } },
    ];
  };

  /** Words a visitor reads at first sight: no tables, folded details, scripts, styles or drawings. */
  function visibleWords(html: string): number {
    const text = html
      .replace(/<(script|style|svg|table|details|footer|header)[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/g, " ");
    return text.split(/\s+/).filter(Boolean).length;
  }

  it("keeps the home light on text: the point is to show, not to explain", () => {
    // 153 words with three playables when this was written, buttons and labels included.
    // A playable adds about seven words, so a longer paragraph is what trips this.
    expect(visibleWords(renderIndex(three(), INFO))).toBeLessThan(170);
  });

  it("starts the hero phones live and gives them a loop shorter than any end card", () => {
    const html = renderIndex(three(), INFO);
    const hero = html.match(/<div class="hero-phones">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/)?.[1] ?? "";
    expect(hero.match(/data-live="1"/g)).toHaveLength(3);
    expect(hero).toContain(`data-loop="${LIVE_LOOP_MS}"`);
    expect(LIVE_LOOP_MS).toBeLessThan(15_000);
    // Only the hero is live: the cards wait for a tap.
    const cards = html.slice(html.indexOf('id="play"'));
    expect(cards).not.toContain("data-live");
  });

  it("draws the glow sparks from fixed values, so the build is repeatable", () => {
    const html = renderIndex(three(), INFO);
    expect(html.match(/<i style="--x:/g)).toHaveLength(16);
    expect(renderIndex(three(), INFO)).toBe(html);
  });

  it("folds the long tables and keeps the headline numbers visible", () => {
    const html = renderIndex(three(), INFO);
    expect(html.match(/<details class="fold">/g)).toHaveLength(2);
    expect(html).toContain('class="radars"');
    expect(html.match(/class="radar-card"/g)).toHaveLength(3);
    expect(html).toContain('class="passes"');
  });

  it("has icons for the highlight row and rejects an unknown one", () => {
    for (const name of ["bolt", "burst", "flag", "loop"]) expect(icon(name)).toContain("<path");
    expect(() => icon("missing")).toThrow(/unknown icon/);
  });
});

describe("search and social metadata", () => {
  it("sets a canonical link and a social image from the poster", () => {
    const withPoster = { ...entry(), hasPoster: true };
    const html = renderDetail(withPoster, INFO);
    expect(html).toContain('<link rel="canonical" href="https://example.com/demo-game/">');
    expect(html).toContain('<meta property="og:image" content="https://example.com/posters/demo-game.jpg">');
  });

  it("lists the home page and every live playable in the sitemap", () => {
    const draft = entry();
    draft.meta = { ...draft.meta, slug: "other", status: "draft" };
    const xml = renderSitemap([entry(), draft], INFO);
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/demo-game/</loc>");
    expect(xml).not.toContain("/other/");
  });

  it("points robots.txt at the sitemap", () => {
    expect(renderRobots(INFO)).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("keeps the 404 page out of the index", () => {
    const html = render404(INFO);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
  });
});

describe("render helpers", () => {
  it("escapes HTML special characters", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(545_000)).toBe("532 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("pages", () => {
  it("escapes the title on the index page and links the detail page", () => {
    const html = renderIndex([entry()], INFO);
    expect(html).toContain("Demo &lt;Game&gt;");
    expect(html).not.toContain("Demo <Game>");
    expect(html).toContain('href="./demo-game/"');
    expect(html).toContain('data-src="./play/demo-game.html"');
  });

  it("uses relative paths on the detail page so it works under any base path", () => {
    const html = renderDetail(entry(), INFO);
    expect(html).toContain('href="../assets/site.css"');
    expect(html).toContain('data-src="../play/demo-game.html"');
    expect(html).not.toMatch(/(?:href|src)="\/[^/]/);
  });

  it("shows the real verdict and hash", () => {
    const html = renderDetail(entry(), INFO);
    expect(html).toContain("Passes every network rule.");
    expect(html).toContain("a".repeat(64));
  });

  it("refuses to render an index without a live playable", () => {
    const draft = entry();
    draft.meta = { ...draft.meta, status: "draft" };
    expect(() => renderIndex([draft], INFO)).toThrow(/at least one live/);
  });

  it("renders the same output for the same input", () => {
    expect(renderIndex([entry()], INFO)).toBe(renderIndex([entry()], INFO));
  });
});
