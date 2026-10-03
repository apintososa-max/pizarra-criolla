/* Pizarra Criolla · core.js
   Núcleo de la interfaz: equipos, formato de números y fechas (hora de Caracas), rutas, temporada activa
   y el reloj que refresca solo la vista abierta mientras hay juegos en vivo. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api;

  // ---------- equipos (nombres con acentos; la API los trae sin ellos) ----------
  const TEAMS = {
    692: { abbr: 'ZUL', name: 'Águilas del Zulia', short: 'Águilas', city: 'Maracaibo' },
    693: { abbr: 'LAR', name: 'Cardenales de Lara', short: 'Cardenales', city: 'Barquisimeto' },
    694: { abbr: 'ANZ', name: 'Caribes de Anzoátegui', short: 'Caribes', city: 'Puerto La Cruz' },
    695: { abbr: 'CAR', name: 'Leones del Caracas', short: 'Leones', city: 'Caracas' },
    696: { abbr: 'MAG', name: 'Navegantes del Magallanes', short: 'Magallanes', city: 'Valencia' },
    697: { abbr: 'MAR', name: 'Bravos de Margarita', short: 'Bravos', city: 'Margarita' },
    698: { abbr: 'LAG', name: 'Tiburones de La Guaira', short: 'Tiburones', city: 'La Guaira' },
    699: { abbr: 'ARA', name: 'Tigres de Aragua', short: 'Tigres', city: 'Maracay' }
  };
  const TEAM_IDS = Object.keys(TEAMS).map(Number);
  // Equipo por id; si no es de la LVBP (otra liga, o "por definir"), se usa lo que trae la API.
  const team = (id, api) => TEAMS[id] || (api && (api.abbreviation || api.teamName || api.name)
    ? { abbr: api.abbreviation || String(api.teamName || api.name).slice(0, 3).toUpperCase(), name: api.name || api.teamName, short: api.teamName || api.name, city: '' }
    : { abbr: '···', name: 'Por definir', short: 'Por definir', city: '' });

  const VENUES = {
    'Estadio Antonio Herrera Gutierrez': 'Estadio Antonio Herrera Gutiérrez',
    'Monumental Simon Bolivar': 'Estadio Monumental de Caracas Simón Bolívar',
    'Estadio Jose Bernardo Perez': 'Estadio José Bernardo Pérez',
    'Estadio Jose Perez Colmenares': 'Estadio José Pérez Colmenares',
    'Estadio Luis Aparicio': 'Estadio Luis Aparicio El Grande',
    'Estadio Alfonso Carrasquel': 'Estadio Alfonso Chico Carrasquel',
    'Estadio Forum de La Guaira': 'Estadio Fórum de La Guaira',
    'Estadio Jorge Luis Garcia Carneiro': 'Estadio Jorge Luis García Carneiro',
    'Estadio Metropolitano de San Cristobal': 'Estadio Metropolitano de San Cristóbal',
    TBD: 'Estadio por definir'
  };
  const venue = n => VENUES[n] || n || '';

  const PHASES = { R: 'Temporada regular', F: 'Comodín', D: 'Comodín', L: 'Round Robin', W: 'Final' };
  // El formato cambió: hasta 2019-20 hubo primera ronda y semifinales por series; 2020-21, solo semifinales;
  // 2021-22, Round Robin sin comodín; desde 2022-23, comodín (5.º vs 6.º) y Round Robin de 5.
  const MODERN = 2022;
  const phaseLabel = (season, type, series) => {
    if (type === 'R') return 'Temporada regular';
    if (type === 'W') return 'Final';
    if (type === 'L') return series ? (/round/i.test(series) ? 'Round Robin' : 'Semifinal') : (season >= 2021 ? 'Round Robin' : 'Semifinal');
    return season >= MODERN ? 'Comodín' : 'Primera ronda';
  };
  const seasonLabel = s => `${s}-${String(s + 1).slice(2)}`;

  // ---------- formato ----------
  const ok = v => v != null && Number.isFinite(v);
  const MINUS = '−';
  const F = {
    avg: v => (ok(v) ? (v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, '')) : '—'),
    era: v => (ok(v) ? v.toFixed(2) : '—'),
    dec1: v => (ok(v) ? v.toFixed(1) : '—'),
    int: v => (ok(v) ? String(Math.round(v)) : '—'),
    pct: (v, d) => (ok(v) ? (v * 100).toFixed(d == null ? 1 : d) + '%' : '—'),
    pct0: v => (ok(v) ? Math.round(v * 100) + '%' : '—'),
    signed: (v, d) => (ok(v) ? (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d || 0) : '—'),
    ip: outs => C.outsToIp(outs || 0),
    gb: v => (v === 0 ? '—' : v % 1 ? v.toFixed(1) : String(v)),
    wl: (w, l) => `${w}-${l}`,
    prob: v => (!ok(v) ? '—' : v >= 0.995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : Math.round(v * 100) + '%')
  };

  // ---------- fechas (todo en hora de Venezuela) ----------
  const TZ = 'America/Caracas';
  const dfISO = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dfLong = new Intl.DateTimeFormat('es-VE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const dfLongY = new Intl.DateTimeFormat('es-VE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dfShort = new Intl.DateTimeFormat('es-VE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const dfTime = new Intl.DateTimeFormat('es-VE', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const D = {
    today: () => dfISO.format(new Date()),
    isoOf: ts => dfISO.format(new Date(ts)),
    hourVE: () => +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
    long: (iso, withYear) => cap((withYear ? dfLongY : dfLong).format(new Date(iso + 'T12:00:00Z'))),
    short: iso => dfShort.format(new Date(iso + 'T12:00:00Z')).replace('.', ''),
    time: ts => dfTime.format(new Date(ts)),
    add: (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    diff: (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5),
    seasonOf: iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 7 ? y : y - 1; }
  };

  // ---------- HTML ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const U = {
    esc,
    chip: id => `<span class="tchip" title="${esc(team(id).name)}">${esc(team(id).abbr)}</span>`,
    teamLink: (id, label) => `<a class="tlink" href="#/equipo/${id}">${esc(label || team(id).short)}</a>`,
    player: (id, name) => (id ? `<a class="plink" href="#/jugador/${id}">${esc(name)}</a>` : esc(name)),
    loading: (el, msg) => { el.innerHTML = `<p class="loading" role="status">${esc(msg || 'Cargando…')}</p>`; },
    bases: (b, big) => {
      const s = big ? 1.6 : 1;
      const sq = (x, y, on) => `<rect x="${x}" y="${y}" width="8" height="8" rx="1" transform="rotate(45 ${x + 4} ${y + 4})" class="${on ? 'on' : ''}"/>`;
      const who = ['1.ª', '2.ª', '3.ª'].filter((_, i) => b && b[i]);
      return `<svg class="bases" viewBox="0 0 32 22" width="${32 * s}" height="${22 * s}" role="img" aria-label="${who.length ? 'Corredores en ' + who.join(', ') : 'Bases limpias'}">` +
        `${sq(12, 1.5, b && b[1])}${sq(21.5, 11, b && b[0])}${sq(2.5, 11, b && b[2])}</svg>`;
    },
    outs: n => `<span class="outs" role="img" aria-label="${n || 0} out${n === 1 ? '' : 's'}">${[0, 1].map(i => `<i class="${i < (n || 0) ? 'on' : ''}"></i>`).join('')}</span>`,
    // ts: hora del dato (no la de la pantalla)
    fresh: ts => `<p class="fresh" data-ago="${ts || Date.now()}"></p>`,
    note: html => `<p class="note">${html}</p>`,
    empty: (title, body) => `<div class="empty"><p class="empty-t">${esc(title)}</p>${body ? `<p>${body}</p>` : ''}</div>`
  };

  // Cabecera de una sección
  U.head = (title, sub) => `<div class="sec-head"><h2>${esc(title)}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>`;

  // Fila de botones tipo "chip" (navegación por hash)
  U.chips = (items, active, label) => `<div class="chips" role="group" aria-label="${esc(label || '')}">` +
    items.map(it => `<a class="chip${it.k === active ? ' on' : ''}" href="${it.href}"${it.k === active ? ' aria-current="true"' : ''}>${esc(it.label)}</a>`).join('') + '</div>';

  // Tabla genérica. cols: [{k, label, title, fmt, cls}] ; rows: objetos o funciones por celda.
  U.table = (cols, rows, o) => {
    o = o || {};
    const th = cols.map(c => {
      const sortable = o.sortable && c.sort !== false;
      const on = o.sortKey === c.k;
      return `<th scope="col" class="${c.cls || ''}${on ? ' sorted' : ''}"${c.title ? ` title="${esc(c.title)}"` : ''}>` +
        (sortable ? `<button type="button" data-sort="${c.k}">${esc(c.label)}${on ? (o.asc ? ' ↑' : ' ↓') : ''}</button>` : esc(c.label)) + '</th>';
    }).join('');
    const body = rows.map((r, i) => {
      const cls = o.rowClass ? o.rowClass(r, i) : '';
      return `<tr${cls ? ` class="${cls}"` : ''}>` + cols.map(c => {
        const v = c.get ? c.get(r, i) : r[c.k];
        const html = c.html ? c.html(r, i) : esc(c.fmt ? c.fmt(v) : v == null ? '' : v);
        return c.first ? `<th scope="row" class="${c.cls || ''}">${html}</th>` : `<td class="${c.cls || ''}">${html}</td>`;
      }).join('') + '</tr>';
    }).join('');
    const foot = o.foot ? `<tfoot><tr>${cols.map(c => {
      const v = o.foot[c.k];
      return `<td class="${c.cls || ''}">${v == null ? '' : esc(c.fmt && typeof v === 'number' ? c.fmt(v) : v)}</td>`;
    }).join('')}</tr></tfoot>` : '';
    // En el teléfono no hay "pasar el ratón": las explicaciones de las columnas van en un desplegable.
    const help = cols.filter(c => c.title);
    const legend = help.length && o.help !== false ? `<details class="cols-help"><summary>Qué significa cada columna</summary><dl>` +
      help.map(c => `<dt>${esc(c.label)}</dt><dd>${esc(c.title)}</dd>`).join('') + '</dl></details>' : '';
    return `<div class="tbl-wrap${o.sticky === false ? '' : ' sticky'}"><table class="tbl${o.cls ? ' ' + o.cls : ''}">` +
      `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table></div>${legend}`;
  };

  U.error = (el, e, retry) => {
    console.warn(e);
    // Un fallo de red y un fallo de la app no se explican igual.
    const net = e && (e.name === 'AbortError' || /^HTTP|fetch|network|Load failed/i.test(String(e.message || '')));
    el.innerHTML = net
      ? `<div class="empty err"><p class="empty-t">No se pudieron cargar los datos</p>
        <p>La fuente (statsapi.mlb.com) no respondió. Revisa la conexión del teléfono y vuelve a intentar.</p>
        <button type="button" class="btn" data-retry>Reintentar</button></div>`
      : `<div class="empty err"><p class="empty-t">Algo falló al armar esta pantalla</p>
        <p>Es un error de la app, no de tu conexión. Prueba otra vez; si sigue, avisa qué pantalla era.</p>
        <p class="note">${esc(String((e && e.message) || e))}</p>
        <button type="button" class="btn" data-retry>Reintentar</button></div>`;
    const b = el.querySelector('[data-retry]');
    if (b && retry) b.addEventListener('click', retry);
  };

  // ---------- estado ----------
  const state = { season: null, upcoming: null, liveToday: 0, prefs: {} };
  try { state.prefs = JSON.parse(localStorage.getItem('pc1:prefs')) || {}; } catch (e) { state.prefs = {}; }
  const savePrefs = () => { try { localStorage.setItem('pc1:prefs', JSON.stringify(state.prefs)); } catch (e) { /* sin almacenamiento */ } };

  // ---------- datos de temporada compartidos entre vistas ----------
  // Juegos de la temporada, uno por gamePk, sin los de relleno "por definir". all=true deja todas las apariciones
  // (un pospuesto en su fecha original, un suspendido en el día que empezó), que sirven para navegar por fechas.
  const flatMemo = new WeakMap(), rawMemo = new WeakMap();
  const real = g => TEAMS[g.away.id] && TEAMS[g.home.id];
  const keepTime = (arr, d) => { try { Object.defineProperty(arr, '__t', { value: d.__t, configurable: true }); } catch (e) { /* nada */ } return arr; };
  async function seasonGames(season, live, all) {
    const d = await API.season(season, live);
    const memo = all ? rawMemo : flatMemo;
    if (!memo.has(d)) memo.set(d, keepTime(C.flatSchedule(d, !!all).filter(real), d));
    return memo.get(d);
  }

  const ctxMemo = new Map();
  // Estadísticas de todos los jugadores de una temporada y fase, con el contexto de liga ya calculado.
  async function statsCtx(season, type) {
    type = type || 'R';
    const [h, p] = await Promise.all([API.stats(season, 'hitting', type), API.stats(season, 'pitching', type)]);
    const key = season + ':' + type;
    const memo = ctxMemo.get(key);
    if (memo && memo.h === h && memo.p === p) return memo.ctx;
    const splits = d => (d && d.stats && d.stats[0] && d.stats[0].splits) || [];
    const row = s => ({
      id: s.player.id, name: s.player.fullName, team: s.team ? s.team.id : null,
      nTeams: s.numTeams || 1, pos: s.position ? s.position.abbreviation : ''
    });
    const bats = splits(h).map(s => Object.assign(row(s), { line: C.batLine(s.stat) }));
    const pits = splits(p).map(s => Object.assign(row(s), { line: C.pitLine(s.stat) }));
    let lg = C.league(bats.map(b => b.line), pits.map(x => x.line));
    // En postemporada la "liga" son pocos equipos en pocos juegos: las constantes (escala de wOBA, FIP, EFE de liga)
    // salen siempre de la temporada regular.
    if (type !== 'R') {
      try { const base = await statsCtx(season, 'R'); if (base.lg.IP > 0) lg = base.lg; } catch (e) { /* se queda la propia */ }
    }
    bats.forEach(b => { b.r = C.bat(b.line, lg); });
    pits.forEach(x => { x.r = C.pit(x.line, lg); });
    const ctx = { season, type, lg, bats, pits, t: API.when(h, p), batById: new Map(bats.map(b => [b.id, b])), pitById: new Map(pits.map(x => [x.id, x])) };
    ctxMemo.set(key, { h, p, ctx });
    return ctx;
  }

  // Juegos jugados por cada equipo en una fase (para la regla de calificados).
  function teamGames(games, type) {
    const g = {};
    for (const x of games) {
      if (x.type !== type || x.status !== 'final') continue;
      g[x.away.id] = (g[x.away.id] || 0) + 1;
      g[x.home.id] = (g[x.home.id] || 0) + 1;
    }
    return g;
  }

  // ---------- vistas y rutas ----------
  const views = {};
  const register = (name, v) => { views[name] = v; };
  let cur = null, seq = 0;

  function parse() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const parts = h.split('/').filter(Boolean);
    return { name: parts[0] || 'juegos', args: parts.slice(1) };
  }

  function setTab(tab) {
    document.querySelectorAll('.tabs a').forEach(a => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  async function route(opts) {
    opts = opts || {};
    const { name, args } = parse();
    const view = views[name] || views.juegos;
    if (cur && cur.view.leave) { try { cur.view.leave(cur); } catch (e) { /* nada */ } }
    const el = document.getElementById('view');
    const my = ++seq;
    const ctx = { view, name, args, el, lastRefresh: Date.now(), busy: false, data: {} };
    ctx.alive = () => my === seq;
    cur = ctx;
    setTab(view.tab || name);
    if (!opts.keepScroll) window.scrollTo(0, 0);
    U.loading(el);
    try {
      await view.render(el, args, ctx);
    } catch (e) {
      if (ctx.alive()) U.error(el, e, () => route());
    }
    updateAgo();
    // el lector de pantalla arranca en la sección nueva (sin mover la vista)
    if (!opts.keepScroll && ctx.alive()) { try { el.focus({ preventScroll: true }); } catch (e) { /* navegador viejo */ } }
  }

  // Reloj: refresca la vista abierta según su propio ritmo (every), solo con la pantalla visible.
  // Si la red falla, espera cada vez más (x2, x4, x8, hasta 2 min) para no gastar batería ni datos.
  function tick() {
    updateAgo();
    if (document.hidden || !cur || cur.busy) return;
    const v = cur.view;
    const base = typeof v.every === 'function' ? v.every(cur) : v.every;
    if (!base) return;
    const every = API.status.fails ? Math.max(base, Math.min(120e3, base * Math.pow(2, Math.min(API.status.fails, 3)))) : base;
    if (Date.now() - cur.lastRefresh < every) return;
    const ctx = cur;
    ctx.busy = true;
    ctx.lastRefresh = Date.now();
    Promise.resolve(v.refresh ? v.refresh(ctx.el, ctx.args, ctx) : v.render(ctx.el, ctx.args, ctx))
      .catch(e => console.warn('refresco', e))
      .finally(() => { ctx.busy = false; updateAgo(); });
  }

  function updateAgo() {
    const now = Date.now();
    document.querySelectorAll('[data-ago]').forEach(p => {
      const t = +p.dataset.ago;
      if (!t) return;
      const s = Math.round((now - t) / 1000);
      const when = s < 60 ? `hace ${Math.max(1, s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `a las ${D.time(t)}`;
      const auto = cur && (typeof cur.view.every === 'function' ? cur.view.every(cur) : cur.view.every);
      const offline = API.status.online ? '' : ' · sin conexión, mostrando lo último guardado';
      p.textContent = `Actualizado ${when}` + (auto ? ` · se actualiza solo cada ${auto >= 60000 ? Math.round(auto / 60000) + ' min' : Math.round(auto / 1000) + ' s'}` : '') + offline;
      p.classList.toggle('off', !API.status.online);
    });
  }

  // ---------- temporada ----------
  function seasonSelect() {
    const sel = document.getElementById('season');
    const top = API.currentSeason();
    let html = '';
    for (let s = top; s >= 2016; s--) html += `<option value="${s}">${seasonLabel(s)}</option>`;
    sel.innerHTML = html;
    sel.value = String(state.season);
    sel.addEventListener('change', () => {
      state.season = +sel.value;
      route({ keepScroll: false });
    });
  }
  function setSeason(s) {
    state.season = s;
    const sel = document.getElementById('season');
    if (sel) sel.value = String(s);
  }

  // ¿Hay juegos en vivo? Alimenta la marca roja de la cabecera y el ritmo de refresco de las demás vistas.
  // De madrugada también mira los de ayer: un juego que empezó a las 8 pm puede seguir pasada la medianoche.
  // Cuando arranca la temporada nueva con la app abierta, se cambia sola a esa temporada.
  async function pulse() {
    if (document.hidden) return;
    const flag = document.getElementById('live-flag');
    try {
      const live = state.liveToday > 0;
      const days = [API.day(D.today(), live)];
      if (D.hourVE() < 5) days.push(API.day(D.add(D.today(), -1), live));
      const games = [].concat(...(await Promise.all(days)).map(d => C.flatSchedule(d)));
      const n = games.filter(g => g.status === 'live').length;
      state.liveToday = n;
      if (flag) { flag.hidden = !n; flag.textContent = n === 1 ? '1 en vivo' : `${n} en vivo`; }
      const up = state.upcoming;
      if (up && games.some(g => (g.status === 'live' || g.status === 'final') && D.seasonOf(g.date) === up.season)) {
        state.upcoming = null;
        setSeason(up.season);
        if (cur && cur.name !== 'juego' && cur.name !== 'jugador') route({ keepScroll: true });
      }
    } catch (e) { /* sin red: se reintenta en el próximo pulso */ }
  }

  async function boot() {
    const top = API.currentSeason();
    state.season = top;
    try {
      const games = await seasonGames(top);
      const reg = games.filter(g => g.type === 'R');
      const started = reg.some(g => g.status === 'final' || g.status === 'live');
      const opener = reg.find(g => g.status === 'pre') || null;
      if (!started) {
        state.season = top - 1;
        state.upcoming = opener ? { season: top, game: opener } : null;
      }
    } catch (e) {
      state.season = top - 1;
    }
    seasonSelect();
    window.addEventListener('hashchange', () => route());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && cur) { cur.lastRefresh = 0; pulse(); } });
    window.addEventListener('online', () => { API.status.fails = 0; if (cur) cur.lastRefresh = 0; });
    await route();
    pulse();
    setInterval(tick, 1000);
    setInterval(pulse, 60000);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
    }
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });

  // "‹ Volver" regresa a la pantalla anterior si la hay dentro de la app
  let navCount = 0;
  window.addEventListener('hashchange', () => { navCount++; });
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[data-back]');
    if (a && navCount > 0) { e.preventDefault(); history.back(); }
  });

  Object.assign(PC, {
    TEAMS, TEAM_IDS, team, venue, PHASES, MODERN, phaseLabel, seasonLabel, F, D, U, esc, state, savePrefs,
    seasonGames, statsCtx, teamGames, register, route, setSeason, updateAgo
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
