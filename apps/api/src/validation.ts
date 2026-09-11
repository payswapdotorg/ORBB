/**
 * ORBB edge API — hand-rolled request validators (M3-A / A26).
 *
 * RECORDED CHOICE (validator choice): hand-rolled pure validators in the
 * house style (type guards + issue lists; PHI-safe messages that never
 * echo received values), NOT zod — zero new external runtime deps, and
 * the frozen domain value guards (@orbb/domain, pure and
 * Worker-compatible) are reused wherever a grammar already exists.
 *
 * Validation split (recorded):
 *   - TRANSPORT-level problems are 400 `invalid-request`: unparseable
 *     JSON, non-JSON content type, non-integer pagination `limit`.
 *   - BODY-level semantic problems are 422 `validation-failed` with
 *     `details.issues[]` carrying field PATHS and expected shapes only.
 *   - Unknown body fields are rejected (422) — a strict surface beats
 *     silently dropping mistyped client input.
 *
 * Length bounds not fixed by the domain (recorded, mirrored in the
 * OpenAPI schemas): objective ≤ 2000, conceptCode ≤ 128, unit ≤ 64,
 * methodId ≤ 128, value strings ≤ 512, conceptCode query param ≤ 128.
 */
import {
  EVIDENCE_LABELS,
  isEvidenceLabel,
  isIdOf,
  type EvidenceLabel,
  type ObservationValue,
  type SourceId,
  type EvidenceId,
} from "@orbb/domain";
import type { Context } from "hono";
import { ApiError, apiValidationFailed, type ValidationIssue } from "./errors.js";
import type { ApiEnv } from "./context.js";

// ---------------------------------------------------------------------------
// Body reading.
// ---------------------------------------------------------------------------

