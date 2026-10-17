import { useRef, useState } from "react";
import type { Annotation } from "../bindings/github.com/rokuroo171/capiro";
import {
  type AnnoDrag,
  type AnnoToolKey,
  annotationBounds,
  annotationHandles,
  dragToAnnotation,
  resizeAnnotation,
  translateAnnotation,
  clampAnnotation,
} from "./annotations";

interface Props {
  annotations: Annotation[];
  tool: AnnoToolKey;
  color: string;
  strokeWidth: number;
  imgW: number;
  imgH: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (a: Annotation) => void;
  onChangeLive: (a: Annotation | null) => void;
  onMoveCommit: (a: Annotation) => void;
}

const HANDLE_HIT = 10;

function toCapture(e: { clientX: number; clientY: number }, svg: SVGSVGElement, imgW: number, imgH: number) {
  const r = svg.getBoundingClientRect();
  const sx = imgW / r.width;
  const sy = imgH / r.height;
  return { x: Math.round((e.clientX - r.left) * sx), y: Math.round((e.clientY - r.top) * sy) };
}

function hitAnnotation(annotations: Annotation[], p: { x: number; y: number }): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    const b = annotationBounds(a);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      return a;
    }
  }
  return null;
}

export default function AnnotationOverlay(props: Props) {
  const { annotations, tool, color, strokeWidth, imgW, imgH, selectedId, onSelect, onCommit, onChangeLive, onMoveCommit } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<
    | { kind: "draw"; d: AnnoDrag }
    | { kind: "move"; id: string; lastX: number; lastY: number }
    | { kind: "resize"; id: string; handle: string }
    | null
  >(null);

  const drawing = drag?.kind === "draw" ? drag.d : null;
  const sel = annotations.find((a) => a.id === selectedId) ?? null;

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    const p = toCapture(e, svg, imgW, imgH);

    if (tool === "select") {
      if (sel) {
        const handle = annotationHandles(sel).find((h) => Math.hypot(h.x - p.x, h.y - p.y) <= HANDLE_HIT);
        if (handle) {
          setDrag({ kind: "resize", id: sel.id, handle: handle.handle });
          return;
        }
      }
      const hit = hitAnnotation(annotations, p);
      if (hit) {
        onSelect(hit.id);
        setDrag({ kind: "move", id: hit.id, lastX: p.x, lastY: p.y });
        return;
      }
      onSelect(null);
      return;
    }

    setDrag({ kind: "draw", d: { type: tool as Exclude<AnnoToolKey, "select">, x0: p.x, y0: p.y, x1: p.x, y1: p.y, points: [p] } });
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !drag) return;
    const p = toCapture(e, svg, imgW, imgH);

    if (drag.kind === "draw") {
      const d = drag.d;
      const next: AnnoDrag = d.type === "pen" ? { ...d, x1: p.x, y1: p.y, points: [...(d.points ?? []), p] } : { ...d, x1: p.x, y1: p.y };
      setDrag({ kind: "draw", d: next });
      if (d.type === "pen" && (next.points ?? []).length >= 2) {
        const draft = dragToAnnotation(next, color, strokeWidth, 0);
        if (draft) onChangeLive(draft);
      }
      return;
    }

    if (drag.kind === "move") {
      const a = annotations.find((x) => x.id === drag.id);
      if (!a) return;
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      if (dx || dy) onChangeLive(translateAnnotation(a, dx, dy));
      setDrag({ kind: "move", id: drag.id, lastX: p.x, lastY: p.y });
      return;
    }

    const a = annotations.find((x) => x.id === drag.id);
    if (!a) return;
    const b = annotationBounds(a);
    const dx = p.x - (drag.handle.includes("w") ? b.x : b.x + b.w);
    const dy = p.y - (drag.handle.includes("n") ? b.y : b.y + b.h);
    onChangeLive(resizeAnnotation(a, drag.handle, dx, dy));
  };

  const onUp = () => {
    if (!drag) return;

    if (drag.kind === "draw") {
      const draft = dragToAnnotation(drag.d, color, strokeWidth, annotations.length);
      const cleaned = clampAnnotation(draft, imgW, imgH);
      setDrag(null);
      if (!cleaned) {
        onSelect(null);
        return;
      }
      onCommit(cleaned);
      return;
    }

    const id = drag.id;
    setDrag(null);
    const done = annotations.find((x) => x.id === id);
    if (done) onMoveCommit(done);
  };

  return (
    <svg
      ref={svgRef}
      className="anno-overlay"
      viewBox={`0 0 ${imgW} ${imgH}`}
      style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {annotations.map((a) => (
        <AnnotationShape
          key={a.id}
          a={a}
          selected={a.id === selectedId}
        />
      ))}
      {drawing && <AnnotationShape a={dragToAnnotation(drawing, color, strokeWidth, 0)} selected={false} />}
      {sel && tool === "select" && (
        <>
          {annotationHandles(sel).map((h) => (
            <circle
              key={h.handle}
              cx={h.x}
              cy={h.y}
              r={6}
              fill="#FFF"
              stroke="#F2B33D"
              strokeWidth={2}
            />
          ))}
        </>
      )}
    </svg>
  );
}

function AnnotationShape({
  a,
  selected,
}: {
  a: Annotation;
  selected: boolean;
}) {
  const sw = Math.max(1, a.style.strokeWidth) + (selected ? 1 : 0);
  const common = {
    stroke: a.style.color,
    strokeWidth: sw,
    fill: "none",
    opacity: a.style.opacity,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (a.type === "rectangle") {
    return <rect x={a.geometry.X} y={a.geometry.Y} width={a.geometry.W} height={a.geometry.H} {...common} />;
  }
  if (a.type === "ellipse") {
    return <ellipse cx={(a.geometry.X ?? 0) + (a.geometry.W ?? 0) / 2} cy={(a.geometry.Y ?? 0) + (a.geometry.H ?? 0) / 2} rx={(a.geometry.W ?? 0) / 2} ry={(a.geometry.H ?? 0) / 2} {...common} />;
  }
  if (a.type === "freehand") {
    return (
      <polyline
        points={(a.geometry.Points ?? []).map((p) => `${p.x},${p.y}`).join(" ")}
        {...common}
      />
    );
  }
  const x1 = a.geometry.X1 ?? 0, y1 = a.geometry.Y1 ?? 0, x2 = a.geometry.X2 ?? 0, y2 = a.geometry.Y2 ?? 0;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = sw * 3 + 6;
  const hx1 = x2 - head * Math.cos(ang + Math.PI / 7);
  const hy1 = y2 - head * Math.sin(ang + Math.PI / 7);
  const hx2 = x2 - head * Math.cos(ang - Math.PI / 7);
  const hy2 = y2 - head * Math.sin(ang - Math.PI / 7);
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
      <line x1={x2} y1={y2} x2={hx1} y2={hy1} {...common} />
      <line x1={x2} y1={y2} x2={hx2} y2={hy2} {...common} />
    </g>
  );
}
