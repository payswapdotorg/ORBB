import { NextResponse } from "next/server";
import { TODAY_PERSON_ID } from "@/lib/today/catalog";
import {
  todayConfiguredPolicyVariant,
  todayDefaultPosture,
} from "@/lib/adherence/store";

/**
 * Adherence-posture route stub (M6 EXIT): `GET /api/today/adherence`
 * returns the journey-#7 restriction-posture surfaces:
 *   - `posture` — the DEFAULT observe-only posture (no policy configured;
 *     "nothing happens when you miss a measurement" is the loud truth);
 *   - `fixtureVariant` — the explicitly-labeled SYNTH configured-policy
 *     variant demonstrating the `restriction-authorized` vocabulary
 *     (explicit policy + authorization grant + bounded restriction).
 *
 * The decision fixtures mirror the B10 `EnforcementDecision` shapes with
 * the engine's audit step vocabulary; PHID-safe by construction (ids,
 * vocabulary, and field paths only — never values).
 *
 * Stub semantics (recorded): process-local derivation, no persistence,
 * no auth (single-person synthetic session) — the same stub level as
 * `/api/today`.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const now = new Date();
  return NextResponse.json({
    synthetic: true,
    personId: TODAY_PERSON_ID,
    posture: todayDefaultPosture(now),
    fixtureVariant: todayConfiguredPolicyVariant(now),
    generatedAt: now.toISOString(),
  });
}
