"use client";

import { useState } from "react";
import type { InputHTMLAttributes } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

/** Bounds applied by {@link guardNumericValue}. */
export interface NumericGuardLimits {
  /** Minimum allowed value (inclusive). */
  min?: number;
  /** Maximum allowed value (inclusive). */
  max?: number;
  /** Positive step the value is snapped to (multiples of `step`). */
  step?: number;
}

/**
 * Pure numeric guard for measurement-style inputs (M1-B).
 *
 * - empty input stays empty;
 * - non-numeric input is returned unchanged (validity stays the caller's
 *   concern — the guard never invents a value);
 * - finite values are clamped to `[min, max]`, snapped to the nearest
 *   `step` multiple, then re-clamped so snapping cannot escape the bounds;
 * - float dust from snapping is trimmed via a 10-decimal round-trip.
 *
 * Pure string → string, so it is directly unit-testable and reusable.
 */
export function guardNumericValue(
  rawValue: string,
  limits: NumericGuardLimits = {},
): string {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return "";
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return rawValue;
  }

  let guarded = parsed;
  if (limits.min !== undefined && guarded < limits.min) {
    guarded = limits.min;
  }
  if (limits.max !== undefined && guarded > limits.max) {
    guarded = limits.max;
  }
  if (limits.step !== undefined && limits.step > 0) {
    guarded = Number((Math.round(guarded / limits.step) * limits.step).toFixed(10));
  }
  if (limits.min !== undefined && guarded < limits.min) {
    guarded = limits.min;
  }
  if (limits.max !== undefined && guarded > limits.max) {
    guarded = limits.max;
  }
  return String(guarded);
}

export interface ValueInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "className" | "style" | "type" | "onChange"
  > {
  /** Controlled value as text (empty string when unset). */
  value: string;
  /** Receives raw keystrokes and guarded (clamped/snapped) blur commits. */
  onChange: (value: string) => void;
  /** Unit label rendered as a suffix segment (e.g. "kg", "mmHg", "min"). */
  unit: string;
  /** Minimum allowed value; out-of-range commits are clamped on blur. */
  min?: number;
  /** Maximum allowed value; out-of-range commits are clamped on blur. */
  max?: number;
  /** Positive step the committed value is snapped to. */
  step?: number;
  /**
   * Explicit invalid styling (danger border). Passing `aria-invalid` from
   * `FieldWrapper` achieves the same.
   */
  invalid?: boolean;
}

/**
 * ValueInput (M1-B): a unit-suffixed numeric capture control with min/max/
 * step guards, for measurement capture flows.
 *
 * - `type="text"` + `inputMode="decimal"` (mobile decimal keyboard without
 *   the native number-input scroll/UX pitfalls); guards are enforced by the
 *   pure {@link guardNumericValue} on blur rather than by native
 *   validation, so users can type freely and are corrected on commit;
 * - the unit segment is rendered inside the bordered wrapper (never a
 *   placeholder), so the value and its unit read as one field;
 * - 44px minimum touch target, token focus ring, 16px font (no mobile
 *   zoom-on-focus), invalid state via `invalid` or `aria-invalid`.
 */
export function ValueInput({
  value,
  onChange,
  unit,
  min,
  max,
  step,
  invalid = false,
  onFocus,
  onBlur,
  disabled = false,
  ...rest
}: ValueInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const isInvalid = invalid || rest["aria-invalid"] === true;
  const borderColor = isInvalid ? color.danger : color.borderStrong;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        backgroundColor: color.surface,
        border: `1px solid ${borderColor}`,
        borderRadius: `${radius.sm}px`,
        opacity: disabled ? 0.6 : 1,
        ...(isFocused
          ? {
              outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
              outlineOffset: `${focusRing.offset}px`,
            }
          : { outline: "none" }),
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsFocused(false);
          const limits: NumericGuardLimits = {
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(step !== undefined ? { step } : {}),
          };
          const guarded = guardNumericValue(event.target.value, limits);
          if (guarded !== event.target.value) {
            onChange(guarded);
          }
          onBlur?.(event);
        }}
        style={{
          margin: 0,
          border: "none",
          backgroundColor: "transparent",
          color: color.fgPrimary,
          fontFamily: typography.family.sans,
          fontSize: `${typography.size.md}px`,
          lineHeight: typography.lineHeight.normal,
          minHeight: `${touchTarget.minimum}px`,
          minWidth: 0,
          flex: 1,
          padding: `${spacing[2]}px ${spacing[3]}px`,
          outline: "none",
        }}
        {...rest}
      />
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
          padding: `${spacing[2]}px ${spacing[3]}px`,
          borderLeft: `1px solid ${borderColor}`,
          backgroundColor: color.canvas,
          borderRadius: `0 ${radius.sm}px ${radius.sm}px 0`,
          color: color.fgMuted,
          fontFamily: typography.family.sans,
          fontSize: `${typography.size.sm}px`,
          lineHeight: typography.lineHeight.normal,
        }}
      >
        {unit}
      </span>
    </div>
  );
}
