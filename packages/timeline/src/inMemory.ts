/**
 * In-memory reference implementations of the three timeline store ports
 * — the deterministic doubles used by this package's tests and by the
 * future Lane-C E2E harness (the @orbb/measurement precedent:
 * `InMemoryObservationArchive`, `InMemoryMeasurementTaskStore`).
 *
 * DB-ADAPTER HANDOFF (recorded, not performed here): the real adapters
 * implement the same three ports against the Postgres repositories
 * (`@orbb/db`), pushing the inclusive window bounds into the query and
 * reconstructing canonical same-metric observation sets from the
 * persisted supersession graph (supersedesId chains + reconciliation
 * provenance). Nothing in this file is production persistence.
 *
 * Defensive-copy discipline: records are copied in and out — callers
 * can never mutate store contents through returned references (the
 * @orbb/measurement in-memory precedent).
 */
import type { HealthIntent, PersonId } from "@orbb/domain";
import type { MeasurementTask } from "@orbb/measurement";
import type {
  CanonicalObservationRecord,
  IntentTimelineStore,
  ObservationTimelineStore,
  TaskTimelineStore,
  TimelineWindowBounds,
} from "./ports.js";
import type { TimelineObservationSourceProvenance } from "./entries.js";

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Inclusive bounds check on a timeline instant. */
function withinBounds(instant: Date, bounds: TimelineWindowBounds): boolean {
  const at = instant.getTime();
  if (bounds.from !== undefined && at < bounds.from.getTime()) {
    return false;
  }
  if (bounds.to !== undefined && at > bounds.to.getTime()) {
    return false;
  }
  return true;
}

function cloneSource(source: TimelineObservationSourceProvenance): TimelineObservationSourceProvenance {
  return {
    observationId: source.observationId,
    sourceId: source.sourceId,
    methodId: source.methodId,
    evidenceLabel: source.evidenceLabel,
    ...(source.quality !== undefined ? { quality: source.quality } : {}),
    provenanceId: source.provenanceId,
    role: source.role,
  };
}

function cloneObservationRecord(
  record: CanonicalObservationRecord,
): CanonicalObservationRecord {
  return {
    canonical: {
      ...record.canonical,
      effectiveAt: new Date(record.canonical.effectiveAt.getTime()),
      observedAt: new Date(record.canonical.observedAt.getTime()),
    },
    sources: record.sources.map(cloneSource),
  };
}

/**
 * In-memory reference `ObservationTimelineStore`. Records are keyed by
 * the canonical observation's id and indexed by person; `put` accepts
 * records in any order (deterministic read-back: insertion order is
 * preserved, and the service's total order makes assembly
 * permutation-invariant anyway).
 */
export class InMemoryObservationTimelineStore implements ObservationTimelineStore {
  readonly #byPerson = new Map<string, CanonicalObservationRecord[]>();

  /** Adds (or replaces, by canonical id) one canonical observation record. */
  put(record: CanonicalObservationRecord): void {
    const personRecords = this.#byPerson.get(record.canonical.personId) ?? [];
    const index = personRecords.findIndex(
      (candidate) => candidate.canonical.id === record.canonical.id,
    );
    const copy = cloneObservationRecord(record);
    if (index < 0) {
      personRecords.push(copy);
    } else {
      personRecords[index] = copy;
    }
    this.#byPerson.set(record.canonical.personId, personRecords);
  }

  async findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly CanonicalObservationRecord[]> {
    const records = this.#byPerson.get(personId) ?? [];
    return records
      .filter((record) => withinBounds(record.canonical.effectiveAt, bounds))
      .map(cloneObservationRecord);
  }
}

/** In-memory reference `TaskTimelineStore`. */
export class InMemoryTaskTimelineStore implements TaskTimelineStore {
  readonly #byPerson = new Map<string, MeasurementTask[]>();

  /** Adds (or replaces, by task id) one measurement task record. */
  put(task: MeasurementTask): void {
    const personTasks = this.#byPerson.get(task.personId) ?? [];
    const index = personTasks.findIndex((candidate) => candidate.id === task.id);
    const copy: MeasurementTask = {
      ...task,
      window: {
        sequence: task.window.sequence,
        startsAt: new Date(task.window.startsAt.getTime()),
        endsAt: new Date(task.window.endsAt.getTime()),
      },
      createdAt: new Date(task.createdAt.getTime()),
    };
    if (index < 0) {
      personTasks.push(copy);
    } else {
      personTasks[index] = copy;
    }
    this.#byPerson.set(task.personId, personTasks);
  }

  async findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly MeasurementTask[]> {
    const tasks = this.#byPerson.get(personId) ?? [];
    return tasks
      .filter((task) => withinBounds(task.window.endsAt, bounds))
      .map((task) => ({
        ...task,
        window: {
          sequence: task.window.sequence,
          startsAt: new Date(task.window.startsAt.getTime()),
          endsAt: new Date(task.window.endsAt.getTime()),
        },
        createdAt: new Date(task.createdAt.getTime()),
      }));
  }
}

/** In-memory reference `IntentTimelineStore`. */
export class InMemoryIntentTimelineStore implements IntentTimelineStore {
  readonly #byPerson = new Map<string, HealthIntent[]>();

  /** Adds (or replaces, by intent id) one health intent record. */
  put(intent: HealthIntent): void {
    const personIntents = this.#byPerson.get(intent.personId) ?? [];
    const index = personIntents.findIndex((candidate) => candidate.id === intent.id);
    const copy: HealthIntent = { ...intent, createdAt: new Date(intent.createdAt.getTime()) };
    if (index < 0) {
      personIntents.push(copy);
    } else {
      personIntents[index] = copy;
    }
    this.#byPerson.set(intent.personId, personIntents);
  }

  async findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly HealthIntent[]> {
    const intents = this.#byPerson.get(personId) ?? [];
    return intents
      .filter((intent) => withinBounds(intent.createdAt, bounds))
      .map((intent) => ({ ...intent, createdAt: new Date(intent.createdAt.getTime()) }));
  }
}

/** Guards a Date is valid (used by harnesses feeding these stores). */
export function isValidTimestamp(value: unknown): value is Date {
  return isTimestamp(value);
}
