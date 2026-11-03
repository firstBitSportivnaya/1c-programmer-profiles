"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { useThemeMode } from "@/components/useThemeMode";
import { SkillIcon } from "@/components/skill-icons";
import { levelLabel, levelShort, SkillNodePanel } from "@/components/SkillNodePanel";
import { skillTreeStats, type SkillTreeData, type SkillTreeNode } from "@/lib/skill-tree";
import { buildPrerequisiteTree } from "@/lib/skill-tree-graph";
import { layoutSkillTree } from "@/lib/skill-tree-layout";

const NODE_W = 210;
const NODE_H = 96;
const GAP_X = 24;
const GAP_Y = 52;
const PAD = 28;

/** Стартовый масштаб: дерево читается, остальное — панорамой. */
const FIT = { padding: 0.06, minZoom: 0.8, maxZoom: 1 };

const MARK_LABEL: Record<string, string> = {
  has: "есть",
  in_progress: "в процессе",
  lacks: "нет",
  "": "не отмечено",
};

const PLAN_ICON: Record<string, string> = {
  done: "✓",
  in_progress: "◔",
  not_started: "○",
};

const PLAN_LABEL: Record<string, string> = {
  done: "шаг плана принят",
  in_progress: "шаг плана в работе",
  not_started: "шаг плана не начат",
};

/** Ключи легенды: пометка, приёмка и наличие шага плана выделяют свою часть дерева. */
type LegendKey = "has" | "in_progress" | "lacks" | "none" | "confirmed" | "plan";

const LEGEND_MATCH: Record<LegendKey, (node: SkillTreeNode) => boolean> = {
  has: (node) => node.mark === "has",
  in_progress: (node) => node.mark === "in_progress",
  lacks: (node) => node.mark === "lacks",
  none: (node) => !node.mark,
  confirmed: (node) => node.confirmed,
  plan: (node) => node.plan.total > 0,
};

/** Сколько тем навыков получают свой цвет бейджа: столько же пар stroke/fill в палитре. */
const TOPIC_COUNT = 6;

type SkillNodeData = { skill: SkillTreeNode; depth: number; topic: number; selected: boolean };

