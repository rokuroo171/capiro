import { useState, useEffect, useRef } from 'react'

function App() {
  const [docName, setDocName] = useState<string>('onboarding-checklist.png');
  const [statusMsg, setStatusMsg] = useState<string>('Ready');
  const [zoom, setZoom] = useState<number>(100);
  const [empty, setEmpty] = useState<boolean>(false);

  const [modeKey, setModeKey] = useState<string>('r');
  const [toolKey, setToolKey] = useState<string>('select');
  const [scaleKey, setScaleKey] = useState<string>('2x');
  const [bgKey, setBgKey] = useState<string>('ink');
  const [padding, setPadding] = useState<number>(24);
  const [radius, setRadius] = useState<number>(12);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const zoomInRef = useRef<HTMLButtonElement | null>(null);
  const zoomOutRef = useRef<HTMLButtonElement | null>(null);

  const setDrawerOpen = (open: boolean) => {
    const rail = railRef.current;
    const was = rail?.classList.contains('is-open') ?? false;
    if (was === open) return;
    if (open) rail?.classList.add('is-open');
    else rail?.classList.remove('is-open');
    const btn = document.getElementById('drawerBtn') as HTMLButtonElement | null;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) {
      try { btn?.focus(); } catch (e) { /* drawer focus is best-effort */ }
    }
  };

  const say = (text: string) => setStatusMsg(text);

  const selectRowByName = (name: string) => {
    setDocName(name);
    say(`Editing ${name}`);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onToggleDrawer = (e: Event) => {
      setDrawerOpen((e as CustomEvent<boolean>).detail);
    };
    const onSelectDoc = (e: Event) => {
      selectRowByName((e as CustomEvent<string>).detail);
    };
    const onSay = (e: Event) => {
      say((e as CustomEvent<string>).detail);
    };
    const onZoomIn = () => {
      const steps = [50, 75, 100, 125, 150];
      const next = steps.find((s) => s > zoom);
      if (next) setZoom(next);
    };
    const onZoomOut = () => {
      const steps = [50, 75, 100, 125, 150];
      const prev = steps.slice().reverse().find((s) => s < zoom);
      if (prev) setZoom(prev);
    };

    stage.addEventListener('toggleDrawer', onToggleDrawer);
    stage.addEventListener('selectDoc', onSelectDoc);
    stage.addEventListener('say', onSay);
    stage.addEventListener('zoomIn', onZoomIn);
    stage.addEventListener('zoomOut', onZoomOut);

    const onResize = () => {
      const hide = window.matchMedia('(max-width: 900px)').matches;
      document.documentElement.classList.toggle('drawer-narrow', hide);
    };
    onResize();
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      stage.removeEventListener('toggleDrawer', onToggleDrawer);
      stage.removeEventListener('selectDoc', onSelectDoc);
      stage.removeEventListener('say', onSay);
      stage.removeEventListener('zoomIn', onZoomIn);
      stage.removeEventListener('zoomOut', onZoomOut);
      window.removeEventListener('resize', onResize);
    };
  }, [zoom]);

  const zoomLabel = `${zoom}%`;
  const isExportDisabled = empty;

  return (
    <>
      <a className="skip" href="#stage">Skip to canvas</a>

      <header className="tbar">
        <div className="tbar-side">
          <button
            id="drawerBtn"
            className="icon-btn only-narrow"
            type="button"
            aria-expanded={railRef.current?.classList.contains('is-open') ? 'true' : 'false'}
            aria-controls="rail"
            aria-label="Open capture library"
            onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('toggleDrawer', { detail: !railRef.current?.classList.contains('is-open') }))}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5 H13 M3 8 H13 M3 11 H13"/>
            </svg>
          </button>
          <span className="lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <span className="wordmark">Capiro</span>
        </div>

        <div className="tbar-doc">
          <span className="doc-name">{docName}</span>
          <span className="chip">Unsaved</span>
        </div>

        <div className="tbar-side">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => { setEmpty((v) => !v); }}
          >
            Empty state
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={isExportDisabled}
            onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('say', { detail: 'Export dialog opens from the real shell' }))}
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
            <div className="modes" role="group" aria-label="Capture mode">
              {[
                { key: 'r', label: 'Region', kbd: 'R', svg: '<path d="M3 5 V3 H5 M11 3 H13 V5 M13 11 V13 H11 M5 13 H3 V11"/>' },
                { key: 'w', label: 'Window', kbd: 'W', svg: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M2.5 6.5 H13.5"/>' },
                { key: 'f', label: 'Full screen', kbd: 'F', svg: '<rect x="2.5" y="3" width="11" height="8" rx="1.5"/><path d="M8 11 V13.5 M5.5 13.5 H10.5"/>' }
              ].map(({ key, label, kbd, svg }) => (
                <button
                  key={key}
                  className="mode"
                  type="button"
                  data-group="mode"
                  data-key={key}
                  aria-pressed={modeKey === key}
                  onClick={() => { setModeKey(key); stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('selectDoc', { detail: docName })); }}
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
              {[
                'onboarding-checklist.png',
                'pricing-page-v3.png',
                'release-notes-draft.png',
                'settings-dark-mode.png'
              ].map((name, i) => (
                <li className="row" key={i}>
                  <button
                    className="row-open"
                    type="button"
                    data-name={name}
                    aria-current={docName === name}
                    onClick={() => selectRowByName(name)}
                  >
                    <span className="row-thumb" aria-hidden="true">
                      <svg viewBox="0 0 16 8" fill="none" stroke="currentColor" strokeWidth="1"><rect x="1" y="1" width="14" height="6" rx="1"/><path d="M1 3 H15"/></svg>
                    </span>
                    <span className="row-text">
                      <span className="row-name">{name}</span>
                      <span className="row-meta">{i === 0 ? '1.8 MB / 6 min ago' : i === 1 ? '2.4 MB / 42 min ago' : i === 2 ? '980 KB / Yesterday' : '1.2 MB / Tuesday'}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="list-empty">No recent captures<p>Your captures land here after the first shot</p></li>
            </ul>
          </section>
        </nav>

        <main className="stage" id="stage" ref={stageRef}>
          <div className="tools" role="toolbar" aria-label="Markup tools">
            <div className="tool-group">
              {[
                { key: 'select', label: 'Select', svg: '<path d="M3.5 2.5 L12.5 7.5 L8.5 8.5 L6.5 12.5 Z"/>' },
                { key: 'arrow', label: 'Arrow', svg: '<path d="M3 13 L12.5 3.5 M12.5 3.5 H7.5 M12.5 3.5 V8.5"/>' },
                { key: 'highlight', label: 'Highlight', svg: '<path d="M4 12.5 H12 M6.5 9.5 L10 3.5 L12.5 5.5 L9 11.5 Z"/>' },
                { key: 'text', label: 'Text', svg: '<path d="M3.5 4.5 V3 H12.5 V4.5 M8 3 V13 M5.5 13 H10.5"/>' },
                { key: 'rect', label: 'Rectangle', svg: '<rect x="2.5" y="4" width="11" height="8" rx="1.5"/>' },
                { key: 'ellipse', label: 'Ellipse', svg: '<ellipse cx="8" cy="8" rx="5.5" ry="4"/>' },
                { key: 'pen', label: 'Pen', svg: '<path d="M3 13 C5 12 6 10 7 8 C8 6 10 4 13 3"/>' },
                { key: 'blur', label: 'Blur', svg: '<rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2.5 2"/><path d="M6 7.5 v.01 M10 8.5 v.01 M8 11 v.01"/>' }
              ].map(({ key, label, svg }) => (
                <button
                  key={key}
                  className="tool"
                  type="button"
                  data-group="tool"
                  aria-pressed={toolKey === key}
                  title={label}
                  aria-label={label}
                  onClick={() => setToolKey(key)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                    {svg}
                  </svg>
                </button>
              ))}
            </div>

            <span className="tool-div" aria-hidden="true"></span>

            <div className="tool-group">
              <button
                className="tool"
                type="button"
                aria-label="Undo"
                data-msg="Nothing to undo yet"
                onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('say', { detail: 'Nothing to undo yet' }))}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 4 L3 7 L6 10 M3 7 H9 a3.5 3.5 0 1 1 0 7 H7"/>
                </svg>
              </button>
              <button
                className="tool"
                type="button"
                aria-label="Redo"
                data-msg="Nothing to redo yet"
                onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('say', { detail: 'Nothing to redo yet' }))}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 4 L13 7 L10 10 M13 7 H7 a3.5 3.5 0 1 0 0 7 H9"/>
                </svg>
              </button>
            </div>

            <span className="tool-div" aria-hidden="true"></span>

            <div className="tool-group zoom">
              <button
                ref={zoomOutRef}
                className="tool"
                type="button"
                aria-label="Zoom out"
                onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('zoomOut'))}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M3.5 8 H12.5"/>
                </svg>
              </button>
              <span className="zoom-val" aria-live="polite">{zoomLabel}</span>
              <button
                ref={zoomInRef}
                className="tool"
                type="button"
                aria-label="Zoom in"
                onClick={() => stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('zoomIn'))}
              >
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
                <figure className="shot">
                  <div className="shot-bar" aria-hidden="true">
                    <span className="lights lights-sm"><i></i><i></i><i></i></span>
                    <span className="shot-url">app.meridian.io/projects</span>
                  </div>
                  <div className="shot-body" aria-hidden="true">
                    <div className="fake-nav">
                      <span className="fake-logo"></span>
                      <span className="fake-link n1"></span>
                      <span className="fake-link n2"></span>
                      <span className="fake-link n3"></span>
                      <span className="fake-avatar"></span>
                    </div>
                    <div className="fake-hero">
                      <span className="fake-h"></span>
                      <span className="fake-p w1"></span>
                      <span className="fake-p w2"></span>
                      <span className="fake-cta-wrap">
                        <span className="fake-cta"><i></i></span>
                        <span className="ann-hl"></span>
                      </span>
                    </div>
                    <div className="fake-cards">
                      <span className="fake-card"><span className="fake-thumb"></span><span className="fake-bar"></span><span className="fake-bar s"></span></span>
                      <span className="fake-card"><span className="fake-thumb"></span><span className="fake-bar"></span><span className="fake-bar s"></span></span>
                      <span className="fake-card"><span className="fake-thumb"></span><span className="fake-bar"></span><span className="fake-bar s"></span></span>
                    </div>
                    <span className="ann-blur"></span>
                    <span className="ann-note">Contrast fails AA</span>
                    <svg className="ann-arrow" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M110 8 C 70 24 50 40 14 64"/>
                      <path d="M14 64 L32 61 M14 64 L21 49"/>
                    </svg>
                  </div>
                  <figcaption className="sr-only">Example capture annotated with a highlight, an arrow, a text note, and a blur region</figcaption>
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
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => { setEmpty(false); stageRef.current && stageRef.current.dispatchEvent(new CustomEvent('say', { detail: 'Ready for a new capture' })); }}
              >
                New capture
              </button>
            </div>
          </div>

          <div className="status">
            <span className="status-msg" role="status" aria-live="polite">{statusMsg}</span>
            <span className="status-meta">
              <span>2560 x 1440</span>
              <span className="hide-sm">sRGB</span>
              <span className="hide-sm">x 1284&nbsp;&nbsp;y 642</span>
              <span id="statusZoom">{zoomLabel}</span>
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
                { key: 'ink', label: 'Ink background', className: 'swatch-ink' },
                { key: 'steel', label: 'Steel background', className: 'swatch-steel' },
                { key: 'walnut', label: 'Walnut background', className: 'swatch-walnut' },
                { key: 'bone', label: 'Bone background', className: 'swatch-bone' }
              ].map(({ key, label, className }) => (                  <button
                  key={key}
                  className={`swatch ${className}`}
                  type="button"
                  data-group="swatch"
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
              {['1x', '2x', '3x'].map((k) => (
                <button
                  key={k}
                  className="seg-btn"
                  type="button"
                  data-group="scale"
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

      <div className="scrim" id="scrim"></div>

      <div className="menu" id="rowmenu" role="menu" aria-label="Capture actions" hidden>
        <button className="menu-item" type="button" role="menuitem" data-act="open">Open on canvas</button>
        <button className="menu-item" type="button" role="menuitem" data-act="path">Copy file path</button>
        <button className="menu-item danger" type="button" role="menuitem" data-act="delete">Delete</button>
      </div>

      <dialog id="exportDialog" aria-labelledby="exportTitle">
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
                {['PNG', 'WebP', 'JPEG'].map((f) => (
                  <button
                    key={f}
                    className="seg-btn"
                    type="button"
                    data-group="format"
                    aria-pressed={f === 'PNG'}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <div className="field-head">
                <label htmlFor="qRange">Quality</label>
                <output id="qOut" htmlFor="qRange">90</output>
              </div>
              <input
                type="range"
                id="qRange"
                min={40}
                max={100}
                value={90}
                data-out="qOut"
                data-unit=""
              />
            </div>
            <div className="field">
              <div className="field-head">
                <label htmlFor="fileName">File name</label>
              </div>
              <input
                type="text"
                id="fileName"
                value={docName.replace(/\.png$/, '') + '@2x.png'}
                spellCheck="false"
              />
            </div>
            <p className="modal-path">Saves to ~/Pictures/Capiro</p>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" type="submit" value="cancel">Cancel</button>
            <button className="btn btn-primary" type="submit" value="export">Export shot</button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export default App
