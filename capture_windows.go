package main

import (
	"errors"
	"fmt"
	"image"
	"time"
	"unsafe"

	"github.com/kbinani/screenshot"
	"golang.org/x/sys/windows"
)

// The x/sys windows package covers enumeration and DWM but not the GDI calls
// window capture needs, so those resolve straight from the system DLLs.
var (
	user32                     = windows.NewLazySystemDLL("user32.dll")
	gdi32                      = windows.NewLazySystemDLL("gdi32.dll")
	shcore                     = windows.NewLazySystemDLL("shcore.dll")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procMonitorFromPoint       = user32.NewProc("MonitorFromPoint")
	procGetDpiForMonitor       = shcore.NewProc("GetDpiForMonitor")
	procGetWindowTextW         = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW   = user32.NewProc("GetWindowTextLengthW")
	procGetWindowRect          = user32.NewProc("GetWindowRect")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procPrintWindow            = user32.NewProc("PrintWindow")
	procGetDC                  = user32.NewProc("GetDC")
	procReleaseDC              = user32.NewProc("ReleaseDC")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
)

const (
	monitorDefaultToNearest = 2
	mdtEffectiveDPI         = 0
	dwmwaCloaked            = 14
	// renders windows that draw through DirectComposition, which plain PrintWindow misses
	pwRenderFullContent = 2
)

type winRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

func (r winRect) toImage() image.Rectangle {
	return image.Rect(int(r.Left), int(r.Top), int(r.Right), int(r.Bottom))
}

type point struct {
	X int32
	Y int32
}

func screenUnderCursor(n int) (int, error) {
	var p point
	if ret, _, err := procGetCursorPos.Call(uintptr(unsafe.Pointer(&p))); ret == 0 {
		return 0, fmt.Errorf("cursor position unavailable: %v", err)
	}
	for i := 0; i < n; i++ {
		if image.Pt(int(p.X), int(p.Y)).In(screenshot.GetDisplayBounds(i)) {
			return i, nil
		}
	}
	return 0, errors.New("the cursor is not on any screen")
}

func displayScaleAt(x, y int) float64 {
	pt := point{X: int32(x), Y: int32(y)}
	hmon, _, _ := procMonitorFromPoint.Call(uintptr(unsafe.Pointer(&pt)), monitorDefaultToNearest)
	if hmon == 0 {
		return 1
	}
	var dpiX, dpiY uint32
	ret, _, _ := procGetDpiForMonitor.Call(hmon, mdtEffectiveDPI, uintptr(unsafe.Pointer(&dpiX)), uintptr(unsafe.Pointer(&dpiY)))
	if ret != 0 || dpiX == 0 {
		return 1
	}
	return float64(dpiX) / 96
}

func (s *CaptureService) ListWindows() ([]WindowInfo, error) {
	var found []WindowInfo
	cb := windows.NewCallback(func(hwnd windows.HWND, _ uintptr) uintptr {
		if !windows.IsWindowVisible(hwnd) || isCloaked(hwnd) {
			return 1
		}
		title := windowTitle(hwnd)
		if title == "" {
			return 1
		}
		r, err := windowRect(hwnd)
		if err != nil || r.Empty() {
			return 1
		}
		found = append(found, WindowInfo{
			Hwnd:  uintptr(hwnd),
			Title: title,
			X:     r.Min.X,
			Y:     r.Min.Y,
			W:     r.Dx(),
			H:     r.Dy(),
		})
		return 1
	})
	if err := windows.EnumWindows(cb, nil); err != nil {
		return nil, fmt.Errorf("enumerate windows: %w", err)
	}
	return found, nil
}

func (s *CaptureService) CaptureWindow(hwnd uintptr) (CaptureResult, error) {
	if hwnd == 0 {
		return CaptureResult{}, errors.New("no window selected")
	}
	r, err := windowRect(windows.HWND(hwnd))
	if err != nil {
		return CaptureResult{}, err
	}
	img, err := printWindowImage(windows.HWND(hwnd), r)
	if err != nil || isBlackImage(img) {
		// Hardware accelerated windows often print black. Bringing the window
		// forward and grabbing the screen region is the reliable fallback.
		procSetForegroundWindow.Call(hwnd)
		time.Sleep(150 * time.Millisecond)
		img, err = screenshot.Capture(r.Min.X, r.Min.Y, r.Dx(), r.Dy())
		if err != nil {
			return CaptureResult{}, fmt.Errorf("capture window: %w", err)
		}
		if isBlackImage(img) {
			return CaptureResult{}, errors.New("this window cannot be captured, use region capture")
		}
	}
	screenIndex := screenContaining(r)
	scale := 1.0
	if screenIndex >= 0 {
		b := screenshot.GetDisplayBounds(screenIndex)
		scale = displayScaleAt(b.Min.X, b.Min.Y)
	}
	return buildResult(img, "window", screenIndex, scale)
}

