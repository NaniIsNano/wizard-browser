# Generates the branded NSIS installer icons from logo.png.
# Re-run after editing the logo if you want to refresh:
#   powershell -ExecutionPolicy Bypass -File .\build\make-installer-art.ps1
#
# Outputs (in this directory):
#   installer.ico     multi-size icon (16/24/32/48/64/128/256), full colour
#   uninstaller.ico   same sizes, slight dim overlay so it reads as the uninstaller
#
# Note: with electron-builder's `nsis.oneClick: true` (silent install), the
# wizard sidebar/header BMPs are never displayed, so we don't generate them.
# The brand lives in:
#   - the installer .exe icon (built here),
#   - the in-app splash (splash.html),
#   - the in-app "Applying update" overlay (browser.html).

Add-Type -AssemblyName System.Drawing

$root      = Split-Path -Parent $PSCommandPath
$repo      = Split-Path -Parent $root
$logoPath  = Join-Path $repo 'logo.png'

if (-not (Test-Path $logoPath)) {
    Write-Error "logo.png not found at $logoPath"
    exit 1
}

# Build a multi-resolution .ico from logo.png. We render at each standard
# size with high-quality downsampling, then concatenate into ICO format
# (embedded PNGs — what Windows uses for 256x256 entries).
function Make-Ico([System.Drawing.Image]$src, [string]$outPath, [bool]$dim) {
    $sizes = @(256, 128, 64, 48, 32, 24, 16)
    $images = @()
    foreach ($s in $sizes) {
        $b = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $gg = [System.Drawing.Graphics]::FromImage($b)
        $gg.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $gg.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $gg.Clear([System.Drawing.Color]::Transparent)
        $gg.DrawImage($src, 0, 0, $s, $s)
        if ($dim) {
            $overlay = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 40, 40, 40))
            $gg.FillRectangle($overlay, 0, 0, $s, $s)
            $overlay.Dispose()
        }
        $gg.Dispose()
        $images += ,$b
    }

    $pngStreams = @()
    foreach ($b in $images) {
        $ms = New-Object System.IO.MemoryStream
        $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngStreams += ,$ms.ToArray()
        $ms.Dispose()
    }

    $fs = [System.IO.File]::Open($outPath, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter $fs
    try {
        # ICONDIR
        $bw.Write([uint16]0)             # reserved
        $bw.Write([uint16]1)             # type = icon
        $bw.Write([uint16]$sizes.Count)  # count

        # ICONDIRENTRY headers (16 bytes each)
        $offset = 6 + ($sizes.Count * 16)
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $s = $sizes[$i]
            $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))   # width  (0 = 256)
            $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))   # height
            $bw.Write([byte]0)            # palette colours
            $bw.Write([byte]0)            # reserved
            $bw.Write([uint16]1)          # planes
            $bw.Write([uint16]32)         # bits per pixel
            $bw.Write([uint32]$pngStreams[$i].Length)
            $bw.Write([uint32]$offset)
            $offset += $pngStreams[$i].Length
        }

        foreach ($p in $pngStreams) { $bw.Write($p) }
    } finally {
        $bw.Dispose(); $fs.Dispose()
    }

    foreach ($b in $images) { $b.Dispose() }
}

$logo = [System.Drawing.Image]::FromFile($logoPath)
Make-Ico $logo (Join-Path $root 'installer.ico')   $false
Make-Ico $logo (Join-Path $root 'uninstaller.ico') $true
$logo.Dispose()

Write-Host "Generated:"
Get-ChildItem $root | Where-Object { $_.Name -match '^(installer|uninstaller)' } | ForEach-Object {
    Write-Host ("  " + $_.Name + " (" + [math]::Round($_.Length / 1KB, 1) + " KB)")
}
