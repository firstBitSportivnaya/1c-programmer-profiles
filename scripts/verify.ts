/**
 * Один прогон проверок перед коммитом.
 * Порты 3000 и порты e2e-серверов (3100 и дальше, по числу воркеров) не освобождает: если любой занят,
 * выходит до первой команды.
 * Тесты идут `next start` по готовой сборке, поэтому сборка стоит перед ними и повторно не запускается.
 * Упавшая команда останавливает следующие, таблица для pull request печатается всё равно.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { E2E_PORT, E2E_WORKERS } from "../e2e/env";

type Row = { command: string; result: string };
type Step = { command: string; args: string[]; env?: Record<string, string> };

const STEPS: Step[] = [
  { command: "npm", args: ["run", "check:seed"] },
  { command: "npm", args: ["run", "check:schema"] },
  { command: "npm", args: ["run", "check:indexes"] },
  { command: "npx", args: ["tsc", "--noEmit"] },
  { command: "npm", args: ["run", "lint"] },
  { command: "npm", args: ["run", "build"] },
  // Сборка только что прошла: e2e не собирает её второй раз (см. e2e/ensure-build.ts).
  // `E2E_SKIP_BOOTSTRAP` выключается здесь явно: эта переменная осталась бы в оболочке после
  // `check:fast` и тихо убрала бы из полного прогона `session.spec.ts` — проверку первого админа.
  {
    command: "npm",
    args: ["run", "test:e2e"],
    env: { E2E_BUILD_FRESH: "1", E2E_SKIP_BOOTSTRAP: "0" },
  },
];

function label(step: Step): string {
  return [step.command, ...step.args].join(" ");
}

/** Что-то уже слушает 127.0.0.1:3000. Соединение не удерживаем. */
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

function run(step: Step): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...step.env },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (error) => resolve({ code: 1, output: output + error.message }));
  });
}

const PLAYWRIGHT_SUMMARY = {
  passed: /^(\d+) passed(?:\s+\([^)]*\))?$/,
  failed: /^(\d+) failed$/,
  skipped: /^(\d+) skipped$/,
  flaky: /^(\d+) flaky$/,
  "did not run": /^(\d+) did not run$/,
} as const;

/** Число из итоговой строки Playwright, не из названия теста и не из [WebServer]. */
function countPhrase(output: string, label: keyof typeof PLAYWRIGHT_SUMMARY): string | null {
  const pattern = PLAYWRIGHT_SUMMARY[label];
  let found: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.includes("[WebServer]")) continue;
    const match = line.trim().match(pattern);
    if (match && match[1] !== "0") found = `${match[1]} ${label}`;
  }
  return found;
}

/** Успешный итог Playwright: passed и, если были, skipped и flaky. */
function e2eSummary(output: string): string | null {
  const passed = countPhrase(output, "passed");
  if (!passed) return null;
  const extra = (["skipped", "flaky"] as const).map((label) => countPhrase(output, label)).filter((part) => part !== null);
  return [passed, ...extra].join(", ");
}

function clip(text: string): string {
  const clean = text.replace(/\|/g, "/");
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}

/** Строка причины для таблицы. Строки [WebServer] не берутся. */
function stepFailure(step: { args: string[] }, code: number, output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("[WebServer]"));
  let picked: string | null = null;
  if (step.args.includes("test:e2e")) {
    const failed = countPhrase(output, "failed");
    const didNotRun = countPhrase(output, "did not run");
    if (failed) picked = didNotRun ? `${failed}, ${didNotRun}` : failed;
  } else if (step.args.includes("--noEmit")) {
    picked = lines.find((line) => /error TS\d+/.test(line)) ?? null;
  } else if (step.args.includes("lint")) {
    picked = lines.find((line) => /\berror\b/i.test(line) && !/\b0 errors\b/i.test(line)) ?? null;
  } else {
    picked = lines.find((line) => /error TS\d+|\bError:|✖|Failed to compile/.test(line)) ?? null;
  }
  let text = picked ?? `код выхода ${code}`;
  if (/missing bootstrap script|app-paths-manifest\.json/.test(output)) {
    text += ". Удалите .next и повторите прогон.";
  }
  return clip(text);
}

function printTable(rows: Row[]) {
  console.log("\n| Команда | Результат |");
  console.log("|---|---|");
  for (const row of rows) console.log(`| \`${row.command}\` | ${row.result} |`);
}

async function main() {
  const rows: Row[] = STEPS.map((step) => ({ command: label(step), result: "не запускалась" }));
  const busy = [];
  const ports = [3000, ...Array.from({ length: E2E_WORKERS + 1 }, (_, index) => E2E_PORT + index)];
  for (const port of ports) {
    if (await portBusy(port)) busy.push(port);
  }
  if (busy.length > 0) {
    console.error(
      `Порт ${busy.join(" и ")} занят. Остановите процесс и запустите npm run verify снова. Процессы не остановлены.`,
    );
    printTable(rows);
    process.exit(1);
  }

  let failed = false;
  for (let i = 0; i < STEPS.length; i++) {
    if (failed) break;
    const step = STEPS[i];
    console.log(`\n> ${label(step)}\n`);
    const { code, output } = await run(step);
    if (code === 0) {
      rows[i].result = step.args.includes("test:e2e") ? (e2eSummary(output) ?? "ok") : "ok";
    } else {
      rows[i].result = stepFailure(step, code, output);
      failed = true;
    }
  }
  printTable(rows);
  process.exit(failed ? 1 : 0);
}

main();
