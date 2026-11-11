import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env";
import { LOGIN_LOCKED_MESSAGE } from "../src/lib/login-attempts";

// Сервер и база только этого файла: пять ошибок не должны закрыть создание админа в session.spec.ts.
test.describe.configure({ mode: "serial" });

function bootstrapForm(page: Page) {
  return page.locator("#bootstrap-admin");
}

async function fillBootstrap(page: Page, envPassword: string) {
  const form = bootstrapForm(page);
  await form.getByLabel("Пароль из .env.local").fill(envPassword);
  await form.getByLabel("Логин").fill("e2e.lock");
  await form.getByLabel("Имя").fill("Не создан");
  await form.getByLabel("Должность").selectOption("team-lead");
  await form.getByLabel("Пароль учётки").fill("e2e-account-password");
  await form.getByRole("button", { name: "Создать первого админа" }).click();
}

test("пять неверных паролей окружения не создают админа", async ({ page, request }) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/session", {
      form: {
        intent: "bootstrap",
        envPassword: "wrong-env-password",
        login: "e2e.lock",
        name: "Не создан",
        jobId: "team-lead",
        accountPassword: "e2e-account-password",
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
  }

  await page.goto("/login");
  await fillBootstrap(page, E2E_ADMIN_PASSWORD);

  await expect(page.locator(".form-error[role='alert']")).toHaveText(LOGIN_LOCKED_MESSAGE);
  await expect(page).toHaveURL(/\/login/);
  await expect(bootstrapForm(page)).toBeVisible();
});
