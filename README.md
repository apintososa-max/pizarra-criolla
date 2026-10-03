# Pizarra Criolla

App web para el teléfono con todo lo de la LVBP: juegos en vivo, tabla, líderes, equipos y jugadores,
con métricas avanzadas que se recalculan solas a medida que avanzan los juegos.

**En línea:** https://apintososa-max.github.io/pizarra-criolla/ — se abre en el teléfono y se instala desde el menú
del navegador ("Agregar a la pantalla principal" en Android, "Agregar a inicio" en iPhone).

## De dónde salen los datos

De la API pública de estadísticas de MLB (`statsapi.mlb.com`), que registra la LVBP jugada por jugada:
liga **135** dentro del deporte **17** (ligas invernales). Verificado el 02/10/2026:

- Calendario y resultados desde la temporada 2016-17. La 2026-27 ya está cargada: 224 juegos,
  del 12/10/2026 (Tiburones en casa de Magallanes) al 27/12/2026.
- Jugada por jugada en español (`language=es`), box score, pizarra por inning.
- Probabilidad de ganar y presión (LI) de cada turno.
- Estadísticas de temporada de todos los jugadores y equipos.
- La API permite leerla desde el navegador (CORS abierto), así que **no hace falta servidor propio**:
  el teléfono consulta la API y hace todos los cálculos.

Lo que la fuente **no** tiene para la LVBP: velocidad de lanzamientos y de salida de los batazos
(no hay Statcast en esos estadios; revisado en juegos de 3 estadios distintos) ni factores de estadio.

Los datos son de MLB Advanced Media. Sus términos permiten uso personal; para publicarla al público
o con fines comerciales habría que revisar la licencia.

## Qué calcula

| Sección | Cálculos |
|---|---|
| Juegos | Marcador en vivo cada 15 s; en el juego abierto, pizarra, cuenta, outs y corredores cada 12 s. |
| Juego | Curva de probabilidad de ganar, presión de cada turno, figuras del juego (WPA), jugadas clave, box score, jugada a jugada. Los juegos terminados se pueden **repetir jugada a jugada**. |
| Tabla | Calculada juego por juego desde el calendario: JJ, JG, JP, AVE, Dif, racha, últimos 10, casa/visitante, carreras, récord pitagórico, suerte, juegos de una carrera y de extrainnings, enfrentamientos directos. **Probabilidad de clasificar**: 10.000 simulaciones del calendario restante con el formato real (4 directos + comodín 5.º vs 6.º). Round Robin, comodín y final. |
| Líderes | AVE, OBP, SLG, OPS, wOBA, wRC+, OPS+, ISO, BABIP, BB%, K% · EFE, FIP, WHIP, K%, BB%, K-BB%, EFE+, K/9, BB/9, HR/9, LOB%. Calificados con la regla de la LVBP (2,7 PA y 0,8 IL por juego del equipo). |
| Equipos | Números de ofensiva y pitcheo con su puesto entre los 8, diferencia de carreras acumulada, récords parciales, roster con métricas, calendario. |
| Jugador | Línea completa, percentiles contra los calificados de la liga, juego a juego con promedio acumulado, carrera en la LVBP. |

wOBA y wRC+ usan pesos lineales de referencia re-escalados cada temporada para que el wOBA de la
liga sea igual a su OBP. FIP usa la constante de la LVBP de esa temporada. Nada se ajusta por estadio.

## Archivos

```
index.html            la página
styles.css            diseño (claro y oscuro)
js/calc.js            todos los cálculos (funciones puras, se prueban con Node)
js/api.js             lectura de la API con caché
js/charts.js          gráficos SVG
js/core.js            rutas, formato, hora de Caracas, refresco automático
js/juegos.js          juegos del día y pantalla de cada juego
js/tabla.js           posiciones, probabilidades, postemporada
js/lideres.js         líderes
js/equipos.js         equipos y jugadores
js/mas.js             glosario, formato del torneo, instalación
sw.js                 modo sin señal
manifest.webmanifest  instalación como app
icons/                íconos (se regeneran con python herramientas/iconos.py)
pruebas/calc.test.js  compara los cálculos con los números oficiales
```

## Probar en la computadora

```
python -m http.server 8795 --directory F:/pizarra-criolla
```

y abrir `http://localhost:8795`.

## Pruebas

```
node pruebas/calc.test.js
```

Compara contra la API:
- la tabla calculada de cinco temporadas (2016-17 y 2022-23 a 2025-26), incluidos los juegos suspendidos que se terminaron otro día y los juegos de desempate;
- los récords parciales;
- AVE/OBP/SLG y EFE/WHIP de todos los jugadores;
- la pizarra reconstruida jugada a jugada;
- un juego acortado por lluvia;
- la suma de las probabilidades de la simulación.

También prueba sin red los estados de juego (calentamiento, demora, suspendido, pospuesto, acortado, empate) y los textos en español (decisiones, posiciones, nombres de las jugadas).

## Publicarla para usarla en el teléfono

Es una página estática: sirve cualquier hosting con HTTPS. Con GitHub Pages:

1. Crear un repositorio (por ejemplo `pizarra-criolla`) y subir esta carpeta.
2. En el repositorio: Settings → Pages → Deploy from a branch → `main` / raíz.
3. Abrir `https://<usuario>.github.io/pizarra-criolla/` en el teléfono y elegir
   "Agregar a la pantalla principal" (Android) o "Agregar a inicio" (iPhone).

La dirección queda pública aunque nadie la conozca. Si se quiere privada hace falta otro hosting
con contraseña (por ejemplo Cloudflare Pages con Access).

## Ideas para después

- Avisos al teléfono (jonrón de tu equipo, juego cerrado en el noveno): requiere un servidor pequeño
  que vigile los juegos, porque el navegador no puede avisar con la app cerrada.
- Colores de cada equipo (pendiente confirmarlos).
- Rendimiento contra zurdos y derechos, con corredores en posición, por inning: sale del jugada por jugada.
- Factores de estadio calculados con dos o tres temporadas de datos.
