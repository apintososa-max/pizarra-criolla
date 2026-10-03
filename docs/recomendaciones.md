# Recomendaciones de 5 especialistas (02/10/2026)

Revisaron el código de la app y comprobaron cada dato con llamadas reales a la API de MLB:

1. Analista sabermétrico.
2. Anotador oficial.
3. Experto en la LVBP.
4. Ingeniero de datos en vivo.
5. Diseñador de producto deportivo.

Aquí está lo que coincidieron y lo más importante de cada uno, ordenado por prioridad.

---

## Estado al 02/10/2026 (tarde)

Corregidos y probados: los 15 errores de la sección A y los menores.
- `node pruebas/calc.test.js` pasa completo. La tabla queda igual a la oficial en 2016-17, 2022-23, 2023-24, 2024-25 y 2025-26; antes fallaban 2016-17 y 2023-24. También pasan los 11 estados de juego y los textos en español.
- En pantalla quedaron revisados:
  - juego acortado por lluvia (829938);
  - doble cartelera a 7 innings con extrainning (5/12/2025);
  - juego suspendido y reanudado (31/10 y 1/11/2023);
  - postemporada de 2016-17 con su formato;
  - juego de desempate de 2023-24;
  - corredor colocado en extrainnings (829756);
  - percentiles de un relevista;
  - vigilancia en vivo simulada.

De la sección B quedó hecho:
- vigilancia mínima del juego en vivo (0,6 KB);
- tiempo límite y espera creciente si falla la red;
- copia sin señal que se marca como vieja;
- límite de memoria;
- simulación de la tabla que solo se repite cuando termina un juego.

Falta de la sección B:
- recortar el juego completo con `fields=`;
- modo ahorro con contador de datos;
- aviso de "versión nueva";
- repintar solo lo que cambia;
- simulador con los momentos guardados de un juego real.

## A. Errores a corregir antes de publicar (todos chicos)

| # | Error | Ejemplo real | Arreglo |
|---|---|---|---|
| 1 | **Juegos contados dos veces.** Un juego suspendido y reanudado otro día aparece dos veces como "Final" con ganador. Lo encontraron 3 de los 5 especialistas y está confirmado | 2016-17: la app pone Bravos 30-34 y Tiburones 31-33; los dos fueron 30-33. 2023-24: pone Caribes 21-36; fue 21-35 | Una sola aparición por juego (`gamePk`) en `C.flatSchedule`. Quitar también los juegos de relleno "To Be Determined" (equipo 56) de 2022-23 |
| 2 | **Juego trabado en "En vivo".** Si suspenden el juego o lo terminan por lluvia sin cambiar inning, outs ni carreras, la pantalla nunca se entera | 829923 y 829938, ambos acortados por lluvia | Vigilar también el estado del juego con una consulta mínima de 560 bytes (`feed/live?fields=…`) |
| 3 | **Medianoche.** A las 12, "Hoy" cambia de día y el juego en curso desaparece de la lista | 11 juegos de 2026-27 empiezan a las 8:00 pm | Mantener en "Hoy" los juegos en vivo del día anterior |
| 4 | **Sin señal, lo viejo parece nuevo.** Dice "Actualizado hace 1 s" con datos de hace horas | — | Mostrar la hora del dato y no la de la pantalla, y avisar "sin conexión" |
| 5 | **"Calentamiento" sale como "En vivo"** media hora antes del primer lanzamiento | 838798: 22:33 (UTC) en "Warmup" | Decidir el estado por `codedGameState`. Textos en español: Calentamiento, Demora por lluvia, Suspendido (se reanuda el…), Acortado, Al terminar el 1.º |
| 6 | **Innings de dobles carteleras y juegos acortados.** Un juego de 7 innings sale como si lo hubieran cortado, y el juego de 5 innings por lluvia pone una "X" en el 9.º | 829938 (5 inn.) y 829750 (7 inn.) | Comparar con `scheduledInnings` y con `currentInning` |
| 7 | **Hora falsa del 2.º juego de la doble cartelera.** La API pone la del 1.º más 5 minutos | 829752 | Si viene `startTimeTBD`, mostrar "Al terminar el 1.º" |
| 8 | **Inglés colado.** Decisiones "(W, 2-0)", "(H, 1)", "(BS, 1)"; PH/PR/DH; textos de MLB como "Base por Bolas", "Pelotazo", "2nd entrada"; un carácter roto en "Corri� por" | 838798, 829756 | Traducir: G, P, JS, HLD, salvado desperdiciado; BE, CE, BD; boleto, golpeado; limpiar los textos |
| 9 | **Formatos viejos mal etiquetados.** La app aplica el formato actual a todas las temporadas | Hasta 2019-20 hubo series y semifinales; 2020-21 solo semifinales; 2021-22, Round Robin sin comodín; el comodín empieza en 2022-23 | Rotular cada fase con `seriesDescription` y activar cada regla según la temporada |
| 10 | **Constantes de liga en postemporada.** En la final, el "promedio de la liga" son dos equipos en 6 juegos | — | Usar siempre la temporada regular para la constante FIP, la escala de wOBA y la EFE de liga |
| 11 | **El Round Robin se simula con todos en .500** | — | Partir de la fuerza que cada equipo mostró en la temporada regular |
| 12 | **Percentiles injustos.** Se compara a los relevistas contra 16 abridores, y a bateadores de 30 PA contra calificados de 150 o más | Un tercio de los relevistas sale en el percentil 80+ de K% | Separar abridores y relevistas y encoger cada tasa hacia la liga según su muestra |
| 13 | **Explicaciones que solo salen con el ratón.** En el teléfono no se ven las de Pitag., Suerte, 1 carr. Además, el gris de las notas contrasta 4,2:1 y lo mínimo es 4,5:1 | — | Al tocar una sigla, una línea en criollo. Oscurecer el gris |
| 14 | **Pantalla "Más" desactualizada.** "El campeón va a la Serie del Caribe" ya no es seguro: en 2026 la LVBP no fue | Falta decir que en el Round Robin cada equipo juega 16 juegos (40 en total) | Corregir el texto. Agregar estadios que faltan: Jorge Luis García Carneiro y Metropolitano de San Cristóbal |
| 15 | **Una consulta colgada congela todo, y la memoria crece** con cada juego abierto | — | Tiempo límite de 10-20 s, reintentos con espera creciente y límite a lo guardado en memoria |

