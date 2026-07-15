import {
  canonicalStateSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import type { PublicEntityChange } from "./types";

export type PublicStatePatchSummary = {
  state: CanonicalPublicState;
  changed: {
    items: number;
    events: number;
    sources: number;
    newsletters: number;
    policies: number;
    tombstones: number;
  };
};

export function patchCanonicalPublicState(
  previous: unknown,
  changes: readonly PublicEntityChange[],
): PublicStatePatchSummary {
  const state = canonicalStateSchema.parse(previous);
  const items = new Map(state.items.map((item) => [item.id, item]));
  const events = new Map(state.events.map((event) => [event.id, event]));
  const sources = new Map(state.sources.map((source) => [source.id, source]));
  const newsletters = new Map(
    state.newsletters.map((newsletter) => [newsletter.id, newsletter]),
  );
  const policies = new Map(
    state.policies.map((policy) => [policy.version, policy]),
  );
  const deletedEventIds = new Set<number>();
  const counts = {
    items: 0,
    events: 0,
    sources: 0,
    newsletters: 0,
    policies: 0,
    tombstones: 0,
  };

  for (const change of changes) {
    if (change.entityType === "item") {
      applyNumericChange(items, change.entityKey, change.value, "item");
      counts.items += 1;
    } else if (change.entityType === "event") {
      const eventId = numericKey(change.entityKey, "event");
      if (change.value === null) deletedEventIds.add(eventId);
      applyNumericChange(events, change.entityKey, change.value, "event");
      counts.events += 1;
    } else if (change.entityType === "source") {
      applyStringChange(sources, change.entityKey, change.value);
      counts.sources += 1;
    } else if (change.entityType === "newsletter") {
      applyNumericChange(
        newsletters,
        change.entityKey,
        change.value,
        "newsletter",
      );
      counts.newsletters += 1;
    } else {
      for (const [version, policy] of policies) {
        if (policy.skillName === change.entityKey) policies.delete(version);
      }
      if (change.value !== null) {
        if (change.value.skillName !== change.entityKey) {
          throw new Error("policy key/value mismatch");
        }
        policies.set(change.value.version, change.value);
      }
      counts.policies += 1;
    }
    if (change.value === null) counts.tombstones += 1;
  }

  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    for (const [itemId, item] of items) {
      if (
        !sources.has(item.sourceId) ||
        (item.eventId !== null &&
          (deletedEventIds.has(item.eventId) || !events.has(item.eventId)))
      ) {
        items.delete(itemId);
        counts.items += 1;
        counts.tombstones += 1;
        cascaded = true;
      }
    }
    for (const [eventId, event] of events) {
      const complete = event.memberItemIds.every(
        (itemId) => items.get(itemId)?.eventId === eventId,
      );
      if (!complete) {
        events.delete(eventId);
        deletedEventIds.add(eventId);
        counts.events += 1;
        counts.tombstones += 1;
        cascaded = true;
      }
    }
  }
  for (const [newsletterId, newsletter] of newsletters) {
    if (newsletter.itemIds.some((itemId) => !items.has(itemId))) {
      newsletters.delete(newsletterId);
      counts.newsletters += 1;
      counts.tombstones += 1;
    }
  }

  const next = canonicalStateSchema.parse({
    schemaVersion: 1,
    items: [...items.values()].sort((left, right) => left.id - right.id),
    events: [...events.values()].sort((left, right) => left.id - right.id),
    sources: [...sources.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    newsletters: [...newsletters.values()].sort(
      (left, right) => left.id - right.id,
    ),
    policies: [...policies.values()].sort((left, right) =>
      left.version.localeCompare(right.version),
    ),
  });
  return { state: next, changed: counts };
}

function applyNumericChange<T extends { id: number }>(
  target: Map<number, T>,
  key: string,
  value: T | null,
  label: string,
): void {
  const id = numericKey(key, label);
  if (value === null) target.delete(id);
  else {
    if (value.id !== id) throw new Error(`${label} key/value mismatch`);
    target.set(id, value);
  }
}

function applyStringChange<T>(
  target: Map<string, T>,
  key: string,
  value: T | null,
): void {
  if (value === null) target.delete(key);
  else target.set(key, value);
}

function numericKey(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`invalid ${label} key: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label} key: ${value}`);
  return parsed;
}
