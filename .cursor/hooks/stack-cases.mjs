import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const inbox = join(process.cwd(), ".cursor", "case-inbox.jsonl");
const mode = process.argv[2];

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const raw = await readStdin();
let input = {};
try {
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  emit({});
  process.exit(0);
}

if (mode === "failure") {
  if (input.is_interrupt || input.failure_type === "permission_denied") {
    emit({});
    process.exit(0);
  }
  const message = String(input.error_message ?? "").trim().slice(0, 500);
  if (!message) {
    emit({});
    process.exit(0);
  }
  const tool = String(input.tool_name ?? "tool");
  const line = JSON.stringify({ tool, message });
  let prior = "";
  try {
    prior = readFileSync(inbox, "utf8");
  } catch {
    prior = "";
  }
  if (!prior.includes(line)) {
    mkdirSync(dirname(inbox), { recursive: true });
    appendFileSync(inbox, `${line}\n`, "utf8");
  }
  emit({});
  process.exit(0);
}

if (mode === "stop") {
  if (input.status !== "completed" || Number(input.loop_count ?? 0) > 0) {
    emit({});
    process.exit(0);
  }
  let text = "";
  try {
    text = readFileSync(inbox, "utf8");
  } catch {
    emit({});
    process.exit(0);
  }
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      try {
        const row = JSON.parse(line);
        return `- ${row.tool}: ${row.message}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  writeFileSync(inbox, "", "utf8");
  if (rows.length === 0) {
    emit({});
    process.exit(0);
  }
  emit({
    followup_message: [
      "Инструменты в этой сессии упали. Если сбой повторяемый для Next.js, React, Drizzle или node:sqlite и его ещё нет в .cursor/rules/learned-cases.mdc — допиши один пункт (симптом, причина, что делать). Другие файлы не меняй. Если кейс уже записан или это разовый сбой, ничего не меняй.",
      "",
      ...rows,
    ].join("\n"),
  });
  process.exit(0);
}

emit({});
