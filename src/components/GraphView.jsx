import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, BackgroundVariant, Controls, MiniMap, MarkerType,
  ReactFlowProvider, useReactFlow, applyNodeChanges, applyEdgeChanges
} from 'reactflow';
import 'reactflow/dist/style.css';
import NexusNode from './NexusNode.jsx';
import NodePanel from './NodePanel.jsx';
import { api } from '../api.js';
import { typeMeta, TYPE_META } from '../meta.js';

const nodeTypes = { nexus: NexusNode };

const EDGE_STYLE = {
  contains: { style: { stroke: 'rgba(148, 163, 184, 0.35)' }, type: 'smoothstep' },
  related: { style: { stroke: 'rgba(45, 212, 191, 0.4)', strokeDasharray: '5 4' }, type: 'default' },
  next: { style: { stroke: 'rgba(129, 140, 248, 0.55)' }, type: 'default', animated: true },
  prereq: { style: { stroke: 'rgba(251, 191, 36, 0.45)', strokeDasharray: '3 5' }, type: 'default' }
};

const LEGEND_TYPES = ['course', 'assignment', 'exam', 'lab', 'task', 'project', 'skill', 'topic', 'goal', 'roadmap', 'note'];

const DONE = new Set(['Completed', 'Submitted']);

// A node renders "locked" when it hasn't been started and at least one
// incoming 'prereq' edge points at it from an incomplete node. Soft lock:
// purely visual, nothing is blocked.
function computeLocked(rawNodes, rawEdges) {
  const byId = new Map(rawNodes.map(n => [n.id, n]));
  const locked = new Set();
  for (const e of rawEdges) {
    if (e.kind !== 'prereq') continue;
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src && tgt && tgt.status === 'Not Started' && !DONE.has(src.status)) {
      locked.add(e.target);
    }
  }
  return locked;
}

// Which descendants are hidden because an ancestor is collapsed (via 'contains' edges).
function computeHidden(rawNodes, rawEdges) {
  const children = new Map();
  for (const e of rawEdges) {
    if (e.kind !== 'contains') continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
  }
  const hidden = new Set();
  const hide = (id) => {
    for (const kid of children.get(id) ?? []) {
      if (hidden.has(kid)) continue;
      hidden.add(kid);
      hide(kid);
    }
  };
  for (const n of rawNodes) if (n.collapsed) hide(n.id);
  return { hidden, children };
}

