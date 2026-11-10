/**
 * Next вызывает `register` при старте сервера, до первого запроса.
 * Сборку пропускаем: иначе `next build` открыл бы рабочую базу.
 * Edge-бандл схемы не касается.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { applySchema } = await import("@/db/schema-ready");
  if (applySchema()) console.info("schema applied");
}
