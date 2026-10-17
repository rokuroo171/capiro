import { useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { CaptureService } from "../bindings/github.com/rokuroo171/capiro";

type OverlayShot = {
  data: string;
  width: number;
  height: number;
  screenIndex: number;
};

type DragState = { x0: number; y0: number; x1: number; y1: number };

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function RegionOverlay() {
  const [shot, setShot] = useState<OverlayShot | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const screen = Number(new URLSearchParams(window.location.search).get("screen") ?? "-1");
    CaptureService.GetRegionOverlayData(screen)
      .then((r) => {
        if (!r || !r.data) throw new Error("no pending region capture");
        setShot({ data: r.data, width: r.width, height: r.height, screenIndex: r.screenIndex });
      })
      .catch((e: unknown) => setError(errText(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") CaptureService.CloseRegionOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const confirm = async (x: number, y: number, w: number, h: number) => {
    if (!shot) return;
    try {
      const result = await CaptureService.CaptureRegion(shot.screenIndex, x, y, w, h);
      if (!result) return;
      // The main window listens for this event and swaps the canvas image
      await Events.Emit("capiro:capture-ready", result);
      await CaptureService.CloseRegionOverlay();
    } catch (e) {
      // Stay open so the user can retry instead of losing the overlay
      setError(errText(e));
    }
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!shot) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = true;
    setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setDrag((d) => (d ? { ...d, x1: e.clientX, y1: e.clientY } : d));
  };

  const onMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDrag(null);
    const s = startRef.current;
    const rect = {
      x: Math.min(s.x, e.clientX),
      y: Math.min(s.y, e.clientY),
      w: Math.abs(e.clientX - s.x),
      h: Math.abs(e.clientY - s.y),
    };
    // A click without a real drag cancels the overlay, like clicking outside the region
    if (rect.w < 4 || rect.h < 4 || !shot || !imgRef.current) {
      CaptureService.CloseRegionOverlay();
      return;
    }
    // The screenshot is physical pixels shown at CSS size, so map back through the ratio
    const scaleX = shot.width / imgRef.current.clientWidth;
    const scaleY = shot.height / imgRef.current.clientHeight;
    confirm(
      Math.round(rect.x * scaleX),
      Math.round(rect.y * scaleY),
      Math.max(1, Math.round(rect.w * scaleX)),
      Math.max(1, Math.round(rect.h * scaleY)),
    );
  };

  const sel = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div className="ov" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      {shot && (
        <img
          ref={imgRef}
          className="ov-shot"
          src={`data:image/png;base64,${shot.data}`}
          alt=""
          draggable={false}
        />
      )}
      {sel && <div className="ov-sel" style={{ left: sel.left, top: sel.top, width: sel.width, height: sel.height }} />}
      {!error && <div className="ov-chip ov-hint">Drag to select a region</div>}
      {error && <div className="ov-chip ov-error">{error}</div>}
    </div>
  );
}

export default RegionOverlay;
