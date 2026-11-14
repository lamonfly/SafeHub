import type { ButtonHTMLAttributes } from "react";

// M3 common buttons. 40 px tall with a 48 px touch target (the extra comes
// from the surrounding padding/gap in layouts; small screens get 48 px).
export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "danger";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-[0.01em] " +
  "transition-[background-color,box-shadow] duration-150 select-none sm:min-h-10 " +
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:pointer-events-none disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  filled: "bg-primary text-on-primary hover:shadow-elevation-1 hover:bg-primary/90 active:bg-primary/85",
  tonal:
    "bg-secondary-container text-on-secondary-container hover:shadow-elevation-1 hover:bg-secondary-container/85",
  outlined: "border border-outline text-primary hover:bg-primary/8 active:bg-primary/12",
  text: "px-3 text-primary hover:bg-primary/8 active:bg-primary/12",
  danger: "border border-outline text-error hover:bg-error/8 active:bg-error/12",
};

export function buttonClass(variant: ButtonVariant = "filled", extra = ""): string {
  return `${base} ${variants[variant]} ${extra}`;
}

export function Button({
  variant = "filled",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
