#!/usr/bin/env python3
"""Generate the PWA / home-screen icons in public/icons from one source artwork.

Run with: npm run icons:generate  (requires python3 with Pillow installed)

Why this exists: the original artwork drew its own rounded tile on a near-white
background. iOS masks home-screen icons a second time, so that baked-in shape
showed up as a white frame around a shrunken icon. Every icon emitted here is a
full-bleed opaque square with no rounded corners - the platform supplies the
mask.

Outputs:
  icon-192.png            manifest icon (any purpose)
  icon-512.png            manifest icon (any purpose)
  apple-touch-icon.png    referenced from index.html, used by iOS
  icon-maskable-512.png   manifest icon (maskable), artwork inside the safe zone
"""
from pathlib import Path

from PIL import Image, ImageFilter

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPOSITORY_ROOT / 'scripts/assets/app-icon-source.png'
OUT_DIR = REPOSITORY_ROOT / 'public/icons'

CANVAS = 512  # native artwork resolution; a larger canvas would only upscale
GRADIENT_START = (20, 130, 117)   # top-left, sampled from the source artwork
GRADIENT_END = (46, 198, 147)     # bottom-right
PAW_COLOR = (70, 70, 70)
SOLID_BRAND = (22, 101, 84)       # theme_color #166554, used as maskable bleed
STANDARD_PAW_RATIO = 0.58         # paw artwork width relative to the canvas
MASKABLE_PAW_RATIO = 0.50         # keeps artwork inside the 80% safe zone
PAW_REGION = (140, 115, 390, 395)  # interior crop that excludes the old tile edge

Size = tuple[int, int, int]


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def paw_mask(source: Image.Image) -> Image.Image:
    """Soft alpha mask of the neutral-gray paw prints, trimmed to their bounds.

    Greenness separates the paws from the tile, darkness separates them from the
    old off-white background; the product keeps anti-aliased edges intact.
    """
    region = source.convert('RGB').crop(PAW_REGION)
    mask = Image.new('L', region.size, 0)
    pixels = mask.load()
    for y in range(region.size[1]):
        for x in range(region.size[0]):
            r, g, b = region.getpixel((x, y))
            neutral = clamp01((100 - (g - r)) / 50)
            dark = clamp01((190 - max(r, g, b)) / 40)
            pixels[x, y] = round(255 * neutral * dark)
    return mask.crop(mask.getbbox())


def diagonal_gradient(size: int, start: Size, end: Size) -> Image.Image:
    """Full-bleed top-left to bottom-right linear gradient."""
    gradient = Image.new('RGB', (size, size))
    pixels = gradient.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(s + (e - s) * t) for s, e in zip(start, end))
    return gradient


def compose(mask: Image.Image, background: Image.Image, paw_ratio: float) -> Image.Image:
    target_width = round(CANVAS * paw_ratio)
    target_height = round(mask.size[1] * target_width / mask.size[0])
    scaled = mask.resize((target_width, target_height), Image.LANCZOS)
    canvas_mask = Image.new('L', (CANVAS, CANVAS), 0)
    canvas_mask.paste(scaled, ((CANVAS - target_width) // 2, (CANVAS - target_height) // 2))
    icon = background.copy()
    icon.paste(Image.new('RGB', (CANVAS, CANVAS), PAW_COLOR), (0, 0), canvas_mask)
    # Counteract the softness introduced by rescaling the rasterised paws.
    return icon.filter(ImageFilter.UnsharpMask(radius=2, percent=90, threshold=2))


def export(icon: Image.Image, name: str, size: int) -> None:
    resized = icon.resize((size, size), Image.LANCZOS).convert('RGB')
    resized.save(OUT_DIR / name, 'PNG', optimize=True)
    print(f'{name}: {size}x{size} {resized.mode}')


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'missing source artwork: {SOURCE}')
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    mask = paw_mask(Image.open(SOURCE))
    standard = compose(mask, diagonal_gradient(CANVAS, GRADIENT_START, GRADIENT_END), STANDARD_PAW_RATIO)
    maskable = compose(mask, Image.new('RGB', (CANVAS, CANVAS), SOLID_BRAND), MASKABLE_PAW_RATIO)

    export(standard, 'icon-192.png', 192)
    export(standard, 'icon-512.png', 512)
    export(standard, 'apple-touch-icon.png', 180)
    export(maskable, 'icon-maskable-512.png', 512)


if __name__ == '__main__':
    main()
