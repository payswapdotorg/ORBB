/**
 * Reconciliation double for the M4 exit harness (Lane C packet M4-C).
 *
 * CONTRACT MATCHING (handoff): the interface below —
 * {@link ReconciliationServiceContract} plus the input/outcome/view/error
 * shapes — is a STRUCTURAL MATCH of the Lane A engine's landed
 * `ReconciliationService` contract (`packages/measurement/src/reconciliation.ts`,
 * commit a2a404c): the engine's
 * `reconcile(input: ReconcileInput): Promise<EngineResult<ReconcileOutcome, ReconciliationError>>`
 * is assignable to {@link ReconciliationServiceContract} because
 * `HealthResult` is the shape mirror of `EngineResult`. This packet must
 * NOT import `@orbb/measurement` (Lane A owns the engine), so the harness
 * drives THIS double — implementing the same semantics with the FROZEN
 * `@orbb/domain` primitives (`supersede`, the validation transition
 * guards, `assertObservationConformsToMetric`) — and at integration the
 * double swaps for the real engine service with zero call-site changes
 * (the double takes the metric definitions the engine's MetricCatalog
 * would resolve — recorded handoff).
 *
 * Semantics mirrored from the Lane A contract:
 *   - exactly two candidates, same person, same metric (concept code
 *     conformance via the domain guard), distinct method+source pair;
 *   - both candidates' effectiveAt inside the half-open window;
 *   - terminal candidates rejected; provenance must link to each
 *     observation (provenanceId) and name the person as subject;
 *   - deterministic ranking: quality desc (missing = 0), preferred-method
 *     order asc, observedAt desc, observation id asc;
 *   - verdict `concordant` when the values agree under the (quantity-only,
 *     injectable) tolerance — default exact equality, no invented clinical
 *     tolerances — `discordant` otherwise; discordance never blocks
 *     reconciliation;
 *   - both originals validated (pending -> validated is the legal domain
 *     transition); the loser is superseded through the DOMAIN `supersede`
 *     function (terminal `superseded` state, provenance intact); the
 *     canonical replacement (winner's value, `supersedesId` -> loser,
 *     reconciliation provenance) becomes the single current validated
 *     value; ALL THREE records are archived — no data is ever discarded.
 */
import type {
  EvidenceLabel,
  MetricDefinition,
  Observation,
  ObservationId,
  ObservationValue,
  PersonId,
  Provenance,
  ProvenanceId,
  QualityScore,
  SourceId,
  SupersededPair,
} from "@orbb/domain";
import {
  DomainInvariantError,
  assertObservationConformsToMetric,
  assertObservationValidationTransition,
  supersede,
} from "@orbb/domain";
import { err, ok, type HealthResult } from "./result.js";
import type { DraftIdSource } from "./sources.js";

// ---------------------------------------------------------------------------
// Contract shapes (structural match of the Lane A ReconciliationService).
// ---------------------------------------------------------------------------

/** The reconciliation window (half-open [startsAt, endsAt)). */
export interface ReconciliationWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** An observation candidate plus its provenance record (the caller loads both). */
export interface SourcedObservation {
  readonly observation: Observation;
  readonly provenance: Provenance;
}

/** Quality verdict of a reconciliation. */
export const RECONCILIATION_VERDICTS = ["concordant", "discordant"] as const;

export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];

/** The role an original observation played in the reconciliation. */
export type SourceRole = "canonical-source" | "superseded-source";

/** Per-source provenance record inside the canonical view. */
export interface SourceProvenanceRecord {
  readonly observationId: ObservationId;
  readonly sourceId: SourceId;
  readonly methodId: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
  readonly provenance: Provenance;
  readonly role: SourceRole;
}

