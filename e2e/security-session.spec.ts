import { request as httpRequest } from "node:http";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { E2E_SESSION_SECRET } from "./env";
import { LOGIN_LOCKED_MESSAGE } from "../src/lib/login-attempts";
import { encodeSession } from "../src/lib/session-cookie";

test.describe.configure({ mode: "serial" });
test.use({ asAdmin: true });

const STAMP = Date.now();

type Account = { login: string; password: string; name: string };

function site(baseURL: string | undefined) {
  if (!baseURL) throw new Error("нет адреса сервера");
  return baseURL;
}

function postForm(
  baseURL: string,
  headers: Record<string, string>,
  fields: Record<string, string>,
): Promise<{ status: number; location: string; setCookie: string }> {
  const body = new URLSearchParams(fields).toString();
  const target = new URL("/api/session", baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const rawCookie = res.headers["set-cookie"];
        const setCookie = Array.isArray(rawCookie) ? rawCookie.join("\n") : (rawCookie ?? "");
        res.resume();
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? "",
            setCookie,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function createPerson(page: Page, account: Account) {
  await page.goto("/people");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Имя").fill(account.name);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption("");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: account.name, exact: true })).toBeVisible();
}

async function loginAccount(page: Page, account: Account) {
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

async function openContext(browser: Browser, baseURL: string, account: Account) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAccount(page, account);
  return { context, page };
}

async function failLogin(request: APIRequestContext, account: Account, times: number) {
  for (let attempt = 0; attempt < times; attempt += 1) {
    const response = await request.post("/api/session", {
      form: { intent: "login", login: account.login, password: "wrong-password" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
  }
}

test("свежая сессия открывает кабинет", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("выход гасит скопированную cookie", async ({ page, browser, baseURL }) => {
  const account: Account = {
    login: `e2e.revoke.${STAMP}`,
    name: `Отзыв ${STAMP}`,
    password: "e2e-revoke-password",
  };
  await createPerson(page, account);
  const { context, page: user } = await openContext(browser, site(baseURL), account);
  const session = (await context.cookies()).find((cookie) => cookie.name === "pp_session");
  if (!session) throw new Error("нет cookie сессии");

  await user.getByRole("button", { name: "Выйти" }).click();
  await expect(user.getByRole("link", { name: "Войти" })).toBeVisible();

  const stolen = await browser.newContext({ baseURL: site(baseURL) });
  await stolen.addCookies([{ name: session.name, value: session.value, url: site(baseURL), httpOnly: true, sameSite: "Lax" }]);
  const copied = await stolen.newPage();
  await copied.goto("/me");
  await expect(copied).toHaveURL(/\/login$/);
  await context.close();
  await stolen.close();
});

test("cookie старше 12 часов не пускает в кабинет", async ({ page, browser, baseURL }) => {
  const account: Account = {
    login: `e2e.stale.${STAMP}`,
    name: `Срок ${STAMP}`,
    password: "e2e-stale-password",
  };
  await createPerson(page, account);
  const { context } = await openContext(browser, site(baseURL), account);
  const session = (await context.cookies()).find((cookie) => cookie.name === "pp_session");
  if (!session) throw new Error("нет cookie сессии");
  const [employeeId, version, , token] = session.value.split(".");
  const issuedAt = Math.floor(Date.now() / 1000) - 13 * 60 * 60;
  const forged = encodeSession(
    { employeeId, version: Number(version), issuedAt, token },
    E2E_SESSION_SECRET,
  );

  const stale = await browser.newContext({ baseURL: site(baseURL) });
  await stale.addCookies([{ name: "pp_session", value: forged, url: site(baseURL), httpOnly: true, sameSite: "Lax" }]);
  const user = await stale.newPage();
  await user.goto("/me");
  await expect(user).toHaveURL(/\/login$/);
  await context.close();
  await stale.close();
});

test("смена пароля закрывает обе сессии", async ({ page, browser, baseURL }) => {
  const account: Account = {
    login: `e2e.pass.${STAMP}`,
    name: `Смена ${STAMP}`,
    password: "e2e-pass-password",
  };
  await createPerson(page, account);
  const first = await openContext(browser, site(baseURL), account);
  const second = await openContext(browser, site(baseURL), account);

  await page.goto("/people");
  await page.getByRole("link", { name: account.name, exact: true }).click();
  const edit = page.locator("form").filter({ has: page.getByLabel(/^Админ/) });
  await edit.getByLabel("Новый пароль").fill("e2e-pass-changed");
  const saved = page.waitForResponse((response) => response.request().method() === "POST");
  await edit.getByRole("button", { name: "Сохранить" }).click();
  await saved;
  await expect(edit.locator(".form-error")).toHaveCount(0);

  await first.page.goto("/me");
  await second.page.goto("/me");
  await expect(first.page).toHaveURL(/\/login$/);
  await expect(second.page).toHaveURL(/\/login$/);
  await first.context.close();
  await second.context.close();
});

test("пять неверных паролей закрывают даже верный", async ({ page, playwright, baseURL }) => {
  const account: Account = {
    login: `e2e.rate.${STAMP}`,
    name: `Лимит ${STAMP}`,
    password: "e2e-rate-password",
  };
  await createPerson(page, account);
  const api = await playwright.request.newContext({ baseURL: site(baseURL) });
  await failLogin(api, account, 5);
  await api.dispose();

  const context = await page.context().browser()!.newContext({ baseURL: site(baseURL) });
  const user = await context.newPage();
  await user.goto("/login");
  const form = user.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(user.locator(".form-error[role='alert']")).toHaveText(LOGIN_LOCKED_MESSAGE);
  await expect(user).toHaveURL(/\/login/);
  await context.close();
});

test("четвёртая ошибка не мешает верному паролю", async ({ page, playwright, baseURL }) => {
  const account: Account = {
    login: `e2e.rateok.${STAMP}`,
    name: `Лимит ок ${STAMP}`,
    password: "e2e-rateok-password",
  };
  await createPerson(page, account);
  const api = await playwright.request.newContext({ baseURL: site(baseURL) });
  await failLogin(api, account, 4);
  const response = await api.post("/api/session", {
    form: { intent: "login", login: account.login, password: account.password },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location ?? "").toContain("/me");
  const again = await api.post("/api/session", {
    form: { intent: "login", login: account.login, password: "wrong-password" },
    maxRedirects: 0,
  });
  expect(again.status()).toBe(303);
  expect(decodeURIComponent(again.headers().location ?? "")).toContain("Неверный логин");
  await api.dispose();
});

test("блокировка одного логина не закрывает другой", async ({ page, playwright, baseURL }) => {
  const blocked: Account = {
    login: `e2e.blocka.${STAMP}`,
    name: `Блок А ${STAMP}`,
    password: "e2e-blocka-password",
  };
  const other: Account = {
    login: `e2e.blockb.${STAMP}`,
    name: `Блок Б ${STAMP}`,
    password: "e2e-blockb-password",
  };
  await createPerson(page, blocked);
  await createPerson(page, other);
  const api = await playwright.request.newContext({ baseURL: site(baseURL) });
  await failLogin(api, blocked, 5);
  await api.dispose();

  const context = await page.context().browser()!.newContext({ baseURL: site(baseURL) });
  const user = await context.newPage();
  await loginAccount(user, other);
  await context.close();
});

test("https-прокси ставит Secure, обычный HTTP — нет", async ({ baseURL }) => {
  const secure = await postForm(
    site(baseURL),
    { "x-forwarded-proto": "https" },
    { intent: "login", login: "e2e.admin", password: "e2e-account-password" },
  );
  expect(secure.status).toBe(303);
  expect(secure.setCookie.toLowerCase()).toContain("secure");

  const plain = await postForm(site(baseURL), {}, { intent: "login", login: "e2e.admin", password: "e2e-account-password" });
  expect(plain.status).toBe(303);
  expect(plain.setCookie.toLowerCase()).not.toContain("secure");
});

test("чужой x-forwarded-host не попадает в Location", async ({ baseURL }) => {
  const response = await postForm(
    site(baseURL),
    { "x-forwarded-host": "evil.example" },
    { intent: "login", login: "e2e.admin", password: "e2e-account-password" },
  );
  expect(response.status).toBe(303);
  expect(response.location).not.toContain("evil.example");
});

test("чужой Origin не ставит cookie, вход с сайта работает", async ({ page, baseURL }) => {
  const response = await postForm(
    site(baseURL),
    { origin: "http://evil.example" },
    { intent: "login", login: "e2e.admin", password: "e2e-account-password" },
  );
  expect(response.status).toBe(403);
  expect(response.setCookie).not.toContain("pp_session");

  await page.goto("/me");
  await expect(page).toHaveURL(/\/me$/);
});
