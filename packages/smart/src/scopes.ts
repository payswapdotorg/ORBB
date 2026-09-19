/**
 * The frozen SMART scope grammar for the ORBB launch boundary
 * (doctrine, docs/BACKEND_ARCHITECTURE.md §10: "SMART on FHIR launches
 * must use narrowly scoped OAuth authorization").
 *
 * The grammar is FROZEN and exact-match:
 *
 *   scope      := context "/" resourceType "." modifier
 *   context     = "patient"            (the ONLY context — see below)
 *   resourceType in SMART_SCOPE_RESOURCE_TYPES   (allow-list, case-sensitive)
 *   modifier    = "rs"                  (read + search — the ONLY modifier)
 *
 * Why each restriction is the narrowest safe choice (recorded):
 *   - Context prefix `patient/` ONLY. `user/` and `system/` (and their
 *     broader "all patients" semantics) are REJECTED outright: the M7 exit
 *     direction is "clinician can request authorized data and reason over
 *     a longitudinal patient timeline" — patient-scoped reads. Compartment
 *     widening is not part of this boundary.
 *   - Modifier set is the read-shaped `rs` = read + search (SMART v2
 *     compound modifier). Write-shaped letters (`c`, `u`, `d`, `s` and
 *     any combination containing them) are REJECTED: nothing in this
 *     boundary can express a write, so a malicious/typo'd scope string
 *     can never smuggle write intent into the launch.
 *   - Resource types are an allow-list of exactly the M7 clinical
 *     surface: `Patient`, `Observation`, `Condition`,
 *     `DocumentReference`. Unknown resource types are REJECTED (not
 *     best-effort ignored).
 *
 * Parsing is EXACT-MATCH: tokens are split on structural separators and
 * compared for equality against the frozen vocabularies. There is no
 * regex permissiveness, no trimming, no case folding — any deviation
 * lands in exactly one typed rejection class:
 *
 *   SCOPE_MALFORMED        structurally not `<context>/<rest>`
 *                          (empty token, no "/" separator, more than one
 *                          "/" after the context, or a second "." in the
 *                          modifier segment)
 *   SCOPE_MISSING_CONTEXT  no "/" separator at all (no context prefix)
 *   SCOPE_UNKNOWN_CONTEXT  context prefix present but != "patient"
 *   SCOPE_UNKNOWN_RESOURCE resource segment absent from the allow-list
 *                          (wrong case, misspelling, `*`, empty, …)
 *   SCOPE_UNKNOWN_MODIFIER modifier segment absent from the allow-list
 *                          (missing, empty, `rsd`, `c`, `s`, …)
 *
 * Scope SETS arrive as space-delimited strings (the SMART wire format).
 * The empty set ("" / whitespace-only) is VALID and grants nothing — it
 * is not an error. One invalid token rejects the whole set (fail-closed:
 * never a best-effort partial grant).
 *
 * No-echo discipline: rejection messages describe the grammar and the
 * violation class and may carry the failing token INDEX — never the raw
 * token (an adversarial scope string can embed arbitrary text; it must
 * never be propagated into logs by this package).
 */
import { SmartInvariantError } from "./errors.js";

// ---------------------------------------------------------------------------
// Frozen vocabularies.
// ---------------------------------------------------------------------------

/** The only legal context prefix. */
export const SMART_SCOPE_CONTEXT = "patient" as const;

/** Frozen resource-type allow-list (the M7 clinical surface). */
export const SMART_SCOPE_RESOURCE_TYPES = [
  "Patient",
  "Observation",
  "Condition",
  "DocumentReference",
] as const;

/** Frozen resource-type allow-list (the M7 clinical surface). */
export type SmartScopeResourceType = (typeof SMART_SCOPE_RESOURCE_TYPES)[number];

/** Frozen modifier allow-list — read-shaped only. */
export const SMART_SCOPE_MODIFIERS = ["rs"] as const;

/** Frozen modifier allow-list — read-shaped only. */
export type SmartScopeModifier = (typeof SMART_SCOPE_MODIFIERS)[number];

/** The access actions the modifier set can express. */
export const SMART_ACCESS_ACTIONS = ["read", "search"] as const;

