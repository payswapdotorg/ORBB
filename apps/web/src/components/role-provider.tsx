"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { Role } from "@/lib/roles";

/**
 * App-wide role state (M3-B).
 *
 * The M0 shell kept the selected role inside `SiteHeader`; mounting real
 * surfaces that must *react* to the emphasis model (DataBox, Measurements,
 * Care) requires pages to read the role too. Lifting the same state into a
 * client context keeps the header's DOM contract byte-identical (same
 * radios, same `data-emphasized` attributes, same live region) while
 * letting any surface consume the emphasis model.
 *
 * The initial role is `"person"` on both server and client renders, so
 * hydration output always matches.
 */

export interface RoleContextValue {
  /** Currently selected role. */
  readonly role: Role;
  /** Changes the selected role (drives nav + surface emphasis). */
  readonly setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("person");
  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

/** Reads the app-wide role state. Must be used inside `<RoleProvider>`. */
export function useRole(): RoleContextValue {
  const context = useContext(RoleContext);
  if (context === null) {
    throw new Error("useRole must be used inside <RoleProvider>.");
  }
  return context;
}
