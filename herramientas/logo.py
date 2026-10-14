"""Genera los íconos de la app y la imagen para compartir a partir de los dos logos (14/10/2026):
- icons/logo-pc.png: el "PC" en círculo, para el ícono (se lee hasta en 48 px);
- icons/logo-escudo.png: el escudo del bateador sobre la pizarra, para la vista previa de los enlaces (og:image).

Los dos van con fondo transparente y sin "LVBP": la app no tiene relación oficial con la liga. Si cambia el logo, se
reemplazan esos dos archivos y se corre esto. Los íconos de los accesos directos siguen en herramientas/iconos.py.
Uso: python herramientas/logo.py  -> escribe icons/icon-192.png, icon-512.png, icon-maskable-512.png,
apple-touch-icon.png y compartir.png
"""
from pathlib import Path
from PIL import Image, ImageDraw

AZUL = (0, 36, 125, 255)        # azul de la bandera, el fondo del ícono
NOCHE = (8, 16, 38)             # el azul de noche de la app, abajo en la imagen de compartir
DIR = Path(__file__).resolve().parent.parent / "icons"


def cuadro(logo, lado, frac, redondo):
    """El logo centrado sobre el azul, ocupando `frac` del lado. Con `redondo`, esquinas redondeadas (transparentes)."""
    c = Image.new("RGBA", (lado, lado), AZUL)
    l = logo.copy()
    t = int(lado * frac)
    l.thumbnail((t, t), Image.LANCZOS)
    c.alpha_composite(l, ((lado - l.width) // 2, (lado - l.height) // 2))
    if redondo:
        m = Image.new("L", (lado, lado), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, lado - 1, lado - 1), radius=int(lado * 0.22), fill=255)
        c.putalpha(m)
    return c


def compartir(escudo):
    """1200 x 630: el escudo al centro sobre un degradado del azul de la bandera al azul de noche."""
    im = Image.new("RGBA", (1200, 630))
    d = ImageDraw.Draw(im)
    for y in range(630):
        t = y / 629
        d.line([(0, y), (1199, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(AZUL[:3], NOCHE)) + (255,))
    e = escudo.copy()
    e.thumbnail((560, 560), Image.LANCZOS)
    im.alpha_composite(e, ((1200 - e.width) // 2, (630 - e.height) // 2))
    return im.convert("RGB")


def main():
    pc = Image.open(DIR / "logo-pc.png").convert("RGBA")
    escudo = Image.open(DIR / "logo-escudo.png").convert("RGBA")
    cuadro(pc, 192, 0.90, True).save(DIR / "icon-192.png")
    cuadro(pc, 512, 0.90, True).save(DIR / "icon-512.png")
    cuadro(pc, 512, 0.78, False).save(DIR / "icon-maskable-512.png")             # zona segura para Android
    cuadro(pc, 180, 0.88, False).convert("RGB").save(DIR / "apple-touch-icon.png")  # iPhone redondea solo
    compartir(escudo).save(DIR / "compartir.png")
    print("íconos e imagen para compartir listos en", DIR)


if __name__ == "__main__":
    main()
