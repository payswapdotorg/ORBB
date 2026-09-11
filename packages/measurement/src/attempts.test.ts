import { describe, expect, it } from "vitest";
import {
  isQualityScore,
  type EvidenceId,
  type Observation,
  type ProvenanceId,
  type QualityScore,
} from "@orbb/domain";
import {
  isAttemptId,
  TypicalRangeQualityPolicy,
  type AttemptId,
  type QualityClassificationPolicy,
} from "./attempts.js";
import { AttemptRecorder } from "./attempts.js";
import type { MeasurementTask } from "./scheduler.js";
import {
  buildEngineHarness,
  compileActivePlan,
  harnessPersonId,
  hrObservation,
  hrProtocol,
  registerSource,
} from "./testsupport.js";
import { SEEDED_METHOD_IDS } from "./seed.js";
import type { EngineHarness, HrObservationOverrides } from "./testsupport.js";

const PERSON = harnessPersonId();

/** Schedules the HR plan and returns the first open task. */
async function scheduleFirstTask(harness: EngineHarness): Promise<MeasurementTask> {
  const { plan, planMetrics } = compileActivePlan(harness, hrProtocol());
  const result = await harness.scheduler.schedule({ plan, planMetrics });
  if (!result.ok) {
    throw new Error("expected scheduling to succeed");
  }
  const first = result.value.tasks[0];
  if (first === undefined) {
    throw new Error("expected a first task");
  }
  return first;
}

function attemptProvenance(harness: EngineHarness): ProvenanceId {
  return harness.fixtures.ids.next("prov") as ProvenanceId;
}

function stripQuality(observation: Observation): Observation {
  const clone: Record<string, unknown> = { ...observation };
  delete clone.quality;
  return clone as unknown as Observation;
}

async function record(
  harness: EngineHarness,
  task: MeasurementTask,
  observationOverrides: HrObservationOverrides,
  input?: { quality?: QualityScore; methodId?: string },
) {
  return harness.recorder.record({
    taskId: task.id,
    observation: hrObservation(harness, observationOverrides),
    provenanceId: attemptProvenance(harness),
    ...(input?.quality !== undefined ? { quality: input.quality } : {}),
    ...(input?.methodId !== undefined ? { methodId: input.methodId } : {}),
  });
}

describe("A31 attempt recorder — completion quality states", () => {
  it("completes the task when an acceptable-quality (complete) attempt lands", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const result = await record(harness, task, { quality: 0.95 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected recording to succeed");
    }
    expect(result.value.attempt.completionState).toBe("complete");
    expect(result.value.taskCompleted).toBe(true);
    expect(result.value.task.state).toBe("completed");
    expect(result.value.task.id).toBe(task.id);
    expect(result.value.methodUsed.id).toBe(SEEDED_METHOD_IDS.heartRateWearable);
    expect(result.value.fellBackFrom).toBeUndefined();
    expect(result.value.attempt.methodId).toBe(SEEDED_METHOD_IDS.heartRateWearable);
    expect(isAttemptId(result.value.attempt.id)).toBe(true);
    expect(isQualityScore(result.value.attempt.quality)).toBe(true);
    expect(result.value.attempt.provenanceId).toBeDefined();
  });

  it("records a low-quality attempt but leaves the task open", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const result = await record(harness, task, { quality: 0.1 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected recording to succeed");
    }
    expect(result.value.attempt.completionState).toBe("low-quality");
    expect(result.value.taskCompleted).toBe(false);
    expect(result.value.task.state).toBe("open");
    // Unacceptable attempts are still recorded (data is never discarded).
    const attempts = await harness.attemptStore.findByTask(task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.completionState).toBe("low-quality");
  });

  it("records a partial attempt (below typical minimum, above the partial floor) with the task open", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    // Wearable typical range is [0.9, 0.98]; 0.5 is below the minimum but
    // above the 0.45 partial floor.
    const result = await record(harness, task, { quality: 0.5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.attempt.completionState).toBe("partial");
      expect(result.value.task.state).toBe("open");
    }
  });

  it("classifies via the injectable quality policy (seam)", async () => {
    const lenient: QualityClassificationPolicy = {
      classify: () => "complete",
    };
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const recorder = new AttemptRecorder({
      catalog: harness.catalog,
      methods: harness.methods,
      capabilities: harness.capabilityIndex,
      tasks: harness.taskStore,
      attempts: harness.attemptStore,
      clock: harness.clock,
      ids: harness.ids,
      policy: lenient,
    });
    const result = await recorder.record({
      taskId: task.id,
      observation: hrObservation(harness, { quality: 0.1 }),
      provenanceId: attemptProvenance(harness),
    });
    expect(result.ok && result.value.attempt.completionState).toBe("complete");
    expect(result.ok && result.value.task.state).toBe("completed");
  });

  it("the default policy rejects partial-floor fractions outside [0, 1]", () => {
    expect(() => new TypicalRangeQualityPolicy({ partialFloorFraction: 1.5 })).toThrow(RangeError);
  });
});

