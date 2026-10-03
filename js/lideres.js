/* Pizarra Criolla · lideres.js
   Líderes de bateo y pitcheo con métricas tradicionales y avanzadas (wOBA, wRC+, OPS+, FIP, K-BB%...),
   todas recalculadas en el teléfono con el contexto de la liga en ese momento. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const F = PC.F, U = PC.U, esc = PC.esc, team = PC.team, C = PC.calc;

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

  // Línea de apoyo bajo cada nombre
  const ctxBat = p => `${L(p).PA} PA · ${F.avg(R(p).AVG)}/${F.avg(R(p).OBP)}/${F.avg(R(p).SLG)} · ${L(p).HR} HR`;
  const ctxPit = p => `${F.ip(L(p).OUTS)} IL · EFE ${F.era(R(p).ERA)} · ${L(p).SO} K · ${L(p).BB} BB`;

  function qualifier(group, tg) {
    const maxG = Math.max(0, ...Object.values(tg));
    const g = p => (p.team && tg[p.team]) || maxG;
    return group === 'bat'
      ? { ok: p => L(p).PA >= C.QUAL_PA * g(p), min: Math.ceil(C.QUAL_PA * maxG), unit: 'PA', loose: p => L(p).PA >= 15 }
      : { ok: p => L(p).OUTS / 3 >= C.QUAL_IP * g(p), min: Math.round(C.QUAL_IP * maxG), unit: 'IL', loose: p => L(p).OUTS >= 15 };
  }

  PC.register('lideres', {
    tab: 'lideres',
    every: () => (PC.state.liveToday ? 240000 : 0),
    async render(el, args, ctx) {
      const group = args[0] === 'pitcheo' ? 'pit' : 'bat';
      const list = group === 'bat' ? BAT : PIT;
      const m = list.find(x => x.k === args[1]) || list[0];
      const prefs = PC.state.prefs;
      const phase = ['R', 'L', 'W'].indexOf(args[2]) >= 0 ? args[2] : 'R';
      const season = PC.state.season;
      const [st, games] = await Promise.all([PC.statsCtx(season, phase), PC.seasonGames(season)]);
      if (!ctx.alive()) return;
      const tg = PC.teamGames(games, phase);
      const q = qualifier(group, tg);
      const onlyQual = m.rate && prefs.qual !== false;
      const view = prefs.leadView === 'tabla' ? 'tabla' : 'lista';
      const pool = (group === 'bat' ? st.bats : st.pits).filter(p => (m.rate ? (onlyQual ? q.ok(p) : q.loose(p)) : true));
      const sorted = pool.filter(p => m.get(p) != null).sort((a, b) => (m.asc ? m.get(a) - m.get(b) : m.get(b) - m.get(a)) || (L(b).PA || L(b).OUTS) - (L(a).PA || L(a).OUTS));
      const gpath = group === 'bat' ? 'bateo' : 'pitcheo';
      const phases = ['R', 'L', 'W'].filter(p => p === 'R' || games.some(g => g.type === p && g.status === 'final'));

      let html = `<div class="page-head"><h1>Líderes ${PC.seasonLabel(season)}</h1>
        <div class="seg" role="group" aria-label="Tipo de líderes">
          <a href="#/lideres/bateo" class="${group === 'bat' ? 'on' : ''}">Bateo</a>
          <a href="#/lideres/pitcheo" class="${group === 'pit' ? 'on' : ''}">Pitcheo</a>
        </div>
        ${phases.length > 1 ? U.chips(phases.map(p => ({ k: p, label: PC.PHASES[p], href: `#/lideres/${gpath}/${m.k}/${p}` })), phase, 'Fase') : ''}
        ${U.chips(list.map(x => ({ k: x.k, label: x.label, href: `#/lideres/${gpath}/${x.k}${phase !== 'R' ? '/' + phase : ''}` })), m.k, 'Métrica')}
        <div class="opts">
          ${m.rate ? `<label class="tog"><input type="checkbox" id="opt-qual" ${onlyQual ? 'checked' : ''}> Solo calificados <small>(${q.min} ${q.unit} o más)</small></label>` : '<span></span>'}
          <div class="seg mini" role="group" aria-label="Vista">
            <button type="button" data-v="lista" class="${view === 'lista' ? 'on' : ''}">Lista</button>
            <button type="button" data-v="tabla" class="${view === 'tabla' ? 'on' : ''}">Tabla</button>
          </div>
        </div></div>`;

      if (!sorted.length) {
        html += U.empty('Sin datos todavía', 'Esta lista se llena sola con los primeros juegos.');
      } else if (view === 'lista') {
        let rank = 0, prev = null;
        html += `<ol class="leaders">${sorted.slice(0, 40).map((p, i) => {
          const v = m.get(p);
          if (v !== prev) rank = i + 1;
          prev = v;
          return `<li><span class="ld-rank">${rank}</span>
            <span class="ld-who">${U.player(p.id, p.name)} ${p.team ? U.chip(p.team) : `<small>${p.nTeams} equipos</small>`}<small>${esc(group === 'bat' ? ctxBat(p) : ctxPit(p))}</small></span>
            <span class="ld-v">${esc(m.fmt(v))}</span></li>`;
        }).join('')}</ol>`;
      } else {
        const cols = [
          { k: 'n', label: 'Jugador', first: true, cls: 'name', html: p => `${U.player(p.id, p.name)} ${p.team ? U.chip(p.team) : ''}` },
          group === 'bat' ? { k: 'PA', label: 'PA', get: p => L(p).PA } : { k: 'IPx', label: 'IL', get: p => F.ip(L(p).OUTS) }
        ].concat(list.filter(x => x.k !== 'IP').map(x => ({ k: x.k, label: x.label, get: x.get, fmt: x.fmt, cls: x.k === m.k ? 'hl' : '' })));
        html += U.table(cols, sorted, { cls: 'leaders-t', sortable: false });
      }
      const lg = st.lg;
      const teamG = Object.keys(tg).reduce((a, k) => a + tg[k], 0);
      html += U.note(group === 'bat'
        ? `Liga: AVE ${F.avg(lg.AVG)} · OBP ${F.avg(lg.OBP)} · SLG ${F.avg(lg.SLG)}${teamG ? ` · ${F.dec1(lg.bat.R / teamG)} carreras por equipo por juego` : ''}. wRC+ y OPS+: 100 es el promedio de la liga.`
        : `Liga: EFE ${F.era(lg.ERA)} · WHIP ${F.era(lg.WHIP)} · K% ${F.pct(lg.pKPct)} · BB% ${F.pct(lg.pBBPct)}. FIP usa la constante de la LVBP de esta temporada (${F.era(lg.cFIP)}).`);
      html += U.fresh(Math.min(API.when(games), st.t || Date.now()));
      el.innerHTML = html;

      const qb = el.querySelector('#opt-qual');
      if (qb) qb.addEventListener('change', () => { prefs.qual = qb.checked; PC.savePrefs(); this.render(el, args, ctx); });
      el.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
        prefs.leadView = b.dataset.v; PC.savePrefs(); this.render(el, args, ctx);
      }));
    },
    refresh(el, args, ctx) { return this.render(el, args, ctx); }
  });
})(window);
