import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LABELS,
  isDeviceId,
  isEvidenceId,
  isGrantId,
  isObservationId,
  isPersonId,
  isProvenance,
  isProvenanceId,
  isQualityScore,
  isSourceId,
  type EvidenceId,
} from "@orbb/domain";
import {
  DEFAULT_GRANT_LIFETIME_DAYS,
  SYNTH_NAME_PREFIX,
  SyntheticFixtures,
  syntheticConsentGrant,
  syntheticDevice,
  syntheticObservation,
  syntheticPerson,
  syntheticProvenance,
  type SyntheticObservation,
} from "./fixtures.js";

const MS_PER_DAY = 86_400_000;

function buildFixtureSnapshot(seed: string): string {
  const fixtures = new SyntheticFixtures({ seed });
  return JSON.stringify({
    person: fixtures.person(),
    device: fixtures.device(),
    provenance: fixtures.provenance(),
    observation: fixtures.observation(),
    consentGrant: fixtures.consentGrant(),
  });
}

describe("SyntheticFixtures determinism", () => {
  it("two builds with the same seed produce identical output", () => {
    expect(buildFixtureSnapshot("determinism-seed")).toBe(buildFixtureSnapshot("determinism-seed"));
  });

  it("different seeds produce different output", () => {
    expect(buildFixtureSnapshot("seed-alpha")).not.toBe(buildFixtureSnapshot("seed-beta"));
  });

  it("independent instances with the same seed replay the same sequence", () => {
    const first = new SyntheticFixtures({ seed: "replay" });
    const second = new SyntheticFixtures({ seed: "replay" });
    expect(first.person().id).toBe(second.person().id);
    expect(first.device().id).toBe(second.device().id);
    expect(first.observation().id).toBe(second.observation().id);
    expect(first.consentGrant().id).toBe(second.consentGrant().id);
  });

  it("reset() restores the initial fixture sequence and clock", () => {
    const fixtures = new SyntheticFixtures({ seed: "reset" });
    const first = JSON.stringify(fixtures.person());
    fixtures.clock.advance(60_000);
    fixtures.person();
    fixtures.observation();
    fixtures.reset();
    expect(JSON.stringify(fixtures.person())).toBe(first);
    expect(fixtures.clock.epochMs).toBe(0);
  });
});

