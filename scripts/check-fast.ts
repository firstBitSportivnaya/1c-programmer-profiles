/**
 * Быстрый путь проверки при правках: типы и выбранные спеки на одном воркере.
 *
 * Полный `npm run verify` остаётся перед push: здесь нет `check:seed`, `lint` и всего набора e2e.
 * Сборка переиспользуется, только если она новее файлов, из которых её собрали: `next start`
 * отдаёт готовую сборку `.next`, и проверка по устаревшей сборке ничего не доказывает.
 *
 * Запуск: `npm run check:fast -- e2e/staff-skill-tree.spec.ts [ещё спеки]`.
 * Один воркер означает два сервера вместо пяти (замер: 42,6 с против ~20 с на один спек),
 * а сервер `session.spec.ts` не поднимается: его спеки идут отдельным проектом.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** Что считается исходниками сборки. Каталоги обходятся рекурсивно. */
const SOURCES = ["src", "seed", "public", "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs"];

function newestMtime(target: string): number {
  const stats = fs.statSync(target);
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

/** Сборка старше исходников: `next start` покажет прошлую версию приложения. */
function buildIsStale(): boolean {
  const buildId = ".next/BUILD_ID";
  if (!fs.existsSync(buildId)) return true;
  const built = fs.statSync(buildId).mtimeMs;
  return SOURCES.some((source) => fs.existsSync(source) && newestMtime(source) > built);
}

/** Порт занят: сборка и dev пишут в одну папку `.next`, поэтому проверка начинается с отказа. */
function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (busy: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(busy);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function run(command: string, args: string[], env: Record<string, string> = {}): number {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status ?? 1;
}

async function main() {
  const specs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (specs.length === 0) {
    console.error("Укажите спеки: npm run check:fast -- e2e/example.spec.ts");
    process.exit(1);
  }
  for (const spec of specs) {
    if (!spec.endsWith(".spec.ts") || !spec.startsWith("e2e/")) {
      console.error(`Спека должна лежать в e2e/ и называться *.spec.ts: ${spec}`);
      process.exit(1);
    }
    if (!fs.existsSync(spec)) {
      console.error(`Спека не найдена: ${spec}`);
      process.exit(1);
    }
  }
  if (specs.some((spec) => spec.endsWith("session.spec.ts"))) {
    console.error("session.spec.ts идёт на отдельном сервере без админа: проверяйте его одним npm run verify.");
    process.exit(1);
  }
  if (await portBusy(3000)) {
    console.error("Порт 3000 занят dev-сервером. Остановите его: сборка пишет в ту же папку .next.");
    process.exit(1);
  }

  if (buildIsStale()) {
    console.log("\n> сборка устарела, npm run build\n");
    const code = run("npm", ["run", "build"]);
    if (code !== 0) process.exit(code);
  } else {
    console.log("\nСборка новее исходников, next build пропущен.\n");
  }

  console.log("\n> npx tsc --noEmit\n");
  const types = run("npx", ["tsc", "--noEmit"]);
  if (types !== 0) process.exit(types);

  console.log(`\n> playwright: ${specs.join(" ")} (1 воркер)\n`);
  const tests = run("npx", ["playwright", "test", ...specs], {
    E2E_WORKERS: "1",
    E2E_SKIP_BOOTSTRAP: "1",
    E2E_BUILD_FRESH: "1",
  });
  process.exit(tests);
}

main();
