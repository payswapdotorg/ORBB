import { describe, expect, it } from "vitest";
import { DeterministicClock, DeterministicIdFactory } from "@orbb/testkit";
import { parseSmartLaunchContext } from "./launch-context.js";
import {
  InMemoryTokenExchange,
  formatSmartScopeSet,
  type InMemorySmartRegistration,
  type SmartTokenExchange,
} from "./exchange.js";
import { SmartInvariantError } from "./errors.js";

const AUDIENCE = "orbb-clinical-web";
const ISSUER = "https://ehr.synth.test/fhir";
const SECRET = "synth-client-secret-1";
const GRANTED = "patient/Observation.rs patient/Condition.rs patient/Patient.rs";

function makeExchange(registrations: readonly InMemorySmartRegistration[] = [
  {
    issuer: ISSUER,
    clientId: AUDIENCE,
    clientSecret: SECRET,
    grantedScopes: GRANTED,
    handleTtlMs: 60_000,
    tokenTtlMs: 3_600_000,
  },
]) {
  const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
  const ids = new DeterministicIdFactory({ seed: "smart-exchange" });
  const exchange: SmartTokenExchange = new InMemoryTokenExchange({
    registrations,
    clock,
    idFactory: ids,
  });
  return { clock, ids, exchange: exchange as InMemoryTokenExchange };
}

/** Full happy path: EHR mints a handle, app parses the launch, app exchanges. */
async function launchFor(
  exchange: InMemoryTokenExchange,
  input: { readonly iss?: string; readonly patient?: string | null; readonly scopes?: string } = {},
) {
  const handle = await exchange.issueLaunchHandle({
    issuer: input.iss ?? ISSUER,
    patient: input.patient === undefined ? "synth-patient-0001" : input.patient,
    ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
  });
  const parsed = parseSmartLaunchContext(
    { iss: input.iss ?? ISSUER, launch: handle },
    { audience: AUDIENCE },
  );
  if (!parsed.ok) {
    throw new Error("test fixture launch must parse");
  }
  return parsed.context;
}

describe("InMemoryTokenExchange (full lifecycle)", () => {
  it("issues an opaque token carrying the narrowed context", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs patient/Patient.rs",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Opaque token: 32 bytes base64url, nothing embedded.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.record.iss).toBe(ISSUER);
    expect(result.record.issHost).toBe("ehr.synth.test");
    expect(result.record.audience).toBe(AUDIENCE);
    expect(result.record.patient).toBe("synth-patient-0001");
    expect(result.record.scope).toBe("patient/Observation.rs patient/Patient.rs");
    expect(result.scopeNarrowed).toBe(false);
    expect(result.audit.decision).toBe("ALLOW");
    expect(result.audit.stage).toBe("token-exchange");
    // At rest: digests only — the raw token never appears in the store.
    const dump = JSON.stringify(exchange.snapshot());
    expect(dump).not.toContain(result.token);
    expect(dump).toContain(result.record.id);
  });

  it("verifies the token and reports expiry as a typed code", async () => {
    const { exchange, clock } = makeExchange();
    const context = await launchFor(exchange);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    if (!result.ok) throw new Error("exchange must succeed");

    const verified = await exchange.verify(result.token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.record.id).toBe(result.record.id);
      expect(verified.audit.decision).toBe("ALLOW");
      expect(verified.audit.stage).toBe("token-verification");
    }

    clock.advance(3_600_001); // token TTL is 3_600_000 (exclusive horizon)
    const expired = await exchange.verify(result.token);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.code).toBe("EXPIRED");
      expect(expired.audit.decision).toBe("DENY");
    }
  });

  it("revocation is idempotent and reports REVOKED on verify", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    if (!result.ok) throw new Error("exchange must succeed");

    expect(await exchange.revoke(result.token)).toBe(true);
    expect(await exchange.revoke(result.token)).toBe(false); // idempotent
    const afterRevoke = await exchange.verify(result.token);
    expect(afterRevoke.ok).toBe(false);
    if (!afterRevoke.ok) {
      expect(afterRevoke.code).toBe("REVOKED");
    }
    expect(await exchange.revoke("never-issued-token")).toBe(false);
  });

  it("unknown tokens verify as INVALID_TOKEN (never throw)", async () => {
    const { exchange } = makeExchange();
    for (const bad of ["", "garbage", "a".repeat(64)]) {
      const result = await exchange.verify(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_TOKEN");
      }
    }
  });

  it("redeems each launch handle exactly once (single-use)", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const first = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(first.ok).toBe(true);
    const second = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("LAUNCH_HANDLE_CONSUMED");
      expect(second.audit.decision).toBe("DENY");
    }
  });

  it("expires launch handles by TTL (typed denial)", async () => {
    const { exchange, clock } = makeExchange();
    const context = await launchFor(exchange);
    clock.advance(60_001);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("LAUNCH_HANDLE_EXPIRED");
    }
  });

  it("narrows scopes: never grants beyond the registration (or the handle)", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange, {
      scopes: "patient/Observation.rs", // handle ceiling narrower than registration
    });
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: GRANTED, // request everything
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.scope).toBe("patient/Observation.rs");
    expect(result.scopeNarrowed).toBe(true);
    expect(formatSmartScopeSet(result.record.scopes)).toBe(result.record.scope);
  });

  it("an empty requested scope set is VALID (token grants nothing)", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.scopes).toEqual([]);
    expect(result.record.scope).toBe("");
    expect(result.scopeNarrowed).toBe(false);
  });

  it("rejects ungrammatical requested scopes with the typed class", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const result = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs user/Patient.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("REQUESTED_SCOPE_INVALID");
      expect(result.message).toContain("index 1");
      expect(result.message).not.toContain("user/Patient.rs");
    }
  });
});

