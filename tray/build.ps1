# Build TeleDrive Local single EXE.
$ErrorActionPreference = 'Stop'
$Root  = 'C:\teledrive-tray'
$Src   = 'C:\teledrive-mine'
$NodeDir = 'C:\teledrive-stack\node18\node-v18.16.0-win-x64'
$GoExe = 'C:\Program Files\Go\bin\go.exe'
if (-not (Test-Path $GoExe)) { $GoExe = 'go' }

$Assets = Join-Path $Root 'assets'
$Stage  = Join-Path $Root 'stage'
New-Item -ItemType Directory -Force -Path $Assets | Out-Null

Write-Host '1/5 icon'
Push-Location $Root
python make_icon.py
Pop-Location

Write-Host '2/5 staging app files'
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $Src 'server.js') $Stage
Copy-Item (Join-Path $Src 'package.json') $Stage
Copy-Item (Join-Path $Src 'public') $Stage -Recurse
Copy-Item (Join-Path $Src 'node_modules') $Stage -Recurse
Copy-Item (Join-Path $Src 'dav.js') $Stage
Copy-Item (Join-Path $Src 'store.js') $Stage

Write-Host '3/5 app.zip'
$zip = Join-Path $Assets 'app.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($Stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '4/5 node.exe.gz'
$nodeGz = Join-Path $Assets 'node.exe.gz'
if (Test-Path $nodeGz) { Remove-Item $nodeGz -Force }
$in = [System.IO.File]::OpenRead((Join-Path $NodeDir 'node.exe'))
$out = [System.IO.File]::Create($nodeGz)
$gz = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Optimal)
$in.CopyTo($gz)
$gz.Close(); $out.Close(); $in.Close()

Write-Host '4b/5 icon resource'
$rsrc = Join-Path $env:USERPROFILE 'go\bin\rsrc.exe'
if (Test-Path $rsrc) { & $rsrc -ico (Join-Path $Assets 'icon.ico') -o (Join-Path $Root 'rsrc.syso') }

Write-Host '5/5 go build'
Push-Location $Root
$ErrorActionPreference = 'Continue'
& $GoExe mod init teledrive-tray 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
$env:CGO_ENABLED = '0'
$ErrorActionPreference = 'Continue'
& $GoExe build -trimpath -ldflags "-H windowsgui -s -w" -o (Join-Path $Root 'TeleDrive Local.exe') . 2>&1 | Out-Host
$buildCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($buildCode -ne 0) { throw "go build failed: $buildCode" }
if ($LASTEXITCODE -ne 0) { throw "go build failed: $LASTEXITCODE" }
Pop-Location

$exe = Join-Path $Root 'TeleDrive Local.exe'
Write-Host ("EXE: {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))



