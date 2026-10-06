# Fase 2: el juego como transmisión. Contrato entre especialistas (05/10/2026)

Tres especialistas trabajan a la vez en archivos distintos. Este documento fija los nombres de las funciones, sus
parámetros y lo que devuelven. Así cada uno programa contra lo acordado sin esperar a los demás. Si alguno necesita
cambiar el contrato, lo anota en su informe y no lo cambia por su cuenta.

Plan general: `docs/diseno-v2.md`, Fase 2 (puntos 11 a 17).

## Quién toca qué

| Especialista | Archivos (solo esos) |
|---|---|
| **M · motor de datos** | `js/calc.js`, `js/api.js`, `pruebas/calc.test.js` |
| **G · gráficos** | `js/charts.js`, `css/graficos.css` |
| **P · pantalla del juego** | `js/juegos.js` (lista del día), `js/juego.js` (pantalla del juego, nuevo), `css/juegos.css` |

- Nadie toca `index.html`, `sw.js`, `styles.css` ni `js/core.js`: los cambios que hagan falta ahí se anotan en el informe y los hace el coordinador. `css/graficos.css` y `js/juego.js` ya están creados y enlazados.
- P puede mudar la vista `juego` de `juegos.js` a `juego.js`. Los ayudantes que compartan las dos (por ejemplo `pill`, `finalText`, `surname`) se exponen en `PC`.

## Datos verificados (revisión del 03/10 sobre 6 juegos y 5 estadios)

- **Lanzamientos:** el 100 % trae `pitchData.coordinates {x, y}` y `pitchData.strikeZoneTop/strikeZoneBottom`. No hay velocidad, tipo de lanzamiento, `pX/pZ` ni `zone`.
  - La imagen corresponde a la cámara del center: los bateadores derechos quedan a la derecha. No hay que voltearla.
  - Una caja fija x 84–132, y 120–176 separa strike cantado de bola en el 96–100 % de los casos de cada juego.
  - En Puerto La Cruz y Maracay, el lanzamiento puesto en juego cae casi siempre en el centro (desviación de unos 3 px, contra 7–13 en los otros estadios). Ahí no se dibuja.
- **Batazos:** el 100 % trae `hitData.coordinates {coordX, coordY}`, `hitData.location` y `hitData.trajectory`.
  - Home queda en ≈ (125,4; 198,3) y 1 unidad equivale a ≈ 2,5 pies; los jonrones caen entre 360 y 445 pies.
  - `hardness` no sirve (casi siempre "medium") y no hay medidas de las cercas.
- **Defensa:** `liveData.linescore.defense` trae `pitcher, catcher, first, second, third, shortstop, left, center, right` con `{id, fullName}`. `offense` trae `batter, onDeck, inHole, first, second, third`. `matchup.batSide.code` es 'L' o 'R', y da el lado real del ambidiestro en cada turno.
- **Probabilidad de ganar:** viene por turno, no por lanzamiento.
- **Momentos de la API:** cada lanzamiento genera un momento (574 en el 838798); `metaData.wait` = 10 s. Hay `feed/live/timestamps` y `feed/live?timecode=AAAAMMDD_HHMMSS` para pedir el juego tal como estaba en un momento. Sirve para probar lo en vivo con juegos reales ya terminados.
- **Historial bateador contra lanzador:** `/api/v1/people/{id}/stats?stats=vsPlayer&opposingPlayerId={id}&sportId=17&group=hitting` (~0,7 KB). Las muestras son chicas: decirlo.

## Índices

- `done`: las jugadas completas del juego (`feed.liveData.plays.allPlays` con `about.isComplete`), en orden. Es el mismo arreglo de hoy (`d.done`).
- `k`: índice de una jugada dentro de `done`. Es el mismo que usan hoy `C.stateAt(done, k)` y `d.cursor`.
- `p`: índice de un lanzamiento dentro de `C.pitchSeq(done[k])`.
  - `p = -1`: antes del primer lanzamiento del turno.

