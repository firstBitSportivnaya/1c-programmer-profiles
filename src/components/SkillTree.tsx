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
import { levelLabel, SkillNodePanel, type SkillNodeTier } from "@/components/SkillNodePanel";
import type { SkillNode, SkillTreeData, TreeJob } from "@/lib/skill-tree";

const NODE_W = 210;
const NODE_H = 88;
const NODE_GAP = 12;
const GROUP_PAD = 10;
const GROUP_HEADER = 22;
const GROUP_GAP = 14;
const COL_GAP = 20;
const SECTION_GAP = 36;
const SECTION_HEADER = 30;
const TIER_HEADER = 64;
const JOB_W = 210;
const JOB_X = 24;
const CONTENT_X = JOB_X + JOB_W + 44;
const MAX_ROWS = 8;
const COL_W = NODE_W + GROUP_PAD * 2;
const MAX_COL_H = MAX_ROWS * NODE_H + (MAX_ROWS - 1) * NODE_GAP + GROUP_HEADER + GROUP_PAD * 2 + 40;

type SkillNodeData = { skill: SkillNode; tier: SkillNodeTier };
type SkillJobData = { label: string; subtitle: string; href: string };
type SkillTierData = { label: string; tone: "target" | "current" | "outside" };
type SkillGroupData = { label: string; key: string };
type SkillCaptionData = { label: string };

function SkillNodeView({ data }: NodeProps) {
  const { skill, tier } = data as unknown as SkillNodeData;
  const mark = skill.mark || "none";
  const planNote =
    skill.plan.total === 0
      ? null
      : skill.plan.state === "done"
        ? "шаг принят"
        : skill.plan.accepted > 0
          ? `принято ${skill.plan.accepted} из ${skill.plan.total}`
          : "шаг плана";
  return (
    <div
      className={`skill-node skill-node--${mark}${skill.confirmed ? " skill-node--confirmed" : ""}`}
      data-testid={`skill-node-${skill.id}`}
      data-tier={tier}
      data-mark={mark}
      data-confirmed={skill.confirmed ? "true" : "false"}
      data-plan-state={skill.plan.state}
      aria-label={`${skill.name}: ${levelLabel(skill)}, пометка ${MARK_LABEL[mark] ?? "нет"}`}
    >
      <Handle id="l" type="target" position={Position.Left} />
      {skill.confirmed ? (
        <span className="skill-node__badge" data-testid={`skill-badge-${skill.id}`} title="Компетенция подтверждена">
          ★
        </span>
      ) : null}
      {skill.level != null ? <span className="skill-node__level">{levelLabel(skill)}</span> : null}
      <span className="skill-node__name">{skill.name}</span>
      {planNote ? <span className="skill-node__plan">{planNote}</span> : null}
    </div>
  );
}

function SkillJobView({ data }: NodeProps) {
  const { label, subtitle, href } = data as unknown as SkillJobData;
  return (
    <a
      href={href}
      className="skill-job-card nopan"
      onClick={(event) => event.stopPropagation()}
      aria-label={`${subtitle}: ${label}`}
    >
      <Handle id="r" type="source" position={Position.Right} />
      <span className="skill-job-card__subtitle">{subtitle}</span>
      <span className="skill-job-card__name">{label}</span>
    </a>
  );
}

function SkillTierView({ data }: NodeProps) {
  const { label, tone } = data as unknown as SkillTierData;
  return (
    <div className={`skill-tier skill-tier--${tone}`} data-testid={`skill-tier-${tone}`}>
      <span className="skill-tier__label">{label}</span>
    </div>
  );
}

function SkillGroupView({ data }: NodeProps) {
  const { label, key } = data as unknown as SkillGroupData;
  return (
    <div className="skill-group-frame" data-testid={`skill-group-${key}`}>
      <span className="skill-group-label">{label}</span>
    </div>
  );
}

function SkillCaptionView({ data }: NodeProps) {
  const { label } = data as unknown as SkillCaptionData;
  return <div className="skill-section-label">{label}</div>;
}

const nodeTypes = {
  skill: SkillNodeView,
  "skill-job": SkillJobView,
  tier: SkillTierView,
  group: SkillGroupView,
  caption: SkillCaptionView,
};

/** Ребро плана: класс состояния на пути, чтобы цвет и штрих читались и в тестах, и в теме. */
function SkillEdgeView({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd }: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const state = (data as { state?: string } | undefined)?.state ?? "not_started";
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} className={`skill-edge skill-edge--${state}`} />;
}

const edgeTypes = { skill: SkillEdgeView };

const MARK_LABEL: Record<string, string> = {
  has: "есть",
  in_progress: "в процессе",
  lacks: "нет",
  none: "не отмечено",
};

