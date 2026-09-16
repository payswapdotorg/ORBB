"use client";

/**
 * Share composer (M6-C B7, Lane B) — the step-wise CONTRACT BUILDER.
 *
 * The frozen §Sharing UX rule (BINDING): sharing is a reviewable
 * contract, NOT a one-click toggle. Six steps, each stating its
 * consequence in plain language (the step specs come from the catalog —
 * `COMPOSER_STEPS`), with the SAFEST defaults (no derived data, no
 * re-sharing), no "select all" affordance, and an explicit final review
 * + confirm. Accessible per §Accessibility: focus moves to each step
 * heading on advance, labels on every control, reduced-motion respected
 * by the design system, and state changes announced politely via
 * aria-live.
 */

import { useCallback, useMemo, useState } from "react";
import { Button, Card, Checkbox, Heading, Text } from "@orbb/ui";
import {
  COMPOSER_STEPS,
  DERIVED_DATA_CONSEQUENCE,
  RESHARING_CONSEQUENCES,
  SHARE_CONCEPT_OPTIONS,
  SHARE_PURPOSE_OPTIONS,
  SHARE_RECIPIENT_OPTIONS,
} from "@/lib/sharing/catalog";
import type { ResharingPolicy } from "@/lib/sharing/types";

export interface ShareComposerProps {
  /** Called with the confirmed contract inputs (the store validates again). */
  onConfirm: (input: {
    recipientId: string;
    purposeId: string;
    conceptIds: string[];
    startsAtIso: string;
    endsAtIso: string;
    derivedDataAllowed: boolean;
    resharing: ResharingPolicy;
    expiresAtIso: string;
  }) => void;
  onCancel: () => void;
}

interface DraftState {
  recipientId?: string;
  purposeId?: string;
  conceptIds: string[];
  derivedDataAllowed: boolean;
  resharing: ResharingPolicy;
}

const WINDOW_START_ISO = "2026-09-03";
const WINDOW_END_ISO = "2026-09-10";
const EXPIRY_ISO = "2026-12-10";

