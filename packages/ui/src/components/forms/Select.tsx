"use client";

import { useState } from "react";
import type { SelectHTMLAttributes } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

export interface SelectOption {
  /** Option value (plain string — no domain semantics). */
  value: string;
  /** Visible option label. */
  label: string;
  /** Renders the option unselectable. */
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    "className" | "style" | "children" | "multiple"
  > {
  /** Option list (rendered in order). */
  options: readonly SelectOption[];
  /**
   * Leading placeholder option rendered with an empty value so empty-state
   * selection is detectable by form logic. Not disabled — returning to the
   * placeholder stays possible and validation remains the caller's concern.
   */
  placeholder?: string;
  /**
   * Explicit invalid styling (danger border). Passing `aria-invalid` from
   * `FieldWrapper` achieves the same.
   */
  invalid?: boolean;
}

/**
 * Native single-select primitive (M1-B).
 *
 * A native `<select>` keeps platform picker behavior, keyboard support and
 * screen-reader semantics for free (the safest accessible choice for a
 * design system). Custom affordances are limited to tokens: a custom
 * chevron, border colors, focus ring and the 44px minimum touch target.
 */
export function Select({
  options,
  placeholder,
  invalid = false,
  onFocus,
  onBlur,
  ...rest
}: SelectProps) {
  const [isFocused, setIsFocused] = useState(false);

  const isInvalid = invalid || rest["aria-invalid"] === true;
  const borderColor = isInvalid ? color.danger : color.borderStrong;

  return (
    <select
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
        appearance: "none",
        WebkitAppearance: "none",
        backgroundColor: color.surface,
        backgroundImage: `url("data:image/svg+xml;utf8,${chevronDataUri(borderColor)}")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: `right ${spacing[3]}px center`,
        backgroundSize: "12px 8px",
        border: `1px solid ${borderColor}`,
        borderRadius: `${radius.sm}px`,
        color: color.fgPrimary,
        cursor: rest.disabled ? "default" : "pointer",
        fontFamily: typography.family.sans,
        fontSize: `${typography.size.md}px`,
        lineHeight: typography.lineHeight.normal,
        minHeight: `${touchTarget.minimum}px`,
        opacity: rest.disabled ? 0.6 : 1,
        padding: `${spacing[2]}px ${spacing[6]}px ${spacing[2]}px ${spacing[3]}px`,
        ...(isFocused
          ? {
              outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
              outlineOffset: `${focusRing.offset}px`,
            }
          : { outline: "none" }),
      }}
      {...rest}
    >
      {placeholder !== undefined ? (
        <option value="">{placeholder}</option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Inline-SVG chevron data URI colored to match the current border token. */
function chevronDataUri(borderColor: string): string {
  const stroke = encodeURIComponent(borderColor);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
