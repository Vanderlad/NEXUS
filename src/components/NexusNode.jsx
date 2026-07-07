import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { typeMeta, statusColor, dueLabel, confidenceColor } from '../meta.js';

// Small SVG arc showing evidence-based confidence on skill/topic nodes.
function ConfidenceRing({ score, tier }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const color = confidenceColor(score);
  return (
    <span className="nn-conf" title={`Confidence: ${score}% — ${tier}`} style={{ color }}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle className="t" cx="10" cy="10" r={r} strokeWidth="2.5" />
        <circle
          className="f" cx="10" cy="10" r={r} strokeWidth="2.5" stroke={color}
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
    </span>
  );
}

// Custom React Flow node: glassy HUD card with type accent color, status dot,
// progress bar, lock/done states and a collapse toggle when it has children.
function NexusNode({ id, data }) {
  const meta = typeMeta(data.type);
  const isHub = data.type === 'hub';
  const isDomain = data.type === 'domain';
  const done = data.effective_status === 'Completed' || data.effective_status === 'Submitted';
  const overdue = data.effective_status === 'Overdue';
  const locked = data.locked && !done;
  const showProgress = !isHub;

  return (
    <div
      className={`nexus-node ${isHub ? 'hub-node' : ''} ${isDomain ? 'domain-node' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}`}
      style={{ '--nc': meta.color }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {done && <span className="nn-done-chip" title="Completed">✓</span>}

      <div className="nn-top">
        <span className="nn-icon">{meta.icon}</span>
        <span className="nn-type">{meta.label}</span>
        {locked && <span className="nn-lock" title="Prerequisites not completed yet">🔒</span>}
        {data.due_date && !done && (
          <span className={`nn-due ${overdue ? 'overdue' : ''}`} title={data.due_date}>
            {overdue ? '⚠ ' : '⏱ '}{dueLabel(data.due_date)}
          </span>
        )}
      </div>

      <div className="nn-title">{data.title}</div>

      {showProgress && (
        <div className="nn-bottom">
          <span
            className="status-dot"
            style={{ color: statusColor(data.effective_status), background: statusColor(data.effective_status) }}
            title={data.effective_status}
          />
          <div className="progress-track">
            <div style={{ width: `${data.progress}%` }} />
          </div>
          <span className="nn-pct">{data.progress}%</span>
          {data.confidence && <ConfidenceRing score={data.confidence.score} tier={data.confidence.tier} />}
        </div>
      )}

      {data.childCount > 0 && (
        <button
          className="nn-collapse nodrag"
          title={data.collapsed ? `Expand (${data.hiddenCount} hidden)` : 'Collapse subtree'}
          onClick={(e) => { e.stopPropagation(); data.onToggleCollapse(id); }}
        >
          {data.collapsed ? `+${data.hiddenCount}` : '−'}
        </button>
      )}
    </div>
  );
}

export default memo(NexusNode);
