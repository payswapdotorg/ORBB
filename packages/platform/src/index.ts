/**
 * @orbb/platform — deployment adapter interfaces and environment matrix.
 *
 * Pure TypeScript over the frozen `@orbb/domain` contracts and the
 * `@orbb/observability` logger: no provider SDK imports. Interfaces
 * mirror the frozen architecture provider map (Web → WebHost, API/edge →
 * HttpRuntime, Async → EventBus/JobRunner, Object data → ObjectStore,
 * Relational → SqlStore, Cache/Rate limits → Cache/RateLimiter). The
 * environment matrix (local / preview / staging / production) is typed
 * data. In-memory reference implementations exist ONLY for Cache and
 * RateLimiter — plus the device-source health seam (A32/A34/A35, Lane C
 * packet M4-C): MeasurementSourceRegistry + DeviceSourceAdapter +
 * HealthKit/Health Connect seams + the M4 exit harness scaffolding,
 * which consume the domain types and the observability logger (workspace
 * dependencies only).
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
export * from "./health/index.js";
