/**
 * A42 — AI proposal seam: the typed port behind which every AI-driven
 * intent-plan suggestion lives (architecture §8, M5 milestone, Lane C
 * packet M5-C).
 *
 * THE §8 BOUNDARY (frozen):
 *   - AI NEVER DECIDES. A model may only PROPOSE; deterministic policy
 *     and authorized human actors decide what becomes authoritative
 *     state. This module encodes that boundary in TYPES:
 *       * a {@link Proposal} is NOT a plan — its {@link Proposal.candidatePlan}
 *         is a {@link ProposedDraftPlan}, a view that DELIBERATELY LACKS
 *         the domain `state` field, so it is structurally NOT assignable
 *         to the domain `MeasurementPlan` and can never be handed to a
 *         plan store, scheduler, or any state-machine consumer. Only
 *         the human review workflow (A43, `review.ts`) — which invokes
 *         the frozen domain `assertPlanTransition` guard — can promote
 *         a proposal into a published plan.
 *       * `decisionAuthority` is the LITERAL type `"none"`: this module
 *         exports no way to produce any other authority value.
 *       * the rationale trail ENDS with a `human-decision-required`
 *         step (the §8 disclaimer, stated on every artifact).
 *   - FULL PROVENANCE: every proposal carries `modelId`, `modelVersion`,
 *     `promptHash` (domain-separated SHA-256 of the exact canonical model
 *     input) and `confidence` in [0, 1] (§8: "reports confidence plus
 *     model/version provenance").
 *   - NO NETWORK, NO SDK, NO DECISION: the only implementation in this
 *     packet is {@link SyntheticProposalService}, an in-memory
 *     DETERMINISTIC double (model id `SYNTH-model-01`) that answers from
 *     a FIXED TABLE. The future real LLM wiring arrives behind the
 *     {@link LlmProposalAdapter} stub TYPE (fail-closed placeholder —
 *     {@link UnwiredLlmProposalAdapter} throws instead of calling out).
 *
 * PARALLEL-LANE DISCIPLINE (recorded): this module does NOT import the
 * M5-A/M5-B semantic modules (evidencePack/registry/compiler/optimizer/
 * matcher/safety). The shapes it consumes are THIN LOCAL INTERFACES:
 *   - {@link IntentForProposal} — structural view of a domain
 *     `HealthIntent` (id + person + objective).
 *   - {@link EvidencePackSummary} — the versioned-pack summary the
 *     packet names in the port signature; carries the version LINEAGE
 *     (audit) without the full M5-A entry schema.
 *   - {@link CandidatePlanView} / {@link SafetyOutcomeView} — the
 *     "candidate plan" and "safety outcome" shapes named by the packet,
 *     consumed as local structural views. M5-A `PlanCandidate` and M5-B
 *     `SafetyOutcome` reconcile into them at the integration boundary
 *     (adapters live in the M5 exit harness; the mapping is recorded in
 *     each view's doc).
 * The shared PACKAGE KERNEL (`./canonical.js`, `./result.js`,
 * `./errors.js`) is imported exactly as the merged M5-B modules import
 * it — it is package infrastructure, not a parallel-packet work product.
 *
 * RECORDED DECISIONS (genuinely unspecified points; safest
 * architecture-consistent choice made for tech-lead review):
 *   - The port is ASYNC (`Promise<IntentResult<...>>`): a real LLM is an
 *     I/O service (§8 "AI services"), and the platform-lane seams (M4-C
 *     native adapters) are async for the same reason. The deterministic
 *     double resolves synchronously-constructed values, so determinism
 *     and replay proofs are unaffected.
 *   - `ProposalId` is a LANE-LOCAL branded grammar `prop_<body>` (16–128
 *     URL-safe chars), mirroring the M5-A `EvidencePackId` precedent:
 *     the frozen domain canonical id kinds have no proposal kind, and
 *     promoting one is a domain change requiring tech-lead review.
 *     Proposal ids are CREATION-SCOPED (from the injected `IdFactory`)
 *     per the recorded M5-A handoff ("creation-scoped ids … arrive with
 *     the proposal/review packets"); they are NOT content-derived, so
 *     the same inputs proposed twice yield two distinct proposals (the
 *     review queue deduplicates by underlying PLAN id instead — see
 *     `review.ts`).
 *   - CONFIDENCE is a plain validated `number` in [0, 1], not the domain
 *     `QualityScore` brand: model confidence and observation quality are
 *     different concepts that merely share a range; conflating the
 *     brands would smuggle a semantic.
 *   - The double NEVER INVENTS a candidate: it may only SELECT a
 *     candidate already present in the injected `candidateContext`
 *     (produced by the deterministic compiler pipeline). A fixed-table
 *     rule referencing an absent candidate is a typed rejection, and a
 *     context with no candidates is a typed rejection (deny-by-default:
 *     an AI seam may never fabricate plan identity).
 *   - The `promptHash` is computed over the canonical JSON of the exact
 *     typed inputs `{ intent, evidencePackSummary, candidateContext }`
 *     under the domain-separation tag `orbb/intents/proposal-prompt/v1`
 *     — replayable and collision-safe across entity kinds.
 *   - The SYNTH model's fixed table keys `(metricId, methodId)` and
 *     carries the reported confidence. When no rule matches, the double
 *     deterministically proposes the FIRST candidate of the context (the
 *     compiler emits candidates least-burden-first, so the fallback is
 *     "least-burden candidate") with the fallback confidence 0.5.
 */
