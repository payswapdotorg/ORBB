/**
 * Schema definition tests (A14):
 *   - type-level shape assertions over the Drizzle tables (column
 *     presence + nullability) — the schema definitions typecheck AND
 *     match the frozen domain field lists;
 *   - static drift guards: the generated migration SQL carries the
 *     frozen @orbb/domain and @orbb/contracts vocabularies verbatim
 *     (schema.ts derives them from the constants, and this test pins
 *     the generated SQL so a regeneration cannot silently drift);
 *   - the hand-authored append-only migration is present in the
 *     journal (applied by the PGlite harness in the other suites).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE_LABELS,
  GRANT_STATES,
  INTENT_STATES,
  OBSERVATION_VALIDATION_STATES,
  PLAN_STATES,
} from "@orbb/domain";
import { DOMAIN_EVENT_TYPES, OUTBOX_STATUSES } from "@orbb/contracts";
import { getTableColumns } from "drizzle-orm";
import {
  accessAudits,
  accessGrants,
  accounts,
  evidenceObjects,
  healthIntents,
  idempotencyLedger,
  measurementPlans,
  observations,
  outbox,
  persons,
  provenances,
} from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

function readMigration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");
}

describe("schema type-level shapes", () => {
  it("persons: opaque prsn_ id + display name + pagination anchor", () => {
    const columns = getTableColumns(persons);
    expect(Object.keys(columns).sort()).toEqual(["createdAt", "displayName", "id"]);
    // Runtime config is what drizzle-kit generates from (PRIMARY KEY
    // implies NOT NULL in the emitted SQL — pinned by the drift tests).
    expect(columns.id.notNull).toBe(true);
    expect((columns.id as unknown as { primary: boolean }).primary).toBe(true);
  });

  it("accounts: acct_ id + person FK", () => {
    expect(Object.keys(getTableColumns(accounts)).sort()).toEqual(["createdAt", "id", "personId"]);
  });

  it("provenances: full domain Provenance field list", () => {
    expect(Object.keys(getTableColumns(provenances)).sort()).toEqual([
      "actor",
      "causationId",
      "correlationId",
      "createdAt",
      "id",
      "occurredAt",
      "subject",
    ]);
  });

  it("health_intents: §5 field list + supersession-era extras", () => {
    expect(Object.keys(getTableColumns(healthIntents)).sort()).toEqual([
      "createdAt",
      "evidencePackVersion",
      "id",
      "objective",
      "personId",
      "planId",
      "state",
    ]);
  });

  it("observations: §5 field list INCLUDING supersedesId (M1 amendment)", () => {
    expect(Object.keys(getTableColumns(observations)).sort()).toEqual([
      "conceptCode",
      "createdAt",
      "effectiveAt",
      "evidenceId",
      "evidenceLabel",
      "id",
      "methodId",
      "observedAt",
      "personId",
      "provenanceId",
      "quality",
      "sourceId",
      "supersedesId",
      "unit",
      "validationState",
      "value",
    ]);
    expect(getTableColumns(observations).supersedesId.notNull).toBe(false);
  });

  it("evidence_objects: §5 field list + operational columns", () => {
    expect(Object.keys(getTableColumns(evidenceObjects)).sort()).toEqual([
      "capturedAt",
      "createdAt",
      "id",
      "mediaType",
      "objectKey",
      "personId",
      "provenanceId",
      "retentionClass",
      "sha256",
      "sizeBytes",
      "sourceType",
      "state",
    ]);
  });

  it("measurement_plans: §5 field list with metrics array", () => {
    expect(Object.keys(getTableColumns(measurementPlans)).sort()).toEqual([
      "createdAt",
      "id",
      "intentId",
      "metrics",
      "personId",
      "state",
    ]);
  });

  it("access_audits: append-only audit fields", () => {
    expect(Object.keys(getTableColumns(accessAudits)).sort()).toEqual([
      "actor",
      "at",
      "createdAt",
      "decision",
      "decisionId",
      "id",
      "requestDigest",
      "subjectId",
    ]);
  });

  it("outbox: §4 transactional outbox fields", () => {
    expect(Object.keys(getTableColumns(outbox)).sort()).toEqual([
      "attempts",
      "createdAt",
      "eventId",
      "eventType",
      "lastError",
      "payload",
      "publishedAt",
      "status",
    ]);
  });

  it("idempotency_ledger: (table, operation, key) claim columns", () => {
    expect(Object.keys(getTableColumns(idempotencyLedger)).sort()).toEqual([
      "appliedAt",
      "idempotencyKey",
      "operation",
      "recordId",
      "tableName",
    ]);
  });

  it("access_grants: §5 field list with scope array", () => {
    expect(Object.keys(getTableColumns(accessGrants)).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "purpose",
      "recipientId",
      "scope",
      "state",
      "subjectId",
    ]);
  });
});

describe("migration drift guards (frozen vocabularies reach the SQL)", () => {
  const core = readMigration("0000_m2_a_persistence_core.sql");

  it("carries the intent state vocabulary", () => {
    expect(core).toContain(`in (${INTENT_STATES.map((s) => `'${s}'`).join(", ")})`);
  });

  it("carries the plan state vocabulary", () => {
    expect(core).toContain(`in (${PLAN_STATES.map((s) => `'${s}'`).join(", ")})`);
  });

  it("carries the grant state vocabulary", () => {
    expect(core).toContain(`in (${GRANT_STATES.map((s) => `'${s}'`).join(", ")})`);
  });

  it("carries the observation validation-state vocabulary", () => {
    expect(core).toContain(
      `in (${OBSERVATION_VALIDATION_STATES.map((s) => `'${s}'`).join(", ")})`,
    );
  });

  it("carries the evidence-label vocabulary", () => {
    expect(core).toContain(`in (${EVIDENCE_LABELS.map((s) => `'${s}'`).join(", ")})`);
  });

  it("carries the full §11 event-type vocabulary in the outbox check", () => {
    expect(core).toContain(`in (${DOMAIN_EVENT_TYPES.map((t) => `'${t}'`).join(", ")})`);
  });

  it("carries the outbox status vocabulary", () => {
    expect(core).toContain(`in (${OUTBOX_STATUSES.map((s) => `'${s}'`).join(", ")})`);
  });

  it("carries the domain id grammar checks (prsn_/obs_/evid_/...)", () => {
    for (const prefix of ["prsn", "acct", "prov", "intent", "evid", "obs", "plan", "grant", "audit", "evt"]) {
      expect(core).toContain(`~ '^${prefix}_`);
    }
  });

  it("carries the observation jsonb value-type union check", () => {
    expect(core).toContain("jsonb_typeof");
  });

  it("carries the unique supersedes linkage", () => {
    expect(core).toContain('CONSTRAINT "uq_observations_supersedes" UNIQUE("supersedes_id")');
  });

  it("carries the unique object key (content addressing)", () => {
    expect(core).toContain('CONSTRAINT "uq_evidence_objects_object_key" UNIQUE("object_key")');
  });

  it("0001 hand-authored migration: append-only trigger is journaled", () => {
    const journal = JSON.parse(
      readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, "utf8"),
    ) as { entries: { tag: string; idx: number }[] };
    expect(journal.entries.map((e) => e.tag)).toEqual([
      "0000_m2_a_persistence_core",
      "0001_access_audits_append_only",
    ]);
    const trigger = readMigration("0001_access_audits_append_only.sql");
    expect(trigger).toContain("orbb_reject_access_audit_mutation");
    expect(trigger).toContain("BEFORE UPDATE OR DELETE");
    expect(trigger).toContain("BEFORE TRUNCATE");
  });
});
