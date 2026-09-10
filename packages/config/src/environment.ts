/**
 * Environment contracts for ORBB.
 *
 * Security rule (acceptance criterion): validation failures list variable
 * NAMES and generic reasons — secret values must never appear in error
 * messages. The zod layer is used for parsing only; its raw issue
 * messages (which can echo received values) are NEVER surfaced directly.
 * Every surfaced problem string is either a static template or built from
 * expected bounds/options, which are public schema metadata.
 *
 * Recorded assumptions:
 *   - Required variables in M0: NODE_ENV and LOG_LEVEL. Everything else
 *     is optional; DATABASE_URL additionally becomes required when
 *     NODE_ENV=production.
 *   - The wildcard families OBJECT_STORE_* and CACHE_* resolve to the
 *     concrete names below in M0 (endpoint/bucket/region/access key id/
 *     secret access key; cache url/ttl seconds).
 *   - Unknown variables are ignored (dotenv files routinely carry extras).
 *   - `parseEnvironment` is pure — it takes a raw record (e.g.
 *     `process.env`) rather than reading the environment itself.
 */
import { z } from "zod";

export const NODE_ENVS = ["development", "test", "production"] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Environment {
  readonly NODE_ENV: NodeEnv;
  readonly LOG_LEVEL: LogLevel;
  readonly DATABASE_URL?: string;
  readonly OBJECT_STORE_ENDPOINT?: string;
  readonly OBJECT_STORE_BUCKET?: string;
  readonly OBJECT_STORE_REGION?: string;
  readonly OBJECT_STORE_ACCESS_KEY_ID?: string;
  readonly OBJECT_STORE_SECRET_ACCESS_KEY?: string;
  readonly CACHE_URL?: string;
  readonly CACHE_TTL_SECONDS?: number;
  readonly API_PORT?: number;
}

/** Variables whose values must never appear in any diagnostic output. */
export const SECRET_ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "OBJECT_STORE_ACCESS_KEY_ID",
  "OBJECT_STORE_SECRET_ACCESS_KEY",
] as const;

/** One validation problem, described by variable name and reason only. */
export interface ConfigIssue {
  readonly variable: string;
  readonly problem: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(formatMessage(issues));
    this.name = "ConfigError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.issues = issues;
  }
}

function formatMessage(issues: readonly ConfigIssue[]): string {
  const details = issues.map((issue) => `${issue.variable} (${issue.problem})`).join("; ");
  return `Invalid environment configuration: ${details}`;
}

const nonEmptyString = z.string().min(1);
const portSchema = z.coerce.number().int().min(1).max(65535);
const ttlSecondsSchema = z.coerce.number().int().min(1);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS),
    LOG_LEVEL: z.enum(LOG_LEVELS),
    DATABASE_URL: nonEmptyString.optional(),
    OBJECT_STORE_ENDPOINT: nonEmptyString.optional(),
    OBJECT_STORE_BUCKET: nonEmptyString.optional(),
    OBJECT_STORE_REGION: nonEmptyString.optional(),
    OBJECT_STORE_ACCESS_KEY_ID: nonEmptyString.optional(),
    OBJECT_STORE_SECRET_ACCESS_KEY: nonEmptyString.optional(),
    CACHE_URL: nonEmptyString.optional(),
    CACHE_TTL_SECONDS: ttlSecondsSchema.optional(),
    API_PORT: portSchema.optional(),
  })
  .superRefine((environment, ctx) => {
    if (environment.NODE_ENV === "production" && environment.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "required when NODE_ENV is production",
      });
    }
  });

/**
 * Translates a zod issue into a value-free {@link ConfigIssue}.
 *
 * Only schema metadata (variable names, expected type names, expected
 * enum options, numeric bounds) is used. Fields like zod's
 * `invalid_enum_value.received` are deliberately ignored.
 */
function describeIssue(issue: z.ZodIssue): ConfigIssue {
  const variable = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  let problem: string;
  switch (issue.code) {
    case "invalid_type":
      problem =
        issue.received === "undefined" ? "is required" : `must be a valid ${issue.expected}`;
      break;
    case "invalid_enum_value":
      problem = `must be one of: ${issue.options.join(", ")}`;
      break;
    case "too_small":
      problem =
        issue.type === "string"
          ? "must be a non-empty string"
          : `must be at least ${String(issue.minimum)}`;
      break;
    case "too_big":
      problem = `must be at most ${String(issue.maximum)}`;
      break;
    case "custom":
      problem = issue.message;
      break;
    default:
      problem = "has an invalid value";
      break;
  }
  return { variable, problem };
}

/**
 * Validates a raw environment record and returns a frozen
 * {@link Environment}. Throws {@link ConfigError} naming the offending
 * variables — never their values.
 */
export function parseEnvironment(raw: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map(describeIssue));
  }
  return Object.freeze(result.data) as Environment;
}
