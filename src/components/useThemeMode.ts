"use client";

import { useEffect, useState } from "react";

/** Тема документа для `colorMode` React Flow: переключается атрибутом `data-theme` без перезагрузки. */
export function useThemeMode(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
