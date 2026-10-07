/**
 * Согласованный снимок SQLite (docs/workflow.md, проверка обновления).
 *
 *   npm run db:snapshot -- <база> <копия>   снять копию через VACUUM INTO и напечатать число строк
 *   npm run db:snapshot -- <база>           только напечатать число строк
 */
import { snapshot, tableCounts } from "./lib/sqlite-tools";

function main() {
  const [source, target] = process.argv.slice(2);
  if (!source) {
    console.error("usage: npm run db:snapshot -- <база> [копия]");
    process.exit(1);
  }
  try {
    if (target) snapshot(source, target);
    const file = target ?? source;
    console.log(file);
    for (const [table, n] of tableCounts(file)) console.log(`  ${table} ${n}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
