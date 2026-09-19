import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import {
  LAUNCH_VALIDATION_REASONS,
  SMART_LAUNCH_HANDLE_MAX_LENGTH,
  isSmartLaunchContext,
  parseSmartLaunchContext,
  type LaunchValidationReason,
} from "./launch-context.js";
import { isSmartLaunchAuditRecord } from "./audit.js";
import { SmartInvariantError } from "./errors.js";

const CLOCK = () => new DeterministicClock({ epochMs: 1_700_000_000_000 });
const IDS = () => new DeterministicIdFactory({ seed: "smart-launch" });
const AUDIENCE = "orbb-clinical-web";

/** Every distinct typed reason must be produced by at least one row below. */
const producedReasons = new Set<LaunchValidationReason>();

function parse(input: unknown, audience: string = AUDIENCE) {
  const result = parseSmartLaunchContext(input, {
    audience,
    clock: CLOCK(),
    idFactory: IDS(),
  });
  if (!result.ok) {
    producedReasons.add(result.reason);
  }
  return result;
}

describe("parseSmartLaunchContext (table-driven malformed inputs)", () => {
  const malformed: readonly { name: string; input: unknown; reason: LaunchValidationReason }[] = [
    { name: "null input", input: null, reason: "INPUT_NOT_OBJECT" },
    { name: "array input", input: ["https://ehr.example.test/fhir", "handle-1"], reason: "INPUT_NOT_OBJECT" },
    { name: "string input", input: "https://ehr.example.test/fhir?launch=x", reason: "INPUT_NOT_OBJECT" },
    { name: "number input", input: 42, reason: "INPUT_NOT_OBJECT" },
    { name: "missing iss", input: { launch: "handle-1" }, reason: "ISS_MISSING" },
    { name: "empty iss", input: { iss: "", launch: "handle-1" }, reason: "ISS_MISSING" },
    { name: "non-string iss", input: { iss: 42, launch: "handle-1" }, reason: "ISS_MISSING" },
    { name: "unparseable iss", input: { iss: "not a url", launch: "handle-1" }, reason: "ISS_MALFORMED" },
    { name: "relative iss", input: { iss: "/fhir", launch: "handle-1" }, reason: "ISS_MALFORMED" },
    { name: "http iss", input: { iss: "http://ehr.example.test/fhir", launch: "handle-1" }, reason: "ISS_NOT_HTTPS" },
    { name: "ftp iss", input: { iss: "ftp://ehr.example.test/fhir", launch: "handle-1" }, reason: "ISS_NOT_HTTPS" },
    { name: "protocol-relative iss", input: { iss: "//ehr.example.test/fhir", launch: "handle-1" }, reason: "ISS_MALFORMED" },
    // NOTE: a parseable https URL with an EMPTY host is not constructible
    // in Node's WHATWG URL parser (verified: every candidate throws, and
    // "https:///x" collapses to host "x", which is a VALID issuer). The
    // ISS_NO_HOST branch is therefore DEFENSE-IN-DEPTH for future
    // runtimes; it cannot be triggered through parseSmartLaunchContext
    // on Node, so it has no table row and is excluded from the coverage
    // assertion below.
    { name: "iss with embedded credentials", input: { iss: "https://user:pass@ehr.example.test/fhir", launch: "handle-1" }, reason: "ISS_CREDENTIALS_EMBEDDED" },
    { name: "iss with query", input: { iss: "https://ehr.example.test/fhir?patient=1", launch: "handle-1" }, reason: "ISS_QUERY_OR_FRAGMENT" },
    { name: "iss with fragment", input: { iss: "https://ehr.example.test/fhir#section", launch: "handle-1" }, reason: "ISS_QUERY_OR_FRAGMENT" },
    { name: "missing launch", input: { iss: "https://ehr.example.test/fhir" }, reason: "LAUNCH_MISSING" },
    { name: "empty launch", input: { iss: "https://ehr.example.test/fhir", launch: "" }, reason: "LAUNCH_MISSING" },
    { name: "non-string launch", input: { iss: "https://ehr.example.test/fhir", launch: 7 }, reason: "LAUNCH_MISSING" },
    { name: "launch with inner space", input: { iss: "https://ehr.example.test/fhir", launch: "handle 1" }, reason: "LAUNCH_MALFORMED" },
    { name: "launch with control character", input: { iss: "https://ehr.example.test/fhir", launch: "handle\u00071" }, reason: "LAUNCH_MALFORMED" },
    { name: "launch with tab", input: { iss: "https://ehr.example.test/fhir", launch: "handle\t1" }, reason: "LAUNCH_MALFORMED" },
    {
      name: "launch too long",
      input: { iss: "https://ehr.example.test/fhir", launch: "x".repeat(SMART_LAUNCH_HANDLE_MAX_LENGTH + 1) },
      reason: "LAUNCH_MALFORMED",
    },
    { name: "non-string aud", input: { iss: "https://ehr.example.test/fhir", launch: "handle-1", aud: 42 }, reason: "AUDIENCE_MALFORMED" },
    { name: "empty aud", input: { iss: "https://ehr.example.test/fhir", launch: "handle-1", aud: "" }, reason: "AUDIENCE_MALFORMED" },
    { name: "aud mismatch", input: { iss: "https://ehr.example.test/fhir", launch: "handle-1", aud: "someone-else" }, reason: "AUDIENCE_MISMATCH" },
  ];

  for (const row of malformed) {
    it(`rejects ${row.name} with ${row.reason}`, () => {
      const result = parse(row.input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(row.reason);
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
        // No best-effort partial context: there is nothing to inspect.
        expect("context" in result).toBe(false);
        // Every rejection carries a DENY audit record.
        expect(result.audit.decision).toBe("DENY");
        expect(result.audit.reason).toBe(row.reason);
        expect(result.audit.stage).toBe("launch-validation");
        expect(result.audit.at).toEqual(new Date(1_700_000_000_000));
        expect(isSmartLaunchAuditRecord(result.audit)).toBe(true);
      }
    });
  }

  it("covers every distinct typed rejection reason at least once (except the parser-guaranteed ISS_NO_HOST defense)", () => {
    // Only meaningful after the table has run; the assertion lives in
    // this same file so ordering is guaranteed.
    parse({ launch: "handle-1" });
    for (const reason of LAUNCH_VALIDATION_REASONS) {
      if (reason === "ISS_NO_HOST") {
        continue; // unreachable on Node: the WHATWG parser always yields a
        // non-empty host for https URLs (or throws -> ISS_MALFORMED).
      }
      expect(producedReasons.has(reason), `reason ${reason} was never produced`).toBe(true);
    }
  });

  it("never throws on malformed input (totality spot-check)", () => {
    const hostile: unknown[] = [
      undefined,
      Symbol.iterator,
      () => {},
      new Date(),
      { iss: { toString: () => "https://ehr.example.test" }, launch: "h" },
      { iss: "https://[::1", launch: "h" },
      { iss: "https://", launch: "h" },
      { iss: "https://ok.example.test/fhir", launch: ["array"] },
    ];
    for (const input of hostile) {
      expect(() => parse(input)).not.toThrow();
    }
  });
});

