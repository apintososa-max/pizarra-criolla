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
  // Insignia de equipo (la única de la app, en lugar de logos): chip(id), chip(id, 's'), chip(id, 'xl'),
  // chip(id, 's inv') o chip(id, 's', true). inv es para fondos azules; dentro de la pizarra sale sola.
  const chip = (id, size, inv) => {
    const t = team(id);
    const mods = String(size || '').split(/\s+/).filter(m => m === 's' || m === 'xl' || m === 'inv');
    if (inv && mods.indexOf('inv') < 0) mods.push('inv');
    return `<span class="tchip${mods.length ? ' ' + mods.join(' ') : ''}" title="${esc(t.name)}">${esc(t.abbr)}</span>`;
  };
  const U = {
    esc,
    chip,
    teamLink: (id, label) => `<a class="tlink" href="#/equipo/${id}">${esc(label || team(id).short)}</a>`,
    player: (id, name) => (id ? `<a class="plink" href="#/jugador/${id}">${esc(name)}</a>` : esc(name)),
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

  // ---------- esqueletos de carga: la forma de lo que viene, estática (sin brillo animado) ----------
  // Cada vista elige el suyo con view.skeleton; una vista puede agregar el propio en U.skeletons (equipos.js, lideres.js).
  // Donde importa el alto, la maqueta lleva las mismas clases de la pantalla real y un texto de muestra que no se ve
  // (.sk-t, styles.css): mide lo mismo que lo que viene, también en 360 px o con la letra grande, y nada salta al llegar.
  const sk = (w, h, more) => `<span class="sk" style="width:${w};height:${h}${more ? ';' + more : ''}"></span>`;
  const ghost = t => `<span class="sk-t">${esc(t)}</span>`;
  const times = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  const gap = '<span style="flex:1"></span>';
  const skChips = ws => `<div class="sk-row">${ws.map(w => sk(w, '36px', 'border-radius:999px')).join('')}</div>`;
  // tarjeta de juego con la forma de .gcard.gc: equipos a la izquierda, columna de estado tras una raya y el pie
  // (la línea de arriba de la tarjeta real solo sale en postemporada y doble cartelera: aquí no va)
  const skCard = () => `<div class="sk-card sk-gc"><div class="sk-gc-t">` +
    times(2, i => `<div class="sk-row">${sk('2.25rem', '1.35rem')}${sk(i ? '34%' : '44%', '1.1rem')}${gap}${sk('1.2rem', '1.75rem')}</div>`) +
    `</div><div class="sk-gc-s">${sk('3rem', '1.75rem')}${sk('3.6rem', '.7rem')}</div><div class="sk-gc-f">${sk('60%', '.8rem')}</div></div>`;
  // la flecha de "‹ Juegos del 2 feb" (la misma de juegos.js)
  const I_LEFT = '<svg class="ic" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
  // fila de un equipo en la pizarra (boardInner en juegos.js): insignia, nombre con el récord y las carreras
  const skTeam = name => `<div class="bt-row"><span class="bt-abbr">···</span><a class="bt-name">${ghost(name)}<small>${ghost('00-00')}</small></a>` +
    '<span class="bt-runs">0</span></div>';
  const skLine = () => `<tr><th>&nbsp;</th>${times(9, () => '<td>&nbsp;</td>')}<td class="rhe r">&nbsp;</td><td class="rhe">&nbsp;</td><td class="rhe">&nbsp;</td></tr>`;
  const SK_TEAMS = ['Magallanes', 'Cardenales', 'Tiburones', 'Leones', 'Águilas', 'Caribes', 'Tigres', 'Bravos'];
  const SK_COLS = ['JJ', 'JG', 'JP', 'AVE', 'Dif', 'Últ. 10', 'Racha', 'Casa'];
  U.skeletons = {
    // barra de fecha + 3 tarjetas
    juegos: () => `<div class="datebar">${sk('48px', '48px', 'border-radius:12px')}` +
      `<div class="sk-col" style="align-items:center">${sk('70%', '1.25rem')}${sk('35%', '.8rem')}</div>${sk('48px', '48px', 'border-radius:12px')}</div>` +
      `<div class="games">${times(3, skCard)}</div>`,
    // un juego terminado (lo más común al abrir uno), con el armazón de juegos.js (draw y boardInner): la miga, la pizarra
    // apagada (estado y estadio, los dos equipos, la cuadrícula de innings vacía), la repetición y el gráfico
    juego: () => `<nav class="crumbs"><a class="gm-back">${I_LEFT}${ghost('Juegos del 00 oct')}</a></nav>` +
      `<section class="board-wrap"><div class="board"><p class="bt-status"><span class="pill">Final</span>` +
      `<span class="bt-venue">${ghost('Estadio Alfonso Chico Carrasquel')}</span></p>${skTeam('Magallanes')}${skTeam('Cardenales')}` +
      `<div class="bt-line"><table><thead><tr><th></th>${times(9, i => `<th>${i + 1}</th>`)}<th class="rhe">C</th><th class="rhe">H</th><th class="rhe">E</th></tr></thead>` +
      `<tbody>${skLine()}${skLine()}</tbody></table></div></div></section>` +
      `<div class="replay"><div class="rp-row">${sk('112px', '44px', 'border-radius:10px')}${sk('auto', '6px', 'flex:1')}</div>` +
      `<p class="rp-label">${ghost('Jugada 00 de 00 · Baja del 9.º')}</p></div>` +
      `<div class="sk-col" style="gap:12px">${sk('58%', '1.25rem')}${sk('100%', '13rem', 'border-radius:12px')}</div>`,
    // Tabla (tabla.js): título, fases y la tabla de posiciones con sus 8 filas, la leyenda de colores y "Qué significa
    // cada columna", con las mismas clases. Las fases salen en una temporada pasada (o si la ruta trae una); la
    // postemporada (#/tabla/D, L o W) son series y juegos: ahí va una lista.
    tabla: () => {
      const ph = (/^#\/tabla\/([^/?]+)/.exec(location.hash) || [])[1];
      const phases = !!ph || state.season == null || API.isPast(state.season);
      const head = `<div class="page-head"><h1>${ghost('Tabla 0000-00')}</h1>${phases ? skChips(['9.5rem', '5.5rem', '7rem', '3.5rem']) : ''}</div>`;
      if (ph && ph !== 'R') return head + `<div class="sk-list">${times(5, () => `<div class="sk-row">${sk('2.75rem', '1.65rem')}${sk('40%', '1rem')}${gap}${sk('2rem', '1.75rem')}</div>`)}</div>`;
      return head + `<section class="sec tb"><div class="tbl-wrap sticky"><table class="tbl standings"><thead><tr>` +
        `<th class="pos">${ghost('#')}</th><th class="name">${ghost('Equipo')}</th>${SK_COLS.map(c => `<th>${ghost(c)}</th>`).join('')}</tr></thead><tbody>` +
        SK_TEAMS.map((t, i) => `<tr class="tap"><td class="pos"><span class="rk">${ghost(String(i + 1))}</span></td>` +
          `<th class="name"><span class="tchip s">LVB</span> ${ghost(t)}</th>${SK_COLS.map(() => `<td>${ghost('00')}</td>`).join('')}</tr>`).join('') +
        `</tbody></table></div><p class="tb-ley"><span><i class="sk"></i>${ghost('Directo al Round Robin')}</span><span><i class="sk"></i>${ghost('Comodín')}</span></p>` +
        `<details class="cols-help"><summary>${ghost('Qué significa cada columna')}</summary></details></section>`;
    },
    // título, chips y 10 filas
    lista: () => sk('55%', '2rem') + skChips(['8rem', '5rem', '6.5rem', '4.5rem', '5.5rem']) +
      `<div class="sk-list">${times(10, i => `<div class="sk-row">${sk('1.5rem', '1rem')}<div class="sk-col">${sk(['55%', '48%', '62%', '44%', '52%'][i % 5], '1rem')}${sk('70%', '.8rem')}</div>${sk('3rem', '1.75rem')}</div>`)}</div>`
  };
  // U.loading(el, kind): 'juegos' | 'juego' | 'tabla' | 'lista', o el que una vista agregó en U.skeletons; sin kind (o uno
  // desconocido), 'lista'. Un texto en lugar de kind (la firma vieja) queda como el texto accesible. Si el esqueleto de
  // una vista falla, sale 'lista': la pantalla no se queda sin nada.
  U.loading = (el, kind) => {
    const known = !!kind && Object.prototype.hasOwnProperty.call(U.skeletons, kind);
    const label = known || !kind ? 'Cargando…' : String(kind);
    let body;
    try { body = U.skeletons[known ? kind : 'lista'](); } catch (e) { console.warn('esqueleto', e); body = U.skeletons.lista(); }
    el.innerHTML = `<div class="skel" role="status"><span class="sr">${esc(label)}</span>` +
      `<div class="skel-in" aria-hidden="true">${body}</div></div>`;
  };

  // Cabecera de una sección. Si hay sub (HTML), la explicación queda escondida detrás de un botón (i).
  // Se recuerda abierta por pantalla y título, para que el refresco automático no la cierre.
  const shOpen = new Set();
  const shKey = title => location.hash + '|' + title;
  let shSeq = 0;
  const I_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="disc" cx="12" cy="12" r="9.2"/><path d="M12 11v5.6"/><circle class="dot" cx="12" cy="7.6" r="1.25"/></svg>';
  U.head = (title, sub) => {
    if (!sub) return `<div class="sec-head"><h2>${esc(title)}</h2></div>`;
    const id = 'sh-' + (++shSeq), open = shOpen.has(shKey(String(title)));
    return `<div class="sec-head"><h2>${esc(title)}</h2>` +
      `<button type="button" class="sh-i" aria-expanded="${open}" aria-controls="${id}" aria-label="Explicación: ${esc(title)}">${I_ICON}</button>` +
      `<p class="sec-sub" id="${id}"${open ? '' : ' hidden'}>${sub}</p></div>`;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.sh-i');
    if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    const p = document.getElementById(b.getAttribute('aria-controls'));
    if (p) p.hidden = !open;
    const h = b.parentNode.querySelector('h2');
    if (h) shOpen[open ? 'add' : 'delete'](shKey(h.textContent));
  });

  // Fila de botones tipo "chip" para filtrar (navegación por hash). data-replace: un filtro no llena el historial.
  U.chips = (items, active, label) => `<div class="chips" role="group" aria-label="${esc(label || '')}">` +
    items.map(it => `<a class="chip${it.k === active ? ' on' : ''}" href="${it.href}" data-replace${it.k === active ? ' aria-current="true"' : ''}>${esc(it.label)}</a>`).join('') + '</div>';

  // El chip elegido (fase, métrica) queda a la vista aunque esté al final de su fila: fuera también de la zona que se
  // desvanece (el 8 % de la derecha, .chips en styles.css), con 8 px de aire. Se corre lo justo, y solo si hace falta.
  // route() lo aplica en todas las pantallas tras cada pintado, después de devolver la fila a donde la dejó la persona
  // (al tocar un filtro, el chip tocado no queda medio tapado); refreshView, tras cada refresco, salvo en las filas
  // donde el elegido ya no se veía (leave, de chipsSeen): esas las corrió la persona, y se quedan donde las dejó.
  // Lo mismo al volver atrás a una pantalla (remember guarda chipsSeen junto con lo demás).
  // Archivo ensancha los chips al llegar: si su hoja de Google Fonts todavía no llegó, se mide otra vez al cargar
  // (document.fonts vacío con ready ya resuelto: se espera la primera carga).
  function chipsOn(el, ctx, leave) {
    const show = () => el.querySelectorAll('.chips').forEach((box, i) => {
      if (leave && leave[i]) return;
      const on = box.querySelector('.on');
      if (!on || box.scrollWidth <= box.clientWidth) return;
      const r = on.getBoundingClientRect(), b = box.getBoundingClientRect();
      const d = r.right + 8 - (b.right - box.clientWidth * 0.08);
      if (d > 0) box.scrollLeft += d;
      else if (r.left < b.left) box.scrollLeft -= b.left - r.left + 8; // cortado por la izquierda
    });
    show();
    const fonts = document.fonts, again = () => { if (!ctx || ctx.alive()) show(); };
    if (fonts && fonts.status !== 'loaded') fonts.ready.then(again);
    else if (fonts && !fonts.size && fonts.addEventListener) fonts.addEventListener('loadingdone', again, { once: true });
  }
  // Por fila de chips: ¿el elegido se ve, aunque sea en parte? (sin elegido, cuenta como que sí)
  const chipsSeen = el => Array.from(el.querySelectorAll('.chips'), box => {
    const on = box.querySelector('.on');
    if (!on) return true;
    const r = on.getBoundingClientRect(), b = box.getBoundingClientRect();
    return r.right > b.left && r.left < b.right;
  });

  // Pestañas subrayadas para cambiar de vista dentro de una pantalla (Bateo/Pitcheo). Tampoco llenan el historial.
  U.utabs = (items, active, label) => `<nav class="utabs" aria-label="${esc(label || '')}">` +
    items.map(it => `<a href="${it.href}" data-replace${it.k === active ? ' class="on" aria-current="true"' : ''}>${esc(it.label)}</a>`).join('') + '</nav>';

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
    // se desliza de lado: con tabindex se puede mover con el teclado, y el lector la anuncia con su nombre (o.label)
    return `<div class="tbl-wrap${o.sticky === false ? '' : ' sticky'}" tabindex="0" role="region" aria-label="${esc(o.label || 'Tabla')}"><table class="tbl${o.cls ? ' ' + o.cls : ''}">` +
      `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table></div>${legend}`;
  };
  // Filas enteras tocables (rowClass 'tap' o 'fi-tap'): tocar cualquier celda abre el primer enlace de la fila.
  // La primera columna es fija al deslizar la tabla, así que un enlace estirado (.stretch) no cubriría la fila.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const tr = e.target.closest && e.target.closest('#view tr.tap, #view tr.fi-tap');
    if (!tr || e.target.closest('a, button, input, select, summary')) return;
    const a = tr.querySelector('a[href^="#"]');
    if (a) a.click();
  });

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
  const state = { season: null, upcoming: null, liveToday: 0, prefs: {}, root: null }; // root: sección que marca la barra
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

  function parseHash(h) {
    let s = String(h || '').replace(/^#\/?/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* se queda como vino */ }
    const parts = s.split('/').filter(Boolean);
    return { name: parts[0] || 'juegos', args: parts.slice(1) };
  }
  const parse = () => parseHash(location.hash);
  // La misma pantalla aunque el enlace se escriba distinto (#/juegos, #juegos o vacío).
  const sameRoute = (a, b) => {
    const x = parseHash(a), y = parseHash(b);
    return x.name === y.name && x.args.join('/') === y.args.join('/');
  };
  const hashOf = url => { const k = String(url || '').indexOf('#'); return k < 0 ? '' : url.slice(k); };
  // Las secciones de la barra de abajo son las pantallas raíz; un juego, un equipo o un jugador cuelgan de una de ellas.
  const isRoot = name => !!document.querySelector(`.tabs a[data-tab="${name}"]`);
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function setTab(tab) {
    document.querySelectorAll('.tabs a').forEach(a => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  // Título de la pestaña del navegador (y del historial y de "recientes" en Android): ctx.title si la vista lo pone,
  // si no el <h1> de la pantalla, y si no tiene, el nombre de su sección.
  function setTitle(el, ctx) {
    const h = el.querySelector('h1');
    const tab = document.querySelector(`.tabs a[data-tab="${state.root || 'juegos'}"] span`);
    const t = String((typeof ctx.title === 'function' ? ctx.title() : ctx.title) || (h && h.textContent) || (tab && tab.textContent) || '').replace(/\s+/g, ' ').trim();
    document.title = t ? t + ' · Pizarra Criolla' : 'Pizarra Criolla';
  }

  // ---------- estado de la pantalla: desplazamiento y desplegables ----------
  // Se toma antes de repintar y se devuelve después, para que un refresco o un filtro no devuelvan la página arriba,
  // las tablas a la izquierda ni cierren lo que estaba abierto. Las tablas y los chips se reconocen por su orden.
  const SIDE = ['.tbl-wrap', '.chips'];
  function takeUI(el, withNodes) {
    const s = {
      y: window.scrollY,
      x: SIDE.map(sel => Array.from(el.querySelectorAll(sel), n => n.scrollLeft)),
      open: Array.from(el.querySelectorAll('details'), d => d.open)
    };
    if (withNodes) s.nodes = { x: SIDE.map(sel => Array.from(el.querySelectorAll(sel))), open: Array.from(el.querySelectorAll('details')) };
    return s;
  }
  // Devuelve lo de lado y los desplegables. Con nodos, solo toca los elementos nuevos (los que la vista reemplazó):
  // lo que la persona movió mientras tanto se respeta.
  function putUI(el, s, done) {
    SIDE.forEach((sel, k) => el.querySelectorAll(sel).forEach((n, i) => {
      if (s.nodes && (s.nodes.x[k][i] === n || (done && done.has(n)))) return;
      const v = s.x[k] && s.x[k][i];
      if (v && n.scrollLeft !== v) n.scrollLeft = v;
      if (done) done.add(n);
    }));
    el.querySelectorAll('details').forEach((d, i) => {
      if (s.nodes && (s.nodes.open[i] === d || (done && done.has(d)))) return;
      if (s.open[i] != null && d.open !== s.open[i]) d.open = s.open[i];
      if (done) done.add(d);
    });
  }
  // Lleva la página a y. Si todavía no es tan alta (falta un gráfico), reintenta unos cuadros; un toque de la persona lo para.
  function restoreY(y) {
    if (!(y > 0)) return;
    const t0 = Date.now();
    let quit = false;
    const stop = () => { quit = true; };
    const evs = ['touchstart', 'wheel', 'keydown'];
    evs.forEach(ev => window.addEventListener(ev, stop, { passive: true, once: true }));
    const step = () => {
      if (!quit) window.scrollTo(0, y);
      if (!quit && Math.abs(window.scrollY - y) > 2 && Date.now() - t0 < 1500) requestAnimationFrame(step);
      else evs.forEach(ev => window.removeEventListener(ev, stop, { passive: true, once: true }));
    };
    step();
  }

  // ---------- historial como en Android ----------
  // Cada entrada lleva en history.state {pc: su posición, root: la sección de la que cuelga}; la pila (posición → pantalla)
  // y las posiciones de desplazamiento (por hash completo) se guardan en sessionStorage para sobrevivir a una recarga.
  //  - data-replace (filtros, fases, flechas de fecha, Bateo/Pitcheo) reemplaza: no suma pasos.
  //  - Barra de abajo: de Juegos a otra sección suma un paso; entre las demás, reemplaza (vuelve a Juegos sin pintarla y
  //    suma la nueva); ir a Juegos regresa en el historial. Así, atrás desde cualquier sección va a Juegos, y de ahí
  //    sale de la app.
  //  - Entrar a un juego, equipo o jugador suma un paso.
  const nav = { i: 0, stack: [], next: null, after: null, pos: new Map(), first: 'new' };
  const NAV_KEY = 'pc1:nav';
  function saveNav() {
    try { sessionStorage.setItem(NAV_KEY, JSON.stringify({ stack: nav.stack, pos: Array.from(nav.pos).slice(-40) })); } catch (e) { /* sin almacenamiento */ }
  }
  function navInit() {
    try { history.scrollRestoration = 'manual'; } catch (e) { /* navegador viejo */ }
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem(NAV_KEY)); } catch (e) { s = null; }
    const st = history.state;
    if (st && typeof st.pc === 'number' && s && Array.isArray(s.stack)) {
      // recarga (o la app volvió de segundo plano): se retoma donde estaba
      nav.i = st.pc;
      nav.stack = s.stack;
      (s.pos || []).forEach(p => nav.pos.set(p[0], p[1]));
      nav.first = 'back';
    }
    nav.stack[nav.i] = Object.assign({}, nav.stack[nav.i], { h: location.hash });
  }
  function remember(h) {
    const el = document.getElementById('view');
    nav.pos.delete(h);
    nav.pos.set(h, Object.assign(takeUI(el), { y: Math.round(window.scrollY), seen: chipsSeen(el) }));
    if (nav.pos.size > 40) nav.pos.delete(nav.pos.keys().next().value);
  }
  function onHash(e) {
    const from = e && e.oldURL != null ? hashOf(e.oldURL) : null;
    let snap = null;
    if (from != null) { remember(from); snap = nav.pos.get(from); } // la pantalla que se deja todavía está ahí
    const st = history.state;
    let mode;
    if (st && typeof st.pc === 'number') {
      mode = 'back'; // atrás (o adelante) a una entrada que ya existía
      nav.i = st.pc;
      nav.stack[nav.i] = Object.assign({ root: st.root }, nav.stack[nav.i], { h: location.hash });
    } else if (nav.next) {
      mode = nav.next.keep ? 'keep' : 'new'; // reemplazo pedido por la app
      nav.stack[nav.i] = { h: location.hash, root: nav.stack[nav.i] && nav.stack[nav.i].root };
    } else {
      mode = 'new'; // paso nuevo: cuelga de la misma sección que la pantalla anterior
      const root = nav.stack[nav.i] && nav.stack[nav.i].root;
      nav.i++;
      nav.stack.length = nav.i;
      nav.stack[nav.i] = { h: location.hash, root };
    }
    nav.next = null;
    if (nav.after && Date.now() - nav.after.t < 3000) {
      // paso intermedio por Juegos (camino a otra sección): no se pinta, solo queda en el historial
      const h = nav.after.h;
      nav.after = null;
      nav.stack[nav.i].root = 'juegos';
      try { history.replaceState({ pc: nav.i, root: 'juegos' }, ''); } catch (err) { /* nada */ }
      location.hash = h;
      return;
    }
    route({ mode, snap });
  }
  function replaceTo(href, keep) {
    if (sameRoute(href, location.hash)) return;
    nav.next = { keep: !!keep };
    location.replace(href);
  }
  // Busca hacia atrás en el historial de la app la última pantalla que cumpla match; -1 si no hay.
  function findBack(match) {
    for (let j = nav.i - 1; j >= 0; j--) if (nav.stack[j] && match(nav.stack[j].h)) return j;
    return -1;
  }
  function toTop() {
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  }
  // Barra de abajo (y el logo, y la marca "en vivo"). exact: el destino es esa dirección exacta, no la sección.
  function goSection(tab, href, exact) {
    const S = state.root || 'juegos';
    const here = exact ? sameRoute(location.hash, href) : parse().name === tab;
    // Juegos en otra fecha: el primer toque sube; el segundo (ya arriba) lleva a hoy
    if (!exact && tab === 'juegos' && parse().name === 'juegos' && !sameRoute(location.hash, href) && window.scrollY < 2) { replaceTo(href, false); return; }
    if (tab === S && here) { toTop(); return; } // re-toque: sube al inicio
    if (tab === S || tab === 'juegos') {
      const j = findBack(h => (exact ? sameRoute(h, href) : parseHash(h).name === tab));
      if (j >= 0) { history.go(j - nav.i); return; }
      replaceTo(href, false);
      return;
    }
    if (parse().name === 'juegos') { location.hash = href; return; } // desde la portada de Juegos: un paso
    // desde cualquier otra pantalla: de vuelta a Juegos (o Juegos en lugar de esta, si se entró directo) y un paso
    nav.after = { h: href, t: Date.now() };
    const j = findBack(h => parseHash(h).name === 'juegos');
    if (j >= 0) history.go(j - nav.i);
    else { nav.next = { keep: false }; location.replace('#/juegos'); }
  }
  // "‹ Volver" (data-back) y migas: regresar si hay a dónde dentro de la app; si no, ir al enlace sin sumar pasos.
  function goBack(a, href, e) {
    const prev = nav.i > 0 ? nav.stack[nav.i - 1] : null;
    if (a.hasAttribute('data-back')) {
      e.preventDefault();
      if (prev) history.back(); else replaceTo(href, false);
      return;
    }
    // una miga con destino fijo vuelve atrás solo si ese destino es la pantalla anterior (así no hay bucles)
    if (prev && sameRoute(prev.h, href)) { e.preventDefault(); history.back(); return; }
    if (!prev) { e.preventDefault(); replaceTo(href, false); }
  }
  // El chip tocado se marca al instante, aunque los datos tarden.
  function markOn(a) {
    const box = a.parentNode;
    if (!box || !box.matches || !box.matches('.chips, .utabs, .seg')) return;
    Array.from(box.children).forEach(x => {
      x.classList.toggle('on', x === a);
      if (x === a) x.setAttribute('aria-current', 'true'); else if (x.tagName === 'A') x.removeAttribute('aria-current');
    });
  }
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.target) return;
    const href = a.getAttribute('href');
    if (a.matches('.tabs a[data-tab], .brand')) { e.preventDefault(); goSection(a.dataset.tab || 'juegos', href); return; }
    if (a.id === 'live-flag') { e.preventDefault(); goSection('juegos', href, true); return; }
    if (a.hasAttribute('data-back') || a.closest('.crumbs')) { goBack(a, href, e); return; }
    if (a.hasAttribute('data-replace')) { e.preventDefault(); markOn(a); replaceTo(href, true); }
  });
  window.addEventListener('pagehide', () => { remember(location.hash); saveNav(); });

  // Vigía: el esqueleto no se queda para siempre. Si a los 25 s la pantalla sigue en su esqueleto (una vista que no
  // termina, un pedido colgado), se dice en la pantalla con "Reintentar": un problema de red si hay pedidos andando, si
  // no, de la app. Los pedidos a la API se cortan solos a los 10 o 20 s y la vista muestra su propio error antes: esto
  // es la red de seguridad. Si la vista termina después, pinta encima como siempre. Al arrancar, el plazo cuenta desde
  // que arrancó la app (until: la hora límite), no desde que empezó la primera pantalla. Devuelve la función que lo apaga.
  const GUARD_MS = 25000;
  function guard(ctx, retry, until) {
    const t = setTimeout(() => {
      const first = ctx.el.firstElementChild;
      if (!ctx.alive() || !ctx.busy || !first || !first.classList.contains('skel')) return;
      U.error(ctx.el, API.pending() > 0
        ? Object.assign(new Error('Load failed: la red no respondió a tiempo'), { name: 'AbortError' })
        : new Error('La pantalla no terminó de cargar'), retry);
    }, until ? Math.max(5000, until - Date.now()) : GUARD_MS);
    return () => clearTimeout(t);
  }

  // route({mode}): 'new' arranca arriba; 'back' devuelve la posición guardada de esa pantalla; 'keep' (filtros,
  // refrescos) deja todo donde estaba. keepScroll:true (la firma vieja) es 'keep'. until: hora límite del vigía (boot).
  async function route(opts) {
    opts = opts || {};
    const mode = opts.mode || (opts.keepScroll ? 'keep' : 'new');
    const { name, args } = parse();
    const view = views[name] || views.juegos;
    if (cur && cur.view.leave) { try { cur.view.leave(cur); } catch (e) { /* nada */ } }
    const el = document.getElementById('view');
    // si el archivo de una vista no cargó (corte de red a mitad de la descarga), se dice en la pantalla, con "Reintentar"
    if (!view) { ++seq; cur = null; U.error(el, new Error('No cargó la pantalla'), () => location.reload()); return; }
    const snap = mode === 'keep' ? (opts.snap || takeUI(el)) : mode === 'back' ? nav.pos.get(location.hash) : null;
    const my = ++seq;
    const ctx = { view, name, args, el, lastRefresh: Date.now(), busy: true, data: {}, paths: new Set() };
    ctx.alive = () => my === seq;
    cur = ctx;
    // la barra marca la sección de origen: un jugador abierto desde Equipos deja marcada Equipos
    const entry = nav.stack[nav.i] || (nav.stack[nav.i] = { h: location.hash });
    entry.h = location.hash;
    if (views[name] && isRoot(name)) entry.root = name;
    else if (!entry.root) entry.root = view.tab || 'juegos';
    state.root = entry.root;
    try { history.replaceState({ pc: nav.i, root: entry.root }, ''); } catch (e) { /* nada */ }
    saveNav();
    setTab(views[name] && isRoot(name) ? name : entry.root);
    // atrás a una pantalla que estaba arriba (y = 0): también arriba, no donde quedó la anterior
    if (mode === 'new' || (mode === 'back' && !(snap && snap.y > 0))) window.scrollTo(0, 0);
    // un filtro no achica la página mientras carga: la vista se queda donde estaba
    el.style.minHeight = mode === 'keep' ? el.offsetHeight + 'px' : '';
    let kind;
    try { kind = typeof view.skeleton === 'function' ? view.skeleton(args) : view.skeleton; } catch (e) { kind = null; }
    U.loading(el, kind);
    // pantalla nueva: el hueco del aviso de conexión vuelve a su alto justo (en la misma pantalla solo crece)
    if (mode !== 'keep') connRoom(true);
    const unguard = guard(ctx, () => route(), opts.until);
    try {
      await view.render(el, args, ctx);
    } catch (e) {
      if (ctx.alive()) U.error(el, e, () => route());
    }
    unguard();
    ctx.busy = false;
    if (ctx.alive()) el.style.minHeight = '';
    if (ctx.alive() && snap) { putUI(el, snap); restoreY(snap.y); }
    // de vuelta (atrás) a una pantalla, la fila que la persona había corrido se queda como la dejó
    if (ctx.alive()) chipsOn(el, ctx, mode === 'back' && snap && snap.seen ? snap.seen.map(s => !s) : null);
    updateAgo();
    connShow();
    if (ctx.alive()) setTitle(el, ctx);
    // el lector de pantalla arranca en la sección nueva (sin mover la vista)
    if (mode !== 'keep' && ctx.alive()) { try { el.focus({ preventScroll: true }); } catch (e) { /* navegador viejo */ } }
    if (ctx.again && ctx.alive()) { ctx.again = false; refreshView(ctx); }
  }

  // Repinta la vista abierta sin saltos. Mientras se repinta, la vista no puede achicarse (así la página no sube ni se
  // corta un desliz con inercia), y un observador devuelve al instante lo de lado y los desplegables de los elementos
  // nuevos. Si ya hay un repintado andando, se repite una vez al terminar.
  function refreshView(ctx) {
    if (ctx.running) { ctx.again = true; return ctx.running; }
    if (ctx.busy) { ctx.again = true; return Promise.resolve(); } // la primera pintada todavía no termina
    const v = ctx.view, el = ctx.el;
    const snap = takeUI(el, true), done = new WeakSet(), leave = chipsSeen(el).map(s => !s);
    const fix = () => { if (ctx.alive()) putUI(el, snap, done); };
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(fix) : null;
    if (mo) mo.observe(el, { childList: true, subtree: true });
    el.style.minHeight = el.offsetHeight + 'px';
    ctx.busy = true;
    ctx.again = false;
    ctx.lastRefresh = Date.now();
    ctx.running = Promise.resolve()
      .then(() => (v.refresh ? v.refresh(el, ctx.args, ctx) : v.render(el, ctx.args, ctx)))
      .catch(e => console.warn('refresco', e))
      .then(() => {
        fix();
        if (mo) mo.disconnect();
        if (ctx.alive()) { el.style.minHeight = ''; chipsOn(el, ctx, leave); }
        ctx.busy = false;
        ctx.running = null;
        updateAgo();
        connShow();
        if (ctx.again && ctx.alive()) { ctx.again = false; return refreshView(ctx); }
      });
    return ctx.running;
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
    refreshView(cur);
  }

  // Datos renovados en segundo plano (api.js, swr): si la vista abierta los usa, se repinta.
  API.watcher = path => { if (cur) cur.paths.add(path); };
  let datosT = 0;
  window.addEventListener('pc:datos', e => {
    const path = e.detail && e.detail.path;
    if (path && /\/schedule\?/.test(path) && path.indexOf('season=' + API.currentSeason() + '&') > 0) recheckSeason();
    if (!cur || !path || !cur.paths.has(path)) return;
    clearTimeout(datosT);
    datosT = setTimeout(() => { if (cur) refreshView(cur); }, 120); // juntar las que llegan casi a la vez
  });

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
      state.picked = true; // la eligió la persona: no se corrige sola
      route({ mode: 'new' });
    });
  }
  function setSeason(s) {
    state.season = s;
    const sel = document.getElementById('season');
    if (sel) sel.value = String(s);
  }
  // Temporada que se muestra: la en curso si ya empezó; si no, la anterior, con la cuenta regresiva de la nueva.
  async function decideSeason() {
    const top = API.currentSeason();
    try {
      const reg = (await seasonGames(top)).filter(g => g.type === 'R');
      const started = reg.some(g => g.status === 'final' || g.status === 'live');
      const opener = reg.find(g => g.status === 'pre') || null;
      return started ? { season: top, upcoming: null } : { season: top - 1, upcoming: opener ? { season: top, game: opener } : null };
    } catch (e) {
      return { season: top - 1, upcoming: null };
    }
  }
  // Llegó el calendario nuevo de la temporada en curso: si cambia la decisión (arrancó la temporada), se corrige.
  async function recheckSeason() {
    const d = await decideSeason();
    const up = state.upcoming, du = d.upcoming;
    const same = d.season === state.season && (!up === !du) && (!up || (up.season === du.season && up.game.pk === du.game.pk));
    if (same || state.picked) return;
    setSeason(d.season);
    state.upcoming = du;
    if (cur && cur.name !== 'juego' && cur.name !== 'jugador') route({ mode: 'keep' });
  }

  // ¿Hay juegos en vivo? Alimenta la marca roja de la cabecera y el ritmo de refresco de las demás vistas.
  // De madrugada también mira los de ayer: un juego que empezó a las 8 pm puede seguir pasada la medianoche.
  // Cuando arranca la temporada nueva con la app abierta, se cambia sola a esa temporada.
  async function pulse() {
    if (document.hidden) return;
    const flag = document.getElementById('live-flag');
    try {
      const live = state.liveToday > 0;
      // espera la respuesta (sin swr): aquí importa saber ya si hay juegos en vivo
      const days = [API.day(D.today(), live, true)];
      if (D.hourVE() < 5) days.push(API.day(D.add(D.today(), -1), live, true));
      const games = [].concat(...(await Promise.all(days)).map(d => C.flatSchedule(d)));
      const n = games.filter(g => g.status === 'live').length;
      state.liveToday = n;
      if (flag) { flag.hidden = !n; flag.textContent = n === 1 ? '1 en vivo' : `${n} en vivo`; }
      const up = state.upcoming;
      if (up && games.some(g => (g.status === 'live' || g.status === 'final') && D.seasonOf(g.date) === up.season)) {
        state.upcoming = null;
        // si la persona eligió otra temporada en el selector, se queda en la suya
        if (!state.picked) {
          setSeason(up.season);
          if (cur && cur.name !== 'juego' && cur.name !== 'jugador') route({ mode: 'keep' });
        }
      }
    } catch (e) { /* sin red: se reintenta en el próximo pulso */ }
  }

  // ---------- tirar hacia abajo para actualizar ----------
  // Con la página arriba del todo, arrastrar hacia abajo baja una pelota que gira con el dedo; soltando pasados 70 px
  // se refresca la vista abierta pidiendo todo fresco, y la pelota sigue girando hasta que llegan los datos.
  // Solo cuenta un gesto vertical que empieza arriba y lejos de los bordes (el gesto atrás de Android).
  const BALL = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="ptr-cuero" cx="20" cy="20" r="17"/>' +
    '<path class="ptr-costura" d="M9.2 7.3c4.6 3.7 6.7 8 6.7 12.7s-2.1 9-6.7 12.7M30.8 7.3c-4.6 3.7-6.7 8-6.7 12.7s2.1 9 6.7 12.7"/>' +
    '<path class="ptr-puntos" d="M10.6 11.2l2.6-1.3M12.5 15.1l2.8-.7M13.3 19.4h2.9M12.9 23.8l2.8.8M11.1 28l2.5 1.4M29.4 11.2l-2.6-1.3M27.5 15.1l-2.8-.7M26.7 19.4h-2.9M27.1 23.8l-2.8.8M28.9 28l-2.5 1.4"/></svg>';
  const PTR_LIMIT = 70, PTR_MAX = 120, PTR_EDGE = 24;
  function ptrInit() {
    const box = document.getElementById('ptr');
    if (!box) return;
    box.innerHTML = `<span class="ptr-in">${BALL}</span>`;
    const ball = box.firstChild;
    let x0 = 0, y0 = 0, d = 0, on = false, decided = false, working = false, raf = 0;
    const paint = () => {
      raf = 0;
      box.style.transform = `translateY(${d.toFixed(1)}px)`;
      box.style.opacity = String(Math.min(1, d / PTR_LIMIT));
      ball.style.transform = `rotate(${Math.round(d * 4)}deg)`;
      box.classList.toggle('listo', d >= PTR_LIMIT);
    };
    const reset = () => {
      box.classList.remove('tira', 'listo', 'gira');
      box.style.transform = ''; box.style.opacity = ''; ball.style.transform = '';
    };
    document.addEventListener('touchstart', e => {
      on = false;
      if (working || e.touches.length !== 1 || window.scrollY > 0) return;
      const t = e.touches[0];
      if (t.clientX < PTR_EDGE || t.clientX > window.innerWidth - PTR_EDGE) return;
      if (e.target.closest && e.target.closest('input, select, textarea, .tabs, .update')) return;
      x0 = t.clientX; y0 = t.clientY; d = 0; decided = false; on = true;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!on) return;
      const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // de lado (una tabla, los chips) o hacia arriba: no es para actualizar
        if (dy <= 0 || Math.abs(dx) * 1.2 > dy || window.scrollY > 0) { on = false; return; }
        decided = true;
        const top = document.querySelector('.top');
        box.style.top = Math.round((top ? top.getBoundingClientRect().bottom : 56) + 6 - 48) + 'px';
        box.classList.add('tira');
      }
      d = Math.min(PTR_MAX, Math.max(0, dy - 8) * 0.6); // resistencia, como un resorte
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    const end = cancel => {
      if (!on) return;
      on = false;
      if (!decided) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      box.classList.remove('tira');
      if (cancel || d < PTR_LIMIT) { reset(); return; }
      working = true;
      box.classList.add('gira');
      box.style.transform = `translateY(${PTR_LIMIT}px)`;
      box.style.opacity = '1';
      const c = cur;
      const job = c ? API.force(() => Promise.all([refreshView(c), pulse()])) : Promise.resolve();
      Promise.all([job.catch(() => { /* el aviso de conexión lo dice */ }), wait(500)]).then(() => { working = false; reset(); });
    };
    document.addEventListener('touchend', () => end(false), { passive: true });
    document.addEventListener('touchcancel', () => end(true), { passive: true });
  }

  // ---------- aviso de conexión ----------
  // Sin red: píldora arriba "Sin conexión · viendo lo de las 8:41 p. m." (la hora del dato que está en pantalla);
  // a los 4 s se acorta a "Sin conexión". Cuando vuelve: "Conectado" en verde, y se recoge a los 2 s.
  // Mientras se ve, la pantalla le guarda su alto arriba (--conn-h, en el relleno de #view en styles.css): así no tapa
  // la miga de un juego ni el título de un aviso de error. Con la chapita a la vista la píldora baja bajo ella
  // (css/nav.css), y el hueco queda arriba de la página, fuera de la vista: no se tapan una a la otra.
  // En una misma pantalla el hueco solo crece (cuando la píldora se acorta, la página no salta a los 4 s); al cambiar
  // de pantalla vuelve al alto justo, y se suelta cuando la píldora se esconde. Si la persona ya bajó, la página se
  // corre lo mismo que el hueco: lo que está mirando no se mueve.
  let connWas = true, connT = 0, connTxt = '', roomH = 0;
  function connRoom(fit) {
    const box = document.getElementById('conn');
    if (!box) return;
    const h = box.hidden ? 0 : Math.ceil(box.getBoundingClientRect().height) + 8; // + var(--s2) de aire
    const next = !h ? 0 : fit ? h : Math.max(roomH, h);
    if (next === roomH) return;
    const view = document.getElementById('view');
    // lo que está arriba en la pantalla: el primer hijo de la vista que todavía se ve
    const a = window.scrollY > 0 && view ? Array.from(view.children).find(n => n.getBoundingClientRect().bottom > 0) : null;
    const t0 = a ? a.getBoundingClientRect().top : 0;
    roomH = next;
    document.documentElement.style.setProperty('--conn-h', next + 'px');
    // el navegador puede haberlo corregido solo (anclaje del desplazamiento); si no, se corrige aquí
    if (a) { const dy = a.getBoundingClientRect().top - t0; if (Math.abs(dy) >= 1) window.scrollBy(0, dy); }
  }
  // La píldora cambia de alto con su texto, al acortarse, con la letra que llega o al girar el teléfono.
  function connInit() {
    const box = document.getElementById('conn');
    if (box && typeof ResizeObserver === 'function') new ResizeObserver(() => connRoom(false)).observe(box);
  }
  function connShow() {
    const box = document.getElementById('conn');
    if (!box) return;
    const online = API.status.online;
    if (!online) {
      const fr = document.querySelector('#view [data-ago]');
      const t = (fr && +fr.dataset.ago) || API.status.lastOk;
      const when = !t ? '' : D.isoOf(t) === D.today() ? ` · viendo lo de las ${D.time(t)}` : ` · viendo lo del ${D.short(D.isoOf(t))}, ${D.time(t)}`;
      const txt = `<span>Sin conexión<span class="conn-mas">${esc(when)}</span></span>`;
      if (!box.hidden && connWas === false && txt === connTxt) return; // nada nuevo que decir
      clearTimeout(connT);
      connTxt = txt;
      box.className = 'conn off' + (box.hidden ? '' : ' in');
      box.setAttribute('role', 'status');
      box.innerHTML = txt;
      if (box.hidden) { box.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('in'))); }
      connRoom(false);
      connT = setTimeout(() => { box.classList.add('corto'); connRoom(false); }, 4000);
    } else if (!connWas) {
      connTxt = '';
      clearTimeout(connT);
      box.className = 'conn ok in';
      box.innerHTML = '<span>Conectado</span>';
      box.hidden = false;
      connRoom(false);
      connT = setTimeout(() => {
        box.classList.remove('in');
        connT = setTimeout(() => { box.hidden = true; connRoom(false); }, 320);
      }, 2000);
    }
    connWas = online;
  }
  window.addEventListener('pc:red', () => { connShow(); updateAgo(); });
  window.addEventListener('offline', () => { API.status.online = false; connShow(); updateAgo(); });

  // Alto de la cabecera (con la franja tricolor) en --top-h, para lo que se fija justo debajo de ella.
  function topHeight() {
    const top = document.querySelector('.top');
    if (!top) return;
    const set = () => document.documentElement.style.setProperty('--top-h', (top.offsetHeight + 6) + 'px');
    set();
    if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(top);
    else window.addEventListener('resize', set);
  }

  // ---------- versión nueva ----------
  // El service worker nuevo queda esperando; la página ofrece "Hay una versión nueva · Actualizar" y, al tocar,
  // le pide que se active y recarga cuando toma el control. La primera instalación se activa sola (sw.js).
  function swInit() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) return;
    const sw = navigator.serviceWorker;
    let asked = false;
    const box = document.getElementById('update');
    const hide = () => { if (box) { box.hidden = true; box.classList.remove('in'); } };
    // si la versión nueva se activó sola (venía de una versión que ya iba a la red), no hay nada que ofrecer
    sw.addEventListener('controllerchange', () => { if (asked) location.reload(); else hide(); });
    const offer = w => {
      if (!w || !box || !sw.controller) return; // sin versión anterior no hay nada que ofrecer
      box.innerHTML = '<p class="update-in" role="status"><span>Hay una versión nueva</span>' +
        '<button type="button" class="update-btn">Actualizar</button></p>';
      box.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('in')));
      box.querySelector('button').addEventListener('click', e => {
        asked = true;
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Actualizando…';
        w.postMessage('actualizar');
      });
    };
    sw.register('sw.js').then(reg => {
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        // espera un momento: una versión que se activa sola también pasa por 'installed'
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') setTimeout(() => { if (w.state === 'installed') offer(w); }, 1000); });
      });
      // una app instalada puede pasar días abierta: al volver a ella se busca versión nueva (como mucho cada 30 min)
      let last = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - last > 30 * 60e3) { last = Date.now(); reg.update().catch(() => { /* sin red */ }); }
      });
    }).catch(() => { /* sin modo sin conexión */ });
  }

  async function boot() {
    PC.arranco = true; // el vigía de index.html (core.js no cargó o no arrancó) ya no hace falta: desde aquí vigila core.js
    const el = document.getElementById('view');
    // Vigía del arranque: la primera visita espera la red para decidir la temporada. La primera pantalla sigue con el
    // mismo plazo (until), que cuenta desde aquí.
    const until = Date.now() + GUARD_MS;
    const unguard = guard({ el, busy: true, alive: () => !cur }, () => location.reload(), until);
    connInit();
    navInit();
    // Mientras se decide la temporada (la primera visita espera la red), un enlace abierto en frío ya muestra el esqueleto
    // de su pantalla y su pestaña marcada. La portada de Juegos ya viene con el suyo en index.html.
    const p0 = parse(), v0 = views[p0.name] || views.juegos, e0 = nav.stack[nav.i];
    if (v0 && p0.name !== 'juegos') {
      let kind;
      try { kind = typeof v0.skeleton === 'function' ? v0.skeleton(p0.args) : v0.skeleton; } catch (e) { kind = null; }
      U.loading(el, kind);
    }
    setTab(views[p0.name] && isRoot(p0.name) ? p0.name : (e0 && e0.root) || (v0 && v0.tab) || 'juegos');
    // Con el calendario guardado esto es instantáneo (swr); solo la primera visita espera la red.
    const d = await decideSeason();
    state.season = d.season;
    state.upcoming = d.upcoming;
    seasonSelect();
    topHeight();
    window.addEventListener('hashchange', onHash);
    // Al volver a la app: el reloj refresca lo que va en vivo; lo demás, si pasó un rato, se repinta con lo guardado
    // y se renueva en segundo plano (swr).
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!cur) return;
      cur.lastRefresh = 0;
      pulse();
      const every = typeof cur.view.every === 'function' ? cur.view.every(cur) : cur.view.every;
      if (!every && hiddenAt && Date.now() - hiddenAt > 5 * 60e3 && !cur.busy) refreshView(cur);
    });
    window.addEventListener('online', () => {
      API.status.fails = 0;
      if (cur) cur.lastRefresh = 0;
      // una consulta fresca confirma que de verdad volvió la red (y pone "Conectado")
      API.force(() => pulse());
      if (cur && !cur.busy) refreshView(cur);
    });
    ptrInit();
    unguard();
    await route({ mode: nav.first, until });
    pulse();
    setInterval(tick, 1000);
    setInterval(pulse, 60000);
    swInit();
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });

  // En iPhone, :active (la tarjeta que se hunde al tocarla) solo funciona si hay algún touchstart escuchando.
  document.addEventListener('touchstart', () => {}, { passive: true });

  Object.assign(PC, {
    TEAMS, TEAM_IDS, team, venue, PHASES, MODERN, phaseLabel, seasonLabel, F, D, U, esc, state, savePrefs,
    seasonGames, statsCtx, teamGames, register, route, setSeason, updateAgo,
    // navegar desde una vista: PC.go(href) suma un paso; PC.go(href, {replace: true}) reemplaza la pantalla sin sumar
    // pasos (keep: true además conserva el desplazamiento, como un filtro). No usar location.replace directo: la pila
    // interna del historial lo contaría como un paso nuevo.
    go: (href, o) => { o = o || {}; if (o.replace) replaceTo(href, !!o.keep); else location.hash = href; },
    // repinta la vista abierta (o ctx) sin saltos: conserva desplazamiento, tablas y chips de lado y desplegables
    refresh: ctx => ((ctx || cur) ? refreshView(ctx || cur) : Promise.resolve()),
    // nombre anterior (tabla.js y lideres.js lo llamaban tras pintar): ahora lo hace route() en todas las pantallas
    chipsOn: (el, ctx) => chipsOn(el, ctx)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
