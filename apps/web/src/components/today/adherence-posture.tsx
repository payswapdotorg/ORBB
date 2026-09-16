"use client";

import { DisclosurePanel } from "@orbb/ui";
import { Card, Heading, Text } from "@orbb/ui";
import type {
  TodayAdherenceDecisionWire,
  TodayAdherencePostureWire,
} from "@/lib/adherence/types";

/**
 * Restriction-posture card (M6 EXIT, Lane B) — the journey-#7
 * "authorized restriction applied only if configured" leg: a
 * provenance-style status surface for the adherence posture.
 *
 * BINDING PRESENTATION RULES (AGENTS.md + §Design system + §Accessibility):
 *   - the LOUDEST, DEFAULT TRUTH is "No restrictions are configured —
 *     nothing happens when you miss a measurement." (rendered first,
 *     emphasized, on every variant);
 *   - NEVER gamified: no red badges, no streak language, no punitive
 *     framing — conservative clinical styling only, and every state is
 *     carried by TEXT, never color alone;
 *   - the decision is rendered like a provenance record: kind, reason,
 *     evaluation, ordered audit steps (the B10 vocabulary);
 *   - the configured-policy fixture VARIANT is behind an explicit
 *     disclosure, clearly labeled as a SYNTH fixture variant — it
 *     demonstrates the `restriction-authorized` vocabulary (explicit
 *     policy + authorization grant + bounded restriction) without ever
 *     being the default posture;
 *   - `restriction-authorized` is shown ONLY under an explicit policy +
 *     authorization grant (the store invariants enforce this; the
 *     component renders whatever decision it is fed).
 */

export interface AdherencePostureCardProps {
  /** The DEFAULT posture (observe-only — nothing configured). */
  readonly posture: TodayAdherencePostureWire;
  /** The explicitly-labeled SYNTH configured-policy fixture variant. */
  readonly fixtureVariant: TodayAdherencePostureWire;
}

export function AdherencePostureCard({ posture, fixtureVariant }: AdherencePostureCardProps) {
  return (
    <Card>
      <div
        data-adherence-posture={posture.variant}
        data-adherence-decision={posture.decision.kind}
      >
        <Heading level={2}>What happens when you miss a measurement</Heading>
        <p className="m-0 mt-2 text-base font-semibold" data-adherence-default-line="true">
          {posture.defaultLine}
        </p>
        <Text variant="muted">{posture.summaryLine}</Text>
        <p className="m-0 mt-2 text-sm font-medium">{posture.variantLabel}</p>

        <DecisionRecord decision={posture.decision} />

        <div className="mt-4">
          <DisclosurePanel
            id="adherence-configured-variant"
            title="View the configured-policy fixture variant (SYNTH)"
          >
            <div
              className="flex flex-col gap-3"
              data-adherence-variant={fixtureVariant.variant}
              data-variant-decision={fixtureVariant.decision.kind}
            >
              <p className="m-0 text-sm font-semibold">{fixtureVariant.variantLabel}</p>
              <p className="m-0 text-sm font-medium">{fixtureVariant.defaultLine}</p>
              <p className="m-0 text-sm">{fixtureVariant.summaryLine}</p>

              {fixtureVariant.policy !== undefined ? (
                <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3">
                  <p className="m-0 text-sm font-semibold">The configured policy (every field)</p>
                  <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold">Policy id</dt>
                      <dd className="m-0 text-sm">{fixtureVariant.policy.policyId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Version</dt>
                      <dd className="m-0 text-sm">{fixtureVariant.policy.version}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Capability</dt>
                      <dd className="m-0 text-sm">
                        {`${fixtureVariant.policy.capability} — ${fixtureVariant.policy.capabilityLabel}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Trigger</dt>
                      <dd className="m-0 text-sm">
                        {`triggerOn: ${fixtureVariant.policy.triggerOn} (the only legal trigger — recovery is never punished)`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Authorization</dt>
                      <dd className="m-0 text-sm">
                        {`permissions: ${fixtureVariant.policy.authorization.permissions.join(", ")}${
                          fixtureVariant.policy.authorization.grantId !== undefined
                            ? ` · pinned grant: ${fixtureVariant.policy.authorization.grantId}`
                            : ""
                        }`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Scope</dt>
                      <dd className="m-0 text-sm">
                        {`person ${fixtureVariant.policy.scope.personIds?.join(", ") ?? "—"} · plan ${
                          fixtureVariant.policy.scope.planIds?.join(", ") ?? "—"
                        } · metric ${fixtureVariant.policy.scope.metricIds?.join(", ") ?? "—"}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold">Restriction</dt>
                      <dd className="m-0 text-sm">
                        {fixtureVariant.policy.durationLabel}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}

              <DecisionRecord decision={fixtureVariant.decision} />

              {fixtureVariant.decision.restriction !== undefined ? (
                <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3">
                  <p className="m-0 text-sm font-semibold">
                    The authorized restriction (the bounded token)
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`decisionId: ${fixtureVariant.decision.restriction.decisionId} · capability: ${fixtureVariant.decision.restriction.capability}`}
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`authorization: ${fixtureVariant.decision.restriction.authorization.permission} — verified at ${fixtureVariant.decision.restriction.authorization.verifiedAtIso}`}
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`decided: ${fixtureVariant.decision.restriction.decidedAtIso} · expires: ${fixtureVariant.decision.restriction.expiresAtIso} (bounded — restrictions are at most 24 hours)`}
                  </p>
                  <p className="m-0 text-sm text-fg-muted">
                    {`detection: ${fixtureVariant.decision.restriction.detection.state} · evaluation: ${fixtureVariant.decision.evaluation.state} (${fixtureVariant.decision.evaluation.reason})`}
                  </p>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        </div>
      </div>
    </Card>
  );
}

/** One provenance-style decision record (kind, reason, evaluation, audit). */
function DecisionRecord({ decision }: { readonly decision: TodayAdherenceDecisionWire }) {
  return (
    <div className="mt-3 flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-3">
      <p className="m-0 text-sm font-semibold" data-decision-kind={decision.kind}>
        {`Decision: ${decision.kind} — ${decision.decisionLabel}`}
      </p>
      {decision.reason !== undefined ? (
        <p className="m-0 text-sm text-fg-muted">reason: {decision.reason}</p>
      ) : null}
      <p className="m-0 text-sm text-fg-muted">
        {`evaluated task: ${decision.evaluation.taskId} — adherence state ${decision.evaluation.state} (${decision.evaluation.reason}) at ${decision.evaluation.evaluatedAtIso}`}
      </p>
      <p className="m-0 text-xs text-fg-muted">
        {`audit steps: ${decision.auditSteps
          .map((step) => `${step.step}${step.detail !== undefined ? ` (${step.detail})` : ""}`)
          .join(" -> ")}`}
      </p>
    </div>
  );
}
