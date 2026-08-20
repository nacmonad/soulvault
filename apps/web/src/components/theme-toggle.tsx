"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const noopSubscribe = () => () => {};

/**
 * The stored theme is unknowable on the server, so the pressed state has to
 * stay unset until hydration or the markup mismatches. useSyncExternalStore
 * gives us that signal without a setState-in-effect.
 */
function useIsHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Two-state toggle: Light and Dark. Defaults to Dark unless explicitly set.
 * Uses `theme` (not `resolvedTheme`) to distinguish an explicit choice.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsHydrated();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex items-center gap-px border border-border p-px"
    >
      {options.map((option) => {
        const active = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-label={option.label}
            aria-pressed={active}
            className={cn(
              "flex size-6 items-center justify-center transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <option.icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