import { isIdOf, type IntentId, type PersonId, type PlanId } from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { canonicalJsonStringify, hashWithDomainBase64Url, sha256Hex } from "./canonical.js";
import { IntentEngineError } from "./errors.js";
import { err, ok, type IntentResult } from "./result.js";

/**
 * `Array.isArray` narrows `readonly T[]` to `any[]` (TS intersection with
 * `any[]`), silently de-typing downstream code; this predicate narrows to
 * `readonly unknown[]` instead, which intersects correctly. Local helper —
 * mirrors the private guard pattern of the sibling M5-A/M5-B modules.
 */
function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Lane-local identifier: ProposalId (prop_<body>).
// ---------------------------------------------------------------------------

declare const proposalIdBrand: unique symbol;

/** Opaque proposal identifier: `prop_<body>` (lane-local grammar). */
export type ProposalId = string & { readonly [proposalIdBrand]: "ProposalId" };

/** Fixed prefix of {@link ProposalId}. */
export const PROPOSAL_ID_PREFIX = "prop";

/** Valid body segment of the lane-local proposal id grammar. */
const PROPOSAL_ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a well-formed lane-local {@link ProposalId}? */
export function isProposalId(value: unknown): value is ProposalId {
  return (
    typeof value === "string" &&
    value.startsWith(`${PROPOSAL_ID_PREFIX}_`) &&
    PROPOSAL_ID_BODY_PATTERN.test(value.slice(PROPOSAL_ID_PREFIX.length + 1))
  );
}

// ---------------------------------------------------------------------------
// Thin local input views (the reconciliation seam to M5-A / M5-B).
// ---------------------------------------------------------------------------

/**
 * The intent view the seam consumes — a THIN LOCAL INTERFACE over the
 * domain `HealthIntent` (identity + person scope + objective). The
 * domain aggregate is the authority; this view is the MINIMIZED,
 * typed context §8 permits a model to see (no state, no pack pointer).
 */
export interface IntentForProposal {
  readonly intentId: IntentId;
  readonly personId: PersonId;
  /** Free-text objective statement (the domain `HealthIntent.objective`). */
  readonly objective: string;
}

/**
 * Versioned-evidence-pack summary — the `evidencePackSummary` of the
 * packet's port signature. A THIN LOCAL view of one ACTIVE pack version
 * (M5-A `EvidencePackVersionRecord` reconciles into it at integration):
 * identity, version, LINEAGE (ascending version numbers, the append-only
 * chain), content hash, and coverage counts. NO entries, NO quality
 * mixes — the minimized, PHI-free summary a model may reason over.
 */
export interface EvidencePackSummary {
  readonly packId: string;
  /** Positive-integer ACTIVE version this summary describes. */
  readonly version: number;
  /** Predecessor version (present exactly on versions >= 2). */
  readonly supersedesVersion?: number;
  /** The full append-only lineage (ascending, ending at `version`). */
  readonly lineage: readonly number[];
  /** Hex SHA-256 of the pack version's canonical content. */
  readonly contentHash: string;
  /** Distinct metric ids with at least one summarized entry. */
  readonly coveredMetricIds: readonly string[];
  /** Total summarized capability entries in this version. */
  readonly entryCount: number;
}

/**
 * A candidate-plan view — the "candidate plan" shape named by the
 * packet. A THIN LOCAL view of one M5-A `PlanCandidate` (integration
 * adapter: strip the draft `state` field from `PlanCandidate.plan`,
 * carry the explainability scalars the model may cite). The view carries
 * the coverage + burden facts a proposal's rationale can reference —
 * never raw values, never PHI.
 */
