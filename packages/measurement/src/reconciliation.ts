/**
 * Reconciliation service — the engine-side proof of the M4 exit
 * criterion ("a real supported metric can be acquired by at least two
 * methods and reconciled with provenance").
 *
 * Two observations of the same metric, acquired via different
 * methods/sources within one window, reconcile into ONE canonical
 * observation view with per-source provenance records and a quality
 * verdict. Data is NEVER discarded:
 *   - the losing original is superseded via the frozen DOMAIN
 *     `supersede()` function (it moves to the terminal `superseded`
 *     validation state with its `provenanceId` intact — provenance
 *     preserved by the domain invariant set);
 *   - the winning original is validated and retained as-is;
 *   - a canonical replacement observation (carrying `supersedesId` ->
 *     loser) is created with reconciliation provenance and becomes the
 *     single current validated value.
 *
 * RECORDED ASSUMPTION (single-predecessor grammar): the domain
 * supersession grammar links ONE replacement to ONE predecessor
 * (`supersedesId` is scalar). With two originals, the canonical
 * replacement supersedes the LOSER; the WINNER stays validated and the
 * canonical view carries per-source provenance records for BOTH
 * originals, so nothing is lost and the view is single. A
 * multi-predecessor `supersedesIds` would be a domain change — handoff
 * recorded.
 *
 * Ranking (deterministic total order): domain quality score descending
 * (missing quality ranks as 0 — recorded assumption), then the policy's
 * preferred method order, then later `observedAt`, then observation id
 * ascending as the final tiebreak.
 *
 * Verdict: `concordant` when the values agree under the agreement policy
 * (default: exact equality — no clinical tolerances are invented;
 * quantity-only absolute tolerance is injectable); `discordant`
 * otherwise. Discordance never blocks reconciliation — the higher-ranked
 * value becomes canonical and the verdict flags the divergence.
 *
 * The E2E harness (Lane C packet) drives THESE service interfaces over
 * an in-memory archive — handoff recorded. All expected rejections are
 * typed results; the domain supersession/validation guards are invoked
 * and their `DomainInvariantError`s converted at this boundary.
 */
import type {
  EvidenceLabel,
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
import type { Clock, IdFactory } from "@orbb/testkit";
import { err, ok, type EngineResult } from "./result.js";
import type { MetricCatalog } from "./catalog.js";

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

/**
 * The ONE canonical observation view: what the person's current value for
 * the metric is within the window, where it came from, and what the
 * reconciliation decided.
 */
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

/** Persistence port for the reconciliation outputs (async — db adapter handoff recorded). */
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
}

/** Constructor deps (all injectable). */
export interface ReconciliationServiceDeps {
  readonly catalog: MetricCatalog;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly archive: ObservationArchive;
}

/** Reconciles same-metric, different-method observations within a window. */
export class ReconciliationService {
  readonly #catalog: MetricCatalog;
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #archive: ObservationArchive;

  constructor(deps: ReconciliationServiceDeps) {
    this.#catalog = deps.catalog;
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#archive = deps.archive;
  }

  async reconcile(
    input: ReconcileInput,
  ): Promise<EngineResult<ReconcileOutcome, ReconciliationError>> {
    if (
      !Array.isArray(input.candidates) ||
      input.candidates.length !== 2
    ) {
      return err({ kind: "candidate-count" });
    }
    if (!(input.window.startsAt.getTime() < input.window.endsAt.getTime())) {
      return err({ kind: "invalid-window" });
    }
    const metric = this.#catalog.resolveActive(input.metricId);
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
      const startsAt = input.window.startsAt.getTime();
      const endsAt = input.window.endsAt.getTime();
      if (effectiveAt < startsAt || effectiveAt >= endsAt) {
        return err({ kind: "outside-window" });
      }
    }
    const sameMethodAndSource =
      first.observation.methodId === second.observation.methodId &&
      first.observation.sourceId === second.observation.sourceId;
    if (sameMethodAndSource) {
      return err({ kind: "not-distinct-sources" });
    }

    // Deterministic ranking: winner feeds the canonical value.
    const [winner, loser] = rankCandidates(
      first,
      second,
      input.policy?.preferredMethodOrder ?? [],
    );
    const verdict = agree(winner.observation.value, loser.observation.value, input.policy?.agreementTolerance ?? 0)
      ? "concordant"
      : "discordant";

    // Validate the originals (pending -> validated is the legal domain
    // transition; already-validated records stay put).
    const winnerValidated = validateObservation(winner.observation);
    const loserValidated = validateObservation(loser.observation);

    // Canonical replacement: winner's value, loser as predecessor,
    // reconciliation provenance, pending -> validated via the DOMAIN
    // supersession function.
    const reconciliationProvenanceId = this.#ids.next("prov") as ProvenanceId;
    const now = this.#clock.now();
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
      window: { startsAt: new Date(input.window.startsAt.getTime()), endsAt: new Date(input.window.endsAt.getTime()) },
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
  const qualityOf = (candidate: SourcedObservation): number => candidate.observation.quality ?? 0;
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
