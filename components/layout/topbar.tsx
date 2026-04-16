import { LocaleSwitcher } from "./locale-switcher";

export function Topbar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-panel)]/60 px-6 py-3 backdrop-blur-md">
      <div className="flex items-center gap-3 min-w-0">{children}</div>
      <LocaleSwitcher />
    </div>
  );
}
