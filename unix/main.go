package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"fyne.io/systray"
)

//go:embed assets/*
var assets embed.FS

const (
	appName      = "TGDrive-Easy"
	buildVersion = "1.2.0"
	port         = 4100
)

var (
	dataDir    string
	runtimeDir string
	nodeCmd    *exec.Cmd
	mountedNow bool
	userExit   atomic.Bool
)

func logf(format string, args ...any) {
	f, err := os.OpenFile(filepath.Join(dataDir, "tray.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, time.Now().Format("2006-01-02 15:04:05 ")+format+"\n", args...)
}

func xdgData() string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share")
}

func gunzipTo(data []byte, dst string) error {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer zr.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, zr)
	return err
}

// Распаковывает node.tar.gz (внутри bin/node) в runtime/node.
func extractNode(dst string) error {
	data, err := assets.ReadFile("assets/node.tar.gz")
	if err != nil {
		return err
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer zr.Close()
	tr := tar.NewReader(zr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if filepath.Base(hdr.Name) != "node" || hdr.Typeflag != tar.TypeReg {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		out, err := os.Create(dst)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return err
		}
		out.Close()
		return os.Chmod(dst, 0o755)
	}
	return fmt.Errorf("node binary not found in archive")
}

func extractApp() error {
	data, err := assets.ReadFile("assets/app.zip")
	if err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range zr.File {
		target := filepath.Join(runtimeDir, filepath.FromSlash(f.Name))
		if f.FileInfo().IsDir() {
			os.MkdirAll(target, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(target), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func prepare() error {
	dataDir = filepath.Join(xdgData(), "TGDrive-Easy", "data")
	runtimeDir = filepath.Join(xdgData(), "TGDrive-Easy", "runtime")
	os.MkdirAll(dataDir, 0o755)
	stamp := filepath.Join(runtimeDir, "version.txt")
	if b, err := os.ReadFile(stamp); err == nil && strings.TrimSpace(string(b)) == buildVersion {
		if _, err := os.Stat(filepath.Join(runtimeDir, "node")); err == nil {
			return nil
		}
	}
	logf("extracting runtime %s", buildVersion)
	os.MkdirAll(runtimeDir, 0o755)
	if err := extractNode(filepath.Join(runtimeDir, "node")); err != nil {
		return err
	}
	if err := extractApp(); err != nil {
		return err
	}
	return os.WriteFile(stamp, []byte(buildVersion), 0o644)
}

func startNode() error {
	exe, _ := os.Executable()
	cmd := exec.Command(filepath.Join(runtimeDir, "node"), filepath.Join(runtimeDir, "server.js"))
	cmd.Dir = runtimeDir
	cmd.Env = append(os.Environ(), "TD_DATA_DIR="+dataDir, "TD_APP_EXE="+exe)
	logFile, _ := os.Create(filepath.Join(dataDir, "app.log"))
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		return err
	}
	nodeCmd = cmd
	return nil
}

func waitForPort(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
		if err == nil {
			c.Close()
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

func control(method, path string) (map[string]any, error) {
	tok, err := os.ReadFile(filepath.Join(dataDir, "control.token"))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-td-control", strings.TrimSpace(string(tok)))
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func isMounted() bool {
	st, err := control("GET", "/api/app/status")
	if err != nil {
		return false
	}
	v, _ := st["mounted"].(bool)
	return v
}

func toggleDrive() bool {
	if isMounted() {
		control("POST", "/api/app/unmount")
	} else {
		control("POST", "/api/app/mount")
	}
	return isMounted()
}

func cleanup() {
	if nodeCmd != nil && nodeCmd.Process != nil {
		nodeCmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { nodeCmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			nodeCmd.Process.Kill()
		}
	}
}

func trayIcon() []byte {
	b, err := assets.ReadFile("assets/icon.png")
	if err != nil {
		return nil
	}
	return b
}

func onReady() {
	systray.SetIcon(trayIcon())
	systray.SetTooltip(appName + " — Saved Messages drive")

	mConsole := systray.AddMenuItem("Console", "Open the web console")
	mDrive := systray.AddMenuItemCheckbox("Drive", "Mount or unmount the drive", isMounted())
	systray.AddSeparator()
	mExit := systray.AddMenuItem("Exit", "Stop the server and unmount the drive")

	go func() {
		for {
			select {
			case <-mConsole.ClickedCh:
				openBrowser()
			case <-mDrive.ClickedCh:
				mountedNow = toggleDrive()
				if mountedNow {
					mDrive.Check()
				} else {
					mDrive.Uncheck()
				}
			case <-mExit.ClickedCh:
				userExit.Store(true)
				systray.Quit()
				return
			}
		}
	}()
}

func openBrowser() {
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	for _, opener := range [][]string{{"xdg-open", url}, {"open", url}} {
		if _, err := exec.LookPath(opener[0]); err == nil {
			exec.Command(opener[0], opener[1]).Start()
			return
		}
	}
	logf("no browser opener found for %s", url)
}

func main() {
	if err := prepare(); err != nil {
		fmt.Fprintf(os.Stderr, "prepare failed: %v\n", err)
		os.Exit(1)
	}
	if err := startNode(); err != nil {
		fmt.Fprintf(os.Stderr, "server start failed: %v\n", err)
		os.Exit(1)
	}
	if !waitForPort(90 * time.Second) {
		fmt.Fprintln(os.Stderr, "server did not start; see data/app.log")
		cleanup()
		os.Exit(1)
	}
	done := make(chan struct{})
	go func() {
		systray.Run(onReady, func() {})
		close(done)
	}()
	<-done

	// Панели/StatusNotifier может не быть (сервер, WSL, минимальный DE):
	// не падаем, а работаем без трея — открываем консоль и ждём сигнала.
	if !userExit.Load() {
		logf("tray unavailable, running headless")
		openBrowser()
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
	}
	cleanup()
}
