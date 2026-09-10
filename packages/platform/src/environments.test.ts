import { describe, expect, it } from "vitest";
import {
  CONCERN_REPLACEMENT_INTERFACES,
  ENVIRONMENTS,
  ENVIRONMENT_NAMES,
  INFRASTRUCTURE_CONCERNS,
  environmentSpec,
  providerFor,
  type EnvironmentSpec,
} from "./environments.js";

describe("environment matrix", () => {
  it("defines exactly the four documented environments", () => {
    expect(ENVIRONMENTS.map((spec) => spec.name)).toEqual([...ENVIRONMENT_NAMES]);
  });

  it("binds every infrastructure concern exactly once per environment", () => {
    for (const spec of ENVIRONMENTS) {
      const concerns = spec.bindings.map((item) => item.concern);
      expect(concerns).toEqual([...INFRASTRUCTURE_CONCERNS]);
    }
  });

  it("maps every concern to its replacement interface", () => {
    for (const spec of ENVIRONMENTS) {
      for (const item of spec.bindings) {
        expect(item.replacementInterface).toBe(CONCERN_REPLACEMENT_INTERFACES[item.concern]);
      }
    }
  });

  it("never uses the in-memory provider outside local", () => {
    for (const spec of ENVIRONMENTS) {
      if (spec.name === "local") {
        continue;
      }
      for (const item of spec.bindings) {
        expect(item.provider).not.toBe("in-memory");
      }
    }
  });

  it("restricts the in-memory provider to cache and rate limits locally", () => {
    for (const item of environmentSpec("local").bindings) {
      if (item.provider === "in-memory") {
        expect(item.concern === "cache" || item.concern === "rateLimits").toBe(true);
      }
    }
  });

  it("pins the documented defaults for preview, staging, and production", () => {
    for (const name of ["preview", "staging", "production"] as const) {
      const spec = environmentSpec(name);
      expect(spec.name).toBe(name);
      expect(providerFor(name, "web")).toBe("vercel");
      expect(providerFor(name, "api")).toBe("cloudflare-workers");
      expect(providerFor(name, "events")).toBe("cloudflare-queues");
      expect(providerFor(name, "jobs")).toBe("cloudflare-queues");
      expect(providerFor(name, "objectData")).toBe("cloudflare-r2");
      expect(providerFor(name, "relational")).toBe("neon-postgres");
      expect(providerFor(name, "cache")).toBe("upstash-redis");
      expect(providerFor(name, "rateLimits")).toBe("upstash-redis");
    }
  });

  it("uses local-friendly providers for local", () => {
    expect(providerFor("local", "web")).toBe("node");
    expect(providerFor("local", "api")).toBe("cloudflare-workers");
    expect(providerFor("local", "events")).toBe("cloudflare-queues");
    expect(providerFor("local", "jobs")).toBe("cloudflare-queues");
    expect(providerFor("local", "objectData")).toBe("cloudflare-r2");
    expect(providerFor("local", "relational")).toBe("docker-postgres");
    expect(providerFor("local", "cache")).toBe("in-memory");
    expect(providerFor("local", "rateLimits")).toBe("in-memory");
  });

  it("documents every environment with notes", () => {
    for (const spec of ENVIRONMENTS) {
      expect(spec.notes.length).toBeGreaterThan(0);
    }
  });

  it("environmentSpec returns the typed spec for every environment", () => {
    for (const name of ENVIRONMENT_NAMES) {
      const spec: EnvironmentSpec = environmentSpec(name);
      expect(spec.bindings).toHaveLength(INFRASTRUCTURE_CONCERNS.length);
    }
  });
});
