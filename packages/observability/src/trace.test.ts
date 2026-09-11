import { describe, expect, it } from "vitest";
import { createTrace } from "./index.js";

function createManualClock(initialMs: number) {
  let now = initialMs;
  return {
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createTrace — trace primitives", () => {
  it("uses the provided traceId and starts empty", () => {
    const clock = createManualClock(0);
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: clock.nowMs });

    expect(trace.traceId).toBe("SYNTH-trace-1");
    expect(trace.spans).toHaveLength(0);
  });

  it("generates a traceId when none is provided", () => {
    const trace = createTrace({ nowMs: () => 0 });
    expect(trace.traceId).toMatch(/^trace-/);
    expect(trace.traceId.length).toBeGreaterThan("trace-".length);
  });

  it("records name, startedAt, and the injected spanId", () => {
    const clock = createManualClock(1_000);
    let nextId = 0;
    const trace = createTrace({
      traceId: "SYNTH-trace-1",
      nowMs: clock.nowMs,
      newSpanId: () => `SYNTH-span-${(nextId += 1)}`,
    });

    const spanId = trace.startSpan("db.query");

    expect(spanId).toBe("SYNTH-span-1");
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]).toEqual({
      spanId: "SYNTH-span-1",
      name: "db.query",
      startedAt: 1_000,
    });
  });

  it("endSpan records durationMs via the injectable clock", () => {
    const clock = createManualClock(2_000);
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: clock.nowMs });

    const spanId = trace.startSpan("db.query");
    clock.advance(150);
    expect(trace.endSpan(spanId)).toBe(true);

    expect(trace.spans[0]?.durationMs).toBe(150);
    expect(trace.spans[0]?.name).toBe("db.query");
  });

  it("endSpan returns false for unknown or already-ended spans", () => {
    const clock = createManualClock(0);
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: clock.nowMs });

    expect(trace.endSpan("SYNTH-missing")).toBe(false);

    const spanId = trace.startSpan("db.query");
    clock.advance(10);
    expect(trace.endSpan(spanId)).toBe(true);
    clock.advance(10);
    expect(trace.endSpan(spanId)).toBe(false);
    expect(trace.spans[0]?.durationMs).toBe(10);
  });

  it("keeps spans in start order (live view)", () => {
    const clock = createManualClock(0);
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: clock.nowMs });

    trace.startSpan("http.request");
    const second = trace.startSpan("db.query");
    trace.endSpan(second);

    expect(trace.spans.map((span) => span.name)).toEqual(["http.request", "db.query"]);
    expect(trace.spans[0]?.durationMs).toBeUndefined();
    expect(trace.spans[1]?.durationMs).toBeDefined();
  });
});

describe("createTrace — span attributes pass the redaction policy", () => {
  it("stores only redacted attributes (raw PHI never retained)", () => {
    const clock = createManualClock(0);
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: clock.nowMs });

    trace.startSpan("observation.ingest", {
      patientName: "SYNTH-Patient-Name",
      patientEmail: "synth.patient@example.org",
      value: "SYNTH-98.6",
      observationCount: 5,
      subjectRef: "SYNTH-subject-9",
      durationMs: 3,
    });

    const attributes = trace.spans[0]?.attributes;
    expect(attributes?.patientName).toBe("[REDACTED]");
    expect(attributes?.patientEmail).toBe("[REDACTED]");
    expect(attributes?.value).toBe("[REDACTED]");
    expect(attributes?.observationCount).toBe(5);
    expect(attributes?.durationMs).toBe(3);
    expect(attributes?.subjectRef).toMatch(/^hash:[0-9a-f]{12}$/);

    const dump = JSON.stringify(trace.spans);
    expect(dump).not.toContain("SYNTH-Patient-Name");
    expect(dump).not.toContain("synth.patient@example.org");
    expect(dump).not.toContain("SYNTH-98.6");
    expect(dump).not.toContain("SYNTH-subject-9");
  });

  it("is decoupled from the caller's attributes object", () => {
    const trace = createTrace({
      traceId: "SYNTH-trace-1",
      nowMs: () => 0,
      policy: {
        denyFieldNames: [],
        denyFieldPatterns: [],
        allowFieldNames: [],
        allowFieldPatterns: [],
        pseudonymFieldNames: [],
        unmatchedAction: "allow",
      },
    });
    const attributes: Record<string, string | number> = { observationCount: 1, note: "SYNTH-note" };

    trace.startSpan("db.query", attributes);
    attributes.observationCount = 999;
    attributes.note = "SYNTH-mutated";

    expect(trace.spans[0]?.attributes?.observationCount).toBe(1);
    expect(trace.spans[0]?.attributes?.note).toBe("SYNTH-note");
  });

  it("omits the attributes key when none are given", () => {
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: () => 0 });
    trace.startSpan("db.query");

    expect(Object.keys(trace.spans[0] ?? {})).not.toContain("attributes");
  });

  it("honors a custom redaction policy", () => {
    const trace = createTrace({
      traceId: "SYNTH-trace-1",
      nowMs: () => 0,
      policy: {
        denyFieldNames: ["value"],
        denyFieldPatterns: [],
        allowFieldNames: [],
        allowFieldPatterns: [],
        pseudonymFieldNames: [],
        unmatchedAction: "allow",
        maxStringLength: 8,
      },
    });

    trace.startSpan("db.query", { value: "SYNTH-98.6", note: "SYNTH-truncated-value" });

    expect(trace.spans[0]?.attributes?.value).toBe("[REDACTED]");
    expect(trace.spans[0]?.attributes?.note).toBe("SYNTH...");
  });

  it("pseudonyms in span attributes are stable across spans", () => {
    const trace = createTrace({ traceId: "SYNTH-trace-1", nowMs: () => 0 });

    trace.startSpan("first", { subjectRef: "SYNTH-subject-1" });
    trace.startSpan("second", { subjectRef: "SYNTH-subject-1" });

    expect(trace.spans[0]?.attributes?.subjectRef).toBe(trace.spans[1]?.attributes?.subjectRef);
  });
});
