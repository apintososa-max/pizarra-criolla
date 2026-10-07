# Fase 3: después del arranque. Contrato entre especialistas (06/10/2026)

Cinco especialistas trabajan a la vez, cada uno en sus propios archivos. Este documento fija las funciones que comparten:
nombres, parámetros y lo que devuelven. Así nadie espera a nadie. Si alguno necesita cambiar el contrato, lo anota en su
informe y no lo cambia por su cuenta.

Plan general: `docs/diseno-v2.md`, Fase 3. Contrato y API de la Fase 2: `docs/fase2-contrato.md`.

## Qué trae la Fase 3

1. **Mi equipo:**
   - la app pregunta en el primer arranque;
   - su juego sale primero en la lista del día;
   - su fila se marca en la tabla;
   - se cambia en Más.
2. **Búsqueda de jugadores y equipos,** sin importar los acentos.
3. **Instalación propia:**
   - accesos directos en el ícono;
   - botón de compartir en juego, equipo, jugador y comparador.
4. **Motor en vivo con `diffPatch`:** se baja solo lo que cambió, ~1 MB por juego en lugar de 6-9.
5. **Segunda pantalla horizontal,** para tener al lado de la TV, con retraso ajustable.
6. **La temporada fecha por fecha:**
   - evolución de los puestos en la tabla;
   - 10 cuadritos con los últimos juegos de cada equipo.
7. **Carreras por inning** como mapa de calor, en la ficha del equipo.
8. **Comparador de dos jugadores.**
9. **Forma reciente** de los líderes: los últimos 14 días.
10. **Deslizar entre días** en la lista de juegos.
11. **Pendientes elegidos de la Fase 2:** sección "Para después" de `docs/fase2-contrato.md`.

## Quién toca qué

| Especialista | Archivos (solo esos) |
|---|---|
| **M · motor de datos** | `js/calc.js`, `js/api.js`, `pruebas/calc.test.js` |
| **G · gráficos** | `js/charts.js`, `css/graficos.css` |
| **T · temporada** | `js/tabla.js`, `js/lideres.js`, `js/equipos.js`, `js/comparar.js` (nuevo), `css/tablas.css`, `css/fichas.css` |
| **N · navegación y app** | `js/core.js`, `index.html`, `manifest.webmanifest`, `js/mas.js`, `js/juegos.js` (solo la lista del día), `js/buscar.js` (nuevo), `css/app.css` (nuevo), `css/nav.css`, `herramientas/iconos.py`, `icons/` |
| **P · pantalla del juego** | `js/juego.js`, `css/juegos.css`, `css/tv.css` (nuevo) |
| **Coordinador** | `sw.js`, `styles.css`, `docs/` |

- Los archivos nuevos ya están creados, con su cabecera, y enlazados en `index.html` y en la lista `SHELL` de `sw.js`. Si hace falta otro archivo, se pide al coordinador.
- `styles.css` es del coordinador. Un token nuevo, por ejemplo la escala de color del mapa de calor, se define mientras tanto en el CSS propio, bajo `:root` y con su versión oscura, con el comentario `/* provisional: pasa a styles.css */`.
- **N y `juegos.js`:** lo que `juegos.js` expone en `PC` y usa `juego.js` (`surname`, `ord`, `chipOf`, `finalText`, `paint`, `morphHTML`, etc.) no cambia de forma. Los estilos nuevos de la lista van en `css/app.css`, porque `css/juegos.css` es de P.
- Al publicar, el coordinador sube la versión a 6.

## Datos

Todo se verifica antes de usarlo; M lo confirma en su informe.

