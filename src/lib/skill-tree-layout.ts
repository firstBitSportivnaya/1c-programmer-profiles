import type { PrerequisiteTree } from "@/lib/skill-tree-graph";

/**
 * Раскладка дерева предпосылок слоями сверху вниз (ADR 0009).
 * Ребро всегда соединяет соседние слои, поэтому линия идёт по пустой полосе между
 * рядами узлов и не пересекает чужие карточки. Внутри слоя узлы упорядочены
 * барицентром: ветви не перепутываются, дети стоят под своими родителями.
 */

export type SkillTreeLayoutNode = { id: string; x: number; y: number; depth: number };

export type SkillTreeLayout = {
  nodes: SkillTreeLayoutNode[];
  width: number;
  height: number;
  depth: number;
};

type Size = { nodeWidth: number; nodeHeight: number; gapX: number; gapY: number };

/** Средний индекс соседей: ключ сортировки слоя. Без соседей узел остаётся на месте. */
function barycenter(ids: string[], neighbourIndex: Map<string, number>): string[] {
  const keyed = ids.map((id, index) => ({ id, index, key: neighbourIndex.get(id) ?? index }));
  keyed.sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key));
  return keyed.map((row) => row.id);
}

/** Индекс каждого узла слоя в текущем порядке. */
function indexOf(layer: string[]): Map<string, number> {
  return new Map(layer.map((id, index) => [id, index]));
}

/** Сколько пар рёбер между соседними слоями пересекаются: чем меньше, тем чище ветви. */
function crossings(tree: PrerequisiteTree, layers: string[][]): number {
  let total = 0;
  for (let depth = 0; depth < layers.length - 1; depth += 1) {
    const parents = indexOf(layers[depth]);
    const children = indexOf(layers[depth + 1]);
    const pairs: { from: number; to: number }[] = [];
    for (const id of layers[depth]) {
      const from = parents.get(id)!;
      for (const child of tree.childrenOf.get(id) ?? []) {
        const to = children.get(child);
        if (to !== undefined) pairs.push({ from, to });
      }
    }
    for (let i = 0; i < pairs.length; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        if ((pairs[i].from - pairs[j].from) * (pairs[i].to - pairs[j].to) < 0) total += 1;
      }
    }
  }
  return total;
}

export function layoutSkillTree(tree: PrerequisiteTree, ids: string[], size: Size): SkillTreeLayout {
  const known = new Set(ids);
  const layers: string[][] = [];
  const seen = new Set<string>();

  // Обход в глубину задаёт стартовый порядок: ветви идут подряд.
  const visit = (id: string) => {
    if (seen.has(id) || !known.has(id)) return;
    seen.add(id);
    const depth = tree.depthOf.get(id) ?? 0;
    (layers[depth] ??= []).push(id);
    for (const child of tree.childrenOf.get(id) ?? []) visit(child);
  };
  for (const root of tree.roots) visit(root);
  for (const id of ids) visit(id);

  if (layers.length === 0) return { nodes: [], width: 0, height: 0, depth: 0 };
  const maxDepth = layers.length - 1;
  // Свипы барицентра не монотонны: сохраняем раскладку с наименьшим числом пересечений.
  let best = layers.map((layer) => [...layer]);
  let bestCrossings = crossings(tree, layers);
  for (let pass = 0; pass < 8 && bestCrossings > 0; pass += 1) {
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const parents = indexOf(layers[depth - 1] ?? []);
      const neighbour = new Map<string, number>();
      for (const id of layers[depth] ?? []) {
        const parent = tree.parentOf.get(id);
        if (parent !== undefined && parents.has(parent)) neighbour.set(id, parents.get(parent)!);
      }
      layers[depth] = barycenter(layers[depth] ?? [], neighbour);
    }
    for (let depth = maxDepth - 1; depth >= 0; depth -= 1) {
      const children = indexOf(layers[depth + 1] ?? []);
      const neighbour = new Map<string, number>();
      for (const id of layers[depth] ?? []) {
        const kids = (tree.childrenOf.get(id) ?? []).filter((child) => children.has(child));
        if (kids.length === 0) continue;
        const sum = kids.reduce((total, child) => total + children.get(child)!, 0);
        neighbour.set(id, sum / kids.length);
      }
      layers[depth] = barycenter(layers[depth] ?? [], neighbour);
    }
    const current = crossings(tree, layers);
    if (current < bestCrossings) {
      bestCrossings = current;
      best = layers.map((layer) => [...layer]);
    }
  }

  const slotX = size.nodeWidth + size.gapX;
  const slotY = size.nodeHeight + size.gapY;
  const widest = best.reduce((max, layer) => Math.max(max, layer.length), 0);
  const width = widest * slotX - size.gapX;
  const nodes: SkillTreeLayoutNode[] = [];

  best.forEach((layer, depth) => {
    const offset = (width - (layer.length * slotX - size.gapX)) / 2;
    layer.forEach((id, index) => {
      nodes.push({ id, x: offset + index * slotX, y: depth * slotY, depth });
    });
  });

  return { nodes, width, height: best.length * slotY - size.gapY, depth: maxDepth };
}
