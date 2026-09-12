"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, DueWindow, Heading, Table, Text } from "@orbb/ui";
import { IntentComposer } from "@/components/intents/intent-composer";
import { PlanReview } from "@/components/intents/plan-review";
import {
  type IntentAuditRecordView,
  type IntentPlanListResponse,
  type IntentPublishedPlanView,
  type IntentRecordView,
  type IntentReviewEntryView,
} from "@/lib/intents/types";
import { formatCadenceLabel } from "@/lib/intents/format";

/**
 * Intents workspace (M6-A): composes the guided intent composer, the
 * candidate plan review screen, and the published-plan store view on one
 * surface — the workspace pattern of the Measurements surface (M4-B).
 *
 * Owns the phase machine (compose -> review -> outcome) and the refresh
 * signal: every successful intent creation swaps to the review phase with
 * the received plan proposal; every successful reviewer act swaps to the
 * outcome phase and refreshes the published-plans list read through the
 * API route (single source of truth — the flow writes, the lists read).
 */

type WorkspacePhase = "compose" | "review" | "outcome";

interface OutcomeState {
  readonly kind: "approved" | "rejected";
  readonly plan?: IntentPublishedPlanView;
  readonly review: IntentReviewEntryView;
  readonly audit: IntentAuditRecordView;
}

export function IntentsWorkspace() {
  const [phase, setPhase] = useState<WorkspacePhase>("compose");
  const [composerKey, setComposerKey] = useState(0);
  const [currentIntent, setCurrentIntent] = useState<IntentRecordView | null>(
    null,
  );
  const [currentReview, setCurrentReview] =
    useState<IntentReviewEntryView | null>(null);
  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const [published, setPublished] = useState<
    readonly IntentPublishedPlanView[]
  >([]);
  const [refreshToken, setRefreshToken] = useState(0);
  /** Persistent polite announcement of review state changes (B3). */
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const refreshPublished = useCallback(async () => {
    try {
      const response = await fetch("/api/plans");
      const payload: unknown = await response.json().catch(() => null);
      if (
        response.ok &&
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as IntentPlanListResponse).published)
      ) {
        setPublished(
          (payload as IntentPlanListResponse).published.map((plan) => ({
            ...plan,
          })),
        );
      }
    } catch {
      // The list stays stale on transport errors; the journey continues.
    }
  }, []);

  useEffect(() => {
    void refreshPublished();
  }, [refreshPublished, refreshToken]);

  return (
    <div className="flex flex-col gap-6">
      {/* Pre-existing polite region: review state changes are announced
          here (the region persists across the phase swap, so assistive
          tech receives the content change reliably). */}
      <div aria-live="polite" data-intent-announcement="true">
        {announcement !== null ? (
          <p className="m-0 text-sm font-semibold text-accent">{announcement}</p>
        ) : null}
      </div>

      {phase === "compose" ? (
        <IntentComposer
          key={composerKey}
          onCreated={({ intent, review }) => {
            setCurrentIntent(intent);
            setCurrentReview(review);
            setOutcome(null);
            setAnnouncement(null);
            setPhase("review");
            setRefreshToken((current) => current + 1);
          }}
        />
      ) : null}

      {phase === "review" && currentIntent !== null && currentReview !== null ? (
        <PlanReview
          intent={currentIntent}
          review={currentReview}
          onActed={(result) => {
            setAnnouncement(
              result.kind === "approved"
                ? "Candidate plan approved — published to your plan store (draft to published, through the domain transition)."
                : "Candidate plan rejected — the review entry is closed.",
            );
            setOutcome(result);
            setPhase("outcome");
            setRefreshToken((current) => current + 1);
          }}
        />
      ) : null}

      {phase === "outcome" && outcome !== null ? (
        <Card>
          <div
            role="status"
            aria-live="polite"
            data-intent-outcome={outcome.kind}
            className="flex flex-col gap-3"
          >
            {outcome.kind === "approved" && outcome.plan !== undefined ? (
              <>
                <Heading level={2}>Plan published</Heading>
                <p className="m-0 text-lead font-semibold text-accent">
                  Your candidate plan was approved and published.
                </p>
                <dl className="m-0 grid grid-cols-1 gap-2">
                  <div>
                    <dt className="text-xs font-semibold">Plan</dt>
                    <dd className="m-0 font-mono text-xs text-fg-muted">
                      {outcome.plan.planId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold">Metric</dt>
                    <dd className="m-0 text-sm">{outcome.plan.metricLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold">Method</dt>
                    <dd className="m-0 text-sm">{outcome.plan.methodLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold">Cadence</dt>
                    <dd className="m-0 text-sm">
                      {formatCadenceLabel(outcome.plan.cadencePerDay)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold">State</dt>
                    <dd className="m-0 text-sm">
                      <DueWindow tone="success">published</DueWindow>{" "}
                      <span className="text-xs text-fg-muted">
                        written only by the review stub&apos;s domain
                        transition (draft → published)
                      </span>
                    </dd>
                  </div>
                  {outcome.plan.reviewerNote !== undefined ? (
                    <div>
                      <dt className="text-xs font-semibold">Reviewer note</dt>
                      <dd className="m-0 text-sm">{outcome.plan.reviewerNote}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-semibold">Audit record</dt>
                    <dd className="m-0 font-mono text-xs text-fg-muted">
                      {outcome.audit.kind === "approved"
                        ? `${outcome.audit.recordId} · ${outcome.audit.fromState} → ${outcome.audit.toState}`
                        : `${outcome.audit.recordId} · rejected`}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <Heading level={2}>Plan rejected</Heading>
                <p className="m-0 text-lead font-semibold">
                  The candidate plan was rejected — the review entry is closed.
                </p>
                <p className="m-0 text-sm text-fg-muted">
                  {`Reason: ${
                    outcome.audit.kind === "rejected" ? outcome.audit.reason : "—"
                  } · entry ${outcome.review.entryId} (state rejected, terminal).`}
                </p>
              </>
            )}
            <div>
              <Button
                onClick={() => {
                  setPhase("compose");
                  setComposerKey((current) => current + 1);
                  setCurrentIntent(null);
                  setCurrentReview(null);
                  setOutcome(null);
                  setAnnouncement(null);
                }}
              >
                Create another intent
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <PublishedPlansCard published={published} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Published plans (the plan store view — read through /api/plans).
// ---------------------------------------------------------------------------

function PublishedPlansCard({
  published,
}: {
  published: readonly IntentPublishedPlanView[];
}) {
  return (
    <Card>
      <Heading level={2}>Published plans</Heading>
      <Text variant="muted">
        {`The plan store holds only plans published through review approval (${published.length} so far).`}
      </Text>
      {published.length === 0 ? (
        <Text variant="small">
          Nothing published yet — approve a candidate plan to land it here.
        </Text>
      ) : (
        <Table
          caption="Published measurement plans (synthetic session)"
          columns={[
            { id: "plan", header: "Plan" },
            { id: "metric", header: "Metric" },
            { id: "method", header: "Method" },
            { id: "cadence", header: "Cadence" },
            { id: "state", header: "State" },
            { id: "published", header: "Published" },
          ]}
          rows={published.map((plan) => ({
            id: plan.planId,
            cells: {
              plan: <span className="font-mono text-xs">{plan.planId}</span>,
              metric: plan.metricLabel,
              method: plan.methodLabel,
              cadence: formatCadenceLabel(plan.cadencePerDay),
              state: <DueWindow tone="success">published</DueWindow>,
              published: new Date(plan.publishedAt).toLocaleString(),
            },
          }))}
        />
      )}
    </Card>
  );
}
