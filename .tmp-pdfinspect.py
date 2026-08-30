import sys
import Quartz
from Foundation import NSURL

path = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else "info"
url = NSURL.fileURLWithPath_(path)
doc = Quartz.PDFDocument.alloc().initWithURL_(url)
if doc is None:
    print("FAILED TO OPEN", path)
    sys.exit(1)

if mode == "info":
    n = doc.pageCount()
    print("pages:", n)
    seen = set()
    for i in range(n):
        p = doc.pageAtIndex_(i)
        r = p.boundsForBox_(Quartz.kPDFDisplayBoxMediaBox)
        w = round(r.size.width, 2)
        h = round(r.size.height, 2)
        seen.add((w, h))
    for w, h in sorted(seen):
        mm_w = round(w / 72 * 25.4, 1)
        mm_h = round(h / 72 * 25.4, 1)
        print(f"page size: {w} x {h} pts  ({mm_w} x {mm_h} mm)")
else:
    print(doc.string())
