#requires -Version 5.1
# РЎРѕР±РёСЂР°РµС‚ РµРґРёРЅС‹Р№ EXE: Go-Р»Р°СѓРЅС‡РµСЂ + СЃР¶Р°С‚С‹Р№ Node.js + СЃРµСЂРІРµСЂ.
# РўСЂРµР±СѓРµС‚СЃСЏ: Go 1.21+, Node.js 18+ (РґР»СЏ СѓРїР°РєРѕРІРєРё), Python + Pillow (РёРєРѕРЅРєР°).
param(
  [string]$NodeExe = ''   # РїСѓС‚СЊ Рє node.exe, РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ Р±РµСЂС‘С‚СЃСЏ РёР· PATH
)

$ErrorActionPreference = 'Stop'
$Root   = $PSScriptRoot
$AppSrc = Join-Path (Split-Path $Root -Parent) 'app'
$Assets = Join-Path $Root 'assets'
$Stage  = Join-Path $Root 'stage'

if (-not $NodeExe) {
  $NodeExe = (Get-Command node -ErrorAction Stop).Source
}
New-Item -ItemType Directory -Force -Path $Assets | Out-Null

Write-Host '1/5 icon'
Push-Location $Root
python make_icon.py
Pop-Location

Write-Host '2/5 staging app files'
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $AppSrc 'server.js'), (Join-Path $AppSrc 'dav.js'),
          (Join-Path $AppSrc 'store.js'), (Join-Path $AppSrc 'session.js'), (Join-Path $AppSrc 'package.json') $Stage
Copy-Item (Join-Path $AppSrc 'platform') $Stage -Recurse
Copy-Item (Join-Path $AppSrc 'public') $Stage -Recurse
Push-Location $AppSrc
npm install --omit=dev --no-audit --no-fund | Out-Host
Pop-Location
Copy-Item (Join-Path $AppSrc 'node_modules') $Stage -Recurse

Write-Host '3/5 app.zip'
$zip = Join-Path $Assets 'app.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($Stage, $zip,
  [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '4/5 node.exe.gz'
$nodeGz = Join-Path $Assets 'node.exe.gz'
if (Test-Path $nodeGz) { Remove-Item $nodeGz -Force }
$in  = [System.IO.File]::OpenRead($NodeExe)
$out = [System.IO.File]::Create($nodeGz)
$gz  = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Optimal)
$in.CopyTo($gz)
$gz.Close(); $out.Close(); $in.Close()

Write-Host '4b/5 icon resource'
$rsrc = Get-Command rsrc -ErrorAction SilentlyContinue
if ($rsrc) {
  & $rsrc.Source -ico (Join-Path $Assets 'icon.ico') -o (Join-Path $Root 'rsrc.syso')
} else {
  Write-Host 'rsrc not found - EXE will use the default icon (go install github.com/akavel/rsrc@latest)'
}

Write-Host '5/5 go build'
Push-Location $Root
$ErrorActionPreference = 'Continue'
& go build -trimpath -ldflags '-H windowsgui -s -w' -o (Join-Path $Root 'TGDrive-Easy.exe') .
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($code -ne 0) { throw "go build failed: $code" }

$exe = Join-Path $Root 'TGDrive-Easy.exe'
Write-Host ("EXE: {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))

