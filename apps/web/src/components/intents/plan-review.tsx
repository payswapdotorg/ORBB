"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  DisclosurePanel,
  DueWindow,
  FieldWrapper,
  Heading,
  Text,
  TextField,
  Timeline,
} from "@orbb/ui";
import { GOAL_METRIC_OPTIONS } from "@/lib/intents/catalog";
import {
  formatBurdenUnits,
  formatCadenceLabel,
  formatWindowLabel,
  safetyBadge,
} from "@/lib/intents/format";
import {
  INTENT_NOTE_MAX_LENGTH,
} from "@/lib/intents/validation";
import {
  isIntentErrorEnvelope,
  isIntentPlanActResponse,
  type IntentAuditRecordView,
  type IntentPlanCandidateView,
  type IntentPublishedPlanView,
  type IntentRecordView,
  type IntentReviewEntryView,
} from "@/lib/intents/types";
import type { TimelineEntry } from "@orbb/ui";

/**
 * Candidate plan review screen (M6-A, Lane B — web): the B3 surface.
 *
 * Renders the M5 explainability shape as an AUDIT-TRAIL LIST (the library
 * `Timeline` — groups: pack identity, contributing evidence entries with
 * coverage windows, methods, the decision), the burden summary, and the
 * safety outcome badges (PASS / ESCALATE with reason codes; REJECT
 * renders too — the stub can produce it). Approve-with-edits and reject
 * actions POST to the `/api/plans` stub; approved plans land in the plan
 * store with published state ONLY through the stub's domain-transition
 * mirror (the route + store own that path — this screen only issues the
 * typed act).
 *
 * Accessibility (packet B3):
 * - state changes are announced through aria-live regions (submitted,
 *   saving, approved, rejected — polite);
 * - the ESCALATE badge's text carries the meaning; tone only reinforces
 *   (never color alone);
 * - the reviewer edits (concept codes + note) use library primitives with
 *   44px targets and full field wiring.
 */

export interface PlanReviewProps {
  /** The intent under review (objective + goal summary). */
  intent: IntentRecordView;
  /** The review entry (candidate, alternatives, drops, safety, burden). */
  review: IntentReviewEntryView;
  /** Fired after a successful act (approve or reject). */
  onActed: (payload: {
    kind: "approved" | "rejected";
    plan?: IntentPublishedPlanView;
    review: IntentReviewEntryView;
    audit: IntentAuditRecordView;
  }) => void;
}

type ActPhase = "idle" | "saving";

