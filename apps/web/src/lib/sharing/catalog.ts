/**
 * Sharing journey catalog (M6-C B7, Lane B): the recipient/purpose/policy
 * vocabulary the share composer consumes — SYNTH-marked, coherent with
 * the DataBox concept vocabulary (B6), mirroring the domain consent
 * vocabulary (the M6-A catalog discipline: pure data, invariant-checked,
 * no hooks/DOM/fetch so route handlers and vitest can import it too).
 *
 * NO DARK PATTERNS (work order, binding): no "select all" default, no
 * pre-checked expansive scopes, no confirm-on-dismiss. The catalog
 * exposes ONLY the explicit options; every default lives in the store
 * and is the SAFEST one (deny-by-default mirrors the domain access
 * evaluation).
 */
import { DATABOX_CONCEPT_LABELS } from "../databox/fixtures";
import type { ComposerStepSpec, ShareConceptId } from "./types";

/** Recipients (SYNTH vocabulary — clinician/person/service roles). */
export interface ShareRecipientOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const SHARE_RECIPIENT_OPTIONS: readonly ShareRecipientOption[] = [
  {
    id: "recipient-synth-clinician",
    label: "Dr. Ana Rivera (SYNTH clinician)",
    description: "Your care-team clinician — sees only the scoped records, for the stated purpose.",
  },
  {
    id: "recipient-synth-care-partner",
    label: "Sam Ortega (SYNTH care partner)",
    description: "A person you designate — sees only the scoped records, for the stated purpose.",
  },
  {
    id: "recipient-synth-service",
    label: "SYNTH Cardiology Service",
    description: "A measurement service — receives records to process, never to re-share by default.",
  },
];

/** Purposes (SYNTH purpose codes — the domain Purpose vocabulary mirror). */
export interface SharePurposeOption {
  readonly id: string;
  readonly label: string;
  readonly consequence: string;
}

export const SHARE_PURPOSE_OPTIONS: readonly SharePurposeOption[] = [
  {
    id: "purpose-synth-care-monitoring",
    label: "Ongoing care monitoring",
    consequence: "The recipient can read the scoped records to follow your progress.",
  },
  {
    id: "purpose-synth-single-review",
    label: "One-time review",
    consequence: "The recipient can read the scoped records once for a specific review.",
  },
  {
    id: "purpose-synth-service-fulfillment",
    label: "Service fulfillment",
    consequence: "The service processes the scoped records to deliver the measurement you ordered.",
  },
];

/** Concepts available to scope a share (the DataBox concept vocabulary). */
export const SHARE_CONCEPT_OPTIONS: readonly { id: ShareConceptId; label: string }[] =
  Object.entries(DATABOX_CONCEPT_LABELS).map(([id, label]) => ({ id, label }));

/** Re-sharing policy consequences (plain language, binding display). */
export const RESHARING_CONSEQUENCES: Readonly<Record<string, string>> = {
  "no-resharing":
    "The recipient cannot share these records with anyone else. This is the safest option.",
  "recipient-may-share-summary":
    "The recipient may share a summary (not the raw records) with their own care team.",
};

/** Derived-data consequence lines. */
export const DERIVED_DATA_CONSEQUENCE = {
  allowed:
    "The recipient may compute new values (averages, trends) from the scoped records and keep them.",
  disallowed:
    "The recipient can read but not keep any derived value. Safest option.",
} as const;

/** The composer steps in order (each states its consequence — frozen rule). */
export const COMPOSER_STEPS: readonly ComposerStepSpec[] = [
  {
    key: "recipient",
    title: "Who receives access?",
    consequence: "Access is given to exactly this recipient — no one else, ever.",
  },
  {
    key: "purpose",
    title: "For what purpose?",
    consequence: "The recipient may use the scoped records only for this stated purpose.",
  },
  {
    key: "scope",
    title: "Which exact data?",
    consequence: "Only records in the chosen concepts AND time window are shared — nothing else.",
  },
  {
    key: "terms",
    title: "Derived data & re-sharing",
    consequence: "These terms control what the recipient can do with the records afterwards.",
  },
  {
    key: "expiry",
    title: "When does access end?",
    consequence: "Access stops automatically at the expiry. You can also revoke it any time.",
  },
  {
    key: "review",
    title: "Review the contract",
    consequence: "Read the full contract. Sharing starts only when you confirm it here.",
  },
];

export function findRecipientOption(id: string): ShareRecipientOption | undefined {
  return SHARE_RECIPIENT_OPTIONS.find((r) => r.id === id);
}

export function findPurposeOption(id: string): SharePurposeOption | undefined {
  return SHARE_PURPOSE_OPTIONS.find((p) => p.id === id);
}

/** Catalog invariants (loud-failure fixture contract — the M6-A pattern). */
export function assertSharingCatalogInvariants(): void {
  if (SHARE_RECIPIENT_OPTIONS.length < 3) throw new Error("recipient vocabulary too small");
  if (SHARE_PURPOSE_OPTIONS.length < 3) throw new Error("purpose vocabulary too small");
  const recipientIds = new Set(SHARE_RECIPIENT_OPTIONS.map((r) => r.id));
  if (recipientIds.size !== SHARE_RECIPIENT_OPTIONS.length) {
    throw new Error("duplicate recipient ids");
  }
  const purposeIds = new Set(SHARE_PURPOSE_OPTIONS.map((p) => p.id));
  if (purposeIds.size !== SHARE_PURPOSE_OPTIONS.length) {
    throw new Error("duplicate purpose ids");
  }
  if (SHARE_CONCEPT_OPTIONS.length < 5) throw new Error("concept vocabulary too small");
  for (const option of [...SHARE_RECIPIENT_OPTIONS, ...SHARE_PURPOSE_OPTIONS]) {
    if (!option.id.includes("synth")) {
      throw new Error(`non-SYNTH id in sharing catalog: ${option.id}`);
    }
  }
  for (const step of COMPOSER_STEPS) {
    if (!step.consequence || step.consequence.length < 20) {
      throw new Error(`composer step ${step.key} lacks a real consequence line`);
    }
  }
}