/** The ONE canonical observation view: the person's current value for the metric in the window. */
export interface CanonicalObservationView {
  readonly personId: PersonId;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly value: ObservationValue;
  readonly unit: string;
  readonly window: ReconciliationWindow;
  readonly verdict: ReconciliationVerdict;
  /** The canonical (replacement) observation — the single current validated value. */
  readonly canonicalObservationId: ObservationId;
  /** Per-source provenance for EVERY original (never discarded). */
  readonly sources: readonly SourceProvenanceRecord[];
  readonly reconciledAt: Date;
  /** Provenance of the reconciliation act itself. */
  readonly reconciliationProvenanceId: ProvenanceId;
}

/** Injectable reconciliation policy. */
export interface ReconciliationPolicy {
  /** Preferred method order for ranking (earlier ranks higher; unlisted ranks last). */
  readonly preferredMethodOrder?: readonly string[];
  /**
   * Absolute agreement tolerance for quantity (number) values; default 0
   * (exact equality — no clinical tolerances are invented here).
   */
  readonly agreementTolerance?: number;
}

/** Reconcile input. */
export interface ReconcileInput {
  readonly personId: PersonId;
  readonly metricId: string;
  readonly window: ReconciliationWindow;
  /** Exactly two candidates (packet scope; more is a future extension). */
  readonly candidates: readonly SourcedObservation[];
  readonly policy?: ReconciliationPolicy;
  /** Optional correlation token threaded into the reconciliation provenance. */
  readonly correlationId?: string;
}

/** Successful reconciliation outcome. */
export interface ReconcileOutcome {
  readonly view: CanonicalObservationView;
  /** The domain supersession pair: loser (terminal) + canonical replacement (validated). */
  readonly pair: SupersededPair;
  /** The winning original — validated and retained unchanged (besides state). */
  readonly canonicalSource: Observation;
  /** Convenience alias of `pair.superseded` — the superseded original with provenance intact. */
  readonly supersededOriginal: Observation;
  /** Convenience alias of `pair.replacement` — the canonical observation. */
  readonly canonical: Observation;
}

/** Typed reconciliation rejections (PHID-safe, values never echoed). */
export type ReconciliationError =
  | { readonly kind: "candidate-count" }
  | { readonly kind: "invalid-window" }
  | { readonly kind: "metric-not-found" }
  | { readonly kind: "duplicate-candidate" }
  | { readonly kind: "person-mismatch" }
  | { readonly kind: "observation-nonconforming" }
  | { readonly kind: "not-distinct-sources" }
  | { readonly kind: "outside-window" }
  | { readonly kind: "terminal-candidate" }
  | { readonly kind: "provenance-mismatch" }
  | { readonly kind: "supersession-violation" };

/** Persistence port for the reconciliation outputs. */
export interface ObservationArchive {
  save(observation: Observation): Promise<void>;
  findById(observationId: ObservationId): Promise<Observation | undefined>;
}

/** In-memory reference `ObservationArchive` (defensive copies in and out). */
export class InMemoryObservationArchive implements ObservationArchive {
  readonly #observations = new Map<string, Observation>();

  async save(observation: Observation): Promise<void> {
    this.#observations.set(observation.id, { ...observation });
  }

  async findById(observationId: ObservationId): Promise<Observation | undefined> {
    const observation = this.#observations.get(observationId);
    return observation === undefined ? undefined : { ...observation };
  }

