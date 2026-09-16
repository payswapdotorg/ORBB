import { describe, expect, it } from "vitest";
import {
  REMINDER_ID_PREFIX,
  SEND_ATTEMPT_ID_PREFIX,
  deriveReminderId,
  isReminderId,
  isSendAttemptId,
  utcEpochDay,
} from "./ids.js";
import { syntheticTask } from "./testsupport.js";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

const TASK = syntheticTask({
  window: {
    sequence: 0,
    startsAt: new Date(MS_PER_DAY),
    endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR),
  },
});

const PARTS = {
  taskId: TASK.id,
  window: TASK.window,
  rung: "REMIND" as const,
  channel: "inmem",
  utcDay: 1,
};

describe("B8 reminder identity — deterministic f(task, window, rung, channel, UTC day)", () => {
  it("derives the same id for the same parts, always", () => {
    const a = deriveReminderId(PARTS);
    const b = deriveReminderId(PARTS);
    expect(a).toBe(b);
    expect(isReminderId(a)).toBe(true);
    expect(a.startsWith(`${REMINDER_ID_PREFIX}_`)).toBe(true);
    // 43-char base64url body => passes the 16–128 lane-local grammar.
    expect(a.slice(REMINDER_ID_PREFIX.length + 1)).toHaveLength(43);
  });

  it("changes the id when ANY identity component changes (sensitivity table)", () => {
    const base = deriveReminderId(PARTS);
    // Task id.
    expect(
      deriveReminderId({ ...PARTS, taskId: syntheticTask({ index: 2 }).id }),
    ).not.toBe(base);
    // Window sequence.
    expect(
      deriveReminderId({
        ...PARTS,
        window: { ...PARTS.window, sequence: 1 },
      }),
    ).not.toBe(base);
    // Window start.
    expect(
      deriveReminderId({
        ...PARTS,
        window: { ...PARTS.window, startsAt: new Date(MS_PER_DAY + 1) },
      }),
    ).not.toBe(base);
    // Window end.
    expect(
      deriveReminderId({
        ...PARTS,
        window: { ...PARTS.window, endsAt: new Date(MS_PER_DAY + 2 * MS_PER_HOUR + 1) },
      }),
    ).not.toBe(base);
    // Rung.
    expect(
      deriveReminderId({ ...PARTS, rung: "REMIND_WITH_FALLBACK_OFFER" }),
    ).not.toBe(base);
    // Channel.
    expect(deriveReminderId({ ...PARTS, channel: "email-synth" })).not.toBe(base);
    // UTC day.
    expect(deriveReminderId({ ...PARTS, utcDay: 2 })).not.toBe(base);
  });

  it("guards the lane-local id grammars", () => {
    expect(isReminderId("remd_short")).toBe(false);
    expect(isReminderId("task_SYNTH-task-00000001")).toBe(false);
    expect(isReminderId(123)).toBe(false);
    expect(isSendAttemptId(`snd_SYNTH-attempt-00000001`)).toBe(true);
    expect(isSendAttemptId(`remd_SYNTH-attempt-00000001`)).toBe(false);
    expect(isSendAttemptId(undefined)).toBe(false);
  });

  it("computes UTC epoch days on pure UTC boundaries", () => {
    expect(utcEpochDay(0)).toBe(0);
    expect(utcEpochDay(86_399_999)).toBe(0);
    expect(utcEpochDay(86_400_000)).toBe(1);
    expect(utcEpochDay(-1)).toBe(-1); // Math.floor, never truncation.
    expect(SEND_ATTEMPT_ID_PREFIX).toBe("snd");
  });
});
