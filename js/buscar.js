/* Pizarra Criolla · buscar.js
   La búsqueda de jugadores y equipos (ruta #/buscar), sin importar los acentos, y el selector de jugador que usan
   otras pantallas (PC.pickPlayer). Los jugadores salen de API.players(temporada) y se ordenan con C.searchPlayers;
   los equipos, de los 8 de la LVBP. Las dos usan el mismo campo: se escribe y los resultados salen al momento; con
   las flechas se recorre la lista (el foco sigue en el campo) y Enter abre el marcado, o el primero. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, U = PC.U, esc = PC.esc, team = PC.team;

  const I_LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.3"/><path d="M15.2 15.2l5 5"/></svg>';
  const I_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  const N_PLAYERS = 20, N_TEAMS = 8;

  // ---------- recientes: lo que se abrió desde una búsqueda (jugadores y equipos), lo último primero ----------
  // localStorage 'pc:buscar': [{t: 'j' | 'e', id, n: nombre, tm: equipo, pos, old: su temporada si salió de la anterior}]
  const REC = 'pc:buscar', REC_MAX = 8;
  function recRead() {
    try {
      const a = JSON.parse(localStorage.getItem(REC));
      return Array.isArray(a) ? a.filter(r => r && (r.t === 'j' || r.t === 'e') && r.id && r.n) : [];
    } catch (e) { return []; }
  }
  function recWrite(a) {
    try { if (a.length) localStorage.setItem(REC, JSON.stringify(a.slice(0, REC_MAX))); else localStorage.removeItem(REC); } catch (e) { /* sin almacenamiento */ }
  }
  const recAdd = r => recWrite([r].concat(recRead().filter(x => !(x.t === r.t && x.id === r.id))));

  // ---------- equipos ----------
  // Cada palabra buscada tiene que empezar una palabra del equipo (nombre, ciudad o siglas); con 3 letras o más, vale
  // también si está dentro del nombre. Primero las siglas exactas, después el nombre corto, después lo demás.
  const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los']);
  let teamIdx = null;
  function teamsIndex() {
    if (!teamIdx) {
      teamIdx = PC.TEAM_IDS.map(id => {
        const t = team(id), full = C.norm(`${t.name} ${t.city}`);
        return { id, t, full, abbr: C.norm(t.abbr), short: C.norm(t.short), words: (full + ' ' + C.norm(t.abbr)).split(/\s+/).filter(w => w && !STOP.has(w)) };
      });
    }
    return teamIdx;
  }
  function findTeams(q) {
    const n = C.norm(q).replace(/\s+/g, ' ').trim();
    if (!n) return [];
    const qs = n.split(' ');
    const out = [];
    for (const x of teamsIndex()) {
      const every = qs.every(w => x.words.some(p => p.startsWith(w)));
      if (!every && !(n.length >= 3 && x.full.indexOf(n) >= 0)) continue;
      out.push({ id: x.id, rank: x.abbr === n ? 0 : x.short.startsWith(n) ? 1 : every ? 2 : 3, s: x.t.short });
    }
    return out.sort((a, b) => a.rank - b.rank || a.s.localeCompare(b.s, 'es')).slice(0, N_TEAMS).map(o => o.id);
  }

  // ---------- jugadores para la búsqueda (API.players de api.js), en memoria mientras se busca ----------
  // Los de la temporada elegida. Si cargó y no tiene (antes del primer juego) o tiene pocos (los primeros días), se suman
  // los de la anterior que no estén, marcados con su temporada (old): así se encuentra a cualquiera igual. Si la elegida
  // no cargó, es un error (con Reintentar), no "todavía no tiene juegos". pool.seasons dice de qué temporadas es la lista,
  // para el rótulo. (PC.pickPlayer no mezcla: compara una temporada.)
  const FEW = 200;
  const pool = { season: null, list: null, seasons: [], err: null, p: null };
  const playersOf = s => Promise.resolve().then(() => API.players(s)).then(l => (Array.isArray(l) ? l : []));
  function loadPlayers(season) {
    if (pool.season === season && (pool.list || pool.p)) return pool.p || Promise.resolve(pool.list);
    Object.assign(pool, { season, list: null, seasons: [], err: null });
    const p = pool.p = (async () => {
      let list = await playersOf(season);
      const seasons = list.length ? [season] : [];
      if (list.length < FEW && season > 2016) {
        let prev = [];
        try { prev = await playersOf(season - 1); } catch (e) { if (!list.length) throw e; } // sin ninguna de las dos, error
        if (prev.length) {
          const ids = new Set(list.map(x => +x.id));
          list = list.concat(prev.filter(x => !ids.has(+x.id)).map(x => Object.assign({}, x, { old: season - 1 })));
          seasons.push(season - 1);
        }
      }
      return { list, seasons };
    })().then(r => { if (pool.p === p) { pool.list = r.list; pool.seasons = r.seasons; pool.p = null; } return r.list; },
      e => { if (pool.p === p) { pool.err = e; pool.p = null; } throw e; });
    return p;
  }
  // La lista se pide antes de hacer falta: al tocar la lupa y, una vez, cuando la app queda libre después de arrancar
  // (unos 17 KB que quedan guardados por horas). La API de estadísticas puede tardar 15 s la primera vez: así la primera
  // búsqueda no espera. Con el ahorro de datos del teléfono, no.
  const prefetch = () => {
    const s = PC.state.season, c = navigator.connection;
    if (s == null || navigator.onLine === false || (c && c.saveData)) return;
    if (pool.season === s && pool.err) return; // ya falló: la búsqueda lo dice y tiene Reintentar
    loadPlayers(s).catch(() => { /* se vuelve a pedir al buscar */ });
  };
  document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.top-buscar')) prefetch(); }, { passive: true });
  root.addEventListener('load', () => {
    let tries = 0;
    const later = () => {
      if (PC.state.season == null) { if (++tries < 6) setTimeout(later, 3000); return; } // la temporada todavía se decide
      (root.requestIdleCallback || (f => setTimeout(f, 1)))(prefetch, { timeout: 4000 });
    };
    setTimeout(later, 5000);
  });
  const LOADING = '<p class="bq-nota" role="status">Cargando la lista de jugadores… La primera vez puede tardar unos segundos.</p>';
  const seasonTag = s => `<span class="nw">${esc(PC.seasonLabel(s))}</span>`;
  // "Jugadores de la temporada 2025-26…", o de las dos, o la anterior porque la elegida todavía no tiene juegos; sin la
  // lista (no cargó), solo los equipos
  function seasonsNote(season, seasons, failed) {
    if (failed) return 'Solo los 8 equipos: la lista de jugadores no cargó.';
    if (seasons.length === 2) return `Jugadores de ${seasonTag(seasons[0])} y de ${seasonTag(seasons[1])}, y los 8 equipos.`;
    if (seasons.length === 1 && seasons[0] !== season) return `Jugadores de ${seasonTag(seasons[0])} (la ${seasonTag(season)} todavía no tiene juegos) y los 8 equipos.`;
    return `Jugadores de la temporada ${seasonTag(season)} y los 8 equipos.`;
  }
  const teamOf = p => (p && p.team != null ? (typeof p.team === 'object' ? +p.team.id : +p.team) : null);
  // bateo o pitcheo; el que hizo las dos cosas cuenta por su posición (un receptor que lanzó un inning no es lanzador)
  const groupOf = p => (p && (p.grupo === 'bateo' || p.grupo === 'pitcheo') ? p.grupo : p && p.pos === 'P' ? 'pitcheo' : 'bateo');

  // ---------- filas ----------
  // Insignia del equipo (o un recuadro vacío si no hay uno), nombre y una línea chica (equipo, posición y, si es de la
  // temporada anterior, cuál).
  const badge = id => (id && PC.TEAMS[id] ? U.chip(id, 's') : '<span class="bq-sin" aria-hidden="true">—</span>');
  const playerSub = (tm, pos, old) => [tm && PC.TEAMS[tm] ? PC.TEAMS[tm].short : '', pos || '', old ? 'en ' + PC.seasonLabel(old) : ''].filter(Boolean).join(' · ');
  // o: {tag: 'a' | 'button', id: id del elemento, href, data: atributos extra}
  function row(kind, item, o) {
    const isTeam = kind === 'e';
    const t = isTeam ? team(item.id) : null;
    const name = isTeam ? t.name : item.n;
    const sub = isTeam ? t.city : playerSub(item.tm, item.pos, item.old);
    const inner = `${isTeam ? U.chip(item.id, 's') : badge(item.tm)}<span class="bq-nm"><b><span class="sr">${isTeam ? 'Equipo: ' : ''}</span>${esc(name)}</b>` +
      `${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
    const attrs = `class="bq-it" role="option" id="${o.id}" tabindex="-1" aria-selected="false" ${o.data || ''}`;
    return `<li role="presentation">${o.tag === 'a' ? `<a ${attrs} href="${o.href}">${inner}</a>` : `<button type="button" ${attrs}>${inner}</button>`}</li>`;
  }
  const recOf = (kind, item) => (kind === 'e' ? { t: 'e', id: item.id, n: team(item.id).name }
    : Object.assign({ t: 'j', id: item.id, n: item.n, tm: item.tm || null, pos: item.pos || '' }, item.old ? { old: item.old } : {}));
  const asItem = p => Object.assign({ id: +p.id, n: p.fullName, tm: teamOf(p), pos: p.pos || '' }, p.old ? { old: p.old } : {});
  // Un grupo de la lista: el rótulo es solo visual (las opciones dicen lo suyo); la lista es parte del listbox.
  const group = (label, rows) => `<div class="bq-gr" role="presentation"><p class="bq-h" aria-hidden="true"><span class="bq-hh">${esc(label)}</span></p>` +
    `<ul class="bq-lista" role="presentation">${rows.join('')}</ul></div>`;

  // ---------- el campo y su lista (combobox) ----------
  // Flechas: recorren las opciones sin sacar el foco del campo (aria-activedescendant). Enter: la marcada, o la primera.
  // Escape con algo escrito: lo borra (en una hoja, el Escape siguiente la cierra). sync(), después de pintar: el campo
  // apunta a su lista (aria-controls, aria-expanded) solo si hay una con opciones.
  function wire(inp, box) {
    const opts = () => Array.from(box.querySelectorAll('[role="option"]'));
    const mark = i => {
      const ops = opts();
      ops.forEach((o, k) => { o.classList.toggle('on', k === i); o.setAttribute('aria-selected', String(k === i)); });
      const o = ops[i];
      if (o) { inp.setAttribute('aria-activedescendant', o.id); o.scrollIntoView({ block: 'nearest' }); } else inp.removeAttribute('aria-activedescendant');
    };
    inp.addEventListener('keydown', e => {
      if (e.isComposing) return;
      const ops = opts();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!ops.length) return;
        e.preventDefault();
        const i = ops.findIndex(o => o.classList.contains('on'));
        mark(e.key === 'ArrowDown' ? (i + 1) % ops.length : i <= 0 ? ops.length - 1 : i - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const o = ops.find(x => x.classList.contains('on')) || ops[0];
        if (o) o.click();
      } else if (e.key === 'Escape' && inp.value) {
        e.preventDefault();
        e.stopPropagation();
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    return {
      sync() {
        const lb = box.querySelector('[role="listbox"]');
        const on = !!lb && !!lb.querySelector('[role="option"]');
        if (on) inp.setAttribute('aria-controls', lb.id); else inp.removeAttribute('aria-controls');
        inp.setAttribute('aria-expanded', String(on));
        mark(-1);
      }
    };
  }
  // El anuncio para el lector, cuando se deja de escribir. El mismo texto otra vez también se dice ("her" y "herr" con
  // los mismos resultados): se alterna un espacio duro al final, que no se lee.
  function announcer(el) {
    let t = 0, flip = false;
    return txt => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!el.isConnected) return;
        flip = !flip;
        el.textContent = txt ? txt + (flip ? ' ' : '') : '';
      }, 700);
    };
  }
  // "3 equipos y 12 jugadores; el primero, Leones del Caracas" (con más jugadores de los que se muestran: "más de 20")
  const countText = (nt, np, more, first) => {
    const parts = [];
    if (nt) parts.push(`${nt} ${nt === 1 ? 'equipo' : 'equipos'}`);
    if (np) parts.push(more ? `más de ${np} jugadores` : `${np} ${np === 1 ? 'jugador' : 'jugadores'}`);
    if (!parts.length) return 'Sin resultados';
    return parts.join(' y ') + (first ? `; el primero, ${first}` : '');
  };
  // los primeros n jugadores de la lista para q, y si hay más
  const topPlayers = (list, q) => {
    const all = C.searchPlayers(list, q, N_PLAYERS + 1);
    return { items: all.slice(0, N_PLAYERS).map(asItem), more: all.length > N_PLAYERS };
  };
  const field = (id, ph, value) => `<div class="bq-campo">${I_LUPA}<input id="${id}" type="search" role="combobox" aria-expanded="false" ` +
    `aria-autocomplete="list" aria-label="${esc(ph)}" placeholder="${esc(ph)}" value="${esc(value || '')}" ` +
    `autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">` +
    `<button type="button" class="bq-x" aria-label="Borrar lo escrito"${value ? '' : ' hidden'}>${I_X}</button></div>`;
  const none = q => `<p class="bq-nada">Nada con <b>«${esc(q.trim())}»</b>. Prueba solo con el apellido; las tildes no importan.</p>`;

  // ---------- pantalla #/buscar ----------
  // Lo escrito se recuerda (también al recargar): de vuelta de un jugador, la búsqueda está igual.
  let lastQ = '';
  try { lastQ = sessionStorage.getItem('pc:buscar:q') || ''; } catch (e) { /* nada */ }
  const saveQ = q => { lastQ = q; try { sessionStorage.setItem('pc:buscar:q', q); } catch (e) { /* nada */ } };

  U.skeletons.buscar = () => `<div class="crumbs"><a class="bq-back">${PC.I_LEFT}<span class="sk-t">Volver</span></a></div>` +
    `<div class="page-head"><h1><span class="sk-t">Buscar</span></h1></div>` +
    `<span class="sk" style="width:100%;height:48px;border-radius:999px"></span>` +
    `<div class="sk-list">${[0, 1, 2].map(() => '<div class="sk-row"><span class="sk" style="width:2.75rem;height:1.6rem"></span><div class="sk-col"><span class="sk" style="width:55%;height:1rem"></span><span class="sk" style="width:35%;height:.8rem"></span></div></div>').join('')}</div>`;

  PC.register('buscar', {
    skeleton: 'buscar',
    // la lista de jugadores no cambia en la sesión: un dato renovado (o tirar para actualizar) no rehace la pantalla
    // mientras se escribe (se perdería el foco del campo, y el teclado)
    refresh() { /* nada */ },
    render(el, args, ctx) {
      const season = PC.state.season;
      el.innerHTML = `<nav class="crumbs"><a class="bq-back" href="#/juegos" data-back>${PC.I_LEFT}<span>Volver</span></a></nav>
        <div class="page-head"><h1>Buscar</h1></div>
        <div class="sec">${field('bq', 'Jugador o equipo', lastQ)}
          <p class="bq-nota" id="bq-de">${seasonsNote(season, pool.season === season && pool.list ? pool.seasons : [])}</p></div>
        <div id="bq-zona"></div>
        <p class="sr" role="status" id="bq-estado"></p>`;
      const inp = el.querySelector('#bq'), zona = el.querySelector('#bq-zona'), x = el.querySelector('.bq-x');
      const note = el.querySelector('#bq-de');
      const say = announcer(el.querySelector('#bq-estado'));
      const lb = wire(inp, zona);
      const paint = () => {
        const q = inp.value, has = !!q.trim();
        saveQ(q);
        x.hidden = !q;
        // de qué temporadas son los jugadores (se sabe al llegar la lista), o que no cargaron
        if (pool.season === season) note.innerHTML = seasonsNote(season, pool.list ? pool.seasons : [], !!pool.err && !pool.list);
        let html = '';
        if (!has) {
          const rec = recRead();
          if (rec.length) {
            html = `<div class="bq-gr"><div class="bq-h"><h2>Recientes</h2><button type="button" class="bq-borra" aria-label="Borrar las búsquedas recientes">Borrar</button></div>` +
              `<ul class="bq-lista" role="listbox" id="bq-res" aria-label="Búsquedas recientes">${rec.map((r, i) => row(r.t, r, {
                tag: 'a', id: 'bq-o-' + i, href: `#/${r.t === 'e' ? 'equipo' : 'jugador'}/${r.id}`, data: `data-rec="${esc(JSON.stringify(r))}"`
              })).join('')}</ul></div>`;
          } else html = `<p class="bq-nota">Escribe el nombre o el apellido de un jugador, o el nombre, la ciudad o las siglas de un equipo.</p>`;
          say('');
        } else {
          const teams = findTeams(q);
          const pl = pool.list ? topPlayers(pool.list, q) : { items: [], more: false }, players = pl.items;
          let i = 0;
          const groups = [];
          if (teams.length) groups.push(group('Equipos', teams.map(id => row('e', { id }, { tag: 'a', id: 'bq-o-' + i++, href: `#/equipo/${id}`, data: `data-rec="${esc(JSON.stringify(recOf('e', { id })))}"` }))));
          if (players.length) groups.push(group('Jugadores', players.map(p => row('j', p, { tag: 'a', id: 'bq-o-' + i++, href: `#/jugador/${p.id}`, data: `data-rec="${esc(JSON.stringify(recOf('j', p)))}"` }))));
          html = groups.length ? `<div class="bq-res" role="listbox" id="bq-res" aria-label="Resultados">${groups.join('')}</div>` : '';
          if (pool.p) html += LOADING; // los equipos ya están; los jugadores, cuando lleguen
          else if (pool.err) html += `<div class="empty err"><p>No se pudo cargar la lista de jugadores.</p><button type="button" class="btn" data-retry>Reintentar</button></div>`;
          else if (!i) html = none(q);
          if (!pool.p) say(countText(teams.length, players.length, pl.more, teams.length ? team(teams[0]).name : players.length ? players[0].n : ''));
        }
        zona.innerHTML = html;
        lb.sync();
      };
      inp.addEventListener('input', paint);
      x.addEventListener('click', () => { inp.value = ''; paint(); inp.focus(); });
      zona.addEventListener('click', e => {
        const t = e.target;
        if (t.closest('.bq-borra')) { recWrite([]); paint(); inp.focus(); return; }
        if (t.closest('[data-retry]')) { loadPlayers(season).then(paint, paint); paint(); return; }
        const a = t.closest('[data-rec]');
        if (a) { try { recAdd(JSON.parse(a.getAttribute('data-rec'))); } catch (err) { /* nada */ } }
      });
      // los jugadores de esta temporada (si eran de otra, se cambian ya); llegan después que los equipos, y entonces se
      // repinta lo que se esté buscando
      const ready = loadPlayers(season);
      paint();
      if (!pool.list) ready.then(() => { if (ctx.alive()) paint(); }, () => { if (ctx.alive()) paint(); });
      // al entrar, el foco va al campo (el teclado sale); de vuelta con Atrás, no
      if (ctx.mode === 'new') ctx.focus = inp;
    }
  });
  // La lupa de la cabecera estando ya en la búsqueda: al campo, con lo escrito marcado.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.top-buscar');
    if (!a || !/^#\/?buscar([/?]|$)/.test(location.hash)) return;
    const inp = document.getElementById('bq');
    if (!inp) return;
    e.preventDefault();
    inp.focus();
    inp.select();
  });

  // ---------- elegir un jugador (para comparar) ----------
  // PC.pickPlayer({titulo, grupo: 'bateo' | 'pitcheo' | null, temporada, excluir: [ids]}) → Promise de {id, fullName}
  // o null. Una hoja con el campo de búsqueda: los jugadores de esa temporada (por defecto la elegida arriba; sin mezclar
  // con otra: se compara esa temporada) de ese grupo (el que hizo las dos cosas, por su posición), sin los excluidos. Sin
  // escribir, los recientes que califican.
  PC.pickPlayer = o => new Promise(resolve => {
    o = o || {};
    const season = +o.temporada || PC.state.season;
    const grupo = o.grupo === 'bateo' || o.grupo === 'pitcheo' ? o.grupo : null;
    const out = new Set((o.excluir || []).map(Number));
    const fits = p => p && !out.has(+p.id) && (!grupo || groupOf(p) === grupo);
    const who = grupo === 'bateo' ? 'Bateadores' : grupo === 'pitcheo' ? 'Lanzadores' : 'Jugadores';
    let chosen = null, list = null, failed = false;
    const h = PC.sheet({
      titulo: o.titulo || 'Elegir jugador',
      clase: 'hoja-pk',
      html: `<div class="pk-cab">${field('pk-q', 'Nombre o apellido', '')}<p class="bq-nota pk-nota">${who} de la temporada <span class="nw">${esc(PC.seasonLabel(season))}</span>.</p></div>` +
        `<div class="pk-zona"></div><p class="sr" role="status"></p>`,
      alCerrar: () => resolve(chosen)
    });
    const el = h.el, inp = el.querySelector('#pk-q'), zona = el.querySelector('.pk-zona'), x = el.querySelector('.bq-x');
    const say = announcer(el.querySelector('p.sr[role="status"]'));
    const lb = wire(inp, zona);
    const paint = () => {
      const q = inp.value, has = !!q.trim();
      x.hidden = !q;
      let html = '';
      if (failed) html = `<div class="empty err"><p>No se pudo cargar la lista de jugadores.</p><button type="button" class="btn" data-retry>Reintentar</button></div>`;
      else if (!list) html = LOADING;
      else if (!list.length) html = `<p class="bq-nada">La temporada ${seasonTag(season)} todavía no tiene ${who.toLowerCase()} con juegos.</p>`;
      else {
        let items, more = false;
        if (has) ({ items, more } = topPlayers(list, q));
        else {
          // los recientes, con su equipo y su posición de esta temporada
          const byId = new Map(list.map(p => [+p.id, p]));
          items = recRead().filter(r => r.t === 'j' && byId.has(+r.id)).map(r => asItem(byId.get(+r.id)));
        }
        const rows = items.map((p, i) => row('j', p, { tag: 'button', id: 'pk-o-' + i, data: `data-id="${p.id}" data-n="${esc(p.n)}"` }));
        if (items.length) html = `${has ? '' : '<div class="bq-h"><h3>Recientes</h3></div>'}<ul class="bq-lista" role="listbox" id="pk-q-res" aria-label="${has ? 'Resultados' : 'Recientes'}">${rows.join('')}</ul>`;
        else html = has ? none(q) : '';
        if (has) say(countText(0, items.length, more, items.length ? items[0].n : ''));
      }
      zona.innerHTML = html;
      lb.sync();
    };
    inp.addEventListener('input', paint);
    x.addEventListener('click', () => { inp.value = ''; paint(); inp.focus(); });
    zona.addEventListener('click', e => {
      if (e.target.closest('[data-retry]')) { start(); return; }
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      chosen = { id: +b.dataset.id, fullName: b.dataset.n };
      const p = list && list.find(z => +z.id === chosen.id);
      recAdd(p ? recOf('j', asItem(p)) : { t: 'j', id: chosen.id, n: chosen.fullName });
      h.cerrar();
    });
    const start = () => {
      list = null;
      failed = false;
      paint();
      playersOf(season).then(l => { list = l.filter(fits); paint(); }, () => { failed = true; paint(); });
    };
    start();
    try { inp.focus({ preventScroll: true }); } catch (e) { /* nada */ }
  });
})(window);