export interface CandidatePlanView {
  /** The DRAFT plan view — NO lifecycle `state` (a view, not a plan). */
  readonly plan: ProposedDraftPlan;
  readonly metricId: string;
  readonly conceptCode: string;
  readonly methodId: string;
  /** Ordered method chain of the candidate (the proposed method first). */
  readonly methodOrder: readonly string[];
  /** Backing pack version (from the candidate's explainability). */
  readonly packVersion: number;
  /** Total observations summarized by the backing entries. */
  readonly totalObservationCount: number;
  /** Burden rank of the proposed method (lower = less burden). */
  readonly methodRelativeBurden: number;
}

/**
 * A safety-outcome view — the "safety outcome" shape named by the
 * packet. A THIN LOCAL view of one M5-B `SafetyOutcome` (integration
 * adapter: project `kind`, the review/publishable literals, and the
 * escalate reason codes; fired-rule records stay in the engine). The
 * model REPORTS this context; it never evaluates safety itself.
 */
export interface SafetyOutcomeView {
  /** Candidate (draft plan id) this outcome adjudicates. */
  readonly candidateId: string;
  readonly kind: "PASS" | "ESCALATE" | "REJECT";
  readonly requiresHumanReview: boolean;
  readonly publishable: boolean;
  /** Escalate/Reject reason codes (empty on PASS). */
  readonly reasonCodes: readonly string[];
}

/** The deterministic pipeline output the seam consumes. */
export interface CandidateContext {
  /**
   * Compiled candidate plans (burden-ordered by the producing pipeline;
   * the double's fallback selects the first). Must be non-empty — a
   * model may only propose what the deterministic compiler produced.
   */
  readonly candidates: readonly CandidatePlanView[];
  /** Safety-gate outcomes for the candidates (may be partial or absent). */
  readonly safetyOutcomes: readonly SafetyOutcomeView[];
}

// ---------------------------------------------------------------------------
// The proposal artifact (a Proposal is NOT a plan — type-encoded).
// ---------------------------------------------------------------------------

/**
 * A DRAFT plan view with NO lifecycle `state` field. Because the domain
 * `MeasurementPlan` REQUIRES `state`, this shape is structurally NOT a
 * plan: it cannot be assigned to a `MeasurementPlan`, saved to a plan
 * store, or consumed by any state-machine code. ONLY the human review
 * workflow (A43) reconstructs a domain plan from this view and promotes
 * it through the frozen `assertPlanTransition` guard.
 */
export interface ProposedDraftPlan {
  readonly id: PlanId;
  readonly personId: PersonId;
  readonly intentId: IntentId;
  /** Metric concept codes this draft commits to measure (non-empty). */
  readonly metrics: readonly string[];
  readonly createdAt: Date;
}

/** Model provenance — §8 requires it on every AI artifact. */
export interface ProposalProvenance {
  readonly modelId: string;
  readonly modelVersion: string;
  /** Domain-separated SHA-256 of the exact canonical model input. */
  readonly promptHash: string;
  /** Reported confidence, a finite number in [0, 1]. */
  readonly confidence: number;
}

/** The pack reference a proposal was derived from (audit: lineage used). */
export interface EvidencePackRef {
  readonly packId: string;
  readonly version: number;
  readonly supersedesVersion?: number;
  /** Ascending version lineage ending at `version`. */
  readonly lineage: readonly number[];
  readonly contentHash: string;
}

/** Stable rationale-step vocabulary (structured audit, not prose). */
export const RATIONALE_STEP_KINDS = [
  "evidence-considered",
  "candidates-reviewed",
  "candidate-selected",
  "safety-context-noted",
  "human-decision-required",
] as const;

export type RationaleStepKind = (typeof RATIONALE_STEP_KINDS)[number];

/**
 * Structured references a rationale step considered (ids, versions,
 * counts — PHID-free by construction; never values, never actor ids).
 */
export type RationaleRef =
  | {
      readonly kind: "pack";
      readonly packId: string;
      readonly version: number;
      readonly lineage: readonly number[];
    }
  | { readonly kind: "metric"; readonly metricId: string }
  | { readonly kind: "method"; readonly methodId: string; readonly relativeBurden: number }
  | { readonly kind: "coverage"; readonly observationCount: number }
  | { readonly kind: "candidate"; readonly planId: string }
  | {
      readonly kind: "safety";
      readonly outcomeKind: "PASS" | "ESCALATE" | "REJECT" | "none";
      readonly reasonCodes: readonly string[];
    };

