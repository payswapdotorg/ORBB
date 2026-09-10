"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  NAV_ITEMS,
  NAV_ITEM_LABELS,
  NAV_ITEM_ROUTES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLES,
  isEmphasized,
  type Role,
} from "@/lib/roles";

/**
 * Site header: brand, role switcher, and the primary navigation.
 *
 * The role switcher (Person | Clinician | Researcher | Developer) changes
 * which nav items are emphasized. Emphasis is exposed in the DOM via
 * `data-emphasized="true|false"` on each link, so the emphasis contract is
 * machine-checkable (Playwright + a11y tree), while visual emphasis uses
 * token-driven utilities (accent color + weight). Nav order is role-stable.
 */
export function SiteHeader() {
  const [role, setRole] = useState<Role>("person");
  const pathname = usePathname();

  return (
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            aria-label="ORBB home"
            className="rounded-card text-lead font-semibold tracking-tight text-fg"
          >
            ORBB
          </Link>

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Role</legend>
            <span aria-hidden="true" className="text-sm text-fg-muted">
              Role:
            </span>
            {ROLES.map((candidate) => (
              <label
                key={candidate}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-card border border-border-subtle bg-canvas px-3 text-sm text-fg-muted transition-colors has-checked:border-accent has-checked:bg-accent-subtle has-checked:font-medium has-checked:text-accent"
              >
                <input
                  type="radio"
                  name="orbb-role"
                  value={candidate}
                  checked={role === candidate}
                  onChange={() => {
                    setRole(candidate);
                  }}
                  className="size-4 accent-accent"
                />
                <span>{ROLE_LABELS[candidate]}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <p aria-live="polite" className="sr-only">
          {`Navigation emphasis updated for ${ROLE_LABELS[role]}. ${ROLE_DESCRIPTIONS[role]}`}
        </p>

        <nav aria-label="Primary" className="mt-4">
          <ul className="flex flex-wrap gap-1">
            {NAV_ITEMS.map((item) => {
              const href = NAV_ITEM_ROUTES[item];
              const active = pathname === href;
              const emphasized = isEmphasized(item, role);
              return (
                <li key={item}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-emphasized={emphasized ? "true" : "false"}
                    className={[
                      "flex min-h-[44px] items-center rounded-card px-3 text-sm transition-colors",
                      emphasized
                        ? "font-medium text-accent underline decoration-accent decoration-2 underline-offset-4"
                        : "text-fg-muted hover:text-fg",
                      active ? "bg-accent-subtle" : "hover:bg-canvas",
                    ].join(" ")}
                  >
                    {NAV_ITEM_LABELS[item]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
