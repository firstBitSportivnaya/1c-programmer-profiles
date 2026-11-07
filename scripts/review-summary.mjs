/**
 * Сводка замечаний ревью из ответа `pull_request_get_comments`.
 *
 * Инструмент MCP отдаёт все комментарии разом, 70–80 КБ на большой pull request, и большая часть
 * текста — служебная разметка CodeRabbit и подсказки для агента. Скрипт оставляет по замечанию
 * одну строку: что сказано и куда смотреть. Решённые (`Addressed in commit …`) по умолчанию скрыты.
 *
 * Запуск: npm run review:summary -- <файл с ответом MCP> [--all]
 * Файл — путь из сообщения «Large output has been written to: …».
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
const showResolved = process.argv.includes("--all");
if (!file) {
  console.error("Укажите файл с ответом pull_request_get_comments: npm run review:summary -- <файл> [--all]");
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

/** Текст замечания без служебных блоков CodeRabbit: комментариев-разметки, details и html. */
function plainText(content) {
  return String(content ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<details[\s\S]*?<\/details>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Решённые замечания CodeRabbit помечает ссылкой на коммит. */
function isResolved(content) {
  return /Addressed in commit/i.test(String(content ?? ""));
}

const rows = comments.map((comment) => ({
  createdAt: String(comment.createdAt ?? "").slice(0, 16).replace("T", " "),
  author: comment.author?.login ?? comment.author?.name ?? comment.author ?? "?",
  url: String(comment.url ?? ""),
  text: plainText(comment.content),
  resolved: isResolved(comment.content),
}));

const open = rows.filter((row) => !row.resolved);
console.log(`Всего замечаний: ${rows.length}, не решено: ${open.length}`);for (const [index, row] of (showResolved ? rows : open).entries()) {
  console.log(`\n${index + 1}. ${row.createdAt} · ${row.author}${row.resolved ? " · решено" : ""}`);
  console.log(`   ${row.url}`);
  console.log(`   ${row.text.slice(0, 700)}${row.text.length > 700 ? "…" : ""}`);
}
