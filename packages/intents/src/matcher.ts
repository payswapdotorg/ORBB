/**
 * A40 — ResourceMatcher: the resource/capability-matching stage of the
 * intent compiler pipeline (architecture §4, M5 milestone, Lane A packet
 * M5-B).
 *
 * Given OPTIMIZED candidate plans (A39 output — or any structurally
 * compatible candidates), a person's REGISTERED SOURCES (manual/device/app
 * kinds with capabilities), and EVIDENCE-PACK COVERAGE SUMMARIES, filters
 * the set to EXECUTABLE candidates: every plan metric must have at least
 * one usable method backed by BOTH a registered source and pack coverage.
 *
 * DENY-BY-DEFAULT (mirroring the measurement lane's A28 CapabilityIndex
 * pattern, without importing @orbb/measurement — handoff recorded in
 * src/index.ts): a method is usable for a metric only when
 *   (1) the candidate proposes it for that metric,
 *   (2) at least one coverage summary entry claims (metric, method), and
 *   (3) at least one ACTIVE registered source of that person declares
 *       support for the method.
 * A metric failing (2) is dropped with a typed reason; every dropped
 * candidate carries its per-metric typed reasons
 * (`metric-uncovered | no-method | no-source`), and the matcher NEVER
 * throws for a denial.
 *
 * DETERMINISM AND PURITY: matching reads ONLY its inputs — candidates,
 * sources, coverage entries. No ambient state, no I/O, no clock. All
 * selection orders are input orders (first matching source in input
 * order, first matching coverage entry in input order, candidates and
 * metrics in candidate order), so identical inputs always produce
 * byte-identical output (asserted via `serializeResourceMatch` +
 * `hashResourceMatch`).
 *
 * RECORDED DECISIONS (genuinely unspecified points; architecture-consistent
 * choices made here for tech-lead review):
 *   - REGISTERED SOURCES mirror the measurement lane's
 *     `RegisteredMeasurementSource` shape STRUCTURALLY
 *     (`{ sourceId, personId, kind, supportedMethodIds, active }`) with
 *     the frozen domain id grammars (`SourceId`, `PersonId` via
 *     `isIdOf`) — integration passes the same records the A28 index
 *     holds. "Capabilities" are the flat `supportedMethodIds` list (the
 *     A28 precedent: a source declares the method codes it can serve);
 *     metric association arrives via the candidate's per-metric method
 *     assignment plus pack coverage, so no per-metric capability table
 *     is invented here.
 *   - NO method-kind matching is enforced between a source's kind and a
 *     method (the frozen domain `MeasurementMethod` carries no kind, and
 *     A28's own resolution checks only `supportedMethodIds`); the source
 *     kind is carried through into the binding trail for
 *     explainability. Burden kinds are an optimizer-local concern (A39).
 *   - DENY REASON CASCADE (evaluated per metric, first blocking stage
 *     reported): no coverage entry for the metric at all ->
 *     `metric-uncovered`; coverage exists but none of the candidate's
 *     proposed methods for the metric are coverage-backed -> `no-method`;
 *     coverage-backed methods exist but none has an active registered
 *     source -> `no-source`.
 *   - A candidate dropped for ONE metric is dropped ENTIRELY (every plan
 *     metric must be executable); the drop record lists the per-metric
 *     failures in candidate metric order (audit).
 *   - Coverage summaries are a THIN LOCAL structural interface
 *     (`CoverageSummaryEntry`); M5-A `EvidencePackEntry` values (and
 *     therefore `EvidencePackVersionRecord["entries"]`) satisfy it
 *     structurally — no adapter needed (proven by tests).
 *   - Expected rejections are TYPED RESULTS (never throws). Error
 *     payloads are PHID-safe: structural context only. Matched/dropped
 *     OUTPUTS carry ids (source, entry) — they are explainability
 *     artifacts, mirroring the M5-A explainability discipline.
 */
import type { PersonId, SourceId } from "@orbb/domain";
import { isIdOf } from "@orbb/domain";
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import { err, ok, type IntentResult } from "./result.js";
import type { PlanCandidateLike } from "./optimizer.js";

