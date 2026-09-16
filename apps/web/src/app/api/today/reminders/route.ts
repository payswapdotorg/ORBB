import { NextResponse } from "next/server";
import { TODAY_PERSON_ID } from "@/lib/today/catalog";
import { listTodayReminders, todayQuietHoursLabel } from "@/lib/reminders/store";

/**
 * Reminder-surface route stub (M6 EXIT): `GET /api/today/reminders`
 * returns the journey-#7 reminder chain for the session — the ladder
 * state per open task (rung REMIND while a window is upcoming, rung
 * REMIND_WITH_FALLBACK_OFFER once missed; completed tasks never remind),
 * with quiet-hours deferral shown honestly (defer, never drop).
 *
 * The payload is derived deterministically from the seeded today task
 * records under the mirrored B8 schedule semantics (see
 * `lib/reminders/store.ts`); every reminder is PHI-free (ids + labels
 * only — the B8 payload contract).
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
    reminders: listTodayReminders(now),
    quietHoursLabel: todayQuietHoursLabel(),
    generatedAt: now.toISOString(),
  });
}
