import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "@orbb/domain";
import { TimelineError } from "../src/errors.js";
import { PatientTimelineService } from "../src/assembly.js";
import type { TimelineReadGranted } from "../src/authorization.js";
import type { TimelineEntry } from "../src/entries.js";
import {
  buildTimelineWorld,
  atDayAfterT0,
  type TimelineWorld,
} from "./worlds.js";

const world: TimelineWorld = buildTimelineWorld();

/** Seeds a full mixed world: 3 observations, 2 tasks, 2 intents. */
function seedMixedWorld(harness: ReturnType<TimelineWorld["makeService"]>): void {
  harness.observations.put(world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(5) })));
  harness.observations.put(world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(7) })));
  harness.observations.put(world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(3) })));
  harness.tasks.put(world.task());
  harness.tasks.put(world.task({ window: { sequence: 1, startsAt: atDayAfterT0(7, 7), endsAt: atDayAfterT0(7, 9) } }));
  harness.intents.put(world.intent());
  harness.intents.put(
    world.intent({ state: "achieved", createdAt: atDayAfterT0(2) }),
  );
}

async function assemble(
  harness: ReturnType<TimelineWorld["makeService"]>,
  query: Parameters<PatientTimelineService["assembleTimeline"]>[1] = {},
): Promise<TimelineReadGranted> {
  const outcome = await harness.service.assembleTimeline(
    world.subject,
    query,
    world.makeContext(),
  );
  expect(outcome.kind).toBe("granted");
  if (outcome.kind !== "granted") {
    throw new Error("unreachable");
  }
  return outcome;
}

describe("assembly — deterministic ordering (permutation-invariance)", () => {
  const PERMUTATIONS: readonly (readonly number[])[] = [
    [0, 1, 2, 3, 4, 5, 6],
    [6, 5, 4, 3, 2, 1, 0],
    [3, 1, 0, 6, 2, 5, 4],
    [5, 2, 6, 4, 1, 0, 3],
  ];

  it("every insertion permutation of the same records yields the identical page", async () => {
    // Build the seven records once, then insert them permuted.
    const records = {
      observations: [
        world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(5) })),
        world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(7) })),
        world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(3) })),
      ],
      tasks: [
        world.task(),
        world.task({ window: { sequence: 1, startsAt: atDayAfterT0(7, 7), endsAt: atDayAfterT0(7, 9) } }),
      ],
      intents: [
        world.intent(),
        world.intent({ state: "achieved", createdAt: atDayAfterT0(2) }),
      ],
    };
    const flat = [
      ...records.observations.map((record) => ({ plane: "obs" as const, record })),
      ...records.tasks.map((record) => ({ plane: "task" as const, record })),
      ...records.intents.map((record) => ({ plane: "intent" as const, record })),
    ];
    let reference: string | undefined;
    for (const permutation of PERMUTATIONS) {
      const harness = world.makeService();
      permutation.forEach((index) => {
        const item = flat[index];
        if (item === undefined) {
          return;
        }
        if (item.plane === "obs") {
          harness.observations.put(item.record);
        } else if (item.plane === "task") {
          harness.tasks.put(item.record);
        } else {
          harness.intents.put(item.record);
        }
      });
      const outcome = await assemble(harness, { limit: 10 });
      const serialized = JSON.stringify(
        outcome.page.entries.map((entry) => [entry.kind, entry.id, entry.occurredAt.toISOString()]),
      );
      if (reference === undefined) {
        reference = serialized;
      }
      expect(serialized).toBe(reference);
    }
  });

  it("orders occurredAt descending with the domain-id tiebreak ascending", async () => {
    // Two observations at the SAME instant, ids minted in order.
    const first = world.observation({ effectiveAt: atDayAfterT0(5) });
    const second = world.observation({ effectiveAt: atDayAfterT0(5) });
    const harness = world.makeService();
    // Insert in reverse id order to prove the sort, not insertion, orders.
    harness.observations.put(world.canonicalRecord(second));
    harness.observations.put(world.canonicalRecord(first));
    const outcome = await assemble(harness);
    expect(outcome.page.entries.map((entry) => entry.id)).toEqual(
      [first.id, second.id].sort((a, b) => (a < b ? -1 : 1)),
    );
  });

  it("kind timestamps: observation=effectiveAt, task=window.endsAt, intent=createdAt", async () => {
    const harness = world.makeService();
    seedMixedWorld(harness);
    const outcome = await assemble(harness, { limit: 10 });
    // First-of-kind in the descending page = the NEWEST of each kind.
    const byKind = new Map<string, TimelineEntry>();
    for (const entry of outcome.page.entries) {
      if (!byKind.has(entry.kind)) {
        byKind.set(entry.kind, entry);
      }
    }
    const observation = byKind.get("observation");
    const task = byKind.get("task");
    const intent = byKind.get("intent");
    expect(observation?.occurredAt.getTime()).toBe(atDayAfterT0(7).getTime());
    expect(task?.occurredAt.getTime()).toBe(atDayAfterT0(7, 9).getTime());
    expect(intent?.occurredAt.getTime()).toBe(atDayAfterT0(2).getTime());
  });
});

