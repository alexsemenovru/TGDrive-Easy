package main

import (
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
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed assets/*
var assets embed.FS

const (
	appName      = "TGDrive-Easy"
	buildVersion = "1.2.6"
	port         = 4100
	driveLetter  = "Z:"

	wmApp       = 0x8000
	wmTrayMsg   = wmApp + 1
	wmLButtonDbl = 0x0203
	wmRButtonUp = 0x0205
	wmCommand   = 0x0111
	wmDestroy   = 0x0002
	wmClose     = 0x0010

	nimAdd    = 0x0000
	nimDelete = 0x0002
	nifMessage = 0x0001
	nifIcon    = 0x0002
	nifTip     = 0x0004

	mfString = 0x0000
	mfChecked = 0x0008
	mfSeparator = 0x0800
	tpmReturnCmd = 0x0100
	tpmRightButton = 0x0002

	idConsole = 1
	idExit    = 2
	idDisk    = 3
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procRegisterClassEx   = user32.NewProc("RegisterClassExW")
	procCreateWindowEx    = user32.NewProc("CreateWindowExW")
	procDefWindowProc     = user32.NewProc("DefWindowProcW")
	procGetMessage        = user32.NewProc("GetMessageW")
	procTranslateMessage  = user32.NewProc("TranslateMessage")
	procDispatchMessage   = user32.NewProc("DispatchMessageW")
	procPostQuitMessage   = user32.NewProc("PostQuitMessage")
	procDestroyWindow     = user32.NewProc("DestroyWindow")
	procLoadImage         = user32.NewProc("LoadImageW")
	procCreatePopupMenu   = user32.NewProc("CreatePopupMenu")
	procAppendMenu        = user32.NewProc("AppendMenuW")
	procTrackPopupMenu    = user32.NewProc("TrackPopupMenu")
	procDestroyMenu       = user32.NewProc("DestroyMenu")
	procGetCursorPos      = user32.NewProc("GetCursorPos")
	procGetUserLang       = kernel32.NewProc("GetUserDefaultUILanguage")
	procSetForeground     = user32.NewProc("SetForegroundWindow")
	procPostMessage       = user32.NewProc("PostMessageW")
	procShellNotifyIcon   = shell32.NewProc("Shell_NotifyIconW")
	procShellExecute      = shell32.NewProc("ShellExecuteW")
	procCreateMutex       = kernel32.NewProc("CreateMutexW")
	procGetModuleHandle   = kernel32.NewProc("GetModuleHandleW")
	procCreateEvent       = kernel32.NewProc("CreateEventW")
	procOpenEvent         = kernel32.NewProc("OpenEventW")
	procSetEvent          = kernel32.NewProc("SetEvent")
	procWaitForSingle     = kernel32.NewProc("WaitForSingleObject")
)

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         [16]byte
	hBalloonIcon     uintptr
}

type point struct{ x, y int32 }

type msgStruct struct {
	hWnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

var (
	mainHwnd   uintptr
	trayIcon   uintptr
	nodeCmd    *exec.Cmd
	dataDir    string
	runtimeDir string
	nid        notifyIconData
)

func utf16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func localAppData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local")
}

func roamingAppData() string {
	if v := os.Getenv("APPDATA"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Roaming")
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


// safeTarget защищает распаковку от Zip Slip: путь обязан остаться внутри base.
func safeTarget(base, name string) (string, error) {
	cleanBase := filepath.Clean(base)
	target := filepath.Join(cleanBase, filepath.FromSlash(name))
	if target != cleanBase && !strings.HasPrefix(target, cleanBase+string(os.PathSeparator)) {
		return "", fmt.Errorf("illegal file path (Zip Slip attempt): %s", target)
	}
	return target, nil
}

func extractRuntime() error {
	stamp := filepath.Join(runtimeDir, "version.txt")
	if b, err := os.ReadFile(stamp); err == nil && strings.TrimSpace(string(b)) == buildVersion {
		if _, err := os.Stat(filepath.Join(runtimeDir, "node.exe")); err == nil {
			return nil
		}
	}
	if err := os.MkdirAll(runtimeDir, 0o755); err != nil {
		return err
	}
	nodeGz, err := assets.ReadFile("assets/node.exe.gz")
	if err != nil {
		return err
	}
	if err := gunzipTo(nodeGz, filepath.Join(runtimeDir, "node.exe")); err != nil {
		return err
	}
	appZip, err := assets.ReadFile("assets/app.zip")
	if err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(appZip), int64(len(appZip)))
	if err != nil {
		return err
	}
	for _, f := range zr.File {
		target, err := safeTarget(runtimeDir, f.Name)
		if err != nil {
			return err
		}
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
	icon, err := assets.ReadFile("assets/icon.ico")
	if err == nil {
		os.WriteFile(filepath.Join(runtimeDir, "icon.ico"), icon, 0o644)
	}
	return os.WriteFile(stamp, []byte(buildVersion), 0o644)
}

// Перенос данных из прежней версии приложения, чтобы не входить заново.
func copyLegacyData() {
	if _, err := os.Stat(dataDir); err == nil {
		return
	}
	old := filepath.Join(roamingAppData(), "TeleDriveLocal", "data")
	if _, err := os.Stat(old); err != nil {
		return
	}
	copyTree(old, dataDir)
	logf("legacy data copied from %s", old)
}

func copyTree(src, dst string) {
	entries, err := os.ReadDir(src)
	if err != nil {
		return
	}
	os.MkdirAll(dst, 0o755)
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			copyTree(s, d)
			continue
		}
		if b, err := os.ReadFile(s); err == nil {
			os.WriteFile(d, b, 0o644)
		}
	}
}

func migrateData() {
	copyLegacyData()
	os.MkdirAll(dataDir, 0o755)
	envPath := filepath.Join(dataDir, ".env")
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		oldEnv := `C:\teledrive-mine\.env`
		if b, err := os.ReadFile(oldEnv); err == nil {
			os.WriteFile(envPath, b, 0o644)
		} else {
			os.WriteFile(envPath, []byte(strings.Join([]string{
				"PORT=4100",
				"SOCKS_IP=127.0.0.1",
				"SOCKS_PORT=10808",
				"DAV_USER=teledrive",
				"DAV_PASS=teledrive",
				"MOUNT_MODE=webdav",
			}, "\r\n")+"\r\n"), 0o644)
		}
	}
	// copy the session and indexes from the previous installation
	old := `C:\teledrive-mine\data`
	for _, name := range []string{"session.txt", "index.json", "tree.json"} {
		src := filepath.Join(old, name)
		dst := filepath.Join(dataDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		if b, err := os.ReadFile(src); err == nil {
			os.WriteFile(dst, b, 0o644)
		}
	}
}

func startNode() error {
	nodeExe := filepath.Join(runtimeDir, "node.exe")
	serverJs := filepath.Join(runtimeDir, "server.js")
	if _, err := os.Stat(nodeExe); err != nil {
		return fmt.Errorf("node.exe not found: %w", err)
	}
	logFile, _ := os.Create(filepath.Join(dataDir, "app.log"))
	exePath, _ := os.Executable()
	cmd := exec.Command(nodeExe, serverJs)
	cmd.Dir = runtimeDir
	cmd.Env = append(os.Environ(), "TD_DATA_DIR="+dataDir, "TD_APP_EXE="+exePath, "TD_APP_VERSION="+buildVersion)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if err := cmd.Start(); err != nil {
		return err
	}
	nodeCmd = cmd
	go func() {
		cmd.Wait()
		if mainHwnd != 0 {
			procPostMessage.Call(mainHwnd, wmClose, 0, 0)
		}
	}()
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
		time.Sleep(400 * time.Millisecond)
	}
	return false
}

func runHidden(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	cmd.Run()
}

func openConsole() {
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	procShellExecute.Call(0, uintptr(unsafe.Pointer(utf16("open"))), uintptr(unsafe.Pointer(utf16(url))), 0, 0, 1)
}

func removeTray() {
	if trayIcon != 0 {
		nid.cbSize = uint32(unsafe.Sizeof(nid))
		procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
		trayIcon = 0
	}
}

func cleanup() {
	removeTray()
	if nodeCmd != nil && nodeCmd.Process != nil {
		nodeCmd.Process.Kill()
	}
	runHidden("net.exe", "use", driveLetter, "/delete", "/y")
}

	// request to the local server on behalf of the tray
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
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
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
		logf("status request failed: %v", err)
		return false
	}
	v, _ := st["mounted"].(bool)
	return v
}

func isRussianOS() bool {
	id, _, _ := procGetUserLang.Call()
	return uint32(id)&0x3FF == 0x19
}

func currentLanguage() string {
	if data, err := os.ReadFile(filepath.Join(dataDir, "settings.json")); err == nil {
		var cfg struct {
			Language string `json:"language"`
		}
		if json.Unmarshal(data, &cfg) == nil {
			if cfg.Language == "ru" || cfg.Language == "en" {
				return cfg.Language
			}
		}
	}
	if isRussianOS() {
		return "ru"
	}
	return "en"
}

func trayText(lang, key string) string {
	ru := map[string]string{
		"console": "\u041a\u043e\u043d\u0441\u043e\u043b\u044c",
		"drive":   "\u0414\u0438\u0441\u043a",
		"exit":    "\u0412\u044b\u0445\u043e\u0434",
		"tip":     "TGDrive-Easy \u2014 \u043c\u0435\u043d\u044e \u043f\u043e \u043f\u0440\u0430\u0432\u043e\u043c\u0443 \u043a\u043b\u0438\u043a\u0443",
	}
	en := map[string]string{
		"console": "Console",
		"drive":   "Drive",
		"exit":    "Exit",
		"tip":     "TGDrive-Easy - right click for menu",
	}
	if lang == "ru" {
		return ru[key]
	}
	return en[key]
}

func showMenu(hwnd uintptr) {
	mounted := isMounted()
	lang := currentLanguage()

	hMenu, _, _ := procCreatePopupMenu.Call()
	procAppendMenu.Call(hMenu, mfString, idConsole, uintptr(unsafe.Pointer(utf16(trayText(lang, "console")))))

	diskFlags := uintptr(mfString)
	if mounted {
		diskFlags |= mfChecked
	}
	procAppendMenu.Call(hMenu, diskFlags, idDisk, uintptr(unsafe.Pointer(utf16(trayText(lang, "drive")))))

	procAppendMenu.Call(hMenu, mfSeparator, 0, 0)
	procAppendMenu.Call(hMenu, mfString, idExit, uintptr(unsafe.Pointer(utf16(trayText(lang, "exit")))))

	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForeground.Call(hwnd)
	id, _, _ := procTrackPopupMenu.Call(hMenu, tpmReturnCmd|tpmRightButton,
		uintptr(pt.x), uintptr(pt.y), 0, hwnd, 0)
	procDestroyMenu.Call(hMenu)

	switch id {
	case idConsole:
		openConsole()
	case idDisk:
		if mounted {
			control("POST", "/api/app/unmount")
			logf("drive unmounted from tray")
		} else {
			control("POST", "/api/app/mount")
			logf("drive mounted from tray")
		}
	case idExit:
		procDestroyWindow.Call(hwnd)
	}
}

func wndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	if msg == wmClose || msg == wmDestroy {
		logf("wndproc msg=0x%x", msg)
	}
	switch msg {
	case wmTrayMsg:
		switch lParam {
		case wmRButtonUp:
			showMenu(hwnd)
		case wmLButtonDbl:
			openConsole()
		}
		return 0
	case wmCommand:
		switch wParam & 0xffff {
		case idConsole:
			openConsole()
		case idExit:
			procDestroyWindow.Call(hwnd)
		}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		cleanup()
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return r
}

func addTray(hwnd uintptr) {
	iconPath, _ := syscall.UTF16PtrFromString(filepath.Join(runtimeDir, "icon.ico"))
	hIcon, _, _ := procLoadImage.Call(0, uintptr(unsafe.Pointer(iconPath)), 1, 0, 0, 0x50)
	if hIcon == 0 {
		hIcon, _, _ = procLoadImage.Call(0, 32512, 1, 0, 0, 0x8000)
	}

	nid = notifyIconData{}
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = hwnd
	nid.uID = 1
	nid.uFlags = nifMessage | nifIcon | nifTip
	nid.uCallbackMessage = wmTrayMsg
	nid.hIcon = hIcon
	tip, _ := syscall.UTF16FromString(trayText(currentLanguage(), "tip"))
	copy(nid.szTip[:], tip)

	r, _, _ := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	if r != 0 {
		trayIcon = hIcon
	}
}

func main() {
	// the window and the message loop must live on one OS thread
	runtime.LockOSThread()

	// second instance: just open the console
	hMutex, _, mutexErr := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(utf16("Global\\TGDriveEasyTray"))))
	if hMutex != 0 {
		if errno, ok := mutexErr.(syscall.Errno); ok && errno == syscall.ERROR_ALREADY_EXISTS {
			if len(os.Args) > 1 && os.Args[1] == "--exit" {
				ev, _, _ := procOpenEvent.Call(0x0002, 0, uintptr(unsafe.Pointer(utf16("Local\\TGDriveEasyExit"))))
				if ev != 0 {
					procSetEvent.Call(ev)
				}
				return
			}
			openConsole()
			return
		}
	}

	runtimeDir = filepath.Join(localAppData(), "TGDrive-Easy", "runtime")
	dataDir = filepath.Join(roamingAppData(), "TGDrive-Easy", "data")

	if err := extractRuntime(); err != nil {
		msgBox("Could not unpack the application files: " + err.Error())
		return
	}
	migrateData()

	if err := startNode(); err != nil {
		msgBox("Could not start the server: " + err.Error())
		return
	}
	if !waitForPort(90 * time.Second) {
		msgBox("The server did not start within 90 seconds. See the log: " + filepath.Join(dataDir, "app.log"))
		cleanup()
		return
	}

	mod, _, _ := procGetModuleHandle.Call(0)
	wc := wndClassEx{
		cbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		style:         0x0008, // CS_DBLCLKS
		lpfnWndProc:   syscall.NewCallback(wndProc),
		hInstance:     mod,
		lpszClassName: utf16("TeleDriveTrayWnd"),
	}
	atom, _, regErr := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	hwnd, _, createErr := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(utf16("TeleDriveTrayWnd"))),
		uintptr(unsafe.Pointer(utf16(appName))), 0, 0, 0, 0, 0, 0, 0, mod, 0)
	logf("register class: atom=%d err=%v ; create window: hwnd=%d err=%v", atom, regErr, hwnd, createErr)
	mainHwnd = hwnd
	if hwnd == 0 {
		msgBox("Could not create the application window. See the log: " + filepath.Join(dataDir, "tray.log"))
		cleanup()
		return
	}
	addTray(hwnd)

	exitEvent, _, evErr := procCreateEvent.Call(0, 0, 0, uintptr(unsafe.Pointer(utf16("Local\\TGDriveEasyExit"))))
	logf("exit event: handle=%d err=%v", exitEvent, evErr)
	if exitEvent != 0 {
		go func() {
			procWaitForSingle.Call(exitEvent, 0xFFFFFFFF)
			logf("exit event signalled")
			if mainHwnd != 0 {
				procPostMessage.Call(mainHwnd, wmClose, 0, 0)
			}
		}()
	}

	var m msgStruct
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) == -1 || r == 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
	cleanup()
}

func logf(format string, args ...any) {
	f, err := os.OpenFile(filepath.Join(dataDir, "tray.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, time.Now().Format("2006-01-02 15:04:05 ")+format+"\n", args...)
}

func msgBox(text string) {	procMessageBox := user32.NewProc("MessageBoxW")
	procMessageBox.Call(0, uintptr(unsafe.Pointer(utf16(text))),
		uintptr(unsafe.Pointer(utf16(appName))), 0x40)
}