## M · `js/calc.js` (funciones puras, sin red ni DOM, probadas con Node)

```
C.pitchSeq(play) → [{ p, code, call, label, balls, strikes, x, y, szTop, szBot, last }]
```
- **call:** 'bola' | 'cantado' | 'tirandole' | 'foul' | 'enjuego' | 'golpeado' | 'otro'.
- **label:** texto corto en español: "Bola", "Strike cantado", "Strike tirándole", "Foul", "En juego", "Golpeado", "Bola mala automática".
- **balls/strikes:** la cuenta después de ese lanzamiento.
- **x, y:** `pitchData.coordinates`, o null.
- **last:** true en el último.
- Solo cuenta eventos con `isPitch`.
- Debe funcionar con la jugada completa del feed y también con la versión recortada que trae la vigilancia (ver api.js).

```
C.zoneBox(done) → { x0, x1, y0, y1, fromGame, inPlayUnreliable }
```
- Caja de strike estimada con los strikes cantados del juego (por percentiles).
- Respaldo fijo `{x0:84, x1:132, y0:120, y1:176}` si hay menos de 12 strikes cantados.
- `inPlayUnreliable`: true si los lanzamientos puestos en juego vienen "centrados" (desviación < 5 px).

```
C.stateAtPitch(done, k, p) → lo mismo que C.stateAt(done, k) + { balls, strikes, k, p }
```
- Es el estado después del lanzamiento p del turno k: cuenta, outs, corredores y carreras a mitad de turno si hubo robos, wild pitch, balk o pickoff en ese tramo. Usar `runners[].details.playIndex` y `playEvents[].index`.
- `p = -1`: estado antes del primer lanzamiento.
- Último p: igual que `C.stateAt(done, k)`.
- Los corredores salen como `bases: [b1, b2, b3]`, con `{id, fullName}` o null. Lo mismo en `C.stateAt`, conservando la compatibilidad: `!!bases[i]` sigue diciendo si hay corredor.

```
C.defenseAt(feed, k) → { pitcher, catcher, first, second, third, shortstop, left, center, right }
```
- Cada posición con `{id, fullName}`, para el equipo que fildea en la jugada k.
- Se calcula con los titulares del boxscore (`battingOrder` terminado en 00 y su primera posición en `allPositions`), el abridor (primero de `pitchers`) y las acciones `defensive_substitution`, `defensive_switch` y `pitching_substitution` hasta k.
- Si falla, devolver lo que se sepa y nunca lanzar error.

```
C.wpMarks(done) → { hr: [k], changes: [{ k, side }], halves: [{ k, inning, top, runs }] }
```
- **hr:** las jugadas con `eventType === 'home_run'`.
- **changes:** los cambios de lanzador (acción `pitching_substitution`) en la jugada en que ocurren. `side` es el equipo que cambió: 'away' o 'home'.
- **halves:** la primera jugada de cada media entrada y las carreras que anotó ahí el equipo al bate.

```
C.sprayPoints(done) → [{ k, side, x, y, traj, event, hit, hr, out, error, batter: {id, fullName}, inning, top, desc }]
```
- **side:** el equipo al bate.
- **x, y:** `hitData.coordinates` en unidades de la API.
- Solo batazos con coordenadas.

```
C.moments(done, fromK, toK, ls) → [{ type, side, k, title, text }]
```
- Cubre de fromK (sin incluir) a toK (incluida), en orden. fromK puede ser -1.
- **type:** 'carrera' | 'jonron' | 'cambio' | 'fin' | 'nohit'.
- **title:** "CARRERA · MAG 4-3", "JONRÓN · MAG 5-3", "CAMBIO DE LANZADOR", "FIN DEL 5.º".
- **text:** una línea en español. Ejemplo: "Marcano, doble al right; anota Tovar".
- **'fin':** usa `ls` (linescore) para las carreras, hits, errores y dejados en base de esa media entrada, si están.
- **'nohit':** equipo sin hits del 6.º en adelante; una vez por inning.

