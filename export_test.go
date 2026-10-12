package main

import (
	"image"
	"image/color"
	"testing"
)

func TestFrameImage(t *testing.T) {
	shot := image.NewRGBA(image.Rect(0, 0, 10, 6))
	// A red shot pixel that must land in the body at (pad+5, pad+3)
	shot.Set(5, 3, color.RGBA{R: 0xFF, A: 0xFF})
	out, err := frameImage(shot, color.RGBA{R: 0x14, G: 0x15, B: 0x1B, A: 0xFF}, 4, 0, 1)
	if err != nil {
		t.Fatalf("frameImage: %v", err)
	}
	wantW, wantH := 10+4*2, 6+4*2
	if out.Bounds().Dx() != wantW || out.Bounds().Dy() != wantH {
		t.Fatalf("expected %dx%d, got %dx%d", wantW, wantH, out.Bounds().Dx(), out.Bounds().Dy())
	}
	// The padding ring must take the background color, the body the shot
	bgAt := func(x, y int) color.RGBA { return color.RGBAModel.Convert(out.At(x, y)).(color.RGBA) }
	if c := bgAt(1, 1); c != (color.RGBA{R: 0x14, G: 0x15, B: 0x1B, A: 0xFF}) {
		t.Fatalf("padding corner is not background: %+v", c)
	}
	if c := bgAt(9, 7); c.R != 0xFF || c.A != 0xFF {
		t.Fatalf("shot pixel should be copied into the body: %+v", c)
	}
}

func TestFrameImageScale(t *testing.T) {
	shot := image.NewRGBA(image.Rect(0, 0, 8, 8))
	out, err := frameImage(shot, color.RGBA{A: 0xFF}, 2, 0, 2)
	if err != nil {
		t.Fatalf("frameImage: %v", err)
	}
	if out.Bounds().Dx() != 8*2+2*2*2 || out.Bounds().Dy() != 8*2+2*2*2 {
		t.Fatalf("unexpected scaled size: %v", out.Bounds())
	}
	if _, err := frameImage(shot, color.RGBA{A: 0xFF}, 0, 0, 0); err == nil {
		t.Fatal("scale 0 should be rejected")
	}
	if _, err := frameImage(shot, color.RGBA{A: 0xFF}, 0, 0, 4); err == nil {
		t.Fatal("scale 4 should be rejected")
	}
}

func TestRoundedMaskOpaqueBody(t *testing.T) {
	m := roundedMask(20, 20, 4)
	// Body and edges stay opaque; exact corner pixels go fully transparent
	if a := m.AlphaAt(10, 10).A; a != 0xFF {
		t.Fatalf("body should be opaque, got %d", a)
	}
	if a := m.AlphaAt(10, 0).A; a != 0xFF {
		t.Fatalf("top edge should be opaque, got %d", a)
	}
	if a := m.AlphaAt(0, 0).A; a != 0x00 {
		t.Fatalf("corner pixel should be transparent, got %d", a)
	}
}

func TestClampQuality(t *testing.T) {
	if got := clampQuality(0); got != 90 {
		t.Fatalf("unset quality should default to 90, got %d", got)
	}
	if got := clampQuality(500); got != 100 {
		t.Fatalf("quality over 100 should clamp, got %d", got)
	}
	if got := clampQuality(75); got != 75 {
		t.Fatalf("in range quality should pass through, got %d", got)
	}
}

func TestDefaultFileName(t *testing.T) {
	if got := defaultFileName("capiro-region-800x600.png", "JPEG", "jpg"); got != "capiro-region-800x600.jpg" {
		t.Fatalf("unexpected name: %q", got)
	}
	if got := defaultFileName("shot.webp", "PNG", "png"); got != "shot.png" {
		t.Fatalf("unexpected name: %q", got)
	}
	if got := defaultFileName("", "PNG", "png"); got != "capiro-shot.png" {
		t.Fatalf("empty name should fall back: %q", got)
	}
}
