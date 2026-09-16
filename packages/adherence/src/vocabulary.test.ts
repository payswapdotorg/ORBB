import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ADHERENCE_CAPABILITY_IDS,
  ADHERENCE_POLICY_FIELD_NAMES,
  ADHERENCE_STATES,
  ADHERENCE_STATE_REASONS,
  CAPABILITY_DETECTION_STATES,
} from "./states.js";
import type { AdherencePolicy } from "./policy.js";

/**
 * THE NON-PUNITIVE VOCABULARY PROOF (binding rule,
 * docs/UI_UX_ARCHITECTURE.md §Design system: "Avoid gamifying risk,
 * abnormality, disease, or adherence").
 *
 * A schema cannot express what it has no words for. This suite proves,
 * at BOTH the type level and the vocabulary level, that the adherence
 * policy schema cannot express punitive constructs:
 *   1. every policy field name (top-level AND nested) is enumerated in
 *      one closed const list;
 *   2. that complete list contains no punitive term;
 *   3. `triggerOn` is the literal type `"missed"` and nothing else —
 *      recovery and on-track can never express a restriction trigger;
 *   4. the closed vocabulary sets (states, reasons, capability ids,
 *      detection states) contain no punitive or third-party terms.
 */

/** Terms a punitive/gamified adherence feature would need (denylist). */
const PUNITIVE_TERMS = [
  "streak",
  "penalty",
  "penalize",
  "punish",
  "punishment",
  "score",
  "points",
  "badge",
  "level",
  "leaderboard",
  "reward",
  "bonus",
  "demerit",
  "strike",
  "fine",
  "shame",
  "rank",
  "suspend",
  "suspension",
  "escalat",
  "notify",
  "contact",
  "thirdparty",
  "third-party",
  "clinician",
  "provider",
  "employer",
  "insurer",
  "report-to",
  "public",
] as const;

/** Words that must exist in the schema for it to be expressive at all. */
const REQUIRED_POLICY_FIELDS = [
  "policyId",
  "version",
  "capability",
  "triggerOn",
  "authorization",
  "permissions",
  "grantId",
  "scope",
  "personIds",
  "planIds",
  "metricIds",
  "restriction",
  "durationMs",
] as const;

function expectNoPunitiveTerms(name: string, words: readonly string[]): void {
  for (const word of words) {
    const lowered = word.toLowerCase();
    for (const term of PUNITIVE_TERMS) {
      expect(
        lowered.includes(term),
        `${name} word "${word}" must not contain punitive term "${term}"`,
      ).toBe(false);
    }
  }
}

describe("the policy schema cannot express punitive constructs", () => {
  it("enumerates EXACTLY the complete policy field-name vocabulary (closed const)", () => {
    expect([...ADHERENCE_POLICY_FIELD_NAMES].sort()).toEqual([...REQUIRED_POLICY_FIELDS].sort());
    expect(new Set(ADHERENCE_POLICY_FIELD_NAMES).size).toBe(REQUIRED_POLICY_FIELDS.length);
  });

  it("contains no punitive term anywhere in the policy field vocabulary", () => {
    expectNoPunitiveTerms("policy fields", ADHERENCE_POLICY_FIELD_NAMES);
  });

  it("contains no punitive term in any closed vocabulary set", () => {
    expectNoPunitiveTerms("adherence states", ADHERENCE_STATES);
    expectNoPunitiveTerms("state reasons", ADHERENCE_STATE_REASONS);
    expectNoPunitiveTerms("capability ids", ADHERENCE_CAPABILITY_IDS);
    expectNoPunitiveTerms("detection states", CAPABILITY_DETECTION_STATES);
  });

  it("cannot name a third-party notification/escalation capability (closed set)", () => {
    for (const capability of ADHERENCE_CAPABILITY_IDS) {
      expect(["ios-focus", "android-usage-access"]).toContain(capability);
    }
    expect(ADHERENCE_CAPABILITY_IDS).toHaveLength(2);
  });
});

describe("type-level proofs (compile-time)", () => {
  it("the policy top-level keys are exactly the seven declared fields", () => {
    expectTypeOf<keyof AdherencePolicy>().toEqualTypeOf<
      | "policyId"
      | "version"
      | "capability"
      | "triggerOn"
      | "authorization"
      | "scope"
      | "restriction"
    >();
  });

  it("triggerOn is the literal \"missed\" — nothing else is expressible", () => {
    expectTypeOf<AdherencePolicy["triggerOn"]>().toEqualTypeOf<"missed">();
  });

  it("the field-name const mirrors the complete keyof vocabulary (top-level)", () => {
    type TopLevel = keyof AdherencePolicy;
    type FromConst = Extract<
      (typeof ADHERENCE_POLICY_FIELD_NAMES)[number],
      "policyId" | "version" | "capability" | "triggerOn" | "authorization" | "scope" | "restriction"
    >;
    expectTypeOf<TopLevel>().toEqualTypeOf<FromConst>();
  });

  it("the adherence state vocabulary is exactly on-track | missed | recovered", () => {
    expectTypeOf<(typeof ADHERENCE_STATES)[number]>().toEqualTypeOf<
      "on-track" | "missed" | "recovered"
    >();
  });
});
