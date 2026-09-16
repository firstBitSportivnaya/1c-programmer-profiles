"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useRouter } from "next/navigation";

type Job = {
  id: string;
  name: string;
  rankOrder: number;
  lane: "executor" | "manager" | "other";
};

type Transition = { fromJobId: string; toJobId: string; kind: "linear" | "level_change" };

type ClusterTone = "junior" | "middle" | "senior" | "architect" | "lead" | "pm" | "head";

const JOB_W = 210;

const LAYOUT: Record<string, { x: number; y: number }> = {
  intern: { x: 72, y: 108 },
  junior: { x: 72, y: 178 },
  programmer: { x: 72, y: 318 },
  senior: { x: 72, y: 388 },
  consultant: { x: 348, y: 353 },
  lead: { x: 72, y: 568 },
  devops: { x: 328, y: 528 },
  mentor: { x: 328, y: 594 },
  "functional-expert": { x: 328, y: 660 },
  architect: { x: 72, y: 808 },
  "team-lead": { x: 668, y: 478 },
  "tech-pm": { x: 668, y: 548 },
  pm: { x: 668, y: 718 },
  "dept-head": { x: 968, y: 478 },
  "office-head": { x: 968, y: 548 },
};

const EDGE_HANDLES: Record<string, { source: string; target: string }> = {
  "intern-junior": { source: "b", target: "t" },
  "junior-programmer": { source: "b", target: "t" },
  "programmer-senior": { source: "b", target: "t" },
  "programmer-consultant": { source: "r", target: "l" },
  "senior-consultant": { source: "r", target: "l" },
  "senior-lead": { source: "b", target: "t" },
  "lead-devops": { source: "r", target: "l" },
  "lead-mentor": { source: "r", target: "l" },
  "lead-functional-expert": { source: "r", target: "l" },
  "lead-architect": { source: "b", target: "t" },
  "lead-team-lead": { source: "r", target: "l" },
  "lead-tech-pm": { source: "r", target: "l" },
  "consultant-team-lead": { source: "r", target: "l" },
  "architect-team-lead": { source: "r", target: "l" },
  "team-lead-pm": { source: "b", target: "t" },
  "tech-pm-pm": { source: "b", target: "t" },
  "team-lead-dept-head": { source: "r", target: "l" },
  "pm-dept-head": { source: "r", target: "tb" },
  "dept-head-office-head": { source: "b", target: "t" },
};

const EDGE_LABELS: Record<string, string> = {
  "lead-architect": "технологическое развитие",
  "consultant-team-lead": "хочет руководить",
};

function JobNode({ data }: NodeProps) {
  const filled = Boolean((data as { filled?: boolean }).filled);
  const label = String((data as { label?: string }).label ?? "");
  return (
    <div className={filled ? "job-card job-card--filled" : "job-card"}>
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="st" type="source" position={Position.Top} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="tb" type="target" position={Position.Bottom} />
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      {label}
    </div>
  );
}

function ClusterNode({ data }: NodeProps) {
  const label = String((data as { label?: string }).label ?? "");
  const tone = String((data as { tone?: ClusterTone }).tone ?? "middle");
  return (
    <div className={`cluster-frame cluster-${tone}`}>
      <span className="cluster-label">{label}</span>
    </div>
  );
}

function LaneNode({ data }: NodeProps) {
  return <div className="lane-frame">{String((data as { label?: string }).label ?? "")}</div>;
}

const nodeTypes = { job: JobNode, cluster: ClusterNode, lane: LaneNode };

function useArchifyTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function CareerGraph({
  jobs,
  transitions,
  profileJobIds,
}: {
  jobs: Job[];
  transitions: Transition[];
  profileJobIds: string[];
}) {
  const router = useRouter();
  const theme = useArchifyTheme();
  const hasProfile = new Set(profileJobIds);

  const nodes: Node[] = useMemo(() => {
    const lanes: Node[] = [
      {
        id: "lane-executor",
        type: "lane",
        position: { x: 16, y: 8 },
        data: { label: "Исполнитель" },
        style: { width: 580, height: 920 },
        selectable: false,
        draggable: false,
        zIndex: 0,
      },
      {
        id: "lane-manager",
        type: "lane",
        position: { x: 616, y: 8 },
        data: { label: "Руководитель" },
        style: { width: 620, height: 920 },
        selectable: false,
        draggable: false,
        zIndex: 0,
      },
    ];
    const clusters: Node[] = [
      { id: "c-junior", type: "cluster", position: { x: 40, y: 56 }, data: { label: "Junior", tone: "junior" }, style: { width: 274, height: 196 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-middle", type: "cluster", position: { x: 40, y: 268 }, data: { label: "Middle", tone: "middle" }, style: { width: 274, height: 196 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-senior", type: "cluster", position: { x: 40, y: 480 }, data: { label: "Senior", tone: "senior" }, style: { width: 530, height: 256 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-architect", type: "cluster", position: { x: 40, y: 752 }, data: { label: "Architect", tone: "architect" }, style: { width: 274, height: 140 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-team-lead", type: "cluster", position: { x: 640, y: 424 }, data: { label: "Team lead", tone: "lead" }, style: { width: 268, height: 200 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-pm", type: "cluster", position: { x: 640, y: 660 }, data: { label: "Project manager", tone: "pm" }, style: { width: 268, height: 140 }, selectable: false, draggable: false, zIndex: 1 },
      { id: "c-head", type: "cluster", position: { x: 940, y: 424 }, data: { label: "Head", tone: "head" }, style: { width: 268, height: 200 }, selectable: false, draggable: false, zIndex: 1 },
    ];
    const jobNodes: Node[] = jobs.map((job, index) => {
      const pos = LAYOUT[job.id] ?? { x: 72, y: 940 + index * 66 };
      return {
        id: job.id,
        type: "job",
        position: pos,
        data: { label: job.name, filled: hasProfile.has(job.id) },
        style: { width: JOB_W },
        draggable: false,
        zIndex: 3,
      };
    });
    return [...lanes, ...clusters, ...jobNodes];
  }, [jobs, profileJobIds]);

  const edges: Edge[] = useMemo(
    () =>
      transitions.map((tr) => {
        const key = `${tr.fromJobId}-${tr.toJobId}`;
        const handles = EDGE_HANDLES[key];
        const change = tr.kind === "level_change";
        const color = change ? "var(--security-stroke)" : "var(--arrow)";
        return {
          id: key,
          source: tr.fromJobId,
          target: tr.toJobId,
          sourceHandle: handles?.source,
          targetHandle: handles?.target,
          type: "smoothstep",
          label: EDGE_LABELS[key],
          labelStyle: { fill: "var(--text-muted)", fontSize: 10, fontFamily: "inherit" },
          labelBgStyle: { fill: "var(--mask)", fillOpacity: 0.9 },
          labelBgPadding: [4, 6] as [number, number],
          labelBgBorderRadius: 4,
          animated: false,
          style: {
            stroke: color,
            strokeWidth: change ? 2 : 1.5,
            strokeDasharray: change ? "7 5" : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        };
      }),
    [transitions],
  );

  return (
    <div className="graph-shell panel">
      <ReactFlowProvider>
        <ReactFlow
          colorMode={theme}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1, minZoom: 0.35, maxZoom: 1.15 }}
          minZoom={0.35}
          maxZoom={1.4}
          panOnDrag
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onInit={(instance) => {
            instance.fitView({ padding: 0.1, minZoom: 0.35, maxZoom: 1.15 });
          }}
          onNodeClick={(_, node) => {
            if (node.type !== "job") return;
            router.push(`/jobs/${node.id}`);
          }}
        >
          <Background color="var(--grid)" gap={24} />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
