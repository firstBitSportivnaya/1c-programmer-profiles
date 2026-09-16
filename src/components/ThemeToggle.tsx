"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function readTheme(): Theme {
  const current = document.documentElement.getAttribute("data-theme");
  return current === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("pp-theme", next);
    setTheme(next);
  }

  return (
    <button className="btn-ghost" type="button" onClick={toggle}>
      {theme === "dark" ? "Светлая" : "Тёмная"}
    </button>
  );
}