Pruebas nuevas en `pruebas/calc.test.js` con 838798, 829812 y 829756:
- las carreras de `halves` suman las finales;
- `stateAtPitch` del último lanzamiento es igual a `stateAt`;
- la cuenta final de `pitchSeq` coincide con `play.count`;
- la cantidad de `sprayPoints` es igual a la de batazos con coordenadas;
- `moments` del juego completo trae todos los jonrones y cambios de lanzador;
- `defenseAt` de la última jugada coincide con `linescore.defense` del final.

## M · `js/api.js`

- **WATCH_FIELDS:** sumar lo necesario para ver cada lanzamiento en vivo sin bajar el juego completo:
  - de `liveData.plays.currentPlay`: `about`, `count`, `matchup.batter/pitcher/batSide/pitchHand`, y `playEvents` con `isPitch`, `index`, `details.code`, `details.description`, `pitchData.coordinates.x/y`, `strikeZoneTop/Bottom` y `count`;
  - de `linescore`: `defense` completa y `offense.onDeck/inHole`.
- Medir el peso (se esperan ~1,1 KB comprimidos).
- Mantener los nombres de las funciones.

## G · `js/charts.js` + `css/graficos.css` (dibujan con lo que reciben; no piden datos)

```
CH.winProb(box, plays, o) → controlador { setCursor(i), destroy() }
```
Mantiene todo lo de hoy y suma:
- **o.marks** (salida de `C.wpMarks`):
  - "HR" sobre cada jonrón;
  - una marquita por cada cambio de lanzador, del color del equipo que cambió;
  - fichas con las carreras de cada media entrada (solo si son más de 0), en una franja propia;
  - etiqueta en las 2 jugadas que más movieron la curva.
- **Color de la línea:** dorado por los tramos en que va arriba el visitante, azul cuando va arriba el home club. Lo que queda después del cursor, tenue.
- **o.animate:** al abrir, la curva se dibuja de izquierda a derecha (~600 ms). Sin animación con prefers-reduced-motion.
- **o.onPick(i):** se llama al arrastrar o tocar, limitado con requestAnimationFrame. **o.onRelease(i):** al soltar.
- **setCursor(i):** mueve la cruz y el tramo tenue SIN redibujar el SVG.
- **Barras de presión (LI):** contraste de 3:1 o más en modo claro.

```
CH.spray(box, points, o) → controlador { setHighlight(k), destroy() }
```
- Campo genérico: líneas de foul, cuadro y arco de jardines a ~330–400 pies, en la escala de la API.
- **o.side:** 'away' | 'home' | null, para filtrar. **o.away/o.home:** las siglas.
- **Puntos:** relleno = hit, hueco = out o error, más grande = jonrón, del color del equipo.
- **o.highlight:** un aro en ese batazo. **o.onPick(k):** al tocar un punto; el área táctil toma el punto más cercano y mide al menos 24 px.
- Leyenda con texto.

```
CH.zone(box, pitches, o) → controlador { update(pitches, o), destroy() }
```
- La zona de strike vista desde el center, como en la TV. **o.box:** la salida de `C.zoneBox`.
- **Lanzamientos** (de `C.pitchSeq`), numerados:
  - bola: círculo vacío;
  - strike cantado: relleno rojo;
  - tirándole: rojo con anillo;
  - foul: amarillo;
  - en juego: rombo blanco (oculto si `o.box.inPlayUnreliable`);
  - el último lleva un aro.
- **o.batSide:** 'L' o 'R'; marca el lado del bateador con su rótulo.
- **Debajo:** la secuencia en letras (B, C, S, F, X) y la cuenta.
- **update:** repinta sin recrear el SVG, para cada lanzamiento en vivo.

```
CH.field(box, s, o) → controlador { update(s), destroy() }
```
- El campo en tiza.
- **s.defense:** salida de `C.defenseAt` o `linescore.defense`. Va el apellido en cada posición.
- **s.bases:** `[b1, b2, b3]`, con `{id, fullName}` o null. Los corredores van en amarillo con su apellido.
- **s.batter / s.batSide:** el bateador del lado en que batea.
- **s.lastHit:** `{x, y, traj}` o null; dibuja el recorrido del último batazo.
- **Menos de 420 px de ancho:** solo el cuadro interior y los corredores. La defensa aparece al tocar.
- **update:** cambia posiciones y nombres sin recrear el SVG.

