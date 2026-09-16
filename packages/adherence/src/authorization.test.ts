import { describe, expect, it } from "vitest";
import type { AccessGrant, GrantId, PersonId } from "@orbb/domain";
import { AccessGrantAdherenceGate } from "./authorization.js";

const PERSON_ID = "prsn_SYNTH-person-000001" as PersonId;
const OTHER_PERSON_ID = "prsn_SYNTH-person-000002" as PersonId;
const GRANT_ID = "grant_SYNTHTGRANT00000001" as GrantId;
const OTHER_GRANT_ID = "grant_SYNTHTGRANT00000002" as GrantId;

const NOW_MS = 1_789_000_000_000;
const PERMISSION = "adherence:restrict:ios-focus";

function grant(overrides?: {
  id?: GrantId;
  subjectId?: PersonId;
  scope?: readonly string[];
  state?: "active" | "revoked";
  expiresAt?: Date;
}): AccessGrant {
  return {
    id: overrides?.id ?? GRANT_ID,
    subjectId: overrides?.subjectId ?? PERSON_ID,
    recipientId: "SYNTH-recipient-orbb-app",
    purpose: "SYNTH-SELF_MANAGEMENT",
    scope: overrides?.scope ?? [PERMISSION],
    state: overrides?.state ?? "active",
    expiresAt: overrides?.expiresAt ?? new Date(NOW_MS + 60_000),
  };
}

function makeGate(grants: readonly unknown[], nowMs: () => number = () => NOW_MS) {
  return new AccessGrantAdherenceGate({
    grants: async () => grants,
    nowMs,
  });
}

function request(overrides?: { grantId?: GrantId; permissions?: readonly string[] }) {
  return {
    personId: PERSON_ID,
    capability: "ios-focus" as const,
    permissions: overrides?.permissions ?? [PERMISSION],
    ...(overrides?.grantId !== undefined ? { grantId: overrides.grantId } : {}),
  };
}

describe("AccessGrantAdherenceGate (the M1-shaped injected predicate)", () => {
  it("authorizes an active, unexpired, permission-covering grant", async () => {
    const gate = makeGate([grant()]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(true);
  });

  it("denies when there are no grants at all", async () => {
    const gate = makeGate([]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("denies revoked grants (fail-closed)", async () => {
    const gate = makeGate([grant({ state: "revoked" })]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("denies expired grants — expiry instant inclusive (valid strictly before)", async () => {
    const boundary = makeGate([grant({ expiresAt: new Date(NOW_MS) })]);
    await expect(boundary.isRestrictionAuthorized(request())).resolves.toBe(false);
    const justBefore = makeGate([grant({ expiresAt: new Date(NOW_MS + 1) })]);
    await expect(justBefore.isRestrictionAuthorized(request())).resolves.toBe(true);
  });

  it("denies grants belonging to another subject", async () => {
    const gate = makeGate([grant({ subjectId: OTHER_PERSON_ID })]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("denies when no grant scope entry matches the requested permission", async () => {
    const gate = makeGate([grant({ scope: ["observations:read"] })]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("denies when the pinned grant id is not the matching grant", async () => {
    const gate = makeGate([grant(), grant({ id: OTHER_GRANT_ID })]);
    await expect(
      gate.isRestrictionAuthorized(request({ grantId: OTHER_GRANT_ID, permissions: ["observations:read"] })),
    ).resolves.toBe(false);
    await expect(
      gate.isRestrictionAuthorized(request({ grantId: OTHER_GRANT_ID })),
    ).resolves.toBe(true);
  });

  it("filters structurally malformed grant entries (domain guard, fail-closed)", async () => {
    const gate = makeGate([
      null,
      42,
      "grant",
      { id: GRANT_ID, subjectId: PERSON_ID },
      grant(),
    ]);
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(true);
    const allMalformed = makeGate([null, {}, []]);
    await expect(allMalformed.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("denies when the grant store itself throws (broken dependency => no authorization)", async () => {
    const gate = new AccessGrantAdherenceGate({
      grants: async () => {
        throw new Error("SYNTH store failure");
      },
      nowMs: () => NOW_MS,
    });
    await expect(gate.isRestrictionAuthorized(request())).resolves.toBe(false);
  });

  it("covers the request when ANY valid grant covers ANY requested permission", async () => {
    const gate = makeGate([
      grant({ id: OTHER_GRANT_ID, scope: ["observations:read"] }),
      grant({ scope: ["adherence:restrict", "intent:read"] }),
    ]);
    await expect(
      gate.isRestrictionAuthorized(
        request({ permissions: ["adherence:restrict:ios-focus", "adherence:restrict"] }),
      ),
    ).resolves.toBe(true);
  });

  it("is deterministic: same snapshot + clock => same answer, twice", async () => {
    const gate = makeGate([
      grant({ state: "revoked" }),
      grant({ id: OTHER_GRANT_ID, scope: ["observations:read"] }),
    ]);
    const one = await gate.isRestrictionAuthorized(request());
    const two = await gate.isRestrictionAuthorized(request());
    expect(one).toBe(two);
    expect(one).toBe(false);
  });
});
