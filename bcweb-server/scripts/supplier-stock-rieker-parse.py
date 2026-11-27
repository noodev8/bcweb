"""
=======================================================================================================================================
Script: supplier-stock-rieker-parse.py — read the Rieker Available Stock List PDF (owner, 2026-11-27)
=======================================================================================================================================
Called by scripts/supplier-stock-load.js (never on its own): prints the list as JSON on stdout.
  { "list_date": "2026-11-27", "styles": [ { "style": "44650-02", "season": "Autumn/Winter", "cost": 30.05,
                                             "sizes": { "38": "limited", "40": "limited" } } ] }

WHY THE DRAWING, NOT THE TEXT: the stock level is not written anywhere — each size has an empty box under its label, shaded grey
(Limited) or black (Substantial), white = No Stock. So the parser finds every filled box of box size (10–40pt; the thin black border
lines are skipped by size) and reads it under the size label whose centre it sits beneath. Checked by eye against page 21 of the
27/11/2026 list.
Each style block starts at its "Style:" label; the code is the word to its right, the price is the £ figure on the left, the season
the word with a "/". Sizes: 36–47 and S/M/L/XL (clothing). Handbag has no label colon, so it is not read.
Needs PyMuPDF (pip install pymupdf) in PYTHON_BIN.
=======================================================================================================================================
"""
import json
import re
import sys
from datetime import datetime

import pymupdf

SIZES = set('36 37 38 39 40 41 42 43 44 45 46 47 S M L XL'.split())


def level_of(fill):
    if fill is None:
        return None
    m = max(fill)
    if m < 0.2:
        return 'substantial'   # black
    if m < 0.9:
        return 'limited'       # grey (0.75)
    return None                # white = no stock


def main(path):
    doc = pymupdf.open(path)
    styles = []
    list_date = None
    for page in doc:
        words = page.get_text('words')   # (x0, y0, x1, y1, text, ...)
        if list_date is None:
            m = re.search(r'(\d{1,2} [A-Z][a-z]+ \d{4})', page.get_text())
            if m:
                list_date = datetime.strptime(m.group(1), '%d %B %Y').date().isoformat()
        boxes = []
        for d in page.get_drawings():
            r = d['rect']
            if r.width < 10 or r.height < 10 or r.width > 40:
                continue
            lvl = level_of(d.get('fill'))
            if lvl:
                boxes.append((r, lvl))
        labels = sorted([w for w in words if w[4] == 'Style:'], key=lambda w: w[1])
        for i, sw in enumerate(labels):
            top = sw[1] - 40
            bottom = labels[i + 1][1] - 40 if i + 1 < len(labels) else 1e9
            block = [w for w in words if top <= w[1] < bottom]
            code = next((w[4] for w in block if w[0] > 270 and abs(w[1] - sw[1]) < 3), None)
            if not code:
                continue
            price = next((w[4] for w in block if w[0] < 150 and re.search(r'\d+\.\d\d$', w[4])), None)
            season = next((w[4] for w in block if '/' in w[4]), None)
            sizes = {}
            for w in block:
                label = w[4].rstrip(':')
                if not w[4].endswith(':') or label not in SIZES:
                    continue
                cx = (w[0] + w[2]) / 2
                lvl = next((l for r, l in boxes if r.x0 < cx < r.x1 and w[3] < r.y0 < w[3] + 25), None)
                if lvl:
                    sizes[label] = lvl
            cost = float(re.sub(r'[^\d.]', '', price)) if price else None
            styles.append({'style': code, 'season': season, 'cost': cost, 'sizes': sizes})
    json.dump({'list_date': list_date, 'styles': styles}, sys.stdout)


if __name__ == '__main__':
    main(sys.argv[1])
