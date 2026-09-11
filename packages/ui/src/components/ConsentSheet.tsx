"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Button } from "./Button";
import { color, elevation, focusRing, motion, radius, spacing, touchTarget, typography } from "../tokens";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

export interface ConsentSheetProps {
  /** Controlled visibility. */
  open: boolean;
  /** Called when the user dismisses the sheet (Escape, backdrop, close button). */
  onClose: () => void;
  /** Sheet title (rendered as the dialog's heading). */
  title: ReactNode;
  /** Purpose block content (the "why" of the request). */
  purpose?: ReactNode;
  /** Scope list items (the exact data covered). */
  scope?: readonly string[];
  /** Expiry row content (when the grant ends). */
  expiry?: ReactNode;
  /** Called when the confirm action is activated. */
  onConfirm?: () => void;
  /** Called when the revoke action is activated. */
  onRevoke?: () => void;
  /** Confirm button label. Defaults to `"Confirm"`. */
  confirmLabel?: string;
  /** Revoke button label. Defaults to `"Revoke"`. */
  revokeLabel?: string;
  /** Accessible label for the close button. Defaults to `"Close"`. */
  closeLabel?: string;
  /** Section label for the purpose block. Defaults to `"Purpose"`. */
  purposeLabel?: string;
  /** Section label for the scope list. Defaults to `"Scope"`. */
  scopeLabel?: string;
  /** Section label for the expiry row. Defaults to `"Expiry"`. */
  expiryLabel?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * ConsentSheet primitive (M1-B): a controlled, bottom-anchored dialog shell
 * for consent review flows — title, purpose block, scope list, expiry row
 * and Confirm/Revoke actions.
 *
 * Purely presentational: no consent state, no logic. Confirm/Revoke merely
 * invoke callbacks (both action buttons render unconditionally — the shell's
 * structure stays complete even when a handler is not yet wired); closing is
 * always the caller's decision (onClose fires for the dismiss affordances
 * the shell itself owns: Escape, backdrop click and the close button).
 *
 * Accessibility (WAI-ARIA modal dialog pattern):
 * - `role="dialog"` + `aria-modal="true"`, named by the title heading and
 *   described by the purpose block;
 * - focus moves into the sheet when it opens and returns to the previously
 *   focused element when it closes;
 * - Tab/Shift+Tab are trapped within the sheet; Escape closes it;
 * - body scrolling is locked while open and restored afterwards;
 * - the enter animation (sheet slide-up + scrim fade, `motion` tokens) is
 *   skipped under `prefers-reduced-motion: reduce` and in environments
 *   without `requestAnimationFrame`; exit is always instant;
 * - action buttons reuse the `Button` primitive (44px touch targets,
 *   token focus rings).
 *
 * Rendered through a portal attached to `document.body` so overlay
 * positioning is independent of the host DOM. Server rendering with
 * `open: true` is not supported (nothing is rendered on the server).
 */
