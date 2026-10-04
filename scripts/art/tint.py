"""
يلوّن صور Fluent 3D بألوان نبضة مع بقاء تجسيمها.

الإضاءة تبقى والألوان تُستبدل: سطوعُ كل بكسل يُقرأ ثم يُرسم على
تدرّج الهوية (كحليٌّ غائر ← سماويُّ الإشارة ← أبيضُ مُضيء). وقبل ذلك
يُمدّ مدى سطوع الصورة إلى آخره — فالكعبة السوداء والقبّعة الداكنة لا
تخرجان ظلّين بلا ملامح.

    python3 scripts/art/tint.py   →  scripts/art/out/*.png
"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
SRC, OUT = HERE / 'src', HERE / 'out'
OUT.mkdir(exist_ok=True)

STOPS = [
    (0.00, (5, 18, 27)),
    (0.28, (11, 60, 85)),
    (0.55, (22, 143, 189)),
    (0.78, (74, 213, 255)),
    (1.00, (236, 251, 255)),
]


def ramp(x):
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if a <= x <= b:
            t = (x - a) / (b - a)
            return tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))
    return STOPS[-1][1]


def tint(path):
    image = Image.open(path).convert('RGBA')
    r, g, b, alpha = image.split()
    light = Image.merge('RGB', (r, g, b)).convert('L')
    # مدى السطوع في الجزء المرئيّ وحده: من ٢٪ إلى ٩٨٪
    values = sorted(v for v, a in zip(light.getdata(), alpha.getdata()) if a > 40)
    lo = values[int(len(values) * 0.02)]
    hi = values[int(len(values) * 0.98)]
    span = max(1, hi - lo)
    table = [ramp(min(1.0, max(0.0, (v - lo) / span)) * 0.92 + 0.06) for v in range(256)]
    rgb = [light.point([c[k] for c in table]) for k in range(3)]
    Image.merge('RGBA', (*rgb, alpha)).save(OUT / path.name)


for file in sorted(SRC.glob('*.png')):
    tint(file)
print(f'{len(list(OUT.glob("*.png")))} صورة في {OUT}')
