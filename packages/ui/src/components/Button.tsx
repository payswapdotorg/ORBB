"use client";

import { useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { color, focusRing, motion, radius, spacing, touchTarget, typography } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "default" | "large";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> {
  /** Visual variant. Defaults to `primary`. */
  variant?: ButtonVariant;
  /** Size controls the touch target. Defaults to `default` (>= `touchTarget.minimum`). */
  size?: ButtonSize;
  children: ReactNode;
}

/**
 * Accessible button primitive.
 *
 * - Minimum touch target of `touchTarget.minimum` (44px) — always.
 * - Visible focus ring drawn from `focusRing` tokens (inline styles cannot
 *   express `:focus-visible`, so the ring is applied on focus events).
 * - Motion uses `motion` tokens; the web shell's global stylesheet disables
 *   transitions under `prefers-reduced-motion: reduce`.
 * - No hover styling (inline styles cannot express `:hover`); the web shell
 *   layers hover affordances where needed.
 */
export function Button({
  variant = "primary",
  size = "default",
  type = "button",
  disabled = false,
  onFocus,
  onBlur,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const [isFocused, setIsFocused] = useState(false);

  const minHeight =
    size === "large" ? touchTarget.comfortable : touchTarget.minimum;
  const fontSize = size === "large" ? typography.size.md : typography.size.sm;

  const variantStyles: Record<ButtonVariant, {
    backgroundColor: string;
    color: string;
    border: string;
  }> = {
    primary: {
      backgroundColor: color.accent,
      color: color.fgOnAccent,
      border: `1px solid ${color.accent}`,
    },
    secondary: {
      backgroundColor: color.surface,
      color: color.accent,
      border: `1px solid ${color.borderStrong}`,
    },
    quiet: {
      backgroundColor: "transparent",
      color: color.accent,
      border: "1px solid transparent",
    },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      onClick={onClick}
      style={{
        ...variantStyles[variant],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing[2],
        minHeight: `${minHeight}px`,
        minWidth: `${touchTarget.minimum}px`,
        padding: `${spacing[2]}px ${spacing[4]}px`,
        borderRadius: `${radius.md}px`,
        fontFamily: typography.family.sans,
        fontSize: `${fontSize}px`,
        fontWeight: typography.weight.medium,
        lineHeight: typography.lineHeight.normal,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: `background-color ${motion.duration.fast}ms ${motion.easing.standard}, color ${motion.duration.fast}ms ${motion.easing.standard}`,
        ...(isFocused
          ? {
              outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
              outlineOffset: `${focusRing.offset}px`,
            }
          : { outline: "none" }),
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
