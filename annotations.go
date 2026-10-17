package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"strconv"
)

// Point is one capture-image pixel coordinate
type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// AnnotationStyle carries the visual weight of one annotation
type AnnotationStyle struct {
	Color       string  `json:"color"`
	StrokeWidth int     `json:"strokeWidth"`
	Opacity     float64 `json:"opacity"`
}

// AnnotationGeometry holds every per-type field; which ones matter depends on Type
type AnnotationGeometry struct {
	X1, Y1, X2, Y2 int     `json:",omitempty"` // arrow
	X, Y, W, H     int     `json:",omitempty"` // rectangle, ellipse
	Points         []Point `json:",omitempty"` // freehand
}

// Annotation is one markup item, in capture-image pixels
type Annotation struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Geometry AnnotationGeometry `json:"geometry"`
	Style    AnnotationStyle    `json:"style"`
	Order    int                `json:"order"`
}

var annotationTypes = map[string]bool{
	"arrow":     true,
	"rectangle": true,
	"ellipse":   true,
	"freehand":  true,
}

// validateAnnotations rejects malformed annotations with the id in the message,
// per the markup spec's error handling
func validateAnnotations(items []Annotation) error {
	orders := map[int]string{}
	for _, a := range items {
		if !annotationTypes[a.Type] {
			return fmt.Errorf("annotation %s has unknown type %q", a.ID, a.Type)
		}
		switch a.Type {
		case "arrow":
			if a.Geometry.X1 == a.Geometry.X2 && a.Geometry.Y1 == a.Geometry.Y2 {
				return fmt.Errorf("annotation %s arrow has zero length", a.ID)
			}
		case "rectangle", "ellipse":
			if a.Geometry.W <= 0 || a.Geometry.H <= 0 {
				return fmt.Errorf("annotation %s has empty geometry", a.ID)
			}
		case "freehand":
			if len(a.Geometry.Points) < 2 {
				return fmt.Errorf("annotation %s freehand needs at least 2 points", a.ID)
			}
		}
		if prev, dup := orders[a.Order]; dup && prev != a.ID {
			return fmt.Errorf("annotation %s shares order %d with %s", a.ID, a.Order, prev)
		}
		orders[a.Order] = a.ID
	}
	return nil
}

// parseHexColor accepts #RGB and #RRGGBB
func parseHexColor(s string) (color.RGBA, error) {
	if len(s) == 7 && s[0] == '#' {
		v, err := strconv.ParseUint(s[1:], 16, 32)
		if err != nil {
			return color.RGBA{}, fmt.Errorf("bad color %q", s)
		}
		return color.RGBA{R: uint8(v >> 16), G: uint8(v >> 8), B: uint8(v), A: 0xFF}, nil
	}
	if len(s) == 4 && s[0] == '#' {
		v, err := strconv.ParseUint(s[1:], 16, 16)
		if err != nil {
			return color.RGBA{}, fmt.Errorf("bad color %q", s)
		}
		return color.RGBA{
			R: uint8(v>>8&0xF) * 0x11,
			G: uint8(v>>4&0xF) * 0x11,
			B: uint8(v&0xF) * 0x11,
			A: 0xFF,
		}, nil
	}
	return color.RGBA{}, fmt.Errorf("bad color %q", s)
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func strokeWidthToFloat(w int) float64 {
	if w < 1 {
		return 2
	}
	if w > 20 {
		return 20
	}
	return float64(w)
}

// annotateImage draws annotations onto a copy of img in order, capture-image
// pixel coordinates matching the canvas preview
func annotateImage(img image.Image, items []Annotation) (*image.RGBA, error) {
	if err := validateAnnotations(items); err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	dst := image.NewRGBA(bounds)
	draw.Draw(dst, bounds, img, bounds.Min, draw.Src)

	// Ordered lowest to highest; stable original position wins ties
	sorted := make([]Annotation, len(items))
	copy(sorted, items)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j].Order < sorted[j-1].Order; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}

	for _, a := range sorted {
		col, err := parseHexColor(a.Style.Color)
		if err != nil {
			return nil, fmt.Errorf("annotation %s: %w", a.ID, err)
		}
		alpha := a.Style.Opacity
		if alpha <= 0 || alpha > 1 {
			alpha = 1
		}
		w := strokeWidthToFloat(a.Style.StrokeWidth)

		switch a.Type {
		case "arrow":
			drawArrow(dst, a, col, w, alpha)
		case "rectangle":
			drawRectOutline(dst, a, col, w, alpha)
		case "ellipse":
			drawEllipseOutline(dst, a, col, w, alpha)
		case "freehand":
			drawFreehand(dst, a, col, w, alpha)
		}
	}
	return dst, nil
}
