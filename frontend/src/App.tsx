import React from "react";
import { expandNode, generateGraph, getGraph, getJob, type Edge, type GraphResult, type JobStatus, type Node } from "./api";
import { GraphView } from "./components/GraphView";
import { motion } from "framer-motion";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function App() {
  const [concept, setConcept] = React.useState("Entropy");
  const [job, setJob] = React.useState<JobStatus | null>(null);
  const [graph, setGraph] = React.useState<GraphResult | null>(null);
  const [selectedNode, setSelectedNode] = React.useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<Edge | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Product UX
  const [search, setSearch] = React.useState("");
  const [focusNodeId, setFocusNodeId] = React.useState<string | null>(null);
  const [showFilters, setShowFilters] = React.useState(false);

  // Filters
  const [domainFilter, setDomainFilter] = React.useState<Set<string>>(new Set());
  const [relationFilter, setRelationFilter] = React.useState<Set<string>>(new Set());
  const [checkedFilter, setCheckedFilter] = React.useState<"all" | "pass" | "fail" | "conflict">("all");
  const [confMin, setConfMin] = React.useState(0.0);

  // Bridge path
  const [pathMode, setPathMode] = React.useState(false);
  const [pathStart, setPathStart] = React.useState<string | null>(null);
  const [pathEnd, setPathEnd] = React.useState<string | null>(null);
  const [pathNodes, setPathNodes] = React.useState<string[]>([]);
  const [pathEdgeIds, setPathEdgeIds] = React.useState<Set<string> | undefined>(undefined);
  const [playStep, setPlayStep] = React.useState<number | null>(null);
  const agentTrace = graph?.meta?.agent_trace || null;

  const pickNode = React.useCallback(
    (nodeId: string) => {
      if (pathMode) {
        if (!pathStart) {
          setPathStart(nodeId);
          setPathEnd(null);
          setPathNodes([]);
          setPathEdgeIds(undefined);
          setPlayStep(null);
          setFocusNodeId(nodeId);
          return;
        }
        if (!pathEnd) {
          setPathEnd(nodeId);
          setFocusNodeId(nodeId);
          return;
        }
      }
      const n = graph?.nodes.find((x) => x.id === nodeId) || null;
      setSelectedNode(n);
      setSelectedEdge(null);
      setFocusNodeId(nodeId);
    },
    [graph]
  );

  const pickEdge = React.useCallback(
    (edgeId: string | null, source: string, target: string, relation: string) => {
      const e =
        (edgeId ? graph?.edges.find((x) => (x.id ?? null) === edgeId) : null) ||
        graph?.edges.find((x) => x.source === source && x.target === target && x.relation === (relation as any)) ||
        null;
      setSelectedEdge(e);
      setSelectedNode(null);
    },
    [graph]
  );

  // Derived: filtered graph (domains / relations / checked / conf)
  const filtered = React.useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const domains = domainFilter;
    const rels = relationFilter;
    const nodes0 = graph.nodes.filter((n) => (domains.size ? domains.has(n.domain) : true));
    const keep = new Set(nodes0.map((n) => n.id));

    const edges0 = graph.edges.filter((e) => {
      if (!keep.has(e.source) || !keep.has(e.target)) return false;
      if (rels.size && !rels.has(e.relation)) return false;
      if ((e.confidence ?? 0) < confMin) return false;
      if (checkedFilter === "pass" && !e.checked) return false;
      if (checkedFilter === "fail" && e.checked) return false;
      if (checkedFilter === "conflict" && !(e.flags || []).includes("conflict")) return false;
      return true;
    });

    // Ensure endpoints exist after edge filtering
    const keep2 = new Set<string>();
    for (const e of edges0) {
      keep2.add(e.source);
      keep2.add(e.target);
    }
    const nodes1 = nodes0.filter((n) => keep2.has(n.id) || n.domain === "Core");
    return { nodes: nodes1, edges: edges0 };
  }, [graph, domainFilter, relationFilter, checkedFilter, confMin]);

  const insights = React.useMemo(() => {
    const nodes = filtered.nodes;
    const edges = filtered.edges;
    const totalEdges = edges.length || 1;
    const pass = edges.filter((e) => e.checked).length;
    const conflicts = edges.filter((e) => (e.flags || []).includes("conflict")).length;
    const domainCount = new Map<string, number>();
    for (const n of nodes) domainCount.set(n.domain, (domainCount.get(n.domain) || 0) + 1);
    const topDomain = Array.from(domainCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }
    const topNodeId = Array.from(degree.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const topNode = topNodeId ? nodes.find((n) => n.id === topNodeId)?.name : "-";

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      passRate: Math.round((pass / totalEdges) * 100),
      conflicts,
      topDomain,
      topNode: topNode || "-"
    };
  }, [filtered]);

  const searchResults = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !graph) return [];
    const byName = graph.nodes.filter((n) => n.name.toLowerCase().includes(q));
    const byDomain = graph.nodes.filter((n) => n.domain.toLowerCase().includes(q));
    const uniq = new Map<string, Node>();
    for (const n of [...byName, ...byDomain]) uniq.set(n.id, n);
    return Array.from(uniq.values()).slice(0, 8);
  }, [search, graph]);

  function selectFromSearch(n: Node) {
    setFocusNodeId(n.id);
    setSelectedNode(n);
    setSelectedEdge(null);
    setSearch("");
  }

  function copyCitation() {
    if (!selectedEdge) return;
    const t = selectedEdge.evidence?.title || "";
    const u = selectedEdge.evidence?.url || "";
    const s = selectedEdge.evidence?.snippet || "";
    const text = `${t}${u ? ` (${u})` : ""}\n${s}`.trim();
    navigator.clipboard?.writeText?.(text);
  }

  // Bridge path computation (BFS)
  React.useEffect(() => {
    if (!graph || !pathMode || !pathStart || !pathEnd) return;
    const edges = filtered.edges.length ? filtered.edges : graph.edges;
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) || []), e.source]);
    }
    const prev = new Map<string, string | null>();
    const q: string[] = [pathStart];
    prev.set(pathStart, null);
    let found = false;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === pathEnd) {
        found = true;
        break;
      }
      for (const nx of adj.get(cur) || []) {
        if (prev.has(nx)) continue;
        prev.set(nx, cur);
        q.push(nx);
      }
    }
    if (!found) {
      setPathNodes([]);
      setPathEdgeIds(new Set());
      return;
    }
    const path: string[] = [];
    let cur: string | null = pathEnd;
    while (cur) {
      path.push(cur);
      cur = prev.get(cur) ?? null;
    }
    path.reverse();
    setPathNodes(path);

    // build edge id set for path
    const set = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const e =
        edges.find((x) => x.source === a && x.target === b) ||
        edges.find((x) => x.source === b && x.target === a) ||
        null;
      if (e?.id) set.add(String(e.id));
    }
    setPathEdgeIds(set);
  }, [graph, filtered, pathMode, pathStart, pathEnd]);

  React.useEffect(() => {
    if (playStep == null) return;
    if (!pathNodes.length) return;
    if (playStep >= pathNodes.length) {
      setPlayStep(null);
      return;
    }
    setFocusNodeId(pathNodes[playStep]);
  }, [playStep, pathNodes]);

  function startPlay() {
    if (!pathNodes.length) return;
    setPlayStep(0);
    let i = 0;
    const t = setInterval(() => {
      i++;
      if (i >= pathNodes.length) {
        clearInterval(t);
        setPlayStep(null);
        return;
      }
      setPlayStep(i);
    }, 700);
  }

  function clearPath() {
    setPathStart(null);
    setPathEnd(null);
    setPathNodes([]);
    setPathEdgeIds(undefined);
    setPlayStep(null);
  }

  function exportJson() {
    if (!graph) return;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.concept || "graph"}-v1.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function pollJob(jobId: string) {
    for (let i = 0; i < 120; i++) {
      const j = await getJob(jobId);
      setJob(j);
      if (j.status === "succeeded") {
        // Prefer job.result (fast & stable), fallback to Neo4j query
        if (j.result) {
          setGraph(j.result);
        } else {
          const g = await getGraph(j.concept, 2);
          setGraph(g);
        }
        setSelectedNode(null);
        setSelectedEdge(null);
        setDomainFilter(new Set());
        setRelationFilter(new Set());
        setCheckedFilter("all");
        setConfMin(0);
        setPathMode(false);
        clearPath();
        return;
      }
      if (j.status === "failed") return;
      await sleep(800);
    }
  }

  async function onGenerate() {
    setError(null);
    setBusy(true);
    setGraph(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    try {
      const r = await generateGraph({ concept, depth: 2, strict_check: true });
      await pollJob(r.job_id);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onExpand() {
    if (!selectedNode) return;
    setError(null);
    setBusy(true);
    try {
      const g = await expandNode(selectedNode.id, 1);
      setGraph(g);
      setSelectedNode(null);
      setSelectedEdge(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <div>
            <div className="brandTitle">Cross‑Disciplinary</div>
            <div className="subtle">Knowledge Graph Explorer</div>
          </div>
        </div>

        <div className="controls">
          <span className="subtle">Concept</span>
          <input
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Enter concept to generate…"
          />
          <button onClick={onGenerate} disabled={busy || !concept.trim()}>
            Generate
          </button>
          <button className="btn-ghost" onClick={() => setPathMode((v) => !v)} disabled={!graph}>
            {pathMode ? "Exit Path" : "Analyze Paths"}
          </button>
          <button className="btn-ghost" onClick={() => setShowFilters((v) => !v)} disabled={!graph}>
            {showFilters ? "Hide Filters" : "Filter"}
          </button>
          <button onClick={exportJson} disabled={!graph}>
            Export
          </button>
          {job && <span className="pill">{job.status}</span>}
        </div>

        <div style={{ position: "relative", width: 360 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search in graph… (fly‑to)"
            style={{ width: "100%" }}
            disabled={!graph}
          />
          {searchResults.length ? (
            <div
              className="card glass"
              style={{ position: "absolute", right: 0, left: 0, top: 44, padding: 8, zIndex: 50 }}
            >
              {searchResults.map((n) => (
                <div
                  key={n.id}
                  className="chip"
                  style={{ marginBottom: 6 }}
                  onClick={() => selectFromSearch(n)}
                >
                  <b>{n.name}</b> <span className="muted">({n.domain})</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="hud">
        <div className="card">
          <div className="panelHeader">
            <div className="title">Filters</div>
            <span className="subtle">Validation & Domains</span>
          </div>

          {showFilters ? (
            <>
              <div className="muted">Domain</div>
              <div className="chips">
                {Array.from(new Set(graph?.nodes.map((n) => n.domain) || [])).map((d) => (
                  <div
                    key={d}
                    className={"chip " + (domainFilter.has(d) ? "active" : "")}
                    onClick={() => {
                      const next = new Set(domainFilter);
                      if (next.has(d)) next.delete(d);
                      else next.add(d);
                      setDomainFilter(next);
                    }}
                  >
                    {d}
                  </div>
                ))}
              </div>

              <div className="divider" />
              <div className="muted">Relation</div>
              <div className="chips">
                {["related_to", "used_in", "is_a", "explains", "bridges"].map((r) => (
                  <div
                    key={r}
                    className={"chip " + (relationFilter.has(r) ? "active" : "")}
                    onClick={() => {
                      const next = new Set(relationFilter);
                      if (next.has(r)) next.delete(r);
                      else next.add(r);
                      setRelationFilter(next);
                    }}
                  >
                    {r}
                  </div>
                ))}
              </div>

              <div className="divider" />
              <div className="muted">Checked</div>
              <div className="chips">
                {[
                  ["all", "All"],
                  ["pass", "Pass"],
                  ["fail", "Fail"],
                  ["conflict", "Conflict"]
                ].map(([k, label]) => (
                  <div
                    key={k}
                    className={"chip " + (checkedFilter === (k as any) ? "active" : "")}
                    onClick={() => setCheckedFilter(k as any)}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="divider" />
              <div className="muted">Confidence ≥ {confMin.toFixed(2)}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={confMin}
                onChange={(e) => setConfMin(Number(e.target.value))}
              />

              <div className="controls" style={{ marginTop: 12 }}>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setDomainFilter(new Set());
                    setRelationFilter(new Set());
                    setCheckedFilter("all");
                    setConfMin(0);
                  }}
                >
                  Reset
                </button>
              </div>
            </>
          ) : (
            <div className="muted">Click “Filter” to expand controls.</div>
          )}

          {agentTrace ? (
            <>
              <div className="divider" />
              <div className="title">Agent Trace</div>
              <div className="subtle">Planner concepts + selected evidence snippets</div>
              <div className="traceBox" style={{ marginTop: 10 }}>
                {Object.entries(agentTrace.domains || {}).map(([d, qs]) => (
                  <div key={d} className="traceDomain">
                    <div className="traceTitle">{d}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Queries: {(qs || []).slice(0, 6).join(" · ")}
                    </div>
                    {(agentTrace.passages_by_domain?.[d] || []).slice(0, 2).map((p, i) => (
                      <div key={i} className="traceItem">
                        <div className="t">
                          <span className="pill">{p.source || "source"}</span>{" "}
                          {p.title}
                        </div>
                        <div className="s">{(p.snippet || "").slice(0, 220)}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {job && (
            <>
              <div className="divider" />
              <div className="muted">Progress</div>
              <div className="progress">
                <div style={{ width: `${job.progress}%` }} />
              </div>
              {job && <div className="subtle" style={{ marginTop: 6 }}>{job.message || "Running…"}</div>}
            </>
          )}

          {error && (
            <div style={{ marginTop: 10, color: "#fca5a5" }}>
              <b>Error:</b> {error}
            </div>
          )}
        </div>

        <div className="card">
          <div className="panelHeader">
            <div className="title">Graph</div>
            {graph ? (
              <div className="insights">
                <div className="metric">
                  <div className="k">Nodes</div>
                  <div className="v">{insights.nodeCount}</div>
                </div>
                <div className="metric">
                  <div className="k">Links</div>
                  <div className="v">{insights.edgeCount}</div>
                </div>
                <div className="metric">
                  <div className="k">Pass Rate</div>
                  <div className="v">{insights.passRate}%</div>
                </div>
                <div className="metric">
                  <div className="k">Bridges</div>
                  <div className="v">{filtered.edges.filter((e) => e.relation === "bridges").length}</div>
                </div>
                <div className="metric">
                  <div className="k">Top Domain</div>
                  <div className="v" style={{ fontSize: 14 }}>{insights.topDomain}</div>
                </div>
              </div>
            ) : (
              <span className="subtle">No graph yet</span>
            )}
          </div>

          {graph ? (
            <GraphView
              nodes={filtered.nodes}
              edges={filtered.edges}
              onNodeClick={pickNode}
              onEdgeClick={pickEdge}
              focusNodeId={focusNodeId}
              dimToPathEdgeIds={pathMode && pathEdgeIds ? pathEdgeIds : undefined}
              enableEdgeFlow={true}
            />
          ) : (
            <div className="muted">Click Generate to render graph.</div>
          )}

          {pathMode ? (
            <div style={{ marginTop: 10 }} className="controls">
              <span className="pill">Path mode</span>
              <span className="muted">
                {pathStart ? "Pick an end node" : "Pick a start node"} {pathEnd ? "• Path ready" : ""}
              </span>
              <button className="btn-ghost" onClick={clearPath}>
                Clear
              </button>
              <button onClick={startPlay} disabled={!pathNodes.length}>
                Play
              </button>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="panelHeader">
            <div className="title">{selectedEdge ? "Details" : selectedNode ? "Node" : "Details"}</div>
            {selectedNode ? <span className="pill">{selectedNode.domain}</span> : null}
          </div>

          <div className="detailsScroll">
            {selectedEdge ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill">{selectedEdge.relation}</span>
                {(selectedEdge.flags || []).includes("conflict") && <span className="pill warn">⚠ conflict</span>}
                {(selectedEdge.flags || []).includes("duplicate") && <span className="pill">duplicate</span>}
                {(selectedEdge.flags || []).includes("downgraded") && <span className="pill">downgraded</span>}
                {!selectedEdge.checked && <span className="pill bad">failed</span>}
                <span className="muted">
                  conf={selectedEdge.confidence.toFixed(2)} · {selectedEdge.check_reason || "—"}
                </span>
              </div>

              <div style={{ marginTop: 10 }} className="controls">
                <button className="btn-ghost" onClick={copyCitation}>
                  Copy citation
                </button>
                {selectedEdge.evidence?.url ? (
                  <a className="chip" href={selectedEdge.evidence.url} target="_blank" rel="noreferrer">
                    Open source
                  </a>
                ) : null}
              </div>

              <div className="stack" style={{ marginTop: 12 }}>
                {(selectedEdge.evidence?.snippet || "")
                  .split("\n")
                  .filter((x) => x.trim())
                  .slice(0, 4)
                  .map((sn, i) => (
                    <motion.div
                      key={i}
                      className="evidenceCard"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="title2">{selectedEdge.evidence?.title || "Evidence"}</div>
                      <div className="meta2">
                        {selectedEdge.evidence?.domain ? <span className="pill">{selectedEdge.evidence.domain}</span> : null}
                        <span className="pill">score≈{selectedEdge.confidence.toFixed(2)}</span>
                      </div>
                      <div className="snippet2">{sn}</div>
                    </motion.div>
                  ))}
              </div>
            </>
            ) : selectedNode ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{selectedNode.name}</div>
              <div className="kv">
                <div>Confidence</div>
                <div>{selectedNode.confidence.toFixed(2)}</div>
                <div>Definition</div>
                <div>{selectedNode.definition || "-"}</div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={onExpand} disabled={busy}>
                  Expand (2‑hop)
                </button>
              </div>
            </>
            ) : (
            <div className="muted">Click a node or edge to inspect details.</div>
            )}
          </div>

          {job?.logs?.length ? (
            <>
              <div className="divider" />
              <div className="title">Job Logs</div>
              <div className="log">{job.logs.slice(-40).join("\n")}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