  /** All archived observations (test inspection; insertion order). */
  list(): readonly Observation[] {
    return [...this.#observations.values()].map((observation) => ({ ...observation }));
  }
}

/**
 * The reconciliation service contract. The Lane A engine's
 * `ReconciliationService` satisfies this interface structurally — the
 * harness double below satisfies it behaviorally for the M4 exit proof.
 */
export interface ReconciliationServiceContract {
  reconcile(input: ReconcileInput): Promise<HealthResult<ReconcileOutcome, ReconciliationError>>;
}

// ---------------------------------------------------------------------------
// The double.
// ---------------------------------------------------------------------------

/** Constructor deps for {@link ReconciliationServiceDouble} (all injectable). */
export interface ReconciliationDoubleDeps {
  /**
   * The metric definitions this double can reconcile (the harness passes
   * the SYNTH metric shapes aligned with the Lane A engine seed). The
   * engine's MetricCatalog replaces this at integration — handoff
   * recorded.
   */
  readonly metrics: readonly MetricDefinition[];
  /** Id source for the reconciliation provenance + canonical observation ids. */
  readonly ids: DraftIdSource;
  readonly nowMs: () => number;
  readonly archive: ObservationArchive;
}

/** The harness reconciliation double: assembles the canonical view with per-source provenance. */
export class ReconciliationServiceDouble implements ReconciliationServiceContract {
  readonly #metrics: readonly MetricDefinition[];
  readonly #ids: DraftIdSource;
  readonly #nowMs: () => number;
  readonly #archive: ObservationArchive;

  constructor(deps: ReconciliationDoubleDeps) {
    this.#metrics = deps.metrics;
    this.#ids = deps.ids;
    this.#nowMs = deps.nowMs;
    this.#archive = deps.archive;
  }

  async reconcile(
    input: ReconcileInput,
  ): Promise<HealthResult<ReconcileOutcome, ReconciliationError>> {
    if (!Array.isArray(input.candidates) || input.candidates.length !== 2) {
      return err({ kind: "candidate-count" });
    }
    if (!(input.window.startsAt.getTime() < input.window.endsAt.getTime())) {
      return err({ kind: "invalid-window" });
    }
    const metric = this.#metrics.find((candidate) => candidate.id === input.metricId);
    if (metric === undefined) {
      return err({ kind: "metric-not-found" });
    }
    const first = input.candidates[0] as SourcedObservation;
    const second = input.candidates[1] as SourcedObservation;
    if (first.observation.id === second.observation.id) {
      return err({ kind: "duplicate-candidate" });
    }
    for (const candidate of input.candidates) {
      if (candidate.observation.personId !== input.personId) {
        return err({ kind: "person-mismatch" });
      }
      try {
        assertObservationConformsToMetric(candidate.observation, metric);
      } catch (error) {
        if (error instanceof DomainInvariantError) {
          return err({ kind: "observation-nonconforming" });
        }
        throw error;
      }
      if (candidate.provenance.provenanceId !== candidate.observation.provenanceId) {
        return err({ kind: "provenance-mismatch" });
      }
      if (candidate.provenance.subject !== input.personId) {
        return err({ kind: "provenance-mismatch" });
      }
      if (
        candidate.observation.validationState === "rejected" ||
        candidate.observation.validationState === "superseded"
      ) {
        return err({ kind: "terminal-candidate" });
      }
      const effectiveAt = candidate.observation.effectiveAt.getTime();
      if (
        effectiveAt < input.window.startsAt.getTime() ||
        effectiveAt >= input.window.endsAt.getTime()
      ) {
        return err({ kind: "outside-window" });
      }
    }
    const sameMethodAndSource =
      first.observation.methodId === second.observation.methodId &&
      first.observation.sourceId === second.observation.sourceId;
    if (sameMethodAndSource) {
      return err({ kind: "not-distinct-sources" });
    }

    const [winner, loser] = rankCandidates(
      first,
      second,
      input.policy?.preferredMethodOrder ?? [],
    );
    const verdict =
      agree(
        winner.observation.value,
        loser.observation.value,
        input.policy?.agreementTolerance ?? 0,
      )
        ? "concordant"
        : "discordant";

    const winnerValidated = validateObservation(winner.observation);
    const loserValidated = validateObservation(loser.observation);

    const reconciliationProvenanceId = this.#ids.next("prov") as ProvenanceId;
    const now = new Date(this.#nowMs());
    const replacement: Observation = {
      id: this.#ids.next("obs") as Observation["id"],
      personId: input.personId,
      conceptCode: winner.observation.conceptCode,
      value: winner.observation.value,
      unit: winner.observation.unit,
      effectiveAt: winner.observation.effectiveAt,
      observedAt: now,
      sourceId: winner.observation.sourceId,
      methodId: winner.observation.methodId,
      ...(winner.observation.evidenceId !== undefined
        ? { evidenceId: winner.observation.evidenceId }
        : {}),
      ...(winner.observation.quality !== undefined
        ? { quality: winner.observation.quality }
        : {}),
      validationState: "pending",
      provenanceId: reconciliationProvenanceId,
      evidenceLabel: winner.observation.evidenceLabel,
      supersedesId: loser.observation.id,
    };
    let pair: SupersededPair;
    try {
      pair = supersede(loserValidated, replacement);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "supersession-violation" });
      }
      throw error;
    }

