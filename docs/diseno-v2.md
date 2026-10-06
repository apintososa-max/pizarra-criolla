# Experiencia visual v2: propuesta de 5 especialistas (03/10/2026)

Especialistas que miraron la app publicada (capturas a tamaño teléfono, claro y oscuro), leyeron el código y comprobaron
los datos con la API. Tres hicieron maquetas funcionando con datos reales:
- diseño visual;
- movimiento e interacción;
- gráficos interactivos;
- juego en vivo;
- producto móvil.

**Lo que coinciden todos:** la pizarra azul y la repetición ya están al nivel de las apps grandes. El resto de la app
todavía se siente "página web":
- no responde al dedo;
- aparece de golpe;
- olvida dónde estabas;
- tiene demasiado texto a la vista;
- los números importantes no mandan.

## Medido (no opinión)

- **Apertura:** 3,6 s hasta ver algo. En un teléfono lento con 3G: 3,7 s de "Cargando…" y 6,8 s hasta el contenido. Lighthouse da rendimiento 81 (64 en 3G) y accesibilidad 100.
- **Fuentes:** las de Google pesan 123 de los 219 KB de la app y bloquean la pantalla ~1 s.
- **Atrás de Android:**
  - cambiar 4 veces de pestaña deja 4 pasos en el historial;
  - al volver de un jugador, Líderes regresa arriba (estaba a 1.418 px);
  - "‹ Equipos" y atrás entran en bucle.
- **Toque:**
  - no hay ningún estado `:active` y el resaltado de Android está apagado;
  - en una fila de líderes de 326×60 solo se puede tocar 118×22;
  - en Líderes, 68 de 73 controles miden menos de 44 px.
- **Letra:** 22 tamaños distintos, todos en px. Con la letra del teléfono al 150 % en una pantalla de 360 px, la cabecera se sale y la página se mueve de lado.
- **Refresco en vivo:** repinta todo. Tarda 90-150 ms en un teléfono lento, devuelve las tablas a la izquierda y cierra los desplegables.
- **Repetición:** cada paso rehace 922 elementos, y 669 son de una pestaña oculta.
- **Datos disponibles (100 % de 1.846 lanzamientos y 362 batazos en 6 juegos):**
  - ubicación de cada lanzamiento (`pitchData.coordinates`, `strikeZoneTop/Bottom`);
  - coordenadas, zona y trayectoria de cada batazo;
  - la defensa completa en el linescore.

  Sin velocidad ni tipo de lanzamiento. `feed/live/diffPatch` funciona en la LVBP: un turno cuesta ~2,6 KB.

## Fase 1: que se sienta app (antes del 12/10)

| # | Qué | Archivos |
|---|---|---|
| 1 | **Respuesta al toque:** la tarjeta se hunde un 2 % y los botones un 5 %. Toda la fila es tocable; nada mide menos de 44 px; píldora en la pestaña activa | styles.css |
| 2 | **Atrás y desplazamiento como Android:** los filtros no llenan el historial, al volver quedas donde estabas, tocar la pestaña activa sube al inicio, flecha ← de 48 px | core.js |
| 3 | **Abrir al instante:** service worker que sirve primero lo guardado, datos viejos al momento mientras llegan los nuevos, no esperar el calendario para pintar, aviso "Hay versión nueva · Actualizar", fuente de la pizarra alojada y recortada | sw.js, api.js, core.js |
| 4 | **Esqueletos de carga** con la forma de lo que viene (la pizarra azul vacía mientras carga un juego) | core.js |
| 5 | **Refresco sin saltos:** en vivo cambia solo lo que cambió; mini pizarra fija arriba al bajar en un juego | juegos.js |
| 6 | **Sistema visual:** 8 tamaños de letra (en rem, respeta la letra grande del teléfono), números importantes en letra de pizarra, una sola insignia azul por equipo, un solo azul de acción, rojo solo para "en vivo", percentiles de azul a dorado | styles.css, core.js |
| 7 | **Tarjeta de juego tipo marcador:** columna fija de estado (FINAL, hora grande, o inning + bases + cuenta en rojo), flecha al ganador, sin el estadio en la lista | juegos.js |
| 8 | **Explicaciones detrás de una (i)** y menos notas a la vista; controles coherentes (pestañas subrayadas, píldoras) | core.js, tabla.js, lideres.js |
| 9 | **Fichas de equipo y jugador** que abren con un bloque de pizarra con los 5 números clave | equipos.js |
| 10 | **Tirar hacia abajo para actualizar** y aviso de conexión arriba | core.js |

