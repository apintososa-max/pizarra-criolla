/* Pizarra Criolla · equipos.js
   Los 8 equipos, la ficha de cada equipo (pizarra con récord y puesto, números con su puesto en la liga, diferencial
   de carreras, récords parciales, roster con métricas) y la ficha de cada jugador (pizarra con sus 5 números clave,
   rejilla con el resto, percentiles, juego a juego, carrera en la LVBP). Los estilos propios van en css/fichas.css. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, CH = PC.charts, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc, team = PC.team;

  const ordinal = n => `${n}.º`;
  const splitsOf = d => (d && d.stats && d.stats[0] && d.stats[0].splits) || [];
  const I_LEFT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
  // Miga con flecha. Sin rótulo, "‹ Volver" (data-back): regresa a la pantalla anterior, sea cual sea; sin historial,
  // va a href. Con rótulo ("‹ Equipos") es un enlace fijo: core.js vuelve atrás solo si la pantalla anterior es esa;
  // si no, abre esa sección. Así "‹ Equipos" nunca regresa a un juego.
  const back = (href, label) => `<nav class="crumbs"><a class="fi-back" href="${href}"${label ? '' : ' data-back'}>${I_LEFT}<span>${esc(label || 'Volver')}</span></a></nav>`;
  // la ficha de equipo dice "‹ Equipos" si se llegó desde esa sección; si no (desde un juego, un jugador), "‹ Volver"
  const teamsLabel = () => (PC.state.root === 'equipos' ? 'Equipos' : '');
  // Las filas .fi-tap (roster, juego a juego) se tocan enteras con el oyente de core.js.

  // ---------- barra de arriba: la miga a la izquierda y las acciones a la derecha ----------
  // Compartir (PC.share) y Comparar con… (PC.pickPlayer) salen solo si su función existe (core.js, buscar.js): si falta,
  // falta el botón y nada más. Los botones miden 48 px de toque sin agrandar la fila (css/fichas.css).
  const I_SHARE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="17.5" cy="5.5" r="2.4"/><circle cx="6.5" cy="12" r="2.4"/>' +
    '<circle cx="17.5" cy="18.5" r="2.4"/><path d="M8.6 10.8l6.8-4M8.6 13.2l6.8 4"/></svg>';
  const I_CMP = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5h14M15 5l3.5 3.5L15 12M19.5 15.5h-14M9 12l-3.5 3.5L9 19"/></svg>';
  const canShare = () => typeof PC.share === 'function';
  const canPick = () => typeof PC.pickPlayer === 'function';
  const shareBtn = () => (canShare() ? `<button type="button" class="fi-act" data-share aria-label="Compartir">${I_SHARE}</button>` : '');
  const topBar = (backHtml, acts) => (acts ? `<div class="fi-bar">${backHtml}<div class="fi-acts">${acts}</div></div>` : backHtml);
  // data: {title, text, url} o una función que lo arma al tocar. PC.share se llama ahí mismo, dentro del toque (el menú de
  // compartir y el portapapeles lo exigen). Un segundo toque mientras está abierta la hoja de compartir no hace nada
  // (navigator.share no admite dos a la vez).
  function onShare(el, data) {
    const b = el.querySelector('[data-share]');
    if (!b || !canShare()) return;
    let busy = false;
    b.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      let r;
      try { r = PC.share(typeof data === 'function' ? data() : data); } catch (e) { console.warn('compartir', e); }
      Promise.resolve(r).catch(e => console.warn('compartir', e)).then(() => { busy = false; });
    });
  }

  // ---------- la pizarra de las fichas ----------
  // Línea de números grandes dentro del bloque azul. cells: [{label, value, title?, top?}]; top: 1.º de la liga (amarillo).
  function statLine(cells) {
    return `<dl class="fh-line" style="--n:${cells.length}">${cells.map(c => `<div${c.top ? ' class="top1"' : ''}>` +
      `<dt>${c.title ? `<abbr title="${esc(c.title)}">${esc(c.label)}</abbr>` : esc(c.label)}</dt><dd>${esc(c.value)}</dd></div>`).join('')}</dl>`;
  }
  const foot = pills => (pills.length ? `<p class="fh-foot">${pills.map(p => `<span>${p}</span>`).join('')}</p>` : '');

  // Rejilla compacta de números (4 columnas con líneas finas). items: [[sigla, valor, título?]]
  function grid(items) {
    return `<dl class="fgrid">${items.map(([k, v, t]) => `<div><dt${t ? ` title="${esc(t)}"` : ''}>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }

  // ---------- esqueletos de carga (core.js los pinta mientras llegan los datos) ----------
  // La misma maqueta de cada pantalla, con sus clases y un texto de muestra que no se ve (.sk-tx, css/fichas.css):
  // mide lo mismo que lo que viene, también en 360 px o con la letra grande, y nada salta al llegar los datos.
  const ghost = t => `<span class="sk-tx">${esc(t)}</span>`;
  const times = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  // barra del alto de un título de una línea: fs, el token de la letra; w y lh en em de esa letra
  const skBar = (fs, w, lh) => `<span class="sk" style="font-size:var(--fs-${fs});width:${w}em;height:${lh}em"></span>`;
  const skCrumb = label => `<div class="crumbs sk-x"><a class="fi-back">${I_LEFT}<span>${ghost(label || 'Volver')}</span></a></div>`;
  // con las mismas acciones que tendrá la pantalla (cmp: lleva "Comparar con…")
  const skBack = (label, cmp) => {
    const acts = (cmp && canPick() ? `<span class="fi-act fi-cmp">${I_CMP}<span>${ghost('Comparar')}<span class="cmp-x">${ghost(' con…')}</span></span></span>` : '') +
      (canShare() ? `<span class="fi-act">${I_SHARE}</span>` : '');
    return acts ? `<div class="fi-bar sk-x">${skCrumb(label)}<div class="fi-acts">${acts}</div></div>` : skCrumb(label);
  };
  const skLine = n => `<dl class="fh-line" style="--n:${n}">${times(n, () => `<div><dt>${ghost('RACHA')}</dt><dd>${ghost('000')}</dd></div>`)}</dl>`;
  const skHead = w => `<div class="sec-head">${skBar('h2', w, 1.1)}</div>`;
  const SK_TILES = ['Carreras por juego', 'AVE', 'OBP', 'SLG', 'wRC+', 'Jonrones', 'Bases robadas', 'BB%', 'K%'];

  // índice: título y las 8 filas con su insignia grande, nombre y ciudad, récord y puesto
  U.skeletons.equipos = () => `<div class="page-head">${skBar('h1', 6.5, 1)}</div>` +
    `<ul class="teams fi-idx sk-x">${PC.TEAM_IDS.map(id => {
      const t = team(id);
      return `<li><a><span class="tchip xl sk-chip">${esc(t.abbr)}</span><span class="tm-name"><b>${ghost(t.name)}</b><small>${ghost(t.city)}</small></span>` +
        `<span class="tm-rec"><b>${ghost('00-00')}</b><small>${ghost('0.º · G0 · +00')}</small></span></a></li>`;
    }).join('')}</ul>`;

  // ficha de equipo: la pizarra apagada (insignia y nombre del equipo de la ruta, récord, 4 casillas) y las casillas de Ofensiva
  U.skeletons['ficha-equipo'] = () => {
    const m = /equipo\/(\d+)/.exec(location.hash), t = team(m ? +m[1] : 0);
    return skBack(teamsLabel()) +
      `<div class="fh fh-team sk-x"><p class="eyebrow">${ghost(`${t.city} · `)}<span class="fh-nw">${ghost('temporada 0000-00')}</span></p>` +
      `<div class="fh-id"><span class="tchip xl inv sk-chip">${esc(t.abbr)}</span><div class="sk-h1">${ghost(t.name)}</div></div>` +
      `<div class="fh-rec"><b>${ghost('00-00')}</b><p><span>${ghost('0.º lugar')}</span><span>${ghost('a 0 juegos del líder')}</span></p></div>` +
      `${skLine(4)}<p class="fh-meta">${ghost('Ganó 0.0 juegos más de lo que dan sus carreras anotadas y permitidas (récord pitagórico).')}</p></div>` +
      `<div class="sec">${skHead(5)}<ul class="ftiles">${SK_TILES.map(l => `<li><span class="ft-l">${ghost(l)}</span>` +
        `<b class="ft-v">${ghost('0.0')}</b><span class="ft-r">${meter(0, 8)}${ghost('0.º de 8')}</span></li>`).join('')}</ul></div>`;
  };

  // La temporada elegida todavía no empieza (la 2026-27 antes del 12/10): todos se ven con su temporada anterior y el
  // aviso de arriba, así que el esqueleto también lo lleva.
  const notStarted = () => !!(PC.state.upcoming && PC.state.upcoming.season === PC.state.season);
  const skAviso = rest => `<p class="fi-aviso sk-x"><b>${ghost('Datos de 0000-00:')}</b> <span>${ghost(rest)}</span></p>`;
  // ficha de jugador: la pizarra apagada (equipo, nombre, datos, 5 casillas y el pie) y la rejilla de números
  U.skeletons['ficha-jugador'] = () => skBack('', true) + (notStarted() ? skAviso('todavía no juega en 0000-00.') : '') +
    `<div class="fh sk-x"><p class="eyebrow fh-eb"><span class="fh-tm"><span class="tchip s inv sk-chip">LVB</span></span>${ghost('Equipo de la liga · 2B · #00')}</p>` +
    `<div class="sk-h1">${ghost('Nombre Apellido')}</div><p class="fh-meta">${ghost('Batea derecho · lanza derecho · 25 años · nació en Valencia')}</p>` +
    `${skLine(5)}<p class="fh-foot"><span>${ghost('Califica para los líderes · 000 PA')}</span></p></div>` +
    `<div class="sec">${skHead(6)}<dl class="fgrid">${times(16, () => `<div><dt>${ghost('OBP')}</dt><dd>${ghost('.000')}</dd></div>`)}</dl></div>`;

  // ---------- índice de equipos ----------
  PC.register('equipos', {
    tab: 'equipos',
    skeleton: 'equipos',
    async render(el, args, ctx) {
      const season = PC.state.season;
      const games = await PC.seasonGames(season);
      if (!ctx.alive()) return;
      const reg = games.filter(g => g.type === 'R');
      const rows = C.standings(reg, PC.TEAM_IDS);
      el.innerHTML = `<div class="page-head"><h1>Equipos ${PC.seasonLabel(season)}</h1></div>
        <ul class="teams fi-idx">${rows.map(r => {
          const t = team(r.id);
          const sub = r.G
            ? `<span class="sr">puesto </span>${ordinal(r.pos)} · <span class="sr">racha </span>${esc(r.streak)} · <span class="sr">diferencia de carreras </span>${F.signed(r.DIFF)}`
            : 'sin juegos';
          return `<li><a href="#/equipo/${r.id}">${U.chip(r.id, 'xl')}
          <span class="tm-name"><b>${esc(t.name)}</b><small>${esc(t.city)}</small></span>
          <span class="tm-rec"><b><span class="sr">récord </span>${r.W}-${r.L}</b><small>${sub}</small></span>
        </a></li>`;
        }).join('')}</ul>${U.fresh(API.when(games))}`;
    }
  });

  // ---------- ficha de equipo ----------
  function rankOf(all, id, get, asc) {
    const vals = all.map(t => ({ id: t.id, v: get(t) })).filter(x => x.v != null);
    vals.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
    const i = vals.findIndex(x => x.id === id);
    if (i < 0) return null;
    const v = vals[i].v;
    return vals.findIndex(x => x.v === v) + 1; // empates comparten puesto
  }

  // Un número grande por casilla y, debajo, su puesto entre los 8 con una regla de 8 puntos (el 1.º a la izquierda).
  const meter = (rank, of) => `<span class="ft-m" aria-hidden="true">${Array.from({ length: of }, (_, i) => `<i${i + 1 === rank ? ' class="on"' : ''}></i>`).join('')}</span>`;
  function tiles(items) {
    return `<ul class="ftiles">${items.map(t => `<li${t.rank === 1 ? ' class="best"' : ''}>` +
      `<span class="ft-l">${esc(t.label)}</span><b class="ft-v">${esc(t.value)}</b>` +
      `${t.rank ? `<span class="ft-r">${meter(t.rank, t.of)}${ordinal(t.rank)} de ${t.of}</span>` : ''}</li>`).join('')}</ul>`;
  }

  // ---------- carreras por inning (mapa de calor) ----------
  // C.runsByInning y C.runsByInningLeague (M) dan diez lugares: innings 1 a 9 y uno para todos los extrainnings, cada uno
  // con {runs, avg, played, avgPlayed}. Aquí va el promedio por inning jugado (avgPlayed): así el 9.º (la baja que no se
  // juega) y los extrainnings se comparan con los demás. La liga es lo que anota un equipo cualquiera en ese inning.
  // Si falta algo del motor o del dibujo, la sección no sale.
  const INN_COLS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Ex'];
  const innName = c => (c < 9 ? `el ${ordinal(c + 1)}` : 'los extrainnings');
  const dec2 = v => (v == null ? '—' : v.toFixed(2));
  const cell2 = v => (v == null ? '—' : v.toFixed(2).replace(/^0(?=\.)/, '')); // ".62", como el AVE: cabe en la casilla
  const perInn = x => (!x ? null : x.avgPlayed != null ? +x.avgPlayed : x.played === 0 ? null : x.avg != null ? +x.avg : null);
  function inningData(mine, lg) {
    const n = mine && +mine.n;
    if (!n || !Array.isArray(mine.scored) || !Array.isArray(mine.allowed)) return null;
    const ls = lg && Array.isArray(lg.scored) ? lg.scored : [];
    const pick = (a, f) => INN_COLS.map((_, c) => f(a[c]));
    return {
      n, lg: pick(ls, perInn),
      scored: pick(mine.scored, perInn), allowed: pick(mine.allowed, perInn),
      sRuns: pick(mine.scored, x => (x ? x.runs : null)), aRuns: pick(mine.allowed, x => (x ? x.runs : null)),
      sPl: pick(mine.scored, x => (x ? x.played : null)), aPl: pick(mine.allowed, x => (x ? x.played : null))
    };
  }
  // Lo más notorio frente a la liga, en una línea: el inning (del 1 al 9) en que más le saca a la liga anotando y en el que
  // más le anotan de más (la diferencia más grande, que es lo que se calcula). Si en ninguno pasa, se dice así.
  function inningNote(d) {
    if (d.n < 5) return `Con ${d.n} ${d.n === 1 ? 'juego' : 'juegos'} todavía es pronto para ver un patrón.`;
    const most = vals => {
      let k = -1, gap = -Infinity;
      for (let c = 0; c < 9; c++) {
        if (vals[c] == null || d.lg[c] == null) continue;
        const g = vals[c] - d.lg[c];
        if (g > gap) { gap = g; k = c; }
      }
      return { k, gap };
    };
    const s = most(d.scored), a = most(d.allowed);
    const vs = (v, c) => `${dec2(v)} contra ${dec2(d.lg[c])}`;
    const out = [];
    if (s.k >= 0) out.push(s.gap > 0 ? `Donde más le saca a la liga: ${innName(s.k)} (${vs(d.scored[s.k], s.k)}).` : 'Anota menos que la liga en todos los innings.');
    if (a.k >= 0) out.push(a.gap > 0 ? `Donde más le anotan de más: ${innName(a.k)} (${vs(d.allowed[a.k], a.k)}).` : 'En ningún inning le anotan más que a la liga.');
    return out.join(' ');
  }
  // El detalle de una casilla tocada: "7.º inning: anota 0.73 por inning (41 carreras en 56 innings); la liga, 0.53."
  function inningCell(d, r, c) {
    const name = c < 9 ? `${ordinal(c + 1)} inning` : 'Extrainnings';
    const lgTxt = d.lg[c] != null ? `; la liga, ${dec2(d.lg[c])}` : '';
    const tot = (runs, pl) => (runs != null && pl ? ` (${runs} ${runs === 1 ? 'carrera' : 'carreras'} en ${pl} ${pl === 1 ? 'inning' : 'innings'})` : '');
    if (r === 1) return d.lg[c] == null ? `${name}: sin datos de la liga.` : `${name}: un equipo de la liga anota ${dec2(d.lg[c])} carreras por inning.`;
    const v = r === 0 ? d.scored[c] : d.allowed[c];
    if (v == null) return `${name}: ${c < 9 ? 'no lo jugó' : 'no jugó extrainnings'} esta temporada.`;
    return r === 0 ? `${name}: anota ${dec2(v)} por inning${tot(d.sRuns[c], d.sPl[c])}${lgTxt}.`
      : `${name}: le anotan ${dec2(v)} por inning${tot(d.aRuns[c], d.aPl[c])}${lgTxt}.`;
  }
  // ¿Hay con qué pedir y dibujar el mapa? (si falta algo de M o de G, la sección no sale)
  const heatOk = () => !!(API.teamInnings && C.runsByInning && C.runsByInningLeague && CH.heat);
  // la caja reservada mientras llegan los datos: un bloque apagado del alto del mapa y la línea de la escala
  const HEAT_SK = '<div class="fi-heat-res" aria-hidden="true"><span class="sk"></span><span class="sk fi-heat-sk-ley"></span></div>';
  // y la línea de lo más notorio, apagada: un texto del mismo largo que el de verdad, para que ocupe los mismos renglones
  const HEAT_NOTE_SK = `<span class="sk-tx" aria-hidden="true">${esc('Donde más le saca a la liga: el 0.º (0.00 contra 0.00). Donde más le anotan de más: el 0.º (0.00 contra 0.00).')}</span>`;
  // Los juegos de la temporada regular con sus innings: los del equipo y los de toda la liga (una sola consulta, M).
  async function innings(id, season) {
    if (!heatOk()) return null;
    try {
      const [mine, all] = await Promise.all([API.teamInnings(id, season), API.teamInnings(null, season)]);
      return inningData(C.runsByInning(mine, id), C.runsByInningLeague(all));
    } catch (e) { console.warn('innings', e); return null; }
  }

  // Lo que dice el récord pitagórico, en palabras.
  function luckText(luck) {
    if (!(Math.abs(luck) >= 0.5)) return 'Ganó lo que dan sus carreras anotadas y permitidas';
    return `Ganó ${F.dec1(Math.abs(luck))} juegos ${luck > 0 ? 'más' : 'menos'} de lo que dan sus carreras anotadas y permitidas`;
  }

  function teamHero(id, me, season) {
    const t = team(id);
    let html = `<header class="fh fh-team"><p class="eyebrow">${esc(t.city)} · <span class="fh-nw">temporada ${PC.seasonLabel(season)}</span></p>
      <div class="fh-id">${U.chip(id, 'xl inv')}<h1>${esc(t.name)}</h1></div>`;
    if (!me || !me.G) return html + '<p class="fh-meta">Todavía sin juegos en esta temporada.</p></header>';
    const gb = me.GB ? `a ${F.gb(me.GB)} ${me.GB === 1 ? 'juego' : 'juegos'} del líder` : me.pos === 1 ? 'líder de la liga' : 'empatado en el primer lugar';
    html += `<div class="fh-rec"><b><span class="sr">Récord </span>${me.W}-${me.L}</b>
      <p><span${me.pos === 1 ? ' class="lead"' : ''}><strong>${ordinal(me.pos)}</strong> lugar</span><span>${esc(gb)}</span></p></div>`;
    html += statLine([
      { label: 'RACHA', value: me.streak || '—', title: me.streak ? `${me.streak[0] === 'G' ? 'Ganó' : 'Perdió'} los últimos ${me.streak.slice(1)}` : '' },
      { label: 'DIF.', value: F.signed(me.DIFF), title: 'Diferencia de carreras (anotadas menos permitidas)' },
      { label: 'PITAG.', value: `${Math.round(me.xW)}-${Math.round(me.G - me.xW)}`, title: 'Récord pitagórico: el que corresponde a sus carreras anotadas y permitidas' },
      { label: 'ÚLT. 10', value: `${me.l10W}-${me.l10L}`, title: 'Récord en los últimos 10 juegos' }
    ]);
    return html + `<p class="fh-meta">${esc(luckText(me.luck))} (récord pitagórico).</p></header>`;
  }

  PC.register('equipo', {
    tab: 'equipos',
    skeleton: 'ficha-equipo',
    every: () => (PC.state.liveToday ? 120000 : 0),
    async render(el, args, ctx) {
      const id = +args[0];
      if (!PC.TEAMS[id]) { location.hash = '#/equipos'; return; }
      const season = PC.state.season;
      // Las carreras por inning (la temporada entera de toda la liga: la consulta más lenta) se piden ya, pero la ficha no
      // las espera: si estaban guardadas llegan en este mismo instante y van en esta pintada; si no, su caja queda
      // reservada con su alto (css/fichas.css) y el mapa se dibuja al llegar, sin mover lo de abajo.
      const innP = innings(id, season);
      let inn, innDone = false;
      innP.then(v => { inn = v; innDone = true; });
      const [games, st, th, tp, rh, rp] = await Promise.all([
        PC.seasonGames(season), PC.statsCtx(season, 'R'),
        API.teamStats(season, 'hitting', 'R'), API.teamStats(season, 'pitching', 'R'),
        API.stats(season, 'hitting', 'R', id), API.stats(season, 'pitching', 'R', id)
      ]);
      if (!ctx.alive()) return;
      if (!innDone) await new Promise(r => setTimeout(r, 0));
      if (!ctx.alive()) return;
      const reg = games.filter(g => g.type === 'R');
      const rows = C.standings(reg, PC.TEAM_IDS);
      const me = rows.find(r => r.id === id);
      const lg = st.lg;
      const T = splitsOf(th).map(s => {
        const line = C.batLine(s.stat);
        return { id: s.team.id, line, r: C.bat(line, lg) };
      });
      const P = splitsOf(tp).map(s => {
        const line = C.pitLine(s.stat);
        return { id: s.team.id, line, r: C.pit(line, lg) };
      });
      const tb = T.find(t => t.id === id), tpi = P.find(t => t.id === id);
      const of = Math.max(T.length, 1);
      const sr = rows.map(r => ({ id: r.id, RSG: r.RSG, RAG: r.RAG }));

      const t = team(id);
      let html = topBar(back('#/equipos', teamsLabel()), shareBtn()) + teamHero(id, me, season);

      if (tb && tpi && me && me.G) {
        html += `<section class="sec">${U.head('Ofensiva', 'Cada número con su puesto entre los 8 equipos: el punto marca dónde queda, con el 1.º a la izquierda.')}${tiles([
          { label: 'Carreras por juego', value: F.dec1(me.RSG), rank: rankOf(sr, id, x => x.RSG), of },
          { label: 'AVE', value: F.avg(tb.r.AVG), rank: rankOf(T, id, x => x.r.AVG), of },
          { label: 'OBP', value: F.avg(tb.r.OBP), rank: rankOf(T, id, x => x.r.OBP), of },
          { label: 'SLG', value: F.avg(tb.r.SLG), rank: rankOf(T, id, x => x.r.SLG), of },
          { label: 'wRC+', value: F.int(tb.r.wRCplus), rank: rankOf(T, id, x => x.r.wRCplus), of },
          { label: 'Jonrones', value: F.int(tb.line.HR), rank: rankOf(T, id, x => x.line.HR), of },
          { label: 'Bases robadas', value: F.int(tb.line.SB), rank: rankOf(T, id, x => x.line.SB), of },
          { label: 'BB%', value: F.pct(tb.r.BBPct), rank: rankOf(T, id, x => x.r.BBPct), of },
          { label: 'K%', value: F.pct(tb.r.KPct), rank: rankOf(T, id, x => x.r.KPct, true), of }
        ])}</section>
        <section class="sec">${U.head('Pitcheo', 'En carreras, EFE, FIP, WHIP y jonrones, el 1.º es el que menos permite.')}${tiles([
          { label: 'Permitidas por juego', value: F.dec1(me.RAG), rank: rankOf(sr, id, x => x.RAG, true), of },
          { label: 'EFE', value: F.era(tpi.r.ERA), rank: rankOf(P, id, x => x.r.ERA, true), of },
          { label: 'FIP', value: F.era(tpi.r.FIP), rank: rankOf(P, id, x => x.r.FIP, true), of },
          { label: 'WHIP', value: F.era(tpi.r.WHIP), rank: rankOf(P, id, x => x.r.WHIP, true), of },
          { label: 'K-BB%', value: F.pct(tpi.r.KBBPct), rank: rankOf(P, id, x => x.r.KBBPct), of },
          { label: 'HR por 9 IL', value: F.era(tpi.r.HR9), rank: rankOf(P, id, x => x.r.HR9, true), of }
        ])}</section>`;
      }

      // carreras por inning: anotadas y permitidas, con la liga en medio (si todavía no llegaron, la caja guarda su sitio)
      const innWait = !innDone && heatOk() && !!(me && me.G);
      if (inn || innWait) {
        const nG = inn ? inn.n : me.G;
        html += `<section class="sec">${U.head('Carreras por inning', `Carreras por inning jugado, en sus ${nG} juegos: arriba las que anotó, abajo las que le anotaron y en medio las de un equipo promedio de la liga. Más oscuro, más carreras. Los extrainnings van juntos (Ex). Toca una casilla para ver el detalle.`)}` +
          `<div id="inn-heat" class="fi-heat${inn ? '' : ' fi-heat-espera'}">${inn ? '' : HEAT_SK}</div>` +
          `<p class="fi-heat-t" aria-live="polite">${inn ? esc(inningNote(inn)) : HEAT_NOTE_SK}</p></section>`;
      }

      if (me && me.log.length) {
        html += `<section class="sec">${U.head('Diferencia de carreras, juego a juego', 'Acumulada desde el primer juego. Toca la línea para ver cada resultado.')}<div id="diff-chart" class="line-chart"></div></section>`;
        const one = (w, l) => `${w}-${l}`;
        const vs = rows.filter(r => r.id !== id).map(r => {
          const v = me.vs[r.id] || { W: 0, L: 0, RS: 0, RA: 0 };
          return `<li><span>vs. ${esc(team(r.id).short)}</span><b>${one(v.W, v.L)}</b><small>${F.signed(v.RS - v.RA)}</small></li>`;
        }).join('');
        html += `<section class="sec">${U.head('Récords parciales')}
          <ul class="splits"><li><span>En casa</span><b>${one(me.hW, me.hL)}</b></li><li><span>De visitante</span><b>${one(me.aW, me.aL)}</b></li>
          <li><span>Por una carrera</span><b>${one(me.oneW, me.oneL)}</b></li><li><span>Extrainnings</span><b>${one(me.exW, me.exL)}</b></li>
          <li><span>Últimos 10</span><b>${one(me.l10W, me.l10L)}</b></li>${vs}</ul></section>`;
      }

      // juegos recientes y próximos
      const mine = reg.filter(g => (g.away.id === id || g.home.id === id) && g.status !== 'post');
      const past = mine.filter(g => g.status === 'final').slice(-8).reverse();
      const next = mine.filter(g => g.status === 'pre' || g.status === 'live').slice(0, 5);
      const gl = g => {
        const home = g.home.id === id, opp = home ? g.away.id : g.home.id, us = home ? g.home : g.away, them = home ? g.away : g.home;
        const res = g.status === 'final' ? `<b class="${us.win ? 'w' : 'l'}">${us.win ? 'G' : 'P'} ${us.score}-${them.score}</b>` : g.status === 'live' ? '<b class="fi-live">en vivo</b>' : esc(D.time(g.ts));
        // el nombre del rival va aparte: si no hay sitio, se esconde y queda la insignia con su sigla (css/fichas.css)
        return `<li><a href="#/juego/${g.pk}"><span>${esc(D.short(g.date))}</span><span class="fi-opp">` +
          `<span class="fi-opp-v"><span class="fi-opp-p">${home ? 'vs.' : 'en'}</span> ${U.chip(opp, 's')}</span> <span class="fi-opp-n">${esc(team(opp).short)}</span></span>${res}</a></li>`;
      };
      if (past.length || next.length) {
        html += `<section class="sec">${U.head('Calendario')}<div class="cal">
          ${next.length ? `<div><h3>Próximos</h3><ul class="glist">${next.map(gl).join('')}</ul></div>` : ''}
          ${past.length ? `<div><h3>Últimos resultados</h3><ul class="glist">${past.map(gl).join('')}</ul></div>` : ''}</div></section>`;
      }

      // roster con métricas
      const bats = splitsOf(rh).map(s => ({ id: s.player.id, name: s.player.fullName, pos: s.position && s.position.abbreviation !== 'X' ? s.position.abbreviation : '', line: C.batLine(s.stat) }))
        .filter(p => p.line.PA > 0).map(p => Object.assign(p, { r: C.bat(p.line, lg) })).sort((a, b) => b.line.PA - a.line.PA);
      const pits = splitsOf(rp).map(s => ({ id: s.player.id, name: s.player.fullName, line: C.pitLine(s.stat) }))
        .filter(p => p.line.BF > 0).map(p => Object.assign(p, { r: C.pit(p.line, lg) })).sort((a, b) => b.line.OUTS - a.line.OUTS);
      // filas tocables (core.js) y el nombre con que el lector de pantalla anuncia cada tabla
      const tap = what => ({ rowClass: () => 'fi-tap', label: `${what} de ${team(id).name}, ${PC.seasonLabel(season)}` });
      if (bats.length) {
        html += `<section class="sec">${U.head('Bateadores · por PA', 'Toca un jugador para ver su ficha.')}${U.table([
          { k: 'n', label: 'Jugador', first: true, cls: 'name', html: p => `${U.player(p.id, p.name)} <small>${esc(C.posEs(p.pos))}</small>` },
          { k: 'PA', label: 'PA', get: p => p.line.PA }, { k: 'AVG', label: 'AVE', get: p => p.r.AVG, fmt: F.avg },
          { k: 'OBP', label: 'OBP', get: p => p.r.OBP, fmt: F.avg }, { k: 'SLG', label: 'SLG', get: p => p.r.SLG, fmt: F.avg },
          { k: 'OPS', label: 'OPS', get: p => p.r.OPS, fmt: F.avg }, { k: 'wRC', label: 'wRC+', get: p => p.r.wRCplus, fmt: F.int },
          { k: 'HR', label: 'HR', get: p => p.line.HR }, { k: 'RBI', label: 'CI', get: p => p.line.RBI }, { k: 'SB', label: 'BR', get: p => p.line.SB },
          { k: 'BB', label: 'BB%', get: p => p.r.BBPct, fmt: F.pct }, { k: 'K', label: 'K%', get: p => p.r.KPct, fmt: F.pct }
        ], bats, tap('Bateadores'))}</section>`;
      }
      if (pits.length) {
        html += `<section class="sec">${U.head('Lanzadores · por IL', 'Toca un lanzador para ver su ficha.')}${U.table([
          { k: 'n', label: 'Lanzador', first: true, cls: 'name', html: p => U.player(p.id, p.name) },
          { k: 'G', label: 'J', title: 'Juegos', get: p => p.line.G }, { k: 'GS', label: 'JI', title: 'Juegos iniciados', get: p => p.line.GS },
          { k: 'WL', label: 'G-P', get: p => `${p.line.W}-${p.line.L}` }, { k: 'SV', label: 'JS', get: p => p.line.SV },
          { k: 'IP', label: 'IL', get: p => F.ip(p.line.OUTS) }, { k: 'ERA', label: 'EFE', get: p => p.r.ERA, fmt: F.era },
          { k: 'FIP', label: 'FIP', get: p => p.r.FIP, fmt: F.era }, { k: 'WHIP', label: 'WHIP', get: p => p.r.WHIP, fmt: F.era },
          { k: 'K', label: 'K%', get: p => p.r.KPct, fmt: F.pct }, { k: 'BB', label: 'BB%', get: p => p.r.BBPct, fmt: F.pct }
        ], pits, tap('Lanzadores'))}</section>`;
      }
      html += U.fresh(Math.min(API.when(games, th, tp, rh, rp), st.t || Date.now()));
      el.innerHTML = html;

      onShare(el, () => ({
        title: t.name,
        text: me && me.G ? `${t.name}: ${me.W}-${me.L}, ${ordinal(me.pos)} lugar en la LVBP ${PC.seasonLabel(season)}` : `${t.name} en la LVBP ${PC.seasonLabel(season)}`,
        url: `#/equipo/${id}?t=${season}` // la temporada del enlace (?t=, core.js): la misma que dice el texto
      }));

      const drawHeat = (hb, d) => {
        const note = hb.nextElementSibling;
        const rows = [{ label: 'Anotadas', values: d.scored }, { label: 'Liga', values: d.lg }, { label: 'Permitidas', values: d.allowed }];
        // la escala, con los innings 1 a 9: los extrainnings son pocos y la aplastarían (lo que pase, toma el tono del extremo)
        const nine = [].concat(...rows.map(r => r.values.slice(0, 9))).filter(v => v != null);
        try {
          CH.responsive(hb, () => CH.heat(hb, { rows, cols: INN_COLS }, {
            fmt: cell2, min: Math.min(...nine), max: Math.max(...nine), label: `Carreras por inning de ${t.name} y de la liga`,
            onPick: (r, c) => { if (note && r != null && c != null) note.textContent = inningCell(d, r, c); }
          }));
        } catch (e) { console.warn('mapa de calor', e); hb.parentNode.hidden = true; }
      };
      const hb0 = el.querySelector('#inn-heat');
      if (hb0 && inn) drawHeat(hb0, inn);
      else if (hb0 && innWait) {
        innP.then(d => {
          const hb = ctx.alive() && el.querySelector('#inn-heat.fi-heat-espera');
          if (!hb) return;
          if (!d) { hb.parentNode.hidden = true; return; } // sin datos o falló: la sección no sale, como antes
          hb.classList.remove('fi-heat-espera');
          hb.innerHTML = '';
          hb.nextElementSibling.textContent = inningNote(d);
          drawHeat(hb, d);
        });
      }

      const box = el.querySelector('#diff-chart');
      if (box && me) {
        let acc = 0;
        const pts = me.log.map((g, i) => {
          acc += g.rs - g.ra;
          return { y: acc, tip: `<b>Juego ${i + 1} · ${esc(D.short(g.date))}</b> ${g.home ? 'vs.' : 'en'} ${esc(team(g.opp).short)}: ${g.win ? 'ganó' : 'perdió'} ${g.rs}-${g.ra}<span class="viz-tip-num">Acumulado ${F.signed(acc)}</span>` };
        });
        CH.responsive(box, () => CH.line(box, pts, { zero: true, fmt: v => F.signed(v), label: 'Diferencia de carreras acumulada' }));
      }
    },
    refresh(el, args, ctx) { return this.render(el, args, ctx); }
  });

  // ---------- ficha de jugador ----------
  // [etiqueta, valor, más alto es mejor, formato, k de estabilización (muestra), promedio de la liga]
  // Antes de comparar, cada tasa se encoge hacia la liga según su muestra: así un relevista con 12 IL o un bateador
  // con 60 PA no sale en el percentil 99 por una racha corta.
  const BAT_PCT = [
    ['wRC+', p => p.r.wRCplus, true, F.int, 250, () => 100], ['wOBA', p => p.r.wOBA, true, F.avg, 250, lg => lg.wOBA],
    ['OBP', p => p.r.OBP, true, F.avg, 300, lg => lg.OBP], ['SLG', p => p.r.SLG, true, F.avg, 250, lg => lg.SLG],
    ['ISO (poder)', p => p.r.ISO, true, F.avg, 160, lg => lg.SLG - lg.AVG], ['BB%', p => p.r.BBPct, true, F.pct, 120, lg => lg.BBPct],
    ['K%', p => p.r.KPct, false, F.pct, 60, lg => lg.KPct], ['Bases robadas', p => p.line.SB, true, F.int, 0, null]
  ];
  const lgHR9 = lg => (lg.IP ? 9 * lg.pit.HR / lg.IP : null);
  const lgLOB = lg => { const p = lg.pit, den = p.H + p.BB + p.HBP - 1.4 * p.HR; return den > 0 ? (p.H + p.BB + p.HBP - p.R) / den : null; };
  const PIT_PCT = [
    ['EFE', p => p.r.ERA, false, F.era, 250, lg => lg.ERA], ['FIP', p => p.r.FIP, false, F.era, 200, lg => lg.ERA],
    ['WHIP', p => p.r.WHIP, false, F.era, 250, lg => lg.WHIP], ['K%', p => p.r.KPct, true, F.pct, 70, lg => lg.pKPct],
    ['BB%', p => p.r.BBPct, false, F.pct, 170, lg => lg.pBBPct], ['K-BB%', p => p.r.KBBPct, true, F.pct, 100, lg => lg.pKPct - lg.pBBPct],
    ['HR/9', p => p.r.HR9, false, F.era, 300, lgHR9], ['LOB%', p => p.r.LOBPct, true, F.pct, 300, lgLOB]
  ];
  const starter = p => p.line.GS > 0 && p.line.GS >= p.line.G / 2;

  // Los 5 números de la pizarra. rate: se compara solo entre calificados; asc: más bajo es mejor; name: para "1.º en…".
  const KEY_BAT = [
    { label: 'AVE', name: 'AVE', get: p => p.r.AVG, fmt: F.avg, rate: 1 },
    { label: 'HR', name: 'jonrones', get: p => p.line.HR, fmt: F.int },
    { label: 'CI', name: 'impulsadas', get: p => p.line.RBI, fmt: F.int },
    { label: 'OPS', name: 'OPS', get: p => p.r.OPS, fmt: F.avg, rate: 1 },
    { label: 'wRC+', name: 'wRC+', get: p => p.r.wRCplus, fmt: F.int, rate: 1 }
  ];
  const KEY_PIT = [
    { label: 'EFE', name: 'EFE', get: p => p.r.ERA, fmt: F.era, rate: 1, asc: 1 },
    { label: 'G-P', name: 'victorias', get: p => p.line.W, show: p => `${p.line.W}-${p.line.L}` },
    { label: 'IL', name: 'innings', get: p => p.line.OUTS, fmt: F.ip },
    { label: 'K', name: 'ponches', get: p => p.line.SO, fmt: F.int },
    { label: 'WHIP', name: 'WHIP', get: p => p.r.WHIP, fmt: F.era, rate: 1, asc: 1 }
  ];
  // El resto de los números, en la rejilla.
  const restBat = (r, l) => [['OBP', F.avg(r.OBP)], ['SLG', F.avg(r.SLG)], ['wOBA', F.avg(r.wOBA)], ['OPS+', F.int(r.OPSplus)],
    ['PA', l.PA], ['H', l.H], ['2B', l.D], ['3B', l.T], ['CA', l.R, 'Carreras anotadas'], ['BB', l.BB], ['K', l.SO], ['BR', `${l.SB}-${l.CS}`, 'Bases robadas y atrapado robando'],
    ['ISO', F.avg(r.ISO)], ['BABIP', F.avg(r.BABIP)], ['BB%', F.pct(r.BBPct)], ['K%', F.pct(r.KPct)]];
  const restPit = (r, l) => [['FIP', F.era(r.FIP)], ['J', l.G, 'Juegos'], ['JI', l.GS, 'Juegos iniciados'], ['JS', l.SV, 'Juegos salvados'],
    ['HLD', l.HLD, 'Holds'], ['BB', l.BB], ['HR', l.HR], ['EFE+', F.int(r.ERAplus)], ['K%', F.pct(r.KPct)], ['BB%', F.pct(r.BBPct)], ['K-BB%', F.pct(r.KBBPct)],
    ['K/9', F.dec1(r.K9)], ['BB/9', F.dec1(r.BB9)], ['LOB%', F.pct(r.LOBPct)], ['BABIP', F.avg(r.BABIP)], ['AVE rival', F.avg(r.AVGa)]];

  // Puesto en la liga: 1 + cuántos están estrictamente mejor (los empatados comparten puesto).
  function leagueRank(me, all, get, asc) {
    const v = get(me);
    if (v == null) return null;
    let better = 0;
    for (const x of all) { const y = get(x); if (y != null && (asc ? y < v : y > v)) better++; }
    return better + 1;
  }
  // "jonrones e impulsadas": la y se vuelve e delante de i.
  const joinY = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} ${/^h?i[^aeiouáéíóú]/i.test(a[a.length - 1]) ? 'e' : 'y'} ${a[a.length - 1]}`);

  // Celdas de la pizarra con su puesto; las tasas cuentan solo si el jugador califica, los conteos si son más de 0.
  function keyCells(me, defs, qualPool, allPool, qual) {
    return defs.map(d => {
      const v = d.get(me);
      const rank = d.rate ? (qual ? leagueRank(me, qualPool, d.get, d.asc) : null) : (v > 0 ? leagueRank(me, allPool, d.get, d.asc) : null);
      return { label: d.label, name: d.name, value: d.show ? d.show(me) : d.fmt(v), rank, top: rank === 1 };
    });
  }
  const keyVals = (me, defs) => defs.map(d => [d.label, d.show ? d.show(me) : d.fmt(d.get(me))]);
  // "1.º en jonrones y OPS de la liga": el mejor puesto (si es del 1.º al 3.º) y en qué.
  function bestPill(cells) {
    const best = Math.min(...cells.map(c => c.rank || 99));
    if (best > 3) return null;
    return `<b>${ordinal(best)}</b> en ${esc(joinY(cells.filter(c => c.rank === best).map(c => c.name)))} de la liga`;
  }

  // Percentiles: color continuo de azul (bajo) a dorado (alto) entre los 5 tonos --pc-*, cada 25 puntos.
  // La clase sN es el tono más cercano, para teléfonos sin color-mix; --a, --b y --w arman la mezcla.
  // Bajo 20 la bola es azul oscuro y el número va en blanco (clase lo): con ese corte el peor contraste de día es
  // 4,3:1 (en 19); con el corte en 13 bajaba a 3,5:1.
  const PC_STOPS = ['--pc-c2', '--pc-c1', '--pc-m', '--pc-h1', '--pc-h2'];
  function pctColor(p) {
    const seg = Math.min(3, Math.floor(p / 25)), w = Math.round((p - seg * 25) * 4);
    return `--a:var(${PC_STOPS[seg]});--b:var(${PC_STOPS[seg + 1]});--w:${w}%`;
  }
  // El percentil de cada número: [{label, p, v, fmt}], con p null si no hay dato. Lo usan la ficha y el comparador.
  function pctRows(me, pool, defs, nOf, lg) {
    return defs.map(([label, get, hi, fmt, k, lgOf]) => {
      const v = get(me);
      const lgv = lgOf ? lgOf(lg) : null;
      const adj = x => (k && lgv != null ? C.shrink(get(x), nOf(x), lgv, k) : get(x));
      const p = v == null ? null : C.pctRank(adj(me), pool.map(adj).filter(x => x != null), hi);
      return { label, p, v, fmt };
    });
  }
  // La bola con el número sobre su barra (la clase, el color y el lugar de la bola).
  const pctAttrs = (p, i) => `class="s${Math.round(p / 25)}${p < 20 ? ' lo' : ''}" style="--p:${p / 100};--i:${i};${pctColor(p)}"`;
  const pctTrack = p => `<span class="fpc-t"><i class="fpc-f"></i><span class="fpc-b"><b><span class="sr">percentil </span>${p}</b></span></span>`;
  const PCT_LEG = '<span class="fpc-leg-t"><span>peor</span><span>promedio</span><span>mejor</span></span>';
  function pctBars(me, pool, defs, nOf, lg, anim) {
    let i = 0;
    const rows = pctRows(me, pool, defs, nOf, lg).map(x => (x.p == null ? '' : `<li ${pctAttrs(x.p, i++)}>` +
      `<span class="fpc-l">${esc(x.label)}</span>${pctTrack(x.p)}<span class="fpc-v">${esc(x.fmt(x.v))}</span></li>`)).join('');
    return `<ul class="fpc${anim ? ' anim' : ''}">${rows}<li class="fpc-leg" aria-hidden="true"><span></span>${PCT_LEG}<span></span></li></ul>`;
  }

  // Calificados (la regla de Líderes) y los grupos contra los que se miden los percentiles: los bateadores calificados;
  // los lanzadores, contra los de su mismo papel (abridores o relevistas: los relevistas ponchan más por entrar a tirar
  // duro poco rato). show: si hay muestra para mostrar percentiles.
  function quals(games) {
    const tg = PC.teamGames(games, 'R');
    const maxG = Math.max(0, ...Object.keys(tg).map(k => tg[k]));
    const gOf = x => (x.team && tg[x.team]) || maxG;
    return { gOf, bat: x => x.line.PA >= C.QUAL_PA * gOf(x), pit: x => x.line.OUTS / 3 >= C.QUAL_IP * gOf(x) };
  }
  function pctPool(st, q, kind, x) {
    if (kind === 'bat') {
      const pool = st.bats.filter(q.bat);
      return { pool, show: pool.length >= 10 && x.line.PA >= 50, nOf: y => y.line.PA, defs: BAT_PCT, who: `los ${pool.length} bateadores calificados` };
    }
    const same = y => starter(y) === starter(x);
    let pool = st.pits.filter(y => same(y) && y.line.OUTS >= (starter(x) ? 45 : 30));
    if (pool.length < 12) pool = st.pits.filter(y => same(y) && y.line.OUTS >= 15);
    return { pool, show: pool.length >= 8 && x.line.BF >= 40, nOf: y => y.line.BF, defs: PIT_PCT, who: `${pool.length} ${starter(x) ? 'abridores' : 'relevistas'} de la liga` };
  }
  // La temporada más reciente, distinta de not, en que jugó en la LVBP según su carrera (yearByYear de API.person, que
  // la trae completa aunque se pida otra temporada), o null.
  function lastLvbpSeason(p, not) {
    let best = null;
    for (const s of (p && p.stats) || []) {
      if (!s.type || s.type.displayName !== 'yearByYear') continue;
      for (const x of s.splits || []) {
        const y = x && x.league && x.league.id === API.LEAGUE ? +x.season : NaN;
        if (y && y !== not && (best == null || y > best)) best = y;
      }
    }
    return best;
  }
  // El aviso de arriba cuando se muestran datos de otra temporada: "Datos de 2025-26: todavía no juega en 2026-27." (la
  // elegida es la en curso y todavía no ha jugado) o "…: no jugó en la LVBP 2019-20." quien: '' (la ficha) o los
  // apellidos (el comparador); varios: verbo en plural.
  function awayNote(shown, away, quien, varios) {
    const todavia = away > shown && away === API.currentSeason();
    const verbo = todavia ? (varios ? 'todavía no juegan en' : 'todavía no juega en') : (varios ? 'no jugaron en la LVBP' : 'no jugó en la LVBP');
    return `<p class="fi-aviso"><b>Datos de ${esc(PC.seasonLabel(shown))}:</b> <span>${quien ? esc(quien) + ' ' : ''}${verbo} ${esc(PC.seasonLabel(away))}.</span></p>`;
  }

  // Papel principal en la temporada: 'bat', 'pit' o null. pitcher: si su posición es lanzador (la ficha la sabe por la
  // API de la persona; el comparador, por la de sus estadísticas).
  function mainRole(sb, sp, pitcher) {
    const isPitcher = !!pitcher || !!(sp && (!sb || sp.line.BF > sb.line.PA));
    const showBat = !!(sb && sb.line.PA > 0 && (!isPitcher || sb.line.PA >= 20));
    const showPit = !!(sp && sp.line.BF > 0);
    return { main: showPit && isPitcher ? 'pit' : showBat ? 'bat' : showPit ? 'pit' : null, showBat, showPit, isPitcher };
  }

  const COUNTRY = { 'Dominican Republic': 'Rep. Dominicana', USA: 'EE. UU.', Panama: 'Panamá', Mexico: 'México', Curacao: 'Curazao', Japan: 'Japón', Canada: 'Canadá', Peru: 'Perú' };
  const bornIn = p => {
    if (!p.birthCity) return '';
    const c = p.birthCountry;
    return !c || c === 'Venezuela' ? p.birthCity : `${p.birthCity}, ${COUNTRY[c] || c}`;
  };

  PC.register('jugador', {
    tab: 'lideres',
    skeleton: 'ficha-jugador',
    every: () => (PC.state.liveToday ? 180000 : 0),
    async render(el, args, ctx) {
      const pid = +args[0];
      if (!pid) { location.hash = '#/lideres'; return; }
      // Sin juegos en la temporada elegida (la 2026-27 antes del 12/10, o uno que todavía no debuta) se muestra su última
      // temporada con datos en la LVBP, y se dice arriba. Comparar con… y Compartir usan la temporada que se muestra.
      const want = PC.state.season;
      const load = s => Promise.all([API.person(pid, s), PC.statsCtx(s, 'R'), PC.seasonGames(s)]);
      let season = want;
      let [pd, st, games] = await load(season);
      if (!ctx.alive()) return;
      let p = pd.people && pd.people[0];
      if (!p) { el.innerHTML = back('#/lideres') + U.empty('Jugador no encontrado'); return; }
      const roleIn = s2 => mainRole(s2.batById.get(pid), s2.pitById.get(pid), p.primaryPosition && p.primaryPosition.code === '1').main;
      let away = null; // la temporada elegida, cuando se muestra otra
      if (!roleIn(st)) {
        const alt = lastLvbpSeason(p, want);
        if (alt) {
          const [pd2, st2, games2] = await load(alt);
          if (!ctx.alive()) return;
          const p2 = pd2.people && pd2.people[0];
          if (p2 && roleIn(st2)) { away = want; season = alt; pd = pd2; st = st2; games = games2; p = p2; }
        }
      }
      const lvbp = s => s && s.league && s.league.id === API.LEAGUE;
      const block = (type, group) => (p.stats || []).filter(s => s.type && s.type.displayName === type && s.group && s.group.displayName === group)
        .reduce((a, s) => a.concat((s.splits || []).filter(lvbp)), []);
      const q = quals(games), gOf = q.gOf;
      const lg = st.lg;
      const anim = !ctx.data.drawn; // los percentiles entran animados solo la primera vez, no en cada refresco
      ctx.data.drawn = true;

      const sb = st.batById.get(pid), sp = st.pitById.get(pid);
      const { main, showBat, isPitcher } = mainRole(sb, sp, p.primaryPosition && p.primaryPosition.code === '1');
      let tid = (sb && sb.team) || (sp && sp.team) || null, lastTeam = false;
      // sin juegos en esta temporada: la insignia del último equipo de su carrera en la LVBP (la temporada más
      // reciente); si no tiene ninguna, la del equipo actual, solo si es de la liga (suele ser uno de MLB)
      if (!tid) {
        let last = null;
        for (const s of block('yearByYear', 'hitting').concat(block('yearByYear', 'pitching'))) {
          if (s.season && s.team && PC.TEAMS[s.team.id] && (!last || +s.season >= +last.season)) last = s;
        }
        tid = last ? last.team.id : p.currentTeam && PC.TEAMS[p.currentTeam.id] ? p.currentTeam.id : null;
        lastTeam = !!tid;
      }
      const showPit = !!(sp && sp.line.BF > 0);
      // calificados y su número mínimo (la misma regla de Líderes)
      const batQual = q.bat, pitQual = q.pit;

      // ----- la pizarra -----
      const pos = p.primaryPosition ? p.primaryPosition.abbreviation : '';
      const role = pos === 'P' || (main === 'pit' && !pos) ? (sp ? (starter(sp) ? 'Abridor' : 'Relevista') : 'Lanzador') : C.posEs(pos);
      const eb = [role, p.primaryNumber ? `#${p.primaryNumber}` : ''].filter(Boolean).map(esc).join(' · ');
      const teamTag = tid && PC.TEAMS[tid] ? `<a class="fh-tm" href="#/equipo/${tid}">${U.chip(tid, 's inv')}<span>${esc(team(tid).name)}</span></a>${lastTeam ? ' · último equipo' : ''}${eb ? ' · ' : ''}` : '';
      const hand = c => (c === 'L' ? 'zurdo' : c === 'S' ? 'ambidiestro' : 'derecho');
      const born = bornIn(p);
      const meta = [`Batea ${p.batSide ? hand(p.batSide.code) : '—'}`, `lanza ${p.pitchHand ? (p.pitchHand.code === 'L' ? 'zurdo' : 'derecho') : '—'}`,
        p.currentAge ? `${p.currentAge} años` : '', born ? `nació en ${born}` : ''].filter(Boolean).join(' · ');
      let hero = `<header class="fh"><p class="eyebrow fh-eb">${teamTag}${eb}</p><h1>${esc(p.fullName)}</h1><p class="fh-meta">${esc(meta)}</p>`;
      if (main === 'bat') {
        const l = sb.line, qual = batQual(sb);
        const cells = keyCells(sb, KEY_BAT, st.bats.filter(batQual), st.bats, qual);
        const pill = bestPill(cells);
        hero += statLine(cells) + foot([pill,
          qual ? `Califica para los líderes · <b>${l.PA}</b> PA` : `<b>${l.PA}</b> PA · necesita ${Math.ceil(C.QUAL_PA * gOf(sb))} para calificar`].filter(Boolean));
      } else if (main === 'pit') {
        const l = sp.line, qual = pitQual(sp);
        const cells = keyCells(sp, KEY_PIT, st.pits.filter(pitQual), st.pits, qual);
        const pill = bestPill(cells);
        const roleTxt = starter(sp)
          ? (qual ? `Califica para los líderes · <b>${l.GS}</b> JI` : `<b>${l.GS}</b> JI · necesita ${Math.ceil(C.QUAL_IP * gOf(sp))} IL para calificar`)
          : `<b>${l.G}</b> juegos de relevo${l.SV ? ` · <b>${l.SV}</b> salvados` : ''}${l.HLD ? ` · <b>${l.HLD}</b> holds` : ''}`;
        hero += statLine(cells) + foot([pill, roleTxt].filter(Boolean));
      }
      hero += '</header>';
      // arriba a la derecha: Comparar con… (si jugó esta temporada) y Compartir
      const cmp = main && canPick() ? `<button type="button" class="fi-act fi-cmp" data-cmp>${I_CMP}<span>Comparar<span class="cmp-x"> con…</span></span></button>` : '';
      let html = topBar(back('#/lideres'), cmp + shareBtn()) + (away != null ? awayNote(season, away) : '') + hero;
      if (!main) html += U.empty(`Sin juegos en la LVBP ${PC.seasonLabel(season)}`, 'Cambia la temporada arriba para ver otras.');

      // ----- rejilla y percentiles -----
      // El papel principal ya tiene sus 5 números en la pizarra: aquí va el resto. El otro papel (un lanzador que
      // también batea) va completo.
      const pctHelp = who => `Comparado con ${who}, ajustando cada número por el tamaño de su muestra. 50 es el promedio; 90 significa que supera al 90%.`;
      const section = (kind, isMain) => {
        const x = kind === 'bat' ? sb : sp, r = x.r, l = x.line;
        const P = pctPool(st, q, kind, x);
        const key = isMain ? [] : keyVals(x, kind === 'bat' ? KEY_BAT : KEY_PIT);
        return `<section class="sec">${U.head(`${kind === 'bat' ? 'Bateo' : 'Pitcheo'} ${PC.seasonLabel(season)}`)}${grid(key.concat(kind === 'bat' ? restBat(r, l) : restPit(r, l)))}</section>` +
          (P.show ? `<section class="sec">${U.head('Percentiles en la liga', pctHelp(P.who))}${pctBars(x, P.pool, P.defs, P.nOf, lg, anim)}</section>` : '');
      };
      if (main) html += section(main, true);
      if (main === 'pit' && showBat) html += section('bat', false);
      if (main === 'bat' && showPit) html += section('pit', false);

      // juego a juego, con el promedio acumulado recalculado después de cada juego
      const kind = main === 'pit' ? 'pitching' : 'hitting';
      const log = block('gameLog', kind).filter(s => s.date).sort((a, b) => a.date < b.date ? -1 : 1);
      if (log.length) {
        html += `<section class="sec">${U.head('Juego a juego', kind === 'hitting' ? 'AVE y OPS acumulados después de cada juego. Toca una fila de la tabla para abrir ese juego.' : 'EFE acumulada después de cada juego. Toca una fila de la tabla para abrir ese juego.')}<div id="pl-chart" class="line-chart"></div>`;
        let accLine = null;
        const rows = log.map(s => {
          const line = kind === 'hitting' ? C.batLine(s.stat) : C.pitLine(s.stat);
          accLine = accLine ? C.sum([accLine, line]) : Object.assign({}, line);
          const r = kind === 'hitting' ? C.bat(accLine, lg) : C.pit(accLine, lg);
          return { s, line, r };
        });
        const opp = s => `${s.isHome ? 'vs.' : 'en'} ${esc(team(s.opponent && s.opponent.id).abbr)}`;
        const cols = kind === 'hitting' ? [
          { k: 'd', label: 'Fecha', first: true, cls: 'name', html: x => `<a href="#/juego/${x.s.game && x.s.game.gamePk}">${esc(D.short(x.s.date))}</a> <small>${opp(x.s)}</small>` },
          { k: 'ab', label: 'VB', get: x => x.line.AB }, { k: 'h', label: 'H', get: x => x.line.H }, { k: 'hr', label: 'HR', get: x => x.line.HR },
          { k: 'rbi', label: 'CI', get: x => x.line.RBI }, { k: 'bb', label: 'BB', get: x => x.line.BB }, { k: 'k', label: 'K', get: x => x.line.SO },
          { k: 'avg', label: 'AVE', get: x => x.r.AVG, fmt: F.avg }, { k: 'ops', label: 'OPS', get: x => x.r.OPS, fmt: F.avg }
        ] : [
          { k: 'd', label: 'Fecha', first: true, cls: 'name', html: x => `<a href="#/juego/${x.s.game && x.s.game.gamePk}">${esc(D.short(x.s.date))}</a> <small>${opp(x.s)}</small>` },
          { k: 'ip', label: 'IL', get: x => F.ip(x.line.OUTS) }, { k: 'h', label: 'H', get: x => x.line.H }, { k: 'er', label: 'CL', get: x => x.line.ER },
          { k: 'bb', label: 'BB', get: x => x.line.BB }, { k: 'k', label: 'K', get: x => x.line.SO }, { k: 'np', label: 'Lz', get: x => x.line.NP },
          { k: 'era', label: 'EFE', get: x => x.r.ERA, fmt: F.era }
        ];
        html += U.table(cols, rows.slice().reverse(), {
          rowClass: x => (x.s.game && x.s.game.gamePk ? 'fi-tap' : ''),
          label: `Juego a juego de ${p.fullName} (${kind === 'hitting' ? 'bateo' : 'pitcheo'}), ${PC.seasonLabel(season)}`
        }) + '</section>';
        ctx.data.logRows = rows;
        ctx.data.kind = kind;
      }

      // carrera en la LVBP: la de lanzador o la de bateador según su papel (si no jugó esta temporada, según su posición)
      const pitch = main ? main === 'pit' : isPitcher;
      const career = block('yearByYear', pitch ? 'pitching' : 'hitting').filter(s => s.season);
      if (career.length > 1) {
        const crow = career.map(s => {
          const line = pitch ? C.pitLine(s.stat) : C.batLine(s.stat);
          return { s, line, r: pitch ? C.pit(line) : C.bat(line) };
        }).sort((a, b) => +b.s.season - +a.s.season);
        // temporada con la insignia del equipo; el año en que jugó con dos equipos la API trae una fila por equipo
        // y otra sin equipo, que es el total de ese año
        const seasonCell = x => {
          const t = x.s.team, two = !t && career.some(s => s.season === x.s.season && s.team);
          return `${esc(PC.seasonLabel(+x.s.season))} ${t ? (PC.TEAMS[t.id] ? U.chip(t.id, 's') : `<small>${esc(team(t.id, t).abbr)}</small>`) : two ? '<small>total</small>' : ''}`;
        };
        const ccols = pitch ? [
          { k: 's', label: 'Temporada', first: true, cls: 'name', html: seasonCell },
          { k: 'wl', label: 'G-P', get: x => `${x.line.W}-${x.line.L}` }, { k: 'ip', label: 'IL', get: x => F.ip(x.line.OUTS) },
          { k: 'era', label: 'EFE', get: x => x.r.ERA, fmt: F.era }, { k: 'whip', label: 'WHIP', get: x => x.r.WHIP, fmt: F.era },
          { k: 'k', label: 'K', get: x => x.line.SO }, { k: 'bb', label: 'BB', get: x => x.line.BB }, { k: 'sv', label: 'JS', get: x => x.line.SV }
        ] : [
          { k: 's', label: 'Temporada', first: true, cls: 'name', html: seasonCell },
          { k: 'g', label: 'JJ', get: x => x.line.G }, { k: 'pa', label: 'PA', get: x => x.line.PA },
          { k: 'avg', label: 'AVE', get: x => x.r.AVG, fmt: F.avg }, { k: 'obp', label: 'OBP', get: x => x.r.OBP, fmt: F.avg },
          { k: 'slg', label: 'SLG', get: x => x.r.SLG, fmt: F.avg }, { k: 'hr', label: 'HR', get: x => x.line.HR }, { k: 'rbi', label: 'CI', get: x => x.line.RBI }
        ];
        html += `<section class="sec">${U.head('Carrera en la LVBP', 'Las temporadas que trae la fuente de datos. Si jugó con dos equipos en un año, va una fila por equipo y otra con el total.')}` +
          `${U.table(ccols, crow, { label: `Carrera en la LVBP de ${p.fullName} (${pitch ? 'pitcheo' : 'bateo'})` })}</section>`;
      }
      html += U.fresh(Math.min(API.when(pd, games), st.t || Date.now()));
      el.innerHTML = html;

      // Compartir: el nombre, el equipo y 3 números de su papel. Comparar con…: elige otro del mismo grupo.
      onShare(el, () => {
        const tm = tid && PC.TEAMS[tid] ? ` (${team(tid).short})` : '';
        const nums = main === 'bat' ? `${F.avg(sb.r.AVG)} AVE, ${sb.line.HR} HR, ${F.avg(sb.r.OPS)} OPS`
          : main === 'pit' ? `${F.era(sp.r.ERA)} EFE, ${sp.line.W}-${sp.line.L}, ${sp.line.SO} K en ${F.ip(sp.line.OUTS)} IL` : '';
        return { title: p.fullName, text: `${p.fullName}${tm}${nums ? ': ' + nums : ''} en la LVBP ${PC.seasonLabel(season)}`, url: `#/jugador/${pid}?t=${season}` };
      });
      const cb = el.querySelector('[data-cmp]');
      if (cb) {
        cb.addEventListener('click', async () => {
          let r = null;
          try {
            r = await PC.pickPlayer({ titulo: `Comparar a ${C.surname ? C.surname(p.fullName) : p.fullName} con…`, grupo: main === 'bat' ? 'bateo' : 'pitcheo', temporada: season, excluir: [pid] });
          } catch (e) { console.warn('elegir jugador', e); }
          if (r && r.id && r.id !== pid && ctx.alive()) PC.go(`#/comparar/${pid}/${r.id}`);
        });
      }

      const box = el.querySelector('#pl-chart');
      if (box && ctx.data.logRows) {
        const hit = ctx.data.kind === 'hitting';
        const pts = ctx.data.logRows.map((x, i) => ({
          y: hit ? (x.r.AVG || 0) : (x.r.ERA == null ? 0 : x.r.ERA),
          tip: `<b>${esc(D.short(x.s.date))}</b> ${hit ? `${x.line.H}-${x.line.AB}${x.line.HR ? `, ${x.line.HR} HR` : ''}` : `${F.ip(x.line.OUTS)} IL, ${x.line.ER} CL`}<span class="viz-tip-num">${hit ? `AVE ${F.avg(x.r.AVG)} · OPS ${F.avg(x.r.OPS)}` : `EFE ${F.era(x.r.ERA)}`} tras ${i + 1} juegos</span>`
        }));
        CH.responsive(box, () => CH.line(box, pts, {
          fmt: hit ? F.avg : F.era, ref: hit ? lg.AVG : lg.ERA, refLabel: 'liga', label: hit ? 'AVE acumulado' : 'EFE acumulada'
        }));
      }
    }
  });

  // Lo que la ficha comparte con el comparador (js/comparar.js): la barra de arriba, los números clave, los percentiles
  // y sus grupos, y el papel de cada jugador. Así los dos dicen lo mismo de un jugador.
  PC.ficha = {
    I_LEFT, I_SHARE, I_CMP, back, topBar, shareBtn, onShare, canShare, canPick, skBack, ghost, ordinal, joinY, leagueRank,
    KEY_BAT, KEY_PIT, BAT_PCT, PIT_PCT, pctRows, pctAttrs, pctTrack, PCT_LEG, pctPool, quals, mainRole, starter,
    lastLvbpSeason, awayNote, notStarted, skAviso
  };
})(window);
