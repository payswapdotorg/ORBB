import { describe, expect, it } from "vitest";
import { isDomainEventEnvelope, isEventId } from "@orbb/contracts";
import { MS_PER_HOUR, MS_PER_MINUTE } from "./quiet-hours.js";
import {
  buildNotificationHarness,
  synthPersonId,
  synthPreferences,
  synthTask,
} from "./testsupport.js";
import { InMemoryReminderEventSink, buildTaskDueEvent } from "./events.js";
import { ReminderEngine } from "./engine.js";
import { deriveReminderId } from "./identity.js";
import type { ReminderEventSink } from "./events.js";
import type { QuietHoursSpec } from "./preferences.js";
import type { FallbackOfferReminderPayload, ReminderPayload, ReminderRung } from "./payloads.js";

/** Noon UTC on Wednesday 2026-06-10 — outside the default quiet window. */
const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);

function noQuietHours(): QuietHoursSpec {
  return { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };
}

describe("B8 TASK_DUE emission — contracts §11 envelope", () => {
  it("every successful dispatch emits exactly one valid TASK_DUE envelope", async () => {
    const endsAtMs = NOON + 2 * MS_PER_HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MS_PER_MINUTE });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const outcome = await harness.engine.dispatchDue({
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    const emissions = harness.eventSink.getEvents();
    expect(emissions).toHaveLength(1);
    const emission = emissions[0]!;
    // The envelope satisfies the frozen contracts guard.
    expect(isDomainEventEnvelope(emission.event)).toBe(true);
    expect(isEventId(emission.event.eventId)).toBe(true);
    expect(emission.event.type).toBe("TASK_DUE");
    expect(emission.event.version).toBe(1);
    expect(emission.event.payloadSchemaVersion).toBe("1.0.0");
    // Time-driven event: actor === subject (the person's own task came due) —
    // recorded assumption; a service-account actor kind needs tech-lead review.
    expect(emission.event.actor).toBe(task.personId);
    expect(emission.event.subject).toBe(task.personId);
    expect(emission.event.occurredAt.getTime()).toBe(endsAtMs - 30 * MS_PER_MINUTE);
    // Causation: the deterministic reminder id.
    expect(emission.event.causationId).toBe(outcome.value.dispatched[0]!.reminder.id);
    expect(emission.event.correlationId).toBeUndefined();
  });

  it("the event payload is canonical JSON of { channelId, reminder, reminderId }", async () => {
    const endsAtMs = NOON + 2 * MS_PER_HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MS_PER_MINUTE });
    const task = synthTask({ endsAt: new Date(endsAtMs) });
    const outcome = await harness.engine.dispatchDue({
      tasks: [task],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    const emission = harness.eventSink.getEvents()[0]!;
    const parsed = JSON.parse(emission.payload) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["channelId", "reminder", "reminderId"]);
    expect(parsed.channelId).toBe("inapp-memory");
    // Canonical byte order: sorted keys => the dump starts with channelId.
    expect(emission.payload.startsWith('{"channelId"')).toBe(true);
    const reminder = parsed.reminder as Record<string, unknown>;
    expect(reminder.taskId).toBe(task.id);
  });

  it("undelivered reminders emit NO event", async () => {
    const endsAtMs = NOON + 2 * MS_PER_HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MS_PER_MINUTE });
    harness.channel.setFailureMode({ kind: "fail", reason: "rate-limited" });
    const outcome = await harness.engine.dispatchDue({
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    if (!outcome.ok) {
      throw new Error("expected dispatch to succeed");
    }
    expect(outcome.value.failures).toHaveLength(1);
    expect(harness.eventSink.getEvents()).toHaveLength(0);
  });

  it("a sink failure after a successful delivery rejects with event-sink-failure (at-least-once handoff)", async () => {
    const endsAtMs = NOON + 2 * MS_PER_HOUR;
    const harness = buildNotificationHarness({ epochMs: endsAtMs - 30 * MS_PER_MINUTE });
    const throwingSink: ReminderEventSink = {
      publish: async () => {
        throw new Error("SYNTH sink down");
      },
    };
    const engine = new ReminderEngine({
      clock: harness.clock,
      ids: harness.ids,
      ledger: harness.ledger,
      events: throwingSink,
    });
    const result = await engine.dispatchDue({
      tasks: [synthTask({ endsAt: new Date(endsAtMs) })],
      preferences: synthPreferences({ quietHours: noQuietHours() }),
      channels: harness.registry,
    });
    expect(result).toEqual({ ok: false, error: { kind: "event-sink-failure" } });
    // The delivery + ledger record happened before the sink failure — the
    // retry is safe because the ledger already marked the reminder
    // dispatched (transactional outbox coupling: recorded handoff).
    expect(harness.channel.sentCount).toBe(1);
    expect(harness.ledger.listAll()[0]!.status).toBe("dispatched");
  });
});