function GraphInner({ reloadToken, focusNodeId, onFocusHandled, onGami, onAddChild, onError, onLoadDemo, onGoRoadmaps }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [empty, setEmpty] = useState(false);
  const rawRef = useRef({ nodes: [], edges: [] });
  const rebuildRef = useRef(() => {});
  const rf = useReactFlow();

  // Camera starts centered on the hub node at (0,0). Computed statically so it
  // is correct on first paint without waiting for React Flow to measure.
  const initialViewport = useMemo(() => {
    const zoom = 0.55;
    return {
      x: (window.innerWidth - 218) / 2 - 105 * zoom, // half node width offset
      y: window.innerHeight / 2 - 40 * zoom,
      zoom
    };
  }, []);

  // Called from node buttons whose data captured an old closure — always go
  // through rebuildRef so the current selection isn't lost.
  const toggleCollapse = useCallback((id) => {
    const raw = rawRef.current;
    const node = raw.nodes.find(n => n.id === id);
    if (!node) return;
    node.collapsed = node.collapsed ? 0 : 1;
    api.patchNode(id, { collapsed: !!node.collapsed }).catch(e => onError?.(e.message));
    rebuildRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rebuild = useCallback((selected = null) => {
    const raw = rawRef.current;
    const sel = selected ?? selectedId;
    const { hidden, children } = computeHidden(raw.nodes, raw.edges);
    const locked = computeLocked(raw.nodes, raw.edges);
    const countDescendants = (id, seen = new Set()) => {
      let n = 0;
      for (const kid of children.get(id) ?? []) {
        if (seen.has(kid)) continue; // cycle guard (server rejects these, but be safe)
        seen.add(kid);
        n += 1 + countDescendants(kid, seen);
      }
      return n;
    };
    setNodes(raw.nodes.map(n => ({
      id: n.id,
      type: 'nexus',
      position: { x: n.pos_x, y: n.pos_y },
      hidden: hidden.has(n.id),
      selected: n.id === sel,
      data: {
        ...n,
        locked: locked.has(n.id),
        childCount: (children.get(n.id) ?? []).length,
        hiddenCount: countDescendants(n.id),
        onToggleCollapse: toggleCollapse
      }
    })));
    setEdges(raw.edges.map(e => {
      const s = EDGE_STYLE[e.kind] ?? EDGE_STYLE.related;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        hidden: hidden.has(e.source) || hidden.has(e.target),
        type: s.type,
        animated: !!s.animated,
        style: s.style,
        markerEnd: e.kind === 'contains'
          ? { type: MarkerType.ArrowClosed, color: 'rgba(148,163,184,0.4)', width: 14, height: 14 }
          : undefined,
        data: { kind: e.kind }
      };
    }));
  }, [selectedId, toggleCollapse]);
  rebuildRef.current = rebuild;

  const load = useCallback(async () => {
    try {
      const data = await api.graph();
      rawRef.current = data;
      setEmpty(data.nodes.length === 0);
      rebuild();
    } catch (e) {
      onError?.(e.message);
    }
  }, [rebuild, rf, onError]);

  useEffect(() => { load(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a node requested from dashboard / search / tracker / creation.
  useEffect(() => {
    if (!focusNodeId || rawRef.current.nodes.length === 0) return;
    const raw = rawRef.current.nodes.find(n => n.id === focusNodeId);
    // Not in the graph yet (e.g. just created, reload still in flight): keep the
    // request pending — this effect re-runs when nodes.length changes.
    if (!raw) return;
    // Expand any collapsed ancestors so the node is visible.
    const parents = new Map();
    for (const e of rawRef.current.edges) {
      if (e.kind === 'contains') parents.set(e.target, e.source);
    }
    const seen = new Set();
    let p = parents.get(focusNodeId);
    while (p && !seen.has(p)) {
      seen.add(p);
      const pn = rawRef.current.nodes.find(n => n.id === p);
      if (pn?.collapsed) {
        pn.collapsed = 0;
        api.patchNode(pn.id, { collapsed: false }).catch(() => {});
      }
      p = parents.get(p);
    }
    setSelectedId(focusNodeId);
    rebuild(focusNodeId);
    rf.setCenter(raw.pos_x + 100, raw.pos_y + 40, { zoom: 1.05, duration: 650 });
    onFocusHandled?.();
  }, [focusNodeId, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes) => setNodes(ns => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback((changes) => setEdges(es => applyEdgeChanges(changes, es)), []);

  const onNodeDragStop = useCallback((_, node) => {
    const raw = rawRef.current.nodes.find(n => n.id === node.id);
    if (raw) { raw.pos_x = node.position.x; raw.pos_y = node.position.y; }
    api.patchNode(node.id, { pos_x: node.position.x, pos_y: node.position.y }).catch(e => onError?.(e.message));
  }, [onError]);

  const onConnect = useCallback(async (conn) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const sourceNode = rawRef.current.nodes.find(n => n.id === conn.source);
    const kind = ['course', 'roadmap', 'section', 'domain', 'hub', 'project', 'goal'].includes(sourceNode?.type)
      ? 'contains' : 'related';
    try {
      const { edge } = await api.createEdge({ source: conn.source, target: conn.target, kind });
      rawRef.current.edges.push(edge);
      rebuild();
    } catch (e) {
      onError?.(e.message);
    }
  }, [rebuild, onError]);

  const onEdgesDelete = useCallback((deleted) => {
    for (const e of deleted) {
      rawRef.current.edges = rawRef.current.edges.filter(x => x.id !== e.id);
      api.deleteEdge(e.id).catch(() => {});
    }
    // Removing an edge can change lock states, child counts and collapse buttons.
    rebuildRef.current();
  }, []);

  // Node panel callbacks -----------------------------------------------------

  const handlePatched = useCallback((node, gamification) => {
    const raw = rawRef.current.nodes.find(n => n.id === node.id);
    if (raw) Object.assign(raw, node);
    if (gamification) onGami?.(gamification);
    // Any edit can ripple into derived container progress, effective status,
    // confidence and lock states — refetch the computed graph.
    load();
  }, [load, onGami]);

  const handleDeleted = useCallback((id) => {
    rawRef.current.nodes = rawRef.current.nodes.filter(n => n.id !== id);
    rawRef.current.edges = rawRef.current.edges.filter(e => e.source !== id && e.target !== id);
    setSelectedId(null);
    setEmpty(rawRef.current.nodes.length === 0); // last node gone → onboarding returns
    rebuild(null);
  }, [rebuild]);

  const selectedComputed = useMemo(
    () => rawRef.current.nodes.find(n => n.id === selectedId),
    [selectedId, nodes]
  );

  return (
    <div className="graph-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        nodesDeletable={false}
        deleteKeyCode={['Delete', 'Backspace']}
        defaultViewport={initialViewport}
        minZoom={0.12}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="rgba(125, 145, 200, 0.13)" />
        {!empty && <Controls position="bottom-right" showInteractive={false} />}
        {!empty && (
          <MiniMap
            position="top-right"
            pannable
            zoomable
            nodeColor={(n) => typeMeta(n.data?.type).color + '99'}
            maskColor="rgba(4, 6, 12, 0.75)"
          />
        )}
      </ReactFlow>

      {!empty && (
        <div className="graph-legend glass">
          {LEGEND_TYPES.map(t => (
            <span className="legend-item" key={t}>
              <span className="legend-swatch" style={{ background: TYPE_META[t].color, color: TYPE_META[t].color }} />
              {TYPE_META[t].label}
            </span>
          ))}
        </div>
      )}

      {empty && (
        <div className="onboard">
          <div className="onboard-panel glass corners">
            <div className="onboard-orb" />
            <div className="status-line">◈ system online — workspace empty</div>
            <h2>Initialize your NEXUS</h2>
            <p>
              This is your map. Courses, skills, projects, goals and files will live here
              as connected nodes you can level up. Start from zero or explore with sample data.
            </p>
            <div className="onboard-actions">
              <button className="btn primary" onClick={() => onAddChild?.(null)}>✚ Create your first node</button>
              <button className="btn" onClick={() => onGoRoadmaps?.()}>🗺 Import a learning roadmap</button>
              <button className="btn" onClick={() => onLoadDemo?.()}>▶ Load demo workspace</button>
            </div>
            <div className="onboard-foot">Demo data is clearly marked and removable in one click (Stats → Workspace).</div>
          </div>
        </div>
      )}

      {selectedId && selectedComputed && (
        <NodePanel
          key={selectedId}
          nodeId={selectedId}
          onClose={() => setSelectedId(null)}
          onPatched={handlePatched}
          onDeleted={handleDeleted}
          onAddChild={onAddChild}
          onJump={(id) => {
            setSelectedId(id);
            const raw = rawRef.current.nodes.find(n => n.id === id);
            if (raw) rf.setCenter(raw.pos_x + 100, raw.pos_y + 40, { zoom: 1.05, duration: 500 });
            rebuild(id);
          }}
          onGami={onGami}
          onError={onError}
        />
      )}
    </div>
  );
}

export default function GraphView(props) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