describe("parseSmartLaunchContext (acceptance)", () => {
  it("parses a minimal well-formed EHR launch", () => {
    const result = parse({ iss: "https://ehr.example.test/fhir", launch: "handle-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.iss).toBe("https://ehr.example.test/fhir");
    expect(result.context.issHost).toBe("ehr.example.test");
    expect(result.context.launch).toBe("handle-1");
    expect(result.context.audience).toBe(AUDIENCE);
    expect(result.context.synth).toBe(false);
    expect(result.context.unknownParameters).toEqual([]);
    expect(result.audit.decision).toBe("ALLOW");
    expect(result.audit.reason).toBe("OK");
    expect(result.audit.issHost).toBe("ehr.example.test");
    expect(isSmartLaunchContext(result.context)).toBe(true);
  });

  it("accepts SYNTH-namespace issuers and records them as synthetic", () => {
    for (const iss of ["https://synth.test/fhir", "https://ehr.synth.test/fhir"]) {
      const result = parse({ iss, launch: "handle-1" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.synth).toBe(true);
      }
    }
  });

  it("accepts an aud hint that matches the registered audience", () => {
    const result = parse({
      iss: "https://ehr.example.test/fhir",
      launch: "handle-1",
      aud: AUDIENCE,
    });
    expect(result.ok).toBe(true);
  });

  it("normalizes iss: strips one trailing slash, keeps port and path", () => {
    const result = parse({ iss: "https://ehr.example.test:8443/base/fhir/", launch: "handle-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.iss).toBe("https://ehr.example.test:8443/base/fhir");
      expect(result.context.issHost).toBe("ehr.example.test:8443");
    }
    const root = parse({ iss: "https://ehr.example.test/", launch: "handle-1" });
    expect(root.ok).toBe(true);
    if (root.ok) {
      expect(root.context.iss).toBe("https://ehr.example.test");
    }
  });

  it("records unknown parameter NAMES only — values never enter the result", () => {
    const result = parse({
      iss: "https://ehr.example.test/fhir",
      launch: "handle-1",
      name: "Ada Lovelace",
      mrn: "MRN-999-888",
      birthdate: "1815-12-10",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.unknownParameters).toEqual(["name", "mrn", "birthdate"]);
    const serialized = JSON.stringify(result.context);
    expect(serialized).not.toContain("Ada Lovelace");
    expect(serialized).not.toContain("MRN-999-888");
    expect(serialized).not.toContain("1815-12-10");
  });

  it("uses deterministic audit ids/timestamps from the injected seams", () => {
    const clock = CLOCK();
    const ids = IDS();
    const first = parseSmartLaunchContext(
      { iss: "https://ehr.example.test/fhir", launch: "handle-1" },
      { audience: AUDIENCE, clock, idFactory: ids },
    );
    const second = parseSmartLaunchContext(
      { iss: "https://ehr.example.test/fhir", launch: "handle-1" },
      { audience: AUDIENCE, clock, idFactory: ids },
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.audit.id).not.toBe(second.audit.id);
      expect(first.audit.at).toEqual(second.audit.at);
    }
  });

  it("rejects a malformed audience expectation as a programmer error (invariant, not typed denial)", () => {
    for (const bad of ["", "   ", 42, "has space", "x".repeat(SMART_LAUNCH_HANDLE_MAX_LENGTH + 1)]) {
      expect(() =>
        parseSmartLaunchContext({ iss: "https://ehr.example.test/fhir", launch: "h" }, {
          audience: bad as string,
          clock: CLOCK(),
          idFactory: IDS(),
        }),
      ).toThrow(SmartInvariantError);
    }
  });
});