/** One step of the rationale trail (explainability discipline of the lane). */
export interface RationaleStep {
  readonly kind: RationaleStepKind;
  /** Fixed-template statement (the double's templates are deterministic). */
  readonly statement: string;
  /** Structured inputs the step considered. */
  readonly refs: readonly RationaleRef[];
}

/**
 * A model proposal — §8 artifact with NO decision authority.
 *
 * INVARIANT (type-encoded): `candidatePlan` is a {@link ProposedDraftPlan}
 * (no `state`), `decisionAuthority` is the literal `"none"`, and the
 * rationale trail's final step is `human-decision-required`. Nothing in
 * this module (or anywhere outside `review.ts`) can turn a Proposal
 * into authoritative state.
 */
export interface Proposal {
  readonly id: ProposalId;
  readonly intentId: IntentId;
  readonly personId: PersonId;
  /**
   * The candidate plan the model proposes — a VIEW, never a domain plan
   * (no lifecycle `state`); only a review approval can promote it.
   */
  readonly candidatePlan: ProposedDraftPlan;
  /** Identity of the selected candidate (equals its draft plan id). */
  readonly selectedCandidateId: string;
  /** The deterministic safety-gate view for the selected candidate, if any. */
  readonly selectedSafetyOutcome?: SafetyOutcomeView;
  /** Structured explainability trail (ends with human-decision-required). */
  readonly rationaleTrail: readonly RationaleStep[];
  readonly provenance: ProposalProvenance;
  /** LITERAL `"none"`: a Proposal carries no decision authority (§8). */
  readonly decisionAuthority: "none";
  /** The versioned pack reference this proposal was derived from. */
  readonly evidencePack: EvidencePackRef;
  /** Proposal instant (injected clock — deterministic per clock state). */
  readonly proposedAt: Date;
}

// ---------------------------------------------------------------------------
// Typed seam rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reasons a proposal request is denied (never throws). */
export type ProposalError =
  | { readonly kind: "invalid-intent" }
  | { readonly kind: "invalid-pack-summary" }
  | { readonly kind: "invalid-candidate-context" }
  | { readonly kind: "invalid-candidate"; readonly candidateIndex: number }
  | { readonly kind: "invalid-safety-outcome"; readonly outcomeIndex: number }
  | { readonly kind: "duplicate-candidate-ids"; readonly candidateIndex: number }
  | { readonly kind: "no-candidates" }
  | { readonly kind: "unknown-candidate" };

// ---------------------------------------------------------------------------
// The port (§8 boundary) + the deterministic SYNTH double.
// ---------------------------------------------------------------------------

/**
 * The AI proposal service PORT (A42). Implementations sit behind the §8
 * boundary: they receive typed, minimized context and may only return a
 * {@link Proposal} — never a plan, never a state mutation. The signature
 * is the packet's: `proposePlan(intent, evidencePackSummary,
 * candidateContext)`.
 */
export interface ProposalService {
  proposePlan(
    intent: IntentForProposal,
    evidencePackSummary: EvidencePackSummary,
    candidateContext: CandidateContext,
  ): Promise<IntentResult<Proposal, ProposalError>>;
}

/** One rule of the SYNTH model's fixed table. */
export interface SyntheticProposalRule {
  /** Metric the rule targets (matches a candidate's metricId). */
  readonly metricId: string;
  /** Method the rule prefers (the candidate proposing this method). */
  readonly methodId: string;
  /** Confidence the SYNTH model reports for this selection. */
  readonly confidence: number;
}

/**
 * The fixed proposal table of the deterministic double (SYNTH-marked
 * metric/method vocabulary mirroring the M5-A/M5-B test fixtures; the
 * first matching rule in table order wins).
 */
export const DEFAULT_SYNTH_PROPOSAL_TABLE: readonly SyntheticProposalRule[] = [
  {
    metricId: "SYNTH-metric-blood-pressure",
    methodId: "SYNTH-method-bp-cuff",
    confidence: 0.86,
  },
  {
    metricId: "SYNTH-metric-step-count",
    methodId: "SYNTH-method-steps-wearable",
    confidence: 0.92,
  },
  {
    metricId: "SYNTH-metric-sleep-hours",
    methodId: "SYNTH-method-sleep-wearable",
    confidence: 0.88,
  },
];

/** Confidence reported when no fixed-table rule matches (fallback). */
export const SYNTH_FALLBACK_CONFIDENCE = 0.5;