**Para las cuatro funciones:**
- SVG hecho a mano, sin librerías.
- Colores de los tokens de CSS (claro y oscuro) y letra con los tokens `--fs-*`.
- `role="img"` con un `aria-label` que resuma lo que se ve.
- Animar solo transform y opacity.
- `destroy()` quita los listeners y observadores.

## P · `js/juego.js` + `js/juegos.js` + `css/juegos.css`

Pantalla del juego reorganizada:

1. **La pizarra con "el turno arriba"** (en vivo y en la repetición):
   - el marcador en una línea grande;
   - la cuenta grande, con bombillos más grandes;
   - `CH.field` con corredores, defensa y bateador;
   - el duelo con contexto;
   - `CH.zone` del turno, con su secuencia;
   - el marcador por inning debajo.

   En los juegos terminados, sin repetición, la pizarra queda como hoy.
2. **Pestañas justo debajo de la pizarra:** Previa (solo antes del juego) · Resumen · Box · Jugadas · Datos, con un indicador que se desliza. Resumen agrupa:
   - la probabilidad de ganar con marcas;
   - el mapa de batazos con filtro por equipo;
   - las figuras;
   - las jugadas clave.
3. **La curva que manda:**
   - Al arrastrar, la pizarra se mueve a ese momento: `setCursor` y la pizarra con requestAnimationFrame, y nada más.
   - Al soltar se repintan las figuras, las jugadas clave, el aro del mapa y el jugada a jugada.
   - Tocar un punto del mapa o una jugada clave lleva a ese momento.
4. **Momentos:**
   - Una banda amarilla de 8 s dentro de la pizarra, una a la vez y en cola, con `aria-live`.
   - **Pizarra viva:** las carreras ruedan, la celda del inning se prende, los bombillos tienen halo y la base a la que llega un corredor destella. En un jonrón, las 8 estrellas se prenden de izquierda a derecha con la etiqueta "JONRÓN".
   - Referencias: `scratchpad\agente-movimiento\movimiento.css` y la función `pintar()` de `maqueta.js`.
   - Sin animaciones con reduced-motion.
   - En la repetición, los momentos salen a medida que el cursor pasa por ellos.
5. **Repetición lanzamiento a lanzamiento:**
   - el deslizador avanza por lanzamiento con `C.stateAtPitch`;
   - velocidades 1×, 2× y 4×;
   - pausa de 1,8 s en las 5 jugadas clave y en los jonrones;
   - la zona, el campo y la cuenta muestran ese momento.
6. **En vivo, por lanzamiento:**
   - La vigilancia ya trae el turno en curso (WATCH_FIELDS de M).
   - La firma del momento incluye la cuenta y la cantidad de lanzamientos del turno, para repintar la zona y los bombillos con cada lanzamiento.
   - El juego completo se sigue bajando solo cuando cambia el turno, como hoy.
7. **Duelo con contexto:**
   - "hoy 1-2: doble, elevadito";
   - lanzamientos y strikes del pitcher, y en qué inning entró;
   - el que viene en cubierta;
   - "presión ×1,9", con el LI del turno si está;
   - a un toque, el historial entre los dos con `vsPlayer` (decir que la muestra es chica).
8. **Jugada a jugada:** tocar un turno abre su zona y su secuencia.

Además:
- **Que siga andando lo de la Fase 1:** la chapita fija, el refresco por piezas, los estados especiales, los juegos de otras ligas, el historial y la posición al volver.
- **Esqueleto:** si cambia la pizarra, registrar un esqueleto `juego` propio en `U.skeletons` desde `juego.js`, para que coincida.
- **Pruebas en vivo con momentos reales:** usar `feed/live?timecode=` del 838798 (por ejemplo unos 20 momentos alrededor de una carrera y de un cambio de lanzador). Sobrescribir en la página `PC.api.watch` y `PC.api.feed` para que devuelvan esos momentos en orden.