describe("assembly — windowing (inclusive bounds, UTC ms)", () => {
  it("from and to are INCLUSIVE: entries exactly on either bound are included", async () => {
    const harness = world.makeService();
    const low = world.observation({ effectiveAt: atDayAfterT0(1) });
    const mid = world.observation({ effectiveAt: atDayAfterT0(2) });
    const high = world.observation({ effectiveAt: atDayAfterT0(3) });
    harness.observations.put(world.canonicalRecord(low));
    harness.observations.put(world.canonicalRecord(mid));
    harness.observations.put(world.canonicalRecord(high));
    const outcome = await assemble(harness, {
      from: atDayAfterT0(1),
      to: atDayAfterT0(3),
    });
    expect(outcome.page.entries.map((entry) => entry.id)).toEqual([high.id, mid.id, low.id]);
    expect(outcome.page.truncated).toBe(false);
  });

  it("bounds exclude out-of-window entries on either side", async () => {
    const harness = world.makeService();
    const early = world.observation({ effectiveAt: atDayAfterT0(1) });
    const inWindow = world.observation({ effectiveAt: atDayAfterT0(2) });
    const late = world.observation({ effectiveAt: atDayAfterT0(3) });
    harness.observations.put(world.canonicalRecord(early));
    harness.observations.put(world.canonicalRecord(inWindow));
    harness.observations.put(world.canonicalRecord(late));
    const outcome = await assemble(harness, {
      from: atDayAfterT0(1, 12),
      to: atDayAfterT0(2, 12),
    });
    expect(outcome.page.entries.map((entry) => entry.id)).toEqual([inWindow.id]);
  });

  it("the service re-asserts the window even when a port over-returns (defense in depth)", async () => {
    const harness = world.makeService();
    const inWindow = world.observation({ effectiveAt: atDayAfterT0(2) });
    const outOfWindow = world.observation({ effectiveAt: atDayAfterT0(9) });
    // Deliberately over-returning port double (the adapter seam is an
    // optimization, the service filter is authoritative).
    const overReturning = {
      findByPerson: async () => [
        world.canonicalRecord(inWindow),
        world.canonicalRecord(outOfWindow),
      ],
    };
    const service = new PatientTimelineService({
      observations: overReturning,
      tasks: harness.tasks,
      intents: harness.intents,
      clock: harness.clock,
      ids: harness.ids,
    });
    const outcome = await service.assembleTimeline(
      world.subject,
      { from: atDayAfterT0(1), to: atDayAfterT0(3) },
      world.makeContext(),
    );
    expect(outcome.kind).toBe("granted");
    if (outcome.kind === "granted") {
      expect(outcome.page.entries.map((entry) => entry.id)).toEqual([inWindow.id]);
    }
  });

  it("a window with from after to fails closed with the typed invalid-window error", async () => {
    const harness = world.makeService();
    seedMixedWorld(harness);
    await expect(
      harness.service.assembleTimeline(
        world.subject,
        { from: atDayAfterT0(5), to: atDayAfterT0(1) },
        world.makeContext(),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-window" }) as unknown as Error,
    );
  });

  it("a malformed window bound fails closed with the typed invalid-request error", async () => {
    const harness = world.makeService();
    await expect(
      harness.service.assembleTimeline(
        world.subject,
        { from: new Date("nope") },
        world.makeContext(),
      ),
    ).rejects.toBeInstanceOf(TimelineError);
  });
});

describe("assembly — person isolation and page sizes", () => {
  it("assembling the SUBJECT's timeline never returns another person's records", async () => {
    const harness = world.makeService();
    const mine = world.observation({ effectiveAt: atDayAfterT0(5) });
    const theirs = world.observation({
      personId: world.otherPerson,
      effectiveAt: atDayAfterT0(6),
    });
    const theirTask = world.task({ personId: world.otherPerson });
    const theirIntent = world.intent({ personId: world.otherPerson });
    harness.observations.put(world.canonicalRecord(mine));
    harness.observations.put(world.canonicalRecord(theirs));
    harness.tasks.put(theirTask);
    harness.intents.put(theirIntent);
    const outcome = await assemble(harness);
    expect(outcome.page.entries.map((entry) => entry.id)).toEqual([mine.id]);
    expect(outcome.page.entries.every((entry) => entry.personId === world.subject)).toBe(true);
  });

  it("an empty timeline grants an empty, non-truncated first page", async () => {
    const harness = world.makeService();
    const outcome = await assemble(harness);
    expect(outcome.page.entries).toEqual([]);
    expect(outcome.page.truncated).toBe(false);
    expect(outcome.page.nextCursor).toBeUndefined();
  });

  it("default limit 50: 60 entries page to 50 with truncated=true, and walking reaches all 60", async () => {
    const harness = world.makeService();
    for (let day = 0; day < 60; day += 1) {
      harness.observations.put(
        world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(day) })),
      );
    }
    const first = await assemble(harness);
    expect(first.page.entries.length).toBe(50);
    expect(first.page.truncated).toBe(true);

    const collected: TimelineEntry[] = [...first.page.entries];
    let cursor = first.page.nextCursor;
    let guard = 0;
    while (cursor !== undefined && guard < 10) {
      const next = await assemble(harness, { cursor });
      collected.push(...next.page.entries);
      cursor = next.page.nextCursor;
      guard += 1;
    }
    expect(collected.length).toBe(60);
    expect(new Set(collected.map((entry) => entry.id)).size).toBe(60);
  });

  it("limit validation fails closed through the service (0, 1.5, 201)", async () => {
    const harness = world.makeService();
    seedMixedWorld(harness);
    for (const limit of [0, 1.5, 201]) {
      await expect(
        harness.service.assembleTimeline(world.subject, { limit }, world.makeContext()),
      ).rejects.toThrowError(
        expect.objectContaining({ code: "invalid-limit" }) as unknown as Error,
      );
    }
    const legal = await assemble(harness, { limit: 200 });
    expect(legal.page.entries.length).toBe(7);
  });
});

