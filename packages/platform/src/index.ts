/**
 * @orbb/platform — deployment adapter interfaces and environment matrix.
 *
 * Pure TypeScript: zero runtime dependencies, no provider SDK imports.
 * Interfaces mirror the frozen architecture provider map (Web → WebHost,
 * API/edge → HttpRuntime, Async → EventBus/JobRunner, Object data →
 * ObjectStore, Relational → SqlStore, Cache/Rate limits →
 * Cache/RateLimiter). The environment matrix (local / preview / staging /
 * production) is typed data. In-memory reference implementations exist
 * ONLY for Cache and RateLimiter.
 */
export * from "./webhost.js";
export * from "./httpruntime.js";
export * from "./events.js";
export * from "./objectstore.js";
export * from "./sqlstore.js";
export * from "./cache.js";
export * from "./ratelimiter.js";
export * from "./environments.js";
export * from "./inmemory.js";
