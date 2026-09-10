/**
 * @orbb/config — environment/config contracts for ORBB.
 *
 * Validates required variables without exposing secret values. The only
 * ORBB package allowed to depend on zod; no provider SDK types appear
 * here.
 */
export * from "./environment.js";
