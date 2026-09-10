/**
 * Web hosting adapter (architecture provider map: Web → Vercel → WebHost).
 *
 * Owns preview deployments / CDN / edge for the Next.js web app. The
 * interface is provider-neutral: a Vercel implementation lands with the
 * deployment lane; local development uses `next dev` on Node and never
 * goes through this interface.
 */
import type { EnvironmentName } from "./environments.js";

/** Input for deploying a web app build. */
export interface WebHostDeployInput {
  /** Workspace-relative directory of the web app (e.g. "apps/web"). */
  readonly projectDir: string;
  /** Target environment for the deployment. */
  readonly environment: EnvironmentName;
  /** Commit being deployed (traceability; never a secret). */
  readonly commitSha: string;
}

/** Result metadata for a completed web deployment. */
export interface WebHostDeployment {
  readonly id: string;
  /** Preview or production URL of the deployment. */
  readonly url: string;
  readonly environment: EnvironmentName;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
}

/**
 * Replacement interface for the Web concern.
 *
 * Provider default: Vercel (preview deployments, CDN, edge). Paid or
 * regulated-capable equivalents are substitutable without domain changes.
 */
export interface WebHost {
  deploy(input: WebHostDeployInput): Promise<WebHostDeployment>;
}