## Referencias visuales

En `C:\Users\Administrador\AppData\Local\Temp\claude\F--unihome-odoo\135b608e-e77a-4cfb-afec-e852a8cabfc7\scratchpad\`:
- `agente-envivo\maqueta_turno.html` (`?v=turno|momento|tv`, `&w=360`), con capturas `maqueta_turno_claro.png` y `maqueta_momento_oscuro.png`.
- `agente-graficos\maqueta-juego.html` (abrir con `#k=31`), con capturas `maqueta-claro.png` y `maqueta-oscuro.png`. Los scripts de datos están en `agente-graficos\datos\`.
- `agente-movimiento\` (`maqueta.html?escena=jonron|bombillo|curva|mini`, `movimiento.css`, `maqueta.js`).

---

## Cómo quedó después de la revisión (05/10/2026)

Cuatro revisores independientes (visual, funcional, código, rendimiento y accesibilidad) encontraron 92 hallazgos. Un
consolidador los verificó y los convirtió en 36 correcciones: M 5, G 6, P 19 y coordinador 6. Todas están hechas y
medidas contra su meta. Lo que cambió del contrato de arriba:

### Decisiones de diseño
- **A1 · Pizarra compacta:** ≤ 560 px a 412×860 (antes ~820), ≤ 580 a 360, ≤ 820 a 360 con la letra al 150 %.
  - La cuenta va solo en los bombillos B-S-O, en la fila del marcador; ya no hay número grande. La chapita conserva la cuenta en número.
  - Campo y zona van en una fila; el duelo en 3 líneas; las fichas en una fila; la última jugada en 2 líneas.
  - "Presión" solo sale con LI ≥ 1,0 y se escribe con punto (×1.8), como la EFE.
- **A2 · La curva que manda:** mientras se arrastra, manda la chapita de dos líneas: marcador, inning, bases, outs y cuenta, y debajo la jugada.
  - En cada cuadro solo cambian la chapita, el cursor y los % grandes. La pizarra grande se pinta al soltar.
  - Tocar una jugada clave o un batazo no mueve la página: la chapita destella.
- **A3 · Banda de momentos:** va sobre la franja de comentario (fichas y última jugada), nunca sobre el marcador.
  - Cola de 2 como máximo; las que esperan duran 4 s.
- **A4 · Cambio de lanzador en vivo:** el lanzador entra en la firma del turno, así que se baja el juego completo.
  - Antes, 17 de 41 bandas de cambio salían tarde; ahora 0.
  - Cuesta ~3,5 % más de datos (≤ 40 KB/min). El peso de verdad se ataca con `diffPatch` en la Fase 3.
- **A5 · Lector de pantalla en la repetición:**
  - a 2× y 4×, ningún momento;
  - a 1×, solo carreras, jonrones y "sin hits";
  - al pausar, una línea con el estado.

### API final de M (`js/calc.js`, `js/api.js`)
- **`C.pitchSeq(play)[i]`** suma tres campos:
  - `auto` y `index`: incluye las bolas y strikes automáticos (V, VB, VC…), con `auto: true` y sin `x`/`y`;
  - `pitcherId` y `batterId`: el id si cambió dentro del turno, o null para "el que empezó el turno".
- **`C.stateAtPitch(done, k, p)`:** el tramo del lanzamiento p llega hasta antes del p+1, porque la API anota robos, wild pitch y balk después del lanzamiento en que pasan. Devuelve además `pitcher`, `batter` (`{id, fullName}`) y `lim`.
- **`C.defenseAt(feed, k, lim)`:** con `lim`, de la jugada k solo cuentan los cambios anteriores a ese índice de evento.
- **`C.moments(done, fromK, toK, ls, {away, home})`:**
  - los 'cambio' traen `ix`;
  - "MITAD DEL 5.º" al terminar la alta y "FIN DEL 5.º" al terminar la baja;
  - "2 CARRERAS · MAG 6-3";
  - la carrera por error va aparte: "anota X por error del inicialista".
- **`C.zoneBox`:** percentiles 5–95 más 10 px, mezclados con la caja fija con peso n/(n+40). `inPlayUnreliable` se calcula por juego, no por estadio.
- **Nuevas:**
  - `C.pitchIndex(done)` → `{steps: [{k, p}], first}`;
  - `C.pitchDataOk(done)`: false en los juegos sin lanzamiento a lanzamiento (2010-2014);
  - `C.surname`;
  - `C.vsLine(r, {antes, tipo})`.
- **`API.vsPlayer(b, p, {antes, tipos})`** → `{pa, ab, h, d, t, hr, bb, so, avg, ops}` o null.
  - En la repetición usa `antes` = temporada del juego: nunca muestra datos del futuro.
  - En postemporada usa `tipos: 'R,F,D,L,W'`.
- **Vigilancia** (`WATCH_FIELDS`, `language=es`): el turno en curso con sus lanzamientos (`eventType`, `player` y `position` incluidos), `linescore.defense` y `offense.onDeck/inHole`. Pesa ~0,96 KB comprimidos.

### API final de G (`js/charts.js`)
- **`CH.responsive(box, draw)`:** devuelve el controlador de `draw()`, que sigue sirviendo después de redibujar.
- **`CH.winProb(box, plays, {away, home, total, cursor, marks, labelOf, animate, onPick, onRelease})`** → `{setCursor, destroy}`.
  - Con `onPick` u `onRelease` es `role="slider"`, con `aria-valuetext`.
  - Teclado: flechas, Inicio/Fin y Re Pág/Av Pág.
  - Las barras LI van en gris (`--g-li`) por contraste.
- **`CH.spray(box, points, {side, away, home, highlight, dimAfter, legend, onPick})`** → `{setHighlight, destroy}`.
  - Es `role="listbox"`, con una opción por batazo.
- **`CH.zone(box, pitches, {box, batSide, seqBox, count, legend})`** → `{update, destroy}`.
  - El foul es un cuadrito amarillo y el golpeado un cuadrito punteado.
  - El strike va en `--flag-r`.
  - Ningún lanzamiento tapa el carril del bateador ni el plato.
- **`CH.field(box, s, {narrow})`** → `{update, destroy}`.
  - "Ver defensa" es un `<button class="gf-btn" aria-expanded>`. La caja lleva `gf-abierto` mientras la defensa está abierta.
  - Si las fichas no caben, los corredores van en `.gf-lista`.

### Pantalla (P: `js/juego.js`)
- **En vivo hay dos firmas:**
  - **la del turno:** estado, inning, outs, carreras, bateador, lanzador, `atBatIndex` e `isComplete`. Si cambia, se baja el juego completo;
  - **la del lanzamiento:** cuenta, lanzamientos y corredores. Si solo cambia esta, se repinta la pizarra con la vigilancia.
- Un juego completo más viejo que el que ya está no se pinta.
- **Repetición:** va por lanzamiento con `C.stateAtPitch`. Con `C.pitchDataOk` en false, va por jugada.

### Para después (no bloquean)
- **Mapa de batazos:**
  - los rótulos LF/CF/RF tapados por jonrones;
  - los batazos largos que se salen del campo angosto;
  - una forma por equipo además del color.
- **Pantalla:**
  - el título del momento en la chapita;
  - un esqueleto con forma de pizarra del turno para los juegos en vivo;
  - "Hoy 1-4" (H-VB) o "4-1": es una decisión de toda la app.
- **Navegación:** adelante en el historial restaura el desplazamiento de otra pestaña.
- **Código:**
  - ayudantes repetidos entre archivos (`surname`, `reduced`, `ACTIONS`);
  - cargar `juego.js` y los gráficos solo al entrar a un juego;
  - la pizarra de siempre al 200 % ("Magallanes 4-2" cortado).
