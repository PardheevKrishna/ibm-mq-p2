import { useMemo } from "react";
import type { Topology } from "../api/types";

/**
 * SVG topology graph. Apps on the left, queue managers in the center,
 * destination apps on the right (when applicable). Lines colored by flow
 * type. The layout is deterministic (computed from inputs) so the same
 * inputs always render the same picture.
 */

interface Props {
  topology: Topology;
  highlightAppId?: string;
  variant: "source" | "target";
  onAppClick?: (appId: string) => void;
}

export default function TopologyGraph({ topology, highlightAppId, variant, onAppClick }: Props) {
  const { width, height, nodes, edges } = useMemo(() => layout(topology), [topology]);

  return (
    <div className="wf-topo-shell wf-scroll" style={{ overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: "100%", display: "block" }}
      >
        <defs>
          <marker id={`arrow-${variant}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--wf-red)" />
          </marker>
          <marker id={`arrow-mute-${variant}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--wf-mute)" />
          </marker>
          <linearGradient id={`qm-grad-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wf-white)" />
            <stop offset="100%" stopColor="#FCF7EE" />
          </linearGradient>
        </defs>

        {/* edges first, so nodes paint above */}
        {edges.map((e, i) => {
          const muted = highlightAppId && e.appId !== highlightAppId;
          return (
            <g key={i} opacity={muted ? 0.18 : 1}>
              <path
                d={curve(e.x1, e.y1, e.x2, e.y2)}
                fill="none"
                stroke={e.kind === "Remote" ? "var(--wf-red)" : "var(--wf-mute)"}
                strokeWidth={e.kind === "Remote" ? 1.6 : 1}
                strokeDasharray={e.kind === "Remote" ? "0" : "4 4"}
                markerEnd={e.kind === "Remote" ? `url(#arrow-${variant})` : `url(#arrow-mute-${variant})`}
              />
            </g>
          );
        })}

        {nodes.map((n) => {
          const isQm = n.kind === "qm";
          const clickableAppId = n.kind === "app" ? n.appId : (n as any).hostsApp as string | undefined;
          const isHighlighted =
            highlightAppId &&
            (n.appId === highlightAppId ||
              (n.kind === "qm" && (n as any).hostsApp === highlightAppId));
          const muted = highlightAppId && !isHighlighted;
          const clickable = onAppClick && clickableAppId;
          return (
            <g
              key={n.id}
              opacity={muted ? 0.32 : 1}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={clickable ? () => onAppClick!(clickableAppId!) : undefined}
              style={clickable ? { cursor: "pointer" } : undefined}
            >
              {isQm ? (
                <>
                  <rect
                    x={-90} y={-26} width={180} height={52} rx={10}
                    fill={`url(#qm-grad-${variant})`}
                    stroke={isHighlighted ? "var(--wf-red)" : (n as any).isTarget ? "var(--wf-red)" : "var(--wf-line)"}
                    strokeWidth={isHighlighted ? 2.5 : (n as any).isTarget ? 2 : 1}
                    filter={isHighlighted ? "drop-shadow(0 0 6px rgba(215,30,40,0.35))" : undefined}
                  />
                  <text x={0} y={-6} textAnchor="middle" fontFamily="var(--wf-font-mono)" fontSize="12.5" fontWeight="700" fill="var(--wf-ink)">
                    {n.label}
                  </text>
                  <text x={0} y={10} textAnchor="middle" fontSize="10.5" fill="var(--wf-mute)">
                    {(n as any).sub}
                  </text>
                  <circle cx={-78} cy={-14} r={4} fill={(n as any).health === "ok" ? "var(--wf-good)" : (n as any).health === "down" ? "var(--wf-bad)" : "var(--wf-warn)"} />
                </>
              ) : (
                <>
                  <rect
                    x={-78} y={-22} width={156} height={44} rx={8}
                    fill={isHighlighted ? "var(--wf-red-50)" : "var(--wf-white)"}
                    stroke="var(--wf-red)"
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    filter={isHighlighted ? "drop-shadow(0 0 6px rgba(215,30,40,0.35))" : undefined}
                  />
                  <text x={0} y={-3} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--wf-red-dark)">
                    {n.label}
                  </text>
                  <text x={0} y={11} textAnchor="middle" fontSize="9.5" fill="var(--wf-mute)">
                    {(n as any).sub}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface Node {
  id: string;
  kind: "app" | "qm";
  label: string;
  x: number;
  y: number;
  appId?: string;
}
interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  kind: "Local" | "Remote";
  appId: string;
}

function layout(t: Topology): { width: number; height: number; nodes: Node[]; edges: Edge[] } {
  const apps = t.apps;
  const qmList = Object.values(t.qms).sort((a, b) => a.name.localeCompare(b.name));

  const colW = 260;
  const rowApp = 64;
  const rowQm = 76;
  const padding = 40;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  apps.forEach((a, i) => {
    nodes.push({
      id: `app-${a.appId}`,
      kind: "app",
      label: a.appId,
      x: padding + 90,
      y: padding + i * rowApp,
      appId: a.appId,
      ...({ sub: shorten(a.appName, 22) } as any),
    } as Node);
  });

  qmList.forEach((q, i) => {
    nodes.push({
      id: `qm-${q.name}`,
      kind: "qm",
      label: q.name,
      x: padding + 90 + colW + 90,
      y: padding + i * rowQm,
      ...({ sub: `${q.region ?? ""} · ${q.zone ?? ""}`, health: q.health, isTarget: q.isTarget, hostsApp: q.apps[0] } as any),
    } as Node);
  });

  // app -> qm bindings (consumer/producer relationships)
  for (const a of apps) {
    const qms = qmList.filter((q) => q.apps.includes(a.appId));
    const aNode = nodes.find((n) => n.id === `app-${a.appId}`)!;
    for (const q of qms) {
      const qNode = nodes.find((n) => n.id === `qm-${q.name}`)!;
      edges.push({ x1: aNode.x + 78, y1: aNode.y, x2: qNode.x - 90, y2: qNode.y, kind: "Local", appId: a.appId });
    }
  }
  // qm -> qm flows (Remote)
  for (const f of t.flows) {
    if (f.flowType !== "Remote" || f.producer.qm === f.consumer.qm) continue;
    const a = nodes.find((n) => n.id === `qm-${f.producer.qm}`);
    const b = nodes.find((n) => n.id === `qm-${f.consumer.qm}`);
    if (!a || !b) continue;
    edges.push({ x1: a.x + 90, y1: a.y, x2: b.x - 90, y2: b.y, kind: "Remote", appId: f.producer.appId });
  }

  const height = Math.max(
    padding * 2 + apps.length * rowApp,
    padding * 2 + qmList.length * rowQm
  );
  const width = padding + 90 + colW + 90 + 90 + padding;
  return { width, height, nodes, edges };
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function shorten(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
