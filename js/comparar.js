/* Pizarra Criolla · comparar.js
   El comparador de dos jugadores (ruta #/comparar/<id>/<id>): números y percentiles lado a lado. Usa lo mismo que la
   ficha del jugador (PC.ficha, js/equipos.js): sus números, sus percentiles y contra quién se mide cada uno, así los
   dos dicen lo mismo de un jugador. Con un solo id pide el segundo (PC.pickPlayer, js/buscar.js). Bateadores con
   bateadores y lanzadores con lanzadores: si no, lo dice. Los estilos van en css/fichas.css. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, F = PC.F, U = PC.U, esc = PC.esc, team = PC.team;

  // Los números de la tabla. hi: true si más alto es mejor, false si más bajo; sin hi no entra en "Mejor en" (volumen).
  // rate: es una tasa (con muy poca muestra no cuenta para "Mejor en"). name: cómo se dice en "Mejor en".
  const NUM = {
    bat: [
      { label: 'PA', get: p => p.line.PA, fmt: F.int, title: 'Apariciones al plato' },
      { label: 'AVE', get: p => p.r.AVG, fmt: F.avg, hi: true, rate: 1 },
      { label: 'OBP', get: p => p.r.OBP, fmt: F.avg, hi: true, rate: 1 },
      { label: 'SLG', get: p => p.r.SLG, fmt: F.avg, hi: true, rate: 1 },
      { label: 'OPS', get: p => p.r.OPS, fmt: F.avg, hi: true, rate: 1 },
      { label: 'wRC+', get: p => p.r.wRCplus, fmt: F.int, hi: true, rate: 1 },
      { label: 'HR', get: p => p.line.HR, fmt: F.int, hi: true, name: 'jonrones' },
      { label: 'CI', get: p => p.line.RBI, fmt: F.int, hi: true, name: 'impulsadas', title: 'Carreras impulsadas' },
      { label: 'CA', get: p => p.line.R, fmt: F.int, hi: true, name: 'anotadas', title: 'Carreras anotadas' },
      { label: 'BR', get: p => p.line.SB, fmt: F.int, hi: true, name: 'bases robadas', title: 'Bases robadas' },
      { label: 'BB%', get: p => p.r.BBPct, fmt: F.pct, hi: true, rate: 1 },
      { label: 'K%', get: p => p.r.KPct, fmt: F.pct, hi: false, rate: 1 }
    ],
    pit: [
      { label: 'IL', get: p => p.line.OUTS, fmt: F.ip, title: 'Innings lanzados' },
      { label: 'G-P', show: p => `${p.line.W}-${p.line.L}`, title: 'Ganados y perdidos' },
      { label: 'EFE', get: p => p.r.ERA, fmt: F.era, hi: false, rate: 1 },
      { label: 'FIP', get: p => p.r.FIP, fmt: F.era, hi: false, rate: 1 },
      { label: 'WHIP', get: p => p.r.WHIP, fmt: F.era, hi: false, rate: 1 },
      { label: 'K', get: p => p.line.SO, fmt: F.int, hi: true, name: 'ponches' },
      { label: 'K%', get: p => p.r.KPct, fmt: F.pct, hi: true, rate: 1 },
      { label: 'BB%', get: p => p.r.BBPct, fmt: F.pct, hi: false, rate: 1 },
      { label: 'K-BB%', get: p => p.r.KBBPct, fmt: F.pct, hi: true, rate: 1 },
      { label: 'HR/9', get: p => p.r.HR9, fmt: F.era, hi: false, rate: 1 },
      { label: 'AVE rival', get: p => p.r.AVGa, fmt: F.avg, hi: false, rate: 1 },
      { label: 'JS', get: p => p.line.SV, fmt: F.int, hi: true, name: 'salvados', title: 'Juegos salvados' }
    ]
  };
  // Muestra mínima para que una tasa cuente en "Mejor en": la misma con que la ficha muestra percentiles.
  const MIN = { bat: x => x.line.PA >= 50, pit: x => x.line.BF >= 40 };
  const ROLE = { bat: 'bateador', pit: 'lanzador' };
  const GRUPO = { bat: 'bateo', pit: 'pitcheo' };
  const surname = n => (C.surname ? C.surname(n) : String(n || '').split(' ').slice(1).join(' ') || n);

  // ---------- esqueleto: barra, título, las dos tarjetas y la tabla ----------
  U.skeletons.comparar = () => {
    const K = PC.ficha;
    if (!K) return U.skeletons.lista();
    const g = K.ghost;
    const card = () => `<div class="cp-h sk-x"><p class="cp-eb"><span class="tchip s inv sk-chip">LVB</span>${g('Magallanes')}</p><p class="cp-n">${g('Nombre')}<b>${g('Apellido')}</b></p>` +
      `<p class="cp-sub">${g('RF · 000 PA · .000/.000/.000')}</p><span class="cp-chg">${g('Cambiar')}</span></div>`;
    const head = w => `<div class="sec-head"><span class="sk" style="font-size:var(--fs-h2);width:${w}em;height:1.1em"></span></div>`;
    // con la temporada elegida sin empezar, el aviso de que se ve la anterior (como la pantalla)
    return K.skBack() + `<div class="page-head"><p class="eyebrow">${g('Temporada regular 0000-00')}</p><h1>${g('Comparar')}</h1></div>` +
      (K.notStarted() ? K.skAviso('Apellido y Apellido todavía no juegan en 0000-00.') : '') +
      `<div class="cp-heads">${card()}${card()}</div>` +
      `<div class="sec">${head(4.5)}<div class="cp-best"><p>${g('Apellido, mejor en AVE, OBP, SLG, OPS, wRC+, jonrones e impulsadas.')}</p><p>${g('Apellido, mejor en anotadas y BB%.')}</p></div></div>` +
      `<div class="sec">${head(7)}<div class="cp-tw"><table class="cp-t"><thead><tr><th>${g('Apellido')}</th><th></th><th>${g('Apellido')}</th></tr></thead>` +
      `<tbody>${Array.from({ length: 8 }, () => `<tr><td>${g('.000')}</td><th>${g('AVE')}</th><td>${g('.000')}</td></tr>`).join('')}</tbody></table></div></div>`;
  };

  // ---------- un jugador en la temporada ----------
  // Sus filas de bateo y pitcheo (PC.statsCtx), su papel y su nombre. Si no jugó esta temporada, el nombre sale de la
  // API de la persona (una consulta, solo en ese caso).
  async function who(id, st, season) {
    const sb = st.batById.get(id), sp = st.pitById.get(id);
    const K = PC.ficha;
    const role = K.mainRole(sb, sp, !!(sp && sp.pos === 'P'));
    const row = role.main === 'bat' ? sb : role.main === 'pit' ? sp : (sb || sp);
    let name = row ? row.name : '', tm = row ? row.team : null, pos = sb && sb.pos && sb.pos !== 'X' ? sb.pos : '';
    if (!name) {
      try {
        const pd = await API.person(id, season);
        const p = pd && pd.people && pd.people[0];
        if (p) { name = p.fullName; pos = p.primaryPosition ? p.primaryPosition.abbreviation : ''; }
      } catch (e) { /* sin nombre: se dice con el número */ }
    }
    return { id, name: name || `Jugador ${id}`, tm, pos, main: role.main, x: row, sb, sp };
  }

  // Las temporadas en que jugó en la LVBP (su carrera, de la API de la persona: la misma consulta de la ficha), en un Set.
  async function careerSeasons(id, season) {
    const out = new Set();
    try {
      const pd = await API.person(id, season);
      const p = pd && pd.people && pd.people[0];
      for (const s of (p && p.stats) || []) {
        if (!s.type || s.type.displayName !== 'yearByYear') continue;
        for (const x of s.splits || []) if (x && x.league && x.league.id === API.LEAGUE && x.season) out.add(+x.season);
      }
    } catch (e) { /* sin su carrera: no hay temporada en común */ }
    return out;
  }

  // La tarjeta de cada lado: insignia y equipo, nombre (el apellido grande) y, debajo, su papel con una línea de números.
  function card(P, K, side, canChange) {
    const x = P.x, l = x && x.line;
    const role = P.main === 'pit' ? (K.starter(x) ? 'Abridor' : 'Relevista') : P.pos ? C.posEs(P.pos) : '';
    const first = P.name.slice(0, P.name.length - surname(P.name).length).trim();
    const nums = !x ? 'Sin juegos esta temporada'
      : P.main === 'bat' ? `${l.PA} PA · ${F.avg(x.r.AVG)}/${F.avg(x.r.OBP)}/${F.avg(x.r.SLG)}`
        : `${F.ip(l.OUTS)} IL · EFE ${F.era(x.r.ERA)}`;
    const tm = P.tm && PC.TEAMS[P.tm] ? `${U.chip(P.tm, 's inv')}<span>${esc(team(P.tm).short)}</span>` : '';
    return `<div class="cp-h">${tm ? `<p class="cp-eb">${tm}</p>` : ''}` +
      `<p class="cp-n"><a href="#/jugador/${P.id}">${first ? `${esc(first)} ` : ''}<b>${esc(surname(P.name))}</b></a></p>` +
      `<p class="cp-sub">${role ? `<span class="cp-rol">${esc(role)}</span> · ` : ''}${esc(nums).replace(/\//g, '/<wbr>')}</p>` +
      (canChange ? `<button type="button" class="cp-chg" data-chg="${side}">Cambiar<span class="sr"> a ${esc(P.name)}</span></button>` : '') + '</div>';
  }
  // El lado vacío, con el botón para elegir.
  const emptyCard = (txt, canPick, side) => `<div class="cp-h cp-vacio"><p class="cp-sub">${esc(txt)}</p>` +
    (canPick ? `<button type="button" class="btn ghost cp-pick" data-pick="${side}">Elegir jugador</button>` : '') + '</div>';

  // ¿Se ven iguales? (".340" y ".340" aunque por dentro difieran en el cuarto decimal: ahí nadie es mejor)
  const tie = (d, va, vb) => va === vb || (d.fmt && d.fmt(va) === d.fmt(vb));
  // "Mejor en": en qué número gana cada uno. Las tasas cuentan solo si los dos tienen muestra.
  function bestOf(A, B, kind) {
    const both = MIN[kind](A.x) && MIN[kind](B.x);
    const won = { a: [], b: [] };
    NUM[kind].forEach(d => {
      if (d.hi == null || (d.rate && !both)) return;
      const va = d.get(A.x), vb = d.get(B.x);
      if (va == null || vb == null || tie(d, va, vb)) return;
      const aWins = d.hi ? va > vb : va < vb;
      won[aWins ? 'a' : 'b'].push(d.name || d.label);
    });
    return { won, both };
  }

  PC.register('comparar', {
    tab: 'lideres',
    skeleton: 'comparar',
    every: () => (PC.state.liveToday ? 180000 : 0),
    async render(el, args, ctx) {
      const K = PC.ficha;
      if (!K) throw new Error('Falta la ficha del jugador (equipos.js)');
      const ids = args.map(Number).filter(n => n > 0).slice(0, 2);
      const want = PC.state.season;
      let season = want;
      let [st, games] = await Promise.all([PC.statsCtx(season, 'R'), PC.seasonGames(season)]);
      if (!ctx.alive()) return;
      let P = await Promise.all(ids.map(id => who(id, st, season)));
      if (!ctx.alive()) return;
      // Alguno sin juegos en la temporada elegida (la 2026-27 antes del 12/10): se compara la más reciente en que jugaron
      // todos (su carrera en la LVBP), y se dice arriba. Con un solo jugador, su última temporada.
      let aviso = '';
      const sinDatos = P.filter(x => !x.main);
      if (sinDatos.length) {
        const sets = await Promise.all(P.map(x => careerSeasons(x.id, want)));
        if (!ctx.alive()) return;
        const common = [...sets[0]].filter(y => y !== want && sets.every(s => s.has(y)));
        const alt = common.length ? Math.max(...common) : null;
        if (alt) {
          const [st2, games2] = await Promise.all([PC.statsCtx(alt, 'R'), PC.seasonGames(alt)]);
          if (!ctx.alive()) return;
          const P2 = await Promise.all(ids.map(id => who(id, st2, alt)));
          if (!ctx.alive()) return;
          if (P2.every(x => x.main)) {
            aviso = K.awayNote(alt, want, K.joinY(sinDatos.map(x => surname(x.name))), sinDatos.length > 1);
            season = alt; st = st2; games = games2; P = P2;
          }
        }
      }
      const [A, B] = P;
      const canPick = K.canPick();
      const same = A && B && A.id === B.id;
      const kind = A && A.main;
      const ok = A && B && !same && A.main && A.main === B.main;
      ctx.title = A && B ? `${surname(A.name)} vs. ${surname(B.name)}` : 'Comparar';

      let html = K.topBar(K.back('#/lideres'), ok ? K.shareBtn() : '') +
        `<div class="page-head"><p class="eyebrow">Temporada regular ${PC.seasonLabel(season)}</p><h1>Comparar</h1></div>` + aviso;

      // las dos tarjetas (o el lado que falta, con su botón)
      const left = A ? card(A, K, 0, canPick && !!A.main) : emptyCard('Elige el primer jugador.', canPick, 0);
      const right = B && !same ? card(B, K, 1, canPick && !!(A && A.main)) : emptyCard(A && A.main ? `¿Con quién comparar a ${surname(A.name)}?` : 'Falta el segundo jugador.', canPick && !!(A && A.main) && !same, 1);
      html += `<div class="cp-heads">${left}${right}</div>`;

      // lo que impide comparar, dicho claro, con su salida: elegir otro para el lado que no sirve
      let why = '', fix = null;
      if (same) { why = 'Es el mismo jugador a los dos lados: elige otro para comparar.'; fix = 1; }
      else if (A && !A.main) { why = `${A.name} no tiene juegos en la LVBP ${PC.seasonLabel(season)}. Cambia la temporada arriba o elige otro jugador.`; fix = 0; }
      else if (B && !B.main) { why = `${B.name} no tiene juegos en la LVBP ${PC.seasonLabel(season)}. Elige otro ${ROLE[A.main]}.`; fix = 1; }
      else if (A && B && A.main !== B.main) {
        why = `No se pueden comparar: ${A.name} es ${ROLE[A.main]} y ${B.name} es ${ROLE[B.main]}. Compara bateadores con bateadores y lanzadores con lanzadores.`;
        fix = 1;
      }
      const fixLabel = fix === 1 && A && A.main ? `Elegir otro ${ROLE[A.main]}` : 'Elegir otro jugador';
      if (why) html += `<div class="empty cp-why" role="status"><p class="empty-t">${esc(why)}</p>` +
        (canPick && fix != null ? `<button type="button" class="btn" data-pick="${fix}">${esc(fixLabel)}</button>` : '') + '</div>';
      if (!canPick && (!A || !B)) html += U.note('Para elegir con quién comparar, abre la ficha de un jugador y toca "Comparar con…".');

      if (ok) {
        // ----- mejor en -----
        const best = bestOf(A, B, kind);
        const line = (X, list, Y) => `<p><b>${esc(surname(X.name))}</b>, ${list.length ? `mejor en ${esc(K.joinY(list))}` : `en nada de esto le gana a ${esc(surname(Y.name))}`}.</p>`;
        html += `<section class="sec">${U.head('Mejor en', `Cuenta los números de la tabla de abajo, menos el volumen (${kind === 'bat' ? 'PA' : 'IL y G-P'}).` +
          (best.both ? '' : ' Uno de los dos jugó poco: los promedios no cuentan aquí, solo los totales.'))}` +
          `<div class="cp-best">${line(A, best.won.a, B)}${line(B, best.won.b, A)}</div></section>`;

        // ----- los números, lado a lado -----
        const rows = NUM[kind].map(d => {
          const va = d.get ? d.get(A.x) : null, vb = d.get ? d.get(B.x) : null;
          const sa = d.show ? d.show(A.x) : d.fmt(va), sb = d.show ? d.show(B.x) : d.fmt(vb);
          const cmp = d.hi != null && va != null && vb != null && !tie(d, va, vb) && (!d.rate || best.both);
          const aw = cmp && (d.hi ? va > vb : va < vb), bw = cmp && !aw;
          const td = (s, w) => `<td${w ? ' class="cp-w"' : ''}>${esc(s)}${w ? '<span class="sr"> (mejor)</span>' : ''}</td>`;
          return `<tr>${td(sa, aw)}<th scope="row"${d.title ? ` title="${esc(d.title)}"` : ''}>${esc(d.label)}</th>${td(sb, bw)}</tr>`;
        }).join('');
        html += `<section class="sec">${U.head(`${kind === 'bat' ? 'Bateo' : 'Pitcheo'} ${PC.seasonLabel(season)}`)}` +
          `<div class="cp-tw"><table class="cp-t"><caption class="sr">${esc(`${A.name} y ${B.name}, ${kind === 'bat' ? 'bateo' : 'pitcheo'}`)}</caption>` +
          `<thead><tr><th scope="col">${esc(surname(A.name))}</th><th scope="col"><span class="sr">Número</span></th><th scope="col">${esc(surname(B.name))}</th></tr></thead>` +
          `<tbody>${rows}</tbody></table></div></section>`;

        // ----- percentiles: dos barras por número, como en la ficha -----
        const q = K.quals(games);
        const PA = K.pctPool(st, q, kind, A.x), PB = K.pctPool(st, q, kind, B.x);
        if (PA.show || PB.show) {
          const ra = K.pctRows(A.x, PA.pool, PA.defs, PA.nOf, st.lg), rb = K.pctRows(B.x, PB.pool, PB.defs, PB.nOf, st.lg);
          const anim = !ctx.data.drawn;
          ctx.data.drawn = true;
          let i = 0;
          const bar = (X, r, show) => (show && r.p != null
            ? `<li ${K.pctAttrs(r.p, i++)}><span class="fpc-l cp-pw">${esc(surname(X.name))}</span>${K.pctTrack(r.p)}<span class="fpc-v">${esc(r.fmt(r.v))}</span></li>`
            : `<li class="cp-pn"><span class="fpc-l cp-pw">${esc(surname(X.name))}</span><span class="cp-pn-t">${show ? 'sin dato' : 'jugó poco'}</span><span class="fpc-v">${r.v != null ? esc(r.fmt(r.v)) : '—'}</span></li>`);
          const items = ra.map((r, k) => `<li class="cp-ph" aria-hidden="true">${esc(r.label)}</li>` +
            `<li class="cp-pg"><ul class="cp-pgl" aria-label="${esc(r.label)}">${bar(A, r, PA.show)}${bar(B, rb[k], PB.show)}</ul></li>`).join('');
          const vs = PA.who === PB.who ? `cada uno contra ${esc(PA.who)}` : `${esc(surname(A.name))} contra ${esc(PA.who)}; ${esc(surname(B.name))}, contra ${esc(PB.who)}`;
          html += `<section class="sec">${U.head('Percentiles en la liga', `Los mismos de la ficha de cada jugador: ${vs}, ajustando cada número por el tamaño de su muestra. 50 es el promedio; 90 significa que supera al 90%.`)}` +
            `<ul class="fpc cp-pct${anim ? ' anim' : ''}">${items}<li class="fpc-leg" aria-hidden="true"><span></span>${K.PCT_LEG}<span></span></li></ul></section>`;
        }
      }
      html += U.fresh(st.t || API.when(games));
      el.innerHTML = html;

      // ----- acciones -----
      if (ok) {
        K.onShare(el, () => ({
          title: `${A.name} vs. ${B.name}`,
          text: `${surname(A.name)} vs. ${surname(B.name)}: ${kind === 'bat' ? 'bateo' : 'pitcheo'} en la LVBP ${PC.seasonLabel(season)}`,
          url: `#/comparar/${A.id}/${B.id}?t=${season}` // la temporada que se compara (?t=, core.js)
        }));
      }
      // Elegir: el que falta (o el que no sirve) se cambia sin sumar pasos al historial.
      const grupo = A && A.main ? GRUPO[A.main] : null;
      const pick = async (side, titulo) => {
        let r = null;
        try {
          r = await PC.pickPlayer({ titulo, grupo: side === 0 ? (B && B.main ? GRUPO[B.main] : null) : grupo, temporada: season, excluir: ids });
        } catch (e) { console.warn('elegir jugador', e); }
        if (!r || !r.id || !ctx.alive()) return;
        const next = side === 0 ? [r.id].concat(B ? [B.id] : []) : [A.id, r.id];
        PC.go(`#/comparar/${next.join('/')}`, { replace: true });
      };
      if (canPick) {
        el.querySelectorAll('[data-chg]').forEach(b => b.addEventListener('click', () => {
          const side = +b.dataset.chg, X = side ? B : A;
          pick(side, `Cambiar a ${surname(X.name)} por…`);
        }));
        el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
          const side = +b.dataset.pick;
          pick(side, side && A ? `Comparar a ${surname(A.name)} con…` : B && B.main ? `Comparar a ${surname(B.name)} con…` : 'Comparar a…');
        }));
        // con un solo jugador (o ninguno) se pide el que falta apenas abre, una vez
        if (!B && !ctx.data.asked && (!A || A.main)) {
          ctx.data.asked = true;
          pick(A ? 1 : 0, A ? `Comparar a ${surname(A.name)} con…` : 'Comparar a…');
        }
      }
    },
    refresh(el, args, ctx) { return this.render(el, args, ctx); }
  });
})(window);
