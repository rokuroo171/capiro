package main

import (
	"image"
	"image/color"
	"math"
)

// hardAntiAlias draws a circle centered at p on dst, blending color col over
// the existing pixels with coverage computed from the distance to the edge
func softCircle(dst *image.RGBA, p image.Point, radius float64, col color.RGBA, alpha float64) {
	minX := int(math.Floor(float64(p.X) - radius))
	maxX := int(math.Ceil(float64(p.X) + radius))
	minY := int(math.Floor(float64(p.Y) - radius))
	maxY := int(math.Ceil(float64(p.Y) + radius))
	b := dst.Bounds()
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			if !image.Pt(x, y).In(b) {
				continue
			}
			d := math.Hypot(float64(x-p.X), float64(y-p.Y))
			t := clamp01(radius - d + 0.5)
			if t <= 0 {
				continue
			}
			blendPixel(dst, x, y, col, t*alpha)
		}
	}
}

func blendPixel(dst *image.RGBA, x, y int, col color.RGBA, coverage float64) {
	i := dst.PixOffset(x, y)
	sb := float64(col.B) * coverage
	sr := float64(col.R) * coverage
	sg := float64(col.G) * coverage
	sa := float64(col.A) / 255 * coverage
	dr := float64(dst.Pix[i])
	dg := float64(dst.Pix[i+1])
	db := float64(dst.Pix[i+2])
	da := float64(dst.Pix[i+3]) / 255

	outA := sa + da*(1-sa)
	if outA <= 0 {
		return
	}
	dst.Pix[i] = uint8(((sr*sa + dr*da*(1-sa)) / outA) + 0.5)
	dst.Pix[i+1] = uint8(((sg*sa + dg*da*(1-sa)) / outA) + 0.5)
	dst.Pix[i+2] = uint8(((sb*sa + db*da*(1-sa)) / outA) + 0.5)
	dst.Pix[i+3] = uint8(outA*255 + 0.5)
}

func clamp01(t float64) float64 {
	if t < 0 {
		return 0
	}
	if t > 1 {
		return 1
	}
	return t
}

// drawThickLine renders a segment as a capsule: a thick line is the union of
// the distance field between the two endpoints and the two round caps
func drawThickLine(dst *image.RGBA, x1, y1, x2, y2 int, col color.RGBA, width, alpha float64) {
	r := width / 2
	ax, ay := float64(x1), float64(y1)
	bx, by := float64(x2), float64(y2)
	abx, aby := bx-ax, by-ay
	lenSq := abx*abx + aby*aby
	pad := int(math.Ceil(r + 1))
	minX := min(x1, x2) - pad
	maxX := max(x1, x2) + pad
	minY := min(y1, y2) - pad
	maxY := max(y1, y2) + pad
	b := dst.Bounds()
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			if !image.Pt(x, y).In(b) {
				continue
			}
			var t float64
			if lenSq == 0 {
				t = 0
			} else {
				t = ((float64(x)-ax)*abx + (float64(y)-ay)*aby) / lenSq
			}
			t = math.Min(1, math.Max(0, t))
			dx := float64(x) - (ax + t*abx)
			dy := float64(y) - (ay + t*aby)
			d := math.Hypot(dx, dy)
			cover := clamp01(r - d + 0.5)
			if cover > 0 {
				blendPixel(dst, x, y, col, cover*alpha)
			}
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// drawArrow draws the shaft plus an open arrowhead at the end point. The head
// size grows with stroke width so thin arrows still read as arrows
func drawArrow(dst *image.RGBA, a Annotation, col color.RGBA, width, alpha float64) {
	x1, y1, x2, y2 := a.Geometry.X1, a.Geometry.Y1, a.Geometry.X2, a.Geometry.Y2
	drawThickLine(dst, x1, y1, x2, y2, col, width, alpha)

	ang := math.Atan2(float64(y2-y1), float64(x2-x1))
	headLen := width*3 + 6
	headSpread := math.Pi / 7
	for _, side := range []float64{headSpread, -headSpread} {
		hx := float64(x2) - headLen*math.Cos(ang+side)
		hy := float64(y2) - headLen*math.Sin(ang+side)
		drawThickLine(dst, x2, y2, int(math.Round(hx)), int(math.Round(hy)), col, width, alpha)
	}
}

func drawFreehand(dst *image.RGBA, a Annotation, col color.RGBA, width, alpha float64) {
	pts := a.Geometry.Points
	if len(pts) < 2 {
		return
	}
	for i := 0; i < len(pts)-1; i++ {
		drawThickLine(dst, pts[i].X, pts[i].Y, pts[i+1].X, pts[i+1].Y, col, width, alpha)
	}
}

func drawRectOutline(dst *image.RGBA, a Annotation, col color.RGBA, width, alpha float64) {
	x, y, w, h := a.Geometry.X, a.Geometry.Y, a.Geometry.W, a.Geometry.H
	drawThickLine(dst, x, y, x+w, y, col, width, alpha)
	drawThickLine(dst, x+w, y, x+w, y+h, col, width, alpha)
	drawThickLine(dst, x+w, y+h, x, y+h, col, width, alpha)
	drawThickLine(dst, x, y+h, x, y, col, width, alpha)
}

func drawEllipseOutline(dst *image.RGBA, a Annotation, col color.RGBA, width, alpha float64) {
	cx := float64(a.Geometry.X) + float64(a.Geometry.W)/2
	cy := float64(a.Geometry.Y) + float64(a.Geometry.H)/2
	// Axis-aligned radii minus half the stroke keeps the stroke centered on the curve
	rx := (float64(a.Geometry.W) - width) / 2
	ry := (float64(a.Geometry.H) - width) / 2
	if rx <= 0 || ry <= 0 {
		return
	}
	thetaStep := 2 * math.Pi / 128
	prevX := cx + rx
	prevY := cy
	for i := 1; i <= 128; i++ {
		theta := float64(i) * thetaStep
		x := cx + rx*math.Cos(theta)
		y := cy + ry*math.Sin(theta)
		drawThickLine(dst, int(math.Round(prevX)), int(math.Round(prevY)), int(math.Round(x)), int(math.Round(y)), col, width, alpha)
		prevX, prevY = x, y
	}
}
