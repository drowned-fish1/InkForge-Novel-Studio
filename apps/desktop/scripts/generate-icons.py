from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
SIZE = 512
SCALE = 4


def font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/seguisb.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def render() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    unit = SCALE
    draw.rounded_rectangle(
        (16 * unit, 16 * unit, 496 * unit, 496 * unit),
        radius=112 * unit,
        fill="#123f3a",
    )
    draw.rounded_rectangle(
        (27 * unit, 27 * unit, 485 * unit, 485 * unit),
        radius=101 * unit,
        outline="#2e6158",
        width=10 * unit,
    )
    mark_font = font(250 * unit)
    mark = "IF"
    bounds = draw.textbbox((0, 0), mark, font=mark_font, stroke_width=0)
    mark_width = bounds[2] - bounds[0]
    mark_height = bounds[3] - bounds[1]
    mark_x = (SIZE * unit - mark_width) / 2
    mark_y = 238 * unit - mark_height / 2 - bounds[1]
    draw.text((mark_x, mark_y), mark, font=mark_font, fill="#f3eee3")
    draw.line(
        (130 * unit, 416 * unit, 382 * unit, 416 * unit),
        fill="#d7a841",
        width=28 * unit,
    )
    draw.ellipse(
        (116 * unit, 402 * unit, 144 * unit, 430 * unit),
        fill="#d7a841",
    )
    draw.ellipse(
        (368 * unit, 402 * unit, 396 * unit, 430 * unit),
        fill="#d7a841",
    )
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    image = render()
    image.save(BUILD_DIR / "icon.png", optimize=True)
    image.save(
        BUILD_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
