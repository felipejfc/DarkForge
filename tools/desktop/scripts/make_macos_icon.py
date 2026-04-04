#!/usr/bin/env python3
"""Generate a macOS-style .icns from a square source PNG.

Applies Apple's macOS Big Sur+ icon template:
  - 1024x1024 canvas
  - 824x824 squircle content area, centered (100px margin)
  - ~185px corner radius (continuous-ish rounded rectangle)

Then emits all iconset sizes and invokes iconutil to produce icon.icns.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ICONS_DIR = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
SOURCE = ICONS_DIR / "ios" / "AppIcon-512@2x.png"  # 1024x1024 source
ICONSET = ICONS_DIR / "icon.iconset"
ICNS_OUT = ICONS_DIR / "icon.icns"

# macOS Big Sur+ template measurements (relative to 1024 canvas)
CANVAS = 1024
CONTENT = 824          # squircle inner square size
MARGIN = (CANVAS - CONTENT) // 2  # 100 px
CORNER_RADIUS = 185    # squircle corner radius


def rounded_mask(size: int, radius: int) -> Image.Image:
    """Create an antialiased rounded-rectangle alpha mask at given size."""
    # Render at 4x then downscale for clean edges
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(big)
    draw.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return big.resize((size, size), Image.LANCZOS)


def build_1024(src: Path) -> Image.Image:
    """Return a 1024x1024 RGBA image following the macOS template."""
    art = Image.open(src).convert("RGBA")
    # Fit artwork into the 824x824 content area.
    art = art.resize((CONTENT, CONTENT), Image.LANCZOS)

    # Squircle mask sized to the content area
    mask = rounded_mask(CONTENT, CORNER_RADIUS)

    # Apply mask to artwork
    masked = Image.new("RGBA", (CONTENT, CONTENT), (0, 0, 0, 0))
    masked.paste(art, (0, 0), mask)

    # Place on transparent 1024 canvas with standard margin
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(masked, (MARGIN, MARGIN), masked)
    return canvas


def main() -> int:
    if not SOURCE.exists():
        print(f"source not found: {SOURCE}", file=sys.stderr)
        return 1

    print(f"source: {SOURCE}")
    master = build_1024(SOURCE)

    # Save a debug preview alongside the icons
    preview = ICONS_DIR / "icon_macos_1024.png"
    master.save(preview)
    print(f"wrote {preview}")

    # Build iconset
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)

    # (size, @scale, filename)
    targets = [
        (16, 1, "icon_16x16.png"),
        (16, 2, "icon_16x16@2x.png"),
        (32, 1, "icon_32x32.png"),
        (32, 2, "icon_32x32@2x.png"),
        (128, 1, "icon_128x128.png"),
        (128, 2, "icon_128x128@2x.png"),
        (256, 1, "icon_256x256.png"),
        (256, 2, "icon_256x256@2x.png"),
        (512, 1, "icon_512x512.png"),
        (512, 2, "icon_512x512@2x.png"),
    ]
    for base, scale, name in targets:
        px = base * scale
        img = master.resize((px, px), Image.LANCZOS)
        img.save(ICONSET / name)
        print(f"  {name} ({px}x{px})")

    # Build .icns
    subprocess.run(
        ["iconutil", "--convert", "icns", str(ICONSET), "--output", str(ICNS_OUT)],
        check=True,
    )
    print(f"wrote {ICNS_OUT}")

    # Clean up iconset dir (keep the tree tidy)
    shutil.rmtree(ICONSET)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
