"""Genera los íconos de la app: diamante de béisbol sobre el azul de la bandera, con el arco de 8 estrellas
(una por equipo de la LVBP), home en amarillo y el montículo en rojo.
Uso: python herramientas/iconos.py  -> escribe icons/*.png
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

BLUE = (0, 36, 125, 255)        # azul de la bandera
WHITE = (255, 255, 255, 255)
YELLOW = (255, 204, 0, 255)     # amarillo de la bandera
RED = (207, 20, 43, 255)        # rojo de la bandera
OUT = Path(__file__).resolve().parent.parent / "icons"


def star(d, cx, cy, R, r, fill):
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36)
        rad = R if k % 2 == 0 else r
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    d.polygon(pts, fill=fill)


def art(size, scale, rounded):
    s = size * 4  # dibujar en grande y reducir: bordes suaves
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BLUE)
    else:
        d.rectangle([0, 0, s, s], fill=BLUE)
    c = s / 2
    oy = s * 0.07 * scale                     # el diamante baja un poco para dejar sitio a las estrellas
    r = s * 0.25 * scale                      # radio del diamante (centro a cada base)
    w = max(4, int(s * 0.042 * scale))        # grosor de las líneas de cal
    top, right, bottom, left = (c, c + oy - r), (c + r, c + oy), (c, c + oy + r), (c - r, c + oy)
    d.line([bottom, right, top, left, bottom], fill=WHITE, width=w, joint="curve")
    b = s * 0.048 * scale                     # medio lado de cada base
    for (x, y) in (right, top, left):
        d.polygon([(x, y - b), (x + b, y), (x, y + b), (x - b, y)], fill=WHITE)
    hx, hy = bottom                           # home: pentágono amarillo
    hb = s * 0.062 * scale
    d.polygon([(hx - hb, hy - hb), (hx + hb, hy - hb), (hx + hb, hy), (hx, hy + hb), (hx - hb, hy)], fill=YELLOW)
    m = s * 0.045 * scale                     # montículo rojo
    d.ellipse([c - m, c + oy - m, c + m, c + oy + m], fill=RED)
    A = s * 0.36 * scale                      # arco de 8 estrellas, como en la bandera
    for i in range(8):
        th = math.radians(198 + i * (144 / 7))
        star(d, c + A * math.cos(th), c + oy + A * math.sin(th), s * 0.036 * scale, s * 0.015 * scale, WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    art(192, 1.0, True).save(OUT / "icon-192.png")
    art(512, 1.0, True).save(OUT / "icon-512.png")
    art(512, 0.8, False).save(OUT / "icon-maskable-512.png")       # zona segura para Android
    art(180, 0.95, False).convert("RGB").save(OUT / "apple-touch-icon.png")
    print("iconos listos en", OUT)


if __name__ == "__main__":
    main()