Menores: un empate se le cuenta al home club; la marca "en vivo" sigue consultando con la pantalla apagada; algunos íconos no los lee el lector de pantalla; la temporada solo se decide al abrir la app.

---

## B. Robustez y consumo de datos antes del 12/10

- **Datos por juego.** Hoy, seguir un juego completo cuesta entre 5,7 y 9 MB, porque en cada turno se baja el juego entero. Pidiendo solo lo que la app usa (`fields=`), cada descarga baja de 77 a 16 KB y el juego completo queda en unos 2-3 MB.
- **Modo ahorro.** Un modo ahorro con contador ("este juego te costó 0,6 MB") lo deja en menos de 1 MB. Las tipografías de Google pesan 126 KB, más que toda la app; en modo ahorro se usa la del teléfono.
- **Simulación de la tabla.** Hoy se corre cada minuto durante los juegos. Debe correr solo cuando termina un juego.
- **Pantalla.** Repintar solo lo que cambia, para no rehacer toda la pantalla en teléfonos baratos.
- **Actualizaciones de la app.** El service worker debe abrir con lo guardado y avisar "hay versión nueva". Hay que versionar los archivos para que no se mezclen viejos y nuevos después de publicar.
- **Plan de prueba de lo en vivo:**
  1. La API guarda cada momento de un juego terminado (`feed/live?timecode=`); el 838798 tiene 574. Con eso se arma un simulador que repite un juego real de la LVBP como si fuera en vivo, sin esperar al 12/10.
  2. **Arizona Fall League, 3/10 (mañana, hora de Caracas):** juegos 867729 (3:30 pm), 867732 (6:30 pm) y 867731 (9:30 pm, termina pasada la medianoche: sirve para el error 3). Grabarlos.
  3. Probar en un Android barato, con señal débil y sin conexión.
  4. Ensayo con la LMP el 13/10. Según la API, la LIDOM empieza el 16/10, no el 15.

---

## C. Números más finos (la diferencia de calidad)

