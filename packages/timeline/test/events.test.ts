import { describe, expect, expectTypeOf, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import {
  TIMELINE_EVENT_ID_PREFIX,
  TIMELINE_EVENT_TYPES,
  assertTimelineEventEnvelope,
  isTimelineEventActor,
  isTimelineEventEnvelope,
  isTimelineEventId,
  isTimelineEventType,
  parseTimelineEventId,
  parseTimelineEventType,
  type TimelineEventEnvelope,
} from "../src/events.js";
import { buildTimelineWorld, type TimelineWorld } from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

const EVENT_BODY = "SYNTH-tl-00000001";

function makeEnvelope(overrides: Partial<TimelineEventEnvelope> = {}): TimelineEventEnvelope {
  return {
    eventId: parseTimelineEventId(`tevt_${EVENT_BODY}`),
    type: "TIMELINE_READ",
    version: 1,
    occurredAt: world.requestAt,
    actor: world.practitioner,
    subject: world.subject,
    payloadSchemaVersion: "1.0.0",
    ...overrides,
  };
}

describe("the timeline event id grammar (contracts-mirror)", () => {
  it("parses a canonical tevt_ id", () => {
    expect(parseTimelineEventId(`tevt_${EVENT_BODY}`)).toBe(`tevt_${EVENT_BODY}`);
    expect(isTimelineEventId(`tevt_${EVENT_BODY}`)).toBe(true);
    expect(TIMELINE_EVENT_ID_PREFIX).toBe("tevt");
  });

  it("rejects malformed ids and foreign prefixes", () => {
    expect(() => parseTimelineEventId("tevt_short")).toThrow(DomainInvariantError);
    expect(() => parseTimelineEventId("tevt_")).toThrow(DomainInvariantError);
    expect(() => parseTimelineEventId(`evt_${EVENT_BODY}`)).toThrow(DomainInvariantError);
    expect(() => parseTimelineEventId(`cevt_${EVENT_BODY}`)).toThrow(DomainInvariantError);
    expect(isTimelineEventId(`evt_${EVENT_BODY}`)).toBe(false);
    expect(isTimelineEventId(42)).toBe(false);
  });
});

describe("the frozen event vocabulary", () => {
  it("contains exactly TIMELINE_READ — the access decision event", () => {
    expect(TIMELINE_EVENT_TYPES).toEqual(["TIMELINE_READ"]);
    expect(new Set(TIMELINE_EVENT_TYPES).size).toBe(TIMELINE_EVENT_TYPES.length);
    expectTypeOf<(typeof TIMELINE_EVENT_TYPES)[number]>().not.toBeNever();
  });

  it("guards and parses the vocabulary", () => {
    expect(isTimelineEventType("TIMELINE_READ")).toBe(true);
    expect(isTimelineEventType("TIMELINE_WRITTEN")).toBe(false);
    expect(isTimelineEventType(42)).toBe(false);
    expect(() => parseTimelineEventType("unknown")).toThrow(DomainInvariantError);
    expect(parseTimelineEventType("TIMELINE_READ")).toBe("TIMELINE_READ");
  });
});

describe("the envelope (§11 field list, contracts-mirrored)", () => {
  it("accepts a well-formed envelope", () => {
    const envelope = makeEnvelope();
    expect(isTimelineEventEnvelope(envelope)).toBe(true);
    expect(() => assertTimelineEventEnvelope(envelope)).not.toThrow();
  });

  it("accepts optional correlation/causation tokens when non-empty", () => {
    const envelope = makeEnvelope({ correlationId: "corr-token-1", causationId: "cause-1" });
    expect(isTimelineEventEnvelope(envelope)).toBe(true);
  });

  it("rejects malformed envelopes field by field", () => {
    expect(isTimelineEventEnvelope({})).toBe(false);
    expect(isTimelineEventEnvelope(null)).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ eventId: `evt_${EVENT_BODY}` as never }))).toBe(
      false,
    );
    expect(isTimelineEventEnvelope(makeEnvelope({ type: "unknown" as never }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ version: 0 }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ version: 1.5 }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ occurredAt: new Date("nope") }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ actor: "not-an-actor" as never }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ subject: "prsn_short" as never }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ correlationId: "" }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ causationId: "" }))).toBe(false);
    expect(isTimelineEventEnvelope(makeEnvelope({ payloadSchemaVersion: "" }))).toBe(false);
    expect(() => assertTimelineEventEnvelope({ type: "TIMELINE_READ" })).toThrow(
      DomainInvariantError,
    );
  });

  it("the actor union is practitioner-first (the care-team reader) with the future person seam", () => {
    expect(isTimelineEventActor(world.practitioner)).toBe(true);
    expect(isTimelineEventActor(world.subject)).toBe(true);
    expect(isTimelineEventActor("pract_short")).toBe(false);
    expect(isTimelineEventActor("src_SYNTH-not-an-actor-xx")).toBe(false);
  });
});

describe("the service mints TIMELINE_READ events through the injected factory", () => {
  it("every assembleTimeline outcome carries one (id tevt_-, version 1, semver payload schema)", async () => {
    const harness = world.makeService();
    harness.intents.put(world.intent());
    const granted = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext(),
    );
    expect(isTimelineEventEnvelope(granted.event)).toBe(true);
    expect(granted.event.eventId.startsWith("tevt_")).toBe(true);
    expect(granted.event.version).toBe(1);
    expect(granted.event.payloadSchemaVersion).toBe("1.0.0");
    expect(granted.event.type).toBe("TIMELINE_READ");

    const denied = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext({
        snapshot: world.makeSnapshot({ careTeam: world.makeTeam({ state: "dissolved" }) }),
      }),
    );
    expect(isTimelineEventEnvelope(denied.event)).toBe(true);
    expect(denied.event.type).toBe("TIMELINE_READ");
    expect(denied.event.eventId.startsWith("tevt_")).toBe(true);
  });

  it("the event ids are factory-minted and monotonic (deterministic seed)", async () => {
    const harness = world.makeService();
    const first = await harness.service.assembleTimeline(world.subject, {}, world.makeContext());
    const second = await harness.service.assembleTimeline(world.subject, {}, world.makeContext());
    expect(harness.ids.issued).toBe(2);
    expect(first.event.eventId).not.toBe(second.event.eventId);
    expect(isTimelineEventId(first.event.eventId)).toBe(true);
    expect(isTimelineEventId(second.event.eventId)).toBe(true);
  });
});
