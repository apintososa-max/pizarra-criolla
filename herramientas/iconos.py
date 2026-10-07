"""Genera los íconos de la app: diamante de béisbol sobre el azul de la bandera, con el arco de 8 estrellas
(una por equipo de la LVBP), home en amarillo y el montículo en rojo.
Y los de los accesos directos del ícono (manifest.webmanifest, 96 px): Juegos de hoy, Tabla, Mi equipo y Buscar, con
el mismo azul, las líneas blancas de cal y los toques de amarillo y rojo; cada uno en dos formas: con las esquinas
redondeadas (como icon-192) y a sangre para Android (maskable: el dibujo dentro de la zona segura).
Uso: python herramientas/iconos.py  -> escribe icons/*.png (los de siempre salen idénticos)
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


# ---------- accesos directos ----------
# Cada dibujo está pensado en una caja de 24 unidades (la misma de los íconos de la barra de secciones de la app) y se
# lleva al centro del ícono; scale achica el dibujo (0.8 en la versión a sangre, para que quede en la zona segura).

def bez(p0, p1, p2, p3, n=24):
    """Puntos de una curva de Bézier cúbica."""
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]))
    return pts


def round_line(d, pts, w, fill):
    """Línea con las puntas y las uniones redondeadas."""
    d.line(pts, fill=fill, width=w, joint="curve")
    for (x, y) in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=fill)


def glyph_juegos(d, P, k):
    """Juegos de hoy: la pelota, con sus costuras en rojo."""
    cx, cy = P(12, 12)
    r = 8.6 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    w = max(2, round(1.9 * k))
    for side in (1, -1):
        X = lambda x: 12 + side * (x - 12)
        a = bez((X(7), 5.6), (X(8.7), 7.2), (X(9.7), 9.5), (X(9.7), 12))
        b = bez((X(9.7), 12), (X(9.7), 14.5), (X(8.7), 16.8), (X(7), 18.4))
        round_line(d, [P(x, y) for (x, y) in a + b[1:]], w, RED)


def glyph_tabla(d, P, k):
    """Tabla: la cuadrícula, con la fila de arriba en amarillo (la zona que va directo al Round Robin)."""
    w = max(2, round(2.0 * k))
    x0, y0 = P(3.5, 4.5)
    x1, y1 = P(20.5, 19.5)
    rad = 2.2 * k
    ya = P(0, 9.5)[1]
    d.rounded_rectangle([x0, y0, x1, ya], radius=rad, fill=YELLOW)
    d.rectangle([x0, ya - rad, x1, ya], fill=YELLOW)
    d.rounded_rectangle([x0, y0, x1, y1], radius=rad, outline=WHITE, width=w)
    for y in (9.5, 14.5):
        yy = P(0, y)[1]
        d.line([(x0, yy), (x1, yy)], fill=WHITE, width=w)
    xx = P(9, 0)[0]
    d.line([(xx, P(0, 9.5)[1]), (xx, y1)], fill=WHITE, width=w)


def glyph_mi_equipo(d, P, k):
    """Mi equipo: el escudo de la sección Equipos, con una estrella amarilla."""
    w = max(2, round(2.0 * k))
    pts = [(12, 3.2), (19.5, 6.0), (19.5, 11.6)]
    pts += bez((19.5, 11.6), (19.5, 15.9), (16.3, 19.3), (12, 20.7))[1:]
    pts += bez((12, 20.7), (7.7, 19.3), (4.5, 15.9), (4.5, 11.6))[1:]
    pts += [(4.5, 6.0), (12, 3.2), (19.5, 6.0)]
    d.line([P(x, y) for (x, y) in pts], fill=WHITE, width=w, joint="curve")
    cx, cy = P(12, 11.6)
    star(d, cx, cy, 4.6 * k, 1.95 * k, YELLOW)


def glyph_buscar(d, P, k):
    """Buscar: la lupa."""
    w = max(2, round(2.3 * k))
    cx, cy = P(10.5, 10.5)
    r = 6.3 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=w)
    round_line(d, [P(15.3, 15.3), P(20, 20)], round(w * 1.2), WHITE)


SHORTCUTS = (("juegos", glyph_juegos), ("tabla", glyph_tabla), ("mi-equipo", glyph_mi_equipo), ("buscar", glyph_buscar))


def shortcut(glyph, size, scale, rounded):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BLUE)
    else:
        d.rectangle([0, 0, s, s], fill=BLUE)
    k = s * 0.62 * scale / 24                 # el dibujo ocupa el 62 % del ícono
    c = s / 2
    glyph(d, lambda x, y: (c + (x - 12) * k, c + (y - 12) * k), k)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    art(192, 1.0, True).save(OUT / "icon-192.png")
    art(512, 1.0, True).save(OUT / "icon-512.png")
    art(512, 0.8, False).save(OUT / "icon-maskable-512.png")       # zona segura para Android
    art(180, 0.95, False).convert("RGB").save(OUT / "apple-touch-icon.png")
    for name, glyph in SHORTCUTS:                                   # accesos directos (manifest.webmanifest)
        shortcut(glyph, 96, 1.0, True).save(OUT / f"atajo-{name}-96.png")
        shortcut(glyph, 96, 0.8, False).save(OUT / f"atajo-{name}-mask-96.png")
    print("iconos listos en", OUT)


if __name__ == "__main__":
    main()