| Mejora | Dato (verificado) | Qué cambia |
|---|---|---|
| **Pesos de wOBA propios de la LVBP** (BaseRuns calibrado a sus carreras) | Totales de la liga | Hoy el wRC+ sale aplastado hacia 100, porque la escala real es ~1,08 y la app usa 1,31. Pesos LVBP 2025 sobre el out: BB 0,70 · 1B 0,88 · 2B 1,23 · 3B 1,59 · HR 1,83. Gorkys Hernández pasa de 143 a 155 |
| **Factores de estadio** (3-4 temporadas, por estadio) | Calendario con marcador y estadio | En el Alfonso Carrasquel se anotan 27% más carreras; en el Luis Aparicio, 13% menos; en el Pérez Colmenares, 9% menos. Fuenmayor baja de 147 a 136 de wRC+ |
| **Perfil de batazos y del swing, xFIP** | `stats=seasonAdvanced`: rodados, líneas, elevados, globitos, swings, abanicados | Liga 2025-26: GB 44%, LD 20%, FB 28%, abanicados 21,6%. Se estabilizan rápido: separan habilidad de suerte en 56 juegos |
| **Contra zurdos y derechos, con corredores en posición, "tarde y cerrado"** | `people/{id}/stats?stats=statSplits&sitCodes=vl,vr,risp,lc` | Lo que más discute el aficionado. Mostrar siempre las PA (hay mucho ruido) |
| **Relevistas** | Heredados y heredados que anotan (ya se leen, no se muestran) | En la liga anotó el 39,9% de los heredados |
| **Simulación calibrada** | Calendarios 2016-25 | El home club gana .544, no .530. El talento está muy parejo (~80% de la dispersión de la tabla es suerte). Agregar la incertidumbre de la fuerza de cada equipo y las series (comodín, final) |
| **Desempates de la LVBP** (por confirmar con la liga) | Según Ricardo Gibbon: menos juegos para llegar a esas victorias, serie particular entre los empatados, diferencia de carreras, carreras anotadas. El empate por el 6.º se resolvió con juego extra en 2023-24 y 2024-25 (`tiebreaker:"Y"`) | La tabla y la simulación desempatan bien |
| **Expectativa de carreras (RE24)** | Jugada por jugada de 2022-25 (~900 juegos), precalculado una vez | Punto de equilibrio del robo y del toque (la liga robó con 67,7% de éxito), RE24 por jugador |
| Exponente pitagórico ~0,24 en vez de 0,287 | 72 temporadas-equipo | Menor |

---

## D. Lo que la haría única

Ninguna alternativa junta lo que ya tiene: probabilidad de ganar, WPA, simulación de clasificación, repetición y métricas modernas en español. Pesa ~50 KB, contra 37-70 MB de las apps de iPhone, y la única app bien valorada (Beisbol VE) no existe para Android, que tiene el 86% del mercado venezolano. Lo que le falta es lo que hace que la gente la recomiende: compartir, personalizar y avisar.

1. **Mi equipo y cuánto vale el juego de hoy.** Elegir tu equipo; su juego sale primero.
   - "Si gana hoy, X% de clasificar; si pierde, Y%."
   - Número mágico y de eliminación, y "¿qué necesita esta semana?".
   - La API no trae número mágico (`magicNumber` vacío), así que se calcula en la app.
   - Esfuerzo: chico-mediano. Sin servidor.
2. **Tarjetas para compartir por WhatsApp e Instagram.** Se arman en el teléfono: el final con la curva y la figura, el % de clasificar, la ficha con percentiles. Formatos Estado y cuadrado, más la pizarra en texto. Esfuerzo: mediano. Sin servidor.
3. **Planilla de anotación automática.** Cuadrícula bateador × inning con el diamante de cada turno y la notación clásica (6-4-3, F8, ꓘ, BB, E6, SB…). Todo sale de la feed, que ya está verificado. Nadie la tiene. Esfuerzo: grande.
4. **Jugada a jugada completo:**
   - secuencia de lanzamientos de cada turno ("B C F S X · 2-2") y lanzamientos por inning;
   - cambios de lanzador y emergentes, robos, wild pitch, balk;
   - el corredor colocado en 2.ª en extrainnings, que hoy no aparece;
   - carreras sucias y "se le carga a…".

   Esfuerzo: mediano.