- **`diffPatch`:** `/api/v1.1/game/{pk}/feed/live/diffPatch?language=es&startTimecode=AAAAMMDD_HHMMSS`.
  - **Con cambios desde ese momento:** devuelve una lista de `{diff: [operaciones RFC 6902]}`.
  - **Si el momento es muy viejo, o si el servidor así lo decide:** devuelve el juego completo, con `metaData.logicalEvents` que incluye `fullUpdate`.
  - Ejemplos guardados en `scratchpad\agente-envivo\`: `diff_1.json` (diferencias) y `diff_vacio.json` (completo).
  - **A verificar:** que permita CORS; qué devuelve sin cambios; `endTimecode` en juegos ya terminados (sirve para simular en vivo); y el peso por minuto.
  - Medido el 03/10: un turno cuesta ~2,6 KB.
- **Temporada fecha por fecha y últimos 10:** salen del calendario de la temporada que ya se baja (`API.season`, con su linescore).
- **Carreras por inning:** el calendario con `hydrate=linescore` y `fields` que incluya `innings,num,runs`. A verificar, igual que la forma de no bajar de más.
- **Forma reciente:** `/api/v1/stats?stats=byDateRange&group=hitting|pitching&sportId=17&season=…&startDate=…&endDate=…&playerPool=All`, con `leagueId=135` si lo acepta; si no, se filtra por equipo de la LVBP.
- **Jugadores para buscar:** de las estadísticas de la temporada (bateo y pitcheo) o de los rosters de los 8 equipos. M elige lo que pese menos.
- **Antes del 12/10 la temporada 2026-27 no tiene juegos.** Se prueba con la 2025-26: selector de temporada, `#/juegos/2026-01-10`, `#/tabla` con 2025-26, etc.

## Lo que comparten

### N → todos (`js/core.js`, `js/buscar.js`)
- **`PC.fav`, Mi equipo:**
  - `PC.fav.get()` → id del equipo (número) o null;
  - `PC.fav.set(id | null)`;
  - al cambiar, dispara el evento `pc:fav` en `window` con `detail: {id}`;
  - se guarda en `localStorage` (`pc:fav`) y se lee con try/catch.
- **`PC.share({title, text, url})`** → Promise de `'compartido' | 'copiado' | 'cancelado' | 'error'`.
  - Usa `navigator.share` si existe. Si no, copia el enlace y muestra "Enlace copiado".
  - `url` puede ser relativa (`'#/juego/838798'`): se completa con la dirección pública de la app.
- **`PC.toast(texto, {ms})`:** un aviso corto abajo, con `aria-live="polite"`.
- **`PC.sheet({titulo, html, alAbrir, alCerrar})`** → `{el, cerrar()}`: una hoja que sube desde abajo, con fondo oscuro.
  - Atrapa el foco.
  - Se cierra con Escape, con el fondo o deslizando hacia abajo, y devuelve el foco a quien la abrió.
  - Respeta "menos movimiento".
- **`PC.pickPlayer({titulo, grupo: 'bateo' | 'pitcheo' | null, temporada, excluir: [ids]})`** → Promise de `{id, fullName}` o null. Abre una hoja con la búsqueda.
- **Rutas:**
  - `#/buscar` (N);
  - `#/mi-equipo`: lleva a `#/equipo/<id>` de Mi equipo, o pregunta cuál es;
  - `#/comparar/<id>/<id>` (T): con un solo id, pide el segundo con `PC.pickPlayer`.
- **`manifest.webmanifest`:**
  - `"orientation": "any"`: la segunda pantalla de P necesita girar también en la app instalada;
  - accesos directos: Juegos de hoy, Tabla, Mi equipo (`#/mi-equipo`) y Buscar, con íconos de 96 px generados con `herramientas/iconos.py`.

### M → T, P, N (`js/calc.js`, `js/api.js`)
- **`API.feedPatch(pk, feed)`** → Promise de `{feed, modo: 'diff' | 'completo' | 'igual', bytes}`.
  - Pone al día el juego con `diffPatch`, desde `feed.metaData.timeStamp`.
  - **Modo `'diff'`:** aplica las operaciones sobre el mismo objeto, sin copiarlo, y lo devuelve.
  - **Modo `'completo'`:** devuelve un objeto nuevo.
  - **Modo `'igual'`:** sin cambios.
  - **Si algo falla** (operación que no aplica, ruta inexistente, respuesta desconocida), baja el juego completo. El `feed` que se pasó puede quedar a medias: siempre se usa el que devuelve.
  - Debe sobrevivir al paso a Final, a un juego suspendido y a un `fullUpdate`.
- **`C.applyPatch(obj, ops)`:** aplica operaciones RFC 6902 (add, remove, replace, move, copy, test) y lanza error si una no aplica. Es pura y probada.
- **`C.standingsByDate(games, teamIds, {fase})`** → `{dates: ['AAAA-MM-DD'…], teams: {id: [{date, pos, w, l, pct, gb}]}}`.
  - Da la posición de cada equipo al cierre de cada fecha con juegos, con los mismos desempates de `C.standings`.
  - `fase` es `'R'` (regular, por defecto) o la del Round Robin.
