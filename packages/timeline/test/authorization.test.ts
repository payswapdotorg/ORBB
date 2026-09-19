import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CARE_TEAM_DENY_REASONS,
  CARE_TEAM_SCOPE_PERMISSIONS,
  type CareTeamDenyReason,
} from "@orbb/clinical";
import {
  TIMELINE_READ_PERMISSION,
  evaluateTimelineAccess,
  timelineDenialFor,
  type TimelineAccessAudit,
  type TimelineReadDenied,
  type TimelineReadOutcome,
} from "../src/authorization.js";
import { isTimelineEventEnvelope } from "../src/events.js";
import { PatientTimelineService } from "../src/assembly.js";
import type {
  IntentTimelineStore,
  ObservationTimelineStore,
  TaskTimelineStore,
} from "../src/ports.js";
import { buildTimelineWorld, type SnapshotOverrides, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

// ---------------------------------------------------------------------------
// Spy stores: a denied read must not touch a single store port (an
// allowed read flows through — counting and delegating).
// ---------------------------------------------------------------------------

interface StoreSpyCounts {
  observations: number;
  tasks: number;
  intents: number;
}

function serviceWithSpies() {
  const harness = world.makeService();
  const counts: StoreSpyCounts = { observations: 0, tasks: 0, intents: 0 };
  const observations: ObservationTimelineStore = {
    findByPerson: (personId, bounds) => {
      counts.observations += 1;
      return harness.observations.findByPerson(personId, bounds);
    },
  };
  const tasks: TaskTimelineStore = {
    findByPerson: (personId, bounds) => {
      counts.tasks += 1;
      return harness.tasks.findByPerson(personId, bounds);
    },
  };
  const intents: IntentTimelineStore = {
    findByPerson: (personId, bounds) => {
      counts.intents += 1;
      return harness.intents.findByPerson(personId, bounds);
    },
  };
  const spiedService = new PatientTimelineService({
    observations,
    tasks,
    intents,
    clock: harness.clock,
    ids: harness.ids,
  });
  return {
    counts,
    clock: harness.clock,
    seed: () => {
      // The subject's data EXISTS — a denial must STILL read nothing.
      harness.observations.put(world.canonicalRecord(world.observation()));
      harness.tasks.put(world.task());
      harness.intents.put(world.intent());
    },
    spiedService,
  };
}

// ---------------------------------------------------------------------------
// The exhaustive deny-by-default proof: EVERY clinical deny reason maps
// to a typed timeline denial (and the reachable ones deny the read).
// ---------------------------------------------------------------------------

interface DenialCase {
  readonly reason: CareTeamDenyReason;
  readonly label: string;
  readonly snapshot?: SnapshotOverrides;
}

const EXHAUSTIVE_DENIALS: readonly DenialCase[] = [
  {
    reason: "unknown-scope-permission",
    label:
      "the timeline itself can never request an out-of-vocabulary permission (the gate hard-codes the frozen timeline:read) — mapping-level proof",
  },
  {
    reason: "unknown-recipient",
    label: "the grant's recipientId does not resolve to the requesting practitioner",
    snapshot: { grant: world.makeGrant({ recipientId: "legacy-opaque-recipient-42" }) },
  },
  {
    reason: "subject-mismatch",
    label: "the grant belongs to a different subject",
    snapshot: { grant: world.makeGrant({ subjectId: world.otherPerson }) },
  },
  {
    reason: "revoked-grant",
    label: "the grant is revoked (kernel state)",
    snapshot: { grant: world.makeGrant({ state: "revoked" }) },
  },
  {
    reason: "expired-grant",
    label: "the grant is expired at the evaluation instant (injected clock)",
    snapshot: { grant: world.makeGrant({ expiresAt: new Date("2025-01-01T00:00:00.000Z") }) },
  },
  {
    reason: "missing-scope",
    label: "the grant does not carry timeline:read",
    snapshot: { grant: world.makeGrant({ scope: ["observations:read", "intent:read"] }) },
  },
  {
    reason: "purpose-mismatch",
    label: "the stated purpose differs from the grant purpose",
    snapshot: { grant: world.makeGrant({ purpose: "RESEARCH" }) },
  },
  {
    reason: "unconfirmed-patient-link",
    label: "the patient link is still only requested",
    snapshot: { patientLink: world.makeLink({ state: "requested" }) },
  },
  {
    reason: "inactive-care-team",
    label: "the care team is dissolved (terminal)",
    snapshot: { careTeam: world.makeTeam({ state: "dissolved" }) },
  },
  {
    reason: "not-on-care-team",
    label: "the practitioner is not on the care team",
    snapshot: { careTeam: world.makeTeam({ entries: [] }) },
  },
  {
    reason: "suspended-practitioner",
    label: "the practitioner is suspended-from-verified",
    snapshot: { practitioner: world.makePractitioner({ state: "suspended-from-verified" }) },
  },
  {
    reason: "unverified-practitioner",
    label: "the practitioner was never verified (verification is never implied)",
    snapshot: { practitioner: world.makePractitioner({ state: "unverified" }) },
  },
  {
    reason: "dissolved-organization",
    label: "the organization is dissolved",
    snapshot: { organization: world.makeOrganization({ state: "dissolved" }) },
  },
  {
    reason: "suspended-organization",
    label: "the organization is suspended",
    snapshot: { organization: world.makeOrganization({ state: "suspended" }) },
  },
  {
    reason: "inactive-membership",
    label: "the practitioner's organization membership is inactive",
    snapshot: { membership: world.makeMembership({ active: false }) },
  },
  {
    reason: "dissolved-clinic",
    label: "the clinic is dissolved",
    snapshot: { clinic: world.makeClinic({ state: "dissolved" }) },
  },
  {
    reason: "suspended-clinic",
    label: "the clinic is suspended",
    snapshot: { clinic: world.makeClinic({ state: "suspended" }) },
  },
  {
    reason: "inactive-affiliation",
    label: "the practitioner's clinic affiliation is inactive",
    snapshot: { affiliation: world.makeAffiliation({ active: false }) },
  },
];

describe("deny-by-default is ABSOLUTE — every clinical deny reason maps to a typed timeline denial", () => {
  it("the mapping is TOTAL over the REAL runtime clinical vocabulary (drift lock)", () => {
    expect(CARE_TEAM_DENY_REASONS).toEqual(EXHAUSTIVE_DENIALS.map((denial) => denial.reason));
    expect(new Set(CARE_TEAM_DENY_REASONS).size).toBe(CARE_TEAM_DENY_REASONS.length);
    for (const reason of CARE_TEAM_DENY_REASONS) {
      expect(() => timelineDenialFor(reason)).not.toThrow();
      expect(timelineDenialFor(reason)).toBe(reason);
    }
  });

  it("the frozen scope this gate demands IS the clinical timeline:read (named in the vocabulary)", () => {
    expect(TIMELINE_READ_PERMISSION).toBe("timeline:read");
    expect(CARE_TEAM_SCOPE_PERMISSIONS).toContain("timeline:read");
    expectTypeOf<typeof TIMELINE_READ_PERMISSION>().toEqualTypeOf<"timeline:read">();
  });

  for (const denial of EXHAUSTIVE_DENIALS) {
    it(`${denial.reason}: ${denial.label}`, async () => {
      if (denial.snapshot === undefined) {
        // Mapping-level proof only (the timeline can never construct an
        // out-of-vocabulary permission request — unreachable by design).
        expect(timelineDenialFor(denial.reason)).toBe(denial.reason);
        return;
      }
      const spied = serviceWithSpies();
      spied.seed();
      const outcome = await spied.spiedService.assembleTimeline(
        world.subject,
        {},
        world.makeContext({ snapshot: world.makeSnapshot(denial.snapshot) }),
      );
      expect(outcome.kind).toBe("denied");
      if (outcome.kind === "denied") {
        expect(outcome.reason).toBe(denial.reason);
        expect(outcome.evaluatedAt.getTime()).toBe(world.requestAt.getTime());
        expect(outcome.audit.decision).toBe("DENY");
        expect(outcome.audit.reason).toBe(denial.reason);
        expect(outcome.audit.permission).toBe("timeline:read");
      }
      // NO partial entry leakage: the store ports were never read.
      expect(spied.counts).toEqual({ observations: 0, tasks: 0, intents: 0 });
    });
  }
});

describe("the denial is all-or-nothing (never a partial timeline)", () => {
  it("a denied outcome carries NO page, NO entry count, NO window echo", async () => {
    const spied = serviceWithSpies();
    spied.seed();
    const outcome = await spied.spiedService.assembleTimeline(
      world.subject,
      { from: new Date(0), to: new Date(1), limit: 10 },
      world.makeContext({ snapshot: world.makeSnapshot({ grant: world.makeGrant({ state: "revoked" }) }) }),
    );
    expect(outcome.kind).toBe("denied");
    if (outcome.kind === "denied") {
      const keys = Object.keys(outcome).sort();
      expect(keys).toEqual(["audit", "evaluatedAt", "event", "kind", "reason"]);
      expect("page" in outcome).toBe(false);
    }
  });

  it("every non-confirmed link shape denies (declined, revoked, wrong pair)", async () => {
    for (const patientLink of [
      world.makeLink({ state: "declined" }),
      world.makeLink({ state: "revoked" }),
      world.makeLink({ personId: world.otherPerson }),
      world.makeLink({ practitionerId: world.otherPractitioner }),
    ]) {
      const spied = serviceWithSpies();
      const outcome = await spied.spiedService.assembleTimeline(
        world.subject,
        {},
        world.makeContext({ snapshot: world.makeSnapshot({ patientLink }) }),
      );
      expect(outcome.kind).toBe("denied");
      if (outcome.kind === "denied") {
        expect(outcome.reason).toBe("unconfirmed-patient-link");
      }
    }
  });

  it("no confirmed link, no timeline — a grant WITHOUT a link confers nothing", async () => {
    const spied = serviceWithSpies();
    spied.seed();
    const outcome = await spied.spiedService.assembleTimeline(
      world.subject,
      {},
      world.makeContext({ snapshot: world.makeSnapshot({ patientLink: world.makeLink({ state: "requested" }) }) }),
    );
    expect(outcome.kind).toBe("denied");
  });
});

describe("the allow path — ONLY when every condition holds", () => {
  it("positive control: an ALLOWED read through the spied service touches all three planes", async () => {
    const spied = serviceWithSpies();
    spied.seed();
    const outcome = await spied.spiedService.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(outcome.kind).toBe("granted");
    if (outcome.kind === "granted") {
      expect(outcome.page.entries.length).toBe(3);
    }
    expect(spied.counts).toEqual({ observations: 1, tasks: 1, intents: 1 });
  });

  it("the full clinic-scoped snapshot grants the timeline read", async () => {
    const harness = world.makeService();
    harness.observations.put(world.canonicalRecord(world.observation()));
    const outcome = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(outcome.kind).toBe("granted");
    if (outcome.kind === "granted") {
      expect(outcome.page.entries.length).toBe(1);
      expect(outcome.audit.decision).toBe("ALLOW");
      expect(outcome.audit.reason).toBe("timeline-read-granted");
      expect(outcome.audit.permission).toBe("timeline:read");
      expect(outcome.audit.actor).toBe(world.practitioner);
      expect(outcome.audit.subjectId).toBe(world.subject);
      expect(outcome.audit.at.getTime()).toBe(world.requestAt.getTime());
      expect(outcome.grantId).toBe(world.makeGrant().id);
      expect(outcome.careTeamRole).toBe("primary-care");
    }
  });

  it("the org-level (clinic-less) snapshot grants equally — no clinic requirements then", async () => {
    const harness = world.makeService();
    const outcome = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext({ snapshot: world.makeSnapshot({ clinicScoped: false }) }),
    );
    expect(outcome.kind).toBe("granted");
  });

  it("every outcome (ALLOW and DENY alike) carries a well-formed TIMELINE_READ event", async () => {
    const harness = world.makeService();
    harness.intents.put(world.intent());
    const granted = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    const denied = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext({
        snapshot: world.makeSnapshot({ practitioner: world.makePractitioner({ state: "unverified" }) }),
      }),
    );
    for (const outcome of [granted, denied] as const) {
      expect(isTimelineEventEnvelope(outcome.event)).toBe(true);
      expect(outcome.event.type).toBe("TIMELINE_READ");
      expect(outcome.event.actor).toBe(world.practitioner);
      expect(outcome.event.subject).toBe(world.subject);
      expect(outcome.event.occurredAt.getTime()).toBe(world.requestAt.getTime());
    }
    // Each read mints its own event id (monotonic factory).
    expect(granted.event.eventId).not.toBe(denied.event.eventId);
  });

  it("the audit record is shaped for access_audits (WHO/WHAT/WHEN/DECISION/REASON)", () => {
    const { decision, audit } = evaluateTimelineAccess(
      world.subject,
      world.makeContext(),
      world.requestAt,
    );
    expect(decision.kind).toBe("ALLOW");
    const keys = Object.keys(audit).sort();
    expect(keys).toEqual(["actor", "at", "decision", "permission", "reason", "subjectId"]);
    const auditRecord: TimelineAccessAudit = audit;
    expect(auditRecord.permission).toBe("timeline:read");
  });

  it("evaluateTimelineAccess is pure: same inputs, same decision", () => {
    const first = evaluateTimelineAccess(world.subject, world.makeContext(), world.requestAt);
    const second = evaluateTimelineAccess(world.subject, world.makeContext(), world.requestAt);
    expect(first.decision.kind).toBe(second.decision.kind);
    expect(first.audit).toEqual(second.audit);
  });
});

