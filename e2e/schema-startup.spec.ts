import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "./fixtures";

const root = path.resolve(__dirname, "..");

test("пустая база получает таблицы до запроса, повтор безопасен, битый путь отклонён", () => {
  const result = spawnSync("npx tsx scripts/check-startup-schema.ts", {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("повтор: ok");
  expect(result.stdout).toContain("недоступный путь: отклонён");
});

test("каталог открывается после старта сервера со схемой", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Схема развития" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Программист-стажер", exact: true }).first()).toBeVisible();
});
