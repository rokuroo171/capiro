package main

import (
	"image"
	"testing"
)

func TestValidateRegion(t *testing.T) {
	bounds := image.Rect(0, 0, 1920, 1080)
	cases := []struct {
		name    string
		region  image.Rectangle
		wantErr bool
	}{
		{"inside", image.Rect(10, 10, 100, 100), false},
		{"full screen", bounds, false},
		{"touching the far corner", image.Rect(1919, 1079, 1920, 1080), false},
		{"negative origin", image.Rect(-5, 0, 10, 10), true},
		{"past the right edge", image.Rect(1900, 0, 1921, 10), true},
		{"below the bottom edge", image.Rect(0, 1000, 10, 1081), true},
		{"zero width", image.Rect(10, 10, 10, 100), true},
		// image.Rect canonicalizes its corners, so a truly inverted rect has to be built directly
		{"inverted corners", image.Rectangle{Min: image.Pt(100, 100), Max: image.Pt(50, 50)}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateRegion(c.region, bounds)
			if c.wantErr && err == nil {
				t.Fatalf("expected an error for %v", c.region)
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error for %v: %v", c.region, err)
			}
		})
	}
}

func TestIsBlackImage(t *testing.T) {
	if !isBlackImage(nil) {
		t.Fatal("a missing image should count as black")
	}
	black := image.NewRGBA(image.Rect(0, 0, 32, 32))
	if !isBlackImage(black) {
		t.Fatal("an all zero image should count as black")
	}
	// The grid samples every pixel of a small image, so one lit pixel flips the result
	lit := image.NewRGBA(image.Rect(0, 0, 32, 32))
	lit.Set(16, 16, image.White)
	if isBlackImage(lit) {
		t.Fatal("an image with a lit pixel should not count as black")
	}
	empty := image.NewRGBA(image.Rect(0, 0, 0, 0))
	if !isBlackImage(empty) {
		t.Fatal("an empty image should count as black")
	}
}