describe("A31 attempt recorder — fallback path", () => {
  it("serves the SAME task with the next legal method when the preferred method misses", async () => {
    const harness = buildEngineHarness();
    // Only MANUAL entry is registered: the preferred wearable method
    // misses in the CapabilityIndex.
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateManual]);
    const task = await scheduleFirstTask(harness);
    // Observation produced by the manual method (MEASURED, quality 0.7 —
    // acceptable for manual's typical minimum 0.6).
    const result = await record(harness, task, {
      quality: 0.7,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
      evidenceLabel: "MEASURED",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected recording to succeed");
    }
    expect(result.value.methodUsed.id).toBe(SEEDED_METHOD_IDS.heartRateManual);
    expect(result.value.fellBackFrom).toBe(SEEDED_METHOD_IDS.heartRateWearable);
    // The attempt records the method ACTUALLY used plus the preferred
    // method that missed.
    expect(result.value.attempt.methodId).toBe(SEEDED_METHOD_IDS.heartRateManual);
    expect(result.value.attempt.preferredMethodId).toBe(SEEDED_METHOD_IDS.heartRateWearable);
    // Same task, completed by the fallback attempt.
    expect(result.value.task.id).toBe(task.id);
    expect(result.value.task.state).toBe("completed");
  });

  it("leaves the task open when the fallback attempt itself is unacceptable", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateManual]);
    const task = await scheduleFirstTask(harness);
    const result = await record(harness, task, {
      quality: 0.2,
      methodId: SEEDED_METHOD_IDS.heartRateManual,
      evidenceLabel: "MEASURED",
    });
    // 0.2 < 0.3 partial floor for manual => low-quality.
    expect(result.ok && result.value.attempt.completionState).toBe("low-quality");
    expect(result.ok && result.value.task.state).toBe("open");
    expect(result.ok && result.value.fellBackFrom).toBe(SEEDED_METHOD_IDS.heartRateWearable);
  });

  it("denies recording with a typed reason when NO method is usable (deny-by-default WHY)", async () => {
    const harness = buildEngineHarness();
    const task = await scheduleFirstTask(harness);
    const result = await record(harness, task, { quality: 0.95 });
    expect(result).toEqual({
      ok: false,
      error: { kind: "no-capable-method", reason: { kind: "no-registered-source" } },
    });
  });

  it("rejects an explicit method the person cannot use", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateManual]);
    const task = await scheduleFirstTask(harness);
    const result = await record(
      harness,
      task,
      { quality: 0.95 },
      { methodId: SEEDED_METHOD_IDS.heartRateWearable },
    );
    expect(result).toEqual({ ok: false, error: { kind: "method-not-usable" } });
  });

  it("rejects an explicit method that is not registered", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const result = await record(
      harness,
      task,
      { quality: 0.95 },
      { methodId: "SYNTH-method-ghost" },
    );
    expect(result).toEqual({ ok: false, error: { kind: "unknown-method" } });
  });
});

describe("A31 attempt recorder — validation and lifecycle", () => {
  it("rejects attempts against unknown or already-completed tasks", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const ghost = await harness.recorder.record({
      taskId: "task_0000000000000000notreal" as MeasurementTask["id"],
      observation: hrObservation(harness, { quality: 0.95 }),
      provenanceId: attemptProvenance(harness),
    });
    expect(ghost).toEqual({ ok: false, error: { kind: "task-not-found" } });

    const first = await record(harness, task, { quality: 0.95 });
    expect(first.ok).toBe(true);
    const second = await record(harness, task, { quality: 0.95 });
    expect(second).toEqual({ ok: false, error: { kind: "task-not-open" } });
  });

  it("rejects observations that do not conform to the metric (domain guard)", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const wrongUnit = await harness.recorder.record({
      taskId: task.id,
      observation: { ...hrObservation(harness, { quality: 0.95 }), unit: "kg" },
      provenanceId: attemptProvenance(harness),
    });
    expect(wrongUnit).toEqual({ ok: false, error: { kind: "observation-nonconforming" } });
    const otherPerson = harness.fixtures.person().id;
    const wrongPerson = await harness.recorder.record({
      taskId: task.id,
      observation: hrObservation(harness, {
        quality: 0.95,
        personId: otherPerson,
      }),
      provenanceId: attemptProvenance(harness),
    });
    expect(wrongPerson).toEqual({ ok: false, error: { kind: "observation-person-mismatch" } });
  });

  it("rejects observations produced by a different method than the one resolved (domain guard)", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    // Observation produced by the MANUAL method, but the resolved method
    // is the wearable one.
    const result = await record(
      harness,
      task,
      { quality: 0.95, methodId: SEEDED_METHOD_IDS.heartRateManual },
      { methodId: SEEDED_METHOD_IDS.heartRateWearable },
    );
    expect(result).toEqual({ ok: false, error: { kind: "observation-method-mismatch" } });
  });

  it("rejects attempts with no quality available (observation and input both missing)", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const result = await harness.recorder.record({
      taskId: task.id,
      observation: stripQuality(hrObservation(harness, { quality: 0.95 })),
      provenanceId: attemptProvenance(harness),
    });
    expect(result).toEqual({ ok: false, error: { kind: "missing-quality" } });
  });

  it("carries the optional source-evidence link (AI boundary §8 seam)", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    const evidenceId = harness.fixtures.ids.next("evid") as EvidenceId;
    const result = await harness.recorder.record({
      taskId: task.id,
      observation: hrObservation(harness, { quality: 0.95 }),
      provenanceId: attemptProvenance(harness),
      evidenceId,
    });
    expect(result.ok && result.value.attempt.evidenceId).toBe(evidenceId);
  });

  it("appends attempts through the store port and keeps them queryable per task", async () => {
    const harness = buildEngineHarness();
    registerSource(harness, PERSON, [SEEDED_METHOD_IDS.heartRateWearable]);
    const task = await scheduleFirstTask(harness);
    // Unacceptable first, acceptable second.
    await record(harness, task, { quality: 0.1 });
    const second = await record(harness, task, { quality: 0.95 });
    expect(second.ok && second.value.task.state).toBe("completed");
    const attempts = await harness.attemptStore.findByTask(task.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.completionState)).toEqual([
      "low-quality",
      "complete",
    ]);
    const firstAttemptId = attempts[0]?.id as AttemptId;
    const first = await harness.attemptStore.findById(firstAttemptId);
    expect(first?.completionState).toBe("low-quality");
  });
});
