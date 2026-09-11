"use client";

import { useRole } from "./role-provider";
import { NAV_ITEM_LABELS, ROLE_LABELS, isEmphasized, type NavItem } from "@/lib/roles";

export interface RoleSurfaceNoticeProps {
  /** The surface this notice belongs to (a nav item id). */
  surface: NavItem;
}

/**
 * Emphasis-model integration for a mounted surface (M3-B).
 *
 * Renders an `aria-live="polite"` paragraph that announces when the active
 * surface becomes emphasized or de-emphasized for the selected role (the
 * Clinician role emphasizes Measurements/DataBox/Care). The paragraph
 * pre-exists with its initial message, so later content changes are
 * announced by assistive tech; `data-surface-emphasized` keeps the state
 * machine-checkable for Playwright.
 *
 * Status is never communicated by color alone: the message text is the
 * carrier, the `data-*` attribute is the machine contract.
 */
export function RoleSurfaceNotice({ surface }: RoleSurfaceNoticeProps) {
  const { role } = useRole();
  const emphasized = isEmphasized(surface, role);
  const message = emphasized
    ? `${NAV_ITEM_LABELS[surface]} is emphasized for the ${ROLE_LABELS[role]} role.`
    : `${NAV_ITEM_LABELS[surface]} is not emphasized for the ${ROLE_LABELS[role]} role.`;

  return (
    <p
      aria-live="polite"
      data-surface={surface}
      data-surface-emphasized={emphasized ? "true" : "false"}
      className="m-0 text-sm text-fg-muted"
    >
      {message}
    </p>
  );
}
