/**
 * Relational store adapter (architecture provider map: Relational → Neon
 * PostgreSQL → SqlStore).
 *
 * Every domain mutation runs inside a transaction that writes domain
 * state plus an outbox event (architecture §4). Statements are always
 * parameterized (`$1`, `$2`, …) — values are never interpolated into SQL
 * text. Migration safety (expand/contract) is owned by the persistence
 * lane, not by this interface.
 */

/**
 * A parameterized SQL statement. `text` contains placeholders only —
 * never values.
 */
export interface SqlStatement {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

/** Summary of a non-query execution. */
export interface SqlResultSummary {
  readonly affectedRows: number;
}

/** Read/execute surface available both on the store and inside transactions. */
export interface SqlExecutor {
  /** Runs a query and returns the rows. Row shape is asserted by the caller. */
  query<Row = Record<string, unknown>>(statement: SqlStatement): Promise<readonly Row[]>;
  execute(statement: SqlStatement): Promise<SqlResultSummary>;
}

/** Executor scoped to one transaction; commit/rollback is store-owned. */
export type SqlTransaction = SqlExecutor;

/**
 * Replacement interface for the relational concern.
 *
 * Provider default: Neon PostgreSQL (branching, scale-to-zero). There is
 * deliberately NO in-memory implementation at M0 — unit and contract tests
 * never require a database or credentials.
 */
export interface SqlStore extends SqlExecutor {
  /**
   * Runs `work` inside a transaction: commits when it resolves, rolls
   * back when it rejects.
   */
  transaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T>;
}
