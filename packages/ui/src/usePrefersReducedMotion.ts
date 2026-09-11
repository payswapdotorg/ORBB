"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks the user's `prefers-reduced-motion: reduce` setting (M1-B).
 *
 * The token system's contract (`motion` in `tokens.ts`) requires consumers to
 * disable non-essential motion under reduced motion. The web shell's global
 * stylesheet covers CSS-driven motion, but components that animate through
 * inline styles need a runtime signal — this hook provides it, so the design
 * system honors the preference even outside the web shell.
 *
 * Implementation notes:
 * - `useSyncExternalStore` keeps this SSR-safe: the server snapshot is always
 *   `false` (motion allowed), so hydration output matches the server render;
 *   the client re-renders after hydration if the user prefers reduced motion.
 * - Environments without `matchMedia` (older jsdom, exotic runtimes) safely
 *   report `false`.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function supportsMatchMedia(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  );
}

function subscribe(onStoreChange: () => void): () => void {
  if (!supportsMatchMedia()) {
    return () => {};
  }
  const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQueryList.addEventListener("change", onStoreChange);
  return () => {
    mediaQueryList.removeEventListener("change", onStoreChange);
  };
}

function getSnapshot(): boolean {
  if (!supportsMatchMedia()) {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** Returns `true` while the user has expressed a preference for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
