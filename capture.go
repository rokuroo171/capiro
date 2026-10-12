package main

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"sync"
	"time"

	"github.com/kbinani/screenshot"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// CaptureResult is the image payload handed to the frontend for every capture
type CaptureResult struct {
	Data        []byte  `json:"data"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Mode        string  `json:"mode"`
	ScreenIndex int     `json:"screenIndex"`
	Scale       float64 `json:"scale"`
	CapturedAt  int64   `json:"capturedAt"`
}

// ScreenInfo describes one monitor in physical pixels.
type ScreenInfo struct {
	Index int     `json:"index"`
	X     int     `json:"x"`
	Y     int     `json:"y"`
	W     int     `json:"w"`
	H     int     `json:"h"`
	Scale float64 `json:"scale"`
}

// WindowInfo describes one capturable top-level window.
type WindowInfo struct {
	Hwnd  uintptr `json:"hwnd"`
	Title string  `json:"title"`
	X     int     `json:"x"`
	Y     int     `json:"y"`
	W     int     `json:"w"`
	H     int     `json:"h"`
}

type overlayPending struct {
	data        []byte
	width       int
	height      int
	screenIndex int
	scale       float64
	capturedAt  int64
}

// CaptureService backs the frontend capture calls. Windows only for now
type CaptureService struct {
	app *application.App

	mu      sync.Mutex
	pending *overlayPending
	overlay *application.WebviewWindow
}

func (s *CaptureService) attach(app *application.App) {
	s.app = app
}

func (s *CaptureService) Screens() ([]ScreenInfo, error) {
	n := screenshot.NumActiveDisplays()
	if n == 0 {
		return nil, errors.New("no displays found")
	}
	screens := make([]ScreenInfo, 0, n)
	for i := 0; i < n; i++ {
		b := screenshot.GetDisplayBounds(i)
		screens = append(screens, ScreenInfo{
			Index: i,
			X:     b.Min.X,
			Y:     b.Min.Y,
			W:     b.Dx(),
			H:     b.Dy(),
			Scale: displayScaleAt(b.Min.X, b.Min.Y),
		})
	}
	return screens, nil
}

func (s *CaptureService) CaptureScreen(screenIndex int) (CaptureResult, error) {
	screenIndex, err := resolveScreen(screenIndex)
	if err != nil {
		return CaptureResult{}, err
	}
	img, err := screenshot.CaptureDisplay(screenIndex)
	if err != nil {
		return CaptureResult{}, fmt.Errorf("capture screen: %w", err)
	}
	b := screenshot.GetDisplayBounds(screenIndex)
	return buildResult(img, "screen", screenIndex, displayScaleAt(b.Min.X, b.Min.Y))
}

func (s *CaptureService) CaptureRegion(screenIndex, x, y, w, h int) (CaptureResult, error) {
	screenIndex, err := resolveScreen(screenIndex)
	if err != nil {
		return CaptureResult{}, err
	}
	bounds := screenshot.GetDisplayBounds(screenIndex)
	// The overlay reports pixels relative to its own viewport, which covers one monitor exactly
	region := image.Rect(x, y, x+w, y+h)
	if err := validateRegion(region, image.Rect(0, 0, bounds.Dx(), bounds.Dy())); err != nil {
		return CaptureResult{}, err
	}
	img, err := screenshot.Capture(bounds.Min.X+x, bounds.Min.Y+y, w, h)
	if err != nil {
		return CaptureResult{}, fmt.Errorf("capture region: %w", err)
	}
	return buildResult(img, "region", screenIndex, displayScaleAt(bounds.Min.X, bounds.Min.Y))
}

// StartRegionCapture freezes the target screen and opens the frameless overlay
// window that lets the user drag a selection
func (s *CaptureService) StartRegionCapture(screenIndex int) error {
	screenIndex, err := resolveScreen(screenIndex)
	if err != nil {
		return err
	}
	img, err := screenshot.CaptureDisplay(screenIndex)
	if err != nil {
		return fmt.Errorf("capture screen for overlay: %w", err)
	}
	data, err := encodePNG(img)
	if err != nil {
		return err
	}
	bounds := screenshot.GetDisplayBounds(screenIndex)
	now := time.Now().UnixMilli()

	s.mu.Lock()
	// Pressing the region shortcut twice should just restart the flow, not error out
	if s.overlay != nil {
		old := s.overlay
		s.overlay = nil
		s.pending = nil
		s.mu.Unlock()
		old.Close()
		s.mu.Lock()
	}
	s.pending = &overlayPending{
		data:        data,
		width:       img.Bounds().Dx(),
		height:      img.Bounds().Dy(),
		screenIndex: screenIndex,
		scale:       displayScaleAt(bounds.Min.X, bounds.Min.Y),
		capturedAt:  now,
	}
	s.overlay = s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "region-overlay",
		Title:            "Capiro Region Capture",
		Frameless:        true,
		AlwaysOnTop:      true,
		X:                bounds.Min.X,
		Y:                bounds.Min.Y,
		Width:            bounds.Dx(),
		Height:           bounds.Dy(),
		BackgroundColour: application.NewRGB(0, 0, 0),
		URL:              fmt.Sprintf("/region.html?screen=%d", screenIndex),
	})
	s.mu.Unlock()
	return nil
}

func (s *CaptureService) GetRegionOverlayData(screenIndex int) (CaptureResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending == nil || s.pending.screenIndex != screenIndex {
		return CaptureResult{}, errors.New("no pending region capture")
	}
	return CaptureResult{
		Data:        s.pending.data,
		Width:       s.pending.width,
		Height:      s.pending.height,
		Mode:        "region",
		ScreenIndex: s.pending.screenIndex,
		Scale:       s.pending.scale,
		CapturedAt:  s.pending.capturedAt,
	}, nil
}

func (s *CaptureService) CloseRegionOverlay() {
	s.mu.Lock()
	overlay := s.overlay
	s.overlay = nil
	s.pending = nil
	s.mu.Unlock()
	if overlay != nil {
		overlay.Close()
	}
}

func resolveScreen(screenIndex int) (int, error) {
	n := screenshot.NumActiveDisplays()
	if n == 0 {
		return 0, errors.New("no displays found")
	}
	if screenIndex < 0 {
		return screenUnderCursor(n)
	}
	if screenIndex >= n {
		return 0, fmt.Errorf("screen %d not found", screenIndex)
	}
	return screenIndex, nil
}

func validateRegion(region, bounds image.Rectangle) error {
	if region.Empty() {
		return errors.New("region is empty")
	}
	if !region.In(bounds) {
		return errors.New("region is outside the screen")
	}
	return nil
}

func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	// png.BestSpeed keeps the encode short enough that capture feels immediate
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return buf.Bytes(), nil
}

func buildResult(img image.Image, mode string, screenIndex int, scale float64) (CaptureResult, error) {
	data, err := encodePNG(img)
	if err != nil {
		return CaptureResult{}, err
	}
	b := img.Bounds()
	return CaptureResult{
		Data:        data,
		Width:       b.Dx(),
		Height:      b.Dy(),
		Mode:        mode,
		ScreenIndex: screenIndex,
		Scale:       scale,
		CapturedAt:  time.Now().UnixMilli(),
	}, nil
}