/** Model identity of the deterministic double. */
export const SYNTH_MODEL_ID = "SYNTH-model-01";

/** Model version of the deterministic double. */
export const SYNTH_MODEL_VERSION = "1.0.0";

/** Domain-separation tag for the prompt hash. */
const PROPOSAL_PROMPT_DOMAIN = "orbb/intents/proposal-prompt/v1";

/** Constructor deps for the deterministic double (all injectable). */
export interface SyntheticProposalServiceDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Fixed table (defaults to {@link DEFAULT_SYNTH_PROPOSAL_TABLE}). */
  readonly table?: readonly SyntheticProposalRule[];
}

/**
 * In-memory DETERMINISTIC double of {@link ProposalService}
 * (model id `SYNTH-model-01`): answers strictly from a FIXED TABLE, is
 * pure over (inputs, injected clock/id state), and performs no I/O.
 * Same inputs + same injected state => byte-identical proposals
 * (asserted via {@link serializeProposal} + {@link hashProposal}).
 */
export class SyntheticProposalService implements ProposalService {
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #table: readonly SyntheticProposalRule[];

  constructor(deps: SyntheticProposalServiceDeps) {
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    const table = deps.table ?? DEFAULT_SYNTH_PROPOSAL_TABLE;
    assertSyntheticTable(table);
    this.#table = table;
  }

