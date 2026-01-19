import React from "react";
import ReactECharts from "echarts-for-react";
import type { Edge, Node } from "../api";

const DOMAIN_COLORS: Record<string, string> = {
  Core: "#fbbf24",
  Mathematics: "#60a5fa",
  Physics: "#a78bfa",
  "Computer Science": "#22d3ee",
  Biology: "#f472b6",
  Economics: "#f59e0b",
  Bridge: "#38bdf8"
};

function colorFor(domain: string): string {
  return DOMAIN_COLORS[domain] || "#374151";
}

export function GraphView(props: {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string | null, source: string, target: string, relation: string) => void;
  focusNodeId?: string | null;
  dimToPathEdgeIds?: Set<string>;
  enableEdgeFlow?: boolean;
}) {
  const chartRef = React.useRef<ReactECharts>(null);

  const updateEdgeFlow = React.useCallback(() => {
    if (!props.enableEdgeFlow) return;
    const chart = chartRef.current?.getEchartsInstance?.();
    if (!chart) return;

    try {
      const model: any = chart.getModel?.();
      const series: any = model?.getSeriesByIndex?.(0);
      const data: any = series?.getData?.();
      const count: number = data?.count?.() ?? 0;

      const posById = new Map<string, { x: number; y: number }>();
      for (let i = 0; i < count; i++) {
        const id = data.getItemModel ? data.getItemModel(i)?.get("id") : data.getId?.(i);
        const layout = data.getItemLayout(i);
        const x = Array.isArray(layout) ? layout[0] : layout?.x;
        const y = Array.isArray(layout) ? layout[1] : layout?.y;
        if (id && typeof x === "number" && typeof y === "number") {
          posById.set(String(id), { x, y });
        }
      }

      // Choose a small number of edges to animate (avoid perf issues)
      let edgesToFlow = props.edges.filter((e) => e.relation === "bridges");
      if (props.dimToPathEdgeIds && props.dimToPathEdgeIds.size) {
        edgesToFlow = props.edges.filter((e) => props.dimToPathEdgeIds?.has(String(e.id ?? "")));
      }
      edgesToFlow = edgesToFlow.slice(0, 10);

      const elements: any[] = [];
      edgesToFlow.forEach((e, idx) => {
        const s = posById.get(e.source);
        const t = posById.get(e.target);
        if (!s || !t) return;
        const color = (e.flags || []).includes("conflict") ? "#f59e0b" : "#22d3ee";
        const baseId = `flow:${e.id ?? `${e.source}-${e.target}-${idx}`}`;

        // 2 particles per edge for a richer look
        for (let k = 0; k < 2; k++) {
          const id = `${baseId}:${k}`;
          const duration = 1400 + (idx % 5) * 140 + k * 160;
          const delay = (idx * 90 + k * 220) % 900;
          elements.push({
            id,
            type: "circle",
            silent: true,
            z: 50,
            shape: { r: 2.4 },
            style: { fill: color, opacity: 0.9, shadowBlur: 10, shadowColor: "rgba(34,211,238,0.75)" },
            x: s.x,
            y: s.y,
            keyframeAnimation: {
              duration,
              delay,
              loop: true,
              easing: "linear",
              keyframes: [
                { percent: 0, x: s.x, y: s.y, style: { opacity: 0.0 } },
                { percent: 0.12, x: s.x + (t.x - s.x) * 0.12, y: s.y + (t.y - s.y) * 0.12, style: { opacity: 0.95 } },
                { percent: 1, x: t.x, y: t.y, style: { opacity: 0.0 } }
              ]
            }
          });
        }
      });

      chart.setOption(
        {
          graphic: { elements }
        },
        { replaceMerge: ["graphic"] as any, lazyUpdate: true }
      );
    } catch {
      // ignore
    }
  }, [props.enableEdgeFlow, props.edges, props.dimToPathEdgeIds]);

  // Smooth "fly-to" + pulse highlight when focusNodeId changes
  React.useEffect(() => {
    if (!props.focusNodeId) return;
    const ref = chartRef.current;
    const chart = ref?.getEchartsInstance?.();
    if (!chart) return;

    const node = props.nodes.find((n) => n.id === props.focusNodeId) || null;
    if (!node) return;

    // try to compute dx/dy to center the node (best-effort)
    try {
      const model: any = chart.getModel?.();
      const series: any = model?.getSeriesByIndex?.(0);
      const data: any = series?.getData?.();
      const count: number = data?.count?.() ?? 0;
      let found = -1;
      for (let i = 0; i < count; i++) {
        const id = data.getItemModel ? data.getItemModel(i)?.get("id") : data.getId?.(i);
        if (id === node.id) {
          found = i;
          break;
        }
      }

      if (found >= 0) {
        const layout = data.getItemLayout(found);
        const w = chart.getWidth();
        const h = chart.getHeight();
        const x = Array.isArray(layout) ? layout[0] : layout?.x;
        const y = Array.isArray(layout) ? layout[1] : layout?.y;
        if (typeof x === "number" && typeof y === "number") {
          chart.dispatchAction({ type: "graphRoam", seriesIndex: 0, dx: w / 2 - x, dy: h / 2 - y, zoom: 1.15 });
        }
      }
    } catch {}

    // focus adjacency + tooltip
    chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
    chart.dispatchAction({ type: "highlight", seriesIndex: 0, name: node.name });
    chart.dispatchAction({ type: "focusNodeAdjacency", seriesIndex: 0, name: node.name });
    chart.dispatchAction({ type: "showTip", seriesIndex: 0, name: node.name });

    // pulse
    let on = false;
    const t = setInterval(() => {
      on = !on;
      chart.dispatchAction({ type: on ? "highlight" : "downplay", seriesIndex: 0, name: node.name });
    }, 420);
    return () => clearInterval(t);
  }, [props.focusNodeId, props.nodes]);

  // Keep particles in sync with layout + roam
  React.useEffect(() => {
    const chart = chartRef.current?.getEchartsInstance?.();
    if (!chart) return;
    let t: any = null;
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => updateEdgeFlow(), 40);
    };

    // ECharts graph emits these
    chart.on("finished", schedule);
    chart.on("graphRoam", schedule);
    schedule();

    return () => {
      if (t) clearTimeout(t);
      chart.off("finished", schedule);
      chart.off("graphRoam", schedule);
    };
  }, [updateEdgeFlow]);

  const option = React.useMemo(() => {
    const data = props.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      value: n.domain,
      symbolSize: 14 + Math.round((n.confidence ?? 0.7) * 20),
      itemStyle: { color: colorFor(n.domain), shadowBlur: 24, shadowColor: "rgba(34,211,238,0.45)" },
      emphasis: { itemStyle: { shadowBlur: 36, shadowColor: "rgba(99,102,241,0.75)" } },
      label: { show: true, color: "rgba(226,232,240,0.85)", formatter: "{b}" }
    }));

    const links = props.edges.map((e) => ({
      source: e.source,
      target: e.target,
      value: e.relation,
      lineStyle: {
        width: 1.0 + Math.round((e.confidence ?? 0.7) * 4.0),
        type: e.checked ? "solid" : "dashed",
        color: (e.flags || []).includes("conflict") ? "#f59e0b" : e.checked ? "#22d3ee" : "#ef4444",
        opacity: props.dimToPathEdgeIds
          ? props.dimToPathEdgeIds.has(String(e.id ?? "")) ? 0.9 : 0.12
          : e.checked ? 0.65 : 0.9
      },
      id: e.id ?? null,
      relation: e.relation
    }));

    const categories = Array.from(new Set(props.nodes.map((n) => n.domain))).map((d) => ({
      name: d,
      itemStyle: { color: colorFor(d) }
    }));

    return {
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: "rgba(2,6,23,0.92)",
        borderColor: "rgba(34,211,238,0.18)",
        textStyle: { color: "rgba(226,232,240,0.92)" },
        formatter: (p: any) => {
          if (p?.dataType === "edge") {
            const rel = p?.data?.relation ?? p?.data?.value ?? "";
            const id = p?.data?.id ?? "";
            const edge = props.edges.find((x) => String(x.id ?? "") === String(id));
            const reason = edge?.check_reason || "";
            const flags = (edge?.flags || []).join(", ");
            return `<b>${rel}</b><br/>conf=${(edge?.confidence ?? 0).toFixed(2)} checked=${String(edge?.checked)}<br/>${flags ? `flags: ${flags}<br/>` : ""}${reason ? `reason: ${reason}` : ""}`;
          }
          return `<b>${p?.name ?? ""}</b><br/>${p?.value ?? ""}`;
        }
      },
      legend: [{ data: categories.map((c) => c.name) }],
      animationDuration: 450,
      graphic: { elements: [] },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          label: { position: "right" },
          force: { repulsion: 160, edgeLength: 90 },
          data,
          links,
          categories,
          emphasis: { focus: "adjacency", lineStyle: { width: 3 } }
        }
      ]
    };
  }, [props.nodes, props.edges, props.dimToPathEdgeIds]);

  return (
    <ReactECharts
      ref={chartRef}
      option={option}
      style={{ height: 520, width: "100%" }}
      onEvents={{
        click: (params: any) => {
          if (params?.dataType === "node") {
            props.onNodeClick?.(params.data?.id);
            return;
          }
          if (params?.dataType === "edge") {
            const d = params.data || {};
            props.onEdgeClick?.(d.id ?? null, d.source, d.target, d.relation ?? d.value ?? "");
          }
        }
      }}
    />
  );
}

