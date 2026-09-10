/**
 * @orbb/auth — identity and access boundary package (M0).
 *
 * Future responsibility (architecture §2): owns sessions, passkeys, and
 * scoped tokens; authenticates persons and devices so every command and
 * query carries an authenticated actor for provenance.
 *
 * M0 boundary: no runtime behavior yet. Re-exports (type-only) the
 * identity principal types from @orbb/domain that this lane will own, so
 * downstream packages depend on @orbb/auth rather than reaching into
 * @orbb/domain directly.
 */
export type { DeviceId, PersonId } from "@orbb/domain";
