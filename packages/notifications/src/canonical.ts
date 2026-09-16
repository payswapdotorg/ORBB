/**
 * B8 — Canonical JSON serialization.
 *
 * Deterministic, byte-stable serialization (sorted object keys
 * lexicographically, `Date` → ISO-8601 string, arrays in their given
 * order, `undefined` object members omitted). Identical input structures
 * ALWAYS serialize to identical bytes — this makes "recomputing the
 * schedule over unchanged inputs yields byte-identical reminders" a
 * well-defined, testable property (the `@orbb/intents` EvidencePack
 * canonical-JSON precedent), and it is the serialization used for TASK_DUE
 * event payloads (the contracts outbox carries serialized payloads).
 *
 * Non-serializable structures (functions, symbols, bigints, `undefined`
 * outside objects, class instances other than `Date`) are rejected with a
 * PHID-safe `NotificationEngineError` — the engine only ever serializes
 * its own PHI-free payload shapes.
 */
import { NotificationEngineError } from "./errors.js";
import type { ReminderPayload } from "./payloads.js";

/** Serializes any engine-shaped structure to canonical JSON. */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new NotificationEngineError(
        "invariant-violation",
        "canonicalJson cannot serialize an invalid Date.",
      );
    }
    return JSON.stringify(value.toISOString());
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((element) => canonicalJson(element)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new NotificationEngineError(
        "invariant-violation",
        "canonicalJson cannot serialize the provided structure (unsupported runtime value).",
      );
  }
}

/** Canonical byte-stable serialization of one reminder payload. */
export function serializeReminderPayload(payload: ReminderPayload): string {
  return canonicalJson(payload);
}

/** Input shape of {@link serializeReminderSchedule}. */
export interface SerializableSchedule {
  readonly reminders: readonly unknown[];
  readonly skipped: readonly unknown[];
}

/** Canonical byte-stable serialization of a computed reminder schedule. */
export function serializeReminderSchedule(schedule: SerializableSchedule): string {
  return canonicalJson({
    reminders: schedule.reminders,
    skipped: schedule.skipped,
  });
}
