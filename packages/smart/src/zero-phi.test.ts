import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { parseSmartLaunchContext } from "./launch-context.js";
import {
  InMemoryTokenExchange,
  type SmartTokenExchangeResult,
  type SmartTokenVerificationResult,
} from "./exchange.js";
import { SynthEhrExchange } from "./synth-ehr.js";
import { evaluateSmartScope } from "./evaluation.js";
import { randomOpaqueToken } from "./crypto.js";

/**
 * Synthetic PHI-style markers — obviously synthetic, never real data
 * (AGENTS.md: never use real medical data in development/test fixtures).
 * If any of these strings appear in ANY surface this package emits
 * (tokens, token records, audit records, error messages, serialized
 * results), the boundary has leaked. `not.toContain` proofs over every
 * outbound surface, the @orbb/observability pattern.
 */
const SYNTH_PHI_MARKERS = [
  "Ada Lovelace",
  "ada.lovelace@example-health.test",
  "MRN-999-888",
  "1815-12-10", // birthdate
  "555-0100", // phone
  "1 Analytical Way", // address
] as const;

const AUDIENCE = "orbb-clinical-web";
const ISSUER = "https://ehr.synth.test/fhir";
const SECRET = "synth-client-secret-1";

const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
const ids = new DeterministicIdFactory({ seed: "zero-phi" });

function expectNoPhi(surface: unknown, what: string): void {
  const serialized =
    typeof surface === "string"
      ? surface
      : JSON.stringify(surface, (_key, value) => (value instanceof Date ? value.toISOString() : value));
  for (const marker of SYNTH_PHI_MARKERS) {
    expect(serialized, `${what} leaked the marker "${marker}"`).not.toContain(marker);
  }
}