/** Reads and structurally checks a JSON object body (400 on failures). */
export async function readJsonObjectBody(c: Context<ApiEnv>): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(
      "invalid-request",
      "Request body must have content type application/json.",
    );
  }
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new ApiError("invalid-request", "Request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError("invalid-request", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Field helpers (issue-collecting, value-echo-free).
// ---------------------------------------------------------------------------

class IssueCollector {
  readonly #issues: ValidationIssue[] = [];

  add(field: string, problem: string): void {
    this.#issues.push({ field, problem });
  }

  reject(message: string): ApiError {
    return apiValidationFailed(message, this.#issues);
  }

  get hasIssues(): boolean {
    return this.#issues.length > 0;
  }
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  known: readonly string[],
  issues: IssueCollector,
): void {
  for (const key of Object.keys(body)) {
    if (!known.includes(key)) {
      issues.add(key, `unknown field; accepted fields are: ${known.join(", ")}`);
    }
  }
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  issues: IssueCollector,
  options: { readonly min: number; readonly max: number },
): string | undefined {
  const value = body[field];
  if (typeof value !== "string") {
    issues.add(field, `expected a string of ${options.min} to ${options.max} characters`);
    return undefined;
  }
  if (value.length < options.min || value.length > options.max) {
    issues.add(field, `expected a string of ${options.min} to ${options.max} characters`);
    return undefined;
  }
  return value;
}

/** Parses an ISO-8601 timestamp field (string form only). */
function parseTimestampField(
  body: Record<string, unknown>,
  field: string,
  issues: IssueCollector,
): Date | undefined {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    issues.add(field, "expected an ISO-8601 timestamp string");
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    issues.add(field, "expected a valid ISO-8601 timestamp");
    return undefined;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// POST /v1/intents input.
// ---------------------------------------------------------------------------

/** Accepted POST /v1/intents body (server derives id/state/createdAt). */
export interface IntentCreateInput {
  readonly objective: string;
}

const INTENT_MAX_OBJECTIVE = 2000;

export function parseIntentCreateBody(body: Record<string, unknown>): IntentCreateInput {
  const issues = new IssueCollector();
  rejectUnknownFields(body, ["objective"], issues);
  const objective = requireString(body, "objective", issues, { min: 1, max: INTENT_MAX_OBJECTIVE });
  if (issues.hasIssues) {
    throw issues.reject("Invalid intent creation request.");
  }
  return { objective: objective as string };
}

// ---------------------------------------------------------------------------
// POST /v1/observations input.
// ---------------------------------------------------------------------------

/** Accepted POST /v1/observations body (server derives the rest). */
export interface ObservationCreateInput {
  readonly conceptCode: string;
  readonly value: ObservationValue;
  readonly unit: string;
  readonly effectiveAt: Date;
  readonly observedAt: Date;
  readonly sourceId: SourceId;
  readonly methodId: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly evidenceId?: EvidenceId | undefined;
  readonly quality?: number | undefined;
}

const OBSERVATION_FIELDS = [
  "conceptCode",
  "value",
  "unit",
  "effectiveAt",
  "observedAt",
  "sourceId",
  "methodId",
  "evidenceLabel",
  "evidenceId",
  "quality",
] as const;

const OBSERVATION_MAX_CONCEPT = 128;
const OBSERVATION_MAX_UNIT = 64;
const OBSERVATION_MAX_METHOD = 128;
const OBSERVATION_MAX_TEXT_VALUE = 512;

function parseObservationValueField(
  body: Record<string, unknown>,
  issues: IssueCollector,
): ObservationValue | undefined {
  const value = body.value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.add("value", "expected a finite number, a bounded string, or a boolean");
      return undefined;
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length === 0 || value.length > OBSERVATION_MAX_TEXT_VALUE) {
      issues.add("value", `expected a string of 1 to ${OBSERVATION_MAX_TEXT_VALUE} characters`);
      return undefined;
    }
    return value;
  }
  issues.add("value", "expected a finite number, a bounded string, or a boolean");
  return undefined;
}

function parseObservationQualityField(
  body: Record<string, unknown>,
  issues: IssueCollector,
): number | undefined {
  if (body.quality === undefined) {
    return undefined;
  }
  const quality = body.quality;
  if (typeof quality !== "number" || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    issues.add("quality", "expected a number in the closed interval [0, 1]");
    return undefined;
  }
  return quality;
}

function parseCanonicalIdField<K extends "source" | "evidence">(
  body: Record<string, unknown>,
  field: string,
  kind: K,
  issues: IssueCollector,
): string | undefined {
  if (body[field] === undefined) {
    return undefined;
  }
  const value = body[field];
  if (typeof value !== "string" || !isIdOf(kind, value)) {
    issues.add(field, `expected a canonical ${kind === "source" ? "src_" : "evid_"} id`);
    return undefined;
  }
  return value;
}

export function parseObservationCreateBody(body: Record<string, unknown>): ObservationCreateInput {
  const issues = new IssueCollector();
  rejectUnknownFields(body, OBSERVATION_FIELDS, issues);

  const conceptCode = requireString(body, "conceptCode", issues, {
    min: 1,
    max: OBSERVATION_MAX_CONCEPT,
  });
  const value = parseObservationValueField(body, issues);
  const unit = requireString(body, "unit", issues, { min: 0, max: OBSERVATION_MAX_UNIT });
  const effectiveAt = parseTimestampField(body, "effectiveAt", issues);
  const observedAt = parseTimestampField(body, "observedAt", issues);
  const sourceId = parseCanonicalIdField(body, "sourceId", "source", issues);
  const methodId = requireString(body, "methodId", issues, {
    min: 1,
    max: OBSERVATION_MAX_METHOD,
  });

  const rawEvidenceLabel = body.evidenceLabel;
  let evidenceLabel: EvidenceLabel | undefined;
  if (typeof rawEvidenceLabel !== "string" || !isEvidenceLabel(rawEvidenceLabel)) {
    issues.add("evidenceLabel", `expected one of ${EVIDENCE_LABELS.join(" | ")}`);
  } else {
    evidenceLabel = rawEvidenceLabel;
  }

  const evidenceId = parseCanonicalIdField(body, "evidenceId", "evidence", issues);
  const quality = parseObservationQualityField(body, issues);

  if (issues.hasIssues) {
    throw issues.reject("Invalid observation creation request.");
  }

  return {
    conceptCode: conceptCode as string,
    value: value as ObservationValue,
    unit: unit as string,
    effectiveAt: effectiveAt as Date,
    observedAt: observedAt as Date,
    sourceId: sourceId as SourceId,
    methodId: methodId as string,
    evidenceLabel: evidenceLabel as EvidenceLabel,
    ...(evidenceId !== undefined ? { evidenceId: evidenceId as EvidenceId } : {}),
    ...(quality !== undefined ? { quality } : {}),
  };
}

// ---------------------------------------------------------------------------
// Path parameters (uniform 404 on malformed ids — existence secrecy).
// ---------------------------------------------------------------------------

/**
 * Parses a canonical path id. Malformed ids answer 404 — RECORDED
 * DECISION: a malformed id can never be the principal's own resource, so
 * it gets the same 404 as a foreign id (no grammar hints leaked, no
 * distinction between "malformed", "missing", and "foreign").
 */
export function parsePathId<K extends "intent" | "observation" | "evidence">(
  kind: K,
  raw: string | undefined,
): string {
  if (raw === undefined || !isIdOf(kind, raw)) {
    throw new ApiError("not-found", "The requested resource does not exist.");
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Query parameters (pagination + filters).
// ---------------------------------------------------------------------------

/** Pagination request parsed from query params (cursor validated by @orbb/db). */
export interface PageQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export function parsePageQuery(c: Context<ApiEnv>): PageQuery {
  const rawLimit = c.req.query("limit");
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    // Integer-parse only here: the 1..200 range lives in ONE place — the
    // @orbb/db clampPageLimit — and surfaces as a 400 envelope.
    const parsed = Number(rawLimit);
    if (rawLimit.length === 0 || !Number.isInteger(parsed)) {
      throw new ApiError(
        "invalid-request",
        "Invalid limit query parameter: expected an integer between 1 and 200.",
      );
    }
    limit = parsed;
  }
  const cursor = c.req.query("cursor");
  if (cursor !== undefined && cursor.length === 0) {
    throw new ApiError(
      "invalid-request",
      "Invalid cursor query parameter: expected an opaque cursor produced by this API.",
    );
  }
  return {
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** Optional `conceptCode` filter for GET /v1/observations. */
export function parseConceptCodeFilter(c: Context<ApiEnv>): string | undefined {
  const raw = c.req.query("conceptCode");
  if (raw === undefined) {
    return undefined;
  }
  if (raw.length === 0 || raw.length > OBSERVATION_MAX_CONCEPT) {
    throw new ApiError(
      "invalid-request",
      `Invalid conceptCode query parameter: expected 1 to ${OBSERVATION_MAX_CONCEPT} characters.`,
    );
  }
  return raw;
}