describe("assembly — cursor law through the service", () => {
  it("malformed cursors fail closed AFTER authorization (typed invalid-cursor)", async () => {
    const harness = world.makeService();
    seedMixedWorld(harness);
    await expect(
      harness.service.assembleTimeline(
        world.subject,
        { cursor: "garbage-cursor" },
        world.makeContext(),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-cursor" }) as unknown as Error,
    );
    await expect(
      harness.service.assembleTimeline(
        world.subject,
        { cursor: Buffer.from('{"v":9}', "utf8").toString("base64url") },
        world.makeContext(),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-cursor" }) as unknown as Error,
    );
  });

  it("page stability: inserting a NEWER record after taking a cursor never shifts the next page", async () => {
    const harness = world.makeService();
    for (let day = 0; day < 5; day += 1) {
      harness.observations.put(
        world.canonicalRecord(world.observation({ effectiveAt: atDayAfterT0(day) })),
      );
    }
    const first = await assemble(harness, { limit: 2 });
    expect(first.page.truncated).toBe(true);
    const firstCursor = first.page.nextCursor;
    expect(firstCursor).toBeDefined();

    // A newer observation arrives AFTER the cursor was taken.
    const newer = world.observation({ effectiveAt: atDayAfterT0(99) });
    harness.observations.put(world.canonicalRecord(newer));

    const second = await assemble(harness, {
      limit: 2,
      cursor: firstCursor as string,
    });
    // The second page is byte-identical to what it would have been
    // without the insertion: days 2 and 1 (occurredAt desc).
    expect(second.page.entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      atDayAfterT0(2).toISOString(),
      atDayAfterT0(1).toISOString(),
    ]);
    // The NEWER record appears only at the TOP of a fresh first page.
    const freshFirst = await assemble(harness, { limit: 2 });
    expect(freshFirst.page.entries[0]?.id).toBe(newer.id);
  });
});

describe("assembly — port data integrity (fail-closed on malformed records)", () => {
  it("a superseded-head observation record is a data-integrity failure (DomainInvariantError)", async () => {
    const harness = world.makeService();
    const loser = world.observation();
    const winner = world.observation();
    // A stale record whose head has already been superseded elsewhere.
    const supersededHead = { ...winner, validationState: "superseded" as const, supersedesId: loser.id };
    harness.observations.put({
      canonical: supersededHead,
      sources: [
        world.sourceProvenance(supersededHead, "canonical-source"),
        world.sourceProvenance(loser, "superseded-source"),
      ],
    });
    await expect(
      harness.service.assembleTimeline(world.subject, {}, world.makeContext()),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("a malformed task record fails closed (kernel discipline)", async () => {
    const harness = world.makeService();
    const task = world.task();
    harness.tasks.put({ ...task, state: "cancelled" as never });
    await expect(
      harness.service.assembleTimeline(world.subject, {}, world.makeContext()),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("a malformed intent record fails closed (kernel guard)", async () => {
    const harness = world.makeService();
    const intent = world.intent();
    harness.intents.put({ ...intent, state: "dreaming" as never });
    await expect(
      harness.service.assembleTimeline(world.subject, {}, world.makeContext()),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("malformed subject / context / query shapes fail closed with typed errors", async () => {
    const harness = world.makeService();
    await expect(
      harness.service.assembleTimeline("prsn_short" as never, {}, world.makeContext()),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-request" }) as unknown as Error,
    );
    await expect(
      harness.service.assembleTimeline(world.subject, {}, {
        ...world.makeContext(),
        purpose: "",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-request" }) as unknown as Error,
    );
    await expect(
      harness.service.assembleTimeline(world.subject, { limit: "ten" as never }, world.makeContext()),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-limit" }) as unknown as Error,
    );
  });

  it("a malformed clinical snapshot propagates the kernel invariant error (data-integrity, never a silent allow)", async () => {
    const harness = world.makeService();
    const snapshot = world.makeSnapshot();
    await expect(
      harness.service.assembleTimeline(world.subject, {}, {
        practitionerId: world.practitioner,
        purpose: world.careManagement,
        snapshot: { ...snapshot, patientLink: { ...snapshot.patientLink, personId: "nope" as never } },
      }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });
});