describe("InMemoryTokenExchange (fail-closed exchange errors)", () => {
  it("rejects unregistered issuers", async () => {
    const { exchange } = makeExchange();
    // Handles can only be minted for REGISTERED issuers, so an unregistered
    // issuer arrives with a foreign/never-issued handle: both fail closed.
    await expect(
      exchange.issueLaunchHandle({ issuer: "https://other-ehr.synth.test/fhir", patient: null }),
    ).rejects.toThrow(SmartInvariantError);
    const parsed = parseSmartLaunchContext(
      { iss: "https://other-ehr.synth.test/fhir", launch: "synthlaunch_never-issued" },
      { audience: AUDIENCE },
    );
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await exchange.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_ISSUER");
    }
  });

  it("rejects an audience that does not match the registered client id", async () => {
    const { exchange } = makeExchange();
    const handle = await exchange.issueLaunchHandle({ issuer: ISSUER, patient: "synth-patient-0001" });
    const parsed = parseSmartLaunchContext({ iss: ISSUER, launch: handle }, {
      audience: "a-different-client",
    });
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await exchange.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIENCE_MISMATCH");
    }
  });

  it("rejects bad client ids and bad client secrets", async () => {
    const { exchange } = makeExchange();
    const context = await launchFor(exchange);
    const wrongId = await exchange.exchange({
      context,
      client: { clientId: "someone-else", clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(wrongId.ok).toBe(false);
    if (!wrongId.ok) expect(wrongId.code).toBe("INVALID_CLIENT");

    const wrongSecret = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE, clientSecret: "wrong-secret" },
      requestedScopes: "patient/Observation.rs",
    });
    expect(wrongSecret.ok).toBe(false);
    if (!wrongSecret.ok) expect(wrongSecret.code).toBe("INVALID_CLIENT");

    const missingSecret = await exchange.exchange({
      context,
      client: { clientId: AUDIENCE },
      requestedScopes: "patient/Observation.rs",
    });
    expect(missingSecret.ok).toBe(false);
    if (!missingSecret.ok) expect(missingSecret.code).toBe("INVALID_CLIENT");
  });

  it("rejects handles that were never issued", async () => {
    const { exchange } = makeExchange();
    const parsed = parseSmartLaunchContext(
      { iss: ISSUER, launch: "synthlaunch_never-issued" },
      { audience: AUDIENCE },
    );
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await exchange.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("LAUNCH_HANDLE_UNKNOWN");
    }
  });

  it("rejects a foreign SmartLaunchContext shape as a programmer error", async () => {
    const { exchange } = makeExchange();
    await expect(
      exchange.exchange({
        context: { iss: ISSUER } as never,
        client: { clientId: AUDIENCE, clientSecret: SECRET },
        requestedScopes: "",
      }),
    ).rejects.toThrow(SmartInvariantError);
  });

  it("fails closed on grammar-violating double configuration (constructor)", () => {
    expect(
      () =>
        new InMemoryTokenExchange({
          registrations: [
            { issuer: ISSUER, clientId: AUDIENCE, grantedScopes: "patient/Observation.crud" },
          ],
        }),
    ).toThrow(SmartInvariantError);
    expect(
      () =>
        new InMemoryTokenExchange({
          registrations: [{ issuer: "", clientId: AUDIENCE, grantedScopes: "" }],
        }),
    ).toThrow(SmartInvariantError);
  });

  it("normalizes registration issuers so trailing slashes still match a parsed iss", async () => {
    const clock = new DeterministicClock({ epochMs: 1_700_000_000_000 });
    const ids = new DeterministicIdFactory({ seed: "smart-normalize" });
    const exchange = new InMemoryTokenExchange({
      registrations: [
        {
          issuer: `${ISSUER}/`, // trailing slash: must not break matching
          clientId: AUDIENCE,
          clientSecret: SECRET,
          grantedScopes: "patient/Observation.rs",
        },
      ],
      clock,
      idFactory: ids,
    });
    const handle = await exchange.issueLaunchHandle({ issuer: `${ISSUER}/`, patient: null });
    const parsed = parseSmartLaunchContext({ iss: ISSUER, launch: handle }, { audience: AUDIENCE });
    if (!parsed.ok) throw new Error("fixture must parse");
    const result = await exchange.exchange({
      context: parsed.context,
      client: { clientId: AUDIENCE, clientSecret: SECRET },
      requestedScopes: "patient/Observation.rs",
    });
    expect(result.ok).toBe(true);
  });
});
