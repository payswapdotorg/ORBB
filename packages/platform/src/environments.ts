/**
 * Environment matrix for ORBB (docs/DEPLOYMENT_ARCHITECTURE.md), as typed
 * data: one entry per environment (local / preview / staging / production)
 * with the provider default for each infrastructure concern and the
 * replacement interface that concern maps to.
 *
 * Invariants (asserted by unit tests):
 *   - exactly the four documented environments exist;
 *   - every environment binds every concern exactly once, in canonical
 *     concern order;
 *   - every binding's replacement interface matches
 *     {@link CONCERN_REPLACEMENT_INTERFACES};
 *   - the `in-memory` provider is used only by `local`, and only for the
 *     cache and rate-limit concerns (where the reference in-memory
 *     implementations exist);
 *   - preview / staging / production use the documented platform defaults
 *     (Vercel, Cloudflare Workers/Queues/R2, Neon, Upstash) — production
 *     on separate accounts with regulated-capable equivalents substitutable
 *     without domain changes.
 */

/** The four documented ORBB environments. */
export const ENVIRONMENT_NAMES = ["local", "preview", "staging", "production"] as const;

export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

/** Infrastructure concerns derived from the architecture provider map. */
export const INFRASTRUCTURE_CONCERNS = [
  "web",
  "api",
  "events",
  "jobs",
  "objectData",
  "relational",
  "cache",
  "rateLimits",
] as const;

export type InfrastructureConcern = (typeof INFRASTRUCTURE_CONCERNS)[number];

/** Concrete providers named by the matrix (typed data — never SDK types). */
export type ProviderName =
  | "node"
  | "docker-postgres"
  | "in-memory"
  | "vercel"
  | "cloudflare-workers"
  | "cloudflare-queues"
  | "cloudflare-r2"
  | "neon-postgres"
  | "upstash-redis";

/** Replacement interfaces from this package (one per concern). */
export type ReplacementInterface =
  | "WebHost"
  | "HttpRuntime"
  | "EventBus"
  | "JobRunner"
  | "ObjectStore"
  | "SqlStore"
  | "Cache"
  | "RateLimiter";

/** Canonical mapping of concern → replacement interface. */
export const CONCERN_REPLACEMENT_INTERFACES = {
  web: "WebHost",
  api: "HttpRuntime",
  events: "EventBus",
  jobs: "JobRunner",
  objectData: "ObjectStore",
  relational: "SqlStore",
  cache: "Cache",
  rateLimits: "RateLimiter",
} as const satisfies Record<InfrastructureConcern, ReplacementInterface>;

/** One concern's provider default and its replacement interface. */
export interface ProviderBinding {
  readonly concern: InfrastructureConcern;
  readonly provider: ProviderName;
  readonly replacementInterface: ReplacementInterface;
}

/** One environment's complete provider matrix. */
export interface EnvironmentSpec {
  readonly name: EnvironmentName;
  /** Every concern exactly once, in canonical concern order. */
  readonly bindings: readonly ProviderBinding[];
  readonly notes: string;
}

function binding(
  concern: InfrastructureConcern,
  provider: ProviderName,
): ProviderBinding {
  return { concern, provider, replacementInterface: CONCERN_REPLACEMENT_INTERFACES[concern] };
}

/** The environment matrix itself (typed, frozen data). */
export const ENVIRONMENTS: readonly EnvironmentSpec[] = [
  {
    name: "local",
    bindings: [
      binding("web", "node"),
      binding("api", "cloudflare-workers"),
      binding("events", "cloudflare-queues"),
      binding("jobs", "cloudflare-queues"),
      binding("objectData", "cloudflare-r2"),
      binding("relational", "docker-postgres"),
      binding("cache", "in-memory"),
      binding("rateLimits", "in-memory"),
    ],
    notes:
      "Docker/Node-compatible development; wrangler dev simulates Workers/Queues/R2 locally. " +
      "The cache and rate limiter use the in-memory reference implementations so unit and " +
      "contract tests never require credentials. Synthetic health data only — never real patient data.",
  },
  {
    name: "preview",
    bindings: [
      binding("web", "vercel"),
      binding("api", "cloudflare-workers"),
      binding("events", "cloudflare-queues"),
      binding("jobs", "cloudflare-queues"),
      binding("objectData", "cloudflare-r2"),
      binding("relational", "neon-postgres"),
      binding("cache", "upstash-redis"),
      binding("rateLimits", "upstash-redis"),
    ],
    notes:
      "Per-branch preview: Vercel web preview + isolated Neon branch + test R2 namespace + " +
      "test Upstash namespace. Never use production patient data in preview.",
  },
  {
    name: "staging",
    bindings: [
      binding("web", "vercel"),
      binding("api", "cloudflare-workers"),
      binding("events", "cloudflare-queues"),
      binding("jobs", "cloudflare-queues"),
      binding("objectData", "cloudflare-r2"),
      binding("relational", "neon-postgres"),
      binding("cache", "upstash-redis"),
      binding("rateLimits", "upstash-redis"),
    ],
    notes:
      "Stable staging: Cloudflare Worker/API, Neon project/branch, R2 bucket, queue set, " +
      "Expo development build (mobile build provider concern lands with the mobile lane).",
  },
  {
    name: "production",
    bindings: [
      binding("web", "vercel"),
      binding("api", "cloudflare-workers"),
      binding("events", "cloudflare-queues"),
      binding("jobs", "cloudflare-queues"),
      binding("objectData", "cloudflare-r2"),
      binding("relational", "neon-postgres"),
      binding("cache", "upstash-redis"),
      binding("rateLimits", "upstash-redis"),
    ],
    notes:
      "Separate accounts/projects/buckets/keys. Paid or regulated-capable equivalents can be " +
      "substituted without domain changes by re-implementing the replacement interfaces.",
  },
] as const;

/**
 * Looks up the environment spec by name. `name` is typed as
 * {@link EnvironmentName}, so misspellings are compile-time errors; the
 * runtime guard protects JavaScript consumers.
 */
export function environmentSpec(name: EnvironmentName): EnvironmentSpec {
  const spec = ENVIRONMENTS.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    throw new RangeError(`Unknown environment: expected one of ${ENVIRONMENT_NAMES.join(", ")}.`);
  }
  return spec;
}

/** Looks up the provider bound to a concern in an environment. */
export function providerFor(
  environment: EnvironmentName,
  concern: InfrastructureConcern,
): ProviderName {
  const match = environmentSpec(environment).bindings.find((item) => item.concern === concern);
  if (match === undefined) {
    throw new RangeError(
      `No provider binding for concern "${concern}" in environment "${environment}".`,
    );
  }
  return match.provider;
}
