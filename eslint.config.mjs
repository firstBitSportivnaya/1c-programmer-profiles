import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // Фикстуры Playwright передают значение через `use` — это не React-хук.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    ignores: [".next/**", "out/**", "build/**", "tmp/**", "test-results/**", "playwright-report/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