describe("synthetic tagging", () => {
  it("tags every fixture kind as synthetic:true with its seed and sequence", () => {
    const fixtures = new SyntheticFixtures({ seed: "tagging" });
    const fixturesList = [
      fixtures.person(),
      fixtures.device(),
      fixtures.provenance(),
      fixtures.observation(),
      fixtures.consentGrant(),
    ];
    for (const fixture of fixturesList) {
      expect(fixture.metadata.synthetic).toBe(true);
      expect(fixture.metadata.seed).toBe("tagging");
      expect(fixture.metadata.sequence).toBeGreaterThan(0);
    }
  });

  it("uses obviously fake SYNTH- identifiers and names", () => {
    const fixtures = new SyntheticFixtures({ seed: "fake-ids" });
    const person = fixtures.person();
    expect(person.id).toContain(`${SYNTH_NAME_PREFIX}-`);
    expect(person.displayName.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    const device = fixtures.device();
    expect(device.id).toContain(`${SYNTH_NAME_PREFIX}-`);
    expect(device.name.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    const observation = fixtures.observation();
    expect(observation.id).toContain(`${SYNTH_NAME_PREFIX}-`);
    expect(observation.conceptCode.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    expect(observation.methodId.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    const grant = fixtures.consentGrant();
    expect(grant.id).toContain(`${SYNTH_NAME_PREFIX}-`);
    expect(grant.recipientId.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    expect(grant.purpose.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
    const provenance = fixtures.provenance();
    expect(provenance.provenanceId).toContain(`${SYNTH_NAME_PREFIX}-`);
    expect(provenance.correlationId?.startsWith(`${SYNTH_NAME_PREFIX}-`)).toBe(true);
  });
});

describe("domain compatibility", () => {
  it("generates ids that pass the canonical domain guards", () => {
    const fixtures = new SyntheticFixtures({ seed: "domain-compat" });
    expect(isPersonId(fixtures.person().id)).toBe(true);
    expect(isDeviceId(fixtures.device().id)).toBe(true);
    expect(isObservationId(fixtures.observation().id)).toBe(true);
    expect(isGrantId(fixtures.consentGrant().id)).toBe(true);
    expect(isProvenanceId(fixtures.provenance().provenanceId)).toBe(true);
    const observation = fixtures.observation();
    expect(isPersonId(observation.personId)).toBe(true);
    expect(isSourceId(observation.sourceId)).toBe(true);
    expect(isProvenanceId(observation.provenanceId)).toBe(true);
  });

  it("builds observations with evidenceLabel and full provenance fields", () => {
    const fixtures = new SyntheticFixtures({ seed: "observations" });
    const observation = fixtures.observation();
    expect(EVIDENCE_LABELS).toContain(observation.evidenceLabel);
    expect(observation.validationState).toBe("pending");
    expect(isQualityScore(observation.quality)).toBe(true);
    expect(observation.evidenceId).toBeUndefined();
    expect(isProvenance(observation.provenance)).toBe(true);
    expect(observation.provenanceId).toBe(observation.provenance.provenanceId);
    expect(observation.provenance.subject).toBe(observation.personId);
    expect(observation.provenance.actor).toBe(observation.sourceId);
  });

  it("builds active consent grants expiring after the default lifetime", () => {
    const fixtures = new SyntheticFixtures({ seed: "grants" });
    const grant = fixtures.consentGrant();
    expect(grant.state).toBe("active");
    expect(grant.scope.length).toBeGreaterThan(0);
    const expectedExpiry = fixtures.clock.now().getTime() + DEFAULT_GRANT_LIFETIME_DAYS * MS_PER_DAY;
    expect(grant.expiresAt.getTime()).toBe(expectedExpiry);
  });
});

describe("clock integration", () => {
  it("derives timestamps from the deterministic clock", () => {
    const fixtures = new SyntheticFixtures({ seed: "clock", epochMs: 1_000 });
    const early = fixtures.person();
    fixtures.clock.advance(5_000);
    const late = fixtures.person();
    expect(early.createdAt.getTime()).toBe(1_000);
    expect(late.createdAt.getTime()).toBe(6_000);
  });

  it("defaults timestamps to the Unix epoch", () => {
    const fixtures = new SyntheticFixtures({ seed: "epoch" });
    expect(fixtures.person().createdAt.getTime()).toBe(0);
    expect(fixtures.observation().observedAt.getTime()).toBe(0);
    expect(fixtures.observation().effectiveAt.getTime()).toBe(0);
  });
});

describe("overrides", () => {
  it("applies value overrides without losing the synthetic tag", () => {
    const fixtures = new SyntheticFixtures({ seed: "overrides" });
    const person = fixtures.person({ displayName: "SYNTH-Custom-Name" });
    expect(person.displayName).toBe("SYNTH-Custom-Name");
    expect(person.metadata.synthetic).toBe(true);
    expect(isPersonId(person.id)).toBe(true);
  });

  it("links an overridden personId into the observation and its provenance", () => {
    const fixtures = new SyntheticFixtures({ seed: "link" });
    const person = fixtures.person();
    const observation = fixtures.observation({ personId: person.id });
    expect(observation.personId).toBe(person.id);
    expect(observation.provenance.subject).toBe(person.id);
  });

  it("allows optional fields such as evidenceId to be supplied", () => {
    const fixtures = new SyntheticFixtures({ seed: "evidence" });
    const evidenceId = fixtures.ids.next("evid") as EvidenceId;
    const observation = fixtures.observation({ evidenceId });
    expect(observation.evidenceId).toBe(evidenceId);
    expect(isEvidenceId(observation.evidenceId)).toBe(true);
  });

  it("ignores undefined override entries", () => {
    const fixtures = new SyntheticFixtures({ seed: "undefined" });
    const person = fixtures.person({ displayName: undefined });
    expect(person.displayName).toBe("SYNTH-Person-00000001");
  });
});

describe("module-level synthetic builders", () => {
  it("produce identical output for the same seed", () => {
    expect(JSON.stringify(syntheticPerson(undefined, { seed: "module" }))).toBe(
      JSON.stringify(syntheticPerson(undefined, { seed: "module" })),
    );
    expect(JSON.stringify(syntheticDevice(undefined, { seed: "module" }))).toBe(
      JSON.stringify(syntheticDevice(undefined, { seed: "module" })),
    );
    expect(JSON.stringify(syntheticProvenance(undefined, { seed: "module" }))).toBe(
      JSON.stringify(syntheticProvenance(undefined, { seed: "module" })),
    );
    expect(JSON.stringify(syntheticObservation(undefined, { seed: "module" }))).toBe(
      JSON.stringify(syntheticObservation(undefined, { seed: "module" })),
    );
    expect(JSON.stringify(syntheticConsentGrant(undefined, { seed: "module" }))).toBe(
      JSON.stringify(syntheticConsentGrant(undefined, { seed: "module" })),
    );
  });

  it("produce different output for different seeds", () => {
    expect(syntheticPerson(undefined, { seed: "one" }).id).not.toBe(
      syntheticPerson(undefined, { seed: "two" }).id,
    );
  });

  it("default to deterministic options (epoch clock, default seed)", () => {
    const person = syntheticPerson();
    expect(person.metadata.synthetic).toBe(true);
    expect(person.createdAt.getTime()).toBe(0);
    expect(person.metadata.seed).toBe("seed-0001");
  });

  it("apply overrides", () => {
    const observation: SyntheticObservation = syntheticObservation({ value: 120 }, { seed: "ov" });
    expect(observation.value).toBe(120);
  });
});
