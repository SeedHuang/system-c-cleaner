"""
Roberta I2V -> GIF
- Read mp4 frames via imageio if available, else fallback to Pillow ImageSequence
- Sample N evenly-spaced frames, resize to 480px wide
- Build adaptive-palette looping GIF (smooth, low file size)
"""
import os, sys
from PIL import Image

SRC = r'd:\Seed\system-c-cleaner\icons\roberta_gif\roberta_loop.mp4'
OUT = r'd:\Seed\system-c-cleaner\icons\roberta_gif\roberta_loop.gif'
WIDTH = 480
N_FRAMES = 48          # 抽帧数：多则顺滑，文件大
FRAME_DUR_MS = 60      # 单帧时长 ~ 60ms -> 总时长 ~2.9s

# 尝试用 imageio 抽帧，没有就装一下
try:
    import imageio.v3 as iio
    have_imageio = True
except Exception:
    have_imageio = False

frames = []

if have_imageio:
    meta = iio.immeta(SRC, plugin="pyav")
    print(f"video meta: {meta}")
    for i, frame in enumerate(iio.imiter(SRC, plugin="pyav")):
        frames.append(Image.fromarray(frame))
        if len(frames) >= 200:
            break
else:
    # 回退：Pillow 自带的 ImageSequence 不直接读视频；用 imageio_ffmpeg 或 cv2
    print("imageio not installed, trying cv2...")
    try:
        import cv2
        cap = cv2.VideoCapture(SRC)
        idx = 0
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            frames.append(Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)))
            idx += 1
        cap.release()
    except Exception as e:
        print(f"cv2 failed: {e}")
        sys.exit(1)

print(f"decoded {len(frames)} frames")

if not frames:
    print("no frames decoded")
    sys.exit(1)

# 均匀抽帧
step = max(1, len(frames) // N_FRAMES)
sampled = frames[::step][:N_FRAMES]
print(f"sampled {len(sampled)} frames (step={step})")

# 缩放到目标宽度
resized = []
for f in sampled:
    if f.mode != 'RGB':
        f = f.convert('RGB')
    w, h = f.size
    nh = int(h * WIDTH / w)
    resized.append(f.resize((WIDTH, nh), Image.LANCZOS))

# 转调色板模式（自适应 256 色）
pal_frames = [f.convert('P', palette=Image.ADAPTIVE, colors=128) for f in resized]

pal_frames[0].save(
    OUT,
    save_all=True,
    append_images=pal_frames[1:],
    duration=FRAME_DUR_MS,
    loop=0,
    optimize=True,
    disposal=2,
)

size = os.path.getsize(OUT)
print(f"\nGIF saved: {OUT}")
print(f"  size: {size/1024:.1f} KB")
print(f"  frames: {len(pal_frames)}")
print(f"  duration: {len(pal_frames)*FRAME_DUR_MS/1000:.2f}s")
print(f"  width: {WIDTH}px")
