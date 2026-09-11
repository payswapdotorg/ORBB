import { describe, expect, it } from "vitest";
import { ConsoleSink, createLogger, InMemorySink } from "./index.js";

function createManualClock(initialMs: number) {
  let now = initialMs;
  return {
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createLogger — structured records", () => {
  it("emits the full envelope with context fields inlined", () => {
    const sink = new InMemorySink();
    const clock = createManualClock(1_000);
    const logger = createLogger(undefined, { sink, nowMs: clock.nowMs });

    logger.info("SYNTH request completed", {
      event: "http.request",
      durationMs: 42,
      requestId: "SYNTH-req-1",
      routePattern: "/v1/observations/:id",
      status: 201,
    });

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record).toBeDefined();
    expect(record?.ts).toBe(1_000);
    expect(record?.level).toBe("info");
    expect(record?.msg).toBe("SYNTH request completed");
    expect(record?.event).toBe("http.request");
    expect(record?.durationMs).toBe(42);
    expect(record?.requestId).toBe("SYNTH-req-1");
    expect(record?.routePattern).toBe("/v1/observations/:id");
    expect(record?.status).toBe(201);
  });

  it("supports all four levels", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.debug("SYNTH-d");
    logger.info("SYNTH-i");
    logger.warn("SYNTH-w");
    logger.error("SYNTH-e");

    expect(sink.records.map((record) => record.level)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });

  it("binds context at creation time", () => {
    const sink = new InMemorySink();
    const logger = createLogger({ service: "api", environment: "preview" }, {
      sink,
      nowMs: () => 0,
    });

    logger.info("SYNTH-msg");

    expect(sink.records[0]?.service).toBe("api");
    expect(sink.records[0]?.environment).toBe("preview");
  });

  it("child loggers derive bound context; per-call fields win collisions", () => {
    const sink = new InMemorySink();
    const clock = createManualClock(5_000);
    const logger = createLogger({ service: "api" }, { sink, nowMs: clock.nowMs });
    const child = logger.child({ requestId: "SYNTH-req-1", service: "worker" });
    const grandchild = child.child({ queueMs: 25 });

    grandchild.info("SYNTH-child-msg", { requestId: "SYNTH-req-2" });

    const record = sink.records[0];
    expect(record?.service).toBe("worker");
    expect(record?.requestId).toBe("SYNTH-req-2");
    expect(record?.queueMs).toBe(25);
    expect(record?.ts).toBe(5_000);

    child.info("SYNTH-child-msg-2");
    expect(sink.records[1]?.requestId).toBe("SYNTH-req-1");
  });

  it("envelope fields win collisions with context fields of the same name", () => {
    const sink = new InMemorySink();
    const logger = createLogger({ ts: 1, level: "debug", msg: "SYNTH-bound" }, {
      sink,
      nowMs: () => 9_999,
    });

    logger.info("SYNTH-per-call");

    expect(sink.records[0]?.ts).toBe(9_999);
    expect(sink.records[0]?.level).toBe("info");
    expect(sink.records[0]?.msg).toBe("SYNTH-per-call");
  });

  it("filters below minLevel", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0, minLevel: "warn" });

    logger.debug("SYNTH-d");
    logger.info("SYNTH-i");
    logger.warn("SYNTH-w");
    logger.error("SYNTH-e");

    expect(sink.records.map((record) => record.msg)).toEqual(["SYNTH-w", "SYNTH-e"]);
  });
});

