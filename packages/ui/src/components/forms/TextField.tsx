"use client";

import { useState } from "react";
import type { InputHTMLAttributes } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style"> {
  /**
   * Explicit invalid styling (danger border). Passing `aria-invalid` from
   * `FieldWrapper` achieves the same, so either wiring works.
   */
  invalid?: boolean;
}

/**
 * Single-line text input primitive (M1-B).
 *
 * - Minimum touch target of `touchTarget.minimum` (44px) height.
 * - 16px font size to avoid mobile browsers zooming on focus.
 * - Visible focus ring drawn from `focusRing` tokens (inline styles cannot
 *   express `:focus-visible`, so the ring is applied on focus events — the
 *   same approach as `Button`).
 * - Invalid state (explicit `invalid` or `aria-invalid`) switches the border
 *   to the danger token; the error message itself is wired by `FieldWrapper`.
 *
 * Standalone usage carries no label — pair with `FieldWrapper` for accessible
 * labeling (`<FieldWrapper label="…">{(f) => <TextField {...f} />}</FieldWrapper>`).
 */
export function TextField({ invalid = false, onFocus, onBlur, ...rest }: TextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  const isInvalid = invalid || rest["aria-invalid"] === true;
  const borderColor = isInvalid ? color.danger : color.borderStrong;

  return (
    <input
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      style={{
        margin: 0,
        backgroundColor: color.surface,
        border: `1px solid ${borderColor}`,
        borderRadius: `${radius.sm}px`,
        color: color.fgPrimary,
        fontFamily: typography.family.sans,
        fontSize: `${typography.size.md}px`,
        lineHeight: typography.lineHeight.normal,
        minHeight: `${touchTarget.minimum}px`,
        padding: `${spacing[2]}px ${spacing[3]}px`,
        ...(isFocused
          ? {
              outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
              outlineOffset: `${focusRing.offset}px`,
            }
          : { outline: "none" }),
      }}
      {...rest}
    />
  );
}
