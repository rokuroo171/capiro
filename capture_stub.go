//go:build !windows

package main

import "errors"

// Per display DPI queries and cursor position calls only exist on Windows in
// this slice, so the other platforms report scale 1 and stop at the two flows
// they cannot answer yet.
func screenUnderCursor(int) (int, error) {
	return 0, errors.New("the monitor under the cursor is not available on this platform yet")
}

func displayScaleAt(int, int) float64 {
	return 1
}

func (s *CaptureService) ListWindows() ([]WindowInfo, error) {
	return nil, errors.New("window capture is not available on this platform yet")
}

func (s *CaptureService) CaptureWindow(uintptr) (CaptureResult, error) {
	return CaptureResult{}, errors.New("window capture is not available on this platform yet")
}
