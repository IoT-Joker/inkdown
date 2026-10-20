"""采样截图关键区域的像素颜色，客观判断主题是否真正生效。"""
import os
import sys
from PIL import Image

# 默认取项目 screenshots 下的深色主题截图（从脚本位置推导，不硬编码路径）
_default = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'screenshots',
    '03-dark.png',
)
path = sys.argv[1] if len(sys.argv) > 1 else _default
im = Image.open(path).convert('RGB')
w, h = im.size
print(f'图像尺寸: {w}x{h}')

# 取几个代表性区域的平均色：侧边栏、编辑区中部、状态栏
regions = {
    '侧边栏': (10, 400, 240, 500),
    '编辑区空白处': (900, 700, 1100, 760),
    '编辑区中部右侧': (1000, 300, 1150, 400),
    '状态栏': (400, h - 20, 900, h - 6),
    '顶部标签栏': (600, 8, 900, 30),
}

for name, box in regions.items():
    box = (box[0], box[1], min(box[2], w - 1), min(box[3], h - 1))
    crop = im.crop(box)
    pixels = list(crop.getdata())
    n = len(pixels)
    avg = tuple(sum(p[i] for p in pixels) // n for i in range(3))
    lum = 0.299 * avg[0] + 0.587 * avg[1] + 0.114 * avg[2]
    print(f'{name:14s} 平均 RGB={avg}  亮度={lum:.1f}')
