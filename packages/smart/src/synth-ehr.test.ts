import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { parseSmartLaunchContext } from "./launch-context.js";
import {
  SYNTH_ASSERTION_PREFIX,
  SynthEhrExchange,
  type SmartEhrClientRegistration,
  type SmartEhrKeyset,
} from "./synth-ehr.js";
import { SmartInvariantError } from "./errors.js";
import type { SmartTokenExchange } from "./exchange.js";

const ISSUER = "https://ehr.synth.test/fhir";
const AUDIENCE = "orbb-clinical-web";
const KEYSET_ID = "synth-keyset-1";
const SECRET = "synth-client-secret-1";
const ALLOWED = "patient/Observation.rs patient/Condition.rs patient/DocumentReference.rs patient/Patient.rs";

const KEYSET: SmartEhrKeyset = {
  keysetId: KEYSET_ID,
  purpose: "client_authentication",
  algorithm: "ES384",
  jwksUrl: "https://ehr.synth.test/.well-known/jwks.json",
};

function makeEhr(registrations: readonly SmartEhrClientRegistration[], keysets: readonly SmartEhrKeyset[] = [KEYSET]) {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "smart-synth-ehr" });
  const ehr: SmartTokenExchange = new SynthEhrExchange({
    registrations,
    keysets,
    clock,
    idFactory: ids,
  });
  return { clock, ids, ehr: ehr as SynthEhrExchange };
}

function secretRegistration(): SmartEhrClientRegistration {
  return {
    issuer: ISSUER,
    clientId: AUDIENCE,
    redirectUri: "https://app.orbb.example.test/smart/callback",
    clientAuthentication: { kind: "client_secret", clientSecret: SECRET },
    allowedScopes: ALLOWED,
  };
}

function keysetRegistration(): SmartEhrClientRegistration {
  return {
    issuer: ISSUER,
    clientId: AUDIENCE,
    redirectUri: "https://app.orbb.example.test/smart/callback",
    clientAuthentication: { kind: "private_key_jwt", keysetId: KEYSET_ID },
    allowedScopes: ALLOWED,
  };
}

async function launchedContext(
  ehr: SynthEhrExchange,
  input: { readonly audience?: string; readonly patient?: string | null } = {},
) {
  const handle = await ehr.beginLaunch({
    issuer: ISSUER,
    patient: input.patient === undefined ? "synth-patient-0001" : input.patient,
  });
  const parsed = parseSmartLaunchContext({ iss: ISSUER, launch: handle }, {
    audience: input.audience ?? AUDIENCE,
  });
  if (!parsed.ok) {
    throw new Error("test fixture launch must parse");
  }
  return parsed.context;
}

describe("SynthEhrExchange (directory + provider-contract shapes)", () => {
  it("validates registrations fail-closed at construction", () => {
    const bad: readonly SmartEhrClientRegistration[] = [
      { ...secretRegistration(), issuer: "http://insecure.example.test/fhir" },
      { ...secretRegistration(), clientId: "" },
      { ...secretRegistration(), redirectUri: "http://app.example.test/cb" },
      { ...secretRegistration(), clientAuthentication: { kind: "client_secret", clientSecret: "" } },
      { ...secretRegistration(), clientAuthentication: { kind: "nope" } as never },
      { ...secretRegistration(), clientAuthentication: { kind: "private_key_jwt", keysetId: "missing" } },
      { ...secretRegistration(), allowedScopes: "patient/Observation.crud" },
      { ...secretRegistration(), tokenTtlMs: 0 },
      { ...secretRegistration(), handleTtlMs: -1 },
    ];
    for (const row of bad) {
      expect(() => new SynthEhrExchange({ registrations: [row] }), JSON.stringify(row)).toThrow(
        SmartInvariantError,
      );
    }
    // A private_key_jwt registration without its keyset registered fails too...
    expect(
      () => new SynthEhrExchange({ registrations: [keysetRegistration()] }),
    ).toThrow(SmartInvariantError);
    // ...and succeeds when the keyset IS registered.
    expect(
      () => new SynthEhrExchange({ registrations: [keysetRegistration()], keysets: [KEYSET] }),
    ).not.toThrow();
  });

  it("validates keysets fail-closed at construction", () => {
    const bad: readonly SmartEhrKeyset[] = [
      { ...KEYSET, keysetId: "" },
      { ...KEYSET, purpose: "signing-things" as never },
      { ...KEYSET, algorithm: "HS256" as never },
      { ...KEYSET, jwksUrl: "http://insecure.example.test/jwks" },
    ];
    for (const keyset of bad) {
      expect(() => new SynthEhrExchange({ registrations: [], keysets: [keyset] })).toThrow(
        SmartInvariantError,
      );
    }
    expect(
      () =>
        new SynthEhrExchange({
          registrations: [],
          keysets: [KEYSET, { ...KEYSET, purpose: "ehr_signing" }],
        }),
    ).toThrow(SmartInvariantError); // duplicate keyset id
  });

  it("stores only DIGESTS of registered client secrets (never the raw secret)", () => {
    const { ehr } = makeEhr([secretRegistration()]);
    const dump = JSON.stringify(ehr.snapshot());
    expect(dump).not.toContain(SECRET);
  });
});

