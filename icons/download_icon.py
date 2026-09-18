import urllib.request
import os

os.makedirs(r'd:\Seed\system-c-cleaner\icons', exist_ok=True)

url = "https://hailuo-image-algeng-data.oss-cn-wulanchabu.aliyuncs.com/image_inference_output%2Ftalkie%2Fprod%2Fimg%2F2026-09-18%2F1246ee67-60c2-44b8-88ff-54208492ced0_aigc.jpeg?Expires=1789782059&OSSAccessKeyId=LTAI5tB2SwrRwAtD23etQUbC&Signature=Smm4TgEaWIsqccN3VgzerqBSxn4%3D"
out_path = r'd:\Seed\system-c-cleaner\icons\roberta_src.jpeg'

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    data = resp.read()
with open(out_path, 'wb') as f:
    f.write(data)

print(f"Downloaded: {out_path}, {len(data)} bytes")
