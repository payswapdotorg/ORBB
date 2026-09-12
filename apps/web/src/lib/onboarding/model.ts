/**
 * Onboarding model (M6-A, Lane B): the first-run journey's step model,
 * draft record, and localStorage persistence — pure data + pure functions
 * plus thin storage adapters (jsdom/browser `localStorage`; SSR-safe
 * guards), so the journey component stays presentational and the model is
 * directly unit-testable.
 *
 * JOURNEY (five steps):
 *   1. welcome          — what ORBB is (synthetic, single-person session);
 *   2. persona          — role/persona selection over the EXISTING
 *                         emphasis model (`../roles`: person | clinician |
 *                         researcher | developer; the web shell's only
 *                         role vocabulary — never invented here);
 *   3. metric interests — optional multi-select over the M4-B SYNTH
 *                         capture catalog metric vocabulary (skippable);
 *   4. sources          — source registration summary, DISPLAY ONLY:
 *                         the manual source (registered) plus the M4-C
 *                         device/app seam vocabulary (not connected yet);
 *   5. done             — completion summary; the record persists.
 *
 * RESUME SEMANTICS (packet B1): the draft (current step + choices +
 * skipped steps) persists after EVERY step transition, so a skipped or
 * abandoned journey resumes at the last uncompleted step on the next
 * visit. Completion (`completedAt`) is terminal for the first-run state.
 */

import { CAPTURE_SHAPES } from "../capture/catalog";
import { ROLES, type Role } from "../roles";

// ---------------------------------------------------------------------------
// Step model.
// ---------------------------------------------------------------------------

/** The five onboarding steps, in journey order. */
export const ONBOARDING_STEPS = [
  { key: "welcome", label: "welcome", title: "Welcome to ORBB", skippable: false },
  {
    key: "persona",
    label: "choose how you will use ORBB",
    title: "How will you use ORBB?",
    skippable: true,
  },
  {
    key: "metrics",
    label: "pick metrics you care about",
    title: "Which metrics matter to you?",
    skippable: true,
  },
  {
    key: "sources",
    label: "review your measurement sources",
    title: "Your measurement sources",
    skippable: true,
  },
  { key: "done", label: "finish setup", title: "You are set up", skippable: false },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

/** Step count (asserted by tests to match ONBOARDING_STEPS). */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/** Human label of a step number (the live-region announcement text). */
export function onboardingStepLabel(step: OnboardingStep): string {
  const definition = ONBOARDING_STEPS[step - 1];
  return definition !== undefined ? definition.label : "continue";
}

/** True when a step may be skipped (skipped steps stay resumable). */
export function onboardingStepSkippable(step: OnboardingStep): boolean {
  const definition = ONBOARDING_STEPS[step - 1];
  return definition !== undefined && definition.skippable;
}

// ---------------------------------------------------------------------------
// Persona + metric + source vocabularies (existing models, never invented).
// ---------------------------------------------------------------------------

/** Persona options = the EXISTING emphasis-model roles (`../roles`). */
export const ONBOARDING_PERSONA_OPTIONS: readonly {
  readonly role: Role;
  readonly label: string;
  readonly description: string;
}[] = ROLES.map((role) => ({
  role,
  label:
    role === "person"
      ? "Person — tracking my own health"
      : role === "clinician"
        ? "Clinician — care and measurement focus"
        : role === "researcher"
          ? "Researcher — research and data focus"
          : "Developer — marketplace and extensions focus",
  description:
    role === "person"
      ? "Emphasizes the consumer core: overview, intents, measurements, and your DataBox."
      : role === "clinician"
        ? "Emphasizes care surfaces, measurements, and shared data."
        : role === "researcher"
          ? "Emphasizes research surfaces, measurement data, and your DataBox."
          : "Emphasizes the marketplace, settings, and DataBox surfaces.",
}));

/**
 * Metric-interest options: one per M4-B SYNTH capture shape (the catalog's
 * metric vocabulary — the same options the capture journey offers).
 */
export const ONBOARDING_METRIC_OPTIONS: readonly {
  readonly shapeId: string;
  readonly label: string;
  readonly summary: string;
}[] = CAPTURE_SHAPES.map((shape) => ({
  shapeId: shape.id,
  label: shape.displayName,
  summary: shape.summary,
}));

/**
 * Source-registration summary options (DISPLAY ONLY — packet B1): the
 * manual source (registered, the only active source) plus the M4-C
 * device/app seam vocabulary (each seam method id/label/meta, marked not
 * connected). The seam vocabulary reuses the capture catalog's
 * `futureMethodOptions` verbatim.
 */
export const ONBOARDING_SOURCE_OPTIONS: readonly {
  readonly kind: "manual" | "device" | "app";
  readonly label: string;
  readonly detail: string;
  readonly connected: boolean;
}[] = [
  {
    kind: "manual",
    label: "Manual entry",
    detail:
      "Registered and active (src_SYNTH-source-manual). Every capture records provenance with you as the actor.",
    connected: true,
  },
  ...CAPTURE_SHAPES.flatMap((shape) =>
    shape.futureMethodOptions.map((option) => ({
      kind: (option.id.includes("app-") ? "app" : "device") as "app" | "device",
      label: option.label,
      detail: `${option.meta} — display only at this milestone.`,
      connected: false,
    })),
  ),
];

// ---------------------------------------------------------------------------
// Draft record + persistence.
// ---------------------------------------------------------------------------

/** The persisted first-run record (one versioned shape). */
export interface OnboardingDraft {
  readonly version: 1;
  /** Resume point: the last uncompleted step (1..5). */
  readonly currentStep: OnboardingStep;
  /** Selected persona (the emphasis-model role; optional until chosen). */
  readonly role?: Role;
  /** Metric interests as capture-shape ids (optional step). */
  readonly metricInterestIds: readonly string[];
  /** Steps explicitly skipped (resumable; choices stay absent). */
  readonly skippedSteps: readonly OnboardingStep[];
  /** Set when the journey completed (terminal for first-run state). */
  readonly completedAt?: string;
}

/** localStorage keys (namespaced, versioned). */
export const ONBOARDING_DRAFT_STORAGE_KEY = "orbb.onboarding.draft.v1";

/** The initial draft (step 1, no choices, not skipped, not complete). */
export function initialOnboardingDraft(): OnboardingDraft {
  return {
    version: 1,
    currentStep: 1,
    metricInterestIds: [],
    skippedSteps: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Type guard: is `value` a persisted onboarding draft (v1)? */
export function isOnboardingDraft(value: unknown): value is OnboardingDraft {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.version !== 1) {
    return false;
  }
  const step = value.currentStep;
  if (
    typeof step !== "number" ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > ONBOARDING_STEP_COUNT
  ) {
    return false;
  }
  if (
    !Array.isArray(value.metricInterestIds) ||
    value.metricInterestIds.some((id) => typeof id !== "string")
  ) {
    return false;
  }
  if (
    !Array.isArray(value.skippedSteps) ||
    value.skippedSteps.some((entry) => typeof entry !== "number")
  ) {
    return false;
  }
  if (value.role !== undefined && !ROLES.includes(value.role as Role)) {
    return false;
  }
  if (value.completedAt !== undefined && typeof value.completedAt !== "string") {
    return false;
  }
  return true;
}

/** True when the draft's journey completed (first-run is over). */
export function isOnboardingComplete(draft: OnboardingDraft): boolean {
  return draft.completedAt !== undefined;
}

/** Loads the draft from localStorage (undefined when absent or invalid). */
export function loadOnboardingDraft(): OnboardingDraft | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    return isOnboardingDraft(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the draft (best-effort; storage failures are non-fatal). */
export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return;
  }
  try {
    window.localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Quota/private-mode failures never break the journey in progress.
  }
}

/** Clears the persisted draft (test helper / explicit reset affordance). */
export function clearOnboardingDraft(): void {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return;
  }
  try {
    window.localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
  } catch {
    // Ignored (same best-effort discipline).
  }
}

