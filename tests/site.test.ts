import { describe, expect, it } from "vitest";
import { validatePlayable } from "../kit/validate.ts";
import { parseMeta } from "../site/meta.ts";
import { esc, formatBytes, renderDetail, renderIndex, type SiteEntry, type SiteInfo } from "../site/render.ts";

const GOOD_META = {
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