describe("SynthEhrExchange (client authentication shapes)", () => {
  it("authenticates client_secret registrations (timing-safe digest compare)", async () => {
    const { ehr } = makeEhr([secretRegistration()]);
    const context = await launchedContext(ehr);
    const ok = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(ok.ok).toBe(true);
    const wrong = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: "wrong" },
      requestedScopes: "patient/Observation.rs",
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.code).toBe("INVALID_CLIENT");
    }
  });

  it("authenticates private_key_jwt registrations by SYNTH assertion SHAPE (documented handoff)", async () => {
    const { ehr } = makeEhr([keysetRegistration()]);
    const context = await launchedContext(ehr);
    const good = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientAssertion: `${SYNTH_ASSERTION_PREFIX}${KEYSET_ID}.synth-signed-assertion` },
      requestedScopes: "patient/Patient.rs",
    });
    expect(good.ok).toBe(true);

    // Fresh handle for each failure (single-use).
    for (const assertion of [
      `${SYNTH_ASSERTION_PREFIX}${KEYSET_ID}.`, // empty opaque part
      `${SYNTH_ASSERTION_PREFIX}other-keyset.signed`, // wrong keyset
      "not-a-synth-assertion",
      undefined,
    ]) {
      const freshContext = await launchedContext(ehr);
      const result = await ehr.exchange({
        context: freshContext,
        client: { clientId: AUDIENCE, ...(assertion !== undefined ? { clientAssertion: assertion } : {}) },
        requestedScopes: "patient/Patient.rs",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_CLIENT");
      }
    }
  });
});

describe("SynthEhrExchange (boundary behavior mirrors the seam contract)", () => {
  it("full lifecycle: begin launch -> exchange -> verify -> revoke", async () => {
    const { ehr } = makeEhr([secretRegistration()]);
    const context = await launchedContext(ehr, { patient: "synth-patient-0042" });
    const result = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Condition.rs patient/Patient.rs",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u); // opaque, never a JWT
    expect(result.record.patient).toBe("synth-patient-0042");
    expect(result.record.scope).toBe("patient/Condition.rs patient/Patient.rs");
    expect(result.record.scopes).toHaveLength(2);
    expect(result.audit.decision).toBe("ALLOW");

    const verified = await ehr.verify(result.token);
    expect(verified.ok).toBe(true);
    expect(await ehr.revoke(result.token)).toBe(true);
    const revoked = await ehr.verify(result.token);
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.code).toBe("REVOKED");
    }
  });

  it("single-use handles and typed denials behave like the seam contract", async () => {
    const { ehr, clock } = makeEhr([secretRegistration()]);
    const context = await launchedContext(ehr);
    const first = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(first.ok).toBe(true);
    const second = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("LAUNCH_HANDLE_CONSUMED");
    }
    // Mint a handle, let its TTL lapse, then exchange: expired denial.
    const staleContext = await launchedContext(ehr);
    clock.advance(300_001); // default handle TTL is 300s
    const expired = await ehr.exchange({
      context: staleContext,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.code).toBe("LAUNCH_HANDLE_EXPIRED");
    }
  });

  it("narrows requested scopes to the registered ceiling", async () => {
    const { ehr } = makeEhr([
      { ...secretRegistration(), allowedScopes: "patient/Observation.rs" },
    ]);
    const context = await launchedContext(ehr);
    const result = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs patient/Condition.rs patient/Patient.rs",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.scope).toBe("patient/Observation.rs");
    expect(result.scopeNarrowed).toBe(true);
  });

  it("fails closed with EXCHANGE_UNAVAILABLE when the adapter is unavailable", async () => {
    const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
    const ids = new DeterministicIdFactory({ seed: "smart-synth-ehr" });
    const ehr = new SynthEhrExchange({
      registrations: [secretRegistration()],
      clock,
      idFactory: ids,
      simulate: { exchangeUnavailable: true },
    });
    const context = await launchedContext(ehr);
    const result = await ehr.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXCHANGE_UNAVAILABLE");
      expect(result.audit.decision).toBe("DENY");
    }
  });

  it("rejects unknown issuers and audiences like the seam contract", async () => {
    const { ehr } = makeEhr([secretRegistration()]);
    const parsed = parseSmartLaunchContext(
      { iss: "https://unknown.synth.test/fhir", launch: "synthlaunch_x" },
      { audience: AUDIENCE },
    );
    if (!parsed.ok) throw new Error("fixture must parse");
    const unknown = await ehr.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.code).toBe("UNKNOWN_ISSUER");
    }

    const wrongAudienceContext = await launchedContext(ehr, { audience: "some-other-client" });
    const wrongAudience = await ehr.exchange({
      context: wrongAudienceContext,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(wrongAudience.ok).toBe(false);
    if (!wrongAudience.ok) {
      expect(wrongAudience.code).toBe("AUDIENCE_MISMATCH");
    }
  });

  it("never mints handles for unregistered issuers (programmer error)", async () => {
    const { ehr } = makeEhr([secretRegistration()]);
    await expect(
      ehr.beginLaunch({ issuer: "https://unknown.synth.test/fhir", patient: null }),
    ).rejects.toThrow(SmartInvariantError);
  });
});
