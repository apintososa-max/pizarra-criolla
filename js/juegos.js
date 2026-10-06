/* Pizarra Criolla · juegos.js
   Juegos del día (tarjetas tipo marcador) y los ayudantes que comparte con la pantalla de un juego (js/juego.js):
   el repintado por piezas, la insignia de equipo, el apellido y el texto de "Final".
   En vivo la pantalla no se rehace: cada pieza se compara con la que hay y solo cambia lo que cambió (así no se
   pierde el desplazamiento de las tablas ni se cierran los desplegables). */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc;
  const team = (id, api) => PC.team(id, api);
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const I_LEFT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
  const I_RIGHT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>';

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
  // por sus hijos con data-p; si solo cambiaron sus atributos, se cambian en su lugar). Lo que no tiene data-p se
  // rehace entero, conservando el desplazamiento lateral de las tablas, los desplegables abiertos y el foco.
  // data-keep: una caja que dibuja el código (un gráfico de charts.js); con la misma clave se deja como está.
  // Las bases chicas (U.bases) cambian en su lugar: el SVG no se rehace.
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
  // Las bases chicas: la misma figura con otras casillas encendidas.
  function sameBases(o, n) {
    if (o.tagName !== 'svg' || n.tagName !== 'svg' || !o.classList.contains('bases') || !n.classList.contains('bases')) return false;
    const a = o.querySelectorAll('rect'), b = n.querySelectorAll('rect');
    if (a.length !== b.length) return false;
    a.forEach((r, i) => { const c = b[i].getAttribute('class') || ''; if ((r.getAttribute('class') || '') !== c) r.setAttribute('class', c); });
    ['aria-label', 'width', 'height'].forEach(k => { const v = n.getAttribute(k); if (v != null && o.getAttribute(k) !== v) o.setAttribute(k, v); });
    return true;
  }
  // Los atributos de n, en o (sin rehacerlo).
  function syncAttrs(o, n) {
    if (sameAttrs(o, n)) return;
    for (const at of [...o.attributes]) if (!n.hasAttribute(at.name)) o.removeAttribute(at.name);
    for (const at of n.attributes) if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
  }
  // Si lo que se reemplaza tenía el foco (teclado, lector), lo toma su equivalente en lo nuevo: el mismo enlace o el
  // mismo botón (href, data-go, data-vs, data-tab…). Sin mover la página.
  const SAME = ['href', 'data-go', 'data-vs', 'data-tab', 'data-side', 'data-vel', 'data-j', 'data-p', 'id'];
  function twin(act, n) {
    for (const a of SAME) {
      const v = act.getAttribute(a);
      if (v == null) continue;
      const sel = `${act.tagName.toLowerCase()}[${a}="${(root.CSS && CSS.escape ? CSS.escape(v) : v)}"]`;
      if (n.matches && n.matches(sel)) return n;
      const x = n.querySelector && n.querySelector(sel);
      if (x) return x;
    }
    return null;
  }
  function refocus(x) {
    if (x && typeof x.focus === 'function' && document.activeElement !== x) x.focus({ preventScroll: true });
  }
  const focusIn = o => { const a = document.activeElement; return a && a !== document.body && (a === o || o.contains(a)) ? a : null; };
  function morph(o, n) {
    // "Actualizado hace…": su texto lo escribe core.js; basta con renovar la hora
    if (o.dataset.ago && n.dataset.ago) { o.dataset.ago = n.dataset.ago; return o; }
    if (o.dataset.keep && o.dataset.keep === n.dataset.keep) return o;
    if (sameBases(o, n)) return o;
    if (o.tagName === 'DETAILS' && o.open) n.open = true;
    if (o.isEqualNode(n)) return o;
    if (o.tagName === n.tagName) {
      // hijos con data-p: se cambia solo lo que cambió (y los atributos del contenedor, en su lugar)
      if (onlyElements(o) && onlyElements(n) && keyed([...o.children]) && keyed([...n.children])) {
        syncAttrs(o, n);
        morphKids(o, [...n.children]);
        return o;
      }
      // el mismo contenido y otros atributos (una jugada clave elegida, un bombillo): solo los atributos; el nodo es
      // el mismo y el foco no se pierde
      if (o.childElementCount < 16 && o.innerHTML === n.innerHTML) { syncAttrs(o, n); return o; }
    }
    const act = focusIn(o);
    const saved = grab(o);
    o.replaceWith(n);
    put(n, saved);
    if (act) refocus(act === o ? n : twin(act, n));
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
    else {
      const act = focusIn(box), saved = grab(box);
      box.innerHTML = html;
      put(box, saved);
      if (act && act !== box) refocus(twin(act, box));
    }
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
  // lo que también usa la pantalla de un juego (js/juego.js)
  Object.assign(PC, { surname, ord, dayOf, chipOf, finalSub, finalText, paint, morphHTML, reduced, I_LEFT });

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

})(window);