5. **Box score con notas al pie completas** (2B, 3B, HR, CI, BR, CS, E, DP, LOB, golpeados, lanzamientos-strikes, heredados) y marcas a- y 1- de los emergentes. Esfuerzo: mediano.
6. **Crónica automática y "¿qué me perdí?".** Tres líneas armadas con reglas a partir de la curva ("Remontada: Magallanes tuvo 18% en el 6.º y ganó con un doble en el 8.º"). Esfuerzo: mediano. Sin servidor.
7. **El Clásico y las rivalidades.** Desde 2016-17: Caracas 39-37 en temporada regular y Magallanes 4-3 en postemporada. Próximos: 24/10 en el Monumental y 25/10 en Valencia. Esfuerzo: mediano.
8. **Récords, campeones y "un día como hoy"** (rotulado "desde 2016-17"). Ejemplos verificados:
   - mayor paliza: Bravos 26-3 Águilas (29/12/2020);
   - juego más largo: Magallanes 6-4 Tigres en 20 innings (27/12/2019);
   - racha más larga: 11, de Magallanes (2021-22);
   - aviso de juego sin hit (`hydrate=flags`).
9. **Criollos e importados, grandeligas.** `sports/17/players` trae país de nacimiento y debut en MLB. El país no siempre equivale a la condición de importado, que tiene tope por equipo (por confirmar para 2026-27). Esfuerzo: chico.
10. **Carrera por los premios:** Novato del Año (50 VB o menos en temporadas anteriores), Carrao Bracho y JMV. Esfuerzo: mediano.
11. **Buscador y comparador "¿Quién es mejor?"** con percentiles y tarjeta para compartir. Esfuerzo: chico.
12. **Polla entre panas, sin dinero.** Versión 1 en el teléfono; versión 2, con tabla del grupo, necesita una base de datos gratuita.
13. **Alertas** (jonrón de tu equipo, "se puso bueno": presión 2+ desde el 8.º):
    - Con la app abierta: sin servidor.
    - Con la app cerrada: necesita un servidor pequeño (plan gratis de Cloudflare Workers).
14. **"¿Dónde lo veo o lo oigo?"** La API no trae transmisiones; habría que mantener a mano un archivo con TV, BeisbolPlay, Televen Stream y radio.

---

## E. Lo que no harían (coinciden varios)

- **WAR, "Statcast criollo", velocidad, tipo de lanzamiento o calidad de contacto.** Los datos no existen para la LVBP: no hay tipo ni velocidad en los 632 lanzamientos revisados, y "hardness" dice "medium" en 105 de 114 batazos.
- **Recalcular carreras limpias o heredados.** La API ya lo trae por corredor y cuadra con el box.
- **Perseguir cambios de anotación posteriores al juego.** No llegan a la API. Basta una nota.
- **Récords "históricos" de la LVBP.** La fuente empieza en 2016-17: siempre rotular "desde 2016-17" y remitir a Pelota Binaria.
- **App nativa, o ampliarla a MLB y otras ligas.** Su ventaja es ser liviana y solo de la LVBP.
- **Apuestas, cuotas, dinero, publicidad invasiva, logos de la liga o de los equipos sin permiso.** Tampoco crecer en público: los términos de MLBAM permiten uso individual, no comercial y no masivo. Para crecer hace falta su autorización o una alianza con la LVBP.

## F. Nombre

El especialista de producto recomienda **quedarse con Pizarra Criolla**:
- **Pizarra Criolla:** dice qué es y de dónde, sin tomar partido. No apareció nada igual en buscadores y los dominios parecen libres (falta confirmarlo con un registrador).
- **Ocho Estrellas:** la octava estrella (2006) tiene lectura política para parte del público, suena a selección nacional y ochoestrellas.com está registrado.
- **Cuarto Bate:** ya existe un programa con ese nombre en Puerto Rico, y cuartobate.com está registrado.
- **Pizarra Tricolor:** más genérico.

Las 8 estrellas en el logo se entienden como una por equipo. Si se quiere evitar cualquier lectura política, se quitan y queda la franja tricolor.