const EDGE_STATE = {
  done: { color: "var(--arrow-emphasis)", width: 2.2 },
  in_progress: { color: "var(--cloud-stroke)", width: 2 },
  not_started: { color: "var(--arrow)", width: 1.4 },
} as const;

type PackedGroup = { key: string; title: string | null; skills: SkillNode[]; height: number };

function packGroups(skills: SkillNode[]): PackedGroup[][] {
  const map = new Map<string, { title: string | null; skills: SkillNode[] }>();
  for (const skill of skills) {
    const key = skill.groupId ?? `skill:${skill.id}`;
    const group = map.get(key) ?? { title: skill.groupName, skills: [] };
    group.skills.push(skill);
    map.set(key, group);
  }
  const groups: PackedGroup[] = [...map.entries()].map(([key, group]) => {
    const rows = group.skills.length;
    const frame = group.title ? GROUP_HEADER + GROUP_PAD * 2 : 0;
    return {
      key,
      title: group.title,
      skills: group.skills,
      height: frame + rows * NODE_H + Math.max(0, rows - 1) * NODE_GAP,
    };
  });
  // Крупные группы первыми: меньше колонок и крупнее масштаб при fitView.
  groups.sort((a, b) => b.height - a.height);

  const columns: PackedGroup[][] = [];
  let current: PackedGroup[] = [];
  let height = 0;
  for (const group of groups) {
    if (current.length > 0 && height + GROUP_GAP + group.height > MAX_COL_H) {
      columns.push(current);
      current = [];
      height = 0;
    }
    current.push(group);
    height += (current.length > 1 ? GROUP_GAP : 0) + group.height;
  }
  if (current.length > 0) columns.push(current);
  return columns;
}

function sectionWidth(columns: PackedGroup[][]) {
  return columns.length === 0 ? COL_W : columns.length * COL_W + (columns.length - 1) * COL_GAP;
}

function sectionHeight(columns: PackedGroup[][]) {
  let max = GROUP_HEADER;
  for (const column of columns) {
    const height = column.reduce((sum, group, index) => sum + group.height + (index > 0 ? GROUP_GAP : 0), 0);
    max = Math.max(max, height);
  }
  return max;
}

type TierSection = { key: string; title: string; skills: SkillNode[] };

function layoutTier({
  prefix,
  job,
  sections,
  label,
  tone,
  top,
  withEdges,
}: {
  prefix: string;
  job: TreeJob | null;
  sections: TierSection[];
  label: string;
  tone: SkillTierData["tone"];
  top: number;
  withEdges: boolean;
}): { nodes: Node[]; edges: Edge[]; width: number; height: number } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const contentTop = top + TIER_HEADER;
  const sectionPack = sections.map((section) => ({ section, columns: packGroups(section.skills) }));
  const totalWidth = sectionPack.reduce(
    (sum, item, index) => sum + sectionWidth(item.columns) + (index > 0 ? SECTION_GAP : 0),
    0,
  );
  const contentWidth = Math.max(totalWidth, JOB_W);
  const tierWidth = CONTENT_X + contentWidth + 24;
  const maxSectionHeight = sectionPack.reduce((max, item) => Math.max(max, sectionHeight(item.columns)), 0);
  const tierHeight = TIER_HEADER + SECTION_HEADER + maxSectionHeight + 24;

  nodes.push({
    id: `${prefix}:tier`,
    type: "tier",
    position: { x: 0, y: top },
    data: { label, tone },
    style: { width: tierWidth, height: tierHeight, pointerEvents: "none" },
    selectable: false,
    draggable: false,
    zIndex: 0,
  });

  const jobId = `${prefix}:job`;
  if (job) {
    nodes.push({
      id: jobId,
      type: "skill-job",
      position: { x: JOB_X, y: contentTop + 8 },
      data: { label: job.name, subtitle: tone === "target" ? "Цель ИПР" : "Сейчас", href: job.href },
      style: { width: JOB_W },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });
  }

  let sectionX = CONTENT_X;
  for (const { section, columns } of sectionPack) {
    const width = sectionWidth(columns);
    nodes.push({
      id: `${prefix}:caption:${section.key}`,
      type: "caption",
      position: { x: sectionX, y: contentTop },
      data: { label: section.title },
      style: { width, height: SECTION_HEADER, pointerEvents: "none" },
      selectable: false,
      draggable: false,
      zIndex: 2,
    });

    columns.forEach((column, columnIndex) => {
      const columnX = sectionX + columnIndex * (COL_W + COL_GAP);
      let cursorY = contentTop + SECTION_HEADER;
      for (const group of column) {
        const frameTop = cursorY;
        if (group.title) {
          nodes.push({
            id: `${prefix}:group:${group.key}`,
            type: "group",
            position: { x: columnX, y: frameTop },
            data: { label: group.title, key: group.key },
            style: { width: COL_W, height: group.height, pointerEvents: "none" },
            selectable: false,
            draggable: false,
            zIndex: 1,
          });
        }
        const skillTop = frameTop + (group.title ? GROUP_PAD + GROUP_HEADER : 0);
        group.skills.forEach((skill, index) => {
          const nodeId = `${prefix}:skill:${skill.id}`;
          nodes.push({
            id: nodeId,
            type: "skill",
            position: { x: columnX + GROUP_PAD, y: skillTop + index * (NODE_H + NODE_GAP) },
            data: { skill, tier: tone as SkillNodeTier },
            style: { width: NODE_W, height: NODE_H },
            selectable: true,
            draggable: false,
            zIndex: 3,
          });
          if (withEdges && job) {
            const state = EDGE_STATE[skill.plan.state];
            edges.push({
              id: `${prefix}:edge:${skill.id}`,
              source: jobId,
              target: nodeId,
              sourceHandle: "r",
              targetHandle: "l",
              type: "skill",
              data: { state: skill.plan.state },
              style: { stroke: state.color, strokeWidth: state.width, opacity: skill.plan.state === "not_started" ? 0.55 : 0.95 },
              markerEnd: { type: MarkerType.ArrowClosed, color: state.color, width: 14, height: 14 },
              focusable: false,
              selectable: false,
            });
          }
        });
        cursorY = frameTop + group.height + GROUP_GAP;
      }
    });
    sectionX += width + SECTION_GAP;
  }

  return { nodes, edges, width: tierWidth, height: tierHeight };
}