// ---------------------------------------------------------------------------
// Pure draft transitions (the component applies these + persists).
// ---------------------------------------------------------------------------

/** Moves the draft to a step (forward or back — resume-safe by design). */
export function withStep(
  draft: OnboardingDraft,
  step: OnboardingStep,
): OnboardingDraft {
  return { ...draft, currentStep: step };
}

/** Records a persona choice. */
export function withPersona(draft: OnboardingDraft, role: Role): OnboardingDraft {
  return { ...draft, role };
}

/** Records metric interests (shape ids, order-stable). */
export function withMetricInterests(
  draft: OnboardingDraft,
  shapeIds: readonly string[],
): OnboardingDraft {
  const unique = new Set(shapeIds);
  return {
    ...draft,
    metricInterestIds: ONBOARDING_METRIC_OPTIONS.filter((option) =>
      unique.has(option.shapeId),
    ).map((option) => option.shapeId),
  };
}

/** Marks a step skipped and advances (the step stays resumable). */
export function withSkippedStep(
  draft: OnboardingDraft,
  step: OnboardingStep,
): OnboardingDraft {
  const next = Math.min(step + 1, ONBOARDING_STEP_COUNT) as OnboardingStep;
  return {
    ...draft,
    skippedSteps: draft.skippedSteps.includes(step)
      ? draft.skippedSteps
      : [...draft.skippedSteps, step],
    currentStep: next,
  };
}

/** Completes the journey (terminal). */
export function completedDraft(
  draft: OnboardingDraft,
  completedAt: string,
): OnboardingDraft {
  return { ...draft, completedAt, currentStep: ONBOARDING_STEP_COUNT };
}
