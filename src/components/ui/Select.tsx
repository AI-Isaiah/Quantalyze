import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn("rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20", error && "border-negative", className)}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-negative">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
