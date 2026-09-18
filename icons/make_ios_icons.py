"""
Roberta iOS App Icon Generator v2
- Detects the actual icon rectangle by sampling the white border pixels
- Removes the white outer border
- Keeps the dark purple gradient + character + neon rim as the icon content
- Applies iOS continuous (squircle) corner mask
- Exports all standard iOS icon sizes
"""

from PIL import Image, ImageDraw
import os

SRC = r'd:\Seed\system-c-cleaner\icons\roberta_src.jpeg'
OUT_DIR = r'd:\Seed\system-c-cleaner\icons\ios'

SIZES = {
    'icon-1024.png': 1024,
    'icon-180.png': 180,
    'icon-167.png': 167,
    'icon-152.png': 152,
    'icon-120.png': 120,
    'icon-87.png': 87,
    'icon-80.png': 80,
    'icon-60.png': 60,
    'icon-58.png': 58,
    'icon-40.png': 40,
}

IOS_RADIUS_RATIO = 0.2237


def find_content_bbox(img: Image.Image, white_threshold: int = 235) -> tuple:
    """Find the bounding box of non-white content."""
    img_rgb = img.convert('RGB')
    w, h = img_rgb.size
    pixels = img_rgb.load()
    min_x, min_y = w, h
    max_x, max_y = 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if min(r, g, b) < white_threshold:
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y
    return (min_x, min_y, max_x + 1, max_y + 1)


def ios_rounded_mask(size: int, radius_ratio: float = IOS_RADIUS_RATIO) -> Image.Image:
    """Generate a continuous corner mask approximating iOS squircle."""
    radius = size * radius_ratio
    ss = 4
    big = size * ss
    big_radius = radius * ss
    mask = Image.new('L', (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (big - 1, big - 1)], radius=big_radius, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    src = Image.open(SRC).convert('RGB')
    bbox = find_content_bbox(src, white_threshold=235)
    print(f"Content bbox: {bbox}, image size: {src.size}")

    # Crop to content bbox
    cropped = src.crop(bbox)
    cw, ch = cropped.size
    print(f"Cropped size: {cw}x{ch}")

    # Make it square (the icon is already roughly square)
    side = max(cw, ch)
    square = Image.new('RGB', (side, side), (20, 10, 30))  # deep purple-black fallback
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    square.paste(cropped, (ox, oy))

    # Save master 1024 transparent version (before mask) for preview
    master = square.copy()
    master_path = os.path.join(OUT_DIR, 'roberta_master.png')
    master.save(master_path, 'PNG')
    print(f"Saved master: {master_path}")

    # Generate each iOS icon size with rounded mask applied as alpha
    for name, size in SIZES.items():
        icon = square.resize((size, size), Image.LANCZOS).convert('RGBA')
        mask = ios_rounded_mask(size)
        # Apply mask to alpha
        combined = Image.new('L', (size, size))
        rp, gp, bp, ap = icon.split()
        mp = mask.load()
        cp = combined.load()
        apl = ap.load()
        for y in range(size):
            for x in range(size):
                cp[x, y] = apl[x, y] * mp[x, y] // 255
        icon.putalpha(combined)
        out_path = os.path.join(OUT_DIR, name)
        icon.save(out_path, 'PNG', optimize=True)
        print(f"  {name}  ({size}x{size})")

    print("\nDone. Output:", OUT_DIR)


if __name__ == '__main__':
    main()
