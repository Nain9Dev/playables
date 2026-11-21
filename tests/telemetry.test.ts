import { describe, expect, it, vi } from "vitest";
import { EVENT_NAME, buildEvent, track, type EventHost } from "../kit/telemetry.ts";

describe("buildEvent", () => {
  it("rounds the time and omits empty data", () => {
    expect(buildEvent("first_tap", 812.7)).toEqual({ source: "playable", name: "first_tap", t: 813 });
  });

  it("keeps the data when given", () => {
    expect(buildEvent("drop", 10, { kind: "perfect", combo: 2 }).data).toEqual({ kind: "perfect", combo: 2 });
  });
});

describe("track", () => {
  it("dispatches a window event and posts to the parent when framed", () => {
    const dispatchEvent = vi.fn(() => true);
    const postMessage = vi.fn();
    const host = { dispatchEvent, parent: { postMessage } } as unknown as EventHost;
    const event = track("cta_click", { from: "end_card" }, host);

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const dispatched = (dispatchEvent.mock.calls[0] as unknown as [CustomEvent])[0];
    expect(dispatched.type).toBe(EVENT_NAME);
    expect(postMessage).toHaveBeenCalledWith(event, "*");
  });

  it("does not post to itself when the page is not framed", () => {
    const postMessage = vi.fn();
    const self = { dispatchEvent: vi.fn(() => true), postMessage, parent: null as unknown };
    self.parent = self;
    track("impression", undefined, self as unknown as EventHost);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
