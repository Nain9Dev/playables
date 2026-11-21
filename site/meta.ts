import { PRINCIPLES, type Score } from "./principles.ts";

/**
 * Metadata of one playable (`games/<slug>/playable.json`). The site build refuses
 * to publish a playable whose metadata is incomplete: a missing field fails the
 * build instead of rendering an empty section.
 */

export interface Lever {
  name: string;
  why: string;
  how: string;
}

export interface EventDoc {
  name: string;
  meaning: string;
}

export interface PlayableMeta {
  /** Score on every retention principle, keyed by principle id. */
  scorecard: Record<string, Score>;
  slug: string;
  title: string;
  order: number;
  status: "live" | "draft";
  tagline: string;
  genre: string;
  duration: string;
  orientation: string;
  hook: string;
  coreLoop: string;
  levers: Lever[];
  events: EventDoc[];
  stack: string[];
  source: string;
  accent: string;
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function list<T>(
  record: Record<string, unknown>,
  key: string,
  where: string,
  convert: (item: unknown, index: number) => T,
): T[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty array`);
  }
  return value.map(convert);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function parseScorecard(value: unknown, where: string): Record<string, Score> {
  const record = asRecord(value, `${where} scorecard`);
  const known = new Set(PRINCIPLES.map((principle) => principle.id));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) throw new Error(`${where}: scorecard has an unknown principle "${key}"`);
  }
  const out: Record<string, Score> = {};
  for (const principle of PRINCIPLES) {
    const entry = asRecord(record[principle.id], `${where} scorecard.${principle.id}`);
    const status = entry["status"];
    if (status !== "yes" && status !== "partial" && status !== "no") {
      throw new Error(`${where}: scorecard.${principle.id}.status must be "yes", "partial" or "no"`);
    }
    out[principle.id] = { status, note: text(entry, "note", `${where} scorecard.${principle.id}`) };
  }
  return out;
}

export function parseMeta(raw: unknown, folderName: string): PlayableMeta {
  const where = `games/${folderName}/playable.json`;
  const record = asRecord(raw, where);

  const slug = text(record, "slug", where);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${where}: "slug" must be lowercase letters, digits and hyphens`);
  }
  if (slug !== folderName) {
    throw new Error(`${where}: "slug" (${slug}) must match the folder name (${folderName})`);
  }

  const order = record["order"];
  if (typeof order !== "number" || !Number.isInteger(order) || order < 1) {
    throw new Error(`${where}: "order" must be a positive integer`);
  }

  const status = record["status"];
  if (status !== "live" && status !== "draft") {
    throw new Error(`${where}: "status" must be "live" or "draft"`);
  }

  const source = text(record, "source", where);
  if (!source.startsWith("https://")) {
    throw new Error(`${where}: "source" must be an https URL`);
  }

  const accent = text(record, "accent", where);
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    throw new Error(`${where}: "accent" must be a #rrggbb color`);
  }

  return {
    scorecard: parseScorecard(record["scorecard"], where),
    slug,
    title: text(record, "title", where),
    order,
    status,
    tagline: text(record, "tagline", where),
    genre: text(record, "genre", where),
    duration: text(record, "duration", where),
    orientation: text(record, "orientation", where),
    hook: text(record, "hook", where),
    coreLoop: text(record, "coreLoop", where),
    levers: list(record, "levers", where, (item, i) => {
      const lever = asRecord(item, `${where} levers[${i}]`);
      return {
        name: text(lever, "name", `${where} levers[${i}]`),
        why: text(lever, "why", `${where} levers[${i}]`),
        how: text(lever, "how", `${where} levers[${i}]`),
      };
    }),
    events: list(record, "events", where, (item, i) => {
      const event = asRecord(item, `${where} events[${i}]`);
      return {
        name: text(event, "name", `${where} events[${i}]`),
        meaning: text(event, "meaning", `${where} events[${i}]`),
      };
    }),
    stack: list(record, "stack", where, (item, i) => {
      if (typeof item !== "string" || item.trim() === "") {
        throw new Error(`${where}: "stack[${i}]" must be a non-empty string`);
      }
      return item;
    }),
    source,
    accent,
  };
}
