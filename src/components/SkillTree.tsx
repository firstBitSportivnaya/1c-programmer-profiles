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
} from "@xyflow/react";
import { useThemeMode } from "@/components/useThemeMode";
import { levelLabel, SkillNodePanel } from "@/components/SkillNodePanel";
import type { SkillTreeData, SkillTreeNode } from "@/lib/skill-tree";
import { buildPrerequisiteTree } from "@/lib/skill-tree-graph";
import { layoutSkillTree } from "@/lib/skill-tree-layout";

const NODE_W = 196;
const NODE_H = 96;
const GAP_X = 26;
const GAP_Y = 52;
const PAD = 32;

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
type LegendKey = "has" | "in_progress" | "lacks" | "none" | "confirmed" | "plan" | "prereq";

const LEGEND_MATCH: Record<Exclude<LegendKey, "prereq">, (node: SkillTreeNode) => boolean> = {
  has: (node) => node.mark === "has",
  in_progress: (node) => node.mark === "in_progress",
  lacks: (node) => node.mark === "lacks",
  none: (node) => !node.mark,
  confirmed: (node) => node.confirmed,
  plan: (node) => node.plan.total > 0,
};

type SkillNodeData = { skill: SkillTreeNode; depth: number; dimmed: boolean };

/** Узел дерева: планка должности, заливка пометки, значок шага плана и подтверждение. */
function SkillNodeView({ data }: NodeProps) {
  const { skill, depth, dimmed } = data as unknown as SkillNodeData;
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
      data-testid={`skill-node-${skill.id}`}
      data-depth={depth}
      data-relation={skill.relation}
      data-mark={mark}
      data-confirmed={skill.confirmed ? "true" : "false"}
      data-plan-state={skill.plan.total === 0 ? "none" : skill.plan.state}
      data-dimmed={dimmed ? "true" : "false"}
      aria-label={`${skill.name}: ${levelLabel(skill)}, пометка ${MARK_LABEL[mark] ?? "не отмечено"}`}
    >
      <Handle type="target" position={Position.Top} />
      {skill.confirmed ? (
        <span className="skill-node__badge" data-testid={`skill-badge-${skill.id}`} title="Компетенция подтверждена">
          ★
        </span>
      ) : null}
      {skill.groupName ? <span className="skill-node__group">{skill.groupName}</span> : null}
      <span className="skill-node__name">{skill.name}</span>
      <span className="skill-node__foot">
        <span className="skill-node__level">{levelLabel(skill)}</span>
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

/** Навык и его предки остаются на холсте: ветвь читается от корня, даже если узлы вне профиля. */
function keepRelevant(data: SkillTreeData, parentOf: Map<string, string>): Set<string> {
  const keep = new Set<string>();
  for (const node of data.nodes) {
    if (node.relation !== "none" || node.mark) keep.add(node.id);
  }
  const stack = [...keep];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const parent = parentOf.get(id);
    if (parent !== undefined && !keep.has(parent)) {
      keep.add(parent);
      stack.push(parent);
    }
  }
  return keep;
}