describe("zero-PHI boundary (tokens, audit shapes, error messages)", () => {
  it("keeps launch-context results free of PHI values (unknown-param values are dropped)", () => {
    const result = parseSmartLaunchContext(
      {
        iss: "https://ehr.synth.test/fhir",
        launch: "handle-1",
        patientName: "Ada Lovelace",
        patientMrn: "MRN-999-888",
        patientBirthdate: "1815-12-10",
      },
      { audience: AUDIENCE, clock, idFactory: ids },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectNoPhi(result.context, "launch context");
    expectNoPhi(result.audit, "launch audit record");
    expect(result.context.unknownParameters).toEqual(["patientName", "patientMrn", "patientBirthdate"]);
  });

  it("keeps validation failure messages free of PHI carried in malformed input", () => {
    const hostile: unknown[] = [
      { iss: "https://ehr.synth.test/fhir?name=Ada+Lovelace", launch: "h" },
      { iss: "https://Ada-Lovelace-MRN-999-888@ehr.synth.test/fhir", launch: "h" },
      { iss: "https://ehr.synth.test/fhir#MRN-999-888", launch: "h" },
      { iss: "https://ehr.synth.test/fhir", launch: "Ada Lovelace 555-0100" },
      { iss: "https://ehr.synth.test/fhir", launch: "MRN-999-888", aud: "Ada Lovelace" },
    ];
    for (const input of hostile) {
      const result = parseSmartLaunchContext(input, {
        audience: AUDIENCE,
        clock,
        idFactory: ids,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expectNoPhi(result.message, "validation failure message");
        expectNoPhi(result.audit, "validation failure audit record");
      }
    }
  });

  it("keeps issued tokens, token records, and the at-rest store free of PHI", async () => {
    const localIds = new DeterministicIdFactory({ seed: "zero-phi-exchange" });
    const ehr = new InMemoryTokenExchange({
      registrations: [
        {
          issuer: ISSUER,
          clientId: AUDIENCE,
          clientSecret: SECRET,
          grantedScopes: "patient/Observation.rs",
        },
      ],
      clock,
      idFactory: localIds,
    });
    const handle = await ehr.issueLaunchHandle({
      issuer: ISSUER,
      patient: "synth-patient-0001",
    });
    // The patient identifier itself is a non-PHI opaque locator; PHI
    // markers must still never appear anywhere.
    const parsed = parseSmartLaunchContext({ iss: ISSUER, launch: handle }, {
      audience: AUDIENCE,
      clock,
      idFactory: localIds,
    });
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await ehr.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    if (!result.ok) throw new Error("exchange must succeed");

    // The opaque token embeds nothing at all (43-char base64url random).
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expectNoPhi(result.token, "issued token");
    expectNoPhi(result.record, "token record");
    expectNoPhi(result.audit, "exchange audit record");
    expectNoPhi(ehr.snapshot(), "at-rest token store (digests only)");

    const verified: SmartTokenVerificationResult = await ehr.verify(result.token);
    if (!verified.ok) throw new Error("verify must succeed");
    expectNoPhi(verified.record, "verified token record");
    expectNoPhi(verified.audit, "verification audit record");
  });

  it("keeps scope-grammar denial messages free of PHI embedded in adversarial scope strings", () => {
    const result = evaluateSmartScope(
      "patient/Observation.rs patient/Ada-Lovelace-MRN-999-888.rs",
      { resourceType: "Observation", access: "read" },
    );
    expect(result.decision).toBe("DENY");
    if (result.decision === "DENY") {
      expectNoPhi(result.message, "scope evaluation denial message");
      expect(result.reason).toBe("GRANTED_SCOPE_MALFORMED");
    }
  });

  it("keeps exchange failure messages and audits free of PHI", async () => {
    const localIds = new DeterministicIdFactory({ seed: "zero-phi-failures" });
    const ehr = new InMemoryTokenExchange({
      registrations: [
        {
          issuer: ISSUER,
          clientId: AUDIENCE,
          clientSecret: SECRET,
          grantedScopes: "patient/Observation.rs",
        },
      ],
      clock,
      idFactory: localIds,
    });
    const hostileLaunches: readonly { input: unknown }[] = [
      { input: { iss: "https://stranger.synth.test/fhir", launch: "Ada Lovelace" } },
      { input: { iss: "https://ehr.synth.test/fhir", launch: "MRN-999-888-unknown" } },
    ];
    for (const { input } of hostileLaunches) {
      const parsed = parseSmartLaunchContext(input, {
        audience: AUDIENCE,
        clock,
        idFactory: localIds,
      });
      if (!parsed.ok) {
        expectNoPhi(parsed.message, "launch failure message");
        continue;
      }
      const result: SmartTokenExchangeResult = await ehr.exchange({
        context: parsed.context,
        client: { clientId: AUDIENCE, clientSecret: "wrong-secret-Ada-Lovelace" },
        requestedScopes: "patient/Observation.rs",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expectNoPhi(result.message, "exchange failure message");
        expectNoPhi(result.audit, "exchange failure audit record");
      }
    }
  });

  it("keeps SYNTH EHR surfaces free of PHI and raw secrets", async () => {
    const localIds = new DeterministicIdFactory({ seed: "zero-phi-synth" });
    const ehr = new SynthEhrExchange({
      registrations: [
        {
          issuer: ISSUER,
          clientId: AUDIENCE,
          redirectUri: "https://app.orbb.example.test/smart/callback",
          clientAuthentication: { kind: "client_secret", clientSecret: SECRET },
          allowedScopes: "patient/Observation.rs",
        },
      ],
      clock,
      idFactory: localIds,
    });
    const handle = await ehr.beginLaunch({ issuer: ISSUER, patient: "synth-patient-0002" });
    const parsed = parseSmartLaunchContext({ iss: ISSUER, launch: handle }, {
      audience: AUDIENCE,
      clock,
      idFactory: localIds,
    });
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await ehr.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    if (!result.ok) throw new Error("exchange must succeed");
    expectNoPhi(result.token, "SYNTH EHR issued token");
    expectNoPhi(result.record, "SYNTH EHR token record");
    expectNoPhi(ehr.snapshot(), "SYNTH EHR at-rest store");
    expectNoPhi(JSON.stringify(ehr.snapshot()), "SYNTH EHR at-rest store (raw)");
  });

  it("fresh opaque tokens never embed PHI (randomness sanity over 25 draws)", () => {
    for (let i = 0; i < 25; i += 1) {
      const token = randomOpaqueToken(32);
      expectNoPhi(token, "random opaque token");
    }
  });
});
