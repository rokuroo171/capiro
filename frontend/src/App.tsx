import { useCallback, useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { CaptureService, ExportService } from "../bindings/github.com/rokuroo171/capiro";
import type { Annotation, CaptureResult, ScreenInfo, WindowInfo } from "../bindings/github.com/rokuroo171/capiro";
import AnnotationOverlay from "./AnnotationOverlay";
import {
  ANNO_COLORS,
  ANNO_WIDTHS,
  reorderAnnotations,
  type AnnoToolKey,
} from "./annotations";

const ZOOM_STEPS = [50, 75, 100, 125, 150];
const FILE_STEM = (result: CaptureResult) =>
  `capiro-${result.mode}-${result.width}x${result.height}.png`;
const EXPORT_BACKGROUNDS: Record<string, string> = {
  ink: "#14151B",
  steel: "#2E3340",
  walnut: "#3A3126",
  bone: "#D9D4C9",
};
const MODES = [
  { key: "r", label: "Region", kbd: "R", svg: '<path d="M3 5 V3 H5 M11 3 H13 V5 M13 11 V13 H11 M5 13 H3 V11"/>' },
  { key: "w", label: "Window", kbd: "W", svg: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M2.5 6.5 H13.5"/>' },
  { key: "f", label: "Full screen", kbd: "F", svg: '<rect x="2.5" y="3" width="11" height="8" rx="1.5"/><path d="M8 11 V13.5 M5.5 13.5 H10.5"/>' },
];
const DRAW_TOOLS: { key: AnnoToolKey; label: string; svg: string }[] = [
  { key: "select", label: "Select", svg: '<path d="M3.5 2.5 L12.5 7.5 L8.5 8.5 L6.5 12.5 Z"/>' },
  { key: "arrow", label: "Arrow", svg: '<path d="M3 13 L12.5 3.5 M12.5 3.5 H7.5 M12.5 3.5 V8.5"/>' },
  { key: "rect", label: "Rectangle", svg: '<rect x="2.5" y="4" width="11" height="8" rx="1.5"/>' },
  { key: "ellipse", label: "Ellipse", svg: '<ellipse cx="8" cy="8" rx="5.5" ry="4"/>' },
  { key: "pen", label: "Pen", svg: '<path d="M3 13 C5 12 6 10 7 8 C8 6 10 4 13 3"/>' },
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface HistoryState {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
}

function App() {
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [screenList, setScreenList] = useState<ScreenInfo[]>([]);
  const [screensLoaded, setScreensLoaded] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("Ready");
  const [statusError, setStatusError] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(100);
  const [modeKey] = useState<string>("r");
  const [scaleKey, setScaleKey] = useState<string>("2x");
  const [bgKey, setBgKey] = useState<string>("ink");
  const [padding, setPadding] = useState<number>(24);
  const [radius, setRadius] = useState<number>(12);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [format, setFormat] = useState<string>("PNG");
  const [quality, setQuality] = useState<number>(90);
  const [fileName, setFileName] = useState<string>("capiro-shot.png");
  const [saved, setSaved] = useState<string | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [recents, setRecents] = useState<{ name: string; meta: string; data: string }[]>([]);

  const [history, setHistory] = useState<HistoryState>({ past: [], present: [], future: [] });
  const [tool, setTool] = useState<AnnoToolKey>("select");
  const [annoColor, setAnnoColor] = useState<string>(ANNO_COLORS[0].key);
  const [annoWidth, setAnnoWidth] = useState<number>(ANNO_WIDTHS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const annotations = history.present;

  const windowDialogRef = useRef<HTMLDialogElement | null>(null);
  const exportDialogRef = useRef<HTMLDialogElement | null>(null);
  const shotImgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const say = (text: string, isError = false) => {
    setStatusMsg(text);
    setStatusError(isError);
  };

  const applyCapture = useCallback((result: CaptureResult, label: string) => {
    if (!result.data) {
      say(`${label} capture returned no image`, true);
      return;
    }
    setCapture(result);
    setSaved(null);
    setFileName(FILE_STEM(result));
    setHistory({ past: [], present: [], future: [] });
    setSelectedId(null);
    say(`${label} capture ready, ${result.width} x ${result.height}`);
  }, []);

  const startScreen = useCallback(async () => {
    try {
      const result = await CaptureService.CaptureScreen(-1);
      if (result) applyCapture(result, "Screen");
    } catch (e) {
      say(errText(e), true);
    }
  }, [applyCapture]);

  useEffect(() => {
    let cancelled = false;
    CaptureService.Screens()
      .then((list) => {
        if (!cancelled) {
          setScreenList(list ?? []);
          setScreensLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setScreensLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const startRegion = useCallback(async () => {
    try {
      await CaptureService.StartRegionCapture(-1);
      say("Drag a region on screen, Escape cancels");
    } catch (e) {
      say(errText(e), true);
    }
  }, []);

  const openWindowPicker = useCallback(async () => {
    try {
      const list = await CaptureService.ListWindows();
      setWindows(list ?? []);
      windowDialogRef.current?.showModal();
    } catch (e) {
      say(errText(e), true);
    }
  }, []);

  const pickWindow = useCallback(
    async (hwnd: number) => {
      try {
        const result = await CaptureService.CaptureWindow(hwnd);
        if (!result) return;
        windowDialogRef.current?.close();
        applyCapture(result, "Window");
      } catch (e) {
        say(errText(e), true);
      }
    },
    [applyCapture],
  );

  useEffect(() => {
    const off = Events.On("capiro:capture-ready", (ev) => {
      const result = ev.data as CaptureResult | undefined;
      if (result) applyCapture(result, "Region");
    });
    return off;
  }, [applyCapture]);

  useEffect(() => {
    document.body.classList.toggle("is-empty", capture === null);
  }, [capture]);

  const hasScreens = !!(screensLoaded && screenList.length > 0);
  const noScreensDetected = screensLoaded && screenList.length === 0;

  useEffect(() => {
    document.body.classList.toggle("has-screens", hasScreens);
  }, [hasScreens]);

  const doExport = useCallback(async () => {
    if (!capture?.data) return;
    setExporting(true);
    try {
      const path = await ExportService.ExportComposed({
        imageB64: capture.data,
        background: EXPORT_BACKGROUNDS[bgKey] ?? EXPORT_BACKGROUNDS.ink,
        padding,
        radius,
        format,
        quality,
        scale: Number(scaleKey.replace("x", "")) || 1,
        fileName,
        annotate: annotations,
      });
      if (!path) {
        say("Export cancelled");
        return;
      }
      setSaved(path);
      const stamp = new Date().toLocaleTimeString();
      const shotData = capture.data;
      if (shotData) {
        setRecents((r) => [{ name: fileName, meta: stamp, data: shotData }, ...r].slice(0, 4));
      }
      say(`Saved ${path}`);
    } catch (e) {
      say(errText(e), true);
    } finally {
      setExporting(false);
    }
  }, [capture, bgKey, padding, radius, format, quality, scaleKey, fileName, annotations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "r") startRegion();
      else if (k === "w") openWindowPicker();
      else if (k === "f") startScreen();
      else if (k === "delete" || k === "backspace") {
        if (selectedId) {
          setHistory((h) => ({
            past: [...h.past, h.present],
            present: h.present.filter((a) => a.id !== selectedId),
            future: [],
          }));
          setSelectedId(null);
        }
      } else if (k === "z") {
        setHistory((h) => {
          if (!h.past.length) return h;
          const prev = h.past[h.past.length - 1];
          return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
        });
      } else if (k === "y") {
        setHistory((h) => {
          if (!h.future.length) return h;
          const next = h.future[0];
          return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startRegion, openWindowPicker, startScreen, selectedId]);

  const setDrawer = (open: boolean) => {
    setDrawerOpen(open);
    document.body.classList.toggle("drawer-open", open);
  };

  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > zoom) : ZOOM_STEPS.slice().reverse().find((s) => s < zoom);
    if (next) setZoom(next);
  };

  const zoomLabel = `${zoom}%`;

  const commitAnnotation = (a: Annotation) => {
    setHistory((h) => ({ past: [...h.past, h.present], present: reorderAnnotations([...h.present, a]), future: [] }));
    setSelectedId(a.id);
  };

  // Live gestures replace rather than push: one move counts as one history entry
  const [liveAnno, setLiveAnno] = useState<Annotation | null>(null);
  const gestureBase = useRef<Annotation[] | null>(null);

  const pickId = (a: Annotation) => a.id;

  const changeLive = (a: Annotation | null) => {
    if (!gestureBase.current) gestureBase.current = annotations;
    setLiveAnno(a);
  };

  const commitGesture = () => {
    const base = gestureBase.current ?? annotations;
    gestureBase.current = null;
    if (liveAnno) {
      const merged = reorderAnnotations(
        base.some((a) => pickId(a) === pickId(liveAnno))
          ? base.map((a) => (pickId(a) === pickId(liveAnno) ? liveAnno : a))
          : [...base, liveAnno],
      );
      setHistory((h) => ({ past: [...h.past, base], present: merged, future: [] }));
      setSelectedId(pickId(liveAnno));
      setLiveAnno(null);
    } else {
      setHistory((h) => ({ past: [...h.past, base], present: base, future: [] }));
    }
  };

  const displayed = liveAnno
    ? annotations.some((a) => pickId(a) === pickId(liveAnno))
      ? annotations.map((a) => (pickId(a) === pickId(liveAnno) ? liveAnno : a))
      : [...annotations, liveAnno]
    : annotations;

  const undo = () => {
    setHistory((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
    });
  };
  const redo = () => {
    setHistory((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    });
  };

  return (
    <>
      <a className="skip" href="#stage">Skip to canvas</a>

      <header className="tbar">
        <div className="tbar-side">
          <button
            className="icon-btn only-narrow"
            type="button"
            aria-expanded={drawerOpen}
            aria-controls="rail"
            aria-label="Open capture library"
            onClick={() => setDrawer(!drawerOpen)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5 H13 M3 8 H13 M3 11 H13"/>
            </svg>
          </button>
          <span className="lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <span className="wordmark">Capiro</span>
        </div>

        <div className="tbar-doc">
          <span className="doc-name">{capture ? fileName : "No capture yet"}</span>
          <span className="chip">{saved ? "Saved" : "Unsaved"}</span>
        </div>

        <div className="tbar-side">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!capture || exporting}
            onClick={() => {
              if (capture) setFileName(FILE_STEM(capture));
              exportDialogRef.current?.showModal();
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2.5 V10 M4.5 7 L8 10.5 L11.5 7 M3 13 H13"/>
            </svg>
            Export
          </button>
        </div>
      </header>

      <div className="shell">
        <nav id="rail" className="rail" aria-label="Capture library">
          <section aria-labelledby="capture-h">
            <h2 className="rail-title" id="capture-h">Capture</h2>
            {hasScreens ? (
              <p className="rail-meta" id="screens-meta">{screenList.length} screen{screenList.length === 1 ? "" : "s"} detected</p>
            ) : noScreensDetected ? (
              <p className="rail-meta" id="screens-meta">No screens detected</p>
            ) : null}
            {noScreensDetected ? (
              <p className="modes-note" id="modes-note">No screens detected for capture</p>
            ) : null}
            <div className="modes" role="group" aria-label="Capture mode" aria-describedby={noScreensDetected ? "modes-note" : undefined}>
              {MODES.map(({ key, label, kbd, svg }) => (
                <button
                  key={key}
                  className="mode"
                  type="button"
                  aria-pressed={modeKey === key}
                  aria-disabled={modeKey !== key && noScreensDetected ? true : undefined}
                  onClick={() => {
                    if (key === "r") startRegion();
                    else if (key === "w") openWindowPicker();
                    else startScreen();
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                    {svg}
                  </svg>
                  <span className="mode-label">{label}</span>
                  <kbd className="kbd">{kbd}</kbd>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="recent-h">
            <h2 className="rail-title" id="recent-h">Recent</h2>
            <ul className="list" id="list">
              {recents.map((r, i) => (
                <li className="row" key={i}>
                  <button
                    className="row-open"
                    type="button"
                    onClick={() => {
                      if (!capture) return;
                      setCapture({ ...capture, data: r.data });
                      setFileName(r.name);
                      setSaved(null);
                      setHistory({ past: [], present: [], future: [] });
                      say(`Editing ${r.name}`);
                    }}
                  >
                    <span className="row-thumb" aria-hidden="true">
                      <img src={`data:image/png;base64,${r.data}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 3 }} />
                    </span>
                    <span className="row-text">
                      <span className="row-name">{r.name}</span>
                      <span className="row-meta">{r.meta}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="list-empty">No recent captures<p>Exports land here</p></li>
            </ul>
          </section>
        </nav>

        <main className="stage" id="stage">
          <div className="tools" role="toolbar" aria-label="Markup tools">
            <div className="tool-group">
              {DRAW_TOOLS.map(({ key, label, svg }) => (
                <button
                  key={key}
                  className="tool"
                  type="button"
                  aria-pressed={tool === key}
                  title={label}
                  aria-label={label}
                  onClick={() => {
                    setTool(key);
                    if (key !== "select") setSelectedId(null);
                  }}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                    {svg}
                  </svg>
                </button>
              ))}
            </div>

            <span className="tool-div" aria-hidden="true"></span>

            <div className="tool-group">
              <button className="tool" type="button" aria-label="Undo" onClick={undo}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 4 L3 7 L6 10 M3 7 H9 a3.5 3.5 0 1 1 0 7 H7"/>
                </svg>
              </button>
              <button className="tool" type="button" aria-label="Redo" onClick={redo}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 4 L13 7 L10 10 M13 7 H7 a3.5 3.5 0 1 0 0 7 H9"/>
                </svg>
              </button>
            </div>

            <span className="tool-div" aria-hidden="true"></span>

            <div className="tool-group anno-style" aria-label="Annotation style">
              {ANNO_COLORS.map((c) => (
                <button
                  key={c.key}
                  className={`swatch tool-color ${c.key === annoColor ? "is-active" : ""}`}
                  type="button"
                  style={{ background: c.key }}
                  aria-label={`${c.label} annotation color`}
                  aria-pressed={c.key === annoColor}
                  onClick={() => setAnnoColor(c.key)}
                ></button>
              ))}
              <span className="tool-div" aria-hidden="true"></span>
              {ANNO_WIDTHS.map((w) => (
                <button
                  key={w}
                  className={`tool tool-width ${w === annoWidth ? "is-active" : ""}`}
                  type="button"
                  aria-label={`${w} pixel stroke width`}
                  aria-pressed={w === annoWidth}
                  onClick={() => setAnnoWidth(w)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={w / 2}>
                    <path d="M3 8 H13"/>
                  </svg>
                </button>
              ))}
            </div>

            <span className="tool-div" aria-hidden="true"></span>

            <div className="tool-group zoom">
              <button className="tool" type="button" aria-label="Zoom out" onClick={() => stepZoom(-1)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M3.5 8 H12.5"/>
                </svg>
              </button>
              <span className="zoom-val" aria-live="polite">{zoomLabel}</span>
              <button className="tool" type="button" aria-label="Zoom in" onClick={() => stepZoom(1)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M8 3.5 V12.5 M3.5 8 H12.5"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="canvas" id="canvas" data-zoom={zoom}>
            <div className="shot-wrap">
              <div className="frame">
                <i className="tick tick-tl" aria-hidden="true"></i>
                <i className="tick tick-tr" aria-hidden="true"></i>
                <i className="tick tick-bl" aria-hidden="true"></i>
                <i className="tick tick-br" aria-hidden="true"></i>
                <figure
                  className={capture ? "shot has-image" : "shot"}
                  style={{
                    "--shot-bg": EXPORT_BACKGROUNDS[bgKey] ?? EXPORT_BACKGROUNDS.ink,
                    "--shot-pad": `${padding}px`,
                    "--shot-radius": `${radius}px`,
                  } as React.CSSProperties}
                >
                  {capture && (
                    <>
                      <img
                        ref={shotImgRef}
                        className="shot-img"
                        src={`data:image/png;base64,${capture.data}`}
                        alt="Current capture"
                        onLoad={() => {
                          setImgSize({ w: capture.width, h: capture.height });
                        }}
                      />
                      {imgSize.w > 0 && (
                        <div className="anno-wrap">
                          <AnnotationOverlay
                            annotations={displayed}
                            tool={tool}
                            color={annoColor}
                            strokeWidth={annoWidth}
                            imgW={imgSize.w}
                            imgH={imgSize.h}
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            onCommit={commitAnnotation}
                            onChangeLive={changeLive}
                            onMoveCommit={commitGesture}
                          />
                        </div>
                      )}
                      <figcaption className="sr-only">
                        Captured {capture.mode} of screen {capture.screenIndex}
                      </figcaption>
                    </>
                  )}
                </figure>
              </div>
            </div>

            <div className="empty" id="emptyState">
              <div className="empty-art">
                <i className="tick tick-tl" aria-hidden="true"></i>
                <i className="tick tick-tr" aria-hidden="true"></i>
                <i className="tick tick-bl" aria-hidden="true"></i>
                <i className="tick tick-br" aria-hidden="true"></i>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 8 V16 M8 12 H16"/>
                </svg>
              </div>
              <h2>No capture yet</h2>
              <p>Start a region, window, or full-screen capture to land a shot on the canvas</p>
              <button className="btn btn-primary" type="button" onClick={() => startRegion()}>
                New capture
              </button>
            </div>
          </div>

          <div className="status">
            <span className={statusError ? "status-msg is-error" : "status-msg"} role="status" aria-live="polite">{statusMsg}</span>
            <span className="status-meta">
              {capture ? (
                <>
                  <span>{capture.width} x {capture.height}</span>
                  <span className="hide-sm">{capture.mode}</span>
                  <span className="hide-sm">screen {capture.screenIndex}&nbsp;&nbsp;{capture.scale.toFixed(2)}x</span>
                </>
              ) : (
                <span>no capture yet</span>
              )}
              <span>{zoomLabel}</span>
            </span>
          </div>
        </main>

        <aside className="inspector" aria-label="Polish controls">
          <h2 className="ins-title">Polish</h2>

          <section className="ins-group" aria-labelledby="frame-h">
            <h3 className="ins-h" id="frame-h">Frame</h3>
            <div className="field">
              <div className="field-head">
                <label htmlFor="padRange">Padding</label>
                <output id="padOut" htmlFor="padRange">{padding} px</output>
              </div>
              <input
                type="range"
                id="padRange"
                min={0}
                max={64}
                step={4}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <div className="field-head">
                <label htmlFor="radRange">Corner radius</label>
                <output id="radOut" htmlFor="radRange">{radius} px</output>
              </div>
              <input
                type="range"
                id="radRange"
                min={0}
                max={32}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </div>
          </section>

          <section className="ins-group" aria-labelledby="bg-h">
            <h3 className="ins-h" id="bg-h">Background</h3>
            <div className="swatches" role="group" aria-label="Canvas background">
              {[
                { key: "ink", label: "Ink background", className: "swatch-ink" },
                { key: "steel", label: "Steel background", className: "swatch-steel" },
                { key: "walnut", label: "Walnut background", className: "swatch-walnut" },
                { key: "bone", label: "Bone background", className: "swatch-bone" },
              ].map(({ key, label, className }) => (
                <button
                  key={key}
                  className={`swatch ${className}`}
                  type="button"
                  aria-pressed={bgKey === key}
                  aria-label={label}
                  onClick={() => setBgKey(key)}
                ></button>
              ))}
            </div>
          </section>

          <section className="ins-group" aria-labelledby="out-h">
            <h3 className="ins-h" id="out-h">Output</h3>
            <div className="seg" role="group" aria-label="Export scale">
              {["1x", "2x", "3x"].map((k) => (
                <button
                  key={k}
                  className="seg-btn"
                  type="button"
                  aria-pressed={scaleKey === k}
                  onClick={() => setScaleKey(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="scrim" id="scrim" onClick={() => setDrawer(false)}></div>

      <dialog id="windowDialog" aria-labelledby="windowTitle" ref={windowDialogRef}>
        <form method="dialog">
          <div className="modal-head">
            <h2 id="windowTitle">Capture a window</h2>
            <button className="icon-btn" type="submit" value="cancel" aria-label="Close window picker">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M4 4 L12 12 M12 4 L4 12"/>
              </svg>
            </button>
          </div>
          <div className="modal-body">
            {windows.length === 0 && <p className="modal-path">No capturable windows found</p>}
            {windows.map((w) => (
              <button
                key={w.hwnd}
                className="menu-item"
                type="button"
                onClick={() => pickWindow(w.hwnd)}
              >
                <span className="row-name">{w.title}</span>
                <span className="row-meta">{w.w} x {w.h}</span>
              </button>
            ))}
          </div>
        </form>
      </dialog>

      <dialog id="exportDialog" aria-labelledby="exportTitle" ref={exportDialogRef}>
        <form method="dialog">
          <div className="modal-head">
            <h2 id="exportTitle">Export shot</h2>
            <button className="icon-btn" type="submit" value="cancel" aria-label="Close export dialog">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M4 4 L12 12 M12 4 L4 12"/>
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <fieldset>
              <legend>Format</legend>
              <div className="seg" role="group" aria-label="Export format">
                {["PNG", "WebP", "JPEG"].map((f) => (
                  <button
                    key={f}
                    className="seg-btn"
                    type="button"
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <div className="field-head">
                <label htmlFor="qRange">Quality</label>
                <output id="qOut" htmlFor="qRange">{quality}</output>
              </div>
              <input
                type="range"
                id="qRange"
                min={40}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <div className="field-head">
                <label htmlFor="fileName">File name</label>
              </div>
              <input
                type="text"
                id="fileName"
                value={fileName}
                spellCheck="false"
                onChange={(e) => setFileName(e.target.value)}
              />
            </div>
            <p className="modal-path">A native save dialog picks the destination</p>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" type="submit" value="cancel">Cancel</button>
            <button
              className="btn btn-primary"
              type="submit"
              value="export"
              disabled={exporting}
              onClick={doExport}
            >
              {exporting ? "Exporting" : "Export shot"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export default App;