func screenContaining(r image.Rectangle) int {
	center := image.Pt(r.Min.X+r.Dx()/2, r.Min.Y+r.Dy()/2)
	for i := 0; i < screenshot.NumActiveDisplays(); i++ {
		if center.In(screenshot.GetDisplayBounds(i)) {
			return i
		}
	}
	return -1
}

func isCloaked(hwnd windows.HWND) bool {
	var cloaked uint32
	err := windows.DwmGetWindowAttribute(hwnd, dwmwaCloaked, unsafe.Pointer(&cloaked), uint32(unsafe.Sizeof(cloaked)))
	return err == nil && cloaked != 0
}

func windowTitle(hwnd windows.HWND) string {
	length, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	n, _, _ := procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), length+1)
	return windows.UTF16ToString(buf[:n])
}

func windowRect(hwnd windows.HWND) (image.Rectangle, error) {
	var r winRect
	ret, _, err := procGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return image.Rectangle{}, fmt.Errorf("window bounds unavailable: %v", err)
	}
	return r.toImage(), nil
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

func printWindowImage(hwnd windows.HWND, r image.Rectangle) (*image.RGBA, error) {
	w, h := int32(r.Dx()), int32(r.Dy())
	screenDC, _, _ := procGetDC.Call(0)
	defer procReleaseDC.Call(0, screenDC)
	memDC, _, _ := procCreateCompatibleDC.Call(screenDC)
	bmp, _, _ := procCreateCompatibleBitmap.Call(screenDC, uintptr(w), uintptr(h))
	prev, _, _ := procSelectObject.Call(memDC, bmp)
	defer func() {
		procSelectObject.Call(memDC, prev)
		procDeleteObject.Call(bmp)
		procDeleteDC.Call(memDC)
	}()
	ret, _, err := procPrintWindow.Call(uintptr(hwnd), memDC, pwRenderFullContent)
	if ret == 0 {
		return nil, fmt.Errorf("print window failed: %v", err)
	}
	return dibToRGBA(screenDC, bmp, w, h)
}

func dibToRGBA(screenDC, bmp uintptr, w, h int32) (*image.RGBA, error) {
	var bi bitmapInfoHeader
	bi.Size = uint32(unsafe.Sizeof(bi))
	bi.Width = w
	// Negative height requests a top-down rows order, which matches image.RGBA
	bi.Height = -h
	bi.Planes = 1
	bi.BitCount = 32
	pixels := make([]uint32, int(w)*int(h))
	ret, _, err := procGetDIBits.Call(
		uintptr(screenDC),
		uintptr(bmp),
		0,
		uintptr(h),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&bi)),
		0,
	)
	if ret == 0 {
		return nil, fmt.Errorf("read window bits failed: %v", err)
	}
	img := image.NewRGBA(image.Rect(0, 0, int(w), int(h)))
	for y := 0; y < int(h); y++ {
		row := y * int(w)
		for x := 0; x < int(w); x++ {
			p := pixels[row+x]
			i := img.PixOffset(x, y)
			img.Pix[i] = byte(p)
			img.Pix[i+1] = byte(p >> 8)
			img.Pix[i+2] = byte(p >> 16)
			img.Pix[i+3] = 255
		}
	}
	return img, nil
}

// isBlackImage samples a coarse grid, which is enough to spot the fully black
// frames PrintWindow produces for hardware accelerated windows.
func isBlackImage(img *image.RGBA) bool {
	if img == nil {
		return true
	}
	b := img.Bounds()
	if b.Empty() {
		return true
	}
	stepX := max(1, b.Dx()/64)
	stepY := max(1, b.Dy()/64)
	for y := b.Min.Y; y < b.Max.Y; y += stepY {
		for x := b.Min.X; x < b.Max.X; x += stepX {
			i := img.PixOffset(x, y)
			if img.Pix[i]|img.Pix[i+1]|img.Pix[i+2] != 0 {
				return false
			}
		}
	}
	return true
}
