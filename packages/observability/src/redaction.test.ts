import { describe, expect, it } from "vitest";
import {
  defaultRedactionPolicy,
  pseudonymize,
  REDACTED_VALUE,
  redact,
  type RedactionPolicy,
} from "./index.js";

/** Policy helper: defaults overridden by the given slices. */
function policyWith(overrides: Partial<RedactionPolicy>): RedactionPolicy {
  return {
    denyFieldNames: [],
    denyFieldPatterns: [],
    allowFieldNames: [],
    allowFieldPatterns: [],
    pseudonymFieldNames: [],
    ...overrides,
  };
}

describe("redact — deny-by-default field-name patterns", () => {
  it("redacts exact-denied PHI field names (blocklist)", () => {
    const out = redact(
      {
        value: "SYNTH-98.6-mmol",
        conceptCode: "SYNTH-85354-6",
        observation: "SYNTH-obs-body",
        evidence: "SYNTH-evidence-object-key",
        personId: "SYNTH-person-17",
        authorization: "Bearer SYNTH-credentials",
        ssn: "SYNTH-000-00-0000",
        mrn: "SYNTH-mrn-9",
      },
      defaultRedactionPolicy,
    );
    expect(out.value).toBe(REDACTED_VALUE);
    expect(out.conceptCode).toBe(REDACTED_VALUE);
    expect(out.observation).toBe(REDACTED_VALUE);
    expect(out.evidence).toBe(REDACTED_VALUE);
    expect(out.personId).toBe(REDACTED_VALUE);
    expect(out.authorization).toBe(REDACTED_VALUE);
    expect(out.ssn).toBe(REDACTED_VALUE);
    expect(out.mrn).toBe(REDACTED_VALUE);
    expect(JSON.stringify(out)).not.toContain("SYN");
  });

  it("redacts regex-denied PHI-style field names", () => {
    const out = redact(
      {
        patientName: "SYNTH-Patient-Name",
        patientEmail: "synth.patient@example.org",
        dateOfBirth: "SYNTH-2000-01-01",
        primaryPhoneNumber: "SYNTH-020-000-0000",
        phiPayload: "SYNTH-payload",
        birthDateIso: "SYNTH-2000-01-01",
        bearerToken: "SYNTH-token-value",
        givenName: "SYNTH-Given-Name",
      },
      defaultRedactionPolicy,
    );
    expect(out.patientName).toBe(REDACTED_VALUE);
    expect(out.patientEmail).toBe(REDACTED_VALUE);
    expect(out.dateOfBirth).toBe(REDACTED_VALUE);
    expect(out.primaryPhoneNumber).toBe(REDACTED_VALUE);
    expect(out.phiPayload).toBe(REDACTED_VALUE);
    expect(out.birthDateIso).toBe(REDACTED_VALUE);
    expect(out.bearerToken).toBe(REDACTED_VALUE);
    expect(out.givenName).toBe(REDACTED_VALUE);
  });

  it("redacts raw URL-style fields (architecture §6: never PHI through URLs)", () => {
    const out = redact(
      {
        path: "/v1/observations/9f8e2c1a?email=synth%40example.org",
        url: "https://synth.example.org/v1/patients/12345",
        query: "email=synth%40example.org",
        search: "?dob=SYNTH-2000-01-01",
      },
      defaultRedactionPolicy,
    );
    expect(out.path).toBe(REDACTED_VALUE);
    expect(out.url).toBe(REDACTED_VALUE);
    expect(out.query).toBe(REDACTED_VALUE);
    expect(out.search).toBe(REDACTED_VALUE);
    expect(JSON.stringify(out)).not.toContain("example.org");
  });

  it("redacts unmatched fields by default (deny-by-default posture)", () => {
    const out = redact({ someUnknownField: "SYNTH-unknown" }, defaultRedactionPolicy);
    expect(out.someUnknownField).toBe(REDACTED_VALUE);
  });
});

