"""Debug: sample colors from a bust_raw to see actual face pixel values."""
from PIL import Image
img = Image.open(r'd:\Seed\system-c-cleaner\icons\gif\bust_raw_1.png').convert('RGBA')
w, h = img.size
print(f'Image: {w}x{h}')
# Sample center (face area) and corners (background)
samples = {
    'center': (w//2, h//2),
    'upper_third': (w//2, h//3),
    'lower_third': (w//2, 2*h//3),
    'corner_tl': (5, 5),
    'corner_br': (w-5, h-5),
    'left_quarter': (w//4, h//2),
    'right_quarter': (3*w//4, h//2),
}
for name, (x, y) in samples.items():
    px = img.getpixel((x, y))
    print(f'  {name} ({x},{y}): RGBA={px}')
