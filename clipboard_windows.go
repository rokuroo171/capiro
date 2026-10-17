package main

import (
	"encoding/binary"
	"fmt"
	"image"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfDIB        = 8
	gmemMoveable = 0x0002
)

var (
	clipboardUser32              = windows.NewLazySystemDLL("user32.dll")
	clipboardKernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procOpenClipboard            = clipboardUser32.NewProc("OpenClipboard")
	procEmptyClipboard           = clipboardUser32.NewProc("EmptyClipboard")
	procSetClipboardData         = clipboardUser32.NewProc("SetClipboardData")
	procCloseClipboard           = clipboardUser32.NewProc("CloseClipboard")
	procRegisterClipboardFormatW = clipboardUser32.NewProc("RegisterClipboardFormatW")
	procGlobalAlloc              = clipboardKernel32.NewProc("GlobalAlloc")
	procGlobalLock               = clipboardKernel32.NewProc("GlobalLock")
	procGlobalUnlock             = clipboardKernel32.NewProc("GlobalUnlock")
	procGlobalFree               = clipboardKernel32.NewProc("GlobalFree")
)

func copyImageToClipboard(img *image.RGBA, pngBytes []byte) error {
	if img == nil || len(pngBytes) == 0 {
		return fmt.Errorf("no image to copy")
	}
	var last error
	for attempt := 0; attempt < 8; attempt++ {
		if err := openClipboard(); err != nil {
			last = err
			time.Sleep(20 * time.Millisecond)
			continue
		}
		err := writeClipboard(img, pngBytes)
		procCloseClipboard.Call()
		return err
	}
	return fmt.Errorf("open clipboard: %w", last)
}

func openClipboard() error {
	ret, _, err := procOpenClipboard.Call(0)
	if ret == 0 {
		return err
	}
	return nil
}

func writeClipboard(img *image.RGBA, pngBytes []byte) error {
	if ret, _, err := procEmptyClipboard.Call(); ret == 0 {
		return fmt.Errorf("empty clipboard: %v", err)
	}
	pngFmt, err := pngClipboardFormat()
	if err != nil {
		return err
	}
	if err := setClipboardBytes(pngFmt, pngBytes); err != nil {
		return fmt.Errorf("clipboard png: %w", err)
	}
	dib, err := rgbaToDIB(img)
	if err != nil {
		return err
	}
	if err := setClipboardBytes(cfDIB, dib); err != nil {
		return fmt.Errorf("clipboard dib: %w", err)
	}
	return nil
}

func pngClipboardFormat() (uintptr, error) {
	name, err := windows.UTF16PtrFromString("PNG")
	if err != nil {
		return 0, err
	}
	ret, _, werr := procRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(name)))
	if ret == 0 {
		return 0, fmt.Errorf("register PNG clipboard format: %v", werr)
	}
	return ret, nil
}

func setClipboardBytes(format uintptr, data []byte) error {
	h, err := globalAllocCopy(data)
	if err != nil {
		return err
	}
	ret, _, werr := procSetClipboardData.Call(format, h)
	if ret == 0 {
		procGlobalFree.Call(h)
		return werr
	}
	return nil
}

func globalAllocCopy(data []byte) (uintptr, error) {
	h, _, err := procGlobalAlloc.Call(gmemMoveable, uintptr(len(data)))
	if h == 0 {
		return 0, fmt.Errorf("global alloc: %v", err)
	}
	ptr, _, err := procGlobalLock.Call(h)
	if ptr == 0 {
		procGlobalFree.Call(h)
		return 0, fmt.Errorf("global lock: %v", err)
	}
	dst := unsafe.Slice((*byte)(unsafe.Pointer(ptr)), len(data))
	copy(dst, data)
	procGlobalUnlock.Call(h)
	return h, nil
}

func rgbaToDIB(img *image.RGBA) ([]byte, error) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("empty image")
	}
	headerSize := 40
	buf := make([]byte, headerSize+w*h*4)
	binary.LittleEndian.PutUint32(buf[0:], uint32(headerSize))
	binary.LittleEndian.PutUint32(buf[4:], uint32(w))
	binary.LittleEndian.PutUint32(buf[8:], uint32(h))
	binary.LittleEndian.PutUint16(buf[12:], 1)
	binary.LittleEndian.PutUint16(buf[14:], 32)
	row := w * 4
	for y := 0; y < h; y++ {
		srcY := b.Min.Y + (h - 1 - y)
		dst := headerSize + y*row
		for x := 0; x < w; x++ {
			i := img.PixOffset(b.Min.X+x, srcY)
			buf[dst] = img.Pix[i+2]
			buf[dst+1] = img.Pix[i+1]
			buf[dst+2] = img.Pix[i]
			buf[dst+3] = img.Pix[i+3]
			dst += 4
		}
	}
	return buf, nil
}
