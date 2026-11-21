/**
 * Playable analytics without a network call. Every event is dispatched on the
 * window and, when the ad runs inside an iframe, posted to the parent page.
 * The portfolio site shows these events live next to the phone. In a real
 * network the same hook would forward them to the network's analytics API.
 */

export interface PlayableEvent {
  source: "playable";
  name: string;
  /** Milliseconds since the page started. */
  t: number;
  data?: Record<string, string | number | boolean>;
}

export interface EventHost {
  parent?: { postMessage(message: unknown, targetOrigin: string): void } | null;
  dispatchEvent(event: Event): boolean;
}

export const EVENT_NAME = "playable:event";

export function buildEvent(
  name: string,
  now: number,
  data?: Record<string, string | number | boolean>,
): PlayableEvent {
  return data
    ? { source: "playable", name, t: Math.round(now), data }
    : { source: "playable", name, t: Math.round(now) };
}

export function track(
  name: string,
  data?: Record<string, string | number | boolean>,
  host: EventHost = window,
): PlayableEvent {
  const event = buildEvent(name, performance.now(), data);
  host.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
  if (host.parent && host.parent !== (host as unknown)) {
    host.parent.postMessage(event, "*");
  }
  return event;
}
