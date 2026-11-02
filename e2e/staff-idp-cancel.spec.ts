import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const STAFF = { login: `e2e.cancel.${STAMP}`, name: `Отмена ${STAMP}`, password: "e2e-cancel-password" };
let idpPath = "";

test("сотрудник плана не отменяет его", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(STAFF.login);
  await person.getByLabel("Имя").fill(STAFF.name);
  await person.getByLabel("Пароль").fill(STAFF.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: STAFF.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  idpPath = new URL(page.url()).pathname;

  await login(page, STAFF);
  await page.goto(idpPath);
  await expect(page.getByRole("button", { name: "Отменить" })).toHaveCount(0);
  await expect(page.getByText("активен", { exact: true })).toBeVisible();
});

test("кнопка «Отменить» в общем стиле и закрывает план", async ({ page }) => {
  await page.goto(idpPath);
  const cancel = page.getByRole("button", { name: "Отменить" });
  const refresh = page.getByRole("button", { name: "Обновить доступные компетенции" });
  const metrics = await Promise.all(
    [cancel, refresh].map((button) =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        return { border: style.borderTopWidth, pad: style.paddingTop, color: style.color };
      }),
    ),
  );
  expect(metrics[0].border).toBe(metrics[1].border);
  expect(metrics[0].border).not.toBe("0px");
  expect(metrics[0].pad).toBe(metrics[1].pad);
  expect(metrics[0].color).not.toBe(metrics[1].color);

  await cancel.click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отменить" })).toHaveCount(0);
});