/**
 * `Array.isArray` narrows `readonly T[]` to `any[]` (TS intersection with
 * `any[]`), silently de-typing downstream code; this predicate narrows to
 * `readonly unknown[]` instead, which intersects correctly. Local helper —
 * mirrors the private guard pattern of the sibling M5-A modules.
 */
function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Vocabulary: registered source kinds (packet A40: manual/device/app).
// ---------------------------------------------------------------------------

/**
 * The three source kinds a person can register (mirrors the measurement
 * lane's frozen A28 vocabulary, declared locally — no
 * @orbb/measurement import; handoff recorded).
 */
export const RESOURCE_SOURCE_KINDS = ["manual", "device", "app"] as const;

export type ResourceSourceKind = (typeof RESOURCE_SOURCE_KINDS)[number];

/** Type guard: is `value` one of the three resource source kinds? */
export function isResourceSourceKind(value: unknown): value is ResourceSourceKind {
  return (
    typeof value === "string" &&
    (RESOURCE_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Inputs: registered sources, coverage summaries, matchable candidates.
// ---------------------------------------------------------------------------

/**
 * A measurement source registered for a person (manual entry, a device,
 * or an app). Structurally mirrors the measurement lane's
 * `RegisteredMeasurementSource` so integration passes the same records.
 */
export interface RegisteredResourceSource {
  /** Canonical `SourceId` (frozen domain grammar, `src_` prefix). */
  readonly sourceId: SourceId;
  /** The person the source belongs to. */
  readonly personId: PersonId;
  readonly kind: ResourceSourceKind;
  /** Non-empty list of method ids this source can serve (capabilities). */
  readonly supportedMethodIds: readonly string[];
  /** Inactive sources never back a method (deny-by-default). */
  readonly active: boolean;
}

/**
 * One EvidencePack coverage summary entry — a THIN LOCAL structural
 * interface. M5-A `EvidencePackEntry` values satisfy it structurally
 * (`{ entryId, metricId, methodId, window: { startsAt, endsAt }, count, ... }`).
 */
export interface CoverageSummaryEntry {
  /** Content-addressed pack entry id (M5-A `evpe_...`). */
  readonly entryId: string;
  readonly metricId: string;
  readonly methodId: string;
  /** Summarized observation count (positive integer, M5-A semantics). */
  readonly count: number;
  /** The coverage window the entry summarizes. */
  readonly window: { readonly startsAt: Date; readonly endsAt: Date };
}

/** The metric + the ordered methods a candidate proposes for it. */
export interface MatchableMetricMethods {
  readonly metricId: string;
  /** Proposed methods in preference order (least burden first). */
  readonly methodIds: readonly string[];
}

/**
 * The candidate shape the matcher consumes — a THIN LOCAL INTERFACE
 * (the M5-B/M5-A contract seam). M5-A `PlanCandidate` values are
 * adapted via {@link matchableFromPlanCandidate}.
 */
export interface MatchableCandidate {
  /** Unique candidate identity (M5-A: the content-derived plan id). */
  readonly candidateId: string;
  /** Per-metric method assignments; every metric must be satisfiable. */
  readonly metricMethods: readonly MatchableMetricMethods[];
}

/**
 * Adapts an M5-A `PlanCandidate` (structurally:
 * {@link PlanCandidateLike}) into a {@link MatchableCandidate}: the
 * candidate identity becomes the plan id, and the single metric's
 * method chain becomes the one per-metric assignment. Pure projection —
 * validation happens in {@link ResourceMatcher.match}.
 */
export function matchableFromPlanCandidate(
  candidate: PlanCandidateLike,
): MatchableCandidate {
  return {
    candidateId: candidate.plan.id,
    metricMethods: [
      { metricId: candidate.metricId, methodIds: [...candidate.methodOrder] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Outputs: executable candidates with binding trails + dropped audit.
// ---------------------------------------------------------------------------

/**
 * The explainability trail for one satisfied metric: which method, which
 * registered source backed it, and which coverage entry evidenced it.
 */
export interface MetricMethodBinding {
  readonly metricId: string;
  readonly methodId: string;
  /** The registered source that backs the method (first in input order). */
  readonly sourceId: SourceId;
  readonly sourceKind: ResourceSourceKind;
  /** The coverage entry that evidenced (metric, method) (first in input order). */
  readonly coverageEntryId: string;
  /** The coverage entry's summarized observation count (audit). */
  readonly coverageCount: number;
}

/** A candidate proven executable, with one binding per covered metric. */
export interface ExecutableCandidate {
  readonly candidateId: string;
  /** One binding per metric, in the candidate's metric order. */
  readonly bindings: readonly MetricMethodBinding[];
}

/** Typed reason one metric of a dropped candidate was unsatisfiable. */
export type MetricMatchFailureReason = "metric-uncovered" | "no-method" | "no-source";

/** One metric of a dropped candidate and the typed deny reason. */
export interface MetricMatchFailure {
  readonly metricId: string;
  readonly reason: MetricMatchFailureReason;
}

/** A dropped candidate: executable overall is false, with per-metric reasons. */
export interface DroppedCandidate {
  readonly candidateId: string;
  /** Failures in the candidate's metric order (audit). */
  readonly failures: readonly MetricMatchFailure[];
}

/** Match output: executable candidates (input order) + the dropped audit. */
export interface ResourceMatchOutput {
  readonly matched: readonly ExecutableCandidate[];
  readonly dropped: readonly DroppedCandidate[];
}

// ---------------------------------------------------------------------------
// Typed matcher rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reason one source was malformed. */
export type InvalidSourceReason =
  | "invalid-source-id"
  | "invalid-source-person"
  | "invalid-source-kind"
  | "invalid-supported-methods"
  | "invalid-active-flag";

/** Typed reason one coverage entry was malformed. */
export type InvalidCoverageEntryReason =
  | "invalid-entry-id"
  | "invalid-entry-metric"
  | "invalid-entry-method"
  | "invalid-entry-count"
  | "invalid-entry-window";

/** Typed reason one candidate was malformed. */
export type InvalidMatchCandidateReason =
  | "invalid-candidate-id"
  | "invalid-metric-methods"
  | "invalid-metric-assignment"
  | "duplicate-metric-assignment";

/** Typed matcher rejections — never thrown, always a result. */
export type ResourceMatchError =
  | { readonly kind: "invalid-person-id" }
  | { readonly kind: "invalid-candidates" }
  | { readonly kind: "invalid-candidate"; readonly index: number; readonly reason: InvalidMatchCandidateReason }
  | { readonly kind: "invalid-sources" }
  | { readonly kind: "invalid-source"; readonly index: number; readonly reason: InvalidSourceReason }
  | { readonly kind: "duplicate-source-id"; readonly index: number }
  | { readonly kind: "source-person-mismatch"; readonly index: number }
  | { readonly kind: "invalid-coverage" }
  | { readonly kind: "invalid-coverage-entry"; readonly index: number; readonly reason: InvalidCoverageEntryReason };

// ---------------------------------------------------------------------------
// Pure core.
// ---------------------------------------------------------------------------

/** Match input: the person, the optimized candidates, their sources, and the pack coverage. */
export interface ResourceMatchInput {
  readonly personId: PersonId;
  readonly candidates: readonly MatchableCandidate[];
  readonly sources: readonly RegisteredResourceSource[];
  /** EvidencePack coverage summaries (M5-A entries satisfy this structurally). */
  readonly coverage: readonly CoverageSummaryEntry[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateSource(
  source: RegisteredResourceSource,
  index: number,
): ResourceMatchError | undefined {
  if (typeof source !== "object" || source === null) {
    return { kind: "invalid-source", index, reason: "invalid-source-id" };
  }
  if (!isIdOf("source", source.sourceId)) {
    return { kind: "invalid-source", index, reason: "invalid-source-id" };
  }
  if (!isIdOf("person", source.personId)) {
    return { kind: "invalid-source", index, reason: "invalid-source-person" };
  }
  if (!isResourceSourceKind(source.kind)) {
    return { kind: "invalid-source", index, reason: "invalid-source-kind" };
  }
  if (
    !isReadonlyArray(source.supportedMethodIds) ||
    source.supportedMethodIds.length === 0 ||
    source.supportedMethodIds.some((methodId) => !isNonEmptyString(methodId))
  ) {
    return { kind: "invalid-source", index, reason: "invalid-supported-methods" };
  }
  if (typeof source.active !== "boolean") {
    return { kind: "invalid-source", index, reason: "invalid-active-flag" };
  }
  return undefined;
}

function validateCoverageEntry(
  entry: CoverageSummaryEntry,
): InvalidCoverageEntryReason | undefined {
  if (typeof entry !== "object" || entry === null) {
    return "invalid-entry-id";
  }
  if (!isNonEmptyString(entry.entryId)) {
    return "invalid-entry-id";
  }
  if (!isNonEmptyString(entry.metricId)) {
    return "invalid-entry-metric";
  }
  if (!isNonEmptyString(entry.methodId)) {
    return "invalid-entry-method";
  }
  if (!Number.isInteger(entry.count) || entry.count < 1) {
    return "invalid-entry-count";
  }
  const window = entry.window;
  if (
    typeof window !== "object" ||
    window === null ||
    !(window.startsAt instanceof Date) ||
    !(window.endsAt instanceof Date) ||
    Number.isNaN(window.startsAt.getTime()) ||
    Number.isNaN(window.endsAt.getTime())
  ) {
    return "invalid-entry-window";
  }
  return undefined;
}

function validateMatchCandidate(
  candidate: MatchableCandidate,
): InvalidMatchCandidateReason | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return "invalid-candidate-id";
  }
  if (!isNonEmptyString(candidate.candidateId)) {
    return "invalid-candidate-id";
  }
  if (!isReadonlyArray(candidate.metricMethods) || candidate.metricMethods.length === 0) {
    return "invalid-metric-methods";
  }
  const seenMetrics = new Set<string>();
  for (const assignment of candidate.metricMethods) {
    if (
      typeof assignment !== "object" ||
      assignment === null ||
      !isNonEmptyString(assignment.metricId)
    ) {
      return "invalid-metric-assignment";
    }
    if (
      !isReadonlyArray(assignment.methodIds) ||
      assignment.methodIds.length === 0 ||
      assignment.methodIds.some((methodId) => !isNonEmptyString(methodId))
    ) {
      return "invalid-metric-assignment";
    }
    if (seenMetrics.has(assignment.metricId)) {
      return "duplicate-metric-assignment";
    }
    seenMetrics.add(assignment.metricId);
  }
  return undefined;
}

/**
 * The pure matching core: identical inputs ALWAYS produce identical
 * outputs (byte-identical canonical serialization). All selection
 * orders are input orders (first matching source, first matching
 * coverage entry) — deterministic by construction.
 */
export function runResourceMatch(
  input: ResourceMatchInput,
): IntentResult<ResourceMatchOutput, ResourceMatchError> {
  if (typeof input !== "object" || input === null) {
    return err({ kind: "invalid-person-id" });
  }
  if (!isIdOf("person", input.personId)) {
    return err({ kind: "invalid-person-id" });
  }
  if (!isReadonlyArray(input.candidates)) {
    return err({ kind: "invalid-candidates" });
  }
  if (!isReadonlyArray(input.sources)) {
    return err({ kind: "invalid-sources" });
  }
  if (!isReadonlyArray(input.coverage)) {
    return err({ kind: "invalid-coverage" });
  }

  // Source validation (deny-by-default, typed; a source registered to a
  // different person is a mismatch, never silently ignored).
  const seenSourceIds = new Set<string>();
  for (const [index, source] of input.sources.entries()) {
    const sourceError = validateSource(source, index);
    if (sourceError !== undefined) {
      return err(sourceError);
    }
    if (seenSourceIds.has(source.sourceId)) {
      return err({ kind: "duplicate-source-id", index });
    }
    seenSourceIds.add(source.sourceId);
    if (source.personId !== input.personId) {
      return err({ kind: "source-person-mismatch", index });
    }
  }

  for (const [index, entry] of input.coverage.entries()) {
    const reason = validateCoverageEntry(entry);
    if (reason !== undefined) {
      return err({ kind: "invalid-coverage-entry", index, reason });
    }
  }

  for (const [index, candidate] of input.candidates.entries()) {
    const reason = validateMatchCandidate(candidate);
    if (reason !== undefined) {
      return err({ kind: "invalid-candidate", index, reason });
    }
  }

  // Index the coverage summaries per (metric, method) — first entry in
  // input order wins deterministically.
  const coverageByMetricMethod = new Map<string, CoverageSummaryEntry>();
  for (const entry of input.coverage) {
    const key = `${entry.metricId} ${entry.methodId}`;
    if (!coverageByMetricMethod.has(key)) {
      coverageByMetricMethod.set(key, entry);
    }
  }
  const metricsWithAnyCoverage = new Set(input.coverage.map((entry) => entry.metricId));
  const activeSources = input.sources.filter((source) => source.active);

  const matched: ExecutableCandidate[] = [];
  const dropped: DroppedCandidate[] = [];

  for (const candidate of input.candidates) {
    const bindings: MetricMethodBinding[] = [];
    const failures: MetricMatchFailure[] = [];

    for (const assignment of candidate.metricMethods) {
      const metricId = assignment.metricId;

      // (1) Pack coverage for the metric at all?
      if (!metricsWithAnyCoverage.has(metricId)) {
        failures.push({ metricId, reason: "metric-uncovered" });
        continue;
      }

      // (2) A proposed method that the pack covers for this metric?
      let bound = false;
      for (const methodId of assignment.methodIds) {
        const coverageEntry = coverageByMetricMethod.get(`${metricId} ${methodId}`);
        if (coverageEntry === undefined) {
          continue;
        }
        // (3) An active registered source that backs the method?
        const source = activeSources.find((candidateSource) =>
          candidateSource.supportedMethodIds.includes(methodId),
        );
        if (source === undefined) {
          continue;
        }
        bindings.push({
          metricId,
          methodId,
          sourceId: source.sourceId,
          sourceKind: source.kind,
          coverageEntryId: coverageEntry.entryId,
          coverageCount: coverageEntry.count,
        });
        bound = true;
        break;
      }
      if (!bound) {
        // Cascade: coverage exists for the metric; the blocking stage is
        // no proposed-method coverage (no-method) or no source behind a
        // covered method (no-source).
        const anyCoveredMethod = assignment.methodIds.some((methodId) =>
          coverageByMetricMethod.has(`${metricId} ${methodId}`),
        );
        failures.push({
          metricId,
          reason: anyCoveredMethod ? "no-source" : "no-method",
        });
      }
    }

    if (failures.length > 0) {
      dropped.push({ candidateId: candidate.candidateId, failures });
    } else {
      matched.push({ candidateId: candidate.candidateId, bindings });
    }
  }

  return ok({ matched, dropped });
}

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------

/**
 * Resource matcher — deterministic, pure, no I/O, stateless: wraps the
 * pure core {@link runResourceMatch} under the packet's class name.
 * Deny-by-default with typed reasons per dropped candidate; the output
 * preserves the explainability trail (source + coverage entry per
 * metric).
 */
export class ResourceMatcher {
  match(input: ResourceMatchInput): IntentResult<ResourceMatchOutput, ResourceMatchError> {
    return runResourceMatch(input);
  }
}

// ---------------------------------------------------------------------------
// Deterministic serialization of match outputs (determinism proof).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a match output (sorted keys, Dates as
 * epoch ms, undefined dropped). Pure and deterministic — the
 * byte-identity witness for the matcher's determinism contract.
 */
export function serializeResourceMatch(output: ResourceMatchOutput): string {
  return canonicalJsonStringify(output);
}

/**
 * Hex SHA-256 of {@link serializeResourceMatch} — the deterministic
 * serialization hash asserted by the matcher's determinism tests.
 */
export function hashResourceMatch(output: ResourceMatchOutput): string {
  return sha256Hex(serializeResourceMatch(output));
}
