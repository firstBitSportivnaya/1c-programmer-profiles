/**
 * Сводка замечаний ревью из ответа `pull_request_get_comments`.
 *
 * Инструмент MCP отдаёт все комментарии разом, 70–80 КБ на большой pull request, и большая часть
 * текста — служебная разметка CodeRabbit: блоки «Supported by static analysis» и подсказки для агента.
 * Скрипт оставляет по замечанию одну строку: что сказано и куда смотреть.
 *
 * Решение обсуждения инструмент не отдаёт, поэтому признак «Addressed in commit» ищется только
 * в самом тексте замечания, вне служебных блоков: цитата маркера в подсказке для агента не должна
 * прятать нерешённое замечание. `--all` показывает и помеченные, `--full` — замечание целиком.
 *
 * Запуск: npm run review:summary -- <файл с ответом MCP> [--all] [--full]
 * Файл — путь из сообщения «Large output has been written to: …».
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const showResolved = args.includes("--all");
const showFull = args.includes("--full");
if (!file) {
  console.error("Укажите файл с ответом pull_request_get_comments: npm run review:summary -- <файл> [--all] [--full]");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Не удалось прочитать JSON: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const all = payload?.data?.prComments ?? payload?.prComments ?? (Array.isArray(payload) ? payload : []);
// В ответе лежат и замечания к строкам diff, и обычные комментарии pull request: свои итоги,
// предупреждения бота. Замечания ревью узнаются по `reviewId` и якорю `#discussion_`.
const review = all.filter((comment) => comment.reviewId || /#discussion_/.test(String(comment.url ?? "")));
const comments = review.length > 0 ? review : all;
if (comments.length === 0) {
  console.log("Замечаний нет.");
  process.exit(0);
}

/** Служебные блоки CodeRabbit: разметка, статический анализ и подсказка для агента. */
const SERVICE_BLOCK = /<details[\s\S]*?<\/details>/gi;

/** Текст без html и служебных сущностей. Код внутри блоков сохраняется как обычный текст. */
function plainText(content) {
  return String(content ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Замечание без служебных блоков: по нему видно, что просят, без шума статического анализа. */
function findingBody(content) {
  return plainText(String(content ?? "").replace(SERVICE_BLOCK, " "));
}

/** Текст из служебных блоков: нужен, если само замечание оказалось внутри `<details>`. */
function serviceText(content) {
  const blocks = String(content ?? "").match(SERVICE_BLOCK) ?? [];
  return plainText(blocks.join(" "));
}

const rows = comments.map((comment) => {
  const body = findingBody(comment.content);
  return {
    id: comment.id,
    createdAt: String(comment.createdAt ?? "").slice(0, 16).replace("T", " "),
    author: comment.author?.login ?? comment.author?.name ?? comment.author ?? "?",
    url: String(comment.url ?? ""),
    body,
    // Маркер ищется в теле замечания: CodeRabbit ставит его сам, когда замечание закрыто коммитом.
    resolved: /Addressed in commit/i.test(body),
    // Замечание целиком остаётся доступным: без этого описание внутри `<details>` терялось бы.
    fallback: body.length < 40 ? serviceText(comment.content) : "",
    full: plainText(comment.content),
  };
});

/** Длина строки в сводке: короткого тела хватает, длинное обрезается. */
const BODY_LIMIT = 700;

function printFinding(row, index) {
  const status = row.resolved ? " · решено (по маркеру)" : "";
  console.log(`\n${index + 1}. ${row.createdAt} · ${row.author}${status}`);
  console.log(`   ${row.url}`);
  const text = showFull ? row.full : row.fallback ? `${row.body} ${row.fallback}` : row.body;
  console.log(`   ${text.slice(0, BODY_LIMIT)}${text.length > BODY_LIMIT ? "…" : ""}`);
}

const shown = showResolved ? rows : rows.filter((row) => !row.resolved);
console.log(`Всего замечаний: ${rows.length}, без маркера решения: ${rows.filter((row) => !row.resolved).length}`);
for (const [index, row] of shown.entries()) printFinding(row, index);
