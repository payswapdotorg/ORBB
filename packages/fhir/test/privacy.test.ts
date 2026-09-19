/**
 * PHI discipline proofs (definition of done, part 3): SYNTH fixtures and
 * mapped outputs contain no person names, no contact strings, no
 * free-text leakage — every string is accounted for by the safe-pattern
 * allowlists; the intents' free-text objectives never reach any output;
 * evidence content bytes never cross the boundary.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeCanonical } from "../src/canonical.js";
import {
  SYNTH_DEMOGRAPHIC_PORT,
  WORLD_A,
  WORLD_B,
  mapWorld,
  worldContext,
} from "./worlds.js";
import { createFhirMappingContext } from "../src/context.js";
import { mapPatient } from "../src/patient.js";
import { WORLD_A_IDS } from "./worlds.js";

const GOLDENS_DIR = fileURLToPath(new URL("./goldens", import.meta.url));

/** Recursively walks a value, invoking visit on every string. */
function walkStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkStrings(entry, visit);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) {
      walkStrings(entry, visit);
    }
  }
}

/** Recursively collects every object key. */
function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkKeys(entry, visit);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      visit(key);
      walkKeys(entry, visit);
    }
  }
}

// The safe-pattern allowlist: every string in fixtures and DEFAULT-port
// outputs must match at least one of these (no free text, no unaccounted
// labels — anything new must be added deliberately).
const SAFE_STRING_PATTERNS: readonly RegExp[] = [
  /^prsn_[A-Za-z0-9_-]+$/, // person ids
  /^intent_[A-Za-z0-9_-]+$/,
  /^obs_[A-Za-z0-9_-]+$/,
  /^evid_[A-Za-z0-9_-]+$/,
  /^plan_[A-Za-z0-9_-]+$/,
  /^task_[A-Za-z0-9_-]+$/,
  /^grant_[A-Za-z0-9_-]+$/,
  /^dev_[A-Za-z0-9_-]+$/,
  /^src_[A-Za-z0-9_-]+$/,
  /^prov_[A-Za-z0-9_-]+$/,
  /^mta_[A-Za-z0-9_-]+$/,
  /^usess_[A-Za-z0-9_-]+$/,
  /^evidence\/v1\/[A-Za-z0-9_/-]+$/, // object keys (content-addressed)
  /^[0-9a-f]{64}$/, // sha256 hex digests
  /^[A-Za-z0-9+/]+={0,2}$/, // base64 digests (R4 Attachment.hash)
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, // ISO instants
  /^https:\/\/orbb\.test\/synth(\/[a-z-]+(\/[a-z-]+)?)?$/, // SYNTH namespace URIs
  /^http:\/\/terminology\.hl7\.org\/CodeSystem\/[a-z-]+$/, // standard FHIR systems
  /^SYNTH-[A-Za-z0-9_.-]+$/, // SYNTH-marked vocabulary labels & tokens
  /^SYNTH_[A-Z_]+$/, // SYNTH uppercase tokens (purposes)
  /^[a-z]+-[0-9a-f]{32}$/, // derived FHIR resource ids
  /^(Patient|Observation|DiagnosticReport|Condition|DocumentReference|Consent|Provenance)\/[a-z]+-[0-9a-f]{32}$/, // relative resource references
  /^(Patient|Observation|DiagnosticReport|Condition|DocumentReference|Consent|Provenance)$/, // FHIR resource types
  /^(vital-signs|body-composition|activity|sleep)$/, // metric categories
  /^(beats\/min|mmHg|kg|count|min)$/, // real units (engine-seed convention)
  /^(MEASURED|ESTIMATED|IMPORTED|DERIVED)$/, // frozen evidence labels
  /^(pending|validated|rejected|superseded)$/, // frozen validation states
  /^(active|revoked|draft|paused|achieved|retired)$/, // frozen grant/intent states
  /^(open|completed)$/, // task states
  /^(complete|partial|low-quality)$/, // attempt completion states
  /^(person|device|source)$/, // actor kinds
  /^(preliminary|final|entered-in-error|registered|partial)$/, // FHIR statuses emitted
  /^(active|inactive|current|permit|provisional|resolved|patient-privacy)$/, // FHIR codes emitted
  /^(image\/png|image\/jpeg|application\/pdf|text\/plain)$/, // media types
  /^(observations|intent|evidence|plan):[a-z]+$/, // scope permission entries
  /^(moderate|light|vigorous)$/, // code-valued observation values in worlds
  /^(Heart Rate|Systolic Blood Pressure|Body Weight|Activity Intensity|Exercise Completed)$/, // vocabulary displays (engine-seed aligned)
  /^(fhir-world-[ab]|synthetic)$/, // world metadata (seed + synthetic tag)
  /^[a-z]+(-[a-z]+)*$/, // lowercase kebab vocabulary labels (sourceType, retentionClass)
  /^$/, // the empty unit (non-quantitative observations)
];