    // Persist all three: nothing is discarded.
    await this.#archive.save(pair.superseded);
    await this.#archive.save(winnerValidated);
    await this.#archive.save(pair.replacement);

    const view: CanonicalObservationView = {
      personId: input.personId,
      metricId: input.metricId,
      conceptCode: metric.conceptCode,
      value: winner.observation.value,
      unit: winner.observation.unit,
      window: {
        startsAt: new Date(input.window.startsAt.getTime()),
        endsAt: new Date(input.window.endsAt.getTime()),
      },
      verdict,
      canonicalObservationId: pair.replacement.id,
      sources: [
        sourcedRecord(winner, "canonical-source"),
        sourcedRecord(loser, "superseded-source"),
      ],
      reconciledAt: now,
      reconciliationProvenanceId,
    };
    return ok({
      view,
      pair,
      canonicalSource: winnerValidated,
      supersededOriginal: pair.superseded,
      canonical: pair.replacement,
    });
  }
}

/**
 * Deterministic total order: quality desc (missing = 0), preferred-method
 * index asc (unlisted = Infinity), observedAt desc, id asc.
 */
function rankCandidates(
  a: SourcedObservation,
  b: SourcedObservation,
  preferredMethodOrder: readonly string[],
): [SourcedObservation, SourcedObservation] {
  const qualityOf = (candidate: SourcedObservation): number =>
    candidate.observation.quality ?? 0;
  const methodIndexOf = (candidate: SourcedObservation): number => {
    const index = preferredMethodOrder.indexOf(candidate.observation.methodId);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const aQuality = qualityOf(a);
  const bQuality = qualityOf(b);
  if (aQuality !== bQuality) {
    return aQuality > bQuality ? [a, b] : [b, a];
  }
  const aMethodIndex = methodIndexOf(a);
  const bMethodIndex = methodIndexOf(b);
  if (aMethodIndex !== bMethodIndex) {
    return aMethodIndex < bMethodIndex ? [a, b] : [b, a];
  }
  const aObserved = a.observation.observedAt.getTime();
  const bObserved = b.observation.observedAt.getTime();
  if (aObserved !== bObserved) {
    return aObserved > bObserved ? [a, b] : [b, a];
  }
  return a.observation.id <= b.observation.id ? [a, b] : [b, a];
}

/** Do two observation values agree under the (quantity-only) tolerance? */
function agree(a: ObservationValue, b: ObservationValue, tolerance: number): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= tolerance;
  }
  return a === b;
}

/** pending -> validated via the domain transition guard (validated stays). */
function validateObservation(observation: Observation): Observation {
  if (observation.validationState === "validated") {
    return observation;
  }
  assertObservationValidationTransition(observation.validationState, "validated");
  return { ...observation, validationState: "validated" };
}

function sourcedRecord(
  candidate: SourcedObservation,
  role: SourceRole,
): SourceProvenanceRecord {
  return {
    observationId: candidate.observation.id,
    sourceId: candidate.observation.sourceId,
    methodId: candidate.observation.methodId,
    evidenceLabel: candidate.observation.evidenceLabel,
    ...(candidate.observation.quality !== undefined
      ? { quality: candidate.observation.quality }
      : {}),
    provenance: candidate.provenance,
    role,
  };
}
