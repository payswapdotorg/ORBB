"use client";

import { useId, useState } from "react";
import { color, focusRing, radius, spacing, touchTarget, typography } from "../../tokens";

/** One capture-method option (plain strings — no domain types). */
export interface MethodOption {
  /** Stable option identifier. */
  id: string;
  /** Primary label (e.g. the method name). */
  label: string;
  /** Secondary metadata line (e.g. effort or device note). */
  meta?: string;
  /** Renders the option unselectable. */
  disabled?: boolean;
}

export interface MethodPickerProps {
  /** Options (rendered in order — present the least-burden option first). */
  options: readonly MethodOption[];
  /** Accessible name for the list (rendered as a visible group label). */
  label?: string;
  /** Accessible name when no visible group label is rendered. */
  "aria-label"?: string;
  /** Controlled selected option id. */
  value?: string;
  /** Initial selection for uncontrolled usage. */
  defaultValue?: string;
  /** Called with the newly selected option id. */
  onChange?: (id: string) => void;
  /** Disables every option. */
  disabled?: boolean;
}

/**
 * MethodPicker (M1-B): a single-select list of `{ id, label, meta }`
 * capture-method options.
 *
 * Radio semantics (`role="radiogroup"` + native radios sharing one name),
 * so keyboard arrow navigation, roving focus and screen-reader behavior
 * come from the platform. Selection is never communicated by color alone:
 * the selected row shows a filled radio dot plus `aria-checked` on the
 * native input (WCAG 1.4.1). Each row guarantees the 44px minimum touch
 * target, and the focus ring is drawn from `focusRing` tokens on the
 * selected-row circle.
 */
export function MethodPicker({
  options,
  label,
  "aria-label": ariaLabel,
  value,
  defaultValue,
  onChange,
  disabled = false,
}: MethodPickerProps) {
  const generatedId = useId();
  const groupId = generatedId;
  const labelId = `${groupId}-label`;
  const name = `orbb-method-${groupId}`;

  const [internalValue, setInternalValue] = useState(defaultValue);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const isControlled = value !== undefined;
  const selectedId = isControlled ? value : internalValue;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
      {label !== undefined ? (
        <span
          id={labelId}
          style={{
            display: "block",
            marginBottom: `${spacing[2]}px`,
            color: color.fgPrimary,
            fontFamily: typography.family.sans,
            fontSize: `${typography.size.sm}px`,
            fontWeight: typography.weight.medium,
            lineHeight: typography.lineHeight.normal,
          }}
        >
          {label}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={label !== undefined ? labelId : undefined}
        aria-label={label === undefined ? ariaLabel : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: `${radius.md}px`,
          border: `1px solid ${color.borderSubtle}`,
          backgroundColor: color.surface,
          overflow: "hidden",
        }}
      >
        {options.map((option, index) => {
          const optionInputId = `${groupId}-option-${index}`;
          const isSelected = selectedId === option.id;
          const isFocusedOption = focusedId === option.id;
          const optionDisabled = disabled || option.disabled === true;
          return (
            <label
              key={option.id}
              htmlFor={optionInputId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: `${spacing[3]}px`,
                minHeight: `${touchTarget.minimum}px`,
                padding: `${spacing[3]}px ${spacing[4]}px`,
                backgroundColor: isSelected ? color.accentSubtle : color.surface,
                borderBottom:
                  index === options.length - 1
                    ? "none"
                    : `1px solid ${color.borderSubtle}`,
                cursor: optionDisabled ? "default" : "pointer",
                opacity: optionDisabled ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  width: "20px",
                  height: "20px",
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
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  color: color.fgPrimary,
                  fontFamily: typography.family.sans,
                  lineHeight: typography.lineHeight.normal,
                }}
              >
                <span style={{ fontSize: `${typography.size.sm}px`, fontWeight: typography.weight.medium }}>
                  {option.label}
                </span>
                {option.meta !== undefined ? (
                  <span
                    style={{
                      marginTop: "1px",
                      color: color.fgMuted,
                      fontSize: `${typography.size.xs}px`,
                      lineHeight: typography.lineHeight.normal,
                    }}
                  >
                    {option.meta}
                  </span>
                ) : null}
              </span>
              <input
                type="radio"
                id={optionInputId}
                name={name}
                value={option.id}
                checked={isSelected}
                disabled={optionDisabled}
                onChange={() => {
                  if (!isControlled) {
                    setInternalValue(option.id);
                  }
                  onChange?.(option.id);
                }}
                onFocus={() => {
                  setFocusedId(option.id);
                }}
                onBlur={() => {
                  setFocusedId((current) => (current === option.id ? null : current));
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
    </div>
  );
}
