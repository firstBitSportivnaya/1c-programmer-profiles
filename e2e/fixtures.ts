/**
 * Расширение `test` для сценариев: вход админом перед тестом и адрес своего сервера.
 *
 * `asAdmin: true` в файле спецификации означает «тесты файла начинают от админа»: cookie сессии
 * добавляется в контекст до первого перехода. Гостевые проверки живут в отдельном `describe`
 * с `test.use({ asAdmin: false })`.
 */
import { test as base, expect, type APIRequest, type Page } from "@playwright/test";
import { E2E_ADMIN, baseUrl, projectPort } from "./env";

type Account = { login: string; password: string };
type SessionCookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean };

/**
 * Сессия админа на один тест. Выход поднимает версию сессии на сервере, и cookie,
 * выданная на весь воркер, после чужого «Выйти» уже не пускает в кабинет.
 */
async function adminSession(request: APIRequest, url: string): Promise<SessionCookie[]> {
  const api = await request.newContext({ baseURL: url });
  try {
    const response = await api.post("/api/session", {
      form: { intent: "login", login: E2E_ADMIN.login, password: E2E_ADMIN.password },
      maxRedirects: 0,
    });
    const { cookies } = await api.storageState();
    if (cookies.length === 0) {
      throw new Error(`Вход админом на ${url} не дал cookie сессии: ${response.status()}`);
    }
    return cookies;
  } finally {
    await api.dispose();
  }
}

/** Cookie админа с сервера воркера: по ней видно, что сессия в контексте ещё действует. */
let adminCookie: { name: string; value: string } | undefined;

export const test = base.extend<{ asAdmin: boolean }>({
  /** От админа ли идут тесты файла. Гостевые проверки выключают это в своём `describe`. */
  asAdmin: [false, { option: true }],

  /** Адрес сервера этого воркера: у каждого воркера своя база и своя папка сборки. */
  baseURL: async ({}, use, testInfo) => {
    await use(baseUrl(projectPort(testInfo.project.metadata, testInfo.parallelIndex)));
  },

  context: async ({ context, asAdmin, playwright }, use, testInfo) => {
    if (asAdmin) {
      const url = baseUrl(projectPort(testInfo.project.metadata, testInfo.parallelIndex));
      const cookies = await adminSession(playwright.request, url);
      adminCookie = cookies.find((cookie) => cookie.httpOnly) ?? cookies[0];
      await context.addCookies(cookies);
    }
    await use(context);
  },
});

/** Сессия админа уже в контексте: тогда вход — пустой шаг, без перехода по страницам. */
async function hasAdminSession(page: Page) {
  if (!adminCookie) return false;
  const cookies = await page.context().cookies();
  return cookies.some((cookie) => cookie.name === adminCookie!.name && cookie.value === adminCookie!.value);
}

/**
 * Выход учётки. Клик только отправляет POST `/api/session`, и следующий `page.goto` успевает оборвать
 * навигацию до ответа: cookie сессии остаётся, и тест продолжает от старой учётки. Ждём ссылку «Войти».
 */
export async function logout(page: Page) {
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();
}

/**
 * Вход учёткой через страницу входа. Админская сессия приходит из фикстуры: если тест её не сбрасывал,
 * вход — пустой шаг, а после «Выйти» учётка вводится заново.
 */
export async function login(page: Page, account: Account = E2E_ADMIN) {
  if (account.login === E2E_ADMIN.login && (await hasAdminSession(page))) return;
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  if ((await form.count()) === 0) {
    // Страница входа уже пустила в кабинет: сначала выходим из текущей учётки.
    await logout(page);
    await page.goto("/login");
  }
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

export { expect };
