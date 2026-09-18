"""
Roberta pixel GIF v8 - 32x32 NES, single-character consistency
- 8 high-res bust portraits (anim_f1.jpg ... anim_f8.jpg)
- Crop to square bust, remove dark navy background (already there!)
- Apply: red pupil boost (already there!), pixelate to 32x32 NES palette
- Build cyberpunk bg, composite, save 3s loop GIF
"""
import os
from PIL import Image, ImageEnhance, ImageFilter, ImageChops

FRAMES_DIR = r'd:\Seed\system-c-cleaner\icons\frames'
OUT_DIR = r'd:\Seed\system-c-cleaner\icons\gif'
os.makedirs(OUT_DIR, exist_ok=True)

TARGET = 64  # try 64 for more detail; user can re-render at 32

# 8 frames in sequence
FRAMES = [
    (1, 350),   # stare straight
    (2, 300),   # eyes shift right
    (3, 300),   # chin up, hands shrug
    (4, 350),   # right hand reaching for device
    (5, 350),   # device raised to chest
    (6, 350),   # device at side
    (7, 400),   # left hand rising to glasses
    (8, 700),   # CLIMAX: push glasses + device + grin (longest hold)
]


def make_cyberpunk_bg(size, seed=7):
    """Dark purple radial gradient + cyan/magenta neon edge glow only."""
    import random
    img = Image.new('RGB', (size, size), (10, 5, 20))
    px = img.load()
    cx, cy = size // 2, int(size * 0.45)
    max_r = int(size * 0.85)
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            t = min(1.0, d / max_r)
            r = int(60 * (1 - t) + 12 * t)
            g = int(25 * (1 - t) + 8 * t)
            b = int(95 * (1 - t) + 22 * t)
            px[x, y] = (r, g, b)

    # Cyan-magenta corner neon (corner-based gradient)
    corners = [(0, 0, (0, 200, 230)), (size, size, (230, 30, 180))]
    for x in range(size):
        for y in range(size):
            d_corner = min(x + y, (size - 1 - x) + y, x + (size - 1 - y), (size - 1 - x) + (size - 1 - y))
            if d_corner < size * 0.5:
                t = d_corner / (size * 0.5)
                # interpolate between cyan and magenta
                cr = int(0 * (1 - t) + 230 * t)
                cg = int(200 * (1 - t) + 30 * t)
                cb = int(230 * (1 - t) + 180 * t)
                ex = px[x, y]
                px[x, y] = (
                    min(255, ex[0] + cr // 4),
                    min(255, ex[1] + cg // 4),
                    min(255, ex[2] + cb // 4),
                )
    # Stars
    random.seed(seed)
    for _ in range(size // 2):
        x = random.randint(0, size - 1)
        y = random.randint(0, size - 1)
        if random.random() < 0.5:
            img.putpixel((x, y), (220, 220, 240))
    return img


def remove_bg_by_color(img, target=(40, 35, 70), tol=50):
    """Make pixels close to target dark navy/purple transparent."""
    rgba = img.convert('RGBA')
    px = rgba.load()
    w, h = rgba.size
    tr, tg, tb = target
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if abs(r - tr) < tol and abs(g - tg) < tol and abs(b - tb) < tol:
                # dark purple background -> transparent
                if r < 80 and g < 80 and b < 120:
                    px[x, y] = (0, 0, 0, 0)
            # also remove near-black corners
            if r < 15 and g < 15 and b < 25:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def add_cyan_rim(rgba):
    """Add cyan rim glow on silver/metal pixels (the device)."""
    rgb = rgba.convert('RGB')
    w, h = rgb.size
    silver_mask = Image.new('L', (w, h), 0)
    sp = silver_mask.load()
    rp = rgb.load()
    # Only consider pixels in the lower half (where device/gun would be)
    for y in range(int(h * 0.35), h):
        for x in range(w):
            r, g, b = rp[x, y]
            if 140 < r < 235 and 140 < g < 235 and 140 < b < 235 and abs(r - g) < 25 and abs(g - b) < 25:
                sp[x, y] = 255
    glow = silver_mask.filter(ImageFilter.MaxFilter(5))
    # Only ADD glow within silver_mask area (not spread to whole image)
    glow_layer = Image.new('RGB', (w, h), (0, 0, 0))
    gp = glow_layer.load()
    gpx = glow.load()
    smp = silver_mask.load()
    for y in range(h):
        for x in range(w):
            # Only paint where silver exists (the gun body), tint slightly cyan
            if smp[x, y] > 0:
                gp[x, y] = (140, 230, 250)
    result = Image.blend(rgb, glow_layer, 0.35)
    out = result.convert('RGBA')
    out.putalpha(rgba.split()[3])
    return out


def add_dark_outline(rgba):
    alpha = rgba.split()[3]
    mask = alpha.point(lambda v: 255 if v > 30 else 0)
    dilated = mask.filter(ImageFilter.MaxFilter(3))
    outline = ImageChops.subtract(dilated, mask)
    rgb = rgba.convert('RGB')
    out = rgb.copy()
    op = out.load()
    opx = outline.load()
    w, h = rgb.size
    for y in range(h):
        for x in range(w):
            if opx[x, y] > 0:
                op[x, y] = (15, 5, 25)
    result = out.convert('RGBA')
    result.putalpha(alpha)
    return result


def pixelate_compose(fg, bg, size):
    fg = fg.convert('RGBA')
    rgb = fg.convert('RGB')
    rgb = ImageEnhance.Contrast(rgb).enhance(1.20)
    rgb = ImageEnhance.Color(rgb).enhance(1.15)
    small_rgb = rgb.resize((size, size), Image.NEAREST)
    alpha = fg.split()[3].resize((size, size), Image.NEAREST)
    small_bg = bg.resize((size, size), Image.NEAREST).convert('RGBA')
    out = small_bg.copy()
    op = out.load()
    fp = small_rgb.load()
    bp = small_bg.load()
    ap = alpha.load()
    for y in range(size):
        for x in range(size):
            a = ap[x, y]
            if a == 0:
                continue
            af = a / 255.0
            fr, fg_c, fb = fp[x, y]
            br, bg_c, bb, _ = bp[x, y]
            op[x, y] = (
                int(fr * af + br * (1 - af)),
                int(fg_c * af + bg_c * (1 - af)),
                int(fb * af + bb * (1 - af)),
                255,
            )
    return out


def main():
    bg = make_cyberpunk_bg(TARGET * 8)
    frames = []
    for idx, dur in FRAMES:
        src_path = os.path.join(FRAMES_DIR, f'anim_f{idx}.jpg')
        if not os.path.exists(src_path):
            print(f'frame {idx} missing, skipping')
            continue
        img = Image.open(src_path).convert('RGB')
        w, h = img.size
        # Bust crop: center-crop the upper portion to keep face + upper body
        # Cut to a square: take the middle square area
        side = min(w, h)
        img = img.crop(((w - side) // 2, 0, (w - side) // 2 + side, side))
        # Further crop to focus on head + chest (top 75%)
        cw = side
        ch = int(side * 0.85)
        img = img.crop((0, 0, cw, ch))
        # Resize down to 4x target size for clean pre-pixelation
        img = img.resize((TARGET * 4, TARGET * 4), Image.LANCZOS)
        img = img.convert('RGBA')
        img = remove_bg_by_color(img, target=(40, 35, 70), tol=45)
        img = add_dark_outline(img)
        img = add_cyan_rim(img)
        frame = pixelate_compose(img, bg, TARGET)
        frames.append((idx, frame))
        frame.save(os.path.join(OUT_DIR, f'preview_frame{idx}.png'))

    gif_path = os.path.join(OUT_DIR, 'roberta_pixel.gif')
    pal_frames = [f[1].convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=64) for f in frames]
    durations = [d for _, d in FRAMES[:len(frames)]]
    pal_frames[0].save(
        gif_path,
        save_all=True,
        append_images=pal_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f'\nGIF saved: {gif_path} ({sum(durations)/1000:.2f}s, {len(frames)} frames)')


if __name__ == '__main__':
    main()
