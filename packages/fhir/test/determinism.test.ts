/**
 * Determinism proofs (definition of done, part 2): map-twice
 * byte-identical, including across a serialized re-instantiation of the
 * DOMAIN inputs; deterministic domain-separated resource ids; canonical
 * serializer invariants.
 */
import { describe, expect, it } from "vitest";
import { serializeCanonical, prettyCanonical } from "../src/canonical.js";
import { deriveResourceId } from "../src/fhirIds.js";
import { FhirMappingError } from "../src/errors.js";
import {
  WORLD_A,
  WORLD_B,
  mapWorld,
  reviveWorld,
  serializeWorld,
  worldContext,
} from "./worlds.js";
import { createFhirMappingContext } from "../src/context.js";
import { mapObservation } from "../src/observation.js";
import { mapConsent } from "../src/consent.js";

describe("determinism — map twice, byte-identical", () => {
  it("world A maps to byte-identical output on every call", () => {
    const ctx1 = worldContext(WORLD_A);
    const ctx2 = worldContext(WORLD_A);
    const first = mapWorld(WORLD_A, ctx1);
    const second = mapWorld(WORLD_A, ctx2);
    expect(serializeCanonical(second.resources)).toBe(serializeCanonical(first.resources));
    expect(serializeCanonical(second.provenances)).toBe(serializeCanonical(first.provenances));
  });

  it("world B maps to byte-identical output on every call", () => {
    const first = mapWorld(WORLD_B, worldContext(WORLD_B));
    const second = mapWorld(WORLD_B, worldContext(WORLD_B));
    expect(serializeCanonical(second.resources)).toBe(serializeCanonical(first.resources));
  });

  it("mapping survives a serialized re-instantiation of the domain world (dates revived)", () => {
    const ctx = worldContext(WORLD_A);
    const direct = mapWorld(WORLD_A, ctx);
    const revived = mapWorld(reviveWorld(serializeWorld(WORLD_A)), worldContext(WORLD_A));
    expect(serializeCanonical(revived.resources)).toBe(serializeCanonical(direct.resources));
    expect(serializeCanonical(revived.provenances)).toBe(serializeCanonical(direct.provenances));
  });

  it("world fixtures themselves are deterministic (serialized world A is stable)", () => {
    expect(serializeWorld(WORLD_A)).toBe(serializeWorld(WORLD_A));
  });

  it("a context re-created from the same options produces byte-identical mappings", () => {
    const mkCtx = () =>
      createFhirMappingContext({
        metrics: WORLD_A.metrics,
        intentFocuses: WORLD_A.intentFocuses,
        provenanceRecords: WORLD_A.provenance.map((entry) => entry.record),
      });
    const observation = WORLD_A.observations[0]!;
    expect(serializeCanonical(mapObservation(observation, mkCtx()))).toBe(
      serializeCanonical(mapObservation(observation, mkCtx())),
    );
    const grant = WORLD_A.grants[0]!;
    expect(serializeCanonical(mapConsent(grant, mkCtx()))).toBe(
      serializeCanonical(mapConsent(grant, mkCtx())),
    );
  });
});

describe("determinism — resource ids are pure domain-separated functions", () => {
  it("same (resourceType, source id) -> same id, always", () => {
    expect(deriveResourceId("Observation", "obs_SYNTH00000000000A")).toBe(
      deriveResourceId("Observation", "obs_SYNTH00000000000A"),
    );
  });

  it("domain separation: the same source id yields different ids per resource type", () => {
    const source = "obs_SYNTH00000000000A";
    expect(deriveResourceId("Observation", source)).not.toBe(
      deriveResourceId("DiagnosticReport", source),
    );
  });

  it("different source ids yield different ids", () => {
    expect(deriveResourceId("Patient", "prsn_SYNTH000000000001")).not.toBe(
      deriveResourceId("Patient", "prsn_SYNTH000000000002"),
    );
  });

  it("derived ids satisfy the FHIR id grammar", () => {
    for (const resourceType of [
      "Patient",
      "Observation",
      "DiagnosticReport",
      "Condition",
      "DocumentReference",
      "Consent",
      "Provenance",
    ] as const) {
      const id = deriveResourceId(resourceType, "prsn_SYNTH000000000001");
      expect(id).toMatch(/^[A-Za-z0-9-.]{1,64}$/);
    }
  });
});

describe("determinism — canonical serializer invariants", () => {
  it("key order does not affect canonical bytes", () => {
    expect(serializeCanonical({ b: 1, a: 2 })).toBe(serializeCanonical({ a: 2, b: 1 }));
    expect(serializeCanonical({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("nested key ordering is recursive", () => {
    expect(serializeCanonical({ z: { y: 1, x: [2, { b: 3, a: 4 }] } })).toBe(
      '{"z":{"x":[2,{"a":4,"b":3}],"y":1}}',
    );
  });

  it("array order is preserved (order is domain data)", () => {
    expect(serializeCanonical([3, 1, 2])).toBe("[3,1,2]");
  });

  it("string escaping is deterministic", () => {
    expect(serializeCanonical({ note: "a\"b\\c\nd" })).toBe('{"note":"a\\"b\\\\c\\nd"}');
  });

  it("pretty and compact forms carry the same structure", () => {
    const value = { b: [1, 2], a: { c: true } };
    expect(JSON.parse(prettyCanonical(value))).toEqual(JSON.parse(serializeCanonical(value)));
    expect(prettyCanonical(value)).toBe('{\n  "a": {\n    "c": true\n  },\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  it("fails closed on non-JSON values (Date, undefined, function, symbol, non-finite)", () => {
    expect(() => serializeCanonical({ at: new Date(0) })).toThrow(FhirMappingError);
    expect(() => serializeCanonical({ at: undefined })).toThrow(FhirMappingError);
    expect(() => serializeCanonical({ at: () => 1 })).toThrow(FhirMappingError);
    expect(() => serializeCanonical({ at: Number.POSITIVE_INFINITY })).toThrow(FhirMappingError);
    expect(() => serializeCanonical({ at: Number.NaN })).toThrow(FhirMappingError);
    try {
      serializeCanonical({ at: new Date(0) });
    } catch (error) {
      expect((error as FhirMappingError).kind).toBe("non-canonical-value");
    }
  });

  it("numbers serialize via ECMAScript shortest round-trip semantics", () => {
    expect(serializeCanonical({ v: 0.1 })).toBe('{"v":0.1}');
    expect(serializeCanonical({ v: -0 })).toBe('{"v":0}');
    expect(serializeCanonical({ v: 1e21 })).toBe('{"v":1e+21}');
  });
});
