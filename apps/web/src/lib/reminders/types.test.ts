// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  FallbackOfferVocabulary,
  ReminderDeferRecord,
  ReminderPayload,
  ReminderRung,
} from "@orbb/notifications";
import {
  TODAY_REMINDER_RUNGS,
  isTodayReminderRung,
  type TodayFallbackOfferFixture,
  type TodayReminderDeferFixture,
  type TodayReminderFixturePayload,
  type TodayReminderRung,
} from "./types";

/**
 * Reminder wire-type CONTRACT tests (M6 EXIT): pin the app-side mirror to
 * the REAL `@orbb/notifications` (B8) shapes — the M6-A catalog-mirror
 * pattern, in two layers:
 *
 *   1. COMPILE-TIME structural pins (this file is typechecked by
 *      `pnpm typecheck`): fixture values built from the mirror must be
 *      assignable to the REAL package types and back (bi-directional
 *      structural compatibility — no casts on the compatibility itself);
 *   2. RUNTIME frozen-vocabulary pins (this file runs under vitest): the
 *      ladder/rung/authority literals are pinned to the frozen B8
 *      vocabulary, so a package vocabulary change fails this mirror
 *      loudly.
 *
 * RECORDED BOUNDARY: `@orbb/notifications` resolves at runtime to its
 * unbuilt `dist/` entry, so only `import type` is possible here (the
 * recorded handoff in `types.ts`); the runtime pins assert the mirrored
 * constants against the frozen literals the package exports.
 */

// ---------------------------------------------------------------------------
// 1. Compile-time structural pins (bi-directional assignability).
// ---------------------------------------------------------------------------

/** A rung literal flows REAL -> mirror. */
const realRung: ReminderRung = "REMIND_WITH_FALLBACK_OFFER";
/** A rung literal flows mirror -> REAL (the mirror IS the real type). */
const mirrorRung: TodayReminderRung = realRung;

/** The fallback-offer fixture shape is the REAL vocabulary shape. */
const offerPin: FallbackOfferVocabulary = {
  enforcementAuthority: "none",
  methods: [
    {
      methodId: "SYNTH-method-manual-body-weight",
      methodLabel: "Manual weight reading",
      role: "preferred",
    },
    {
      methodId: "SYNTH-method-cuff-bp-panel",
      methodLabel: "Automatic cuff sync",
      role: "fallback",
    },
  ],
};
const offerMirror: TodayFallbackOfferFixture = offerPin;
const offerBack: FallbackOfferVocabulary = offerMirror;

/** The defer fixture shape is the REAL defer record shape. */
const deferPin: ReminderDeferRecord = {
  from: new Date("2026-09-15T22:59:59.999Z"),
  reason: "quiet-hours",
};
const deferMirror: TodayReminderDeferFixture = deferPin;
const deferBack: ReminderDeferRecord = deferMirror;

/** A full rung-2 fixture payload is the REAL payload shape, both ways. */
const payloadPin: ReminderPayload = {
  rung: "REMIND_WITH_FALLBACK_OFFER",
  taskId: "task_SYNTH-today-wt-000003" as ReminderPayload["taskId"],
  planId: "plan_SYNTH-today-wt-mornings-0003" as ReminderPayload["planId"],
  metricId: "SYNTH-metric-body-weight",
  metricLabel: "Body Weight",
  window: {
    sequence: 0,
    startsAt: new Date("2026-09-14T07:00:00.000Z"),
    endsAt: new Date("2026-09-14T09:00:00.000Z"),
  },
  fallbackOffer: offerPin,
  ...(deferPin !== undefined ? {} : {}),
};
const payloadMirror: TodayReminderFixturePayload = payloadPin;
const payloadBack: ReminderPayload = payloadMirror;

/** A full rung-1 fixture payload (no offer key at all — the B8 rule). */
const rungOnePayload: TodayReminderFixturePayload = {
  rung: "REMIND",
  taskId: "task_SYNTH-today-bp-000001" as ReminderPayload["taskId"],
  planId: "plan_SYNTH-today-bp-daily-0001" as ReminderPayload["planId"],
  metricId: "SYNTH-metric-bp-systolic",
  metricLabel: "Blood Pressure Systolic",
  window: {
    sequence: 0,
    startsAt: new Date("2026-09-15T00:00:00.000Z"),
    endsAt: new Date("2026-09-15T23:59:59.999Z"),
  },
};
const rungOneBack: ReminderPayload = rungOnePayload;

// ---------------------------------------------------------------------------
// 2. Runtime frozen-vocabulary pins.
// ---------------------------------------------------------------------------

describe("reminder wire types — the B8 contract mirror", () => {
  it("keeps the bi-directional structural pins live (REAL -> mirror -> REAL)", () => {
    // The module-level pins above are the compile-time proof (this file
    // is typechecked); these assertions keep them REFERENCED so the
    // bi-directional assignability stays enforced, never rotting away
    // under no-unused-vars.
    expect(mirrorRung).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(offerBack.enforcementAuthority).toBe("none");
    expect(deferBack.reason).toBe("quiet-hours");
  });

  it("mirrors the frozen REMINDER_RUNGS ladder, in escalation order", () => {
    expect(TODAY_REMINDER_RUNGS).toEqual(["REMIND", "REMIND_WITH_FALLBACK_OFFER"]);
  });

  it("guards the rung vocabulary (closed set)", () => {
    expect(isTodayReminderRung("REMIND")).toBe(true);
    expect(isTodayReminderRung("REMIND_WITH_FALLBACK_OFFER")).toBe(true);
    expect(isTodayReminderRung("ESCALATE")).toBe(false);
    expect(isTodayReminderRung("")).toBe(false);
    expect(isTodayReminderRung(42)).toBe(false);
  });

  it("type-encodes enforcementAuthority: none on the offer (never an order)", () => {
    const offer: TodayFallbackOfferFixture = {
      enforcementAuthority: "none",
      methods: [
        {
          methodId: "SYNTH-method-manual-body-weight",
          methodLabel: "Manual weight reading",
          role: "preferred",
        },
      ],
    };
    // The literal is the only value the mirror can express.
    expect(offer.enforcementAuthority).toBe("none");
  });

  it("carries the quiet-hours defer reason vocabulary (defer, never drop)", () => {
    const defer: TodayReminderDeferFixture = {
      from: new Date("2026-09-15T22:59:59.999Z"),
      reason: "quiet-hours",
    };
    expect(defer.reason).toBe("quiet-hours");
  });

  it("keeps the pinned fixture payloads PHI-free (ids + labels only)", () => {
    const serialized = JSON.stringify([payloadBack, rungOneBack], (_key, value) =>
      value instanceof Date ? value.toISOString() : value,
    );
    expect(serialized).not.toContain("personId");
    expect(serialized).not.toContain("value");
    expect(serialized).not.toContain("conceptCode");
    expect(serialized).not.toContain("evidence");
    expect(serialized).not.toContain("prsn_");
  });
});