function outsideSections(outside: SkillNode[]): TierSection[] {
  return (["technical", "personal"] as const)
    .map((key) => ({
      key,
      title: key === "technical" ? "Профессиональные" : "Личные",
      skills: outside.filter((skill) => skill.section === key),
    }))
    .filter((section) => section.skills.length > 0);
}

/** Холст дерева: два яруса, группа «Вне профиля», рёбра — шаги активного плана. */
export function SkillTree({ data }: { data: SkillTreeData }) {
  const theme = useThemeMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let top = 0;
    const gap = 40;

    if (data.target) {
      const tier = layoutTier({
        prefix: "target",
        job: data.target.job,
        sections: data.target.sections,
        label: `Цель активного ИПР · ${data.target.job.name}`,
        tone: "target",
        top,
        withEdges: true,
      });
      nodes.push(...tier.nodes);
      edges.push(...tier.edges);
      top += tier.height + gap;
    }

    if (data.current) {
      const tier = layoutTier({
        prefix: "current",
        job: data.current.job,
        sections: data.current.sections,
        label: `Сейчас · ${data.current.job.name}`,
        tone: "current",
        top,
        withEdges: false,
      });
      nodes.push(...tier.nodes);
      top += tier.height + gap;
    }

    if (data.outside.length > 0) {
      const tier = layoutTier({
        prefix: "outside",
        job: null,
        sections: outsideSections(data.outside),
        label: "Вне профиля · навыки, которых больше нет в должности и цели",
        tone: "outside",
        top,
        withEdges: false,
      });
      nodes.push(...tier.nodes);
      top += tier.height;
    }

    return { nodes, edges, height: Math.max(top, 240) };
  }, [data]);

  const skillIndex = useMemo(() => {
    const map = new Map<string, { skill: SkillNode; tier: SkillNodeTier }>();
    if (data.target) {
      for (const section of data.target.sections) {
        for (const skill of section.skills) map.set(skill.id, { skill, tier: "target" });
      }
    }
    if (data.current) {
      for (const section of data.current.sections) {
        for (const skill of section.skills) map.set(skill.id, { skill, tier: "current" });
      }
    }
    for (const skill of data.outside) map.set(skill.id, { skill, tier: "outside" });
    return map;
  }, [data]);

  const selected = selectedId ? skillIndex.get(selectedId) : null;

  return (
    <div className="skill-tree-layout">
      <div className="space-y-2">
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
            <span className="skill-legend__star">★</span>рамка и значок — подтверждено приёмкой
          </li>
          <li>
            <span className="skill-legend__line skill-legend__line--done" />
            <span className="skill-legend__line skill-legend__line--progress" />
            <span className="skill-legend__line skill-legend__line--idle" />
            шаг плана: принят / в работе / не начат
          </li>
        </ul>
        <div className="graph-shell panel skill-tree-shell">
          <ReactFlowProvider>
            <ReactFlow
              colorMode={theme}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.08, minZoom: 0.2, maxZoom: 1 }}
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
                if (node.type === "skill") {
                  setSelectedId((node.data as unknown as SkillNodeData).skill.id);
                }
              }}
              onPaneClick={() => setSelectedId(null)}
              onInit={(instance) => {
                instance.fitView({ padding: 0.08, minZoom: 0.2, maxZoom: 1 });
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
            node={selected.skill}
            tier={selected.tier}
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
