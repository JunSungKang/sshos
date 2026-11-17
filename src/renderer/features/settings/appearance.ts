import { useLayoutEffect } from "react";
import { getTheme } from "../../../shared/themes";
import { usePreferences } from "./preferences";

export function useAppearance() {
  const preferences = usePreferences(),
    theme = getTheme(preferences?.theme ?? "chocolate");
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = theme.id;
    root.dataset["colorMode"] = theme.scheme;
    root.style.colorScheme = theme.scheme;
    for (const [name, color] of Object.entries(theme.colors))
      root.style.setProperty(
        "--" + name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()),
        color,
      );
  }, [theme]);
  return theme;
}
