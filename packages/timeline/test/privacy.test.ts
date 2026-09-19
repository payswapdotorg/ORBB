import { describe, expect, it } from "vitest";
import { timelineSummary } from "../src/summary.js";
import { buildTimelineWorld, type TimelineWorld } from "./worlds.js";
import type { TimelineReadOutcome } from "../src/authorization.js";

const world: TimelineWorld = buildTimelineWorld();

// ---------------------------------------------------------------------------
// DECOY planting (agent-protocol test-data rules + the A49 no-PHI rule):
// free text and identity-shaped strings are planted in every place the
// records COULD carry them; the serialized outcome surfaces must never
// contain them. SYNTH fixtures only — these decoys are themselves
// obviously fake.
// ---------------------------------------------------------------------------

const DECOY_OBJECTIVE =
  "SYNTH-DECOY-FREETEXT contact +1-555-0100 or decoy@example.org — LOWER BLOOD PRESSURE NOW";
const DECOY_PRACTITIONER_NAME = "Dr. SYNTH-DECOY-Name";
const DECOYS: readonly string[] = [
  "SYNTH-DECOY-FREETEXT",
  "+1-555-0100",
  "decoy@example.org",
  "LOWER BLOOD PRESSURE NOW",
  DECOY_PRACTITIONER_NAME,
];

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner instanceof Date ? inner.toISOString() : inner,
  );
}

/** Asserts none of the decoys appear in a serialized surface. */
function expectNoDecoys(surface: unknown, label: string): void {
  const serialized = serialize(surface);
  for (const decoy of DECOYS) {
    expect(serialized, `${label} must not leak <${decoy}>`).not.toContain(decoy);
  }
}

async function grantedOutcomeWithDecoys(): Promise<{
  outcome: TimelineReadOutcome;
  cursor: string | undefined;
}> {
  const harness = world.makeService();
  // The free-text decoy rides on the intent record's objective field.
  harness.intents.put(world.intent({ objective: DECOY_OBJECTIVE }));
  harness.observations.put(
    world.canonicalRecord(world.observation({ effectiveAt: new Date(2025, 4, 2) })),
  );
  harness.tasks.put(world.task());
  const outcome = await harness.service.assembleTimeline(
    world.subject,
    {},
    // The practitioner display-name decoy rides on the snapshot.
    world.makeContext({
      snapshot: world.makeSnapshot({
        practitioner: world.makePractitioner({ displayName: DECOY_PRACTITIONER_NAME }),
      }),
    }),
  );
  expect(outcome.kind).toBe("granted");
  return { outcome, cursor: undefined };
}

describe("no-PHI proofs — decoy planting over every serialized surface", () => {
  it("the granted page (entries + cursor + truncated) carries no decoy", async () => {
    const { outcome } = await grantedOutcomeWithDecoys();
    if (outcome.kind !== "granted") {
      throw new Error("unreachable");
    }
    expectNoDecoys(outcome.page, "the granted page");
  });

  it("the granted outcome's audit + event carry no decoy", async () => {
    const { outcome } = await grantedOutcomeWithDecoys();
    if (outcome.kind !== "granted") {
      throw new Error("unreachable");
    }
    expectNoDecoys(outcome.audit, "the granted audit record");
    expectNoDecoys(outcome.event, "the granted TIMELINE_READ event");
  });

  it("the denied outcome (typed denial + audit + event) carries no decoy", async () => {
    const harness = world.makeService();
    harness.intents.put(world.intent({ objective: DECOY_OBJECTIVE }));
    const outcome = await harness.service.assembleTimeline(
      world.subject,
      {},
      world.makeContext({
        snapshot: world.makeSnapshot({
          practitioner: world.makePractitioner({
            displayName: DECOY_PRACTITIONER_NAME,
            state: "unverified",
          }),
        }),
      }),
    );
    expect(outcome.kind).toBe("denied");
    expectNoDecoys(outcome, "the denied outcome");
  });

  it("the summary derivation carries no decoy", async () => {
    const { outcome } = await grantedOutcomeWithDecoys();
    if (outcome.kind !== "granted") {
      throw new Error("unreachable");
    }
    expectNoDecoys(timelineSummary(outcome.page.entries), "the timeline summary");
  });

  it("the opaque cursor decodes to EXACTLY the anchor tuple — no content rides along", async () => {
    const harness = world.makeService();
    harness.intents.put(world.intent({ objective: DECOY_OBJECTIVE }));
    harness.intents.put(world.intent({ objective: DECOY_OBJECTIVE, createdAt: new Date(2025, 4, 2) }));
    harness.intents.put(world.intent({ objective: DECOY_OBJECTIVE, createdAt: new Date(2025, 4, 3) }));
    const outcome = await harness.service.assembleTimeline(
      world.subject,
      { limit: 2 },
      world.makeContext(),
    );
    if (outcome.kind !== "granted") {
      throw new Error("unreachable");
    }
    const cursor = outcome.page.nextCursor;
    expect(cursor).toBeDefined();
    const decoded = JSON.parse(
      Buffer.from(cursor as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["i", "o", "v"]);
    expect(decoded.v).toBe(1);
    expect(typeof decoded.o).toBe("string");
    expect(typeof decoded.i).toBe("string");
    for (const decoy of DECOYS) {
      expect(cursor as string).not.toContain(decoy);
    }
  });

  it("the intent ENTRY never carries the objective (typed state summary only)", async () => {
    const { outcome } = await grantedOutcomeWithDecoys();
    if (outcome.kind !== "granted") {
      throw new Error("unreachable");
    }
    const intentEntry = outcome.page.entries.find((entry) => entry.kind === "intent");
    expect(intentEntry).toBeDefined();
    expect(serialize(intentEntry)).not.toContain("objective");
    expect(serialize(intentEntry)).not.toContain(DECOY_OBJECTIVE);
  });

  it("typed error messages never echo received values (PHID discipline)", async () => {
    const harness = world.makeService();
    const evilCursor = Buffer.from(
      JSON.stringify({ v: 1, o: DECOY_OBJECTIVE, i: DECOY_OBJECTIVE }),
      "utf8",
    ).toString("base64url");
    let message = "";
    try {
      await harness.service.assembleTimeline(
        world.subject,
        { cursor: evilCursor },
        world.makeContext(),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toContain(DECOY_OBJECTIVE);
    for (const decoy of DECOYS) {
      expect(message).not.toContain(decoy);
    }
  });
});