describe("expired-grant denial via the INJECTED clock (never wall-clock)", () => {
  it("denies exactly AT the expiry instant (kernel rule: valid strictly before expiry)", async () => {
    const harness = world.makeService({ epochMs: world.requestAt.getTime() });
    harness.clock.advanceTo(world.expiresAt.getTime());
    const outcome = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(outcome.kind).toBe("denied");
    if (outcome.kind === "denied") {
      expect(outcome.reason).toBe("expired-grant");
      expect(outcome.evaluatedAt.getTime()).toBe(world.expiresAt.getTime());
    }
  });

  it("denies AFTER the expiry instant and grants strictly BEFORE it", async () => {
    const after = world.makeService({ epochMs: world.requestAt.getTime() });
    after.clock.advanceTo(world.expiresAt.getTime() + 1);
    const deniedOutcome = await after.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(deniedOutcome.kind).toBe("denied");
    if (deniedOutcome.kind === "denied") {
      expect(deniedOutcome.reason).toBe("expired-grant");
    }

    const before = world.makeService({ epochMs: world.expiresAt.getTime() - 1 });
    const grantedOutcome = await before.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(grantedOutcome.kind).toBe("granted");
  });

  it("the evaluation instant rides the injected clock (moving it moves the decision)", async () => {
    const harness = world.makeService({ epochMs: world.requestAt.getTime() });
    const early = await harness.service.assembleTimeline(world.subject, {}, world.makeContext());
    expect(early.kind).toBe("granted");
    harness.clock.advanceTo(new Date("2027-01-01T00:00:00.000Z").getTime());
    const late = await harness.service.assembleTimeline(world.subject, {}, world.makeContext());
    expect(late.kind).toBe("denied");
    if (late.kind === "denied") {
      expect(late.reason).toBe("expired-grant");
      expect(late.audit.at.getTime()).toBe(new Date("2027-01-01T00:00:00.000Z").getTime());
    }
  });
});

describe("the outcome type surface (compile-time honesty)", () => {
  it("the denied outcome structurally cannot carry a page", () => {
    const denied: TimelineReadDenied = {
      kind: "denied",
      reason: "expired-grant",
      evaluatedAt: world.requestAt,
      audit: {
        actor: world.practitioner,
        subjectId: world.subject,
        permission: "timeline:read",
        at: world.requestAt,
        decision: "DENY",
        reason: "expired-grant",
      },
      event: {
        eventId: "tevt_SYNTH-tl-00000001" as never,
        type: "TIMELINE_READ",
        version: 1,
        occurredAt: world.requestAt,
        actor: world.practitioner,
        subject: world.subject,
        payloadSchemaVersion: "1.0.0",
      },
    };
    const outcome: TimelineReadOutcome = denied;
    expect(outcome.kind).toBe("denied");
    expectTypeOf<TimelineReadDenied>().not.toHaveProperty("page");
  });
});