export function ConsentSheet({
  open,
  onClose,
  title,
  purpose,
  scope,
  expiry,
  onConfirm,
  onRevoke,
  confirmLabel = "Confirm",
  revokeLabel = "Revoke",
  closeLabel = "Close",
  purposeLabel = "Purpose",
  scopeLabel = "Scope",
  expiryLabel = "Expiry",
}: ConsentSheetProps) {
  const sheetId = useId();
  const titleId = `${sheetId}-title`;
  const purposeId = `${sheetId}-purpose`;

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [entered, setEntered] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const animateEnter = !prefersReducedMotion;

  // Enter transition: start off-screen, settle on the next frame.
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    if (!animateEnter || typeof requestAnimationFrame !== "function") {
      setEntered(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, animateEnter]);

  // Move focus into the sheet on open; restore it on close/unmount.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  // Lock body scrolling while the modal is open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const container = sheetRef.current;
    if (container === null) {
      return;
    }
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const showEnterStyles = !entered && animateEnter;

  return createPortal(
    <div>
      <div
        aria-hidden="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
          backgroundColor: "rgba(28, 34, 31, 0.4)",
          opacity: showEnterStyles ? 0 : 1,
          transition: animateEnter
            ? `opacity ${motion.duration.base}ms ${motion.easing.standard}`
            : "none",
        }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={purpose !== undefined ? purposeId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          zIndex: 1000,
          bottom: 0,
          left: 0,
          right: 0,
          margin: "0 auto",
          maxWidth: "560px",
          maxHeight: "85vh",
          overflowY: "auto",
          backgroundColor: color.surfaceRaised,
          borderRadius: `${radius.xl}px ${radius.xl}px ${radius.none}px ${radius.none}px`,
          boxShadow: elevation[3],
          padding: `${spacing[5]}px`,
          transform: showEnterStyles ? "translateY(100%)" : "translateY(0)",
          transition: animateEnter
            ? `transform ${motion.duration.base}ms ${motion.easing.emphasized}`
            : "none",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: `${spacing[3]}px`,
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: 0,
              color: color.fgPrimary,
              fontFamily: typography.family.sans,
              fontSize: `${typography.size.lg}px`,
              fontWeight: typography.weight.semibold,
              lineHeight: typography.lineHeight.tight,
            }}
          >
            {title}
          </h2>
          <CloseButton label={closeLabel} onClick={onClose} />
        </div>

        {purpose !== undefined ? (
          <section
            id={purposeId}
            style={{
              marginTop: `${spacing[4]}px`,
              padding: `${spacing[3]}px`,
              backgroundColor: color.canvas,
              border: `1px solid ${color.borderSubtle}`,
              borderRadius: `${radius.md}px`,
            }}
          >
            <SectionLabel>{purposeLabel}</SectionLabel>
            <div
              style={{
                color: color.fgPrimary,
                fontFamily: typography.family.sans,
                fontSize: `${typography.size.sm}px`,
                lineHeight: typography.lineHeight.relaxed,
              }}
            >
              {purpose}
            </div>
          </section>
        ) : null}

        {scope !== undefined && scope.length > 0 ? (
          <section style={{ marginTop: `${spacing[4]}px` }}>
            <SectionLabel>{scopeLabel}</SectionLabel>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: `${spacing[1]}px`,
              }}
            >
              {scope.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: `${spacing[2]}px`,
                    color: color.fgPrimary,
                    fontFamily: typography.family.sans,
                    fontSize: `${typography.size.sm}px`,
                    lineHeight: typography.lineHeight.normal,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: "6px",
                      height: "6px",
                      marginTop: "7px",
                      borderRadius: `${radius.pill}px`,
                      backgroundColor: color.accent,
                    }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {expiry !== undefined ? (
          <section
            style={{
              marginTop: `${spacing[4]}px`,
              paddingTop: `${spacing[3]}px`,
              borderTop: `1px solid ${color.borderSubtle}`,
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: `${spacing[3]}px`,
            }}
          >
            <SectionLabel>{expiryLabel}</SectionLabel>
            <span
              style={{
                color: color.fgPrimary,
                fontFamily: typography.family.sans,
                fontSize: `${typography.size.sm}px`,
                fontWeight: typography.weight.medium,
                lineHeight: typography.lineHeight.normal,
              }}
            >
              {expiry}
            </span>
          </section>
        ) : null}

        <div
          style={{
            marginTop: `${spacing[5]}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: `${spacing[3]}px`,
          }}
        >
          <Button variant="secondary" onClick={onRevoke}>
            {revokeLabel}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <p
      style={{
        margin: 0,
        marginBottom: `${spacing[1]}px`,
        color: color.fgMuted,
        fontFamily: typography.family.sans,
        fontSize: `${typography.size.xs}px`,
        fontWeight: typography.weight.semibold,
        letterSpacing: "0.04em",
        lineHeight: typography.lineHeight.normal,
        textTransform: "uppercase",
      }}
    >
      {children}
    </p>
  );
}

interface CloseButtonProps {
  label: string;
  onClick: () => void;
}

function CloseButton({ label, onClick }: CloseButtonProps): ReactNode {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onFocus={() => {
        setIsFocused(true);
      }}
      onBlur={() => {
        setIsFocused(false);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: `${touchTarget.minimum}px`,
        height: `${touchTarget.minimum}px`,
        backgroundColor: "transparent",
        border: "none",
        borderRadius: `${radius.sm}px`,
        cursor: "pointer",
        color: color.fgMuted,
        fontFamily: typography.family.sans,
        fontSize: `${typography.size.lg}px`,
        lineHeight: 1,
        ...(isFocused
          ? {
              outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
              outlineOffset: `${focusRing.offset}px`,
            }
          : { outline: "none" }),
      }}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
