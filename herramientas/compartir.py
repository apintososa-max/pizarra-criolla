"""Genera la imagen que muestran WhatsApp, X o Facebook al compartir el enlace de la app (1200 x 630).
Uso: python herramientas/compartir.py  -> escribe icons/compartir.png
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BLUE = (0, 36, 125)
BLUE2 = (13, 53, 146)
WHITE = (255, 255, 255)
YELLOW = (255, 204, 0)
RED = (207, 20, 43)
SOFT = (174, 188, 230)
OUT = Path(__file__).resolve().parent.parent / "icons" / "compartir.png"
FONTS = Path("C:/Windows/Fonts")


def font(size, bold=True):
    for name, var in (("bahnschrift.ttf", "Bold Condensed" if bold else "SemiLight Condensed"), ("arialbd.ttf" if bold else "arial.ttf", None)):
        p = FONTS / name
        if p.exists():
            f = ImageFont.truetype(str(p), size)
            if var:
                try:
                    f.set_variation_by_name(var)
                except Exception:
                    pass
            return f
    return ImageFont.load_default()


def star(d, cx, cy, R, r, fill):
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36)
        rad = R if k % 2 == 0 else r
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    d.polygon(pts, fill=fill)


def main():
    W, H, S = 1200, 630, 2
    img = Image.new("RGB", (W * S, H * S), BLUE)
    d = ImageDraw.Draw(img)
    # franja tricolor abajo
    band = 14 * S
    d.rectangle([0, H * S - 3 * band, W * S, H * S - 2 * band], fill=YELLOW)
    d.rectangle([0, H * S - 2 * band, W * S, H * S - band], fill=BLUE2)
    d.rectangle([0, H * S - band, W * S, H * S], fill=RED)
    # diamante a la izquierda con el arco de 8 estrellas
    cx, cy, r = 300 * S, 300 * S, 150 * S
    top, right, bottom, left = (cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)
    d.line([bottom, right, top, left, bottom], fill=WHITE, width=24 * S, joint="curve")
    b = 26 * S
    for (x, y) in (right, top, left):
        d.polygon([(x, y - b), (x + b, y), (x, y + b), (x - b, y)], fill=WHITE)
    hb = 32 * S
    hx, hy = bottom
    d.polygon([(hx - hb, hy - hb), (hx + hb, hy - hb), (hx + hb, hy), (hx, hy + hb), (hx - hb, hy)], fill=YELLOW)
    m = 22 * S
    d.ellipse([cx - m, cy - m, cx + m, cy + m], fill=RED)
    A = 222 * S
    for i in range(8):
        th = math.radians(198 + i * (144 / 7))
        star(d, cx + A * math.cos(th), cy + A * math.sin(th), 19 * S, 8 * S, WHITE)
    # textos
    x0 = 560 * S
    d.text((x0, 150 * S), "PIZARRA", font=font(118 * S), fill=WHITE)
    d.text((x0, 262 * S), "CRIOLLA", font=font(118 * S), fill=YELLOW)
    d.text((x0, 400 * S), "La LVBP en vivo: juegos, tabla,", font=font(38 * S, False), fill=SOFT)
    d.text((x0, 448 * S), "probabilidades y métricas avanzadas", font=font(38 * S, False), fill=SOFT)
    img.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print("imagen lista:", OUT)


if __name__ == "__main__":
    main()
