/**
 * Auth logging wiring (architecture §6: no PHI through generic logs).
 *
 * Every log call in this package goes through the @orbb/observability
 * structured logger, whose deny-by-default redaction policy runs between
 * record construction and the sink: `personId`, `email`, `token`,
 * `credential`, `secret`… field names are redacted outright and
 * `accountId` is pseudonymized, so even a careless future field cannot
 * leak raw values to a sink.
 *
 * Discipline kept here regardless: log records carry only stable event
 * names, failure codes, and (when bound) the account id — never person
 * ids, emails, challenges, tokens, OTP codes, or recovery codes.
 */
import { createLogger, type Logger, type LogContext } from "@orbb/observability";

/**
 * Creates the auth-bound structured logger. Accepts correlation context
 * (only `LogValue` primitives — the redaction policy applies regardless).
 */
export function createAuthLogger(context?: LogContext): Logger {
  return createLogger({ service: "auth", ...context });
}

export type { Logger, LogContext };
