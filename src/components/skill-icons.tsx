import type { ReactNode } from "react";

/**
 * Пиктограммы навыков: простые линейные значки 24×24, рисуются текущим цветом.
 * Значок у каждого навыка свой; набор общий, поэтому карточки читаются одинаково.
 */
type Glyph = readonly (readonly [string, string])[];
type GlyphMap = Record<string, Glyph>;

const GLYPHS: GlyphMap = {
  code: [
    ["path", "m9 8-4 4 4 4"],
    ["path", "m15 8 4 4-4 4"],
  ],
  terminal: [
    ["path", "m5 7 5 5-5 5"],
    ["path", "M13 17h6"],
  ],
  layers: [
    ["path", "m12 3 9 5-9 5-9-5 9-5Z"],
    ["path", "m3 13 9 5 9-5"],
  ],
  brace: [
    ["path", "M9 4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h1"],
    ["path", "M15 4h1a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-1"],
  ],
  database: [
    ["path", "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z"],
    ["path", "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"],
    ["path", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  ],
  table: [
    ["rect", "3 4 18 16 2"],
    ["path", "M3 10h18"],
    ["path", "M9 10v10"],
  ],
  grid: [
    ["rect", "3 3 18 18 2"],
    ["path", "M3 9h18M3 15h18M9 3v18M15 3v18"],
  ],
  gauge: [
    ["path", "M4 18a8 8 0 1 1 16 0"],
    ["path", "m12 18 4-6"],
  ],
  lock: [
    ["rect", "5 11 14 9 2"],
    ["path", "M8 11V7a4 4 0 0 1 8 0v4"],
  ],
  shield: [["path", "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"]],
  "shield-check": [
    ["path", "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"],
    ["path", "m9 12 2 2 4-4"],
  ],
  branch: [
    ["circle", "6 6 2.5"],
    ["circle", "6 18 2.5"],
    ["circle", "18 6 2.5"],
    ["path", "M18 8.5v1.5a4 4 0 0 1-4 4H8"],
  ],
  package: [
    ["path", "m12 3 8 4v10l-8 4-8-4V7l8-4Z"],
    ["path", "m4 7 8 4 8-4"],
    ["path", "M12 11v10"],
  ],
  bug: [
    ["circle", "12 13 5"],
    ["path", "M12 8v10"],
    ["path", "M7 8 5 5M17 8l2-3"],
    ["path", "M3 13h4M17 13h4M4 18l3-2M20 18l-3-2"],
  ],
  sparkles: [
    ["path", "m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"],
    ["path", "M18 16l.7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7L18 16Z"],
  ],
  plug: [
    ["path", "M9 3v5M15 3v5"],
    ["path", "M7 8h10v3a5 5 0 0 1-10 0V8Z"],
    ["path", "M12 16v5"],
  ],
  server: [
    ["rect", "3 4 18 6 2"],
    ["rect", "3 14 18 6 2"],
    ["path", "M7 7h.01M7 17h.01"],
  ],
  monitor: [
    ["rect", "3 4 18 12 2"],
    ["path", "M8 20h8M12 16v4"],
    ["path", "m7 12 3-3 2 2 4-4"],
  ],
  checklist: [
    ["path", "M4 6h9M4 12h9M4 18h6"],
    ["path", "m16 16 2 2 4-4"],
  ],
  file: [
    ["path", "M6 3h8l5 5v13H6V3Z"],
    ["path", "M14 3v5h5"],
    ["path", "M9 13h6M9 17h4"],
  ],
  "file-check": [
    ["path", "M6 3h8l5 5v13H6V3Z"],
    ["path", "M14 3v5h5"],
    ["path", "m9 15 2 2 4-4"],
  ],
  puzzle: [
    ["path", "M9 4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H5v-4a2 2 0 1 0 0-4V4h4Z"],
  ],
  box: [
    ["path", "m12 3 8 4v10l-8 4-8-4V7l8-4Z"],
    ["path", "M4 7l8 4 8-4"],
  ],
  ruler: [
    ["path", "m3 13 8-8 8 8-8 8-8-8Z"],
    ["path", "m7 13 2 2M10 10l2 2M13 7l2 2"],
  ],
  pen: [
    ["path", "M4 20h4L18 10l-4-4L4 16v4Z"],
    ["path", "m13 7 4 4"],
  ],
  mail: [
    ["rect", "3 5 18 14 2"],
    ["path", "m3 7 9 6 9-6"],
  ],
  send: [
    ["path", "m4 12 16-8-6 16-3-6-7-2Z"],
    ["path", "m11 14 3-3"],
  ],
  chat: [["path", "M4 5h16v11H9l-5 4V5Z"]],
  users: [
    ["circle", "9 8 3"],
    ["path", "M3 20a6 6 0 0 1 12 0"],
    ["path", "M16 5a3 3 0 0 1 0 6"],
    ["path", "M17 14a5 5 0 0 1 4 6"],
  ],
  compass: [
    ["circle", "12 12 9"],
    ["path", "m15 9-2 5-5 2 2-5 5-2Z"],
  ],
  book: [
    ["path", "M12 6a3 3 0 0 0-3-3H4v14h5a3 3 0 0 1 3 3V6Z"],
    ["path", "M12 6a3 3 0 0 1 3-3h5v14h-5a3 3 0 0 0-3 3V6Z"],
  ],
  search: [
    ["circle", "11 11 6"],
    ["path", "m16 16 4 4"],
  ],
  clock: [
    ["circle", "12 12 9"],
    ["path", "M12 7v5l3 2"],
  ],
  calendar: [
    ["rect", "3 5 18 15 2"],
    ["path", "M3 10h18M8 3v4M16 3v4"],
  ],
  flag: [
    ["path", "M6 3v18"],
    ["path", "M6 4h11l-2 4 2 4H6"],
  ],
  award: [
    ["circle", "12 9 5"],
    ["path", "m9 14-2 7 5-3 5 3-2-7"],
  ],
  target: [
    ["circle", "12 12 8"],
    ["circle", "12 12 4"],
    ["circle", "12 12 1"],
  ],
  scale: [
    ["path", "M12 4v16M6 8h12"],
    ["path", "m4 16 2-6 2 6a3 3 0 0 1-4 0Z"],
    ["path", "m16 16 2-6 2 6a3 3 0 0 1-4 0Z"],
  ],
  wrench: [
    ["path", "M15 3a5 5 0 0 0-4 8L4 18l2 2 7-7a5 5 0 0 0 6-7l-3 3-2-2 3-3a5 5 0 0 0-1-1Z"],
  ],
  layout: [
    ["rect", "3 4 18 16 2"],
    ["path", "M3 9h18M9 9v11"],
  ],
  diagram: [
    ["rect", "3 4 6 5 1"],
    ["rect", "15 4 6 5 1"],
    ["rect", "9 15 6 5 1"],
    ["path", "M6 9v3h12V9M12 12v3"],
  ],
  blocks: [
    ["rect", "3 3 8 8 1"],
    ["rect", "13 3 8 8 1"],
    ["rect", "3 13 8 8 1"],
    ["rect", "13 13 8 8 1"],
  ],
  kanban: [
    ["rect", "4 4 4 11 1"],
    ["rect", "10 4 4 16 1"],
    ["rect", "16 4 4 7 1"],
  ],
};

/** Значок конкретного навыка. Ключ — id компетенции из справочника. */
const SKILL_ICONS: Record<string, string> = {
  "comp-gramotnaya-pismennaya-rech": "pen",
  "comp-samostoyatelnost": "compass",
  "comp-obuchaemost": "book",
  "comp-navyki-delovoi-perepiski-i-soblyudenie-korporativnoi-etiki": "send",
  "comp-effektivnoe-vzaimodeistvie-v-komande": "users",
  "comp-umenie-iskat-informaciyu-iz-tematicheskih-istochnikov": "search",
  "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": "wrench",
  "comp-navyki-programmirovaniya-na-yazyke-1s": "code",
  "comp-znanie-yazyka-zaprosov-1s": "database",
  "comp-znanie-reglamenta-i-standartov-razrabotki": "ruler",
  "comp-opyt-raboty-s-interfeisami-v-upravlyaemom-prilozhenii": "layout",
  "comp-pechatnye-formy-i-otchety-na-skd": "file",
  "comp-rasshireniya-konfiguracii": "puzzle",
  "comp-znanie-tipovyh-konfiguracii": "box",
  "comp-sistemy-kontrolya-versii": "branch",
  "comp-instrumenty-ii": "sparkles",
  "comp-upravlenie-vremenem": "clock",
  "comp-rabota-s-pravami-dostupa-i-rls": "shield",
  "comp-avtomatizirovannoe-testirovanie": "bug",
  "comp-rest-odata-http-servisy": "plug",
  "comp-sonarqube-staticheskii-analiz-koda": "checklist",
  "comp-kommunikabelnost": "chat",
  "comp-integracionnye-mehanizmy": "diagram",
  "comp-linux-krossplatformennost": "terminal",
  "comp-upravlenie-komandoi": "flag",
  "comp-proektirovanie-dorabotok-konfiguracii": "blocks",
  "comp-dokumentirovanie-arhitektury": "file-check",
  "comp-oop-i-algoritmy": "layers",
  "comp-vysokourovnevyi-yazyk-programmirovaniya": "brace",
  "comp-yazyk-sql": "table",
  "comp-proizvoditelnost-zaprosov": "gauge",
  "comp-blokirovki-i-tranzakcii": "lock",
  "comp-tehnologicheskii-zhurnal-i-monitoring": "monitor",
  "comp-edt-i-rabota-s-ishodnikami": "file-check",
  "comp-ci-cd-sborka-i-postavka-resheniya": "package",
  "comp-personalnye-dannye-i-trebovaniya-bezopasnosti": "shield-check",
  "comp-integracionnye-platformy-i-esb": "server",
  "comp-arhitektura-resheniya-granicy-sistem-i-konturov": "target",
  "comp-nefunkcionalnye-trebovaniya-i-sravnenie-reshenii": "scale",
  "comp-model-dannyh-i-proektirovanie-registrov": "grid",
  "comp-nastavnichestvo-i-peredacha-znanii": "award",
  "comp-infrastruktura-kollektivnoi-razrabotki": "kanban",
  "comp-ocenka-trudoemkosti-i-planirovanie-rabot": "calendar",
  "comp-postanovka-zadach-i-kontrol-ispolneniya": "checklist",
};

/** Вид навыка задаёт значок, если для компетенции своего нет. */
const KIND_ICONS: Record<string, string> = { professional: "code", universal: "users" };

function parts(spec: string): number[] {
  return spec.split(" ").map(Number);
}

function renderGlyph(name: string): ReactNode {
  return (GLYPHS[name] ?? GLYPHS.code).map(([kind, spec], index) => {
    if (kind === "circle") {
      const [cx, cy, r] = parts(spec);
      return <circle key={index} cx={cx} cy={cy} r={r} />;
    }
    if (kind === "rect") {
      const [x, y, width, height, rx] = parts(spec);
      return <rect key={index} x={x} y={y} width={width} height={height} rx={rx} />;
    }
    return <path key={index} d={spec} />;
  });
}

/** Значок навыка: по id компетенции, иначе по виду. Декоративный, поэтому aria-hidden. */
export function SkillIcon({ id, kind, className }: { id: string; kind: string; className?: string }) {
  const name = SKILL_ICONS[id] ?? KIND_ICONS[kind] ?? "code";
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {renderGlyph(name)}
    </svg>
  );
}
