import { useId } from "react";
import type { UseFormRegister } from "react-hook-form";

import type { FormField } from "../services/forms";
import type { DynamicFormValues } from "../validation/dynamic-form";

type DynamicFormFieldProps = {
  disabled: boolean;
  field: FormField;
  errorMessage?: string;
  onFieldBlur: (fieldKey: string) => void;
  onFieldChange: () => void;
  register: UseFormRegister<DynamicFormValues>;
};

function RequiredBadge({ required }: { required: boolean }) {
  return required ? <span className="required-badge">Required</span> : null;
}

export function DynamicFormField({
  disabled,
  field,
  errorMessage,
  onFieldBlur,
  onFieldChange,
  register
}: DynamicFormFieldProps) {
  const generatedId = useId();
  const inputId = `${generatedId}-${field.fieldKey}`;
  const errorId = `${inputId}-error`;
  const accessibilityProps = {
    "aria-describedby": errorMessage ? errorId : undefined,
    "aria-invalid": errorMessage ? true : undefined,
    "aria-required": field.required || undefined
  } as const;
  const registration = register(field.fieldKey, {
    onBlur: () => onFieldBlur(field.fieldKey),
    onChange: onFieldChange
  });

  if (field.inputType === "CHECKBOX") {
    return (
      <div className="form-control form-control--checkbox">
        <div className="checkbox-row">
          <input
            id={inputId}
            type="checkbox"
            disabled={disabled}
            required={field.required}
            {...registration}
            {...accessibilityProps}
          />
          <label htmlFor={inputId}>{field.label}</label>
          <RequiredBadge required={field.required} />
        </div>
        {errorMessage ? (
          <p className="field-error" id={errorId} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  let control;
  if (field.inputType === "SELECT") {
    control = (
      <select
        id={inputId}
        disabled={disabled}
        required={field.required}
        {...registration}
        {...accessibilityProps}
      >
        <option value="">Select {field.label.toLowerCase()}</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (field.inputType === "TEXTAREA") {
    control = (
      <textarea
        id={inputId}
        disabled={disabled}
        rows={5}
        placeholder={field.placeholder ?? undefined}
        required={field.required}
        maxLength={field.constraints.maxLength ?? undefined}
        {...registration}
        {...accessibilityProps}
      />
    );
  } else {
    const type =
      field.inputType === "DATE"
        ? "date"
        : field.inputType === "TIME"
          ? "time"
          : "number";
    control = (
      <input
        id={inputId}
        disabled={disabled}
        type={type}
        placeholder={field.placeholder ?? undefined}
        required={field.required}
        min={
          field.inputType === "NUMBER"
            ? (field.constraints.minValue ?? undefined)
            : undefined
        }
        max={
          field.inputType === "NUMBER"
            ? (field.constraints.maxValue ?? undefined)
            : undefined
        }
        step={field.inputType === "NUMBER" ? "any" : undefined}
        {...registration}
        {...accessibilityProps}
      />
    );
  }

  return (
    <div className="form-control">
      <div className="form-control__heading">
        <label htmlFor={inputId}>{field.label}</label>
        <RequiredBadge required={field.required} />
      </div>
      {control}
      {errorMessage ? (
        <p className="field-error" id={errorId} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