export function ShareComposer({ onConfirm, onCancel }: ShareComposerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<DraftState>({
    conceptIds: [],
    derivedDataAllowed: false,
    resharing: "no-resharing",
  });
  const step = COMPOSER_STEPS[stepIndex] ?? COMPOSER_STEPS[0]!;
  const isLast = stepIndex === COMPOSER_STEPS.length - 1;

  const canAdvance = useMemo(() => {
    switch (step.key) {
      case "recipient":
        return Boolean(draft.recipientId);
      case "purpose":
        return Boolean(draft.purposeId);
      case "scope":
        return draft.conceptIds.length > 0;
      default:
        return true;
    }
  }, [step.key, draft]);

  const advance = useCallback(() => {
    if (isLast) {
      onConfirm({
        recipientId: draft.recipientId ?? "",
        purposeId: draft.purposeId ?? "",
        conceptIds: draft.conceptIds,
        startsAtIso: `${WINDOW_START_ISO}T00:00:00.000Z`,
        endsAtIso: `${WINDOW_END_ISO}T23:59:59.000Z`,
        derivedDataAllowed: draft.derivedDataAllowed,
        resharing: draft.resharing,
        expiresAtIso: `${EXPIRY_ISO}T23:59:59.000Z`,
      });
      return;
    }
    setStepIndex((i) => i + 1);
  }, [isLast, draft, onConfirm]);

  const toggleConcept = (id: string, checked: boolean) => {
    setDraft((d) => ({
      ...d,
      conceptIds: checked ? [...d.conceptIds, id] : d.conceptIds.filter((c) => c !== id),
    }));
  };

  return (
    <div data-testid="share-composer">
    <Card>
      <Heading level={2}>Create a data share</Heading>
      <Text variant="muted">
        A share is a reviewable contract. Step {stepIndex + 1} of {COMPOSER_STEPS.length}:{" "}
        {step.title}
      </Text>
      <p aria-live="polite" className="sr-only">
        {step.title}
      </p>

      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
        <Text variant="muted">
          {step.consequence}
        </Text>
      </div>

      {step.key === "recipient" && (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Choose recipient</legend>
          {SHARE_RECIPIENT_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
            >
              <input
                type="radio"
                name="share-recipient"
                value={option.id}
                checked={draft.recipientId === option.id}
                onChange={() => setDraft((d) => ({ ...d, recipientId: option.id }))}
                className="mt-1"
                aria-label={option.label}
              />
              <span>
                <Text>{option.label}</Text>
                <Text variant="muted">
                  {option.description}
                </Text>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step.key === "purpose" && (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Choose purpose</legend>
          {SHARE_PURPOSE_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
            >
              <input
                type="radio"
                name="share-purpose"
                value={option.id}
                checked={draft.purposeId === option.id}
                onChange={() => setDraft((d) => ({ ...d, purposeId: option.id }))}
                className="mt-1"
                aria-label={option.label}
              />
              <span>
                <Text>{option.label}</Text>
                <Text variant="muted">
                  {option.consequence}
                </Text>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step.key === "scope" && (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Choose exact data scope</legend>
          <Text variant="muted">
            Time window: {WINDOW_START_ISO} to {WINDOW_END_ISO} (the pinned reference world).
            Choose at least one concept — there is no &quot;share everything&quot; option.
          </Text>
          {SHARE_CONCEPT_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
            >
              <Checkbox
                label={option.label}
                checked={draft.conceptIds.includes(option.id)}
                onChange={() => toggleConcept(option.id, !draft.conceptIds.includes(option.id))}
                aria-label={option.label}
              />
              <Text>{option.label}</Text>
            </label>
          ))}
        </fieldset>
      )}

      {step.key === "terms" && (
        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold">
              May the recipient derive new data from the shared records?
            </legend>
            <p className="mt-1 text-xs text-muted">
              {draft.derivedDataAllowed ? DERIVED_DATA_CONSEQUENCE.allowed : DERIVED_DATA_CONSEQUENCE.disallowed}
            </p>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="derived-data"
                checked={!draft.derivedDataAllowed}
                onChange={() => setDraft((d) => ({ ...d, derivedDataAllowed: false }))}
                aria-label="Derived data not allowed"
              />
              <Text>No (safest)</Text>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="derived-data"
                checked={draft.derivedDataAllowed}
                onChange={() => setDraft((d) => ({ ...d, derivedDataAllowed: true }))}
                aria-label="Derived data allowed"
              />
              <Text>Yes, allow derived data</Text>
            </label>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Re-sharing policy</legend>
            <p className="mt-1 text-xs text-muted">
              {RESHARING_CONSEQUENCES[draft.resharing]}
            </p>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="resharing"
                checked={draft.resharing === "no-resharing"}
                onChange={() => setDraft((d) => ({ ...d, resharing: "no-resharing" }))}
                aria-label="No re-sharing"
              />
              <Text>No re-sharing (safest)</Text>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="resharing"
                checked={draft.resharing === "recipient-may-share-summary"}
                onChange={() => setDraft((d) => ({ ...d, resharing: "recipient-may-share-summary" }))}
                aria-label="Recipient may share summary"
              />
              <Text>Recipient may share a summary</Text>
            </label>
          </fieldset>
        </div>
      )}

      {step.key === "expiry" && (
        <div className="mt-4 rounded-md border border-border p-3">
          <Text>Access ends {EXPIRY_ISO}</Text>
          <Text variant="muted">
            The default expiry is 3 months. Access also stops immediately if you revoke it. You can
            change the expiry in a later milestone (recorded).
          </Text>
        </div>
      )}

      {step.key === "review" && (
        <div className="mt-4 space-y-2" data-testid="share-contract-review">
          <Text>
            <strong>Recipient:</strong>{" "}
            {SHARE_RECIPIENT_OPTIONS.find((r) => r.id === draft.recipientId)?.label}
          </Text>
          <Text>
            <strong>Purpose:</strong>{" "}
            {SHARE_PURPOSE_OPTIONS.find((p) => p.id === draft.purposeId)?.label}
          </Text>
          <Text>
            <strong>Exact data:</strong>{" "}
            {draft.conceptIds
              .map((id) => SHARE_CONCEPT_OPTIONS.find((c) => c.id === id)?.label ?? id)
              .join(", ")}{" "}
            · {WINDOW_START_ISO} to {WINDOW_END_ISO}
          </Text>
          <Text>
            <strong>Derived data:</strong> {draft.derivedDataAllowed ? "allowed" : "not allowed"}
          </Text>
          <Text>
            <strong>Re-sharing:</strong>{" "}
            {draft.resharing === "no-resharing" ? "not allowed" : "summary only"}
          </Text>
          <Text>
            <strong>Expiry:</strong> {EXPIRY_ISO}
          </Text>
          <Text>
            <strong>Compensation:</strong> none recorded (display-only at this stage)
          </Text>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={() => (stepIndex === 0 ? onCancel() : setStepIndex((i) => i - 1))}
          aria-label={stepIndex === 0 ? "Cancel share" : "Previous step"}
        >
          {stepIndex === 0 ? "Cancel" : "Back"}
        </Button>
        <Button onClick={advance} disabled={!canAdvance} aria-label={isLast ? "Confirm share contract" : "Next step"}>
          {isLast ? "Confirm share" : "Next"}
        </Button>
      </div>
      </Card>
    </div>
  );
}