/** Узел дерева: бейдж темы, название, требование должности и шаг плана. */
function SkillNodeView({ data }: NodeProps) {
  const { skill, depth, topic, selected } = data as unknown as SkillNodeData;
  const mark = skill.mark || "none";
  const planNote =
    skill.plan.total === 0
      ? null
      : skill.plan.state === "done"
        ? "принято"
        : skill.plan.accepted > 0
          ? `принято ${skill.plan.accepted} из ${skill.plan.total}`
          : PLAN_LABEL[skill.plan.state];

  return (
    <div
      className={`skill-node skill-node--${mark}${skill.confirmed ? " skill-node--confirmed" : ""}`}
      // Ссылка на предпосылку ведёт на этот якорь: её можно открыть в новой вкладке.
      id={`skill-node-${skill.id}`}
      data-testid={`skill-node-${skill.id}`}
      data-skill={skill.id}
      data-selected={selected ? "true" : "false"}
      data-depth={depth}
      data-kind={skill.kind}
      data-relation={skill.relation}
      data-mark={mark}
      data-confirmed={skill.confirmed ? "true" : "false"}
      data-plan-state={skill.plan.total === 0 ? "none" : skill.plan.state}
      data-topic={topic >= 0 ? topic : undefined}
      aria-label={`${skill.name}: ${levelLabel(skill)}, пометка ${MARK_LABEL[mark] ?? "не отмечено"}`}
    >
      <Handle type="target" position={Position.Top} />
      {skill.confirmed ? (
        <span className="skill-node__badge" data-testid={`skill-badge-${skill.id}`} title="Компетенция подтверждена">
          ★
        </span>
      ) : null}
      <span className="skill-node__head">
        <span className="skill-node__icon" title={skill.groupName ?? undefined}>
          <SkillIcon id={skill.id} kind={skill.kind} className="skill-node__glyph" />
        </span>
        {skill.groupName && topic >= 0 ? (
          <span
            className={`skill-node__topic skill-node__topic--${topic}`}
            data-testid={`skill-topic-${skill.id}`}
            title={`Тема навыка: ${skill.groupName}`}
          >
            {skill.groupName}
          </span>
        ) : null}
      </span>
      <span className="skill-node__name">{skill.name}</span>
      <span className="skill-node__foot">
        <span className="skill-node__level">{levelShort(skill)}</span>
        {planNote ? (
          <span
            className={`skill-node__plan skill-node__plan--${skill.plan.state}`}
            data-testid={`skill-plan-${skill.id}`}
            title={PLAN_LABEL[skill.plan.state]}
          >
            {PLAN_ICON[skill.plan.state]} {planNote}
          </span>
        ) : null}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

/**
 * Ребро предпосылки: от родителя к производному навыку, состояние плана сюда не переносится.
 * Ребро выделенной ветви светится и течёт пунктиром, как след в archify.
 */
function SkillEdgeView(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const active = (data as { active?: boolean } | undefined)?.active === true;
  return <BaseEdge path={path} markerEnd={markerEnd} className={active ? "skill-edge skill-edge--active" : "skill-edge"} />;
}

const nodeTypes = { skill: SkillNodeView };
const edgeTypes = { prerequisite: SkillEdgeView };

function relationContext(node: SkillTreeNode, data: SkillTreeData): string {
  if (node.relation === "both") return "Сейчас и цель активного ИПР";
  if (node.relation === "current") return `Сейчас · ${data.currentJob?.name ?? "текущая должность"}`;
  if (node.relation === "target") return `Цель активного ИПР · ${data.targetJob?.name ?? "цель"}`;
  return "Вне профиля";
}

/** Навыки и все их предки: ветвь читается от корня, даже если корень вне профиля. */
function withAncestors(seeds: Iterable<string>, parentOf: Map<string, string>): Set<string> {
  const keep = new Set<string>();
  for (const seed of seeds) {
    let id: string | undefined = seed;
    while (id !== undefined && !keep.has(id)) {
      keep.add(id);
      id = parentOf.get(id);
    }
  }
  return keep;
}

type BoardProps = {
  nodes: SkillTreeNode[];
  data: SkillTreeData;
  highlight: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  label: string;
  testId: string;
  /** Цвет бейджа темы по группе справочника: один и тот же на всех холстах. */
  topicOf: Map<string, number>;
  /** Предпосылка выбранного навыка: из неё панель ведёт на соседний узел. */
  prerequisiteOf: Map<string, { id: string; name: string }>;
};

/** Один холст раздела: своя раскладка, свой зум и своя панель узла. */
function SkillBoard({ nodes, data, highlight, selectedId, onSelect, label, testId, topicOf, prerequisiteOf }: BoardProps) {
  const theme = useThemeMode();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  /** Камера до автосдвига: к ней возвращаемся при закрытии, если человек не двигал холст сам. */
  const baseViewportRef = useRef<Viewport | null>(null);
  const shiftedRef = useRef<{ x: number; y: number; zoom: number; at: number } | null>(null);

  // Дерево строится по навыкам своего раздела: слои не зависят от соседнего холста.
  const tree = useMemo(() => buildPrerequisiteTree(nodes.map((node) => node.id)), [nodes]);

  const graph = useMemo(() => {
    const ids = nodes.map((node) => node.id);
    const layout = layoutSkillTree(tree, ids, {
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      gapX: GAP_X,
      gapY: GAP_Y,
    });
    const positions = new Map(layout.nodes.map((row) => [row.id, row]));

    const flowNodes: Node[] = nodes.map((node) => {
      const spot = positions.get(node.id);
      const dimmed = highlight !== null && !highlight.has(node.id);
      return {
        id: `skill:${node.id}`,
        type: "skill",
        position: { x: (spot?.x ?? 0) + PAD, y: (spot?.y ?? 0) + PAD },
        data: {
          skill: node,
          depth: spot?.depth ?? 0,
          topic: node.groupId ? (topicOf.get(node.groupId) ?? -1) : -1,
          selected: node.id === selectedId,
        },
        style: { width: NODE_W, height: NODE_H },
        className: dimmed ? "skill-dim" : highlight !== null ? "skill-lit" : undefined,
        // Выделение ведёт состояние панели, а не внутренний выбор React Flow:
        // Escape и крестик тогда снимают рамку с узла вместе с панелью.
        selected: node.id === selectedId,
        draggable: false,
        selectable: false,
        zIndex: 2,
      };
    });

    const edges: Edge[] = tree.edges.map((edge) => {
      const lit = highlight !== null && highlight.has(edge.source) && highlight.has(edge.target);
      const dim = highlight !== null && !lit;
      return {
        id: `prereq:${edge.source}:${edge.target}`,
        source: `skill:${edge.source}`,
        target: `skill:${edge.target}`,
        type: "prerequisite",
        data: { active: lit },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: lit ? "var(--arrow-emphasis)" : "var(--arrow)",
          width: 18,
          height: 18,
        },
        style: {
          stroke: lit ? "var(--arrow-emphasis)" : "var(--arrow)",
          strokeWidth: lit ? 2.2 : 1.4,
          opacity: dim ? 0.12 : 1,
        },
        focusable: false,
        selectable: false,
      };
    });

    return { nodes: flowNodes, edges };
  }, [highlight, nodes, selectedId, topicOf, tree]);

  /**
   * Панель перекрывает правый край холста. Если выбранный узел оказался под ней,
   * сдвигаем камеру влево, а при закрытии возвращаем её на место — и только если
   * человек не двигал холст сам, иначе возврат отменил бы его панораму.
   */
  useEffect(() => {
    const instance = flowRef.current;
    if (!instance) return;
    const inBoard = selectedId !== null && nodes.some((node) => node.id === selectedId);
    if (!inBoard) {
      const base = baseViewportRef.current;
      const shifted = shiftedRef.current;
      baseViewportRef.current = null;
      shiftedRef.current = null;
      if (!base || !shifted) return;
      const current = instance.getViewport();
      // Сразу после сдвига идёт анимация: тогда это точно наш сдвиг, а не панорама.
      const settling = Date.now() - shifted.at < 600;
      const same = Math.abs(current.x - shifted.x) < 0.5 && Math.abs(current.y - shifted.y) < 0.5;
      if (settling || same) instance.setViewport(base, { duration: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      const shell = shellRef.current;
      const popup = popupRef.current;
      const node = shell?.querySelector<HTMLElement>(`[data-id="skill:${selectedId}"]`);
      if (!popup || !node) return;
      const pop = popup.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const overlaps = box.right > pop.left && box.left < pop.right && box.bottom > pop.top && box.top < pop.bottom;
      if (!overlaps) return;
      const viewport = instance.getViewport();
      if (baseViewportRef.current === null) baseViewportRef.current = viewport;
      const shift = box.right + 24 - pop.left;
      const next = { ...viewport, x: viewport.x - shift };
      shiftedRef.current = { ...next, at: Date.now() };
      instance.setViewport(next, { duration: 260 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [nodes, selectedId]);

  /** Панель в другом холсте (переход по предпосылке) может оказаться вне экрана. */
  useEffect(() => {
    if (selectedId === null || !nodes.some((node) => node.id === selectedId)) return;
    const popup = popupRef.current;
    if (!popup) return;
    const box = popup.getBoundingClientRect();
    const visible = box.bottom > 0 && box.top < window.innerHeight;
    if (!visible) popup.scrollIntoView({ block: "nearest" });
  }, [nodes, selectedId]);

  /** Открытие панели с клавиатуры: Enter и Space на узле, как клик мышью. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement | null;
    const node = target?.closest<HTMLElement>('[data-testid^="skill-node-"]');
    if (!node) return;
    event.preventDefault();
    onSelect(node.dataset.testid?.slice("skill-node-".length) ?? null);
  };

  const selected = selectedId ? nodes.find((node) => node.id === selectedId) : undefined;

  return (
    <div
      className="graph-shell panel skill-tree-shell"
      ref={shellRef}
      onKeyDown={onKeyDown}
      aria-label={label}
      data-testid={testId}
    >
      <ReactFlowProvider>
        <ReactFlow
          colorMode={theme}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={FIT}
          minZoom={0.4}
          maxZoom={1.4}
          panOnDrag
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          noPanClassName="nopan"
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.type !== "skill") return;
            onSelect(node.id.slice("skill:".length));
          }}
          onPaneClick={() => onSelect(null)}
          onInit={(instance) => {
            flowRef.current = instance;
            instance.fitView(FIT);
          }}
        >
          <Background color="var(--grid)" gap={24} />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>

      {selected ? (
        <div className="skill-popup" data-testid="skill-panel-slot" ref={popupRef}>
          <SkillNodePanel
            node={selected}
            context={relationContext(selected, data)}
            planId={data.planId}
            prerequisite={prerequisiteOf.get(selected.id) ?? null}
            onOpenPrerequisite={onSelect}
            onClose={() => onSelect(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Дерево навыков: профессиональные и личные компетенции раздельно, вне профиля — своим разделом.
 * Слева — легенда, статистика и девиз; справа от холста выезжает панель навыка.
 */
export function SkillTree({ data, motto }: { data: SkillTreeData; motto: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legend, setLegend] = useState<LegendKey | null>(null);
  const [showAll, setShowAll] = useState(false);

  const tree = useMemo(() => buildPrerequisiteTree(data.nodes.map((node) => node.id)), [data.nodes]);

  /** Навыки должности и цели с предками: это основной холст. */
  const profileChain = useMemo(
    () =>
      withAncestors(
        data.nodes.filter((node) => node.relation !== "none").map((node) => node.id),
        tree.parentOf,
      ),
    [data.nodes, tree],
  );

  /** Пометка вне профиля держит навык в дереве (ADR 0008): он уходит в раздел «Вне профиля». */
  const outsideChain = useMemo(
    () =>
      withAncestors(
        data.nodes.filter((node) => node.mark !== "" && !profileChain.has(node.id)).map((node) => node.id),
        tree.parentOf,
      ),
    [data.nodes, profileChain, tree],
  );

  const shown = useMemo(() => {
    if (showAll) return data.nodes;
    return data.nodes.filter((node) => profileChain.has(node.id) || outsideChain.has(node.id));
  }, [data.nodes, outsideChain, profileChain, showAll]);

  const professional = useMemo(
    () => shown.filter((node) => node.kind === "professional" && profileChain.has(node.id)),
    [shown, profileChain],
  );
  const personal = useMemo(
    () => shown.filter((node) => node.kind === "universal" && profileChain.has(node.id)),
    [shown, profileChain],
  );
  const outside = useMemo(() => shown.filter((node) => !profileChain.has(node.id)), [shown, profileChain]);

  /** Ветвь выбранного узла: предки и потомки, остальное приглушается. */
  const branch = useMemo(() => {
    if (!selectedId) return null;
    const keep = withAncestors([selectedId], tree.parentOf);
    const stack = [selectedId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const child of tree.childrenOf.get(id) ?? []) {
        if (keep.has(child)) continue;
        keep.add(child);
        stack.push(child);
      }
    }
    return keep;
  }, [selectedId, tree]);

  /** Что светится: ветвь выбранного узла или узлы выбранной записи легенды. */
  const highlight = useMemo(() => {
    if (legend === null) return branch;
    return new Set(shown.filter(LEGEND_MATCH[legend]).map((node) => node.id));
  }, [branch, legend, shown]);

  /** Сколько узлов даёт каждая запись легенды: пустую выбирать не за что. */
  const legendCount = useMemo(() => {
    const counts = {} as Record<LegendKey, number>;
    for (const key of Object.keys(LEGEND_MATCH) as LegendKey[]) {
      counts[key] = shown.filter(LEGEND_MATCH[key]).length;
    }
    return counts;
  }, [shown]);

  /** Счётчики колонки: считаются по тому же отбору, что и холсты. */
  const stats = useMemo(() => skillTreeStats(shown), [shown]);

  /**
   * Тема навыка — группа справочника, цвет бейджа берётся по её месту в списке.
   * Список строится по всему дереву, поэтому цвет не меняется от отбора и одинаков на всех холстах.
   */
  const topicOf = useMemo(() => {
    const ids = [...new Set(data.nodes.map((node) => node.groupId))].filter((id): id is string => id !== null).sort();
    return new Map(ids.map((id, index) => [id, index % TOPIC_COUNT]));
  }, [data.nodes]);

  /** Предпосылка каждого показанного навыка: панель ведёт по ней на соседний узел. */
  const prerequisiteOf = useMemo(() => {
    const names = new Map(shown.map((node) => [node.id, node.name]));
    const map = new Map<string, { id: string; name: string }>();
    for (const node of shown) {
      const parentId = tree.parentOf.get(node.id);
      if (parentId === undefined) continue;
      const name = names.get(parentId);
      if (name === undefined) continue;
      map.set(node.id, { id: parentId, name });
    }
    return map;
  }, [shown, tree]);

  // Выбранный навык мог уйти из отбора: карточку тогда закрываем.
  useEffect(() => {
    if (selectedId && !shown.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [selectedId, shown]);

  /**
   * Якорь #skill-node-<id>: ссылку на предпосылку можно открыть в новой вкладке
   * и по среднему клику — тогда панель открывается сразу при загрузке.
   */
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.match(/^#skill-node-(.+)$/)?.[1];
      if (id === undefined) return;
      const target = decodeURIComponent(id);
      if (!data.nodes.some((node) => node.id === target)) return;
      setLegend(null);
      setSelectedId(target);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [data.nodes]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const toggleLegend = (key: LegendKey) => {
    setLegend((current) => (current === key ? null : key));
    setSelectedId(null);
  };

  const legendButton = (key: LegendKey, label: string, swatch: string) => {
    const count = legendCount[key];
    return (
      <li key={key}>
        <button
          type="button"
          data-testid={`skill-legend-${key}`}
          aria-pressed={legend === key}
          disabled={count === 0}
          title={count === 0 ? `Нет узлов: ${label}` : `${label}: узлов на холсте — ${count}`}
          onClick={() => toggleLegend(key)}
        >
          <span className={`skill-legend__swatch ${swatch}`} aria-hidden="true" />
          {label}
          <span className="skill-legend__count" aria-hidden="true">
            {count}
          </span>
        </button>
      </li>
    );
  };

  const select = (id: string | null) => {
    setLegend(null);
    setSelectedId(id);
  };

  return (
    <div className="skill-tree-layout" data-testid="skill-tree-layout">
      <div className="skill-tree-jobs">
        {data.currentJob ? (
          <span>
            Сейчас:{" "}
            <a className="link-accent" href={data.currentJob.href}>
              {data.currentJob.name}
            </a>
          </span>
        ) : (
          <span className="muted">Должность без профиля</span>
        )}
        <span className="muted" aria-hidden="true">
          →
        </span>
        {data.targetJob ? (
          <span>
            Цель ИПР:{" "}
            <a className="link-accent" href={data.targetJob.href}>
              {data.targetJob.name}
            </a>
          </span>
        ) : (
          <span className="muted">активного ИПР нет</span>
        )}
      </div>

      <div className="skill-tree-main">
        <div className="skill-tree-toolbar">
          <label className="skill-tree-filter">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => {
                setShowAll(event.target.checked);
                setLegend(null);
              }}
            />
            Показывать всё дерево
          </label>

          <p className="skill-hint" data-testid="skill-panel-hint">
            Нажмите на навык — панель справа покажет критерий, материалы, пометку и строки плана.
          </p>
        </div>

        {professional.length > 0 ? (
          <section className="skill-group-block" aria-labelledby="skill-group-professional">
            <h2 className="skill-group-title" id="skill-group-professional">
              Профессиональные компетенции
              <span className="skill-group-count">{professional.length}</span>
            </h2>
            <SkillBoard
              nodes={professional}
              data={data}
              highlight={highlight}
              selectedId={selectedId}
              onSelect={select}
              label="Профессиональные компетенции"
              testId="skill-board-professional"
              topicOf={topicOf}
              prerequisiteOf={prerequisiteOf}
            />
          </section>
        ) : null}

        {personal.length > 0 ? (
          <section className="skill-group-block" aria-labelledby="skill-group-personal">
            <h2 className="skill-group-title" id="skill-group-personal">
              Личные компетенции
              <span className="skill-group-count">{personal.length}</span>
            </h2>
            <SkillBoard
              nodes={personal}
              data={data}
              highlight={highlight}
              selectedId={selectedId}
              onSelect={select}
              label="Личные компетенции"
              testId="skill-board-personal"
              topicOf={topicOf}
              prerequisiteOf={prerequisiteOf}
            />
          </section>
        ) : null}

        {outside.length > 0 ? (
          <section className="skill-group-block" aria-labelledby="skill-group-outside" data-testid="skill-outside">
            <h2 className="skill-group-title" id="skill-group-outside">
              Вне профиля
              <span className="skill-group-count">{outside.length}</span>
            </h2>
            <p className="skill-group-note">Навыки вне должности и цели ИПР остаются здесь, пока стоит пометка.</p>
            <SkillBoard
              nodes={outside}
              data={data}
              highlight={highlight}
              selectedId={selectedId}
              onSelect={select}
              label="Вне профиля"
              testId="skill-board-outside"
              topicOf={topicOf}
              prerequisiteOf={prerequisiteOf}
            />
          </section>
        ) : null}
      </div>

      {/* Колонка идёт в разметке после холста: на узком экране она и стоит под ним,
          и порядок фокуса совпадает с картинкой. На широком экране её место задаёт сетка. */}
      <aside className="skill-sidebar" aria-label="Легенда и статистика дерева">
        <section className="skill-sidebar__block">
          <h2 className="skill-sidebar__title">Легенда</h2>
          <ul className="skill-legend" aria-label="Обозначения дерева: выберите запись, чтобы выделить её узлы">
            {legendButton("has", "есть", "skill-legend__swatch--has")}
            {legendButton("in_progress", "в процессе", "skill-legend__swatch--progress")}
            {legendButton("lacks", "нет", "skill-legend__swatch--lacks")}
            {legendButton("none", "без пометки", "skill-legend__swatch--none")}
            {legendButton("confirmed", "подтверждено приёмкой", "skill-legend__swatch--star")}
            {legendButton("plan", "шаг ИПР", "skill-legend__swatch--plan")}
            <li>
              <span className="skill-legend__note">
                <span className="skill-legend__arrow" aria-hidden="true">
                  →
                </span>
                предпосылка: навык открывает следующий
              </span>
            </li>
            <li>
              <span className="skill-legend__note">Уровень на узле — требование должности, личного уровня в дереве нет.</span>
            </li>
          </ul>
        </section>

        <section
          className="skill-sidebar__block skill-stats"
          data-testid="skill-stats"
          aria-labelledby="skill-stats-title"
        >
          <h2 className="skill-sidebar__title" id="skill-stats-title">
            Статистика
          </h2>
          <dl className="skill-stats__grid">
            <dt>Всего навыков</dt>
            <dd data-testid="skill-stat-total">{stats.total}</dd>
            <dt>Освоено</dt>
            <dd data-testid="skill-stat-mastered">{stats.mastered}</dd>
            <dt>В плане</dt>
            <dd data-testid="skill-stat-plan">{stats.inPlan}</dd>
            <dt>Прогресс</dt>
            <dd data-testid="skill-stat-progress">{stats.progress}%</dd>
          </dl>
        </section>

        <p className="skill-sidebar__motto" data-testid="skill-motto">
          {motto}
        </p>
      </aside>
    </div>
  );
}
