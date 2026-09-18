#!/usr/bin/env python3
"""Classify each idle-row frame as eyes-open or eyes-closed.

The amber iris is the only strongly warm region in the eye band; a closed eye
draws a dark lash line there instead. The two clusters are far apart (0-1 iris
pixels versus 86-128), so the threshold is not delicate.

Prints JSON on stdout: {"0": {"iris": 128, "eyes": "open"}, ...}
"""
import json
import os

from PIL import Image

ROW = 0
CELL_W, CELL_H = 192, 208
FRAMES = 7
EYE_TOP, EYE_BOTTOM = 78, 118
IRIS_MIN = 40

def find_asset(name):
    """Walk up to the repository's canonical assets/, shared with the QML plugin.

    One code path works for both layouts: dsh/test/ inside the repository, and
    test/ in a standalone checkout of just the DSH treatment.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    directory = here
    while True:
        candidate = os.path.join(directory, 'assets', name)
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(directory)
        if parent == directory:
            raise SystemExit('could not find assets/%s in any directory above %s' % (name, here))
        directory = parent


ATLAS = find_asset('spritesheet.webp')

im = Image.open(ATLAS).convert('RGBA')
bg = Image.new('RGBA', im.size, (22, 22, 26, 255))
bg.alpha_composite(im)
im = bg.convert('RGB')

out = {}
for cell in range(FRAMES):
    band = im.crop((cell * CELL_W, ROW * CELL_H + EYE_TOP, (cell + 1) * CELL_W, ROW * CELL_H + EYE_BOTTOM))
    warm = sum(1 for r, g, b in band.getdata() if r > 110 and g > 60 and b < 90 and r - b > 50)
    out[str(cell)] = {'iris': warm, 'eyes': 'closed' if warm < IRIS_MIN else 'open'}

print(json.dumps(out))
