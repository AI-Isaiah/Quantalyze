import { type InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn("rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-page disabled:text-text-muted", error && "border-negative", className)}
          {...props}
        />
        {error && <p className="text-xs text-negative">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