describe("redact — allowlist overrides", () => {
  it("keeps allowlisted envelope, correlation, and HTTP fields", () => {
    const out = redact(
      {
        ts: 1_714_000_000_000,
        level: "info",
        msg: "SYNTH operational message",
        event: "http.request",
        durationMs: 42,
        correlationId: "SYNTH-corr-1",
        requestId: "SYNTH-req-2",
        traceId: "SYNTH-trace-3",
        spanId: "SYNTH-span-4",
        routePattern: "/v1/observations/:id",
        method: "POST",
        status: 201,
        statusCode: 201,
        environment: "preview",
        service: "api",
        version: "0.0.0",
      },
      defaultRedactionPolicy,
    );
    expect(out.ts).toBe(1_714_000_000_000);
    expect(out.level).toBe("info");
    expect(out.msg).toBe("SYNTH operational message");
    expect(out.event).toBe("http.request");
    expect(out.durationMs).toBe(42);
    expect(out.correlationId).toBe("SYNTH-corr-1");
    expect(out.requestId).toBe("SYNTH-req-2");
    expect(out.traceId).toBe("SYNTH-trace-3");
    expect(out.spanId).toBe("SYNTH-span-4");
    expect(out.routePattern).toBe("/v1/observations/:id");
    expect(out.method).toBe("POST");
    expect(out.status).toBe(201);
    expect(out.statusCode).toBe(201);
    expect(out.environment).toBe("preview");
    expect(out.service).toBe("api");
    expect(out.version).toBe("0.0.0");
  });

  it("keeps duration/count/boolean-flag allow patterns", () => {
    const out = redact(
      {
        observationCount: 7,
        evidenceCount: 3,
        queueMs: 120,
        isComplete: true,
        hasRetried: false,
        synthetic: true,
      },
      defaultRedactionPolicy,
    );
    expect(out.observationCount).toBe(7);
    expect(out.evidenceCount).toBe(3);
    expect(out.queueMs).toBe(120);
    expect(out.isComplete).toBe(true);
    expect(out.hasRetried).toBe(false);
    expect(out.synthetic).toBe(true);
  });

  it("a deny pattern still beats an allow pattern (no PHI smuggling via patterns)", () => {
    const out = redact(
      { patientCount: 11, personCount: 5, birthDateMs: 1_000 },
      defaultRedactionPolicy,
    );
    expect(out.patientCount).toBe(REDACTED_VALUE);
    expect(out.personCount).toBe(REDACTED_VALUE);
    expect(out.birthDateMs).toBe(REDACTED_VALUE);
  });

  it("an exact deny name is never overridable, not even by an exact allow entry", () => {
    const conflicting = policyWith({
      denyFieldNames: ["value"],
      allowFieldNames: ["value"],
      unmatchedAction: "allow",
    });
    expect(redact({ value: "SYNTH-98.6" }, conflicting).value).toBe(REDACTED_VALUE);
  });

  it("an exact allow entry overrides a deny pattern", () => {
    const withEventName = policyWith({
      denyFieldPatterns: [/name/i],
      allowFieldNames: ["eventName"],
      unmatchedAction: "allow",
    });
    const out = redact({ eventName: "SYNTH.event.name", firstName: "SYNTH-Name" }, withEventName);
    expect(out.eventName).toBe("SYNTH.event.name");
    expect(out.firstName).toBe(REDACTED_VALUE);
  });

  it("unmatchedAction 'allow' keeps unknown fields (custom posture)", () => {
    const allowUnknown = policyWith({ unmatchedAction: "allow" });
    expect(redact({ anythingGoes: "SYNTH-value" }, allowUnknown).anythingGoes).toBe(
      "SYNTH-value",
    );
  });
});

describe("redact — truncation limits", () => {
  it("truncates kept strings to the default 256-character cap", () => {
    const long = "SYNTH-".repeat(50); // 300 characters
    const out = redact({ msg: long }, defaultRedactionPolicy);
    expect(out.msg).toHaveLength(256);
    const msg = out.msg;
    if (typeof msg === "string") {
      expect(msg.endsWith("...")).toBe(true);
      expect(msg.startsWith("SYNTH-SYNTH")).toBe(true);
    }
  });

  it("leaves strings within the cap untouched", () => {
    const exact = "SYNTH-".repeat(36) + "1234"; // 256 characters
    expect(redact({ msg: exact }, defaultRedactionPolicy).msg).toBe(exact);
  });

  it("honors a custom maxStringLength", () => {
    const tiny = policyWith({ maxStringLength: 8, unmatchedAction: "allow" });
    expect(redact({ note: "SYNTH-truncated-value" }, tiny).note).toBe("SYNTH...");
  });

  it("rejects invalid caps", () => {
    expect(() => redact({}, policyWith({ maxStringLength: 0 }))).toThrow(RangeError);
    expect(() => redact({}, policyWith({ maxStringLength: 2.5 }))).toThrow(RangeError);
  });
});

