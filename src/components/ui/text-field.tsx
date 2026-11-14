import { useId, type InputHTMLAttributes } from "react";

// M3 outlined text field with the label resting in the top border.
// 56 px tall, 16 px text (also stops iOS from zooming in on focus).
export function TextField({
  label,
  supportingText,
  className = "",
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; supportingText?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="relative">
        <input
          id={id}
          className="peer h-14 w-full rounded border border-outline bg-transparent px-4 text-base text-on-surface placeholder:text-on-surface-variant/70 hover:border-on-surface focus:border-2 focus:border-primary focus:px-[15px] focus:outline-none disabled:border-on-surface/12 disabled:text-on-surface/38"
          {...input}
        />
        <label
          htmlFor={id}
          className="pointer-events-none absolute -top-2 left-3 bg-[var(--field-bg,var(--md-surface))] px-1 text-xs text-on-surface-variant peer-focus:text-primary peer-disabled:text-on-surface/38"
        >
          {label}
        </label>
      </div>
      {supportingText && <span className="px-4 text-xs text-on-surface-variant">{supportingText}</span>}
    </div>
  );
}

// M3 checkbox with label; the whole row is the 48 px touch target.
export function Checkbox({
  label,
  supportingText,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; supportingText?: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 text-sm text-on-surface has-disabled:cursor-default has-disabled:text-on-surface/38">
      <input type="checkbox" className="size-[18px] shrink-0 accent-primary" {...input} />
      <span>
        {label}
        {supportingText && <span className="block text-xs text-on-surface-variant">{supportingText}</span>}
      </span>
    </label>
  );
}