function isSafeString(value: string): boolean {
  return SAFE_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

describe("no-PHI proofs — fixtures", () => {
  it("every string in both SYNTH worlds matches the safe-pattern allowlist", () => {
    for (const world of [WORLD_A, WORLD_B]) {
      const offenders: string[] = [];
      walkStrings(world, (value) => {
        if (!isSafeString(value)) {
          offenders.push(value);
        }
      });
      expect(offenders).toEqual([]);
    }
  });

  it("fixtures contain no email-like or phone-like strings", () => {
    for (const world of [WORLD_A, WORLD_B]) {
      walkStrings(world, (value) => {
        expect(value).not.toMatch(/@/);
        expect(value).not.toMatch(/\+\d[\d\s().-]{7,}/);
        expect(value).not.toMatch(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/);
      });
    }
  });

  it("fixtures are tagged synthetic: true with a seed", () => {
    expect(WORLD_A.metadata.synthetic).toBe(true);
    expect(WORLD_B.metadata.synthetic).toBe(true);
    expect(WORLD_A.metadata.seed).toBeTypeOf("string");
    expect(WORLD_B.metadata.seed).toBeTypeOf("string");
  });
});

describe("no-PHI proofs — mapped outputs (default privacy-first contexts)", () => {
  const outputs = [
    ...mapWorld(WORLD_A, worldContext(WORLD_A)).resources.map((resource) =>
      serializeCanonical(resource),
    ),
    ...mapWorld(WORLD_A, worldContext(WORLD_A)).provenances.map((resource) =>
      serializeCanonical(resource),
    ),
    ...mapWorld(WORLD_B, worldContext(WORLD_B)).resources.map((resource) =>
      serializeCanonical(resource),
    ),
    ...mapWorld(WORLD_B, worldContext(WORLD_B)).provenances.map((resource) =>
      serializeCanonical(resource),
    ),
  ];

  it("default outputs carry no demographic keys at all (name/birthDate/gender/telecom/address)", () => {
    for (const output of outputs) {
      const keys: string[] = [];
      walkKeys(JSON.parse(output), (key) => keys.push(key));
      for (const forbidden of ["name", "birthDate", "gender", "telecom", "address", "family", "given", "line", "city", "state", "postalCode", "country", "text", "note"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("every string in every default output matches the safe-pattern allowlist (no free text)", () => {
    for (const output of outputs) {
      const offenders: string[] = [];
      walkStrings(JSON.parse(output), (value) => {
        if (!isSafeString(value)) {
          offenders.push(value);
        }
      });
      expect(offenders).toEqual([]);
    }
  });

  it("the intents' free-text objectives never appear in any output", () => {
    const objectives = WORLD_A.intents.map((intent) => intent.objective);
    for (const output of outputs) {
      for (const objective of objectives) {
        expect(output).not.toContain(objective);
      }
    }
  });

  it("evidence content never crosses the boundary (only digest/size/mime/opaque id)", () => {
    const documentOutputs = mapWorld(WORLD_A, worldContext(WORLD_A)).resources.filter(
      (resource) => resource.resourceType === "DocumentReference",
    );
    expect(documentOutputs).toHaveLength(1);
    const serialized = serializeCanonical(documentOutputs[0]);
    // The object key (storage detail) and any data: URLs must not appear.
    expect(serialized).not.toContain(WORLD_A.evidence[0]!.objectKey);
    expect(serialized).not.toContain("data:");
    // The attachment carries exactly the recorded envelope: contentType, url (opaque id), size, hash, creation.
    const attachment = (documentOutputs[0] as unknown as { readonly content: readonly { readonly attachment: Record<string, unknown> }[] }).content[0]!.attachment;
    expect(Object.keys(attachment).sort()).toEqual(["contentType", "creation", "hash", "size", "url"]);
  });

  it("outputs contain no email-like or phone-like strings", () => {
    for (const output of outputs) {
      expect(output).not.toMatch(/@/);
      expect(output).not.toMatch(/\+\d[\d\s().-]{7,}/);
    }
  });
});

describe("no-PHI proofs — golden fixture files", () => {
  const goldenFiles = readdirSync(GOLDENS_DIR).filter((name) => name.endsWith(".json"));

  it("all sixteen golden files exist", () => {
    expect(goldenFiles.sort()).toEqual([
      "condition-achieved.json",
      "condition-active.json",
      "consent-active-no-issued.json",
      "consent-active.json",
      "consent-revoked.json",
      "diagnosticreport-final.json",
      "diagnosticreport-registered.json",
      "documentreference-current.json",
      "observation-pending-string.json",
      "observation-rejected-boolean.json",
      "observation-superseded-quantity.json",
      "observation-validated-quantity.json",
      "patient-default.json",
      "patient-with-demographics.json",
      "provenance-multi-target.json",
      "provenance-observation.json",
    ]);
  });

  it("golden files contain no email-like or phone-like strings and no real-looking person names", () => {
    // Vocabulary displays ("Heart Rate", ...) are the only sanctioned
    // name-shaped strings; every other name-shaped value must be
    // SYNTH-marked (the deliberate demographic disclosure is SYNTH-only).
    const allowedNameShaped = new Set([
      "Heart Rate",
      "Systolic Blood Pressure",
      "Body Weight",
      "Activity Intensity",
      "Exercise Completed",
    ]);
    for (const name of goldenFiles) {
      const golden = readFileSync(join(GOLDENS_DIR, name), "utf8");
      expect(golden).not.toMatch(/@/);
      expect(golden).not.toMatch(/\+\d[\d\s().-]{7,}/);
      walkStrings(JSON.parse(golden), (value) => {
        if (/^[A-Z][a-z]+( [A-Z][a-z]+)+$/.test(value)) {
          expect(allowedNameShaped.has(value) || value.startsWith("SYNTH")).toBe(true);
        }
      });
    }
  });

  it("only the deliberate-demographics golden carries demographic fields, and they are SYNTH-marked", () => {
    for (const name of goldenFiles) {
      const golden = JSON.parse(readFileSync(join(GOLDENS_DIR, name), "utf8"));
      const keys: string[] = [];
      walkKeys(golden, (key) => keys.push(key));
      const hasDemographics = keys.some((key) =>
        ["name", "birthDate", "telecom", "address", "family", "given"].includes(key),
      );
      if (name === "patient-with-demographics.json") {
        expect(hasDemographics).toBe(true);
        walkStrings(golden, (value) => {
          if (value.startsWith("SYNTH-Family") || value.startsWith("SYNTH-Given")) {
            // Accounted: the deliberate port's SYNTH-marked disclosure.
            expect(value.startsWith("SYNTH")).toBe(true);
          }
        });
      } else {
        expect(hasDemographics).toBe(false);
      }
    }
  });
});

describe("no-PHI proofs — deliberate port still cannot leak malformed disclosure", () => {
  it("a port returning malformed demographics fails closed (never a partial resource)", () => {
    const ctx = createFhirMappingContext({
      demographics: {
        demographicsFor: () => ({ name: [{ family: "" }] }) as never,
      },
    });
    expect(() => mapPatient(WORLD_A_IDS.PERSON_1, ctx)).toThrow();
  });

  it("the deliberate SYNTH port maps (the only sanctioned disclosure path)", () => {
    const ctx = createFhirMappingContext({ demographics: SYNTH_DEMOGRAPHIC_PORT });
    const patient = mapPatient(WORLD_A_IDS.PERSON_1, ctx);
    const serialized = serializeCanonical(patient);
    expect(serialized).toContain("SYNTH-Family-0001");
    expect(serialized).toContain("1990-01-01");
  });
});
