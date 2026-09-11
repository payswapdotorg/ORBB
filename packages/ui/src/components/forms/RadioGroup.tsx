"use client";

import { useId, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

export interface RadioOption {
  /** Option value (plain string — no domain semantics). */
  value: string;
  /** Visible option label. */
  label: ReactNode;
  /** Optional secondary line under the label. */
  description?: ReactNode;
  /** Renders the option unselectable. */
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Group label (referenced via `aria-labelledby`). */
  label?: ReactNode;
  /** Accessible name when no visible group label is rendered. */
  "aria-label"?: string;
  /** Options (rendered in order; radios share one generated `name`). */
  options: readonly RadioOption[];
  /** Controlled selected value. */
  value?: string;
  /** Initial value for uncontrolled usage. */
  defaultValue?: string;
  /** Called with the newly selected option value. */
  onChange?: (value: string) => void;
  /** Supporting hint wired via `aria-describedby`. */
  hint?: ReactNode;
  /** Error message; presence sets `aria-invalid` on the group. */
  error?: ReactNode;
  /** Marks the group required (asterisk + `aria-required`). */
  required?: boolean;
  /** Disables every option. */
  disabled?: boolean;
  /** Layout direction. Defaults to `vertical`. */
  orientation?: "vertical" | "horizontal";
  /** Stable external id for the group element. */
  id?: string;
}

/**
 * Radio group primitive (M1-B): a self-labeled single-choice control.
 *
 * - The container carries `role="radiogroup"`, named by `aria-labelledby`
 *   (groups are not labelable elements, unlike inputs);
 * - native radios sharing one `name` keep browser arrow-key navigation,
 *   roving focus and screen-reader semantics for free;
 * - selection is never communicated by color alone: the checked radio shows
 *   a filled inner dot plus `aria-checked` on the native input (WCAG 1.4.1);
 * - uncontrolled usage re-renders through internal state so the visual dot
 *   tracks arrow-key selection;
 * - focus ring drawn from `focusRing` tokens on the option's visual circle.
 */
export function RadioGroup({
  label,
  "aria-label": ariaLabel,
  options,
  value,
  defaultValue,
  onChange,
  hint,
  error,
  required = false,
  disabled = false,
  orientation = "vertical",
  id,
}: RadioGroupProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const labelId = `${groupId}-label`;
  const hintId = `${groupId}-hint`;
  const errorId = `${groupId}-error`;
  const name = `orbb-radio-${groupId}`;

  const [internalValue, setInternalValue] = useState(defaultValue);
  const [focusedValue, setFocusedValue] = useState<string | null>(null);

  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internalValue;
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

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (!isControlled) {
      setInternalValue(event.target.value);
    }
    onChange?.(event.target.value);
  };

  const circleSize = 20;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      {label !== undefined ? (
        <span
          id={labelId}
          style={{
            display: "block",
            marginBottom: `${spacing[1]}px`,
            color: color.fgPrimary,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.sm}px`,
            fontWeight: typography.weight.medium,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {label}
          {required ? (
            <span aria-hidden="true" style={{ color: color.danger, marginLeft: `${spacing[1]}px` }}>
              *
            </span>
          ) : null}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={label !== undefined ? labelId : undefined}
        aria-label={label === undefined ? ariaLabel : undefined}
        aria-describedby={describedBy}
        aria-invalid={isInvalid ? true : undefined}
        aria-required={required ? true : undefined}
        style={{
          display: "flex",
          flexDirection: orientation === "horizontal" ? "row" : "column",
          flexWrap: "wrap",
          gap: `${spacing[2]}px`,
        }}
      >
        {options.map((option, index) => {
          const optionInputId = `${groupId}-option-${index}`;
          const isSelected = selectedValue === option.value;
          const isFocusedOption = focusedValue === option.value;
          const optionDisabled = disabled || option.disabled === true;
          return (
            <label
              key={option.value}
              htmlFor={optionInputId}
              style={{
                display: "inline-flex",
                alignItems: "flex-start",
                gap: `${spacing[2]}px`,
                minHeight: `${touchTarget.minimum}px`,
                padding: `${spacing[2]}px ${spacing[1]}px`,
                cursor: optionDisabled ? "default" : "pointer",
                opacity: optionDisabled ? 0.6 : 1,
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
                  width: `${circleSize}px`,
                  height: `${circleSize}px`,
                  marginTop: "1px",
                  backgroundColor: color.surface,
                  border: `1px solid ${isSelected ? color.accent : color.borderStrong}`,
                  borderRadius: `${radius.pill}px`,
                  ...(isFocusedOption
                    ? {
                        outline: `${focusRing.width}px ${focusRing.style} ${focusRing.color}`,
                        outlineOffset: `${focusRing.offset}px`,
                      }
                    : { outline: "none" }),
                }}
              >
                {isSelected ? (
                  <span
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: `${radius.pill}px`,
                      backgroundColor: color.accent,
                    }}
                  />
                ) : null}
              </span>
              <span>
                <span style={{ display: "block" }}>{option.label}</span>
                {option.description !== undefined ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: "1px",
                      color: color.fgMuted,
                      fontSize: `${typography.size.xs}px`,
                      lineHeight: typography.lineHeight.normal,
                    }}
                  >
                    {option.description}
                  </span>
                ) : null}
              </span>
              <input
                type="radio"
                id={optionInputId}
                name={name}
                value={option.value}
                checked={isSelected}
                disabled={optionDisabled}
                onChange={handleChange}
                onFocus={() => {
                  setFocusedValue(option.value);
                }}
                onBlur={() => {
                  setFocusedValue((current) =>
                    current === option.value ? null : current,
                  );
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
              />
            </label>
          );
        })}
      </div>
      {hint !== undefined ? (
        <p
          id={hintId}
          style={{
            margin: 0,
            marginTop: `${spacing[1]}px`,
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
    </div>
  );
}
