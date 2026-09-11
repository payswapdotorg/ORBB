"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type"> {
  /** Visible checkbox label (wraps the control, so it is also the touch target). */
  label: ReactNode;
  /** Supporting hint wired via `aria-describedby`. */
  hint?: ReactNode;
  /** Error message; presence sets `aria-invalid` and the danger border. */
  error?: ReactNode;
  /** Marks the checkbox required (asterisk + `aria-required`). */
  required?: boolean;
}

/**
 * Checkbox primitive (M1-B): a complete, self-labeled accessible unit.
 *
 * - The wrapping `<label>` guarantees a >= 44px touch target and native
 *   click-to-toggle behavior (WCAG 2.5.8 target size, comfortably above).
 * - The native input stays in the accessibility tree and focus order but is
 *   visually replaced by a token-styled box; the custom check glyph and the
 *   state (`checked`) are never communicated by color alone (WCAG 1.4.1).
 * - Uncontrolled usage (`defaultChecked`) re-renders through internal state
 *   so the custom glyph tracks native toggling (keyboard included).
 * - Focus ring drawn from `focusRing` tokens on the visual box via focus
 *   events (inline styles cannot express `:focus-visible`).
 */
export function Checkbox({
  label,
  hint,
  error,
  required = false,
  id,
  checked,
  defaultChecked = false,
  onFocus,
  onBlur,
  onChange,
  disabled = false,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const [isFocused, setIsFocused] = useState(false);

  const isControlled = checked !== undefined;
  const isChecked = isControlled ? checked : internalChecked;
  const isInvalid = error !== undefined;

  const describedByParts: string[] = [];
  if (hint !== undefined) {
    describedByParts.push(hintId);
  }
  if (error !== undefined) {
    describedByParts.push(errorId);
  }
  const describedBy =
    describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const boxSize = 20;
  const visualBorderColor = isInvalid
    ? color.danger
    : isChecked
      ? color.accent
      : color.borderStrong;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      <label
        htmlFor={controlId}
        style={{
          display: "inline-flex",
          alignItems: "flex-start",
          gap: `${spacing[2]}px`,
          minHeight: `${touchTarget.minimum}px`,
          padding: `${spacing[2]}px 0`,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          color: color.fgPrimary,
          fontFamily: typography.family.sans,
          fontSize: `${typography.size.sm}px`,
          lineHeight: typography.lineHeight.normal,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: `${boxSize}px`,
            height: `${boxSize}px`,
            marginTop: "1px",
            backgroundColor: isChecked ? color.accent : color.surface,
            border: `1px solid ${visualBorderColor}`,
            borderRadius: `${radius.sm}px`,
            ...(isFocused
              ? {
                  outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
                  outlineOffset: `${focusRing.offset}px`,
                }
              : { outline: "none" }),
          }}
        >
          {isChecked ? <CheckGlyph /> : null}
        </span>
        <span>
          {label}
          {required ? (
            <span aria-hidden="true" style={{ color: color.danger, marginLeft: `${spacing[1]}px` }}>
              *
            </span>
          ) : null}
        </span>
      </label>
      {hint !== undefined ? (
        <p
          id={hintId}
          style={{
            margin: 0,
            marginTop: 0,
            color: color.fgMuted,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.xs}px`,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p
          id={errorId}
          style={{
            margin: 0,
            marginTop: `${spacing[1]}px`,
            color: color.danger,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.xs}px`,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {error}
        </p>
      ) : null}
      <input
        id={controlId}
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        required={required}
        aria-invalid={isInvalid ? true : undefined}
        aria-describedby={describedBy}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          if (!isControlled) {
            setInternalChecked(event.target.checked);
          }
          onChange?.(event);
        }}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          margin: "-1px",
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
        }}
        {...rest}
      />
    </div>
  );
}

/** Checkmark glyph drawn with SVG strokes (no image/font dependency). */
function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2 6.5 4.5 9 10 3"
        stroke={color.fgOnAccent}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