  async proposePlan(
    intent: IntentForProposal,
    evidencePackSummary: EvidencePackSummary,
    candidateContext: CandidateContext,
  ): Promise<IntentResult<Proposal, ProposalError>> {
    if (
      typeof intent !== "object" ||
      intent === null ||
      !isIdOf("intent", intent.intentId) ||
      !isIdOf("person", intent.personId) ||
      typeof intent.objective !== "string" ||
      intent.objective.length === 0
    ) {
      return err({ kind: "invalid-intent" });
    }

    const packError = validatePackSummary(evidencePackSummary);
    if (packError !== undefined) {
      return err(packError);
    }

    const contextError = validateCandidateContext(candidateContext);
    if (contextError !== undefined) {
      return err(contextError);
    }

    // Selection: the first fixed-table rule matching a context candidate.
    let selected: CandidatePlanView | undefined;
    let confidence = SYNTH_FALLBACK_CONFIDENCE;
    let viaRule = false;
    for (const rule of this.#table) {
      const match = candidateContext.candidates.find(
        (candidate) => candidate.metricId === rule.metricId && candidate.methodId === rule.methodId,
      );
      if (match !== undefined) {
        selected = match;
        confidence = rule.confidence;
        viaRule = true;
        break;
      }
    }
    if (selected === undefined) {
      // Deterministic fallback: the FIRST context candidate (the compiler
      // emits least-burden-first, so this is the least-burden candidate).
      selected = candidateContext.candidates[0];
      if (selected === undefined) {
        return err({ kind: "no-candidates" });
      }
    }
    // Defense-in-depth: the selected view must reference an input candidate
    // (the double can never fabricate identity — the table or the context
    // is inconsistent, which is a typed rejection, never an invented plan).
    if (
      !candidateContext.candidates.some(
        (candidate) => candidate.plan.id === selected?.plan.id,
      )
    ) {
      return err({ kind: "unknown-candidate" });
    }
    // The selected candidate must BELONG to the intent's person + intent —
    // the double never proposes another person's (or another intent's) plan.
    if (
      selected.plan.personId !== intent.personId ||
      selected.plan.intentId !== intent.intentId
    ) {
      return err({ kind: "invalid-candidate-context" });
    }

    const safety = candidateContext.safetyOutcomes.find(
      (outcome) => outcome.candidateId === selected?.plan.id,
    );
    const proposedAt = this.#clock.now();
    const promptHash = hashWithDomainBase64Url(PROPOSAL_PROMPT_DOMAIN, {
      intent,
      evidencePackSummary,
      candidateContext,
    });

    const rationale: RationaleStep[] = [
      {
        kind: "evidence-considered",
        statement:
          `Evidence pack ${evidencePackSummary.packId} version ${evidencePackSummary.version} ` +
          `(lineage ${[...evidencePackSummary.lineage].join("<-")}) summarizes ` +
          `${evidencePackSummary.entryCount} capability entries covering ` +
          `${evidencePackSummary.coveredMetricIds.length} metrics.`,
        refs: [
          {
            kind: "pack",
            packId: evidencePackSummary.packId,
            version: evidencePackSummary.version,
            lineage: [...evidencePackSummary.lineage],
          },
        ],
      },
      {
        kind: "candidates-reviewed",
        statement:
          `Reviewed ${candidateContext.candidates.length} deterministic candidates ` +
          `compiled from the active pack version.`,
        refs: candidateContext.candidates.map((candidate) => ({
          kind: "candidate" as const,
          planId: candidate.plan.id,
        })),
      },
      {
        kind: "candidate-selected",
        statement:
          `Proposing candidate ${selected.plan.id} (metric ${selected.metricId} via method ` +
          `${selected.methodId}, burden rank ${selected.methodRelativeBurden}, ` +
          `${selected.totalObservationCount} backing observations) selected ` +
          `${viaRule ? "by the SYNTH fixed table" : "as the least-burden fallback"}.`,
        refs: [
          { kind: "metric", metricId: selected.metricId },
          { kind: "method", methodId: selected.methodId, relativeBurden: selected.methodRelativeBurden },
          { kind: "coverage", observationCount: selected.totalObservationCount },
          { kind: "candidate", planId: selected.plan.id },
        ],
      },
      {
        kind: "safety-context-noted",
        statement:
          safety === undefined
            ? "Deterministic safety gate reported no outcome for the proposed candidate; the model does not evaluate safety itself."
            : `Deterministic safety gate reported ${safety.kind} for the proposed candidate` +
              (safety.reasonCodes.length > 0
                ? ` (${safety.reasonCodes.join(", ")}); the model does not evaluate safety itself.`
                : "; the model does not evaluate safety itself."),
        refs: [
          {
            kind: "safety",
            outcomeKind: safety === undefined ? "none" : safety.kind,
            reasonCodes: safety === undefined ? [] : [...safety.reasonCodes],
          },
        ],
      },
      {
        kind: "human-decision-required",
        statement:
          "This proposal carries no decision authority: a human reviewer must approve (with edits) or reject it before any plan is published.",
        refs: [
          { kind: "candidate", planId: selected.plan.id },
        ],
      },
    ];

    return ok({
      id: this.#ids.next(PROPOSAL_ID_PREFIX) as ProposalId,
      intentId: intent.intentId,
      personId: intent.personId,
      candidatePlan: {
        id: selected.plan.id,
        personId: selected.plan.personId,
        intentId: selected.plan.intentId,
        metrics: [...selected.plan.metrics],
        createdAt: selected.plan.createdAt,
      },
      selectedCandidateId: selected.plan.id,
      ...(safety !== undefined
        ? {
            selectedSafetyOutcome: {
              candidateId: safety.candidateId,
              kind: safety.kind,
              requiresHumanReview: safety.requiresHumanReview,
              publishable: safety.publishable,
              reasonCodes: [...safety.reasonCodes],
            },
          }
        : {}),
      rationaleTrail: rationale,
      provenance: {
        modelId: SYNTH_MODEL_ID,
        modelVersion: SYNTH_MODEL_VERSION,
        promptHash,
        confidence,
      },
      decisionAuthority: "none",
      evidencePack: {
        packId: evidencePackSummary.packId,
        version: evidencePackSummary.version,
        ...(evidencePackSummary.supersedesVersion !== undefined
          ? { supersedesVersion: evidencePackSummary.supersedesVersion }
          : {}),
        lineage: [...evidencePackSummary.lineage],
        contentHash: evidencePackSummary.contentHash,
      },
      proposedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Future real-LLM wiring: stub adapter TYPE (no network, no SDK, no impl).
// ---------------------------------------------------------------------------

/**
 * The future real-LLM adapter CONTRACT (stub type only — nothing in this
 * packet implements it against a network). A real implementation:
 *   - renders the typed, minimized context into its prompt,
 *   - invokes its model (I/O — the reason the seam is async),
 *   - returns a SELECTION (an existing candidate's plan id) plus
 *     confidence and rationale statements.
 * The wrapping `ProposalService` implementation remains the §8 boundary:
 * it VALIDATES the adapter's selection against the injected candidate
 * context (a model that hallucinates an unknown candidate is a typed
 * `unknown-candidate` rejection, never an invented plan) and stamps the
 * provenance (model id/version + prompt hash + confidence).
 */
export interface LlmProposalAdapter {
  readonly modelId: string;
  readonly modelVersion: string;
  selectCandidate(request: LlmProposalAdapterRequest): Promise<LlmProposalAdapterResponse>;
}

/** The typed request a real adapter receives (minimized context + prompt). */
export interface LlmProposalAdapterRequest {
  readonly intent: IntentForProposal;
  readonly evidencePackSummary: EvidencePackSummary;
  readonly candidateContext: CandidateContext;
  /** The canonical rendering the adapter's provenance commits to hash. */
  readonly prompt: string;
}

/** The raw model response a real adapter returns (validated upstream). */
export interface LlmProposalAdapterResponse {
  /** The candidate (draft plan id) the model selected. */
  readonly selectedCandidatePlanId: string;
  /** Reported confidence in [0, 1] (validated upstream). */
  readonly confidence: number;
  /** Free-form rationale statements (upstream wraps them into the trail). */
  readonly rationaleStatements: readonly string[];
}

/**
 * Fail-closed placeholder proving the {@link LlmProposalAdapter} seam
 * compiles without wiring any network: every call throws
 * {@link IntentEngineError}. Real LLM wiring replaces this class in a
 * future packet (§8 review applies); nothing else changes.
 */
export class UnwiredLlmProposalAdapter implements LlmProposalAdapter {
  readonly modelId = "UNWIRED-llm-adapter";
  readonly modelVersion = "0.0.0";

  async selectCandidate(): Promise<LlmProposalAdapterResponse> {
    throw new IntentEngineError(
      "invalid-request",
      "The real LLM proposal adapter is not wired in this packet (architecture §8: no network, no SDK here); use the deterministic SyntheticProposalService double.",
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic serialization (determinism + replay proofs).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a proposal (sorted keys, Dates as epoch ms,
 * undefined dropped). Pure and deterministic — the byte-identity witness
 * for the seam's determinism contract.
 */
export function serializeProposal(proposal: Proposal): string {
  return canonicalJsonStringify(proposal);
}

/** Hex SHA-256 of {@link serializeProposal}. */
export function hashProposal(proposal: Proposal): string {
  return sha256Hex(serializeProposal(proposal));
}

// ---------------------------------------------------------------------------
// Internal validation helpers (deny-by-default, typed, PHID-safe).
// ---------------------------------------------------------------------------

function assertSyntheticTable(table: readonly SyntheticProposalRule[]): void {
  if (!isReadonlyArray(table)) {
    throw new IntentEngineError("invalid-request", "The SYNTH proposal table must be an array of rules.");
  }
  const seen = new Set<string>();
  for (const rule of table) {
    if (
      typeof rule !== "object" ||
      rule === null ||
      typeof rule.metricId !== "string" ||
      rule.metricId.length === 0 ||
      typeof rule.methodId !== "string" ||
      rule.methodId.length === 0 ||
      typeof rule.confidence !== "number" ||
      !Number.isFinite(rule.confidence) ||
      rule.confidence < 0 ||
      rule.confidence > 1
    ) {
      throw new IntentEngineError(
        "invalid-request",
        "Every SYNTH proposal rule needs non-empty metricId + methodId and a finite confidence in [0, 1].",
      );
    }
    const key = `${rule.metricId}\u0000${rule.methodId}`;
    if (seen.has(key)) {
      throw new IntentEngineError(
        "invalid-request",
        "The SYNTH proposal table contains a duplicate (metricId, methodId) rule.",
      );
    }
    seen.add(key);
  }
}

function validatePackSummary(summary: EvidencePackSummary): ProposalError | undefined {
  if (typeof summary !== "object" || summary === null) {
    return { kind: "invalid-pack-summary" };
  }
  if (typeof summary.packId !== "string" || summary.packId.length === 0) {
    return { kind: "invalid-pack-summary" };
  }
  if (!Number.isInteger(summary.version) || summary.version < 1) {
    return { kind: "invalid-pack-summary" };
  }
  if (
    (summary.version === 1 && summary.supersedesVersion !== undefined) ||
    (summary.version >= 2 && summary.supersedesVersion !== summary.version - 1)
  ) {
    return { kind: "invalid-pack-summary" };
  }
  if (
    !isReadonlyArray(summary.lineage) ||
    summary.lineage.length === 0 ||
    summary.lineage.some((version) => !Number.isInteger(version) || version < 1)
  ) {
    return { kind: "invalid-pack-summary" };
  }
  for (let index = 1; index < summary.lineage.length; index += 1) {
    const previous = summary.lineage[index - 1];
    const current = summary.lineage[index];
    if (previous === undefined || current === undefined || current !== previous + 1) {
      return { kind: "invalid-pack-summary" };
    }
  }
  if (summary.lineage[0] !== 1) {
    return { kind: "invalid-pack-summary" };
  }
  if (summary.lineage[summary.lineage.length - 1] !== summary.version) {
    return { kind: "invalid-pack-summary" };
  }
  if (typeof summary.contentHash !== "string" || summary.contentHash.length === 0) {
    return { kind: "invalid-pack-summary" };
  }
  if (
    !isReadonlyArray(summary.coveredMetricIds) ||
    summary.coveredMetricIds.some(
      (metricId) => typeof metricId !== "string" || metricId.length === 0,
    ) ||
    new Set(summary.coveredMetricIds).size !== summary.coveredMetricIds.length
  ) {
    return { kind: "invalid-pack-summary" };
  }
  if (!Number.isInteger(summary.entryCount) || summary.entryCount < 0) {
    return { kind: "invalid-pack-summary" };
  }
  return undefined;
}

function validateCandidateContext(context: CandidateContext): ProposalError | undefined {
  if (typeof context !== "object" || context === null) {
    return { kind: "invalid-candidate-context" };
  }
  if (!isReadonlyArray(context.candidates)) {
    return { kind: "invalid-candidate-context" };
  }
  if (context.candidates.length === 0) {
    return { kind: "no-candidates" };
  }
  const seenPlanIds = new Set<string>();
  for (const [index, candidate] of context.candidates.entries()) {
    if (typeof candidate !== "object" || candidate === null) {
      return { kind: "invalid-candidate", candidateIndex: index };
    }
    if (
      typeof candidate.metricId !== "string" ||
      candidate.metricId.length === 0 ||
      typeof candidate.conceptCode !== "string" ||
      candidate.conceptCode.length === 0 ||
      typeof candidate.methodId !== "string" ||
      candidate.methodId.length === 0 ||
      !isReadonlyArray(candidate.methodOrder) ||
      candidate.methodOrder.length === 0 ||
      candidate.methodOrder.some((methodId) => typeof methodId !== "string" || methodId.length === 0) ||
      !Number.isInteger(candidate.packVersion) ||
      candidate.packVersion < 1 ||
      !Number.isInteger(candidate.totalObservationCount) ||
      candidate.totalObservationCount < 0 ||
      typeof candidate.methodRelativeBurden !== "number" ||
      !Number.isFinite(candidate.methodRelativeBurden) ||
      candidate.methodRelativeBurden <= 0
    ) {
      return { kind: "invalid-candidate", candidateIndex: index };
    }
    const planError = validateDraftPlanView(candidate.plan);
    if (planError !== undefined) {
      return { kind: "invalid-candidate", candidateIndex: index };
    }
    if (seenPlanIds.has(candidate.plan.id)) {
      return { kind: "duplicate-candidate-ids", candidateIndex: index };
    }
    seenPlanIds.add(candidate.plan.id);
  }
  if (
    !isReadonlyArray(context.safetyOutcomes)
  ) {
    return { kind: "invalid-candidate-context" };
  }
  for (const [index, outcome] of context.safetyOutcomes.entries()) {
    if (
      typeof outcome !== "object" ||
      outcome === null ||
      typeof outcome.candidateId !== "string" ||
      outcome.candidateId.length === 0 ||
      (outcome.kind !== "PASS" && outcome.kind !== "ESCALATE" && outcome.kind !== "REJECT") ||
      typeof outcome.requiresHumanReview !== "boolean" ||
      typeof outcome.publishable !== "boolean" ||
      !isReadonlyArray(outcome.reasonCodes) ||
      outcome.reasonCodes.some((code) => typeof code !== "string" || code.length === 0)
    ) {
      return { kind: "invalid-safety-outcome", outcomeIndex: index };
    }
  }
  return undefined;
}

function validateDraftPlanView(plan: unknown): ProposalError | undefined {
  if (typeof plan !== "object" || plan === null) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  const candidate = plan as Partial<Record<keyof ProposedDraftPlan, unknown>> & { state?: unknown };
  if (!isIdOf("plan", candidate.id)) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  if (!isIdOf("person", candidate.personId)) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  if (!isIdOf("intent", candidate.intentId)) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  if (
    !isReadonlyArray(candidate.metrics) ||
    candidate.metrics.length === 0 ||
    candidate.metrics.some((code) => typeof code !== "string" || code.length === 0)
  ) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  if (!(candidate.createdAt instanceof Date) || Number.isNaN(candidate.createdAt.getTime())) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  // THE §8 ENCODING: a draft view carrying a lifecycle `state` field is
  // malformed — views are never plans.
  if (candidate.state !== undefined) {
    return { kind: "invalid-candidate", candidateIndex: 0 };
  }
  return undefined;
}