describe("redact — hash-once pseudonyms", () => {
  it("pseudonymizes subjectRef-style fields with stable short hashes", () => {
    const first = redact({ subjectRef: "SYNTH-subject-1" }, defaultRedactionPolicy);
    const second = redact({ subjectRef: "SYNTH-subject-1" }, defaultRedactionPolicy);
    expect(first.subjectRef).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(second.subjectRef).toBe(first.subjectRef);
    expect(JSON.stringify(first)).not.toContain("SYNTH-subject-1");
  });

  it("produces distinct pseudonyms for distinct inputs", () => {
    const a = redact({ subjectRef: "SYNTH-subject-1" }, defaultRedactionPolicy);
    const b = redact({ subjectRef: "SYNTH-subject-2" }, defaultRedactionPolicy);
    expect(b.subjectRef).not.toBe(a.subjectRef);
  });

  it("pseudonymizes actorId/userId/deviceId/personRef/accountId too", () => {
    const out = redact(
      {
        actorId: "SYNTH-actor",
        userId: "SYNTH-user",
        deviceId: "SYNTH-device",
        personRef: "SYNTH-person",
        accountId: "SYNTH-account",
      },
      defaultRedactionPolicy,
    );
    expect(out.actorId).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(out.userId).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(out.deviceId).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(out.personRef).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(out.accountId).toMatch(/^hash:[0-9a-f]{12}$/);
    expect(JSON.stringify(out)).not.toContain("SYNTH-actor");
  });

  it("keeps null as null (no information to protect)", () => {
    expect(redact({ subjectRef: null }, defaultRedactionPolicy).subjectRef).toBeNull();
  });

  it("honors pseudonymLength and pseudonymPepper", () => {
    const peppered = policyWith({
      pseudonymFieldNames: ["subjectRef"],
      pseudonymLength: 8,
      pseudonymPepper: "SYNTH-pepper",
    });
    const out = redact({ subjectRef: "SYNTH-subject-1" }, peppered);
    expect(out.subjectRef).toMatch(/^hash:[0-9a-f]{8}$/);
    const unpeppered = policyWith({ pseudonymFieldNames: ["subjectRef"], pseudonymLength: 8 });
    expect(redact({ subjectRef: "SYNTH-subject-1" }, unpeppered).subjectRef).not.toBe(
      out.subjectRef,
    );
  });

  it("pseudonymize() helper is stable, distinct, and validated", () => {
    expect(pseudonymize("SYNTH-subject-1")).toBe(pseudonymize("SYNTH-subject-1"));
    expect(pseudonymize("SYNTH-subject-1")).not.toBe(pseudonymize("SYNTH-subject-2"));
    expect(pseudonymize("SYNTH-subject-1", { length: 16 })).toMatch(/^hash:[0-9a-f]{16}$/);
    expect(pseudonymize("SYNTH-subject-1", { pepper: "SYNTH-pepper" })).not.toBe(
      pseudonymize("SYNTH-subject-1"),
    );
    expect(() => pseudonymize("SYNTH-subject-1", { length: 3 })).toThrow(RangeError);
  });
});

describe("redact — runtime hardening and purity", () => {
  it("replaces non-LogValue values smuggled past the type system", () => {
    const smuggled = JSON.parse(
      '{"value":"SYNTH-98.6","nested":{"deep":"SYNTH-deep"},"list":["SYNTH-a"]}',
    );
    const out = redact(smuggled, defaultRedactionPolicy);
    expect(out.value).toBe(REDACTED_VALUE);
    expect(out.nested).toBe(REDACTED_VALUE);
    expect(out.list).toBe(REDACTED_VALUE);
    expect(JSON.stringify(out)).not.toContain("SYNTH-deep");
  });

  it("normalizes non-finite numbers to null and drops undefined-valued keys", () => {
    const out = redact(
      { durationMs: Number.NaN, msg: "SYNTH-msg", ghost: undefined },
      defaultRedactionPolicy,
    );
    expect(out.durationMs).toBeNull();
    expect(out.msg).toBe("SYNTH-msg");
    expect(Object.keys(out)).not.toContain("ghost");
  });

  it("never mutates its input and is deterministic across calls", () => {
    const input = { msg: "SYNTH-msg", patientName: "SYNTH-Patient-Name" };
    const snapshot = { ...input };
    const first = redact(input, defaultRedactionPolicy);
    const second = redact(input, defaultRedactionPolicy);
    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
  });

  it("stays correct when a policy regex was authored with the /g flag", () => {
    const gflagged = policyWith({ denyFieldPatterns: [/patient/gi], unmatchedAction: "allow" });
    const first = redact({ patientName: "SYNTH-Name" }, gflagged);
    const second = redact({ patientName: "SYNTH-Name" }, gflagged);
    const third = redact({ patientName: "SYNTH-Name" }, gflagged);
    expect(first.patientName).toBe(REDACTED_VALUE);
    expect(second.patientName).toBe(REDACTED_VALUE);
    expect(third.patientName).toBe(REDACTED_VALUE);
  });

  it("stores '__proto__' as an own property (no prototype pollution)", () => {
    const input = JSON.parse('{"__proto__":"SYNTH-pollution","msg":"SYNTH-msg"}');
    const out = redact(input, defaultRedactionPolicy);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(out.msg).toBe("SYNTH-msg");
  });

  it("rejects invalid pseudonym lengths", () => {
    expect(() => redact({}, policyWith({ pseudonymLength: 65 }))).toThrow(RangeError);
  });
});
