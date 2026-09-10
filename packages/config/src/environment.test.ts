import { describe, expect, it } from "vitest";
import {
  ConfigError,
  NODE_ENVS,
  SECRET_ENVIRONMENT_VARIABLES,
  parseEnvironment,
  type Environment,
  type NodeEnv,
} from "./environment.js";

const DATABASE_URL_SECRET = "postgres://orbb-admin:SUPER-SECRET-PASSWORD@example.internal:5432/orbb";
const OBJECT_STORE_SECRET = "AKIA-DO-NOT-LEAK-ME";

function minimalRaw(): Record<string, string> {
  return { NODE_ENV: "test", LOG_LEVEL: "info" };
}

function captureConfigError(raw: Record<string, string | undefined>): ConfigError {
  try {
    parseEnvironment(raw);
  } catch (caught: unknown) {
    if (caught instanceof ConfigError) {
      return caught;
    }
  }
  throw new Error("expected parseEnvironment to throw a ConfigError");
}

describe("parseEnvironment", () => {
  it("parses a minimal valid environment", () => {
    const environment = parseEnvironment(minimalRaw());
    expect(environment.NODE_ENV).toBe("test");
    expect(environment.LOG_LEVEL).toBe("info");
    expect(environment.DATABASE_URL).toBeUndefined();
  });

  it("parses a fully populated environment", () => {
    const environment = parseEnvironment({
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      DATABASE_URL: "postgres://localhost:5432/orbb",
      OBJECT_STORE_ENDPOINT: "https://s3.example.internal",
      OBJECT_STORE_BUCKET: "orbb-evidence",
      OBJECT_STORE_REGION: "us-east-1",
      OBJECT_STORE_ACCESS_KEY_ID: "key-id",
      OBJECT_STORE_SECRET_ACCESS_KEY: "secret",
      CACHE_URL: "redis://localhost:6379/0",
      CACHE_TTL_SECONDS: "300",
      API_PORT: "3000",
    });
    expect(environment.NODE_ENV).toBe("production");
    expect(environment.OBJECT_STORE_BUCKET).toBe("orbb-evidence");
    expect(environment.CACHE_TTL_SECONDS).toBe(300);
    expect(environment.API_PORT).toBe(3000);
  });

  it("coerces numeric variables from strings", () => {
    const environment = parseEnvironment({
      ...minimalRaw(),
      API_PORT: "8080",
      CACHE_TTL_SECONDS: "60",
    });
    expect(environment.API_PORT).toBe(8080);
    expect(environment.CACHE_TTL_SECONDS).toBe(60);
  });

  it("ignores unknown variables", () => {
    const environment = parseEnvironment({ ...minimalRaw(), UNRELATED_FLAG: "1" });
    expect(environment.NODE_ENV).toBe("test");
  });

  it("returns a frozen environment", () => {
    const environment = parseEnvironment(minimalRaw());
    expect(Object.isFrozen(environment)).toBe(true);
    expect(() => {
      (environment as { NODE_ENV?: NodeEnv }).NODE_ENV = "production";
    }).toThrow(TypeError);
  });

  it("requires NODE_ENV and LOG_LEVEL by name", () => {
    const error = captureConfigError({});
    const variables = error.issues.map((issue) => issue.variable);
    expect(variables).toContain("NODE_ENV");
    expect(variables).toContain("LOG_LEVEL");
    expect(error.message).toContain("NODE_ENV");
    expect(error.message).toContain("LOG_LEVEL");
    expect([...NODE_ENVS]).toEqual(["development", "test", "production"]);
  });

  it("requires DATABASE_URL in production", () => {
    const error = captureConfigError({ NODE_ENV: "production", LOG_LEVEL: "info" });
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("required when NODE_ENV is production");
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        DATABASE_URL: "postgres://localhost:5432/orbb",
      }),
    ).not.toThrow();
  });

  it("rejects out-of-range ports and non-positive TTLs without echoing values", () => {
    const portError = captureConfigError({ ...minimalRaw(), API_PORT: "70000" });
    expect(portError.message).toContain("API_PORT");
    expect(portError.message).toContain("must be at most 65535");
    expect(portError.message).not.toContain("70000");

    const notANumber = captureConfigError({ ...minimalRaw(), API_PORT: "not-a-port" });
    expect(notANumber.message).toContain("API_PORT");
    expect(notANumber.message).not.toContain("not-a-port");

    const zeroTtl = captureConfigError({ ...minimalRaw(), CACHE_TTL_SECONDS: "0" });
    expect(zeroTtl.message).toContain("CACHE_TTL_SECONDS");
    expect(zeroTtl.message).toContain("must be at least 1");
  });

  it("rejects empty optional strings by name", () => {
    const error = captureConfigError({ ...minimalRaw(), DATABASE_URL: "" });
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("must be a non-empty string");
  });

  it("rejects invalid enum values by naming the legal options, not the value", () => {
    const nodeEnvError = captureConfigError({ NODE_ENV: "staging", LOG_LEVEL: "info" });
    expect(nodeEnvError.message).toContain("NODE_ENV");
    expect(nodeEnvError.message).toContain("development, test, production");
    expect(nodeEnvError.message).not.toContain("staging");

    const logLevelError = captureConfigError({ NODE_ENV: "test", LOG_LEVEL: "LOUD" });
    expect(logLevelError.message).toContain("LOG_LEVEL");
    expect(logLevelError.message).toContain("debug, info, warn, error");
    expect(logLevelError.message).not.toContain("LOUD");
  });

  it("never echoes secret values in error messages or serialized errors", () => {
    const error = captureConfigError({
      NODE_ENV: "staging",
      LOG_LEVEL: "info",
      DATABASE_URL: DATABASE_URL_SECRET,
      OBJECT_STORE_ACCESS_KEY_ID: "AKIA-NOT-IN-MESSAGES",
      OBJECT_STORE_SECRET_ACCESS_KEY: OBJECT_STORE_SECRET,
      API_PORT: "not-a-port",
    });
    const message = error.message;
    expect(message).toContain("NODE_ENV");
    expect(message).toContain("API_PORT");
    expect(message).not.toContain("SUPER-SECRET-PASSWORD");
    expect(message).not.toContain("orbb-admin");
    expect(message).not.toContain("AKIA-DO-NOT-LEAK-ME");
    expect(message).not.toContain("AKIA-NOT-IN-MESSAGES");
    expect(message).not.toContain("not-a-port");

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("SUPER-SECRET-PASSWORD");
    expect(serialized).not.toContain("orbb-admin");
    expect(serialized).not.toContain("AKIA-DO-NOT-LEAK-ME");
    expect(serialized).not.toContain("AKIA-NOT-IN-MESSAGES");
  });

  it("marks the sensitive variables explicitly", () => {
    expect([...SECRET_ENVIRONMENT_VARIABLES]).toEqual([
      "DATABASE_URL",
      "OBJECT_STORE_ACCESS_KEY_ID",
      "OBJECT_STORE_SECRET_ACCESS_KEY",
    ]);
  });

  it("typed environment satisfies the contract at compile time", () => {
    const environment: Environment = parseEnvironment(minimalRaw());
    const nodeEnv: NodeEnv = environment.NODE_ENV;
    expect(["development", "test", "production"]).toContain(nodeEnv);
  });
});
