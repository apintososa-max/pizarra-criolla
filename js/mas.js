/* Pizarra Criolla · mas.js
   Glosario de cada métrica (qué mide y cómo se calcula, en grupos que se abren al tocarlos), formato del torneo,
   fuente de los datos e instalación. Las explicaciones largas de la tabla (desempates, probabilidades) viven aquí. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const U = PC.U, esc = PC.esc;

  const G = [
    ['Bateo', [
      ['AVE', 'Promedio de bateo: hits entre veces al bate (VB).'],
      ['OBP', 'Porcentaje de embasarse: (H + BB + golpeados) entre (VB + BB + golpeados + elevados de sacrificio).'],
      ['SLG', 'Slugging: bases totales entre VB. Mide el poder.'],
      ['OPS', 'OBP + SLG. La forma rápida de medir a un bateador completo.'],
      ['OPS+', 'OPS comparado con la liga: 100 es el promedio; 130 es 30% mejor. Sin ajuste por estadio.'],
      ['wOBA', 'Promedio ponderado de embasarse: cada forma de llegar a base vale distinto (un jonrón vale más que un boleto). Se ajusta cada temporada para que el promedio de la LVBP sea igual a su OBP.'],
      ['wRC+', 'Carreras creadas comparadas con la liga, a partir del wOBA: 100 es el promedio, 150 es 50% mejor. La mejor métrica única de una ofensiva. Sin ajuste por estadio.'],
      ['ISO', 'Poder aislado: SLG menos AVE. Cuántas bases extra produce por turno.'],
      ['BABIP', 'Promedio cuando la pelota cae en juego (sin jonrones ni ponches). Muy alto o muy bajo suele volver a la normalidad: es la medida de la suerte.'],
      ['BB% / K%', 'Boletos y ponches por cada aparición al plato (PA).'],
      ['PA, VB, CI, CA, BR', 'Apariciones al plato, veces al bate, carreras impulsadas, carreras anotadas, bases robadas.']
    ]],
    ['Pitcheo', [
      ['EFE', 'Efectividad: carreras limpias permitidas por cada 9 innings.'],
      ['FIP', 'Pitcheo independiente de la defensa: solo cuenta lo que controla el lanzador (ponches, boletos, golpeados y jonrones). Se lleva a la escala de la EFE con la constante de la LVBP de cada temporada. Si la EFE es mucho más baja que el FIP, probablemente viene suerte o buena defensa detrás.'],
      ['WHIP', 'Boletos más hits permitidos por inning.'],
      ['K% / BB% / K-BB%', 'Ponches y boletos por bateador enfrentado; K-BB% resta los dos y es de lo que mejor predice el futuro de un lanzador.'],
      ['EFE+', 'EFE comparada con la liga: 100 es el promedio, más alto es mejor.'],
      ['LOB%', 'Porcentaje de corredores que deja en base. Cerca de 70% es lo normal.'],
      ['IL, CL, JS, HLD', 'Innings lanzados, carreras limpias, juegos salvados y holds.']
    ]],
    ['Equipos', [
      ['AVE, Dif', 'En la tabla: promedio de juegos ganados y juegos detrás del líder.'],
      ['Récord pitagórico', 'Los juegos que un equipo "debería" haber ganado según sus carreras anotadas y permitidas (fórmula Pythagenpat). La diferencia con el récord real es la columna Suerte.'],
      ['Empates en la tabla', 'Si dos o más equipos quedan con el mismo promedio, se ordenan por el récord entre ellos, luego por la diferencia de carreras y luego por las carreras anotadas. Es el criterio que usa la app mientras se confirma con la LVBP. Un juego extra de desempate, si lo hay, cuenta en la tabla.'],
      ['Probabilidad de clasificar', '10.000 simulaciones del calendario que falta. Cada juego se decide al azar según la fuerza de los dos equipos (su récord pitagórico, acercado a .500 al principio de la temporada) y una pequeña ventaja de jugar en casa.'],
      ['Al inicio de la temporada', 'Con pocos juegos jugados la simulación todavía pesa mucho el .500: cada equipo parte casi igual y las diferencias crecen a medida que avanza el calendario. Por eso en las primeras semanas las probabilidades se parecen tanto.'],
      ['A la final', 'En el Round Robin: probabilidad de terminar entre los 2 primeros, con 10.000 simulaciones de los juegos que faltan y la fuerza que cada equipo mostró en la temporada regular y en lo que va del Round Robin.']
    ]],
    ['En vivo', [
      ['Probabilidad de ganar', 'Calculada después de cada turno con el marcador, el inning, los outs y los corredores en base.'],
      ['WPA', 'Aporte a la victoria: cuántos puntos de probabilidad le sumó (o restó) cada jugador a su equipo. Un jonrón para dejar en el terreno puede valer +40 puntos; un ponche con las bases llenas en el noveno, −30.'],
      ['LI (presión)', 'Índice de presión del turno: 1 es un turno normal; 2 o más, un momento de mucha tensión.']
    ]]
  ];

  PC.register('mas', {
    tab: 'mas',
    skeleton: 'lista',
    render(el) {
      const st = PC.state;
      const install = st.installPrompt ? '<button type="button" class="btn" id="btn-install">Instalar en este teléfono</button>' : '';
      el.innerHTML = `<div class="page-head"><h1>Más</h1></div>
        <section class="sec">${U.head('Instalar como app')}
          <p>Pizarra Criolla funciona en el navegador y se puede instalar como una app más, con su ícono en la pantalla de inicio.</p>
          <ul class="steps"><li><b>Android (Chrome):</b> menú ⋮ → <i>Instalar app</i> o <i>Agregar a la pantalla principal</i>.</li>
          <li><b>iPhone (Safari):</b> botón Compartir → <i>Agregar a inicio</i>.</li></ul>${install}
        </section>
        <section class="sec">${U.head('Cómo se juega la LVBP')}
          <ul class="steps"><li><b>Temporada regular:</b> 56 juegos por equipo, 8 contra cada rival. Si hay empate por un puesto clave puede haber juego extra de desempate, que cuenta en la tabla.</li>
          <li><b>Clasifican:</b> los 4 primeros directo al Round Robin. 5.º y 6.º juegan el comodín: al 5.º le basta un triunfo, el 6.º necesita ganar los dos.</li>
          <li><b>Round Robin:</b> 5 equipos, todos contra todos, 16 juegos cada uno (40 en total).</li>
          <li><b>Final:</b> los 2 primeros del Round Robin, a ganar 4 de 7. Tradicionalmente el campeón va a la Serie del Caribe; en 2026 la LVBP no participó.</li></ul>
          ${U.note('Este formato rige desde 2022-23 (comprobado con los juegos de la fuente de datos). Antes cambió varias veces: hasta 2019-20 hubo primera ronda y semifinales por series; en 2020-21, solo semifinales; en 2021-22, Round Robin sin comodín. La app rotula cada temporada con su propio formato.')}
        </section>
        <section class="sec">${U.head('Glosario')}
          <div class="ms-grps">${G.map(([t, items]) => `<details class="ms-grp"><summary><span>${esc(t)}</span><small>${items.length} términos</small></summary>
            <dl class="ms-gl">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></details>`).join('')}</div>
        </section>
        <section class="sec">${U.head('De dónde salen los datos')}
          <p>De la API pública de estadísticas de MLB (statsapi.mlb.com), que registra la LVBP jugada por jugada. El teléfono la consulta directo; todos los cálculos (tabla, métricas avanzadas, probabilidades, figuras) se hacen en el teléfono con esos datos.</p>
          <ul class="steps"><li><b>En vivo:</b> el juego abierto se revisa cada 12 segundos y la lista del día cada 15.</li>
          <li><b>Tabla:</b> se recalcula cada minuto mientras haya juegos.</li>
          <li><b>Líderes:</b> cada 4 minutos mientras haya juegos.</li></ul>
          <p>Lo que la fuente no tiene para la LVBP: velocidad de los lanzamientos y de salida de los batazos (no hay Statcast en estos estadios), ni factores de estadio. Por eso wRC+, OPS+ y EFE+ no se ajustan por estadio.</p>
          ${U.note('Datos: MLB Advanced Media. App sin relación oficial con la LVBP ni con MLB, de uso personal.')}
        </section>`;
      const b = el.querySelector('#btn-install');
      if (b) b.addEventListener('click', async () => {
        try { st.installPrompt.prompt(); await st.installPrompt.userChoice; } catch (e) { /* el usuario cerró el diálogo */ }
        st.installPrompt = null;
        b.remove();
      });
    }
  });
})(window);
