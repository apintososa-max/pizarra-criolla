/* Pizarra Criolla · tabla.js
   Tabla de posiciones calculada juego por juego desde el calendario, con récord pitagórico, rachas,
   enfrentamientos directos y la probabilidad de clasificar (simulación del calendario que falta).
   También la postemporada de cada temporada con su formato: primera ronda, semifinales, comodín, Round Robin y final. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc, team = PC.team;

  const phaseOf = g => (g.type === 'F' ? 'D' : g.type);
  const idsIn = games => [...new Set([].concat(...games.map(g => [g.away.id, g.home.id])))].filter(id => PC.TEAMS[id]);
  const isRR = games => games.some(g => /round/i.test(g.series));
  // 10.000 simulaciones toman ~1 s en un teléfono barato: solo se repiten cuando termina un juego.
  const simMemo = new Map();
  const simOnce = (key, fn) => { if (!simMemo.has(key)) { if (simMemo.size > 6) simMemo.clear(); simMemo.set(key, fn()); } return simMemo.get(key); };

  function meter(v) {
    const w = Math.max(0, Math.min(100, Math.round((v || 0) * 100)));
    return `<span class="meter" aria-hidden="true"><i style="width:${w}%"></i></span>`;
  }

  // Las filas .tap (toda la fila lleva al equipo, o al jugador en Líderes) las atiende el oyente de core.js, y el chip
  // elegido (fase) lo deja a la vista core.js en todas las pantallas después de pintar.

  // Puesto en un cuadrito; el color (zona de clasificación) lo pone la clase de la fila.
  const posCol = title => ({ k: 'pos', label: '#', title, cls: 'pos', html: r => `<span class="rk">${r.pos}</span>` });
  const teamCol = { k: 'team', label: 'Equipo', first: true, cls: 'name', html: r => `${U.chip(r.id, 's')} ${U.teamLink(r.id)}` };
  const TIE = 'Puesto. Los empates se ordenan por el récord entre los empatados, luego por la diferencia de carreras y luego por las carreras anotadas (criterio por confirmar con la LVBP).';
  // Leyenda de una línea con los cuadritos de color
  const legend = items => `<p class="tb-ley">${items.map(([q, txt]) => `<span><i class="${q}" aria-hidden="true"></i>${txt}</span>`).join('')}</p>`;

  // ---------- temporada regular ----------
  function regular(games, season) {
    const reg = games.filter(g => g.type === 'R');
    const rows = C.standings(reg, idsIn(reg).length ? idsIn(reg) : PC.TEAM_IDS);
    const pend = C.pending(reg);
    const played = rows.reduce((a, r) => a + r.G, 0) / 2;
    const modern = season >= PC.MODERN;
    const cols = [
      posCol(TIE),
      teamCol,
      { k: 'G', label: 'JJ', title: 'Juegos jugados' },
      { k: 'W', label: 'JG', title: 'Juegos ganados', cls: 'strong' },
      { k: 'L', label: 'JP', title: 'Juegos perdidos' },
      { k: 'PCT', label: 'AVE', title: 'Promedio de juegos ganados', fmt: F.avg },
      { k: 'GB', label: 'Dif', title: 'Juegos detrás del líder', fmt: F.gb },
      { k: 'l10', label: 'Últ. 10', title: 'Récord en los últimos 10 juegos', get: r => `${r.l10W}-${r.l10L}` },
      { k: 'streak', label: 'Racha', title: 'G3: tres ganados seguidos; P2: dos perdidos', get: r => r.streak || '—' },
      { k: 'hm', label: 'Casa', title: 'Récord en su estadio', get: r => `${r.hW}-${r.hL}` },
      { k: 'aw', label: 'Visit.', title: 'Récord de visitante', get: r => `${r.aW}-${r.aL}` },
      { k: 'RS', label: 'CA', title: 'Carreras anotadas' },
      { k: 'RA', label: 'CP', title: 'Carreras permitidas' },
      { k: 'DIFF', label: '+/-', title: 'Diferencia de carreras', fmt: v => F.signed(v) },
      { k: 'xwl', label: 'Pitag.', title: 'Récord que "debería" tener según sus carreras anotadas y permitidas', get: r => `${Math.round(r.xW)}-${Math.round(r.G - r.xW)}` },
      { k: 'luck', label: 'Suerte', title: 'Juegos ganados de más (+) o de menos (−) frente al récord pitagórico', fmt: v => F.signed(v, 1) },
      { k: 'one', label: '1 carr.', title: 'Récord en juegos decididos por una carrera', get: r => `${r.oneW}-${r.oneL}` },
      { k: 'ex', label: 'Extra', title: 'Récord en juegos de extrainnings', get: r => `${r.exW}-${r.exL}` }
    ];
    const tie = reg.filter(g => g.tiebreaker && g.status === 'final');
    // Con el formato actual: 1.º a 4.º directo al Round Robin (amarillo), 5.º y 6.º al comodín (azul claro).
    const zone = i => (modern ? (i < 4 ? 'q1 ' : i < 6 ? 'q2 ' : '') : '');
    let html = `<section class="sec tb">${U.table(cols, rows, { cls: 'standings', label: `Tabla de posiciones ${PC.seasonLabel(season)}`, rowClass: (r, i) => zone(i) + 'tap' })}
      ${modern ? legend([['q1', 'Directo al Round Robin'], ['q2', 'Comodín']])
        : `<p class="tb-ley">En ${PC.seasonLabel(season)} el formato de clasificación era distinto al actual.</p>`}
      ${tie.map(g => { const w = g.away.win ? g.away : g.home, l = g.away.win ? g.home : g.away;
        return U.note(`Incluye el juego de desempate del ${esc(D.short(g.date))}: ${esc(team(w.id).short)} le ganó ${w.score}-${l.score} a ${esc(team(l.id).short)}.`); }).join('')}</section>`;

    if (played > 0 && pend.length > 0) {
      const sim = simOnce(`R|${season}|${played}|${pend.length}`, () => C.simulate(rows, pend, { n: 10000 }));
      const order = rows.slice().sort((a, b) => sim[b.id].rr - sim[a.id].rr || a.pos - b.pos);
      const left = id => pend.filter(g => g.away.id === id || g.home.id === id).length;
      const pcols = [
        teamCol,
        { k: 'rr', label: 'Round Robin', cls: 'meter-cell', html: r => `${meter(sim[r.id].rr)}<b>${F.prob(sim[r.id].rr)}</b>` },
        { k: 'top4', label: 'Directo', title: 'Terminar entre los 4 primeros', get: r => F.prob(sim[r.id].top4) },
        { k: 'first', label: '1.º', title: 'Terminar primero', get: r => F.prob(sim[r.id].first) },
        { k: 'proj', label: 'Proy.', title: 'Récord final proyectado', get: r => { const w = Math.round(sim[r.id].W); return `${w}-${r.G + left(r.id) - w}`; } },
        { k: 'left', label: 'Faltan', title: 'Juegos que le quedan', get: r => left(r.id) }
      ];
      // En las primeras semanas (menos de 10 juegos por equipo) el aviso va a la vista: sin él, unas probabilidades
      // tan parejas parecen un error. Después queda en la (i).
      const early = played * 2 / rows.length < 10;
      html += `<section class="sec tb">${U.head('Probabilidad de clasificar',
        `10.000 simulaciones de los ${pend.length} juegos que faltan, con la fuerza de cada equipo según sus carreras anotadas y permitidas y la ventaja de jugar en casa (el home club gana el 54% en la LVBP). Round Robin incluye ganar el comodín: al 5.º le basta un triunfo, el 6.º necesita los dos.` +
        (early ? '' : ' Al principio de la temporada la simulación pesa mucho el .500: cada equipo parte casi igual.'))}
        ${early ? U.note('Van pocos juegos: la simulación todavía pesa mucho el .500 y cada equipo parte casi igual.') : ''}
        ${U.table(pcols, order, { cls: 'probs-t', label: 'Probabilidad de clasificar', rowClass: () => 'tap' })}</section>`;
    } else if (played > 0 && pend.length === 0) {
      if (modern) {
        const d = games.filter(g => phaseOf(g) === 'D' && g.status === 'final');
        const w = PC.seriesWins(d);
        const fifth = rows[4] && rows[4].id, sixth = rows[5] && rows[5].id;
        const adv = (w[sixth] || 0) >= 2 ? sixth : (w[fifth] || 0) >= 1 ? fifth : null;
        html += `<section class="sec">${U.head('Así terminó')}
          <p>Directo al Round Robin: ${rows.slice(0, 4).map(r => esc(team(r.id).short)).join(', ')}.
          ${rows.length >= 6 ? `Comodín: ${esc(team(fifth).short)} vs. ${esc(team(sixth).short)}${adv ? ` (avanzó ${esc(team(adv).short)})` : ''}.` : ''}</p></section>`;
      } else {
        const post = idsIn(games.filter(g => g.type !== 'R' && g.status === 'final'));
        if (post.length) {
          html += `<section class="sec">${U.head('Así terminó')}
            <p>Jugaron la postemporada: ${rows.filter(r => post.indexOf(r.id) >= 0).map(r => esc(team(r.id).short)).join(', ')}.</p></section>`;
        }
      }
    } else if (!played) {
      html += U.note('La temporada todavía no arranca. La tabla y las probabilidades se calculan solas desde el primer juego.');
    }

    if (played > 0) {
      // Suerte: ganados reales menos ganados esperados por carreras. Cada fila lleva al equipo.
      const mx = Math.max(1, ...rows.map(r => Math.abs(r.luck)));
      const lk = rows.slice().sort((a, b) => b.luck - a.luck);
      html += `<section class="sec">${U.head('Récord real vs. récord por carreras',
        'Positivo: el equipo ganó más juegos de los que sus carreras justifican (suele ser suerte o un bullpen muy bueno en juegos cerrados). Negativo: lo contrario.')}
        <div class="luck" role="list">${lk.map(r => {
          const w = (Math.abs(r.luck) / mx) * 50;
          return `<div class="luck-row rowlink" role="listitem"><span class="luck-t">${U.chip(r.id, 's')}<a class="tlink stretch" href="#/equipo/${r.id}">${esc(team(r.id).short)}</a></span>
            <span class="luck-bar" aria-hidden="true"><i class="${r.luck >= 0 ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%"></i></span>
            <span class="luck-v">${F.signed(r.luck, 1)}</span></div>`;
        }).join('')}</div></section>`;

      // Enfrentamientos directos: ganados en verde, perdidos en tinta tenue (sin rojo). Cómo se lee va a la vista:
      // sin eso no se sabe si un 6-2 es a favor o en contra.
      const ids = rows.map(r => r.id);
      html += `<section class="sec tb">${U.head('Enfrentamientos directos')}
        ${U.note('Fila: el equipo · columna: el rival. Un 6-2 es a favor del equipo de la fila.')}
        <div class="tbl-wrap sticky" tabindex="0" role="region" aria-label="Enfrentamientos directos"><table class="tbl h2h"><thead><tr><th scope="col"><span class="sr">Equipo</span></th>${ids.map(id => `<th scope="col" title="${esc(team(id).name)}">${esc(team(id).abbr)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr><th scope="row">${U.chip(r.id, 's')}</th>${ids.map(o => {
          if (o === r.id) return '<td class="self">·</td>';
          const v = r.vs[o] || { W: 0, L: 0 };
          return `<td class="${v.W > v.L ? 'up' : v.W < v.L ? 'down' : ''}">${v.W}-${v.L}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    }
    return html;
  }

  // ---------- Round Robin ----------
  function roundRobin(games, season) {
    const rr = games.filter(g => g.type === 'L');
    const rows = C.standings(rr, idsIn(rr));
    const pend = C.pending(rr);
    const played = rows.reduce((a, r) => a + r.G, 0) / 2;
    // La fuerza de cada equipo sale de su temporada regular más lo que lleva en el Round Robin.
    const reg = C.standings(games.filter(g => g.type === 'R'), PC.TEAM_IDS);
    const base = {};
    reg.forEach(r => { base[r.id] = { pyth: r.pyth, G: r.G }; });
    const sim = pend.length && rows.length ? simOnce(`L|${season}|${played}|${pend.length}`, () => C.simulate(rows, pend, { n: 10000, base })) : null;
    const cols = [
      posCol(TIE), teamCol,
      { k: 'G', label: 'JJ', title: 'Juegos jugados' }, { k: 'W', label: 'JG', title: 'Juegos ganados', cls: 'strong' }, { k: 'L', label: 'JP', title: 'Juegos perdidos' },
      { k: 'PCT', label: 'AVE', title: 'Promedio de juegos ganados', fmt: F.avg }, { k: 'GB', label: 'Dif', title: 'Juegos detrás del líder', fmt: F.gb },
      { k: 'streak', label: 'Racha', title: 'G3: tres ganados seguidos; P2: dos perdidos', get: r => r.streak || '—' },
      { k: 'RS', label: 'CA', title: 'Carreras anotadas' }, { k: 'RA', label: 'CP', title: 'Carreras permitidas' },
      { k: 'DIFF', label: '+/-', title: 'Diferencia de carreras', fmt: v => F.signed(v) }
    ];
    if (sim) {
      // la explicación de la simulación va en "Qué significa cada columna", no a la vista
      cols.push({ k: 'fin', label: 'A la final', cls: 'meter-cell', html: r => `${meter(sim[r.id].top2)}<b>${F.prob(sim[r.id].top2)}</b>`,
        title: `Probabilidad de terminar entre los 2 primeros: simulación de los ${pend.length} juegos que faltan${played ? '' : ' (antes del primer juego)'}, con la fuerza que cada equipo mostró en la temporada regular y en lo que va del Round Robin.` });
    }
    return `<section class="sec tb">${U.table(cols, rows, { cls: 'standings', label: `Tabla del Round Robin ${PC.seasonLabel(season)}`, rowClass: (r, i) => (i < 2 ? 'q1 ' : '') + 'tap' })}
      ${legend([['q1', 'A la final, a ganar 4 de 7']])}</section>`;
  }

  // ---------- series: primera ronda, semifinales, comodín y final ----------
  function series(games, phase, season) {
    const gs = games.filter(g => phaseOf(g) === phase && g.status !== 'post').sort((a, b) => a.ts - b.ts);
    if (!gs.length) return U.empty('Esta fase todavía no tiene juegos');
    const ch = phase === 'W' ? PC.champion(games) : null;
    // una serie por cada par de equipos
    const pairs = new Map();
    gs.forEach(g => {
      const k = [g.away.id, g.home.id].sort().join('-');
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push(g);
    });
    let html = `<section class="sec">${ch ? `<section class="champ"><p class="eyebrow">Campeón ${PC.seasonLabel(season)}</p><p class="champ-t">${esc(team(ch.id).name)}</p></section>` : ''}`;
    for (const list of pairs.values()) {
      const w = PC.seriesWins(list);
      const ids = idsIn(list).sort((a, b) => (w[b] || 0) - (w[a] || 0));
      if (ids.length === 2) {
        // el nombre en su propio span: es lo único que se recorta (con puntos) cuando la letra es grande
        const side = id => `<p>${U.chip(id, 's')}<span class="ss-n">${esc(team(id).short)}</span><b>${w[id] || 0}</b></p>`;
        html += `<div class="series-score">${side(ids[0])}${side(ids[1])}</div>`;
      }
      if (phase === 'D' && season >= PC.MODERN) {
        // Comodín: al 5.º le basta un triunfo; el 6.º necesita ganar los dos juegos.
        const reg = C.standings(games.filter(g => g.type === 'R'), PC.TEAM_IDS);
        const fifth = reg[4] && reg[4].id, sixth = reg[5] && reg[5].id;
        const adv = (w[sixth] || 0) >= 2 ? sixth : (w[fifth] || 0) >= 1 ? fifth : null;
        html += adv ? U.note(`Avanzó ${esc(team(adv).name)} al Round Robin. Al 5.º (${esc(team(fifth).short)}) le bastaba un triunfo; el 6.º (${esc(team(sixth).short)}) necesitaba los dos.`)
          : U.note(`Al 5.º (${esc(team(fifth).short)}) le basta un triunfo; el 6.º (${esc(team(sixth).short)}) necesita ganar los dos juegos.`);
      }
      html += `<div class="games">${list.map(g => PC.gameCard(g)).join('')}</div>`;
    }
    return html + '</section>';
  }

  PC.register('tabla', {
    tab: 'tabla',
    skeleton: 'tabla',
    every: () => (PC.state.liveToday ? 60000 : 0),
    async render(el, args, ctx) {
      const season = PC.state.season;
      const games = await PC.seasonGames(season, PC.state.liveToday > 0);
      if (!ctx.alive()) return;
      // Fases que tuvo esa temporada, con el nombre que les corresponde según su formato.
      const phases = ['R', 'D', 'L', 'W'].filter(p => p === 'R' || games.some(g => phaseOf(g) === p));
      const name = p => PC.phaseLabel(season, p, ((games.find(g => phaseOf(g) === p) || {}).series) || '');
      const phase = phases.indexOf(args[0]) >= 0 ? args[0] : 'R';
      let html = `<div class="page-head"><h1>Tabla ${PC.seasonLabel(season)}</h1>
        ${phases.length > 1 ? U.chips(phases.map(p => ({ k: p, label: name(p), href: `#/tabla/${p}` })), phase, 'Fase del torneo') : ''}</div>`;
      const pg = games.filter(g => phaseOf(g) === phase);
      html += phase === 'R' ? regular(games, season) : phase === 'L' && isRR(pg) ? roundRobin(games, season) : series(games, phase, season);
      html += U.fresh(API.when(games));
      el.innerHTML = html;
    },
    refresh(el, args, ctx) { return this.render(el, args, ctx); }
  });
})(window);