export function PlanReview({ intent, review, onActed }: PlanReviewProps) {
  const [phase, setPhase] = useState<ActPhase>("idle");
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const [reviewerNote, setReviewerNote] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [reasonMode, setReasonMode] = useState(false);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    review.candidate !== null ? [...review.candidate.metrics] : [],
  );
  const [codesError, setCodesError] = useState<string | undefined>(undefined);

  // Reset the local edit state when a new review entry arrives.
  useEffect(() => {
    setReviewerNote("");
    setReasonText("");
    setReasonMode(false);
    setReasonError(undefined);
    setSelectedCodes(review.candidate !== null ? [...review.candidate.metrics] : []);
    setCodesError(undefined);
    setFeedback(null);
    setFailed(false);
    setAnnouncement(null);
  }, [review.entryId, review.candidate]);

  const candidate = review.candidate;
  const safety = review.safety;
  const burden = review.burden;

  async function postAct(body: Record<string, unknown>): Promise<void> {
    if (phase === "saving") {
      return;
    }
    setPhase("saving");
    setFeedback(null);
    setFailed(false);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && isIntentPlanActResponse(payload)) {
        if (payload.kind === "approved") {
          setAnnouncement(
            "Candidate plan approved — published to your plan store (draft to published, through the domain transition).",
          );
          onActed({
            kind: "approved",
            plan: payload.plan,
            review: payload.review,
            audit: payload.audit,
          });
        } else {
          setAnnouncement("Candidate plan rejected — the review entry is closed.");
          onActed({
            kind: "rejected",
            review: payload.review,
            audit: payload.audit,
          });
        }
      } else if (!response.ok && isIntentErrorEnvelope(payload)) {
        setFailed(true);
        setFeedback(`Could not apply the review action: ${payload.error.message}`);
      } else {
        setFailed(true);
        setFeedback(
          "Could not apply the review action: unexpected response from the plans route.",
        );
      }
    } catch {
      setFailed(true);
      setFeedback("Could not apply the review action: network error.");
    } finally {
      setPhase("idle");
    }
  }

  function approveWithEdits(): void {
    if (candidate === null) {
      return;
    }
    if (selectedCodes.length === 0) {
      setCodesError("Keep at least one committed concept code.");
      return;
    }
    setCodesError(undefined);
    const trimmedNote = reviewerNote.trim();
    const codesChanged =
      selectedCodes.length !== candidate.metrics.length ||
      selectedCodes.some((code, index) => code !== candidate.metrics[index]);
    void postAct({
      action: "approve-with-edits",
      entryId: review.entryId,
      edits: {
        ...(codesChanged ? { metrics: selectedCodes } : {}),
        ...(trimmedNote !== "" ? { note: trimmedNote } : {}),
      },
    });
  }

  function reject(): void {
    const trimmed = reasonText.trim();
    if (trimmed === "") {
      setReasonError("A rejection reason is required.");
      return;
    }
    setReasonError(undefined);
    void postAct({
      action: "reject",
      entryId: review.entryId,
      reason: trimmed,
    });
  }

  return (
    <Card>
      <Heading level={2}>Review the candidate plan</Heading>
      <Text variant="muted">
        {`Intent: ${intent.objective} (${intent.intentId}) · review entry ${review.entryId} · state ${review.state}.`}
      </Text>
      <div aria-live="polite" data-plan-review-announcement="true">
        {announcement !== null ? (
          <p className="m-0 text-sm font-semibold text-accent">{announcement}</p>
        ) : null}
      </div>

      {candidate === null ? (
        <>
          <Text>
            No executable candidate plan was produced for this intent — the
            compiler found no method with both evidence coverage and a
            registered source behind it.
          </Text>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {review.dropped.map((drop) => (
              <li key={`${drop.metricId}-${drop.methodId}`} className="text-sm">
                {`${drop.methodLabel} — dropped (${drop.reason}): ${drop.detail}`}
              </li>
            ))}
          </ul>
          <Text variant="small">
            Adjust the intent (method preference or cadence) and submit a new
            draft, or reject this review entry to close it.
          </Text>
          <RejectActionArea
            phase={phase}
            reasonMode={reasonMode}
            reasonText={reasonText}
            reasonError={reasonError}
            feedback={feedback}
            failed={failed}
            disabled={review.state !== "pending"}
            onReasonChange={(value) => {
              setReasonText(value);
              setReasonError(undefined);
            }}
            onOpenReason={() => {
              setReasonMode(true);
            }}
            onCancelReason={() => {
              setReasonMode(false);
              setReasonError(undefined);
            }}
            onConfirm={reject}
          />
        </>
      ) : (
        <>
          {/* ---- Proposal summary ---- */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{candidate.metricLabel}</span>
            <DueWindow tone="accent">{candidate.methodLabel}</DueWindow>
            <DueWindow tone="neutral">
              {formatCadenceLabel(candidate.cadencePerDay)}
            </DueWindow>
            <DueWindow tone="neutral">{candidate.methodEvidenceLabel}</DueWindow>
            <DueWindow tone="neutral">{`burden rank ${candidate.methodRelativeBurden}`}</DueWindow>
          </div>
          <Text variant="small">
            {`Draft plan ${candidate.planId} · concept code ${candidate.conceptCode} · compiled against pack v${candidate.pack.version} (${candidate.pack.contentHash}). Publication happens only through your approval — never automatically.`}
          </Text>

          {/* ---- Safety outcome badges ---- */}
          {safety !== null ? (
            <div className="mt-2 flex flex-col gap-2" data-plan-safety={safety.kind}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Safety outcome:</span>
                <DueWindow tone={safetyBadge(safety).tone}>
                  {safetyBadge(safety).label}
                </DueWindow>
                <span className="text-xs text-fg-muted">
                  {safetyBadge(safety).detail}
                </span>
              </div>
              {safety.kind !== "PASS" ? (
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                  {safety.reasonCodes.map((code) => (
                    <li key={code} className="text-xs">
                      {`Reason code: ${code}`}
                    </li>
                  ))}
                  {safety.firedRules.map((rule) => (
                    <li key={rule.ruleId} className="text-xs text-fg-muted">
                      {`Rule ${rule.ruleId} (${rule.ruleKind}) fired — ${rule.inputsSummary}`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {safety.kind === "ESCALATE" ? (
                <Text variant="small">
                  An ESCALATE verdict requires human review before
                  publication — that review is this screen; your approval
                  clears the escalation and is recorded in the audit trail.
                </Text>
              ) : null}
            </div>
          ) : null}

          {/* ---- Burden summary ---- */}
          {burden !== null ? (
            <div className="mt-2 flex flex-col gap-1" data-plan-burden="true">
              <span className="text-sm font-semibold">Burden summary</span>
              <span className="text-xs text-fg-muted">
                {`${burden.methodCount} method · ${formatCadenceLabel(
                  burden.measurementsPerDay,
                )} · ${formatBurdenUnits(burden.burdenUnitsPerDay)} (kind weights: manual ${burden.methodKindWeights.manual}, app ${burden.methodKindWeights.app}, device ${burden.methodKindWeights.device})`}
              </span>
            </div>
          ) : null}

          {/* ---- Explainability audit trail (the M5 shape) ---- */}
          <div className="mt-2" data-plan-explainability="true">
            <span className="text-sm font-semibold">Why this plan (audit trail)</span>
            <div className="mt-2">
              <Timeline entries={explainabilityTrail(candidate)} />
            </div>
          </div>

          {/* ---- Alternatives + dropped audit ---- */}
          {review.alternatives.length > 0 ? (
            <div className="mt-2">
              <span className="text-sm font-semibold">
                Other executable candidates
              </span>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {review.alternatives.map((alternative) => (
                  <li key={alternative.planId} className="text-sm">
                    {`${alternative.methodLabel} · ${formatCadenceLabel(
                      alternative.cadencePerDay,
                    )} · burden rank ${alternative.methodRelativeBurden} · ${alternative.totalObservationCount} backing observations`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {review.dropped.length > 0 ? (
            <div className="mt-2">
              <span className="text-sm font-semibold">Dropped by the matcher</span>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {review.dropped.map((drop) => (
                  <li key={`${drop.metricId}-${drop.methodId}`} className="text-sm">
                    {`${drop.methodLabel} — ${drop.reason}: ${drop.detail}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ---- Reviewer edits (approve-with-edits surface) ---- */}
          <div className="mt-4">
            <DisclosurePanel
              id="plan-review-edits"
              title="Adjust the plan before approving (optional)"
            >
              <div className="flex flex-col gap-4">
                <Text variant="small">
                  The plan&apos;s committed metric concept codes and a reviewer
                  note are the editable surface; identity fields stay
                  immutable (they are provenance).
                </Text>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">
                    Committed concept codes
                  </span>
                  {GOAL_METRIC_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.conceptCode}
                      label={`${option.conceptCode} — ${option.metricLabel}`}
                      checked={selectedCodes.includes(option.conceptCode)}
                      onChange={(event) => {
                        setSelectedCodes((current) =>
                          event.target.checked
                            ? [...current, option.conceptCode]
                            : current.filter((code) => code !== option.conceptCode),
                        );
                        setCodesError(undefined);
                      }}
                    />
                  ))}
                  <div aria-live="polite">
                    {codesError !== undefined ? (
                      <p className="m-0 text-xs text-danger">{codesError}</p>
                    ) : null}
                  </div>
                </div>
                <FieldWrapper
                  id="plan-reviewer-note"
                  label="Reviewer note (optional)"
                  hint={`Recorded verbatim in the audit trail (max ${INTENT_NOTE_MAX_LENGTH} characters).`}
                >
                  {(fieldProps) => (
                    <TextField
                      {...fieldProps}
                      value={reviewerNote}
                      maxLength={INTENT_NOTE_MAX_LENGTH}
                      onChange={(event) => {
                        setReviewerNote(event.target.value);
                      }}
                    />
                  )}
                </FieldWrapper>
              </div>
            </DisclosurePanel>
          </div>

          {/* ---- Reviewer actions ---- */}
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={approveWithEdits}
                disabled={phase === "saving" || review.state !== "pending"}
              >
                {phase === "saving" ? "Applying…" : "Approve with edits"}
              </Button>
              <Button
                variant="secondary"
                disabled={phase === "saving" || review.state !== "pending"}
                onClick={() => {
                  setReasonMode(true);
                }}
              >
                Reject plan
              </Button>
            </div>

            <RejectReasonForm
              visible={reasonMode}
              phase={phase}
              reasonText={reasonText}
              reasonError={reasonError}
              onReasonChange={(value) => {
                setReasonText(value);
                setReasonError(undefined);
              }}
              onConfirm={reject}
              onCancel={() => {
                setReasonMode(false);
                setReasonError(undefined);
              }}
            />

            <div aria-live="polite">
              {feedback !== null ? (
                <p className={`m-0 text-xs ${failed ? "text-danger" : "text-fg-muted"}`}>
                  {feedback}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The reject reason form (shared by both review branches).
// ---------------------------------------------------------------------------

function RejectReasonForm({
  visible,
  phase,
  reasonText,
  reasonError,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  phase: ActPhase;
  reasonText: string;
  reasonError?: string | undefined;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!visible) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <FieldWrapper
        id="plan-reject-reason"
        label="Why are you rejecting this plan?"
        hint="Required — recorded in the audit trail."
        error={reasonError}
        required
      >
        {(fieldProps) => (
          <TextField
            {...fieldProps}
            value={reasonText}
            maxLength={INTENT_NOTE_MAX_LENGTH}
            onChange={(event) => {
              onReasonChange(event.target.value);
            }}
          />
        )}
      </FieldWrapper>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={phase === "saving"}>
          {phase === "saving" ? "Applying…" : "Confirm rejection"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reject action area for the no-candidate branch (approve impossible).
// ---------------------------------------------------------------------------

function RejectActionArea({
  phase,
  reasonMode,
  reasonText,
  reasonError,
  feedback,
  failed,
  disabled,
  onReasonChange,
  onOpenReason,
  onCancelReason,
  onConfirm,
}: {
  phase: ActPhase;
  reasonMode: boolean;
  reasonText: string;
  reasonError?: string | undefined;
  feedback: string | null;
  failed: boolean;
  disabled: boolean;
  onReasonChange: (value: string) => void;
  onOpenReason: () => void;
  onCancelReason: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={phase === "saving" || disabled}
          onClick={onOpenReason}
        >
          Reject plan
        </Button>
      </div>
      <RejectReasonForm
        visible={reasonMode}
        phase={phase}
        reasonText={reasonText}
        reasonError={reasonError}
        onReasonChange={onReasonChange}
        onConfirm={onConfirm}
        onCancel={onCancelReason}
      />
      <div aria-live="polite">
        {feedback !== null ? (
          <p className={`m-0 text-xs ${failed ? "text-danger" : "text-fg-muted"}`}>
            {feedback}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explainability trail projection: the M5 explainability shape rendered as
// Timeline entries (the library's audit-trail pattern).
// ---------------------------------------------------------------------------

/** Compact instant label for the compiled-at audit line. */
function formatInstant(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function explainabilityTrail(candidate: IntentPlanCandidateView): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      at: "Evidence",
      title: `Pack v${candidate.pack.version} — ${candidate.pack.packId}`,
      subtitle: `Content ${candidate.pack.contentHash} · ${candidate.contributingEntries.length} contributing entr${candidate.contributingEntries.length === 1 ? "y" : "ies"}`,
      group: "Evidence",
    },
  ];
  for (const entry of candidate.contributingEntries) {
    entries.push({
      at: "Coverage",
      title: `${entry.count} observations via ${entry.methodId}`,
      subtitle: `Window ${formatWindowLabel(entry.windowStart, entry.windowEnd)} · actor class ${entry.provenanceActorClass} · entry ${entry.entryId}`,
      group: "Contributing evidence",
    });
  }
  entries.push({
    at: "Method",
    title: `${candidate.methodLabel} (${candidate.methodId})`,
    subtitle: `${candidate.methodKind} · burden rank ${candidate.methodRelativeBurden} · evidence ${candidate.methodEvidenceLabel}`,
    group: "Method",
  });
  entries.push({
    at: "Totals",
    title: `${candidate.totalObservationCount} backing observations`,
    subtitle: `Compiled ${formatInstant(candidate.compiledAt)} · draft plan ${candidate.planId}`,
    group: "Method",
  });
  entries.push({
    at: "Decision",
    title: "Draft plan awaits your decision",
    subtitle:
      "Publication only through approval here — the plan store accepts published plans written solely by the review stub's domain transition.",
    group: "Decision",
  });
  return entries;
}