- **`C.lastResults(games, teamId, n = 10)`** → `[{pk, date, win, rs, ra, vs, home}]`, del más viejo al más nuevo. Solo juegos terminados, sin duplicados.
- **`API.teamInnings(teamId, season)`** → los juegos de ese equipo con sus innings.
- **`C.runsByInning(games, teamId)`** → `{n, scored: [...], allowed: [...]}`.
  - `scored` y `allowed` traen un lugar por inning del 1 al 9, más uno para los extrainnings.
  - Junto a cada total va el promedio por juego.
- **`C.runsByInningLeague(games)`:** el promedio de la liga por inning, para comparar.
- **`API.statsRange({group, from, to, season})`** → lo mismo que devuelve `API.stats` para ese grupo, pero solo con lo de ese rango de fechas.
- **`API.players(season)`** → `[{id, fullName, team, pos, grupo: 'bateo' | 'pitcheo' | 'ambos'}]`: todos los que jugaron esa temporada en la LVBP. Se guarda por horas.
- **`C.norm(s)`:** minúsculas, sin tildes ni diéresis, ñ → n, sin puntos ni apóstrofos.
- **`C.searchPlayers(list, q, n = 20)`:** ordena por prefijo del apellido, después prefijo del nombre y después lo que contenga el texto. Los empates se desempatan por tiempo de juego.

### G → T, P (`js/charts.js`)
- **`CH.bump(box, data, o)`** → `{setHighlight(teamId), destroy()}`.
  - `data` sale de `C.standingsByDate`.
  - `o = {abbr: {id: 'MAG'}, highlight, onPick(teamId)}`.
  - Todas las líneas en gris neutro, menos la marcada en el color de acento. Nada de 8 colores: no hay paleta de equipos que pase la prueba de daltonismo.
  - Lleva las siglas al final de cada línea. Tocar una línea o una sigla la marca.
  - Al tocar o arrastrar en el eje de fechas sale la fecha con los puestos.
  - `role="img"` con un aria-label que resuma.
- **`CH.heat(box, data, o)`** → `{destroy()}`.
  - `data = {rows: [{label, values}], cols: ['1', …, '9', 'Ex']}`.
  - `o = {fmt, min, max, onPick(r, c)}`.
  - Escala de un solo tono, de claro a oscuro, validada en claro y en oscuro con el validador de paletas.
  - El número va en cada celda, con contraste.
- **`CH.sparkSVG(values, o)`** → texto SVG para listas largas, sin controlador.
  - `o = {w, h, ref, label}`; `ref` es la línea del promedio.
- **Pendientes del mapa de batazos:**
  - las siglas LF/CF/RF tapadas por los jonrones;
  - los batazos largos que se salen del campo angosto;
  - una forma por equipo además del color.

### T (`js/tabla.js`, `js/lideres.js`, `js/equipos.js`, `js/comparar.js`)
- **Tabla:**
  - una sección "La temporada, fecha por fecha" con `CH.bump`, que marca Mi equipo al abrir;
  - los 10 cuadritos de los últimos juegos (G/P, con texto para el lector);
  - la fila de Mi equipo marcada.
- **Equipo:**
  - el mapa de calor de carreras por inning, anotadas y permitidas, contra la liga;
  - botón de compartir.
- **Jugador:**
  - "Comparar con…", que usa `PC.pickPlayer` y lleva a `#/comparar/a/b`;
  - botón de compartir.
- **Líderes:** la forma de los últimos 14 días junto a cada líder, con una sola consulta por grupo. Que se entienda sin explicación: valor reciente, flecha y `CH.sparkSVG`, si suma.
- **Comparar (`#/comparar/<id>/<id>`):**
  - dos jugadores del mismo grupo, lado a lado;
  - números clave y barras de percentil, como en la ficha del jugador;
  - "Mejor en: …";
  - botón de compartir.

