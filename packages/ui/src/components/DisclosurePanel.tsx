"use client";

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { color, focusRing, motion, spacing, touchTarget, typography } from "../tokens";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

export interface DisclosurePanelProps {
  /** Header row content (always visible). */
  title: ReactNode;
  /** Collapsible body content. */
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Called with the next open state on user toggle. */
  onOpenChange?: (open: boolean) => void;
  /** Disables the toggle button. */
  disabled?: boolean;
  /** Stable external id for the panel (used to derive header/body ids). */
  id?: string;
}

/**
 * Disclosure panel (M1-B): accordion-style header button plus collapsible
 * region, following the WAI-ARIA disclosure pattern.
 *
 * - The header is a native `<button>` (Enter/Space activation for free) with
 *   `aria-expanded` and `aria-controls`; the body region carries
 *   `role="region"` + `aria-labelledby` so screen readers announce the
 *   association both ways.
 * - Keyboard accessible by construction; the 44px minimum touch target
 *   applies to the header button.
 * - Opening animates a short fade/slide using `motion` tokens — skipped
 *   entirely (instant) under `prefers-reduced-motion: reduce`, and in
 *   environments without `requestAnimationFrame` (e.g. plain jsdom).
 *   Closing is always instant: the content is removed from the
 *   accessibility tree and the DOM immediately, which keeps screen-reader
 *   behavior predictable.
 * - Stacked panels share a hairline bottom border, forming an accordion
 *   without any grouping logic (each panel is independent).
 */
export function DisclosurePanel({
  title,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  id,
}: DisclosurePanelProps) {
  const generatedId = useId();
  const panelId = id ?? generatedId;
  const bodyId = `${panelId}-body`;
  const titleId = `${panelId}-title`;

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [entered, setEntered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const animateOpen = !prefersReducedMotion;

  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    if (!animateOpen || typeof requestAnimationFrame !== "function") {
      setEntered(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen, animateOpen]);

  const toggle = (): void => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const showEnterStyles = isOpen && !entered && animateOpen;

  return (
    <section
      id={panelId}
      style={{
        borderBottom: `1px solid ${color.borderSubtle}`,
      }}
    >
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          id={titleId}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          disabled={disabled}
          onClick={toggle}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: `${spacing[2]}px`,
            width: "100%",
            minHeight: `${touchTarget.minimum}px`,
            padding: `${spacing[3]}px ${spacing[1]}px`,
            backgroundColor: "transparent",
            border: "none",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            color: color.fgPrimary,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.md}px`,
            fontWeight: typography.weight.semibold,
            lineHeight: typography.lineHeight.normal,
            textAlign: "left",
            ...(isFocused
              ? {
                  outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
                  outlineOffset: `${focusRing.offset}px`,
                }
              : { outline: "none" }),
          }}
        >
          <span>{title}</span>
          <svg
            aria-hidden="true"
            focusable="false"
            width="12"
            height="8"
            viewBox="0 0 12 8"
            fill="none"
            style={{
              flexShrink: 0,
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: animateOpen
                ? `transform ${motion.duration.fast}ms ${motion.easing.standard}`
                : "none",
            }}
          >
            <path
              d="M1 1.5 6 6.5 11 1.5"
              stroke={color.fgMuted}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </h3>
      {isOpen ? (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={titleId}
          style={{
            padding: `${spacing[1]}px ${spacing[1]}px ${spacing[4]}px`,
            color: color.fgMuted,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.sm}px`,
            lineHeight: typography.lineHeight.relaxed,
            opacity: showEnterStyles ? 0 : 1,
            transform: showEnterStyles ? "translateY(-4px)" : "translateY(0)",
            transition:
              isOpen && animateOpen
                ? `opacity ${motion.duration.fast}ms ${motion.easing.standard}, transform ${motion.duration.fast}ms ${motion.easing.standard}`
                : "none",
          }}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
