package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	xdraw "golang.org/x/image/draw"
)

// frameColor mirrors the frontend background swatches so the exported image
// matches what the canvas preview showed
var frameColor = map[string]color.RGBA{
	"ink":    {R: 0x14, G: 0x15, B: 0x1B, A: 0xFF},
	"steel":  {R: 0x2E, G: 0x33, B: 0x40, A: 0xFF},
	"walnut": {R: 0x3A, G: 0x31, B: 0x26, A: 0xFF},
	"bone":   {R: 0xD9, G: 0xD4, B: 0xC9, A: 0xFF},
}

// frameRequest is the polish state handed over at export time. Export composes
// capture plus polish here so the frontend never has to rasterize anything.
type frameRequest struct {
	ImageB64   string `json:"imageB64"`
	Background string `json:"background"`
	Padding    int    `json:"padding"`
	Radius     int    `json:"radius"`
	Format     string `json:"format"`
	Quality    int    `json:"quality"`
	Scale      int    `json:"scale"`
	FileName   string `json:"fileName"`
}

// frameImage centers the shot on a background with padding, rounds the shot
// corners by radius, and scales the whole composition by scale. Padding and
// radius are in capture pixels and scale with the output, matching the canvas
// preview which shows the same proportions
func frameImage(img image.Image, background color.RGBA, padding, radius, scale int) (*image.RGBA, error) {
	if scale < 1 || scale > 3 {
		return nil, fmt.Errorf("unsupported export scale %d", scale)
	}
	shotW, shotH := img.Bounds().Dx()*scale, img.Bounds().Dy()*scale
	pad := padding * scale
	w, h := shotW+pad*2, shotH+pad*2
	if w <= 0 || h <= 0 || w > 1<<15 || h > 1<<15 {
		return nil, fmt.Errorf("composed size out of range: %dx%d", w, h)
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(out, out.Bounds(), &image.Uniform{C: background}, image.Point{}, draw.Src)

	shot := img
	if scale > 1 {
		scaled := image.NewRGBA(image.Rect(0, 0, shotW, img.Bounds().Dy()*scale))
		xdraw.CatmullRom.Scale(scaled, scaled.Bounds(), img, img.Bounds(), xdraw.Src, nil)
		shot = scaled
	}
	if radius > 0 {
		mask := roundedMask(shotW, shotH, radius*scale)
		draw.DrawMask(out, image.Rect(pad, pad, pad+shotW, pad+shotH), shot, image.Point{}, mask, image.Point{}, draw.Over)
	} else {
		draw.Draw(out, image.Rect(pad, pad, pad+shotW, pad+shotH), shot, image.Point{}, draw.Src)
	}
	return out, nil
}

// roundedMask returns an alpha mask covering the full rect: opaque except where
// the four corner arcs cut away. Antialiased along the arc edge.
func roundedMask(w, h, radius int) *image.Alpha {
	if radius > w/2 {
		radius = w / 2
	}
	if radius > h/2 {
		radius = h / 2
	}
	m := image.NewAlpha(image.Rect(0, 0, w, h))
	rr := float64(radius)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			cx, cy := cornerCenter(x, y, w, h, radius)
			if cx < 0 {
				m.SetAlpha(x, y, color.Alpha{A: 0xFF})
				continue
			}
			d := rr - math.Hypot(float64(x-cx), float64(y-cy))
			t := math.Min(1, math.Max(0, d))
			m.SetAlpha(x, y, color.Alpha{A: uint8(t*255 + 0.5)})
		}
	}
	return m
}

// cornerCenter reports the arc center affecting pixel (x, y), or negative
// coordinates when the pixel sits in a straight edge or the body of the shape.
func cornerCenter(x, y, w, h, radius int) (int, int) {
	inBody := (x >= radius && x < w-radius) || (y >= radius && y < h-radius)
	if inBody {
		return -1, -1
	}
	switch {
	case x < radius && y < radius:
		return radius, radius
	case x >= w-radius && y < radius:
		return w - radius, radius
	case x < radius && y >= h-radius:
		return radius, h - radius
	default:
		return w - radius, h - radius
	}
} // ExportService handles saving the composed shot. Kept separate from
// CaptureService: export is a different pipeline stage with different state.
type ExportService struct {
	app *application.App
}

func (s *ExportService) attach(app *application.App) {
	s.app = app
}

// ExportComposed opens a native save dialog, composes the polished image, and
// writes it. Returns the saved path, or an empty string when the user cancelled.
func (s *ExportService) ExportComposed(req frameRequest) (string, error) {
	if req.ImageB64 == "" {
		return "", errors.New("no capture to export")
	}
	raw, err := base64.StdEncoding.DecodeString(req.ImageB64)
	if err != nil {
		return "", fmt.Errorf("decode capture: %w", err)
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("decode capture: %w", err)
	}
	bg, ok := frameColor[req.Background]
	if !ok {
		return "", fmt.Errorf("unknown background %q", req.Background)
	}
	format := strings.ToUpper(req.Format)
	if format == "" {
		format = "PNG"
	}
	if format == "WebP" {
		return "", errors.New("WebP export is not wired yet, use PNG or JPEG")
	}
	if format != "PNG" && format != "JPEG" {
		return "", fmt.Errorf("unknown format %q", req.Format)
	}

	composed, err := frameImage(img, bg, req.Padding, req.Radius, req.Scale)
	if err != nil {
		return "", err
	}

	ext := "png"
	var data bytes.Buffer
	if format == "JPEG" {
		ext = "jpg"
		// The composed frame is fully opaque, which JPEG requires
		if err := jpeg.Encode(&data, composed, &jpeg.Options{Quality: clampQuality(req.Quality)}); err != nil {
			return "", fmt.Errorf("encode jpeg: %w", err)
		}
	} else if err := png.Encode(&data, composed); err != nil {
		return "", fmt.Errorf("encode png: %w", err)
	}

	dialog := s.app.Dialog.SaveFile()
	dialog.SetMessage("Export shot")
	dialog.SetFilename(defaultFileName(req.FileName, format, ext))
	dialog.AddFilter(format+" image", "*."+ext)
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("save dialog: %w", err)
	}
	// Empty path means the user dismissed the dialog, not a failure
	if path == "" {
		return "", nil
	}
	// The Windows dialog does not append the extension when a filter alone is set
	if i := strings.LastIndex(path, "."); i < 0 || !strings.EqualFold(path[i:], "."+ext) {
		path += "." + ext
	}
	if err := os.WriteFile(path, data.Bytes(), 0o644); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}
	return path, nil
}

func clampQuality(q int) int {
	if q < 1 {
		return 90
	}
	if q > 100 {
		return 100
	}
	return q
}

// defaultFileName swaps any known image extension for the export format, so a
// capture named capiro-region-800x600.png exports as that base plus .jpg
func defaultFileName(name, format, ext string) string {
	base := name
	for _, e := range []string{".png", ".jpg", ".jpeg", ".webp"} {
		if strings.HasSuffix(strings.ToLower(base), e) {
			base = base[:len(base)-len(e)]
			break
		}
	}
	if base == "" {
		base = "capiro-shot"
	}
	if format == "JPEG" {
		return base + ".jpg"
	}
	return base + "." + ext
}
