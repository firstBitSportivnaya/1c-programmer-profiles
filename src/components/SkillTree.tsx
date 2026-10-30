"use client";

import { useMemo, useState } from "react";
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
} from "@xyflow/react";
import { useThemeMode } from "@/components/useThemeMode";
import { levelLabel, SkillNodePanel } from "@/components/SkillNodePanel";
import type { SkillTreeData, SkillTreeNode } from "@/lib/skill-tree";
import { buildPrerequisiteTree } from "@/lib/skill-tree-graph";
import { layoutSkillTree } from "@/lib/skill-tree-layout";

const NODE_W = 196;
const NODE_H = 88;
const GAP_X = 26;
const GAP_Y = 56;
const PAD = 32;

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

type SkillNodeData = { skill: SkillTreeNode; depth: number };

/** Узел дерева: планка должности, заливка пометки, значок шага плана и подтверждение. */
function SkillNodeView({ data }: NodeProps) {
  const { skill, depth } = data as unknown as SkillNodeData;
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

/** Ребро предпосылки: от родителя к производному навыку, состояние плана сюда не переносится. */
function SkillEdgeView({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd }: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <BaseEdge path={path} markerEnd={markerEnd} className="skill-edge" />;
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
  const [showAll, setShowAll] = useState(false);

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
      return {
        id: `skill:${node.id}`,
        type: "skill",
        position: { x: (spot?.x ?? 0) + PAD, y: (spot?.y ?? 0) + PAD },
        data: { skill: node, depth: spot?.depth ?? 0 },
        style: { width: NODE_W, height: NODE_H },
        className: branch && !branch.has(node.id) ? "skill-dim" : undefined,
        draggable: false,
        selectable: true,
        zIndex: 2,
      };
    });

    const edges: Edge[] = tree.edges
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => {
        const dim = branch !== null && !(branch.has(edge.source) && branch.has(edge.target));
        return {
          id: `prereq:${edge.source}:${edge.target}`,
          source: `skill:${edge.source}`,
          target: `skill:${edge.target}`,
          type: "prerequisite",
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--arrow)", width: 16, height: 16 },
          style: { stroke: "var(--arrow)", strokeWidth: 1.4, opacity: dim ? 0.12 : 1 },
          focusable: false,
          selectable: false,
        };
      });

    return { nodes, edges, width: layout.width + PAD * 2, height: layout.height + PAD * 2 };
  }, [branch, tree, visible]);

  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  return (
    <div className="skill-tree-layout">
      <div className="space-y-2">
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
          <span className="muted">→</span>
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
        <ul className="skill-legend" aria-label="Обозначения дерева">
          <li>
            <span className="skill-legend__swatch skill-legend__swatch--has" />есть
          </li>
          <li>
            <span className="skill-legend__swatch skill-legend__swatch--progress" />в процессе
          </li>
          <li>
            <span className="skill-legend__swatch skill-legend__swatch--lacks" />нет
          </li>
          <li>
            <span className="skill-legend__swatch skill-legend__swatch--none" />без пометки
          </li>
          <li>
            <span className="skill-legend__arrow">→</span>предпосылка: навык открывает следующий
          </li>
          <li>
            <span className="skill-legend__star">★</span>подтверждено приёмкой
          </li>
          <li>
            <span className="skill-legend__plan">○ ◔ ✓</span>шаг плана: не начат / в работе / принят
          </li>
        </ul>
        <label className="skill-tree-filter">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Показывать всё дерево
        </label>
        <div className="graph-shell panel skill-tree-shell">
          <ReactFlowProvider>
            <ReactFlow
              colorMode={theme}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.1, minZoom: 0.2, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.4}
              panOnDrag
              zoomOnScroll
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              noPanClassName="nopan"
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => {
                if (node.type === "skill") setSelectedId(node.id.slice("skill:".length));
              }}
              onPaneClick={() => setSelectedId(null)}
              onInit={(instance) => {
                instance.fitView({ padding: 0.1, minZoom: 0.2, maxZoom: 1 });
              }}
            >
              <Background color="var(--grid)" gap={24} />
              <Controls />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
      <div className="skill-panel-slot">
        {selected ? (
          <SkillNodePanel
            node={selected}
            context={relationContext(selected, data)}
            planId={data.planId}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <aside className="skill-panel panel panel-pad space-y-2" data-testid="skill-panel-hint">
            <p className="section-title mb-0">Узел</p>
            <p className="muted text-sm">
              Нажмите на навык, чтобы увидеть критерий, материалы, личную пометку и строки активного плана.
            </p>
            <p className="muted text-sm">
              Планка уровня — требование должности, а не оценка сотрудника. Личного уровня в дереве нет.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