describe("createLogger — PHI never reaches a sink", () => {
  it("redacts PHI fields before the sink sees them", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("SYNTH request completed", {
      event: "http.request",
      durationMs: 12,
      requestId: "SYNTH-req-9",
      patientName: "SYNTH-Patient-Name",
      patientEmail: "synth.patient@example.org",
      value: "SYNTH-98.6",
      conceptCode: "SYNTH-85354-6",
      authorization: "Bearer SYNTH-credentials",
      subjectRef: "SYNTH-subject-77",
    });

    const dump = JSON.stringify(sink.records);
    expect(dump).not.toContain("SYNTH-Patient-Name");
    expect(dump).not.toContain("synth.patient@example.org");
    expect(dump).not.toContain("SYNTH-98.6");
    expect(dump).not.toContain("SYNTH-85354-6");
    expect(dump).not.toContain("SYNTH-credentials");
    expect(dump).not.toContain("SYNTH-subject-77");
    expect(dump).toContain("SYNTH-req-9");
    expect(dump).toContain("SYNTH request completed");

    const record = sink.records[0];
    expect(record?.patientName).toBe("[REDACTED]");
    expect(record?.value).toBe("[REDACTED]");
    expect(record?.authorization).toBe("[REDACTED]");
    expect(record?.subjectRef).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(record?.requestId).toBe("SYNTH-req-9");
  });

  it("pseudonyms are stable across logger calls", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("SYNTH-first", { subjectRef: "SYNTH-subject-1" });
    logger.info("SYNTH-second", { subjectRef: "SYNTH-subject-1" });
    logger.error("SYNTH-third", { subjectRef: "SYNTH-subject-2" });

    expect(sink.records[0]?.subjectRef).toBe(sink.records[1]?.subjectRef);
    expect(sink.records[2]?.subjectRef).not.toBe(sink.records[0]?.subjectRef);
  });

  it("defends at runtime against non-LogValue values that bypass the type system", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    // @ts-expect-error objects are not LogValue — the type contract rejects them
    logger.info("SYNTH-smuggle", { payload: { phi: "SYNTH-nested-phi" } });
    // @ts-expect-error arrays are not LogValue — the type contract rejects them
    logger.info("SYNTH-smuggle", { tags: ["SYNTH-tag"] });

    expect(sink.records[0]?.payload).toBe("[REDACTED]");
    expect(sink.records[1]?.tags).toBe("[REDACTED]");
    expect(JSON.stringify(sink.records)).not.toContain("SYNTH-nested-phi");
    expect(JSON.stringify(sink.records)).not.toContain("SYNTH-tag");
  });

  it("truncates over-long strings before the sink sees them", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });
    const long = "SYNTH-".repeat(50);

    logger.info(long);

    const msg = sink.records[0]?.msg;
    expect(msg).toHaveLength(256);
    expect(typeof msg === "string" && msg.endsWith("...")).toBe(true);
  });

  it("never throws when a sink throws", () => {
    const exploding: { write: (record: unknown) => void } = {
      write: () => {
        throw new Error("SYNTH sink failure");
      },
    };
    const logger = createLogger(undefined, { sink: exploding, nowMs: () => 0 });

    expect(() => logger.info("SYNTH-msg")).not.toThrow();
  });
});

describe("sinks", () => {
  it("InMemorySink stores records in order and clears", () => {
    const sink = new InMemorySink();
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("SYNTH-1");
    logger.warn("SYNTH-2");

    expect(sink.records.map((record) => record.msg)).toEqual(["SYNTH-1", "SYNTH-2"]);
    sink.clear();
    expect(sink.records).toHaveLength(0);
  });

  it("ConsoleSink emits one JSON line per record through an injected writer", () => {
    const lines: string[] = [];
    const sink = new ConsoleSink({
      writeLine: (line) => {
        lines.push(line);
      },
    });
    const logger = createLogger(undefined, { sink, nowMs: () => 0 });

    logger.info("SYNTH-line", { requestId: "SYNTH-req-1", patientName: "SYNTH-Name" });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed.msg).toBe("SYNTH-line");
    expect(parsed.requestId).toBe("SYNTH-req-1");
    expect(parsed.patientName).toBe("[REDACTED]");
    expect(lines[0]?.includes("\n")).toBe(false);
  });

  it("ConsoleSink routes by level and honors a custom serializer", () => {
    const seen: Array<{ level: string; line: string }> = [];
    const sink = new ConsoleSink({
      writeLine: (line, level) => {
        seen.push({ level, line });
      },
      serialize: (record) => `level=${String(record.level)} msg=${String(record.msg)}`,
    });

    sink.write({ level: "error", msg: "SYNTH-down" });
    sink.write({ level: "info", msg: "SYNTH-up" });
    sink.write({ level: "warn", msg: "SYNTH-warned" });
    sink.write({ level: "debug", msg: "SYNTH-debugged" });
    sink.write({ msg: "SYNTH-no-level" });

    expect(seen.map((entry) => entry.level)).toEqual([
      "error",
      "info",
      "warn",
      "debug",
      "info",
    ]);
    expect(seen[0]?.line).toBe("level=error msg=SYNTH-down");
    expect(seen[4]?.line).toBe("level=undefined msg=SYNTH-no-level");
  });

  it("ConsoleSink default writeLine routes through globalThis.console", () => {
    const original = (globalThis as { console?: unknown }).console;
    const lines: string[] = [];
    (globalThis as { console?: unknown }).console = {
      log: (message: string) => {
        lines.push(`log:${message}`);
      },
      info: (message: string) => {
        lines.push(`info:${message}`);
      },
      warn: (message: string) => {
        lines.push(`warn:${message}`);
      },
      error: (message: string) => {
        lines.push(`error:${message}`);
      },
      debug: (message: string) => {
        lines.push(`debug:${message}`);
      },
    };
    try {
      const sink = new ConsoleSink();
      sink.write({ level: "error", msg: "SYNTH-down" });
      sink.write({ level: "info", msg: "SYNTH-up" });
    } finally {
      (globalThis as { console?: unknown }).console = original;
    }

    expect(lines[0]).toBe('error:{"level":"error","msg":"SYNTH-down"}');
    expect(lines[1]).toBe('info:{"level":"info","msg":"SYNTH-up"}');
  });
});