/** Холст дерева навыков: слои предпосылок сверху вниз, личный слой на узлах. */
export function SkillTree({ data }: { data: SkillTreeData }) {
  const theme = useThemeMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legend, setLegend] = useState<LegendKey | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  const tree = useMemo(() => buildPrerequisiteTree(data.nodes.map((node) => node.id)), [data.nodes]);

  const visible = useMemo(() => {
    if (showAll) return data.nodes;
    const keep = keepRelevant(data, tree.parentOf);
    return data.nodes.filter((node) => keep.has(node.id));
  }, [data, showAll, tree]);

  /** Ветвь выбранного узла: предки и потомки, остальное приглушается. */
  const branch = useMemo(() => {
    if (!selectedId) return null;
    const keep = new Set<string>([selectedId]);
    let parent = tree.parentOf.get(selectedId);
    while (parent !== undefined && !keep.has(parent)) {
      keep.add(parent);
      parent = tree.parentOf.get(parent);
    }
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
    if (legend === "prereq") return null;
    return new Set(visible.filter(LEGEND_MATCH[legend]).map((node) => node.id));
  }, [branch, legend, visible]);

  /** Сколько узлов даёт каждая запись легенды: пустую выбирать не за что. */
  const legendCount = useMemo(() => {
    const counts = {} as Record<Exclude<LegendKey, "prereq">, number>;
    for (const key of Object.keys(LEGEND_MATCH) as Exclude<LegendKey, "prereq">[]) {
      counts[key] = visible.filter(LEGEND_MATCH[key]).length;
    }
    return counts;
  }, [visible]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  /**
   * Карточка стоит поверх правого края холста: если выбранный узел оказался под ней,
   * сдвигаем весь холст влево, чтобы ветвь осталась на виду (как камера в archify).
   */
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      const shell = shellRef.current;
      const instance = flowRef.current;
      const popup = shell?.querySelector<HTMLElement>(".skill-popup");
      const node = shell?.querySelector<HTMLElement>(`[data-id="skill:${selectedId}"]`);
      if (!shell || !instance || !popup || !node) return;
      const pop = popup.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const overlaps = box.right > pop.left && box.left < pop.right && box.bottom > pop.top && box.top < pop.bottom;
      if (!overlaps) return;
      const shift = box.right + 24 - pop.left;
      const viewport = instance.getViewport();
      instance.setViewport({ ...viewport, x: viewport.x - shift }, { duration: 260 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  const graph = useMemo(() => {
    const ids = visible.map((node) => node.id);
    const layout = layoutSkillTree(tree, ids, {
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      gapX: GAP_X,
      gapY: GAP_Y,
    });
    const positions = new Map(layout.nodes.map((row) => [row.id, row]));
    const shown = new Set(ids);

    const nodes: Node[] = visible.map((node) => {
      const spot = positions.get(node.id);
      const dimmed = highlight !== null && !highlight.has(node.id);
      return {
        id: `skill:${node.id}`,
        type: "skill",
        position: { x: (spot?.x ?? 0) + PAD, y: (spot?.y ?? 0) + PAD },
        data: { skill: node, depth: spot?.depth ?? 0, dimmed },
        style: { width: NODE_W, height: NODE_H },
        className: dimmed ? "skill-dim" : highlight !== null ? "skill-lit" : undefined,
        draggable: false,
        selectable: true,
        zIndex: 2,
      };
    });

    const edges: Edge[] = tree.edges
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => {
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
            width: 16,
            height: 16,
          },
          style: {
            stroke: lit ? "var(--arrow-emphasis)" : "var(--arrow)",
            strokeWidth: lit ? 2 : 1.4,
            opacity: dim ? 0.12 : 1,
          },
          focusable: false,
          selectable: false,
        };
      });

    return { nodes, edges, width: layout.width + PAD * 2, height: layout.height + PAD * 2 };
  }, [highlight, tree, visible]);

  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  const toggleLegend = (key: LegendKey) => {
    if (key === "prereq") return;
    setLegend((current) => (current === key ? null : key));
    setSelectedId(null);
  };

  const legendButton = (key: Exclude<LegendKey, "prereq">, label: string, swatch: string) => {
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

  return (
    <div className="skill-tree-layout">
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
      </ul>

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

      <div className="graph-shell panel skill-tree-shell" ref={shellRef}>
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
            elementsSelectable
            noPanClassName="nopan"
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (node.type !== "skill") return;
              setLegend(null);
              setSelectedId(node.id.slice("skill:".length));
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setLegend(null);
            }}
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
          <div className="skill-popup" data-testid="skill-panel-slot">
            <SkillNodePanel
              node={selected}
              context={relationContext(selected, data)}
              planId={data.planId}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : (
          <p className="skill-hint" data-testid="skill-panel-hint">
            Нажмите на навык: критерий, материалы, пометка и строки плана откроются поверх холста.{" "}
            <span className="skill-hint__note">Планка — требование должности, личного уровня в дереве нет.</span>
          </p>
        )}
      </div>
    </div>
  );
}
