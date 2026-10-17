import type { Annotation } from "../bindings/github.com/rokuroo171/capiro";

export type AnnoToolKey = "select" | "arrow" | "rect" | "ellipse" | "pen";

export interface AnnoDrag {
  type: Exclude<AnnoToolKey, "select">;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  points?: { x: number; y: number }[];
}

export const ANNO_COLORS = [
  { key: "#F2B33D", label: "Amber" },
  { key: "#FF4D4D", label: "Red" },
  { key: "#3B6EFF", label: "Blue" },
  { key: "#FFFFFF", label: "White" },
  { key: "#000000", label: "Black" },
];

export const ANNO_WIDTHS = [2, 4, 6];

let nextId = 1;
export function nextAnnoId(): string {
  return `ann-${nextId++}`;
}

// Tool-button key to annotation type
export function toolType(tool: AnnoToolKey): string | null {
  if (tool === "select") return null;
  if (tool === "arrow") return "arrow";
  if (tool === "rect") return "rectangle";
  if (tool === "ellipse") return "ellipse";
  return "freehand";
}

export function handleCount(a: Annotation): number {
  if (a.type === "freehand") return 0;
  if (a.type === "arrow") return 2;
  return 8;
}

// Clamp annotation geometry into the capture-image pixel box at commit
export function clampAnnotation(a: Annotation, w: number, h: number): Annotation | null {
  const g = a.geometry;
  if (a.type === "arrow") {
    const x1 = clampv(g.X1 ?? 0, 0, w);
    const y1 = clampv(g.Y1 ?? 0, 0, h);
    const x2 = clampv(g.X2 ?? 0, 0, w);
    const y2 = clampv(g.Y2 ?? 0, 0, h);
    if (x1 === x2 && y1 === y2) return null;
    return { ...a, geometry: { ...g, X1: x1, Y1: y1, X2: x2, Y2: y2 } };
  }
  if (a.type === "freehand") {
    const pts = (g.Points ?? []).map((p) => ({ x: clampv(p.x, 0, w), y: clampv(p.y, 0, h) }));
    if (pts.length < 2) return null;
    return { ...a, geometry: { ...g, Points: pts } };
  }
  const x = clampv(g.X ?? 0, 0, w - 1);
  const y = clampv(g.Y ?? 0, 0, h - 1);
  const width = Math.max(1, Math.min(w - x, g.W ?? 0));
  const height = Math.max(1, Math.min(h - y, g.H ?? 0));
  return { ...a, geometry: { ...g, X: x, Y: y, W: width, H: height } };
}

function clampv(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dragToAnnotation(d: AnnoDrag, color: string, strokeWidth: number, order: number): Annotation {
  const base = {
    id: nextAnnoId(),
    style: { color, strokeWidth, opacity: 1 },
    order,
  };
  if (d.type === "arrow") {
    return { ...base, type: "arrow", geometry: { X1: d.x0, Y1: d.y0, X2: d.x1, Y2: d.y1 } };
  }
  if (d.type === "rect" || d.type === "ellipse") {
    return {
      ...base,
      type: d.type === "rect" ? "rectangle" : "ellipse",
      geometry: {
        X: Math.min(d.x0, d.x1),
        Y: Math.min(d.y0, d.y1),
        W: Math.abs(d.x1 - d.x0),
        H: Math.abs(d.y1 - d.y0),
      },
    };
  }
  return { ...base, type: "freehand", geometry: { Points: d.points ?? [] } };
}

export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  const g = a.geometry;
  if (a.type === "arrow") {
    return { ...a, geometry: { ...g, X1: g.X1! + dx, Y1: g.Y1! + dy, X2: g.X2! + dx, Y2: g.Y2! + dy } };
  }
  if (a.type === "freehand") {
    return { ...a, geometry: { ...g, Points: (g.Points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })) } };
  }
  return { ...a, geometry: { ...g, X: g.X! + dx, Y: g.Y! + dy } };
}

export function resizeAnnotation(a: Annotation, handle: string, dx: number, dy: number): Annotation {
  const g = a.geometry;
  if (a.type === "arrow") {
    const movesHead = handle === "e";
    return movesHead
      ? { ...a, geometry: { ...g, X2: g.X2! + dx, Y2: g.Y2! + dy } }
      : { ...a, geometry: { ...g, X1: g.X1! + dx, Y1: g.Y1! + dy } };
  }
  if (a.type === "freehand") {
    // Per-point editing is out of this slice, so resize drags the whole stroke
    return { ...a, geometry: { ...g, Points: (g.Points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })) } };
  }
  let x = g.X!, y = g.Y!, w = g.W!, h = g.H!;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("e")) {
    w += dx;
  }
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (handle.includes("s")) {
    h += dy;
  }
  if (w < 2 || h < 2) {
    return a;
  }
  return { ...a, geometry: { ...g, X: x, Y: y, W: w, H: h } };
}

export function annotationHandles(a: Annotation): { x: number; y: number; handle: string }[] {
  if (a.type === "arrow") {
    return [
      { x: a.geometry.X1!, y: a.geometry.Y1!, handle: "w" },
      { x: a.geometry.X2!, y: a.geometry.Y2!, handle: "e" },
    ];
  }
  if (a.type === "freehand") {
    return [];
  }
  const x = a.geometry.X!, y = a.geometry.Y!, w = a.geometry.W!, h = a.geometry.H!;
  return [
    { x, y, handle: "nw" },
    { x: x + w / 2, y, handle: "n" },
    { x: x + w, y, handle: "ne" },
    { x: x + w, y: y + h / 2, handle: "e" },
    { x: x + w, y: y + h, handle: "se" },
    { x: x + w / 2, y: y + h, handle: "s" },
    { x, y: y + h, handle: "sw" },
    { x, y: y + h / 2, handle: "w" },
  ];
}

export function annotationBounds(a: Annotation): { x: number; y: number; w: number; h: number } {
  const g = a.geometry;
  if (a.type === "arrow") {
    return {
      x: Math.min(g.X1!, g.X2!),
      y: Math.min(g.Y1!, g.Y2!),
      w: Math.abs(g.X2! - g.X1!),
      h: Math.abs(g.Y2! - g.Y1!),
    };
  }
  if (a.type === "freehand") {
    const pts = g.Points ?? [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: g.X!, y: g.Y!, w: g.W!, h: g.H! };
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
  return list.filter((a) => a.id !== id);
}

// Reassign order 0..n-1 by list position after any add or remove
export function reorderAnnotations(list: Annotation[]): Annotation[] {
  return list.map((a, i) => ({ ...a, order: i }));
}