/** The access actions the modifier set can express. */
export type SmartAccessAction = (typeof SMART_ACCESS_ACTIONS)[number];

/** Is `value` one of the frozen resource types (exact, case-sensitive)? */
export function isSmartScopeResourceType(value: string): value is SmartScopeResourceType {
  return (SMART_SCOPE_RESOURCE_TYPES as readonly string[]).includes(value);
}

/** Is `value` one of the frozen modifiers (exact)? */
export function isSmartScopeModifier(value: string): value is SmartScopeModifier {
  return (SMART_SCOPE_MODIFIERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Parsed scope shape + failure vocabulary.
// ---------------------------------------------------------------------------

/** One parsed, grammar-conforming SMART scope. */
export interface SmartScope {
  readonly resourceType: SmartScopeResourceType;
  readonly modifier: SmartScopeModifier;
}

/** Typed rejection classes for scope parsing. */
export const SCOPE_VALIDATION_REASONS = [
  "SCOPE_MALFORMED",
  "SCOPE_MISSING_CONTEXT",
  "SCOPE_UNKNOWN_CONTEXT",
  "SCOPE_UNKNOWN_RESOURCE",
  "SCOPE_UNKNOWN_MODIFIER",
] as const;

/** Typed rejection classes for scope parsing. */
export type ScopeValidationReason = (typeof SCOPE_VALIDATION_REASONS)[number];

/** The typed rejection for one scope token / scope set. Never thrown. */
export interface ScopeValidationFailure {
  readonly ok: false;
  readonly reason: ScopeValidationReason;
  /** Grammar description of the violation class — never the raw token. */
  readonly message: string;
  /** Index of the failing token within the space-delimited set (0-based). */
  readonly scopeIndex: number;
}

/** Result of parsing a single scope token. */
export type SmartScopeParseResult =
  | { readonly ok: true; readonly scope: SmartScope }
  | ScopeValidationFailure;

/** Result of parsing a space-delimited scope set. */
export type SmartScopeSetResult =
  | { readonly ok: true; readonly scopes: readonly SmartScope[] }
  | ScopeValidationFailure;

// ---------------------------------------------------------------------------
// Single-token parsing (exact-match grammar, no regexes).
// ---------------------------------------------------------------------------

function scopeFailure(
  reason: ScopeValidationReason,
  message: string,
  scopeIndex: number,
): ScopeValidationFailure {
  return { ok: false, reason, message, scopeIndex };
}

/**
 * Parses ONE scope token under the frozen grammar. Total: returns a typed
 * rejection for every non-conforming input; throws for a non-string
 * (programmer error — the wire format is a string).
 */
export function parseSmartScope(scope: string, scopeIndex = 0): SmartScopeParseResult {
  if (typeof scope !== "string") {
    throw new SmartInvariantError("parseSmartScope requires a string token.");
  }
  if (scope.length === 0) {
    return scopeFailure("SCOPE_MALFORMED", "empty scope token", scopeIndex);
  }
  const slashIndex = scope.indexOf("/");
  if (slashIndex < 0) {
    return scopeFailure(
      "SCOPE_MISSING_CONTEXT",
      'scope token has no context prefix: expected "patient/<ResourceType>.<modifier>"',
      scopeIndex,
    );
  }
  const context = scope.slice(0, slashIndex);
  const rest = scope.slice(slashIndex + 1);
  if (context !== SMART_SCOPE_CONTEXT) {
    return scopeFailure(
      "SCOPE_UNKNOWN_CONTEXT",
      'scope context prefix must be exactly "patient/"; broader contexts are rejected by doctrine',
      scopeIndex,
    );
  }
  if (rest.includes("/")) {
    return scopeFailure(
      "SCOPE_MALFORMED",
      'scope token has more than one "/": expected "patient/<ResourceType>.<modifier>"',
      scopeIndex,
    );
  }
  const dotIndex = rest.indexOf(".");
  if (dotIndex < 0) {
    return scopeFailure(
      "SCOPE_UNKNOWN_MODIFIER",
      'scope token has no modifier: expected a modifier from the frozen read-shaped set after the resource type',
      scopeIndex,
    );
  }
  const resourceType = rest.slice(0, dotIndex);
  const modifier = rest.slice(dotIndex + 1);
  if (modifier.includes(".")) {
    return scopeFailure(
      "SCOPE_MALFORMED",
      'scope token has more than one ".": expected "patient/<ResourceType>.<modifier>"',
      scopeIndex,
    );
  }
  if (!isSmartScopeResourceType(resourceType)) {
    return scopeFailure(
      "SCOPE_UNKNOWN_RESOURCE",
      "scope resource type is not in the frozen allow-list",
      scopeIndex,
    );
  }
  if (!isSmartScopeModifier(modifier)) {
    return scopeFailure(
      "SCOPE_UNKNOWN_MODIFIER",
      'scope modifier is not in the frozen read-shaped set ("rs")',
      scopeIndex,
    );
  }
  return { ok: true, scope: { resourceType, modifier } };
}

/** Formats a scope back to its canonical wire form `patient/<Type>.<modifier>`. */
export function formatSmartScope(scope: SmartScope): string {
  if (!isSmartScopeResourceType(scope.resourceType) || !isSmartScopeModifier(scope.modifier)) {
    throw new SmartInvariantError(
      "formatSmartScope requires a scope from the frozen vocabularies.",
    );
  }
  return `${SMART_SCOPE_CONTEXT}/${scope.resourceType}.${scope.modifier}`;
}

// ---------------------------------------------------------------------------
// Scope-set parsing (space-delimited SMART wire format).
// ---------------------------------------------------------------------------

/**
 * Parses a space-delimited SMART scope string into the deduplicated set
 * of grammar-conforming scopes (first occurrence wins, insertion order
 * preserved).
 *
 * The EMPTY SET is VALID: "" and whitespace-only strings parse to `[]`
 * and grant nothing — this is doctrine, not an oversight (a launch with
 * no scopes must be representable). ONE invalid token rejects the whole
 * set with that token's typed reason and index.
 */
export function parseSmartScopeSet(scopes: string): SmartScopeSetResult {
  if (typeof scopes !== "string") {
    throw new SmartInvariantError("parseSmartScopeSet requires a string.");
  }
  const tokens = scopes.split(" ").filter((token) => token.length > 0);
  const parsed: SmartScope[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      // Unreachable (filtered above); kept for noUncheckedIndexedAccess.
      return scopeFailure("SCOPE_MALFORMED", "empty scope token", index);
    }
    const result = parseSmartScope(token, index);
    if (!result.ok) {
      return result;
    }
    const key = formatSmartScope(result.scope);
    if (!seen.has(key)) {
      seen.add(key);
      parsed.push(result.scope);
    }
  }
  return { ok: true, scopes: parsed };
}

// ---------------------------------------------------------------------------
// Modifier semantics.
// ---------------------------------------------------------------------------

/**
 * Does `scope` cover `action`? `rs` = read + search, so both `read` and
 * `search` are covered today. The mapping is DATA-DRIVEN from the
 * modifier so a future frozen modifier (e.g. `r`) cannot silently widen
 * an existing one.
 */
export function scopeGrantsAction(scope: SmartScope, action: SmartAccessAction): boolean {
  if (!isSmartScopeResourceType(scope.resourceType) || !isSmartScopeModifier(scope.modifier)) {
    throw new SmartInvariantError("scopeGrantsAction requires a scope from the frozen vocabularies.");
  }
  return smartScopeActions(scope).includes(action);
}

/**
 * The access actions a scope's modifier covers (`rs` -> ["read",
 * "search"], in the frozen order).
 */
export function smartScopeActions(scope: SmartScope): readonly SmartAccessAction[] {
  if (!isSmartScopeResourceType(scope.resourceType) || !isSmartScopeModifier(scope.modifier)) {
    throw new SmartInvariantError("smartScopeActions requires a scope from the frozen vocabularies.");
  }
  // Recorded mapping — the ONLY place modifier letters gain meaning.
  const actionsByModifier: Record<SmartScopeModifier, readonly SmartAccessAction[]> = {
    rs: ["read", "search"],
  };
  return actionsByModifier[scope.modifier];
}
