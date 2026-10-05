/* Pizarra Criolla · juegos.js
   Juegos del día (tarjetas tipo marcador) y la pantalla de cada juego: pizarra, probabilidad de ganar, figuras,
   jugadas clave, box score y jugada por jugada. Un juego terminado se puede repetir jugada a jugada.
   En vivo y en la repetición la pantalla no se rehace: cada pieza se compara con la que hay y solo cambia lo que
   cambió (así no se pierde el desplazamiento de las tablas ni se cierran los desplegables). */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, CH = PC.charts, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc;
  const team = (id, api) => PC.team(id, api);
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const I_LEFT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
  const I_RIGHT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';
  const I_PLAY = '<svg class="ic-f" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8c.6-.4.6-1.2 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z"/></svg>';
  const I_PAUSE = '<svg class="ic-f" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';

  // "José A. Martínez" -> "Martínez" ; "Ronald Acuña Jr." -> "Acuña Jr."
  const surname = n => {
    const p = String(n || '').split(' ').filter(x => x && !/^[A-Z]\.$/.test(x));
    return p.length > 1 ? p.slice(1).join(' ') : (p[0] || '');
  };
  const ord = n => `${n}.º`;
  // "2023-11-01T21:00:00Z" -> fecha en Venezuela
  const dayOf = iso => (iso ? D.isoOf(Date.parse(iso)) : null);
  // "Lunes, 12 de octubre" -> "lunes 12 de octubre"
  const dayText = (iso, withYear) => { const s = D.long(iso, withYear).replace(',', ''); return s.charAt(0).toLowerCase() + s.slice(1); };

  // Insignia de un equipo; los de otras ligas (Serie del Caribe, amistosos) usan lo que trae la API.
  function chipOf(t, size) {
    if (PC.TEAMS[t.id]) return U.chip(t.id, size);
    const x = team(t.id, { name: t.name });
    return `<span class="tchip ${size || ''}" title="${esc(x.name)}">${esc(x.abbr)}</span>`;
  }

  // ---------- piezas que se actualizan solas ----------
  // Cada hijo con data-p se compara con el que ya está: si es igual se deja, si cambió se cambia solo él (bajando
  // por sus hijos con data-p). Lo que no tiene data-p se rehace entero, conservando el desplazamiento lateral de las
  // tablas y los desplegables abiertos.
  const KEEP = '.tbl-wrap, .bt-line, details';
  function grab(node) {
    const list = [node].concat([...node.querySelectorAll(KEEP)]).filter(x => x.matches && x.matches(KEEP));
    return list.map(x => (x.tagName === 'DETAILS' ? { open: x.open } : { left: x.scrollLeft }));
  }
  function put(node, saved) {
    if (!saved.length) return;
    const list = [node].concat([...node.querySelectorAll(KEEP)]).filter(x => x.matches && x.matches(KEEP));
    list.forEach((x, i) => {
      const s = saved[i];
      if (!s) return;
      if (x.tagName === 'DETAILS') { if (s.open != null) x.open = s.open; } else if (s.left) x.scrollLeft = s.left;
    });
  }
  const keyed = nodes => nodes.length > 0 && nodes.every(n => n.dataset && n.dataset.p) &&
    new Set(nodes.map(n => n.dataset.p)).size === nodes.length;
  const onlyElements = node => [...node.childNodes].every(n => n.nodeType === 1 || (n.nodeType === 3 && !n.data.trim()));
  function sameAttrs(a, b) {
    if (a.attributes.length !== b.attributes.length) return false;
    for (const at of a.attributes) if (b.getAttribute(at.name) !== at.value) return false;
    return true;
  }
  function morph(o, n) {
    // "Actualizado hace…": su texto lo escribe core.js; basta con renovar la hora
    if (o.dataset.ago && n.dataset.ago) { o.dataset.ago = n.dataset.ago; return o; }
    if (o.tagName === 'DETAILS' && o.open) n.open = true;
    if (o.isEqualNode(n)) return o;
    if (o.tagName === n.tagName && sameAttrs(o, n) && onlyElements(o) && onlyElements(n) && keyed([...o.children]) && keyed([...n.children])) {
      morphKids(o, [...n.children]);
      return o;
    }
    const saved = grab(o);
    o.replaceWith(n);
    put(n, saved);
    return n;
  }
  function morphKids(box, next) {
    const old = new Map([...box.children].map(c => [c.dataset.p, c]));
    let pos = box.firstElementChild;
    for (const n of next) {
      const o = old.get(n.dataset.p);
      let node = n;
      if (o) {
        old.delete(n.dataset.p);
        const here = o === pos;
        node = morph(o, n);
        if (here) pos = node;
      }
      if (node === pos) pos = pos.nextElementSibling;
      else box.insertBefore(node, pos);
    }
    old.forEach(o => o.remove());
  }
  function morphHTML(box, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const next = [...tpl.content.children];
    if (onlyElements(tpl.content) && onlyElements(box) && keyed(next) && keyed([...box.children])) morphKids(box, next);
    else { const saved = grab(box); box.innerHTML = html; put(box, saved); }
  }
  // Igual que morphHTML, pero sin trabajo si el HTML no cambió desde la última vez.
  function paint(box, html) {
    if (!box || box._html === html) return;
    box._html = html;
    morphHTML(box, html);
  }

  // ---------- estado de un juego en la lista ----------
  function inningShort(g) {
    if (!g.inning) return g.label || 'En vivo';
    if (g.inningState === 'Middle') return `Mitad ${ord(g.inning)}`;
    if (g.inningState === 'End') return `Fin ${ord(g.inning)}`;
    return `${g.half === 'Top' ? '▲' : '▼'} ${ord(g.inning)}`;
  }

  // Lo que va debajo de "Final": "10 inn.", "5 inn. (lluvia)", "empate"; nada si fue a los innings previstos.
  function finalSub(inn, sched, reason, tied) {
    if (tied) return 'empate';
    sched = sched || 9;
    if (inn && inn > sched) return `${inn} inn.`;
    if (inn && inn < sched) { const why = C.reasonEs(reason); return `${inn} inn.${why ? ` (${why})` : ''}`; }
    return '';
  }
  // "Final", "Final · 10 inn.", "Final · 5 inn. (lluvia)", "Final · empate"
  const finalText = (inn, sched, reason, tied) => { const s = finalSub(inn, sched, reason, tied); return s ? `Final · ${s}` : 'Final'; };

  // "Pospuesto por lluvia" -> ["Pospuesto", "por lluvia"]
  const labelParts = s => { const i = String(s).indexOf(' por '); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']; };
  // "7:00 p. m." -> ["7:00", "PM"]
  function clock(ts) {
    const t = D.time(ts), m = /^(\d{1,2}:\d{2})\s*([ap])\.?\s*m\.?$/i.exec(t);
    return m ? [m[1], m[2].toUpperCase() + 'M'] : [t, ''];
  }
  const VENUE_SHORT = {
    'Estadio Monumental de Caracas Simón Bolívar': 'Monumental de Caracas',
    'Estadio Luis Aparicio El Grande': 'Luis Aparicio',
    'Estadio Alfonso Chico Carrasquel': 'Chico Carrasquel',
    'Estadio Jorge Luis García Carneiro': 'García Carneiro',
    'Estadio por definir': 'Por definir'
  };
  const venueShort = n => { const v = PC.venue(n); return VENUE_SHORT[v] || v.replace(/^Estadio\s+/, ''); };

  // La columna fija de la derecha: FINAL, la hora, el inning con bases, outs y cuenta, o el estado especial.
  function statusCol(g) {
    const txt = (label, warn) => {
      const [a, b] = labelParts(label);
      // guion opcional: "Calentamiento" no cabe entero en la columna
      return `<p class="st-txt${warn ? ' warn' : ''}">${esc(a).replace('Calentamiento', 'Calenta&shy;miento')}${b ? `<small>${esc(b)}</small>` : ''}</p>`;
    };
    if (g.status === 'live') {
      if (/delayed/i.test(g.detailed)) return txt(g.label || 'Juego detenido', true) + (g.inning ? `<p class="st-sub">${esc(inningShort(g))}</p>` : '');
      const inn = `<p class="st-live"><i aria-hidden="true"></i>${esc(inningShort(g))}</p>`;
      if (g.inningState === 'Middle' || g.inningState === 'End' || !g.inning) return inn;
      return inn + U.bases(g.bases) +
        `<p class="st-sit">${U.outs(g.outs)}<span><span class="sr">Cuenta </span>${g.balls || 0}-${g.strikes || 0}</span></p>`;
    }
    if (g.status === 'final') {
      const sub = finalSub(g.inning, g.sched, g.reason, !g.away.win && !g.home.win && /tied/i.test(g.detailed));
      return `<p class="st-fin">Final${sub ? `<small>${esc(sub)}</small>` : ''}</p>`;
    }
    // En rojo solo si es de hoy o de ayer (es aviso); un pospuesto de hace años es historia, va en gris.
    if (g.status === 'post' || g.status === 'susp') return txt(g.label || (g.status === 'post' ? 'Pospuesto' : 'Suspendido'), D.isoOf(g.ts) >= D.add(D.today(), -1));
    const where = g.venue ? `<p class="st-where">${esc(venueShort(g.venue))}</p>` : '';
    if (g.label) return txt(g.label, /demorado/.test(g.label)) + where;
    if (g.tbd) return `<p class="st-txt">${g.dh === 2 ? 'Al terminar el 1.º' : 'Hora por definir'}</p>` + where;
    const [hh, ap] = clock(g.ts);
    return `<p class="st-time">${esc(hh)}${ap ? `<small>${ap}</small>` : ''}</p>` + where;
  }

  // Notas de la tarjeta (solo si las hay): fase, desempate, doble cartelera, suspendido o reprogramado.
  function notes(g, carry) {
    const out = [];
    if (carry) out.push('Empezó anoche');
    // "Serie final": junto a la columna de estado, "Final" a secas se confunde con el juego terminado
    if (g.type !== 'R') out.push((g.type === 'W' ? 'Serie final' : PC.phaseLabel(D.seasonOf(g.date), g.type, g.series)) + (g.seriesGame ? ` · juego ${g.seriesGame}` : ''));
    if (g.tiebreaker) out.push('Juego de desempate');
    if (g.dh) out.push(`Doble cartelera · juego ${g.dh}${g.sched && g.sched !== 9 ? ` · a ${g.sched} inn.` : ''}`);
    if (g.resumedFrom) out.push(`Reanudación del juego del ${D.short(dayOf(g.resumedFrom))}`);
    else if (g.resumeDate) out.push(g.status === 'final' ? `Suspendido; se terminó el ${D.short(dayOf(g.resumeDate))}` : `Se reanuda el ${D.short(dayOf(g.resumeDate))}`);
    if (g.rescheduledFrom && !g.resumedFrom) out.push(`Reprogramado del ${D.short(dayOf(g.rescheduledFrom))}`);
    if (g.status === 'post' && g.rescheduleDate && dayOf(g.rescheduleDate) !== D.isoOf(g.ts)) out.push(`Se juega el ${D.short(dayOf(g.rescheduleDate))}`);
    // los números no se separan de lo suyo al partir la línea: "juego 1", "a 7 inn.", "21 oct"
    // (sin lookbehind: en Safari anterior a 16.4 es error de sintaxis y el archivo entero no cargaría)
    return out.filter(Boolean).map(x => x.replace(/ (?=\d)/g, '\u00a0').replace(/(\d) /g, '$1\u00a0')).join(' · ');
  }

  // ---------- tarjeta de un juego, tipo marcador ----------
  // opt.carry: juego de anoche que sigue en vivo.
  function card(g, stats, opt) {
    opt = opt || {};
    const row = (s, k) => {
      const t = g[s];
      const win = g.status === 'final' && t.win;
      const rec = t.rec ? `${t.rec.W}-${t.rec.L}` : '';
      const sc = t.score == null || g.status === 'pre' || g.status === 'post' ? '' : t.score;
      return `<div class="gc-t${win ? ' win' : ''}" data-p="${k}">${chipOf(t, 's')}` +
        // la coma escondida: el lector dice "Águilas, 21-19" y no "Águilas21-19"
        `<span class="gc-nm">${esc(team(t.id, { name: t.name }).short)}${rec ? `<span class="sr">, </span><small>${rec}</small>` : ''}</span>` +
        `<span class="gc-sc">${sc}${win ? '<span class="sr"> (ganó)</span>' : ''}</span></div>`;
    };
    const it = (k, v) => `<span><b>${k}</b> ${v}</span>`;
    let foot = '';
    if (g.status === 'final' && g.dec) {
      foot = [['W', 'G'], ['L', 'P'], ['S', 'JS']].filter(([k]) => g.dec[k]).map(([k, l]) => it(l, esc(surname(g.dec[k].name)))).join('');
    } else if (g.status === 'live') {
      foot = (g.batter ? it('Batea', esc(surname(g.batter.name))) : '') + (g.pitcher ? it('Lanza', esc(surname(g.pitcher.name))) : '');
    } else if (g.status === 'pre' && (g.away.prob || g.home.prob)) {
      const pp = s => {
        const p = g[s].prob;
        if (!p) return 'por anunciar';
        const st = stats && stats.pitById.get(p.id);
        return esc(surname(p.name)) + (st && st.line.OUTS ? ` <small>${F.era(st.r.ERA)}</small>` : '');
      };
      foot = it('Abridores', `${pp('away')} vs. ${pp('home')}`);
    }
    const k = notes(g, opt.carry);
    return `<a class="gcard gc ${g.status}" href="#/juego/${g.pk}" data-p="g${g.pk}">` +
      (k ? `<p class="gc-k" data-p="k">${esc(k)}</p>` : '') +
      `<div class="gc-teams" data-p="t">${row('away', 'a')}${row('home', 'h')}</div>` +
      `<div class="gc-st" data-p="s">${statusCol(g)}</div>` +
      (foot ? `<p class="gc-ft" data-p="f">${foot}</p>` : '') + '</a>';
  }

  // Días con juegos alrededor de una fecha (para las flechas) y el primer día de cada temporada.
  async function navDates(date) {
    const s = D.seasonOf(date);
    const seasons = [s - 1, s, s + 1].filter(x => x >= 2016 && x <= API.currentSeason());
    const lists = await Promise.all(seasons.map(x => PC.seasonGames(x, false, true).catch(() => [])));
    const daysOf = list => list.filter(g => g.status !== 'post').map(g => D.isoOf(g.ts));
    const dates = [...new Set([].concat(...lists.map(daysOf)))].sort();
    const openers = new Set(lists.map(l => daysOf(l).sort()[0]).filter(Boolean));
    let prev = null, next = null;
    for (const d of dates) { if (d < date) prev = d; else if (d > date && !next) next = d; }
    return { prev, next, openers };
  }

  // Ganador de una serie a 4 triunfos (los empates no cuentan).
  function seriesWins(games) {
    const w = {};
    games.forEach(g => {
      if (g.status !== 'final' || (!g.away.win && !g.home.win)) return;
      const x = g.away.win ? g.away.id : g.home.id;
      w[x] = (w[x] || 0) + 1;
    });
    return w;
  }
  function champion(games) {
    const fin = games.filter(g => g.type === 'W' && g.status === 'final');
    if (!fin.length) return null;
    const wins = seriesWins(fin);
    const ids = [...new Set([].concat(...fin.map(g => [g.away.id, g.home.id])))].sort((x, y) => (wins[y] || 0) - (wins[x] || 0));
    if ((wins[ids[0]] || 0) < 4) return null;
    return { id: ids[0], opp: ids[1], w: wins[ids[0]] || 0, l: wins[ids[1]] || 0 };
  }
  PC.champion = champion;
  PC.seriesWins = seriesWins;
  PC.gameCard = card;

  // brief: las tarjetas de la jornada inaugural ya están en pantalla; no se repite el juego ni la fecha.
  function countdown(up, brief) {
    const g = up.game, days = D.diff(D.today(), g.date);
    const when = days > 1 ? `Faltan ${days} días` : days === 1 ? 'Arranca mañana' : 'Arranca hoy';
    return `<section class="countdown" data-p="cd">
      <p class="eyebrow">Temporada ${PC.seasonLabel(up.season)}</p>
      <p class="cd-big">${when}</p>
      ${brief ? '' : `<p class="cd-game"><b>${esc(team(g.away.id).name)}</b> visita a <b>${esc(team(g.home.id).name)}</b></p>
      <p class="cd-meta">${esc(D.long(g.date))} · ${esc(D.time(g.ts))} · ${esc(PC.venue(g.venue))}</p>`}
    </section>`;
  }

  // Le pone la clave data-p al primer elemento de un trozo de HTML.
  const withKey = (html, k) => html.replace(/^\s*<([a-z0-9]+)/i, `<$1 data-p="${k}"`);
  // Juegos de relleno "por definir" que la API marca como terminados.
  const realGames = list => list.filter(g => !(g.status === 'final' && (!PC.TEAMS[g.away.id] || !PC.TEAMS[g.home.id])));

  // ---------- vista: juegos del día ----------
  async function drawDay(el, ctx) {
    const d = ctx.data, date = d.date, today = D.today(), isToday = date === today;
    const live = !!d.live;
    const up = PC.state.upcoming;
    // En pretemporada, de hoy a la víspera de la inauguración no hay juegos: la jornada inaugural se pide ya, junto
    // con el día y el calendario, y no después (un viaje más a la red en serie). Mismo pedido que el de abajo.
    const guess = up && date >= today && date < up.game.date ? API.day(up.game.date).catch(() => null) : null;
    const tasks = [API.day(date, live), navDates(date)];
    // Ayer solo de madrugada (el mismo criterio de pulse() en core.js): un juego de anoche que sigue pasada la
    // medianoche. Más tarde, con live, se bajaría fresco en cada refresco de 15 s sin necesidad.
    if (isToday && D.hourVE() < 5) tasks.push(API.day(D.add(date, -1), live).catch(() => null));
    const [day, nav, prevDay] = await Promise.all(tasks);
    if (!ctx.alive()) return;
    // Un juego de anoche que sigue en vivo pasada la medianoche se queda en "Hoy".
    const carry = prevDay ? C.flatSchedule(prevDay).filter(g => g.status === 'live') : [];
    const games = realGames(carry.concat(C.flatSchedule(day)));
    const nLive = games.filter(g => g.status === 'live').length;
    d.live = nLive > 0;
    d.pending = date >= D.add(today, -1) && games.some(g => g.status === 'pre' || g.status === 'live' || g.status === 'susp');
    // Día sin juegos: se muestran directamente los del próximo día de juego (en pretemporada, la jornada inaugural).
    let next = null;
    if (!games.length && nav.next) {
      try {
        let raw = guess && nav.next === up.game.date ? await guess : null;
        if (!raw) raw = await API.day(nav.next);
        next = realGames(C.flatSchedule(raw));
      } catch (e) { next = null; }
      if (!ctx.alive()) return;
      if (next && !next.length) next = null;
    }
    const shown = games.length ? games : next || [];
    let stats = null;
    if (shown.some(g => g.status === 'pre' && (g.away.prob || g.home.prob))) {
      try { stats = await PC.statsCtx(Math.min(D.seasonOf(shown[0].date || date), PC.state.season), 'R'); } catch (e) { stats = null; }
      if (!ctx.alive()) return;
    }

    const dd = D.diff(today, date);
    const rel = isToday ? 'Hoy' : dd === -1 ? 'Ayer' : dd === 1 ? 'Mañana' : dd < 0 ? `Hace ${-dd} días` : `En ${dd} días`;
    const count = games.length ? `${games.length} juego${games.length === 1 ? '' : 's'}` : 'sin juegos';
    // Cada «·» va al final de su trozo (que no parte la línea): así ninguna línea empieza con «·».
    const sub = [esc(rel), count];
    if (nLive) sub.push(`<b class="db-live">${nLive} en vivo</b>`);
    if (!isToday) sub.push(`<a class="db-today" href="#/juegos/${today}" data-replace>ir a hoy</a>`);
    const arrow = (to, back) => (to
      ? `<a class="db-btn" href="#/juegos/${to}" data-replace aria-label="${back ? 'Día de juego anterior' : 'Siguiente día de juego'}: ${esc(D.long(to))}">${back ? I_LEFT : I_RIGHT}</a>`
      : `<span class="db-btn off" aria-hidden="true">${back ? I_LEFT : I_RIGHT}</span>`);
    // El título de la pantalla, solo para el lector (lo visible es la barra de la fecha).
    const blocks = [`<h1 class="sr" data-p="h1">Juegos del ${esc(dayText(date, D.seasonOf(date) !== D.seasonOf(today)))}</h1>`, `<div class="datebar" data-p="db">
      ${arrow(nav.prev, true)}
      <div class="db-mid">
        <label class="db-date" for="pick-date">${esc(D.long(date, D.seasonOf(date) !== D.seasonOf(today)))}</label>
        <p class="db-sub">${sub.map((s, i) => `<span>${s}${i < sub.length - 1 ? ' ·' : ''}</span>`).join(' ')}</p>
        <input type="date" id="pick-date" class="db-input" value="${date}" aria-label="Elegir fecha">
      </div>
      ${arrow(nav.next, false)}
    </div>`];

    const withCountdown =!!up && date <= up.game.date && date >= D.add(up.game.date, -60);
    const openerShown = !!up && ((next && nav.next === up.game.date) || (games.length && date === up.game.date));
    if (withCountdown) blocks.push(countdown(up, openerShown));
    if (games.length) {
      blocks.push(`<div class="games" data-p="games">${games.map(g => card(g, stats, { carry: carry.indexOf(g) >= 0 })).join('')}</div>`);
    } else if (next) {
      const title = `${nav.openers.has(nav.next) ? 'Jornada inaugural' : 'Próximos juegos'} · ${dayText(nav.next, D.seasonOf(nav.next) !== D.seasonOf(today))}`;
      blocks.push(`<section class="sec" data-p="next">${U.head(title)}<div class="games">${next.map(g => card(g, stats)).join('')}</div></section>`);
    } else if (!withCountdown) {
      const go = [];
      if (nav.next) go.push(`<a class="btn" href="#/juegos/${nav.next}" data-replace>Próximos juegos: ${esc(D.long(nav.next))}</a>`);
      if (nav.prev) go.push(`<a class="btn ghost" href="#/juegos/${nav.prev}" data-replace>Últimos juegos: ${esc(D.long(nav.prev))}</a>`);
      blocks.push(withKey(U.empty('No hay juegos este día', go.join(' ')), 'empty'));
    }
    if (!games.length && up) {
      const last = await PC.seasonGames(PC.state.season).catch(() => []);
      if (!ctx.alive()) return;
      const ch = champion(last);
      if (ch) {
        blocks.push(`<section class="champ" data-p="champ"><p class="eyebrow">Campeón ${PC.seasonLabel(PC.state.season)}</p>
          <p class="champ-t">${esc(team(ch.id).name)}</p>
          <p>Ganó la final ${ch.w}-${ch.l} a ${esc(team(ch.opp).name)}. <a href="#/tabla/W">Ver la serie</a> · <a href="#/lideres">Líderes de la temporada</a></p></section>`);
      }
    }
    blocks.push(withKey(U.fresh(API.when(day)), 'fresh'));
    if (!ctx.alive()) return;
    // La primera vez se pinta todo; en el refresco solo cambian las tarjetas (por gamePk) y los bloques que cambiaron.
    if (d.drawn) { morphHTML(el, blocks.join('')); PC.updateAgo(); } else { el.innerHTML = blocks.join(''); d.drawn = true; }
  }

  // El selector de fecha, delegado: el bloque de la fecha puede cambiarse en el refresco.
  // Cambiar de día reemplaza la pantalla por el camino de la app (como las flechas de día, data-replace): con
  // location.replace directo la pila interna del historial lo contaría como un paso nuevo.
  document.addEventListener('change', e => {
    const t = e.target;
    if (t && t.id === 'pick-date' && t.value) PC.go('#/juegos/' + t.value, { replace: true, keep: true });
  });
  // Con ratón, tocar la fecha abre el calendario (en el teléfono ya lo abre el propio campo).
  document.addEventListener('click', e => {
    const t = e.target;
    if (!t || t.id !== 'pick-date' || !t.showPicker || !root.matchMedia || !root.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    try { t.showPicker(); } catch (err) { /* sin gesto del usuario o el navegador no lo permite */ }
  });

  PC.register('juegos', {
    tab: 'juegos',
    skeleton: 'juegos',
    every: ctx => (ctx.data.live ? 15000 : ctx.data.pending ? 120000 : 0),
    async render(el, args, ctx) {
      let date = /^\d{4}-\d{2}-\d{2}$/.test(args[0] || '') ? args[0] : null;
      if (!date) {
        const today = D.today();
        date = today;
        if (!PC.state.upcoming && D.seasonOf(today) !== PC.state.season) {
          const games = await PC.seasonGames(PC.state.season).catch(() => []);
          const played = games.filter(g => g.status === 'final');
          if (played.length) date = played[played.length - 1].date;
        }
      }
      ctx.data.date = date;
      await drawDay(el, ctx);
    },
    refresh(el, args, ctx) { return drawDay(el, ctx); }
  });

  // =====================================================================================
  // ---------- vista: un juego ----------
  // Firma del momento del juego: si no cambia, basta con repintar la pizarra (cuenta y corredores).
  const sigOf = (ls, st) => {
    ls = ls || {};
    const t = ls.teams || {}, o = ls.offense || {};
    return [st && st.statusCode, st && st.codedGameState, ls.currentInning, ls.inningHalf, ls.inningState, ls.outs,
      t.away && t.away.runs, t.home && t.home.runs, o.batter && o.batter.id].join('|');
  };

  function player(d, id) {
    const bx = d.feed.liveData.boxscore.teams;
    return bx.away.players['ID' + id] || bx.home.players['ID' + id] || null;
  }
  const side = (d, s) => { const t = d.feed.gameData.teams[s]; return Object.assign({ id: t.id }, team(t.id, t)); };

  function halfLabel(inning, top, state) {
    if (state === 'Middle') return `Mitad del ${ord(inning)}`;
    if (state === 'End') return `Final del ${ord(inning)}`;
    return `${top ? 'Alta' : 'Baja'} del ${ord(inning)}`;
  }

  // Momento que muestra la pizarra: el de la repetición (cursor) o el de ahora.
  function moment(d) {
    const f = d.feed, ls = d.ls || f.liveData.linescore || {};
    const st = d.cursor != null ? C.stateAt(d.done, d.cursor) : null;
    const T = ls.teams || { away: {}, home: {} };
    const tot = st ? st.tot : {
      away: { r: T.away.runs || 0, h: T.away.hits || 0, e: T.away.errors || 0 },
      home: { r: T.home.runs || 0, h: T.home.hits || 0, e: T.home.errors || 0 }
    };
    const off = ls.offense || {};
    return {
      ls, st, tot,
      inning: st ? st.inning : ls.currentInning, top: st ? st.top : ls.isTopInning, state: st ? null : ls.inningState,
      bases: st ? st.bases : [!!off.first, !!off.second, !!off.third],
      outs: st ? st.outs : ls.outs || 0, balls: ls.balls || 0, strikes: ls.strikes || 0
    };
  }

  // La pizarra: marcador por inning, C-H-E y, en vivo, cuenta, outs, corredores y el duelo actual.
  // Cada parte lleva su data-p para que el refresco cambie solo la que cambió.
  function boardInner(d) {
    const f = d.feed, g = f.gameData;
    const M = moment(d), ls = M.ls, st = M.st, tot = M.tot;
    const stObj = d.st || g.status || {};
    const A = side(d, 'away'), H = side(d, 'home');
    const sched = ls.scheduledInnings || 9;
    const inns = st
      ? st.innings.map(I => ({ away: I.played.away ? I.away.r : null, home: I.played.home ? I.home.r : null }))
      : (ls.innings || []).map(I => ({
        away: I.away && I.away.runs != null ? I.away.runs : null,
        home: I.home && I.home.runs != null ? I.home.runs : null
      }));
    const n = Math.max(sched, inns.length);
    const final = d.status === 'final' && !st;
    // Último inning jugado: en un juego acortado por lluvia la API rellena la pizarra hasta el 9.º con innings vacíos.
    const lastInn = (final && ls.currentInning) || inns.length;
    const cell = (i, s) => {
      const I = inns[i];
      if (!I) return '';
      if (I[s] == null) return final && s === 'home' && i === lastInn - 1 && tot.home.r > tot.away.r ? 'X' : '';
      return I[s];
    };
    const live = d.status === 'live' && !st;
    const isCur = (i, s) => (live || st) && i + 1 === M.inning && (s === 'away') === !!M.top;
    const score = s => tot[s].r;
    const lead = d.status === 'pre' || d.status === 'post' ? null : score('away') > score('home') ? 'away' : score('home') > score('away') ? 'home' : null;
    const rec = s => { const r = g.teams[s].record; return r && r.wins != null ? `${r.wins}-${r.losses}` : ''; };
    const label = C.statusText(stObj);

    let status;
    if (st) status = `<span class="pill rp-pill">Repetición</span> ${esc(halfLabel(st.inning, st.top))} · ${st.outs} out${st.outs === 1 ? '' : 's'}`;
    else if (d.status === 'live' && /delayed/i.test(stObj.detailedState || '')) status = `<span class="pill warn">${esc(label || 'Juego detenido')}</span> ${esc(halfLabel(ls.currentInning, ls.isTopInning, ls.inningState))}`;
    else if (d.status === 'live') status = `<span class="pill live"><i aria-hidden="true"></i>En vivo</span> ${esc(halfLabel(ls.currentInning, ls.isTopInning, ls.inningState))}${label ? ` · ${esc(label)}` : ''}`;
    else if (d.status === 'final') {
      const tied = /tied/i.test(stObj.detailedState || '');
      status = `<span class="pill fin">${esc(finalText(ls.currentInning, sched, stObj.reason, tied))}</span>`;
    } else if (d.status === 'post' || d.status === 'susp') status = `<span class="pill warn">${esc(label || (d.status === 'post' ? 'Pospuesto' : 'Suspendido'))}</span>`;
    else {
      const tbd = stObj.startTimeTBD || (g.datetime && g.datetime.startTimeTBD);
      const when = label || (tbd ? (g.game && g.game.gameNumber === 2 ? 'Al terminar el 1.º' : 'Hora por definir') : D.time(Date.parse(g.datetime.dateTime)));
      status = `<span class="pill ${/demorado/.test(label || '') ? 'warn' : 'pre'}">${esc(when)}</span> ${esc(D.long(g.datetime.officialDate))}`;
    }

    let duel = '';
    if (st || live) {
      const bulbs = (n2, on, lab) => `<span class="bulbs" role="img" aria-label="${lab}: ${on}"><b>${lab[0]}</b>${Array.from({ length: n2 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
      const counts = live ? bulbs(3, M.balls, 'Bolas') + bulbs(2, M.strikes, 'Strikes') : '';
      const bat = st ? st.batter : ls.offense && ls.offense.batter;
      const pit = st ? st.pitcher : ls.defense && ls.defense.pitcher;
      const bl = bat && player(d, bat.id), pl = pit && player(d, pit.id);
      const bLine = bl && bl.stats && bl.stats.batting && !st ? ` <small>${bl.stats.batting.hits || 0}-${bl.stats.batting.atBats || 0} hoy</small>` : '';
      const pLine = pl && pl.stats && pl.stats.pitching && !st ? ` <small>${pl.stats.pitching.numberOfPitches || pl.stats.pitching.pitchesThrown || 0} lanzamientos</small>` : '';
      duel = `<div class="duel" data-p="du">
        <div class="duel-state">${U.bases(M.bases, true)}${counts}${bulbs(2, Math.min(2, M.outs), 'Outs')}</div>
        <div class="duel-mu">
          ${bat ? `<p><span>${st ? 'Bateó' : 'Batea'}</span> ${U.player(bat.id, bat.fullName)}${bLine}</p>` : ''}
          ${pit ? `<p><span>${st ? 'Lanzó' : 'Lanza'}</span> ${U.player(pit.id, pit.fullName)}${pLine}</p>` : ''}
        </div></div>`;
      const cp = f.liveData.plays.currentPlay;
      const last = st ? st.desc : (cp && cp.result && cp.result.description) || (d.done.length ? d.done[d.done.length - 1].result.description : '');
      if (last) duel += `<p class="lastplay" data-p="lp">${esc(C.cleanEs(last))}</p>`;
    }

    const teamRow = (s, t) => {
      const link = PC.TEAMS[t.id] ? `href="#/equipo/${t.id}"` : '';
      return `<div class="bt-row${lead === s ? ' lead' : ''}" data-p="${s}"><span class="bt-abbr">${esc(t.abbr)}</span>` +
        `<a class="bt-name" ${link} title="${esc(t.name)}">${esc(t.short)}<small>${rec(s)}</small></a>` +
        `<span class="bt-runs">${d.status === 'pre' || d.status === 'post' ? '' : score(s)}</span></div>`;
    };
    const lineTable = d.status === 'pre' || d.status === 'post' ? '' : `<div class="bt-line" data-p="ln"><table aria-label="Carreras por inning">
      <thead><tr><th><span class="sr">Equipo</span></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th class="rhe">C</th><th class="rhe">H</th><th class="rhe">E</th></tr></thead>
      <tbody>${[['away', A], ['home', H]].map(([s, t]) => `<tr><th scope="row">${esc(t.abbr)}</th>${Array.from({ length: n }, (_, i) =>
        `<td${isCur(i, s) ? ' class="cur"' : ''}>${cell(i, s)}</td>`).join('')}<td class="rhe r">${tot[s].r}</td><td class="rhe">${tot[s].h}</td><td class="rhe">${tot[s].e}</td></tr>`).join('')}</tbody>
    </table></div>`;
    return `<p class="bt-status" data-p="st">${status}<span class="bt-venue">${esc(PC.venue(g.venue && g.venue.name))}</span></p>
      ${teamRow('away', A)}${teamRow('home', H)}
      ${lineTable}
      ${duel}`;
  }

  // ---------- la línea de innings: lo que se ve y lo que queda escondido ----------
  // C, H y E van fijas a la derecha (styles.css) y los innings que no caben pasan por debajo: un inning se ve si
  // queda a la izquierda de C, no del borde de la línea. FADE: lo que ocupa el degradado que avisa que hay más, junto
  // a C (sus 24 px y los 2 de la sombra de C) o en el borde izquierdo (css/juegos.css).
  const FADE = 26;
  // La pista: .ln-r en la pizarra si queda algún inning debajo de C-H-E, .ln-l si se fueron por la izquierda.
  // Va en .board y no en la línea: paint() compara la línea con la nueva y una clase de más la haría rehacer.
  function lineEdges(board, line) {
    const max = line.scrollWidth - line.clientWidth, x = line.scrollLeft;
    board.classList.toggle('ln-l', x > 1);
    board.classList.toggle('ln-r', x < max - 1);
  }
  // El inning en juego (o el de la jugada elegida en la repetición) a la vista, fuera del degradado. Solo al pintar
  // la pantalla, cuando cambia de mitad o con force: si la persona deslizó la línea para ver otro inning, un
  // lanzamiento no se la devuelve.
  function showInning(el, force) {
    const board = el.querySelector('.board-wrap > .board'), line = board && board.querySelector('.bt-line');
    if (!line) return;
    const cur = line.querySelector('td.cur');
    const k = cur ? `${cur.parentNode.rowIndex}-${cur.cellIndex}` : '';
    if (cur && (force || k !== board._cur)) {
      const r = cur.getBoundingClientRect(), lr = line.getBoundingClientRect(), c = cur.parentNode.querySelector('.rhe');
      const end = (c ? c.getBoundingClientRect().left : lr.right) - FADE, start = lr.left + FADE;
      const max = line.scrollWidth - line.clientWidth;
      // si lo que quedaría escondido de ese lado es poco (la columna de los equipos, un inning), hasta el borde
      if (r.right > end) { const x = line.scrollLeft + r.right - end; line.scrollLeft = x > max - 2 * FADE ? max : x; }
      else if (r.left < start) { const x = line.scrollLeft - (start - r.left); line.scrollLeft = x < 2 * FADE ? 0 : x; }
    }
    board._cur = k;
    lineEdges(board, line);
  }
  // La pizarra y, si cambió de mitad, el inning en juego a la vista.
  function paintBoard(el, d) {
    paint(el.querySelector('.board-wrap > .board'), boardInner(d));
    showInning(el);
  }
  // La pista sigue a la persona cuando desliza la línea (scroll no burbujea: se escucha en la captura).
  document.addEventListener('scroll', e => {
    const t = e.target, b = t && t.classList && t.classList.contains('bt-line') && t.closest('.board');
    if (b) lineEdges(b, t);
  }, { capture: true, passive: true });
  // Al girar el teléfono cambia lo que cabe: la pista se recalcula y el inning en juego vuelve a la vista. Lo segundo
  // solo si cambió el ancho: en el teléfono la barra del navegador cambia el alto al desplazarse la página.
  let lastW = root.innerWidth;
  root.addEventListener('resize', () => {
    const w = root.innerWidth, el = document.getElementById('view');
    if (el) showInning(el, w !== lastW);
    lastW = w;
  });

  // ---------- mini pizarra fija ("chapita"): aparece bajo la cabecera cuando la pizarra sale de la pantalla ----------
  function chapitaHTML(d) {
    const M = moment(d), st = M.st;
    const tm = s => { const t = d.feed.gameData.teams[s]; return `<span class="ch-tm" data-p="${s}">${chipOf({ id: t.id, name: t.name }, 's inv')}<b>${M.tot[s].r}</b></span>`; };
    const inn = M.inning ? `${M.top ? '▲' : '▼'}${M.inning}` : '';
    let right;
    // "REP" cuando no cabe (letra grande en pantalla angosta: css/juegos.css), para no perder bases ni outs
    if (st) right = `<span class="ch-tag"><span class="ch-tag-l">Repetición</span><span class="ch-tag-s" aria-hidden="true">REP</span></span><span class="ch-inn">${inn}</span>${U.bases(M.bases)}${U.outs(M.outs)}`;
    else if (d.status === 'live') {
      const stObj = d.st || d.feed.gameData.status || {};
      if (/delayed/i.test(stObj.detailedState || '')) right = `<span class="ch-inn">${inn}</span><span class="ch-txt">Detenido</span>`;
      else if (M.state === 'Middle' || M.state === 'End') right = `<span class="ch-inn">${M.state === 'Middle' ? 'Mitad' : 'Fin'} ${ord(M.inning)}</span>`;
      else right = `<span class="ch-inn">${inn}</span>${U.bases(M.bases)}${U.outs(M.outs)}<b class="ch-cnt">${M.balls}-${M.strikes}</b>`;
    } else if (d.status === 'final') {
      const ls = M.ls, stObj = d.st || d.feed.gameData.status || {};
      const sub = finalSub(ls.currentInning, ls.scheduledInnings, stObj.reason, /tied/i.test(stObj.detailedState || ''));
      right = `<span class="ch-txt">Final</span>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    } else right = `<span class="ch-txt">${esc(C.statusText(d.st || d.feed.gameData.status) || 'Suspendido')}</span>`;
    return `${tm('away')}${tm('home')}<span class="ch-sep" data-p="sep"></span><span class="ch-st" data-p="st">${right}</span>`;
  }

  let chapEl = null;
  // Alto de la cabecera fija más la franja tricolor.
  const topH = () => { const t = document.querySelector('.top'); return Math.round(t ? t.getBoundingClientRect().height : 56) + 6; };
  function chapita() {
    if (chapEl) return chapEl;
    chapEl = document.createElement('div');
    chapEl.className = 'chapita';
    chapEl.innerHTML = '<button type="button" class="ch-in" aria-label="Subir a la pizarra"></button>';
    chapEl.firstChild.addEventListener('click', () => {
      const w = document.querySelector('#view .board-wrap');
      if (!w) return;
      const y = w.getBoundingClientRect().top + window.scrollY - topH() - 8;
      window.scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'auto' : 'smooth' });
    });
    document.body.appendChild(chapEl);
    return chapEl;
  }
  // Lo que dice el lector al llegar a la chapita: el marcador y el momento, y luego qué hace el botón.
  function chapitaLabel(d) {
    const M = moment(d), st = M.st, A = side(d, 'away'), H = side(d, 'home');
    const outs = n => `${n} out${n === 1 ? '' : 's'}`;
    const half = M.inning ? halfLabel(M.inning, M.top, M.state).toLowerCase() : '';
    let when = '';
    if (st) when = `repetición, ${half}, ${outs(M.outs)}`;
    else if (d.status === 'live') {
      const stopped = /delayed/i.test((d.st || d.feed.gameData.status || {}).detailedState || '');
      when = stopped ? [half, 'juego detenido'].filter(Boolean).join(', ')
        : M.state === 'Middle' || M.state === 'End' ? half : [half, outs(M.outs)].filter(Boolean).join(', ');
    }
    else if (d.status === 'final') when = 'final';
    else when = (C.statusText(d.st || d.feed.gameData.status) || '').toLowerCase();
    return `${A.abbr} ${M.tot.away.r}, ${H.abbr} ${M.tot.home.r}${when ? `, ${when}` : ''}. Subir a la pizarra`;
  }
  function paintChapita(d) {
    if (!chapEl) return;
    if (d.chOn) {
      paint(chapEl.firstChild, chapitaHTML(d));
      const lab = chapitaLabel(d);
      if (chapEl.firstChild.getAttribute('aria-label') !== lab) chapEl.firstChild.setAttribute('aria-label', lab);
    }
    chapEl.classList.toggle('on', !!d.chOn);
  }
  function unwatch(d) {
    if (d.io) { d.io.disconnect(); d.io = null; }
    d.chOn = false;
    if (chapEl) chapEl.classList.remove('on');
  }
  function watchBoard(el, d) {
    const wrap = el.querySelector('.board-wrap');
    if (!wrap || typeof IntersectionObserver === 'undefined' || d.status === 'pre' || d.status === 'post') { unwatch(d); return; }
    if (d.io) d.io.disconnect(); // al rehacer la pantalla la chapita no se esconde: el observador nuevo decide
    // La chapita se pega bajo la cabecera con --top-h (core.js lo renueva si la cabecera cambia de alto);
    // aquí el alto solo hace falta para el margen del observador.
    const h = topH();
    chapita();
    d.io = new IntersectionObserver(es => {
      const e = es[es.length - 1];
      d.chOn = !e.isIntersecting && e.boundingClientRect.top < h; // ya pasó hacia arriba (no está más abajo)
      paintChapita(d);
    }, { rootMargin: `-${h}px 0px 0px 0px` });
    d.io.observe(wrap);
  }

  // ---------- probabilidad de ganar, figuras y jugadas clave (hasta la jugada elegida) ----------
  function wpPlays(d) {
    if (!d.wpa) return [];
    return d.cursor != null ? d.wpa.plays.slice(0, d.cursor + 1) : d.wpa.plays;
  }

  // Dos columnas fijas: el nombre de un equipo no se corre cuando cambia el porcentaje del otro.
  function wpNowHTML(d) {
    const plays = wpPlays(d);
    if (!plays.length) return '';
    const v = plays[plays.length - 1].after;
    const a = Math.round(100 - v), h = Math.round(v);
    return `<p data-p="a"><span class="k away" aria-hidden="true"></span>${esc(side(d, 'away').short)} <b>${a}%</b></p>` +
      `<p data-p="h"><span class="k home" aria-hidden="true"></span>${esc(side(d, 'home').short)} <b>${h}%</b></p>`;
  }

  function figsHTML(d) {
    const plays = wpPlays(d);
    const by = {};
    for (const p of plays) {
      const add = (person, v, role, sd) => {
        if (!person || person.id == null) return;
        const k = role + person.id;
        const r = by[k] || (by[k] = { id: person.id, name: person.fullName, role, side: sd, wpa: 0 });
        r.wpa += v;
      };
      add(p.batter, p.swing, 'bat', p.top ? 'away' : 'home');
      add(p.pitcher, -p.swing, 'pit', p.top ? 'home' : 'away');
    }
    const all = Object.values(by).sort((a, b) => b.wpa - a.wpa);
    if (!all.length) return U.note('Todavía no hay jugadas.');
    const pick = all.slice(0, 3).concat(all.length > 4 ? [all[all.length - 1]] : []);
    return `<ol class="figs">${pick.map((r, i) => {
      const t = side(d, r.side);
      const worst = i === 3;
      // toda la fila lleva al jugador (como en Líderes): se hunde al tocarla y además navega
      return `<li class="rowlink${worst ? ' worst' : ''}"><span class="fig-n">${worst ? 'El que más restó' : i + 1}</span>` +
        `<span class="fig-who">${U.player(r.id, r.name).replace('class="plink"', 'class="plink stretch"')} <small>${chipOf({ id: t.id, name: t.name }, 's')} ${r.role === 'bat' ? 'bateador' : 'lanzador'}</small></span>` +
        `<span class="fig-v">${F.signed(r.wpa, 1)}<small> pts</small></span></li>`;
    }).join('')}</ol>`;
  }

  function keysHTML(d) {
    const plays = wpPlays(d);
    if (!plays.length) return '';
    const top = plays.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
    return `<ol class="keys">${top.map(p => {
      const gain = side(d, p.delta < 0 ? 'away' : 'home');
      return `<li><p class="key-h"><span>${esc(halfLabel(p.inning, p.top))}</span><b>${esc(gain.abbr)} ${F.signed(Math.abs(p.delta), 1)} pts</b></p>` +
        `<p>${esc(C.cleanEs(p.desc))}</p></li>`;
    }).join('')}</ol>`;
  }

  // ---------- box score ----------
  const ABBR = [['BE', 'bateador emergente'], ['CE', 'corredor emergente'], ['BD', 'bateador designado'], ['LOB', 'corredores dejados en base'],
    ['Enf.', 'bateadores enfrentados'], ['Lz-St', 'lanzamientos y strikes'], ['G · P', 'lanzador ganador y perdedor'], ['JS', 'juego salvado'],
    ['HLD', 'hold: sostuvo la ventaja en relevo'], ['SD', 'salvado desperdiciado']];
  function boxHTML(d) {
    const bx = d.feed.liveData.boxscore;
    if (!bx || !bx.teams) return '';
    const post = d.feed.gameData.game && d.feed.gameData.game.type !== 'R';
    return ['away', 'home'].map(s => {
      const T = bx.teams[s], t = side(d, s);
      const P = pid => T.players['ID' + pid];
      const bats = (T.batters || []).map(P).filter(p => p && p.battingOrder && p.stats && p.stats.batting)
        .sort((a, b) => +a.battingOrder - +b.battingOrder);
      const pits = (T.pitchers || []).map(P).filter(p => p && p.stats && p.stats.pitching);
      const pos = p => (p.allPositions || [p.position]).filter(Boolean).map(x => C.posEs(x.abbreviation)).join('-');
      const bcols = [
        { k: 'n', label: 'Bateador', first: true, cls: 'name', html: p => `${+p.battingOrder % 100 ? '<span class="sub">↳</span>' : ''}${U.player(p.person.id, p.person.fullName)} <small>${esc(pos(p))}</small>` },
        { k: 'ab', label: 'VB', get: p => p.stats.batting.atBats },
        { k: 'r', label: 'C', get: p => p.stats.batting.runs },
        { k: 'h', label: 'H', get: p => p.stats.batting.hits },
        { k: 'rbi', label: 'CI', get: p => p.stats.batting.rbi },
        { k: 'bb', label: 'BB', get: p => p.stats.batting.baseOnBalls },
        { k: 'so', label: 'K', get: p => p.stats.batting.strikeOuts },
        { k: 'lob', label: 'LOB', title: 'Corredores que dejó en base', get: p => p.stats.batting.leftOnBase },
        { k: 'avg', label: post ? 'AVE post.' : 'AVE', title: post ? 'Promedio en la postemporada, hasta este juego' : '', get: p => (p.seasonStats && p.seasonStats.batting ? p.seasonStats.batting.avg : '') }
      ];
      const tb = (T.teamStats && T.teamStats.batting) || {};
      const pcols = [
        { k: 'n', label: 'Lanzador', first: true, cls: 'name', html: p => `${U.player(p.person.id, p.person.fullName)}${p.stats.pitching.note ? ` <small>${esc(C.noteEs(p.stats.pitching.note))}</small>` : ''}` },
        { k: 'ip', label: 'IL', get: p => p.stats.pitching.inningsPitched },
        { k: 'h', label: 'H', get: p => p.stats.pitching.hits },
        { k: 'r', label: 'C', get: p => p.stats.pitching.runs },
        { k: 'er', label: 'CL', title: 'Carreras limpias', get: p => p.stats.pitching.earnedRuns },
        { k: 'bb', label: 'BB', get: p => p.stats.pitching.baseOnBalls },
        { k: 'so', label: 'K', get: p => p.stats.pitching.strikeOuts },
        { k: 'hr', label: 'HR', get: p => p.stats.pitching.homeRuns },
        { k: 'bf', label: 'Enf.', title: 'Bateadores enfrentados', get: p => p.stats.pitching.battersFaced },
        { k: 'np', label: 'Lz-St', title: 'Lanzamientos y strikes', get: p => `${p.stats.pitching.numberOfPitches || p.stats.pitching.pitchesThrown || 0}-${p.stats.pitching.strikes || 0}` },
        { k: 'era', label: post ? 'EFE post.' : 'EFE', title: post ? 'Efectividad en la postemporada, hasta este juego' : '', get: p => (p.seasonStats && p.seasonStats.pitching ? p.seasonStats.pitching.era : '') }
      ];
      // Toda la fila lleva al jugador (tr.tap: el oyente de core.js toca su primer enlace), no solo el nombre.
      const tap = p => (p.person && p.person.id ? 'tap' : '');
      // label: el nombre con que el lector anuncia cada tabla ("Bateo de Magallanes"), no "Tabla" las cuatro
      return `<section class="box-team" data-p="${s}"><h3>${chipOf({ id: t.id, name: t.name })} ${esc(t.name)}</h3>
        ${U.table(bcols, bats, { cls: 'box', help: false, rowClass: tap, label: `Bateo de ${t.short}`, foot: { n: 'Totales', ab: tb.atBats, r: tb.runs, h: tb.hits, rbi: tb.rbi, bb: tb.baseOnBalls, so: tb.strikeOuts, lob: tb.leftOnBase } })}
        ${U.table(pcols, pits, { cls: 'box', help: false, rowClass: tap, label: `Pitcheo de ${t.short}` })}
      </section>`;
    }).join('') + `<details class="cols-help" data-p="ley"><summary>Qué significa cada abreviatura</summary><dl>` +
      ABBR.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl></details>';
  }

  // ---------- jugada por jugada ----------
  // Además del resultado de cada turno: cambios de lanzador, emergentes, robos, wild pitch, balk y el corredor
  // que arranca en 2.ª en extrainnings (si no, la carrera del 10.º aparece de la nada).
  const ACTIONS = new Set(['pitching_substitution', 'offensive_substitution', 'defensive_substitution', 'defensive_switch', 'runner_placed',
    'stolen_base_2b', 'stolen_base_3b', 'stolen_base_home', 'caught_stealing_2b', 'caught_stealing_3b', 'caught_stealing_home',
    'pickoff_1b', 'pickoff_2b', 'pickoff_3b', 'pickoff_caught_stealing_2b', 'pickoff_caught_stealing_3b', 'pickoff_caught_stealing_home',
    'wild_pitch', 'passed_ball', 'balk', 'defensive_indiff', 'other_advance', 'error']);

  function playsHTML(d) {
    const upto = d.cursor != null ? d.cursor + 1 : d.done.length;
    const plays = d.done.slice(0, upto);
    if (!plays.length) return U.note('Todavía no hay jugadas.');
    const wp = d.wpa ? d.wpa.plays : [];
    const groups = [];
    plays.forEach((p, i) => {
      const k = p.about.inning + (p.about.isTopInning ? 't' : 'b');
      let gr = groups[groups.length - 1];
      if (!gr || gr.k !== k) groups.push(gr = { k, inning: p.about.inning, top: p.about.isTopInning, items: [] });
      const ab = p.atBatIndex != null ? p.atBatIndex : i;
      (p.playEvents || []).forEach((e, j) => {
        const et = e.details && e.details.eventType;
        if (e.type === 'action' && ACTIONS.has(et) && et !== p.result.eventType && e.details.description) {
          gr.items.push({ key: `a${ab}-${e.index != null ? e.index : j}`, act: C.cleanEs(e.details.description) });
        }
      });
      gr.items.push({ key: 'p' + ab, p, w: wp[i] });
    });
    const A = side(d, 'away'), H = side(d, 'home');
    // Lo más reciente arriba; cada mitad e inning lleva su clave para que una jugada nueva solo agregue su fila.
    return groups.reverse().map(gr => {
      const bat = gr.top ? A : H;
      return `<section class="half" data-p="h${gr.k}"><h4 data-p="t">${esc(halfLabel(gr.inning, gr.top))} <small>${esc(bat.short)} al bate</small></h4><ol data-p="l">` +
        gr.items.slice().reverse().map(it => {
          if (it.act) return `<li class="act" data-p="${it.key}"><p>${esc(it.act)}</p></li>`;
          const p = it.p, w = it.w, sc = p.about.isScoringPlay;
          const dl = w ? `<span class="pl-d" title="Cambio en la probabilidad del equipo al bate">${F.signed(w.dswing, 1)}</span>` : '';
          return `<li class="${sc ? 'score' : ''}" data-p="${it.key}"><p><b class="pl-ev">${esc(C.eventEs(p))}</b>${dl}</p>` +
            `<p>${esc(C.cleanEs(p.result.description))}</p>` +
            `<p class="pl-meta">${p.count ? `${p.count.outs} out${p.count.outs === 1 ? '' : 's'}` : ''}${sc ? ` · <b>${esc(A.abbr)} ${p.result.awayScore} – ${p.result.homeScore} ${esc(H.abbr)}</b>` : ''}</p></li>`;
        }).join('') + '</ol></section>';
    }).join('');
  }

  const SKY = {
    Clear: 'Despejado', Sunny: 'Soleado', 'Partly Cloudy': 'Parcialmente nublado', Cloudy: 'Nublado', Overcast: 'Cubierto',
    Drizzle: 'Llovizna', Rain: 'Lluvia', Showers: 'Chubascos', 'Roof Closed': 'Techo cerrado', Dome: 'Techado', Unknown: 'Sin dato'
  };
  const UMP = { 'Home Plate': 'Home', 'First Base': 'Primera', 'Second Base': 'Segunda', 'Third Base': 'Tercera', 'Left Field': 'Jardín izquierdo', 'Right Field': 'Jardín derecho' };
  const WIND = { 'R To L': 'de derecha a izquierda', 'L To R': 'de izquierda a derecha', 'In From CF': 'hacia home desde el center', 'Out To CF': 'hacia el center',
    'In From LF': 'hacia home desde el left', 'In From RF': 'hacia home desde el right', 'Out To LF': 'hacia el left', 'Out To RF': 'hacia el right', Calm: 'en calma', Varies: 'variable', None: 'sin viento' };
  // "5 mph, R To L" -> "8 km/h de derecha a izquierda"
  const wind = s => {
    const m = /^(\d+)\s*mph,?\s*(.*)$/.exec(String(s).trim());
    if (!m) return s;
    const kmh = Math.round(+m[1] * 1.609);
    return kmh ? `${kmh} km/h ${WIND[m[2]] || m[2]}`.trim() : (WIND[m[2]] || 'en calma');
  };
  const hm = min => `${Math.floor(min / 60)} h ${min % 60} min`;

  function infoHTML(d) {
    const g = d.feed.gameData, bx = d.feed.liveData.boxscore || {};
    const gi = g.gameInfo || {}, w = g.weather || {}, gm = g.game || {}, dt = g.datetime || {};
    const rows = [];
    rows.push(['Fecha', `${D.long(dt.officialDate, true)} · ${D.time(Date.parse(dt.dateTime))}`]);
    if (g.venue) rows.push(['Estadio', PC.venue(g.venue.name)]);
    if (gm.type && gm.type !== 'R') rows.push(['Fase', PC.phaseLabel(+gm.season, gm.type, '')]);
    const label = C.statusText(d.st || g.status);
    if (label) rows.push(['Estado', label]);
    if (gm.doubleHeader === 'Y' || gm.doubleHeader === 'S') rows.push(['Doble cartelera', `Juego ${gm.gameNumber}${(d.feed.liveData.linescore || {}).scheduledInnings ? `, a ${d.feed.liveData.linescore.scheduledInnings} innings` : ''}`]);
    if (dt.resumeDate || dt.resumedFrom) {
      const a = dt.resumedFrom ? dayOf(dt.resumedFrom) : dt.officialDate, b = dt.resumeDate ? dayOf(dt.resumeDate) : D.isoOf(Date.parse(dt.dateTime));
      rows.push(['Suspendido', `Empezó el ${D.short(a)} y se terminó el ${D.short(b)}`]);
    }
    if (gi.attendance) rows.push(['Asistencia', Number(gi.attendance).toLocaleString('es-VE')]);
    if (gi.gameDurationMinutes) rows.push(['Duración', hm(gi.gameDurationMinutes)]);
    if (gi.delayDurationMinutes) rows.push(['Demoras', hm(gi.delayDurationMinutes)]);
    if (w.condition) rows.push(['Clima', `${SKY[w.condition] || w.condition}${w.temp ? ` · ${Math.round((+w.temp - 32) * 5 / 9)} °C` : ''}${w.wind ? ` · viento ${wind(w.wind)}` : ''}`]);
    const ump = (bx.officials || []).map(o => `${UMP[o.officialType] || o.officialType}: ${o.official.fullName}`);
    if (ump.length) rows.push(['Umpires', ump.join(' · ')]);
    const dec = d.feed.liveData.decisions;
    if (dec) {
      const p = (k, l) => (dec[k] ? `${l}: ${dec[k].fullName}` : '');
      rows.push(['Decisiones', [p('winner', 'Ganador'), p('loser', 'Perdedor'), p('save', 'Salvado')].filter(Boolean).join(' · ')]);
    }
    return `<dl class="info">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  // ---------- antes del juego: abridores y cómo llegan ----------
  function preHTML(d) {
    const g = d.feed.gameData, pp = g.probablePitchers || {}, st = d.stats;
    const one = s => {
      const p = pp[s], t = side(d, s);
      const x = p && st ? st.pitById.get(p.id) : null;
      const line = x && x.line.OUTS ? `${x.line.W}-${x.line.L} · EFE ${F.era(x.r.ERA)} · WHIP ${F.era(x.r.WHIP)} · K% ${F.pct(x.r.KPct)} · ${F.ip(x.line.OUTS)} IL` : 'Sin lanzar en la temporada';
      return `<div class="prob"><p class="prob-t">${chipOf({ id: t.id, name: t.name }, 's')} ${esc(t.short)}</p>` +
        (p ? `<p class="prob-n">${U.player(p.id, p.fullName)}</p><p class="prob-l">${esc(line)}</p>` : '<p class="prob-n">Por anunciar</p>') + '</div>';
    };
    return `<section class="sec">${U.head('Abridores probables')}<div class="probs">${one('away')}${one('home')}</div></section>`;
  }

  // ---------- montaje ----------
  // La curva se vuelve a dibujar solo si llegó una jugada nueva o se movió la repetición.
  function drawWP(el, d) {
    const box = el.querySelector('#wp-chart');
    if (!box || !d.wpa || !d.wpa.plays.length) return;
    const n = d.wpa.plays.length;
    const key = `${n}|${d.wpa.plays[n - 1].after}|${d.cursor}|${d.status}`;
    if (box._k === key) return;
    box._k = key;
    const total = d.status === 'final' ? n : Math.max(n + 8, 78);
    CH.responsive(box, () => CH.winProb(box, d.wpa.plays, {
      away: side(d, 'away').abbr, home: side(d, 'home').abbr, total, cursor: d.cursor
    }));
  }

  const TABS = [['box', 'Box score'], ['jugadas', 'Jugada a jugada'], ['info', 'Datos']];
  const PANELS = {
    box: d => (d.status === 'pre' || d.status === 'post' ? U.note('El box score aparece cuando empiece el juego.') : boxHTML(d)),
    jugadas: playsHTML,
    info: infoHTML
  };
  // Solo se pinta la pestaña visible; las otras quedan marcadas y se pintan al abrirlas.
  function paintPanel(el, d, k) {
    paint(el.querySelector('#tab-' + k), PANELS[k](d));
    d.stale.delete(k);
  }
  function showTab(el, d, k) {
    d.tab = k;
    // con el teclado, Tab entra solo a la pestaña elegida; las flechas cambian de pestaña (draw)
    el.querySelectorAll('.seg [data-tab]').forEach(b => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    TABS.forEach(([x]) => { const p = el.querySelector('#tab-' + x); if (p) p.hidden = x !== k; });
    if (d.stale.has(k)) paintPanel(el, d, k);
  }

  const rpText = d => {
    const k = d.cursor == null ? d.done.length - 1 : d.cursor;
    const p = d.done[k];
    return p ? `Jugada ${k + 1} de ${d.done.length} · ${halfLabel(p.about.inning, p.about.isTopInning)}` : '';
  };
  const rpButton = s => (s === 'pausa' ? `${I_PAUSE}<span>Pausa</span>` : `${I_PLAY}<span>${s === 'seguir' ? 'Seguir' : 'Repetir'}</span>`);

  // Lo que obliga a rehacer la pantalla: cambia el estado (por jugar, en vivo, final) o aparece la primera jugada.
  const layoutOf = d => `${d.status}|${d.wpa && d.wpa.plays.length ? 1 : 0}`;

  // ---------- lo que oye el lector de pantalla en vivo ----------
  // "Magallanes 5, Caribes 4. Baja del 7.º, 2 outs. <última jugada>"
  function liveText(d) {
    const M = moment(d), A = side(d, 'away'), H = side(d, 'home');
    const score = `${A.short} ${M.tot.away.r}, ${H.short} ${M.tot.home.r}.`;
    if (d.status === 'final') return `Final. ${score}`;
    const mid = M.state === 'Middle' || M.state === 'End';
    const when = M.inning ? `${halfLabel(M.inning, M.top, M.state)}${mid ? '' : `, ${M.outs} out${M.outs === 1 ? '' : 's'}`}.` : '';
    const cp = d.feed.liveData.plays.currentPlay;
    const last = (cp && cp.result && cp.result.description) || (d.done.length ? d.done[d.done.length - 1].result.description : '');
    return [score, when, last ? C.cleanEs(last) : ''].filter(Boolean).join(' ');
  }
  // Se anuncia solo cuando cambia el momento del juego (carreras, inning, outs o bateador: sigOf), no en cada
  // lanzamiento. Al abrir la pantalla no se anuncia nada (la pizarra ya se lee); la repetición tiene su control.
  function announce(el, d) {
    if (d.cursor != null) return;
    const was = d.srSig;
    d.srSig = d.sig;
    if (was == null || was === d.sig || (d.status !== 'live' && d.status !== 'final')) return;
    const box = el.querySelector('#vivo-sr');
    if (!box) return;
    const txt = liveText(d);
    // con un respiro: si la pantalla se acaba de rehacer, el lector tiene que ver la región vacía antes del texto
    setTimeout(() => { if (box.isConnected) box.textContent = txt; }, 250);
  }

  // Refresco y repetición: cada pieza se compara con la que hay y cambia solo si hace falta.
  function update(el, d) {
    paintBoard(el, d);
    paint(el.querySelector('#wp-now'), wpNowHTML(d));
    drawWP(el, d);
    paint(el.querySelector('#figs'), figsHTML(d));
    paint(el.querySelector('#keys'), keysHTML(d));
    TABS.forEach(([k]) => d.stale.add(k));
    paintPanel(el, d, d.tab);
    const lab = el.querySelector('.rp-label');
    if (lab) lab.textContent = rpText(d);
    // el lector dice "Jugada 88 de 89 · Baja del 9.º", no "88"
    const rp = el.querySelector('#rp');
    if (rp) rp.setAttribute('aria-valuetext', rpText(d));
    paintChapita(d);
    announce(el, d);
  }

  function stopReplay(d) {
    if (d && d.timer) { clearInterval(d.timer); d.timer = null; }
  }

  // La jugada elegida en la repetición, para cuando se vuelve: al abrir un jugador desde el juego y volver atrás, la
  // pantalla se rehace (core.js) y sin esto la repetición saltaría a la última jugada. Se guarda por juego y por su
  // lugar en el historial (history.state.pc, lo pone core.js antes de pintar); si desde el juego se vuelve atrás (a un
  // lugar anterior), se olvida: entrar otra vez al juego desde la lista lo abre en el final, como siempre.
  const cursors = new Map();
  function keepCursor(d) {
    if (d.spot == null || !d.layout) return; // se fue antes de pintar: lo guardado sigue valiendo
    const s = history.state, back = !!s && typeof s.pc === 'number' && s.pc < d.pos;
    cursors.delete(d.spot);
    if (!back && d.cursor != null) cursors.set(d.spot, d.cursor);
    if (cursors.size > 20) cursors.delete(cursors.keys().next().value);
  }

  function draw(el, ctx, keep) {
    const d = ctx.data, g = d.feed.gameData;
    const y = keep ? window.scrollY : 0;
    const tab = (keep && d.tab) || (d.status === 'pre' || d.status === 'post' ? 'info' : 'box');
    d.layout = layoutOf(d);
    const hasWP = d.wpa && d.wpa.plays.length;
    const A = side(d, 'away'), H = side(d, 'home');
    const replay = d.status === 'final' && hasWP ? `<section class="replay" aria-label="Repetir el juego">
        <div class="rp-row"><button type="button" class="btn rp-play" aria-pressed="false">${rpButton(d.cursor == null ? 'repetir' : 'seguir')}</button>
        <input type="range" id="rp" min="0" max="${d.done.length - 1}" value="${d.cursor == null ? d.done.length - 1 : d.cursor}" aria-label="Elegir jugada"></div>
        <p class="rp-label">${esc(rpText(d))}</p></section>` : '';
    const wp = hasWP ? `<section class="sec">
        ${U.head('Probabilidad de ganar', 'Se recalcula en cada turno con el marcador, el inning, los outs y los corredores. Toca la curva para ver la jugada.')}
        <div id="wp-now" class="wp-now"></div>
        <div id="wp-chart" class="wp-chart"></div>
        <p class="viz-key"><span><span class="k away" aria-hidden="true"></span>${esc(A.abbr)} gana hacia arriba ·</span> <span><span class="k home" aria-hidden="true"></span>${esc(H.abbr)} hacia abajo ·</span> <span class="vk-li">barras: presión del turno (LI)</span></p>
      </section>
      <section class="sec">${U.head('Figuras del juego', 'Aporte a la victoria (WPA): puntos de probabilidad que cada uno le sumó o le restó a su equipo.')}<div id="figs"></div></section>
      <section class="sec">${U.head('Jugadas clave', 'Las que más movieron la probabilidad de ganar.')}<div id="keys"></div></section>` : '';
    const date = g.datetime.officialDate;
    // El armazón va vacío; las piezas (pizarra, porcentajes, curva, figuras, pestaña visible) las llena update(),
    // el mismo camino del refresco.
    // La miga no lleva data-back: dice "Juegos del 27 dic" y lleva a ese día (core.js vuelve atrás solo si la
    // pantalla anterior es ese día; si se llegó desde un equipo o un jugador, abre el día como paso nuevo).
    // El h1 y la región que se anuncia en vivo son solo para el lector de pantalla.
    el.innerHTML = `<nav class="crumbs"><a class="gm-back" href="#/juegos/${date}">${I_LEFT}<span>Juegos del ${esc(D.short(date))}</span></a></nav>
      <h1 class="sr">${esc(A.name)} en ${esc(H.name)}</h1>
      <section class="board-wrap"><div class="board"></div></section>
      <p id="vivo-sr" class="sr" aria-live="polite"></p>
      ${replay}
      ${d.status === 'pre' ? preHTML(d) : ''}
      ${wp}
      <section class="sec">
        <div class="seg" role="tablist" aria-label="Detalle del juego">${TABS.map(([k, l]) => `<button type="button" role="tab" id="tb-${k}" data-tab="${k}" aria-controls="tab-${k}" aria-selected="false">${l}</button>`).join('')}</div>
        ${TABS.map(([k]) => `<div id="tab-${k}" role="tabpanel" aria-labelledby="tb-${k}" hidden></div>`).join('')}
      </section>
      ${U.fresh(API.when(d.feed))}`;
    d.tab = tab;
    d.stale = new Set();
    // update() pinta la pizarra mostrando el inning en juego (showInning: extrainnings, letra grande). Si la letra de
    // la pizarra todavía está cargando, las casillas cambian de ancho al llegar: se vuelve a mirar.
    update(el, d);
    showTab(el, d, tab);
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (ctx.alive()) showInning(el, true); });

    el.querySelectorAll('.seg [data-tab]').forEach(b => b.addEventListener('click', () => showTab(el, d, b.dataset.tab)));
    // Teclado de unas pestañas (role=tab): flechas a los lados, Inicio y Fin.
    const seg = el.querySelector('.seg');
    seg.addEventListener('keydown', e => {
      const keys = TABS.map(([k]) => k), i = keys.indexOf(d.tab), n = keys.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      showTab(el, d, keys[j]);
      seg.querySelector(`[data-tab="${keys[j]}"]`).focus();
    });

    const rp = el.querySelector('#rp');
    if (rp) {
      const btn = el.querySelector('.rp-play');
      const last = d.done.length - 1;
      const setBtn = s => { btn.innerHTML = rpButton(s); btn.setAttribute('aria-pressed', String(s === 'pausa')); };
      const setK = k => { d.cursor = k >= last ? null : k; rp.value = String(k); update(el, d); };
      rp.addEventListener('input', () => { stopReplay(d); setBtn('repetir'); setK(+rp.value); });
      btn.addEventListener('click', () => {
        if (d.timer) { stopReplay(d); setBtn('seguir'); return; }
        let k = d.cursor == null ? 0 : d.cursor;
        setK(k);
        setBtn('pausa');
        d.timer = setInterval(() => {
          k++;
          if (k >= last || !ctx.alive()) { stopReplay(d); setK(last); setBtn('repetir'); return; }
          setK(k);
        }, 900);
      });
    }
    watchBoard(el, d);
    if (keep) window.scrollTo(0, y);
  }

  async function load(ctx, feed, live, watch) {
    const d = ctx.data;
    const before = d.status;
    d.feed = feed;
    d.ls = null;
    d.st = watch && watch.gameData ? watch.gameData.status : null;
    d.status = C.gameStatus(feed.gameData.status);
    d.warm = /warmup/i.test(feed.gameData.status.detailedState || '');
    d.sig = sigOf(feed.liveData.linescore, feed.gameData.status);
    if (d.status === 'final' && before && before !== 'final') d.finalAt = Date.now(); // seguir un rato: llegan las decisiones
    d.done = (feed.liveData.plays.allPlays || []).filter(p => p.about && p.about.isComplete);
    d.wpa = null;
    if (d.status !== 'pre' && d.status !== 'post' && d.done.length) {
      try { d.wpa = C.wpa(await API.winProb(d.pk, live)); } catch (e) { d.wpa = null; }
      if (d.wpa && d.wpa.plays.length > d.done.length) d.wpa.plays = d.wpa.plays.slice(0, d.done.length);
    }
    if (d.status === 'pre') {
      try { d.stats = await PC.statsCtx(+feed.gameData.game.season, 'R'); } catch (e) { d.stats = null; }
    }
  }

  PC.register('juego', {
    tab: 'juegos',
    skeleton: 'juego',
    every: ctx => {
      const d = ctx.data;
      if (d.status === 'live') return 12000;
      if (d.status === 'pre' || d.status === 'susp') return d.warm ? 20000 : 60000;
      if (d.status === 'final' && d.finalAt && Date.now() - d.finalAt < 180000) return 60000;
      return 0;
    },
    async render(el, args, ctx) {
      const pk = +args[0];
      if (!pk) { location.hash = '#/juegos'; return; }
      const d = ctx.data;
      d.pk = pk;
      d.cursor = null;
      // lugar en el historial de esta pantalla (keepCursor); se lee antes de esperar a la red
      d.pos = history.state && typeof history.state.pc === 'number' ? history.state.pc : null;
      d.spot = d.pos == null ? null : `${d.pos}|${pk}`;
      // Primero la vigilancia (0,6 KB, siempre fresca): si el juego no ha terminado, el completo se pide fresco también.
      const watch = await API.watch(pk).catch(() => null);
      if (!ctx.alive()) return;
      const live = !watch || C.gameStatus(watch.gameData.status) !== 'final';
      const feed = await API.feed(pk, live);
      if (!ctx.alive()) return;
      await load(ctx, feed, live, watch);
      if (!ctx.alive()) return;
      // de vuelta de un jugador: la repetición sigue en la jugada donde estaba
      const k = d.spot == null ? null : cursors.get(d.spot);
      if (k != null && d.status === 'final' && d.wpa && d.wpa.plays.length && k < d.done.length - 1) d.cursor = k;
      draw(el, ctx);
    },
    async refresh(el, args, ctx) {
      const d = ctx.data;
      if (!d.feed) return;
      const watch = await API.watch(d.pk);
      if (!ctx.alive() || !watch || !watch.gameData) return;
      const fr = el.querySelector('[data-ago]');
      if (sigOf(watch.liveData && watch.liveData.linescore, watch.gameData.status) === d.sig) {
        d.ls = watch.liveData.linescore; // solo cambió la cuenta: basta con la pizarra
        d.st = watch.gameData.status;
        paintBoard(el, d);
        paintChapita(d);
        if (fr) fr.dataset.ago = String(API.when(watch));
        return;
      }
      const feed = await API.feed(d.pk, true);
      if (!ctx.alive()) return;
      await load(ctx, feed, true, watch);
      if (!ctx.alive()) return;
      if (layoutOf(d) === d.layout) {
        update(el, d);
        if (fr) fr.dataset.ago = String(API.when(d.feed));
      } else draw(el, ctx, true);
    },
    leave(ctx) { stopReplay(ctx.data); unwatch(ctx.data); keepCursor(ctx.data); }
  });
})(window);