describe("B8 TASK_DUE emission — builder and double", () => {
  function offerPayload(): FallbackOfferReminderPayload {
    return {
      kind: "REMIND_WITH_FALLBACK_OFFER",
      reason: "missed-window",
      taskId: synthTask().id,
      metricId: "metric-synth-heart-rate",
      windowSequence: 3,
      dueAt: new Date(NOON + MS_PER_HOUR),
      preferredMethodId: "method-synth-wearable",
      fallbackMethods: [{ methodId: "method-synth-app" }],
    };
  }

  function reminderId(n: number, rung: ReminderRung): ReturnType<typeof deriveReminderId> {
    return deriveReminderId({
      taskId: synthTask().id,
      windowSequence: 0,
      rung,
      channelId: "inapp-memory",
      utcDay: 20_000 + n,
    });
  }

  it("buildTaskDueEvent derives event ids from the injected id factory", () => {
    const harness = buildNotificationHarness({ epochMs: NOON });
    const payload: ReminderPayload = offerPayload();
    const first = buildTaskDueEvent({
      ids: harness.ids,
      personId: synthPersonId(),
      reminderId: reminderId(1, "REMIND"),
      channelId: "inapp-memory",
      payload,
      occurredAt: harness.clock.now(),
    });
    const second = buildTaskDueEvent({
      ids: harness.ids,
      personId: synthPersonId(),
      reminderId: reminderId(2, "REMIND"),
      channelId: "inapp-memory",
      payload,
      occurredAt: harness.clock.now(),
    });
    expect(isEventId(first.event.eventId)).toBe(true);
    expect(first.event.eventId).not.toBe(second.event.eventId);
    expect(first.event.causationId).toBe(reminderId(1, "REMIND"));
    expect(JSON.parse(first.payload).reminder.kind).toBe("REMIND_WITH_FALLBACK_OFFER");
    expect(first.event.type).toBe("TASK_DUE");
  });

  it("InMemoryReminderEventSink collects in order and returns defensive copies", async () => {
    const sink = new InMemoryReminderEventSink();
    const harness = buildNotificationHarness({ epochMs: NOON });
    const payload: ReminderPayload = offerPayload();
    const first = buildTaskDueEvent({
      ids: harness.ids,
      personId: synthPersonId(),
      reminderId: reminderId(1, "REMIND"),
      channelId: "inapp-memory",
      payload,
      occurredAt: harness.clock.now(),
    });
    await sink.publish(first.event, first.payload);
    const collected = sink.getEvents();
    expect(collected).toHaveLength(1);
    // Mutating the returned envelope/collection cannot corrupt the sink.
    collected[0]!.event.occurredAt.setTime(0);
    (collected as unknown[]).length = 0;
    const fresh = sink.getEvents();
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.event.occurredAt.getTime()).toBe(NOON);
    expect(fresh[0]!.payload).toBe(first.payload);
  });
});
