/**
 * Редакционное дерево предпосылок компетенций (ADR 0009).
 *
 * Ребро «родитель → навык» означает порядок роста, а не требование и не ограничение доступа.
 * У навыка не больше одного родителя, поэтому дерево читается без пересечений и ломающих
 * восприятие перекрёстных связей. Список не выводится из групп справочника, уровней,
 * разрыва или пула ИПР: это отдельное содержание, которое ведут здесь вручную.
 */

/** Пары «родитель, навык». Порядок задаёт порядок ветвей на холсте. */
export const PREREQUISITES: readonly (readonly [parent: string, child: string])[] = [
  // Язык и код
  ["comp-oop-i-algoritmy", "comp-vysokourovnevyi-yazyk-programmirovaniya"],
  ["comp-vysokourovnevyi-yazyk-programmirovaniya", "comp-navyki-programmirovaniya-na-yazyke-1s"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-znanie-yazyka-zaprosov-1s"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-znanie-reglamenta-i-standartov-razrabotki"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-opyt-raboty-s-interfeisami-v-upravlyaemom-prilozhenii"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-pechatnye-formy-i-otchety-na-skd"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-rasshireniya-konfiguracii"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-sonarqube-staticheskii-analiz-koda"],
  ["comp-navyki-programmirovaniya-na-yazyke-1s", "comp-integracionnye-mehanizmy"],

  // Данные
  ["comp-yazyk-sql", "comp-model-dannyh-i-proektirovanie-registrov"],
  ["comp-znanie-yazyka-zaprosov-1s", "comp-proizvoditelnost-zaprosov"],
  ["comp-znanie-yazyka-zaprosov-1s", "comp-blokirovki-i-tranzakcii"],
  ["comp-znanie-yazyka-zaprosov-1s", "comp-rabota-s-pravami-dostupa-i-rls"],
  ["comp-proizvoditelnost-zaprosov", "comp-tehnologicheskii-zhurnal-i-monitoring"],
  ["comp-rabota-s-pravami-dostupa-i-rls", "comp-personalnye-dannye-i-trebovaniya-bezopasnosti"],

  // Инструменты и инженерия
  ["comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3", "comp-znanie-tipovyh-konfiguracii"],
  ["comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3", "comp-sistemy-kontrolya-versii"],
  ["comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3", "comp-instrumenty-ii"],
  ["comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3", "comp-linux-krossplatformennost"],
  ["comp-sistemy-kontrolya-versii", "comp-edt-i-rabota-s-ishodnikami"],
  ["comp-edt-i-rabota-s-ishodnikami", "comp-ci-cd-sborka-i-postavka-resheniya"],
  ["comp-ci-cd-sborka-i-postavka-resheniya", "comp-avtomatizirovannoe-testirovanie"],
  ["comp-ci-cd-sborka-i-postavka-resheniya", "comp-infrastruktura-kollektivnoi-razrabotki"],

  // Интеграции
  ["comp-integracionnye-mehanizmy", "comp-rest-odata-http-servisy"],
  ["comp-rest-odata-http-servisy", "comp-integracionnye-platformy-i-esb"],

  // Архитектура
  ["comp-model-dannyh-i-proektirovanie-registrov", "comp-proektirovanie-dorabotok-konfiguracii"],
  ["comp-proektirovanie-dorabotok-konfiguracii", "comp-dokumentirovanie-arhitektury"],
  ["comp-dokumentirovanie-arhitektury", "comp-arhitektura-resheniya-granicy-sistem-i-konturov"],
  ["comp-arhitektura-resheniya-granicy-sistem-i-konturov", "comp-nefunkcionalnye-trebovaniya-i-sravnenie-reshenii"],

  // Коммуникация и менторинг
  ["comp-gramotnaya-pismennaya-rech", "comp-navyki-delovoi-perepiski-i-soblyudenie-korporativnoi-etiki"],
  ["comp-kommunikabelnost", "comp-effektivnoe-vzaimodeistvie-v-komande"],
  ["comp-effektivnoe-vzaimodeistvie-v-komande", "comp-nastavnichestvo-i-peredacha-znanii"],
  ["comp-nastavnichestvo-i-peredacha-znanii", "comp-upravlenie-komandoi"],

  // Личная эффективность
  ["comp-samostoyatelnost", "comp-obuchaemost"],
  ["comp-obuchaemost", "comp-umenie-iskat-informaciyu-iz-tematicheskih-istochnikov"],
  ["comp-samostoyatelnost", "comp-upravlenie-vremenem"],
  ["comp-upravlenie-vremenem", "comp-ocenka-trudoemkosti-i-planirovanie-rabot"],
  ["comp-ocenka-trudoemkosti-i-planirovanie-rabot", "comp-postanovka-zadach-i-kontrol-ispolneniya"],
];

export type PrerequisiteTree = {
  /** Родитель каждого навыка из набора. */
  parentOf: Map<string, string>;
  /** Дети каждого навыка. */
  childrenOf: Map<string, string[]>;
  /** Глубина: у корня 0, ребро всегда ведёт на слой глубже. */
  depthOf: Map<string, number>;
  /** Корень ветви, к которой относится навык. */
  rootOf: Map<string, string>;
  roots: string[];
  /** Рёбра только между известными навыками. */
  edges: { source: string; target: string }[];
};

/**
 * Строит дерево по известному набору навыков. Рёбра на навыки, которых нет в наборе,
 * отбрасываются: удалённая из справочника компетенция не ломает страницу.
 */
export function buildPrerequisiteTree(ids: Iterable<string>): PrerequisiteTree {
  const known = new Set(ids);
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const edges: { source: string; target: string }[] = [];

  for (const [parent, child] of PREREQUISITES) {
    if (!known.has(parent) || !known.has(child)) continue;
    if (parentOf.has(child)) continue;
    parentOf.set(child, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    edges.push({ source: parent, target: child });
  }

  const depthOf = new Map<string, number>();
  const depth = (id: string, stack: Set<string> = new Set()): number => {
    const cached = depthOf.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) throw new Error(`Цикл предпосылок: ${id}`);
    stack.add(id);
    const parent = parentOf.get(id);
    const value = parent ? depth(parent, stack) + 1 : 0;
    stack.delete(id);
    depthOf.set(id, value);
    return value;
  };

  const rootOf = new Map<string, string>();
  const root = (id: string): string => {
    const cached = rootOf.get(id);
    if (cached !== undefined) return cached;
    const parent = parentOf.get(id);
    const value = parent ? root(parent) : id;
    rootOf.set(id, value);
    return value;
  };

  const roots: string[] = [];
  for (const id of known) {
    depth(id);
    root(id);
    if (!parentOf.has(id)) roots.push(id);
  }

  return { parentOf, childrenOf, depthOf, rootOf, roots, edges };
}

/** Проблемы покрытия для теста и проверки seed: неизвестные пары, второй родитель, циклы. */
export function prerequisiteProblems(ids: Iterable<string>): string[] {
  const known = new Set(ids);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [parent, child] of PREREQUISITES) {
    if (!known.has(parent)) problems.push(`Неизвестный родитель: ${parent}`);
    if (!known.has(child)) problems.push(`Неизвестный навык: ${child}`);
    if (seen.has(child)) problems.push(`Второй родитель: ${child}`);
    seen.add(child);
  }
  try {
    buildPrerequisiteTree(known);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return problems;
}
