//go:build !windows

package main

import (
	"errors"
	"image"
)

func copyImageToClipboard(_ *image.RGBA, _ []byte) error {
	return errors.New("copy to clipboard is not available on this platform yet")
}