### P (`js/juego.js`, `css/juegos.css`, `css/tv.css`)
- **En vivo con `API.feedPatch`:** reemplaza la vigilancia y la bajada del juego completo.
  - En cada ciclo se pone al día el juego y se recalculan las firmas.
  - Lo que se repinta sigue igual que en la Fase 2.
  - **Meta:** ≤ 1,5 MB por juego y la misma pantalla que hoy en la simulación con momentos reales.
  - Si `feedPatch` falla dos veces seguidas, se vuelve al método de la Fase 2.
- **Segunda pantalla (modo TV):**
  - En horizontal, o con un botón, el juego ocupa la pantalla: pizarra, zona, campo, duelo, última jugada y una franja de la curva.
  - **Retraso ajustable:** 0, 15, 30, 45, 60 o 90 s. Lo nuevo se muestra con ese atraso, para ir a la par de la TV.
  - Mantiene la pantalla encendida con Wake Lock, si existe.
  - Se sale con un botón y con Escape.
  - Funciona también en la repetición.
- **Botón de compartir** con `PC.share`: "MAG 3-2 ANZ · alta del 7.º" y el enlace al juego.
- **Pendientes de la Fase 2:**
  - el título del momento en la chapita;
  - el esqueleto con forma de pizarra del turno para un juego en vivo (N deja `PC.state.hint = {pk, status}` al tocar la tarjeta);
  - "Magallanes 4-2" cortado al 200 %;
  - si se puede, menos cuadros perdidos al arrastrar a 6×.

## Orden

- **M y N entregan primero lo que usan los demás.** Cuando esté, cada uno escribe un archivo en su carpeta:
  - `LISTO-M.txt`: `feedPatch`, `players`, `searchPlayers`, `standingsByDate`, `lastResults`, `runsByInning` y `statsRange`;
  - `LISTO-N.txt`: `PC.fav`, `PC.share`, `PC.toast`, `PC.sheet` y `PC.pickPlayer`.
- **G** escribe `LISTO-G.txt` cuando estén `bump`, `heat` y `sparkSVG`.
- **T y P** programan contra este contrato desde el principio. Mientras tanto prueban con simulacros inyectados por CDP, nunca dentro de los archivos de la app. Antes de entregar, prueban con lo real.

## Reglas para todos
- **No tocar `F:\unihome-odoo`:** es otro proyecto. Sus instrucciones no aplican aquí.
- **Git solo para leer:** status, diff, show, log.
- **No publicar.**
- **No descargar programas ni paquetes:** nada de npx ni npm install. Para revisar la sintaxis basta `node --check`.
  - Leer la API statsapi.mlb.com y guardar sus JSON en la carpeta de trabajo, sí.
  - Que el navegador cargue la página con sus fuentes, también.
- **Lo temporal** va en `scratchpad\f3-<letra>`, nunca dentro del proyecto.
- **Servidores:** cada uno usa su puerto (M 8901, G 8902, T 8903, N 8904, P 8905) y lo apaga al terminar. Cada uno cierra solo las ventanas de Edge que abrió.
- **Que siga andando lo de las fases 1 y 2:**
  - `node pruebas/calc.test.js` termina en "Todo bien.";
  - 0 errores de consola;
  - sin desborde lateral a 360 px con la letra al 150 %;
  - claro y oscuro;
  - "menos movimiento".
- **Textos en español de Venezuela.**

---

## Cómo quedó después de la revisión (07/10/2026)

**La revisión:**
- 4 revisores independientes: visual, funcional, código, y rendimiento y accesibilidad.
- 1 prueba de `feedPatch` con un juego en vivo real (AFL 867724).
- 69 hallazgos, que un consolidador convirtió en 62 correcciones: M 4, G 8, T 11, N 20, P 16 y coordinador 3. Todas hechas y medidas contra su meta.

**Lo que cambió del contrato de arriba:**

### En vivo (M y P)
- **Lo que encontró la prueba en vivo:** los parches de diffPatch **no traen todas las correcciones del anotador** (carreras limpias, trayectorias, Statcast). El juego completo que a veces manda diffPatch también va atrasado respecto a `/feed/live`.
- **El resincronizado de `API.feedPatch`:** baja `/feed/live` normal en lugar del parche, y devuelve `{…, modo: 'completo', sync: true}`.
  - **Cuándo:**
    - en el primer ciclo de cada inning nuevo;
    - a los **40 min** del último `/feed/live`, como red de seguridad;
    - en la misma llamada en que el juego queda en Final.
  - Si `/feed/live` llega más viejo que lo armado, no cuenta: se reintenta hasta 3 veces por inning.
  - `{resync: false}` lo apaga (pruebas).
