import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemeChoice, useTheme } from "@/hooks/useTheme";
import { cn } from "@/utils";

const options: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
  { value: "system", label: "System theme", Icon: Monitor },
];

/** Three icon buttons: light, dark, follow the system. */
export function ThemeToggle({ className }: { className?: string }) {
  const { choice, setTheme } = useTheme();
  return (
    <fieldset className={cn("inline-flex items-center gap-0.5", className)}>
      <legend className="sr-only">Theme</legend>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={choice === value}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            choice === value &&
              "bg-accent-soft text-accent-soft-foreground hover:bg-accent-soft hover:text-accent-soft-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </fieldset>
  );
}
