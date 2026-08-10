<#
  Generates apps/desktop/build/icon.ico — the interim Nexus app icon.

  Renders the four-pointed brand glyph (star-gold on vesper blue-black) as a
  filled polygon at each target resolution, then packs the resulting PNGs into
  a PNG-based .ico container (no glyph-as-text rendering, which is unreliable
  across fonts/DPI).

  Colours are NOT hardcoded from memory — they are the exact Noc (dark) theme
  values from packages/tokens/tokens/global.json + themes/noc.json:
    semantic.bg      -> color.night.900 -> #0c0e17
    semantic.accent  -> color.gold.400  -> #e5bf62
  If those token values ever change, re-run this script to regenerate the icon.

  This script is NOT invoked by any build step (dist.mjs, electron-builder).
  It is a one-off, reproducible generator — run it manually when the brand
  glyph or its colours change:

    powershell -File apps/desktop/build/make-icon.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

# --- Brand colours (see header comment for provenance) ----------------------
$BackgroundHex = "#0c0e17" # packages/tokens: color.night.900 (Noc semantic.bg)
$StarHex = "#e5bf62"       # packages/tokens: color.gold.400 (Noc semantic.accent)

function ConvertTo-DrawingColor([string]$Hex) {
    $h = $Hex.TrimStart("#")
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

$backgroundColor = ConvertTo-DrawingColor $BackgroundHex
$starColor = ConvertTo-DrawingColor $StarHex

# --- Four-pointed star geometry (✦ shape, drawn as a filled polygon) --------
# Eight points alternating outer tips / inner concave corners. The star fills
# ~70% of the canvas (outer radii ~0.30-0.36 of size) with a slight vertical
# elongation (top/bottom tips reach further than left/right), matching the ✦
# glyph's proportions. Inner radius controls arm sharpness.
function Get-StarPoints([double]$Size) {
    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $outerH = $Size * 0.30
    $outerV = $Size * 0.36
    $inner = $Size * 0.115

    return @(
        (New-Object System.Drawing.PointF($cx, ($cy - $outerV))),        # top tip
        (New-Object System.Drawing.PointF(($cx + $inner), ($cy - $inner))),
        (New-Object System.Drawing.PointF(($cx + $outerH), $cy)),        # right tip
        (New-Object System.Drawing.PointF(($cx + $inner), ($cy + $inner))),
        (New-Object System.Drawing.PointF($cx, ($cy + $outerV))),        # bottom tip
        (New-Object System.Drawing.PointF(($cx - $inner), ($cy + $inner))),
        (New-Object System.Drawing.PointF(($cx - $outerH), $cy)),        # left tip
        (New-Object System.Drawing.PointF(($cx - $inner), ($cy - $inner)))
    )
}

function New-StarPng([int]$Size, [string]$Path) {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear($backgroundColor)

        $brush = New-Object System.Drawing.SolidBrush($starColor)
        try {
            $graphics.FillPolygon($brush, (Get-StarPoints -Size $Size))
        }
        finally {
            $brush.Dispose()
        }

        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

# --- Render each resolution to a temp PNG, then pack a PNG-based .ico -------
$sizes = 16, 24, 32, 48, 64, 128, 256
$buildDir = $PSScriptRoot
$icoPath = Join-Path $buildDir "icon.ico"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-icon-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    $entries = @()
    $offset = 6 + (16 * $sizes.Count) # ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image

    foreach ($size in $sizes) {
        $pngPath = Join-Path $tempDir "icon-$size.png"
        New-StarPng -Size $size -Path $pngPath
        $bytes = [System.IO.File]::ReadAllBytes($pngPath)
        $entries += [PSCustomObject]@{ Size = $size; Bytes = $bytes; Offset = $offset }
        $offset += $bytes.Length
    }

    $stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
    $writer = New-Object System.IO.BinaryWriter($stream)
    try {
        # ICONDIR
        $writer.Write([UInt16]0)             # reserved, must be 0
        $writer.Write([UInt16]1)              # type: 1 = icon
        $writer.Write([UInt16]$entries.Count) # image count

        # ICONDIRENTRY[]
        foreach ($entry in $entries) {
            # width/height byte: 0 means 256 (a byte cannot hold 256)
            $dim = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
            $writer.Write([byte]$dim)
            $writer.Write([byte]$dim)
            $writer.Write([byte]0)                    # colour palette: none
            $writer.Write([byte]0)                    # reserved
            $writer.Write([UInt16]1)                  # colour planes
            $writer.Write([UInt16]32)                 # bits per pixel
            $writer.Write([UInt32]$entry.Bytes.Length) # payload size
            $writer.Write([UInt32]$entry.Offset)       # payload offset
        }

        # PNG payloads, in the same order as their directory entries
        foreach ($entry in $entries) {
            $writer.Write($entry.Bytes)
        }

        $writer.Flush()
    }
    finally {
        $writer.Close()
        $stream.Close()
    }

    Write-Host "Wrote $icoPath ($($entries.Count) sizes: $($sizes -join ', '))"

    # --- icon.png, for the Linux targets -----------------------------------
    # electron-builder wants a single PNG of at least 256x256 for AppImage and
    # for the .desktop entry's hicolor install; 512 is the size every desktop
    # environment downsamples from cleanly. Same geometry, same tokens — it is
    # generated here rather than exported by hand so the two icons cannot drift.
    $pngPath = Join-Path $buildDir "icon.png"
    New-StarPng -Size 512 -Path $pngPath
    Write-Host "Wrote $pngPath (512x512)"
}
finally {
    Remove-Item -Recurse -Force $tempDir
}
