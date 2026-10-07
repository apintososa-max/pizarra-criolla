/* Pizarra Criolla · lideres.js
   Líderes de bateo y pitcheo con métricas tradicionales y avanzadas (wOBA, wRC+, OPS+, FIP, K-BB%...),
   todas recalculadas en el teléfono con el contexto de la liga en ese momento. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const F = PC.F, D = PC.D, U = PC.U, esc = PC.esc, team = PC.team, C = PC.calc, API = PC.api;

  const L = p => p.line, R = p => p.r;
  const BAT = [
    { k: 'OPS', label: 'OPS', get: p => R(p).OPS, fmt: F.avg, rate: 1 },
    { k: 'AVG', label: 'AVE', get: p => R(p).AVG, fmt: F.avg, rate: 1 },
    { k: 'OBP', label: 'OBP', get: p => R(p).OBP, fmt: F.avg, rate: 1 },
    { k: 'SLG', label: 'SLG', get: p => R(p).SLG, fmt: F.avg, rate: 1 },
    { k: 'wRCplus', label: 'wRC+', get: p => R(p).wRCplus, fmt: F.int, rate: 1 },
    { k: 'wOBA', label: 'wOBA', get: p => R(p).wOBA, fmt: F.avg, rate: 1 },
    { k: 'OPSplus', label: 'OPS+', get: p => R(p).OPSplus, fmt: F.int, rate: 1 },
    { k: 'HR', label: 'HR', get: p => L(p).HR, fmt: F.int },
    { k: 'RBI', label: 'CI', get: p => L(p).RBI, fmt: F.int },
    { k: 'R', label: 'CA', get: p => L(p).R, fmt: F.int },
    { k: 'H', label: 'H', get: p => L(p).H, fmt: F.int },
    { k: 'D', label: '2B', get: p => L(p).D, fmt: F.int },
    { k: 'SB', label: 'BR', get: p => L(p).SB, fmt: F.int },
    { k: 'BB', label: 'BB', get: p => L(p).BB, fmt: F.int },
    { k: 'ISO', label: 'ISO', get: p => R(p).ISO, fmt: F.avg, rate: 1 },
    { k: 'BBPct', label: 'BB%', get: p => R(p).BBPct, fmt: F.pct, rate: 1 },
    { k: 'KPct', label: 'K%', get: p => R(p).KPct, fmt: F.pct, rate: 1, asc: 1 },
    { k: 'BABIP', label: 'BABIP', get: p => R(p).BABIP, fmt: F.avg, rate: 1 }
  ];
  const PIT = [
    { k: 'ERA', label: 'EFE', get: p => R(p).ERA, fmt: F.era, rate: 1, asc: 1 },
    { k: 'FIP', label: 'FIP', get: p => R(p).FIP, fmt: F.era, rate: 1, asc: 1 },
    { k: 'WHIP', label: 'WHIP', get: p => R(p).WHIP, fmt: F.era, rate: 1, asc: 1 },
    { k: 'SO', label: 'K', get: p => L(p).SO, fmt: F.int },
    { k: 'KPct', label: 'K%', get: p => R(p).KPct, fmt: F.pct, rate: 1 },
    { k: 'BBPct', label: 'BB%', get: p => R(p).BBPct, fmt: F.pct, rate: 1, asc: 1 },
    { k: 'KBBPct', label: 'K-BB%', get: p => R(p).KBBPct, fmt: F.pct, rate: 1 },
    { k: 'ERAplus', label: 'EFE+', get: p => R(p).ERAplus, fmt: F.int, rate: 1 },
    { k: 'K9', label: 'K/9', get: p => R(p).K9, fmt: F.dec1, rate: 1 },
    { k: 'BB9', label: 'BB/9', get: p => R(p).BB9, fmt: F.dec1, rate: 1, asc: 1 },
    { k: 'HR9', label: 'HR/9', get: p => R(p).HR9, fmt: F.era, rate: 1, asc: 1 },
    { k: 'W', label: 'G', get: p => L(p).W, fmt: F.int },
    { k: 'SV', label: 'JS', get: p => L(p).SV, fmt: F.int },
    { k: 'HLD', label: 'HLD', get: p => L(p).HLD, fmt: F.int },
    { k: 'IP', label: 'IL', get: p => L(p).OUTS, fmt: F.ip },
    { k: 'LOBPct', label: 'LOB%', get: p => R(p).LOBPct, fmt: F.pct, rate: 1 },
    { k: 'BABIP', label: 'BABIP', get: p => R(p).BABIP, fmt: F.avg, rate: 1, asc: 1 }
  ];
  PC.METRICS = { bat: BAT, pit: PIT };

  // Línea de apoyo bajo cada nombre (espacio duro entre número y unidad: "13 HR" no se parte)
  const NB = String.fromCharCode(160);
  const ctxBat = p => `${L(p).PA}${NB}PA · ${F.avg(R(p).AVG)}/${F.avg(R(p).OBP)}/${F.avg(R(p).SLG)} · ${L(p).HR}${NB}HR`;
  const ctxPit = p => `${F.ip(L(p).OUTS)}${NB}IL · EFE${NB}${F.era(R(p).ERA)} · ${L(p).SO}${NB}K · ${L(p).BB}${NB}BB`;

  function qualifier(group, tg) {
    const maxG = Math.max(0, ...Object.values(tg));
    const g = p => (p.team && tg[p.team]) || maxG;
    return group === 'bat'
      ? { ok: p => L(p).PA >= C.QUAL_PA * g(p), min: Math.ceil(C.QUAL_PA * maxG), unit: 'PA', loose: p => L(p).PA >= 15 }
      : { ok: p => L(p).OUTS / 3 >= C.QUAL_IP * g(p), min: Math.round(C.QUAL_IP * maxG), unit: 'IL', loose: p => L(p).OUTS >= 15 };
  }

  // ---------- la forma: los últimos 14 días ----------
  // Una sola consulta por grupo (API.statsRange) con las 2 semanas que terminan en la última fecha con juegos terminados
  // de la temporada regular. Debajo de cada número, el de esas 2 semanas:
  //  - en las tasas (AVE, OPS, EFE…), el valor con ▲▼, que dice para dónde se movió frente a su temporada: en verde y
  //    negrita si es para bien (en EFE o K% de bateador, bajar es bueno), en gris y letra normal si es para mal. El peso,
  //    no solo el color, dice cuál es cuál;
  //  - en los conteos (HR, CI…), "+N": lo que sumó, sin flecha;
  //  - sin juegos, "no jugó"; en una tasa con muy poco juego, "poco juego". Nunca una raya sola.
  // El lector oye lo mismo que se ve. La lista no espera por esto: si la consulta tarda, cada fila guarda su sitio y se
  // llena al llegar.
  const DAYS = 14;
  const FORM_MIN = { bat: 15, pit: 15 }; // PA o bateadores enfrentados para que la tasa diga algo
  const formMemo = new WeakMap(); // respuesta de la API → {id: {line, r}}
  function formWindow(games) {
    let last = '';
    for (const g of games) if (g.type === 'R' && g.status === 'final' && g.date > last) last = g.date;
    return last ? { from: D.add(last, 1 - DAYS), to: last } : null;
  }
  function recentById(d, group, lg) {
    if (!d) return null;
    let m = formMemo.get(d);
    if (m && m.lg === lg) return m.by;
    const lines = new Map();
    const splits = (d.stats && d.stats[0] && d.stats[0].splits) || [];
    for (const s of splits) {
      if (!s.player || (s.league && s.league.id !== API.LEAGUE)) continue;
      const line = group === 'bat' ? C.batLine(s.stat) : C.pitLine(s.stat);
      const prev = lines.get(s.player.id);
      lines.set(s.player.id, prev ? C.sum([prev, line]) : line); // un cambio de equipo en esas 2 semanas: se suman
    }
    const by = new Map();
    lines.forEach((line, id) => by.set(id, { line, r: group === 'bat' ? C.bat(line, lg) : C.pit(line, lg) }));
    formMemo.set(d, { lg, by });
    return by;
  }
  const ARROW = { up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5l4 6.5H1z"/></svg>', down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5L1 2h8z"/></svg>' };
  // El HTML de la forma de un jugador para la métrica m (o '' si todavía no llegó). cls: la clase (el color y el peso),
  // vis: lo que se ve (HTML), sr: lo mismo, dicho para el lector.
  function formHTML(p, rec, m, group) {
    if (!rec) return '';
    const out = (cls, vis, sr) => `<span class="${cls}"><span class="sr">Últimos 14 días: ${esc(sr)}</span><span aria-hidden="true">${vis}</span></span>`;
    const x = rec.get(p.id);
    if (!x) return out('ld-f0', 'no jugó', 'no jugó');
    if (!m.rate) {
      const t = m.fmt(m.get(x) || 0);
      return out('ld-fn', esc('+' + t), `sumó ${t}`);
    }
    const v = m.get(x), s = m.get(p);
    if (v == null || (group === 'bat' ? x.line.PA : x.line.BF) < FORM_MIN[group]) return out('ld-f0', 'poco juego', 'poco juego');
    const val = m.fmt(v);
    const rel = s == null ? 0 : (v - s) / (Math.abs(s) || 1e-9);
    if (Math.abs(rel) < 0.05) return out('ld-fv', esc(val), val); // casi igual que en su temporada: sin flecha
    const up = rel > 0, better = m.asc ? !up : up;
    return out(`ld-fv ${better ? 'mejor' : 'peor'}`, `<i class="ld-fa">${up ? ARROW.up : ARROW.down}</i>${esc(val)}`,
      `${val}, flecha ${up ? 'arriba' : 'abajo'}, para ${better ? 'bien' : 'mal'}`);
  }

  // "del 14 al 27 dic" (o "del 20 dic al 2 ene")
  const span = w => {
    const a = D.short(w.from), b = D.short(w.to), ma = a.split(' ').slice(1).join(' ');
    return ma && ma === b.split(' ').slice(1).join(' ') ? `del ${a.split(' ')[0]} al ${b}` : `del ${a} al ${b}`;
  };
  // ¿Lleva forma? Solo la temporada regular (el Round Robin y la final duran pocas semanas) y si el motor la trae.
  const formOn = phase => phase === 'R' && typeof API.statsRange === 'function';
  // La línea que explica el número chico (lista); en la tabla lo dice el título de la columna "14 días". Las flechas,
  // para el lector, dichas en palabras; "en verde y negrita" se ve como lo que describe.
  const LEY_ARROWS = `<span aria-hidden="true"><i class="ld-fa">${ARROW.up}</i><i class="ld-fa">${ARROW.down}</i></span><span class="sr">flecha arriba o abajo</span>`;
  const formLegend = when => `Debajo de cada número, sus últimos 14 días (<span class="ld-nw">${esc(when)}</span>): en los promedios, ${LEY_ARROWS} ` +
    'frente a su temporada, <b class="ld-bien">en verde y negrita</b> si es para bien; en los totales, lo que sumó.';
  const formTitle = when => `Los últimos 14 días (${when}): en los promedios, ▲▼ frente a su temporada, en verde y negrita si es para bien; en los totales, lo que sumó.`;

  // Íconos de Lista y Tabla
  const I_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.1"/><circle cx="4.6" cy="12" r="1.1"/><circle cx="4.6" cy="17.5" r="1.1"/></svg>';
  const I_GRID = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15M14.5 4.5v15"/></svg>';

  // ---------- esqueleto de carga (core.js lo pinta mientras llegan los datos) ----------
  // La maqueta de la pantalla con sus mismas clases y un texto de muestra que no se ve (.ld-gh, css/tablas.css): título
  // con Lista/Tabla, Bateo/Pitcheo con el interruptor, fases y métricas, y el 1.º en su bloque azul con 8 filas (o la
  // tabla). Mide lo mismo que lo que viene, así la lista no salta al llegar los datos.
  const gh = t => `<span class="ld-gh">${esc(t)}</span>`;
  const sk = (w, h, r) => `<span class="sk" style="width:${w};height:${h}${r ? ';border-radius:' + r : ''}"></span>`;
  const skChips = ws => `<div class="sk-row">${ws.map(w => sk(w, '36px', '999px')).join('')}</div>`;
  const times = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  const SK_NAMES = ['Nombre Apellido', 'Nombre Apellidos', 'Nom Apellido', 'Nombre Ape'];
  const phaseRow = {}; // temporada → si su última pintura llevó la fila de fases
  U.skeletons.lideres = () => {
    // la ruta dice qué viene: Bateo o Pitcheo, si la métrica lleva el interruptor y si hay fila de fases
    const a = /^#\/lideres\/?([^/]*)\/?([^/]*)\/?([^/]*)/.exec(location.hash) || [];
    const bat = a[1] !== 'pitcheo', list = bat ? BAT : PIT;
    const m = list.find(x => x.k === a[2]) || list[0];
    const season = PC.state.season;
    // una temporada pasada ya tuvo Round Robin y final; la en curso, lo que se vio la última vez
    const phases = a[3] === 'L' || a[3] === 'W' || (season in phaseRow ? phaseRow[season] : API.isPast(season));
    const line = bat ? `000${NB}PA · .000/.000/.000 · 00${NB}HR` : `00.0${NB}IL · EFE${NB}0.00 · 00${NB}K · 00${NB}BB`;
    const head = `<div class="page-head"><div class="ld-head">` +
      `<span class="sk" style="font-size:var(--fs-h1);width:6.4em;height:1em"></span>${sk('90px', '38px', '10px')}</div>` +
      `<div class="ld-bar"><div class="utabs"><a>${gh('Bateo')}</a><a>${gh('Pitcheo')}</a></div>` +
      (m.rate ? `<span class="tog ld-qual">${sk('42px', '26px', '999px')}<span>${gh('Solo calificados')}<small>${gh(`000 ${bat ? 'PA' : 'IL'} o más`)}</small></span></span>` : '') +
      `</div>${phases ? skChips(['8.5rem', '6.5rem', '4rem']) : ''}${skChips(['3.5rem', '3.5rem', '3.5rem', '3.5rem', '3.75rem', '4.25rem', '3.5rem'])}</div>`;
    if (PC.state.prefs.leadView === 'tabla') {
      return head + `<section class="sec tb"><div class="tbl-wrap"><table class="tbl leaders-t">` +
        `<thead><tr><th class="name">${gh('Jugador')}</th>${times(7, () => `<th>${gh('OPS')}</th>`)}</tr></thead><tbody>` +
        times(10, i => `<tr class="tap"><th class="name"><span class="lt-p"><span class="lt-rk">${gh(String(i + 1))}</span>` +
          `<span class="lt-who">${gh(SK_NAMES[i % 4])}<span class="tchip s">LVB</span></span></span></th>` +
          `${times(7, () => `<td>${gh('.000')}</td>`)}</tr>`) + '</tbody></table></div></section>';
    }
    // con la forma de 14 días: su línea arriba de la lista y un número chico debajo de cada valor
    const form = formOn(a[3] === 'L' || a[3] === 'W' ? a[3] : 'R');
    const val = () => (form ? `<span class="ld-vf"><span class="ld-v">${gh('.000')}</span><span class="ld-f">${gh('.000')}</span></span>` : `<span class="ld-v">${gh('.000')}</span>`);
    const ley = `<p class="ld-ley">${gh('Debajo de cada número, sus últimos 14 días (')}<span class="ld-nw">${gh('del 00 al 00 dic')}</span>` +
      `${gh('): en los promedios, ▲▼ frente a su temporada, ')}<b class="ld-bien">${gh('en verde y negrita')}</b>${gh(' si es para bien; en los totales, lo que sumó.')}</p>`;
    return head + (form ? ley : '') +
      `<ol class="leaders ld-list"><li class="ld-top"><span class="ld-rank"></span>` +
      `<span class="ld-who"><b>${gh(SK_NAMES[0])}</b></span>${val()}` +
      `<small class="ld-ctx"><span class="tchip s">LVB</span> ${gh(line)}</small></li>` +
      times(8, i => `<li><span class="ld-rank">${gh(String(i + 2))}</span><span class="ld-who"><b>${gh(SK_NAMES[(i + 1) % 4])}</b> ` +
        `<span class="tchip s">LVB</span><small>${gh(line)}</small></span>${val()}</li>`) + '</ol>';
  };

  PC.register('lideres', {
    tab: 'lideres',
    skeleton: 'lideres',
    every: () => (PC.state.liveToday ? 240000 : 0),
    async render(el, args, ctx) {
      const group = args[0] === 'pitcheo' ? 'pit' : 'bat';
      const list = group === 'bat' ? BAT : PIT;
      const m = list.find(x => x.k === args[1]) || list[0];
      const prefs = PC.state.prefs;
      const phase = ['R', 'L', 'W'].indexOf(args[2]) >= 0 ? args[2] : 'R';
      const season = PC.state.season;
      // la forma (14 días) se pide apenas se sabe la fecha de corte; la lista no la espera
      const gamesP = PC.seasonGames(season);
      let form = null, formDone = false;
      // → {d, w}, null (sin fechas) o 'error'. Un corte de red no es un error de la app: no va a la consola.
      const loadForm = gs => {
        const w = formWindow(gs);
        return !w ? Promise.resolve(null) : API.statsRange({ group: group === 'bat' ? 'hitting' : 'pitching', from: w.from, to: w.to, season })
          .then(d => ({ d, w }), e => { if (!(e && (e.name === 'AbortError' || /^HTTP|fetch|network|Load failed/i.test(String(e.message))))) console.warn('forma de 14 días', e); return 'error'; });
      };
      const formP = !formOn(phase) ? Promise.resolve(null) : gamesP.then(loadForm, () => 'error');
      formP.then(v => { form = v; formDone = true; });
      const [st, games] = await Promise.all([PC.statsCtx(season, phase), gamesP]);
      if (!ctx.alive()) return;
      // si la forma ya estaba guardada llega en este mismo instante: se espera solo eso, no la red
      if (!formDone) await new Promise(r => setTimeout(r, 0));
      if (!ctx.alive()) return;
      const tg = PC.teamGames(games, phase);
      const q = qualifier(group, tg);
      const onlyQual = m.rate && prefs.qual !== false;
      const view = prefs.leadView === 'tabla' ? 'tabla' : 'lista';
      const pool = (group === 'bat' ? st.bats : st.pits).filter(p => (m.rate ? (onlyQual ? q.ok(p) : q.loose(p)) : true));
      const sorted = pool.filter(p => m.get(p) != null).sort((a, b) => (m.asc ? m.get(a) - m.get(b) : m.get(b) - m.get(a)) || (L(b).PA || L(b).OUTS) - (L(a).PA || L(a).OUTS));
      const gpath = group === 'bat' ? 'bateo' : 'pitcheo';
      const phases = ['R', 'L', 'W'].filter(p => p === 'R' || games.some(g => g.type === p && g.status === 'final'));
      phaseRow[season] = phases.length > 1; // para el esqueleto de la próxima vez
      // Puesto de cada uno: los empatados comparten el número
      const rk = [];
      sorted.forEach((p, i) => { rk[i] = i && m.get(p) === m.get(sorted[i - 1]) ? rk[i - 1] : i + 1; });
      // cada fase con el nombre de su formato (antes de 2021-22 la segunda ronda era una semifinal)
      const phaseName = p => PC.phaseLabel(season, p, ((games.find(g => g.type === p) || {}).series) || '');
      // Bateo y Pitcheo conservan la fase elegida
      const tabHref = (gp, ms) => `#/lideres/${gp}${phase !== 'R' ? `/${ms[0].k}/${phase}` : ''}`;

      // Controles en tres filas como mucho: título con Lista/Tabla; Bateo/Pitcheo con el interruptor; fase (si hay
      // más de una) y métricas. Lista/Tabla y calificados son preferencias: repintan sin sumar pasos al historial.
      let html = `<div class="page-head">
        <div class="ld-head"><h1>Líderes ${PC.seasonLabel(season)}</h1>
          <div class="ld-vista" role="group" aria-label="Ver como">
            <button type="button" data-v="lista" aria-pressed="${view === 'lista'}" aria-label="Lista" title="Lista">${I_LIST}</button>
            <button type="button" data-v="tabla" aria-pressed="${view === 'tabla'}" aria-label="Tabla" title="Tabla">${I_GRID}</button>
          </div></div>
        <div class="ld-bar">${U.utabs([{ k: 'bat', label: 'Bateo', href: tabHref('bateo', BAT) }, { k: 'pit', label: 'Pitcheo', href: tabHref('pitcheo', PIT) }], group, 'Tipo de líderes')}
          ${m.rate ? `<label class="tog ld-qual"><input type="checkbox" role="switch" id="opt-qual" ${onlyQual ? 'checked' : ''}><span>Solo calificados<small>${q.min} ${q.unit} o más</small></span></label>` : ''}</div>
        ${phases.length > 1 ? U.chips(phases.map(p => ({ k: p, label: phaseName(p), href: `#/lideres/${gpath}/${m.k}/${p}` })), phase, 'Fase') : ''}
        ${U.chips(list.map(x => ({ k: x.k, label: x.label, href: `#/lideres/${gpath}/${x.k}${phase !== 'R' ? '/' + phase : ''}` })), m.k, 'Métrica')}
      </div>`;

      // la forma de 14 días: si ya llegó va en esta pintada; si no, cada fila guarda su sitio (data-f) y se llena después
      const win = formOn(phase) ? formWindow(games) : null;
      const rec = form && form !== 'error' && win ? recentById(form.d, group, st.lg) : null;
      const fcell = p => (win ? `<span class="ld-f" data-f="${p.id}">${rec ? formHTML(p, rec, m, group) : ''}</span>` : '');
      const shownP = new Map();

      if (!sorted.length) {
        html += U.empty('Sin datos todavía', 'Esta lista se llena sola con los primeros juegos.');
      } else if (view === 'lista') {
        // El 1.º va en estilo pizarra; el resto, filas enteras tocables que llevan al jugador.
        if (win) html += `<p class="ld-ley">${formLegend(span(win))}</p>`;
        html += `<ol class="leaders ld-list">${sorted.slice(0, 40).map((p, i) => {
          shownP.set(p.id, p);
          const v = m.get(p), rank = rk[i];
          const who = p.id ? `<a class="plink stretch" href="#/jugador/${p.id}">${esc(p.name)}</a>` : `<b>${esc(p.name)}</b>`;
          const tm = p.team ? U.chip(p.team, i ? 's' : 's inv') : `<small>${p.nTeams} equipos</small>`;
          const line = esc(group === 'bat' ? ctxBat(p) : ctxPit(p));
          const val0 = `<span class="ld-v"><span class="sr">${esc(m.label)}: </span>${esc(m.fmt(v))}</span>`;
          const val = win ? `<span class="ld-vf">${val0}${fcell(p)}</span>` : val0;
          return i === 0
            ? `<li class="ld-top${p.id ? ' rowlink' : ''}"><span class="ld-rank">${rank}</span><span class="ld-who">${who}</span>${val}<small class="ld-ctx">${tm} ${line}</small></li>`
            : `<li${p.id ? ' class="rowlink"' : ''}><span class="ld-rank">${rank}</span><span class="ld-who">${who} ${tm}<small>${line}</small></span>${val}</li>`;
        }).join('')}</ol>`;
      } else {
        // Columna fija: puesto, nombre y la insignia debajo (más angosta). Justo después, la métrica elegida, que es
        // la que ordena la tabla: siempre a la vista sin deslizar. Luego el volumen (PA o IL) y el resto en su orden.
        const vol = group === 'bat' ? { k: 'PA', label: 'PA', get: p => L(p).PA } : list.find(x => x.k === 'IP');
        const col = x => ({ k: x.k, label: x.label, get: x.get, fmt: x.fmt });
        const cols = [
          { k: 'n', label: 'Jugador', first: true, cls: 'name', html: (p, i) => `<span class="lt-p"><span class="lt-rk"><span class="sr">Puesto </span>${rk[i]}</span>` +
            `<span class="lt-who">${U.player(p.id, p.name)}${p.team ? U.chip(p.team, 's') : p.nTeams ? `<small>${p.nTeams} equipos</small>` : ''}</span></span>` },
          Object.assign(col(m), { cls: 'hl' })
        ].concat(win ? [{ k: 'f14', label: '14 días', cls: 'ld-fc', html: p => { shownP.set(p.id, p); return fcell(p); },
          title: formTitle(span(win)) }] : [])
          .concat([vol].concat(list.filter(x => x !== vol)).filter(x => x !== m).map(col));
        // las filas .tap (toda la fila lleva al jugador) las atiende el oyente de core.js
        const label = `Líderes de ${group === 'bat' ? 'bateo' : 'pitcheo'} por ${m.label}${phase !== 'R' ? ', ' + phaseName(phase) : ''}`;
        html += `<section class="sec tb">${U.table(cols, sorted, { cls: 'leaders-t', label, sortable: false, rowClass: () => 'tap' })}</section>`;
      }
      const lg = st.lg;
      const teamG = Object.keys(tg).reduce((a, k) => a + tg[k], 0);
      html += U.note(group === 'bat'
        ? `Promedio de la liga: AVE ${F.avg(lg.AVG)} · OBP ${F.avg(lg.OBP)} · SLG ${F.avg(lg.SLG)}${teamG ? ` · ${F.dec1(lg.bat.R / teamG)} carreras por equipo por juego` : ''}.`
        : `Promedio de la liga: EFE ${F.era(lg.ERA)} · WHIP ${F.era(lg.WHIP)} · K% ${F.pct(lg.pKPct)} · BB% ${F.pct(lg.pBBPct)}. Constante del FIP: ${F.era(lg.cFIP)}.`);
      html += U.fresh(Math.min(API.when(games), st.t || Date.now()));
      el.innerHTML = html;
      // La forma llegó después de pintar: se llena en su sitio (ya reservado), sin mover nada. La primera consulta de un
      // rango nuevo puede tardar en el servidor más de lo que espera api.js (medido: de 5 a 43 s): si se corta, se
      // intenta una vez más; si tampoco, la línea de arriba lo dice.
      if (win && !rec) {
        const fill = v => {
          const r2 = v && v !== 'error' ? recentById(v.d, group, st.lg) : null;
          if (!r2) return false;
          el.querySelectorAll('[data-f]').forEach(n => { const p = shownP.get(+n.dataset.f); if (p) n.innerHTML = formHTML(p, r2, m, group); });
          return true;
        };
        const fail = () => {
          const ley = el.querySelector('.ld-ley');
          if (ley) ley.textContent = 'No se pudo cargar cómo les fue en los últimos 14 días.';
        };
        formP.then(v => {
          if (!ctx.alive() || v === null || fill(v)) return;
          setTimeout(() => { if (ctx.alive()) loadForm(games).then(v2 => { if (ctx.alive() && !fill(v2)) fail(); }); }, 2000);
        });
      }
      // la métrica elegida queda a la vista aunque esté al final de su fila: lo hace core.js al terminar de pintar

      // Preferencias: se repinta en el sitio (sin historial ni salto) y el foco vuelve al control que se tocó.
      const again = sel => PC.refresh(ctx).then(() => {
        const n = ctx.alive() && el.querySelector(sel);
        if (n && document.activeElement !== n) { try { n.focus({ preventScroll: true }); } catch (e) { /* navegador viejo */ } }
      });
      const qb = el.querySelector('#opt-qual');
      if (qb) qb.addEventListener('change', () => { prefs.qual = qb.checked; PC.savePrefs(); again('#opt-qual'); });
      el.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        el.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); // se marca al instante
        prefs.leadView = b.dataset.v; PC.savePrefs(); again(`[data-v="${b.dataset.v}"]`);
      }));
    },
    refresh(el, args, ctx) { return this.render(el, args, ctx); }
  });
})(window);