## Fase 2: el juego como transmisión (alrededor del 12/10)

**Estado (05/10/2026):** hecha, revisada por 4 especialistas independientes y corregida (versión 5). El contrato entre
especialistas, las decisiones de la revisión y lo que quedó para después están en `docs/fase2-contrato.md`.

| # | Qué | Datos |
|---|---|---|
| 11 | **El turno arriba:** marcador en una línea, cuenta grande con bombillos, diamante con el apellido de cada corredor, duelo con contexto ("hoy 1-2", lanzamientos, en cubierta, presión) | ya se descargan |
| 12 | **Pestañas debajo de la pizarra:** Resumen · Box · Jugadas · Datos (hoy el box queda a tres pantallas) | — |
| 13 | **La curva que manda:** arrastrar el dedo mueve la pizarra a ese momento; marcas de jonrón, carreras por inning y cambios de lanzador; línea del color del que va ganando; se dibuja al abrir | verificado |
| 14 | **Zona de strike y secuencia** del turno ("B C F S X"), lanzamientos numerados, vista desde el center | 100 % de los lanzamientos; ubicación marcada a mano, aproximada |
| 15 | **Mapa de batazos** del juego: relleno = hit, hueco = out, grande = jonrón; tocar un punto lleva a la jugada | 100 % de los batazos |
| 16 | **Momentos:** banda amarilla de 8 s (CARRERA, JONRÓN, CAMBIO DE LANZADOR, FIN DEL INNING) y pizarra viva (carreras que ruedan, bombillos con halo, las 8 estrellas se prenden en un jonrón) | verificado |
| 17 | **Repetición lanzamiento a lanzamiento,** a 1×/2×/4×, con pausa en las jugadas clave | ya descargado |

## Fase 3: después del arranque

- **Mi equipo:** pregunta al primer arranque, su juego primero, su fila marcada.
- **Búsqueda de jugadores** sin importar los acentos.
- **Instalación propia** con accesos directos, y botón de compartir.
- **Motor en vivo con `diffPatch`:** ~1 MB por juego en lugar de 6-9.
- **Segunda pantalla horizontal** para tener al lado de la TV, con retraso ajustable.
- **La temporada fecha por fecha:** evolución de los puestos, con 10 cuadritos de los últimos juegos en la tabla.
- **Carreras por inning** como mapa de calor.
- **Comparador de dos jugadores.**
- **Forma reciente** de los líderes.
- **Deslizar entre días.**

## Lo que no harían (coinciden)

- **Logos o fotos:** hay un tema de licencia y además pesan. La insignia azul cumple esa función.
- **Librerías pesadas, Lottie, confeti, 3D, video o sonidos por defecto.**
- **Nada "tipo Statcast":** no hay velocidades, tipos de lanzamiento ni zonas calientes, y tampoco "strikes mal cantados", porque la ubicación se marca a mano.
- **Animaciones entre pantallas en el refresco automático:** bloquean los toques.
- **Pintar todo de azul o con los colores de los 8 equipos:** la pizarra luce porque es la única pieza fuerte.
- **Gráfico de radar, app nativa, ni la densidad de Sofascore** (noticias, cuotas, publicidad).

## Maquetas

Están en la carpeta temporal de la sesión: `scratchpad\agente-diseno`, `agente-envivo`, `agente-graficos`, `agente-movimiento` y `agente-producto`.
