// Centered M3 card for login and first-run setup; full width on phones.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-[28px] bg-surface-container-low p-6 shadow-elevation-1 [--field-bg:var(--md-surface-container-low)] sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-on-primary">
          S
        </div>
        {children}
      </div>
    </main>
  );
}
