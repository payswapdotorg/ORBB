/**
 * Mobile navigation model (frozen UI/UX architecture §Navigation model).
 *
 * Mobile uses a five-destination shell: `Today | Health | DataBox | Services
 * | You`. Icons are simple text glyphs (per M0-B scope: no icon dependency).
 * This module is pure data — no React Native imports — so it is unit-testable
 * in plain node (vitest) and reusable by the Maestro journey contract.
 */

export const TAB_KEYS = ["today", "health", "databox", "services", "you"] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export interface TabDefinition {
  /** Stable machine key (route name). */
  readonly key: TabKey;
  /** Human label — also the tab-bar label and the screen title. */
  readonly label: string;
  /** Simple text/emoji glyph used as the tab icon at M0. */
  readonly icon: string;
  /** One-line synthetic description of the future surface. */
  readonly note: string;
}

export const TABS: readonly TabDefinition[] = [
  {
    key: "today",
    label: "Today",
    icon: "☀️",
    note: "What you are trying to accomplish and what is due today.",
  },
  {
    key: "health",
    label: "Health",
    icon: "❤️",
    note: "Your intents, measurement plans, and observations.",
  },
  {
    key: "databox",
    label: "DataBox",
    icon: "🗄️",
    note: "Your personal health evidence store with provenance and sharing controls.",
  },
  {
    key: "services",
    label: "Services",
    icon: "🧰",
    note: "Measurement services, providers, and equipment.",
  },
  {
    key: "you",
    label: "You",
    icon: "👤",
    note: "Your profile, privacy, and consent settings.",
  },
];
