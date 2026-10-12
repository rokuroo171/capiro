package main

import (
	"embed"

	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	captureService := &CaptureService{}
	exportService := &ExportService{}
	app := application.New(application.Options{
		Name:        "Capiro",
		Description: "Capture, annotate, and export polished showcase assets",
		Services: []application.Service{
			application.NewService(captureService),
			application.NewService(exportService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Capiro",
		// Window sized to the golden ratio (1000 / 618 ≈ 1.618).
		Width:  1000,
		Height: 618,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(6, 7, 15),
		URL:              "/",
	})

	captureService.attach(app)
	exportService.attach(app)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