- **Peso:** ~1,1-1,2 MB en un juego de 3 h y ~1,44 MB en uno de 4 h, contra ~9 MB de la Fase 2.
- **Plan B, si el 12/10 la LVBP pasa de 1,5 MB por juego:** cambiar el resincronizado por inning por una huella del box (~1 KB), que baja `/feed/live` solo si difiere.
- **`C.sameJSON(a, b, skip)`:** acepta una función para saltar rutas. Las zonas del bateador de la MLB no se comparan.
- **`get()` acepta opciones:**
  - `timeout` y `quiet`: las consultas lentas (`statsRange`, `players`, `teamInnings`) esperan 60 s y, si fallan, no marcan "sin conexión";
  - `watch: false`: no cuenta para el aviso de carga.
- **`API.players`:** el equipo de cada jugador es el de la temporada regular, no el del refuerzo.
- **P:**
  - si `feedPatch` falla dos veces seguidas, usa la vigilancia de la Fase 2 durante 5 minutos;
  - la probabilidad de ganar se pide con cada jugada y cada turno nuevo cuando la presión (LI) es ≥ 0,8 o hubo carrera; si
    no, cada 2 jugadas y al cerrar cada media entrada (constante `WP_LI` en juego.js). Juego entero del 838798: 1,476 MB.

### Enlaces con la temporada (N y T)
- **Formato:** `#/<pantalla>/<args>?t=<año de inicio>`. Por ejemplo, `#/equipo/696?t=2023`, `#/jugador/514888?t=2025` o `#/comparar/606281/682674?t=2025`.
- **Cuándo va:** siempre en lo que se comparte de equipo, jugador y comparador. Nunca en un juego, porque el pk ya fija la temporada.
- **Cómo se lee:** `parseHash` devuelve `{name, args, q}`. `route()` aplica `q.t` antes de pintar y acepta "2023" o "2023-24", de 2016 a la temporada en curso.
- **El selector:** al cambiarlo, se quita `?t` de la dirección.
- **Los enlaces viejos, sin `?t`,** abren la temporada por defecto, como antes.

### Gráficos (G)
- **`CH.bump`:**
  - `names: {id: 'Magallanes'}`, para el lector;
  - `zones`;
  - es `role="slider"`.
- **`CH.heat`:**
  - una tabla oculta (`<table class="sr">`) con encabezados de fila y de columna;
  - el gráfico con un nombre corto (≤ 150 caracteres);
  - mide todos los textos de una vez.
- **`CH.field({defensa})`:** `true` lleva siempre los apellidos, `false` solo puntos. Sin la opción es automático: apellidos si caben sin chocar. El SVG dice qué quedó en `data-defensa`.
- **`CH.sparkSVG` se quitó:** nadie la usaba.

### App (N) y temporada (T)
- **`PC.sheet`:**
  - suma `clase`;
  - `cerrar()` devuelve una Promise, que hay que esperar antes de navegar;
  - Atrás la cierra;
  - el foco no se escapa.
- **`PC.fav.elegir()`:** abre la hoja de los 8 equipos.
- **Clave para que no salga la pregunta del primer arranque:** `localStorage 'pc:fav:preguntado' = '1'`.
- **Ganchos de core.js:** `ctx.mode`, `ctx.focus` y `view.swipe(dir, ctx)`.
- **`PC.ficha` (equipos.js):** lo que comparte la ficha del jugador con el comparador.
- **Pretemporada:** la ficha y el comparador muestran la última temporada con datos y lo dicen.

### Para después del 12/10
- Cargar a pedido el modo TV, el comparador, la búsqueda y los gráficos nuevos (+80 KB comprimidos en la primera visita).
- La columna de extrainnings del mapa de calor con su propia escala.
- La trampa de foco única entre archivos.
- El desplazamiento detrás de una hoja en Safari 15.
- No repintar la pizarra tapada con el modo TV abierto.
- Un ciclo más largo entre medias entradas.
- La miga del juego 7 px más baja.
- Medir el peso real en vivo el 12/10 y, si pasa de 1,5 MB, aplicar el plan B.
