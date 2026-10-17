package main

import (
	"image"
	"image/color"
	"testing"
)

func TestValidateAnnotations(t *testing.T) {
	ok := []Annotation{
		{ID: "a1", Type: "arrow", Geometry: AnnotationGeometry{X1: 0, Y1: 0, X2: 10, Y2: 10}, Style: AnnotationStyle{Color: "#F2B33D", StrokeWidth: 2, Opacity: 1}, Order: 0},
		{ID: "a2", Type: "freehand", Geometry: AnnotationGeometry{Points: []Point{{X: 0, Y: 0}, {X: 5, Y: 5}}}, Style: AnnotationStyle{Color: "#FF4D4D", StrokeWidth: 4, Opacity: 1}, Order: 1},
	}
	if err := validateAnnotations(ok); err != nil {
		t.Fatalf("valid annotations rejected: %v", err)
	}

	unknown := []Annotation{{ID: "a1", Type: "sparkle"}}
	if err := validateAnnotations(unknown); err == nil {
		t.Fatal("unknown type should be rejected")
	}

	zeroArrow := []Annotation{{ID: "a1", Type: "arrow", Geometry: AnnotationGeometry{X1: 3, Y1: 3, X2: 3, Y2: 3}}}
	if err := validateAnnotations(zeroArrow); err == nil {
		t.Fatal("zero-length arrow should be rejected")
	}

	emptyRect := []Annotation{{ID: "a1", Type: "rectangle", Geometry: AnnotationGeometry{X: 0, Y: 0, W: 0, H: 10}}}
	if err := validateAnnotations(emptyRect); err == nil {
		t.Fatal("empty rectangle should be rejected")
	}

	onePoint := []Annotation{{ID: "a1", Type: "freehand", Geometry: AnnotationGeometry{Points: []Point{{X: 1, Y: 1}}}}}
	if err := validateAnnotations(onePoint); err == nil {
		t.Fatal("single point freehand should be rejected")
	}

	dupOrder := []Annotation{
		{ID: "a1", Type: "arrow", Geometry: AnnotationGeometry{X1: 0, Y1: 0, X2: 9, Y2: 9}, Order: 3},
		{ID: "a2", Type: "arrow", Geometry: AnnotationGeometry{X1: 1, Y1: 1, X2: 9, Y2: 9}, Order: 3},
	}
	if err := validateAnnotations(dupOrder); err == nil {
		t.Fatal("duplicate order should be rejected")
	}
}

func TestParseHexColor(t *testing.T) {
	c, err := parseHexColor("#F2B33D")
	if err != nil {
		t.Fatalf("6-digit hex rejected: %v", err)
	}
	if c != (color.RGBA{R: 0xF2, G: 0xB3, B: 0x3D, A: 0xFF}) {
		t.Fatalf("wrong color: %+v", c)
	}
	c, err = parseHexColor("#F2B")
	if err != nil {
		t.Fatalf("3-digit hex rejected: %v", err)
	}
	if c != (color.RGBA{R: 0xFF, G: 0x22, B: 0xBB, A: 0xFF}) {
		t.Fatalf("wrong expanded color: %+v", c)
	}
	if _, err := parseHexColor("amber"); err == nil {
		t.Fatal("non-hex should be rejected")
	}
	if _, err := parseHexColor("#12345"); err == nil {
		t.Fatal("5-digit hex should be rejected")
	}
}

func TestAnnotateImageDraws(t *testing.T) {
	base := image.NewRGBA(image.Rect(0, 0, 40, 40))
	for i := range base.Pix {
		base.Pix[i] = 0x30
	}
	ann := []Annotation{{
		ID: "a1", Type: "rectangle",
		Geometry: AnnotationGeometry{X: 5, Y: 5, W: 30, H: 30},
		Style:    AnnotationStyle{Color: "#FF0000", StrokeWidth: 2, Opacity: 1},
		Order:    0,
	}}
	out, err := annotateImage(base, ann)
	if err != nil {
		t.Fatalf("annotateImage: %v", err)
	}
	// Top edge center of the rectangle stroke must be red-tinted
	c := out.RGBAAt(20, 5)
	if c.R < 0xC0 {
		t.Fatalf("top stroke pixel not red: %+v", c)
	}
	// Interior stays base
	c = out.RGBAAt(20, 20)
	if c.R != 0x30 {
		t.Fatalf("interior was painted: %+v", c)
	}
	// Background copy must match the original outside the stroke
	c = out.RGBAAt(39, 39)
	if c.R != 0x30 {
		t.Fatalf("background copy altered: %+v", c)
	}
}

func TestAnnotateImageOrder(t *testing.T) {
	base := image.NewRGBA(image.Rect(0, 0, 30, 30))
	blue := Annotation{ID: "b", Type: "arrow", Geometry: AnnotationGeometry{X1: 0, Y1: 15, X2: 30, Y2: 15}, Style: AnnotationStyle{Color: "#0000FF", StrokeWidth: 6, Opacity: 1}, Order: 1}
	red := Annotation{ID: "r", Type: "rectangle", Geometry: AnnotationGeometry{X: 5, Y: 5, W: 20, H: 20}, Style: AnnotationStyle{Color: "#FF0000", StrokeWidth: 6, Opacity: 1}, Order: 0}
	out, err := annotateImage(base, []Annotation{blue, red})
	if err != nil {
		t.Fatalf("annotateImage: %v", err)
	}
	// Red rectangle draws first, blue arrow over it along the midline
	c := out.RGBAAt(15, 15)
	if c.B < c.R {
		t.Fatalf("order wrong: red %+v should sit under blue", c)
	}
}
