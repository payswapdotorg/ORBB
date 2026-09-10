/**
 * Web navigation model (frozen UI/UX architecture §Navigation model).
 *
 * Web uses: `Overview | Intents | Measurements | DataBox | Care | Research |
 * Marketplace | Settings` with role-dependent emphasis. At M0 no role adds or
 * removes items — emphasis is a visual affordance marking which surfaces the
 * active role works in most (Person: consumer core; Clinician: care &
 * measurement; Researcher: research; Developer: marketplace/extensions).
 */

export const NAV_ITEMS = [
  "overview",
  "intents",
  "measurements",
  "databox",
  "care",
  "research",
  "marketplace",
  "settings",
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

export const NAV_ITEM_LABELS: Record<NavItem, string> = {
  overview: "Overview",
  intents: "Intents",
  measurements: "Measurements",
  databox: "DataBox",
  care: "Care",
  research: "Research",
  marketplace: "Marketplace",
  settings: "Settings",
};

export const NAV_ITEM_ROUTES: Record<NavItem, string> = {
  overview: "/",
  intents: "/intents",
  measurements: "/measurements",
  databox: "/databox",
  care: "/care",
  research: "/research",
  marketplace: "/marketplace",
  settings: "/settings",
};

export const ROLES = ["person", "clinician", "researcher", "developer"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  person: "Person",
  clinician: "Clinician",
  researcher: "Researcher",
  developer: "Developer",
};

/** Short synthetic descriptions of what each role emphasizes (placeholder copy, no domain data). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  person: "Emphasizes the consumer core: overview, intents, measurements, and your DataBox.",
  clinician: "Emphasizes care surfaces, measurements, and shared data.",
  researcher: "Emphasizes research surfaces, measurement data, and your DataBox.",
  developer: "Emphasizes the marketplace, settings, and DataBox surfaces.",
};

/** Nav items emphasized per role. Order within the nav never changes. */
export const ROLE_EMPHASIS: Record<Role, readonly NavItem[]> = {
  person: ["overview", "intents", "measurements", "databox"],
  clinician: ["measurements", "databox", "care"],
  researcher: ["measurements", "databox", "research"],
  developer: ["databox", "marketplace", "settings"],
};

export function isEmphasized(item: NavItem, role: Role): boolean {
  return ROLE_EMPHASIS[role].includes(item);
}

/** Returns the emphasized nav items in canonical nav order (stable for the DOM). */
export function emphasizedItems(role: Role): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => isEmphasized(item, role));
}
