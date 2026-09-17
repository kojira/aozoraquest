"""Export the game's actual frames. Run from repo root: python3 scripts/export-bluesky-npc.py
Requires Pillow (image generation only; not an app/runtime dependency).
"""
import base64
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/web/public/art/bluesky-npc'
OUT.mkdir(parents=True, exist_ok=True)
records = json.loads(subprocess.check_output([
    'pnpm', 'exec', 'tsx', '-e',
    "import { BLUESKY_NPC_FRAMES } from './packages/core/src/bluesky-npc-art.ts'; console.log(JSON.stringify(BLUESKY_NPC_FRAMES));",
], cwd=ROOT, text=True))
frames = []
for n, record in enumerate(records):
    image = Image.new('RGBA', (record['size'], record['size']))
    colors = [(0, 0, 0, 0) if not c else tuple(bytes.fromhex(c[1:])) + (255,) for c in record['palette']]
    image.putdata([colors[p] for p in base64.b64decode(record['pixels'])])
    image.save(OUT / f'frame-{n + 1}.png')
    frames.append(image)
sheet = Image.new('RGBA', (64, 32))
for n, image in enumerate(frames):
    sheet.paste(image, (n * 32, 0))
sheet.save(OUT / 'sprite-sheet.png')
# The GIF uses the exact game palette, retaining index 0 transparency and 300ms cadence.
gif_frames = []
for record in records:
    image = Image.frombytes('P', (32, 32), base64.b64decode(record['pixels']))
    palette = []
    for c in record['palette']:
        palette.extend(bytes.fromhex(c[1:]) if c else [0, 0, 0])
    image.putpalette(palette + [0] * (768 - len(palette)))
    gif_frames.append(image.resize((256, 256), Image.Resampling.NEAREST))
gif_frames[0].save(OUT / 'walking.gif', save_all=True, append_images=gif_frames[1:],
                   duration=300, loop=0, transparency=0, disposal=2, optimize=False)
# A human-facing sheet: actual game scale plus crisp enlargement, no fixture labels.
canvas = Image.new('RGB', (640, 440), '#182534')
draw = ImageDraw.Draw(canvas)
font_path = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'
try:
    title = ImageFont.truetype(font_path, 24)
    label = ImageFont.truetype(font_path, 16)
except OSError:
    title = ImageFont.load_default(size=24)
    label = ImageFont.load_default(size=16)
draw.text((24, 16), 'Blueskyちゃん', fill='#e5f5ef', font=title)
draw.text((24, 58), '32 × 32 / 原寸', fill='#b9d8e6', font=label)
for n, image in enumerate(frames):
    canvas.paste(image, (190 + n * 52, 54), image)
    enlarged = image.resize((256, 256), Image.Resampling.NEAREST)
    canvas.paste(enlarged, (40 + n * 304, 106), enlarged)
    draw.text((110 + n * 304, 370), f'{n + 1} / 300ms', fill='#b9d8e6', font=label)
draw.text((24, 406), '顔はそのまま、手足を交互に。', fill='#e5f5ef', font=label)
canvas.save(OUT / 'comparison.png')
print(OUT)
