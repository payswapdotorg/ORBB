// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type MediaListener = (event: { matches: boolean }) => void;

/** Installs a controllable `window.matchMedia` double (jsdom ships none). */
function installMatchMedia(initialMatches: boolean): {
  setMatches: (matches: boolean) => void;
} {
  const listeners = new Set<MediaListener>();
  let matches = initialMatches;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: MediaListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        listeners.delete(listener);
      },
      addListener: (listener: MediaListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: MediaListener) => {
        listeners.delete(listener);
      },
    })),
  );
  return {
    setMatches: (next: boolean) => {
      matches = next;
      for (const listener of listeners) {
        listener({ matches });
      }
    },
  };
}

describe("usePrefersReducedMotion", () => {
  it("reports false when matchMedia is unavailable (baseline jsdom)", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reports true when the media query matches", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the preference changes at runtime", () => {
    const { setMatches } = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      setMatches(false);
    });
    expect(result.current).toBe(false);
  });
});
