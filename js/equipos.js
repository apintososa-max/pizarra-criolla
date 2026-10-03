/* Pizarra Criolla · equipos.js
   Los 8 equipos, la ficha de cada equipo (números con su puesto en la liga, diferencial de carreras,
   récords parciales, roster con métricas) y la ficha de cada jugador (percentiles, juego a juego, carrera en la LVBP). */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, CH = PC.charts, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc, team = PC.team;

  const ordinal = n => `${n}.º`;
  const splitsOf = d => (d && d.stats && d.stats[0] && d.stats[0].splits) || [];

  // ---------- índice de equipos ----------
  PC.register('equipos', {
    tab: 'equipos',
    async render(el, args, ctx) {
      const season = PC.state.season;
      const games = await PC.seasonGames(season);
      if (!ctx.alive()) return;
      const reg = games.filter(g => g.type === 'R');
      const rows = C.standings(reg, PC.TEAM_IDS);
      el.innerHTML = `<div class="page-head"><h1>Equipos ${PC.seasonLabel(season)}</h1></div>
        <ul class="teams">${rows.map(r => `<li><a href="#/equipo/${r.id}">
          <span class="tm-abbr">${esc(team(r.id).abbr)}</span>
          <span class="tm-name">${esc(team(r.id).name)}<small>${esc(team(r.id).city)}</small></span>
          <span class="tm-rec">${r.W}-${r.L}<small>${r.G ? `${ordinal(r.pos)} · ${esc(r.streak)} · ${F.signed(r.DIFF)}` : 'sin juegos'}</small></span>
        </a></li>`).join('')}</ul>${U.fresh(API.when(games))}`;
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

  function tiles(items) {
    return `<div class="tiles">${items.map(t => `<div class="tile${t.rank === 1 ? ' best' : t.rank === t.of ? ' worst' : ''}">
      <p class="tile-l">${esc(t.label)}</p><p class="tile-v">${esc(t.value)}</p>
      ${t.rank ? `<p class="tile-r">${ordinal(t.rank)} de ${t.of}</p>` : ''}</div>`).join('')}</div>`;
  }

  PC.register('equipo', {
    tab: 'equipos',
    every: () => (PC.state.liveToday ? 120000 : 0),
    async render(el, args, ctx) {
      const id = +args[0];
      if (!PC.TEAMS[id]) { location.hash = '#/equipos'; return; }
      const season = PC.state.season;
      const [games, st, th, tp, rh, rp] = await Promise.all([
        PC.seasonGames(season), PC.statsCtx(season, 'R'),
        API.teamStats(season, 'hitting', 'R'), API.teamStats(season, 'pitching', 'R'),
        API.stats(season, 'hitting', 'R', id), API.stats(season, 'pitching', 'R', id)
      ]);
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

      let html = `<nav class="crumbs"><a href="#/equipos">‹ Equipos</a></nav>
        <header class="team-head"><p class="eyebrow">${esc(t.city)} · temporada ${PC.seasonLabel(season)}</p><h1>${esc(t.name)}</h1>
        ${me && me.G ? `<p class="team-rec"><b>${me.W}-${me.L}</b> ${ordinal(me.pos)} lugar${me.GB ? ` · a ${F.gb(me.GB)} del líder` : ''} · racha ${esc(me.streak)} · últimos 10: ${me.l10W}-${me.l10L}</p>
        <p class="team-sub">Récord pitagórico ${Math.round(me.xW)}-${Math.round(me.G - me.xW)} (${F.signed(me.luck, 1)} juegos de suerte) · diferencia ${F.signed(me.DIFF)}</p>` : '<p class="team-sub">Todavía sin juegos en esta temporada.</p>'}
        </header>`;

      if (tb && tpi && me && me.G) {
        html += `<section class="sec">${U.head('Ofensiva', 'Con su puesto entre los 8 equipos.')}${tiles([
          { label: 'Carreras por juego', value: F.dec1(me.RSG), rank: rankOf(sr, id, x => x.RSG), of },
          { label: 'AVE / OBP / SLG', value: `${F.avg(tb.r.AVG)}/${F.avg(tb.r.OBP)}/${F.avg(tb.r.SLG)}`, rank: rankOf(T, id, x => x.r.OPS), of },
          { label: 'wRC+', value: F.int(tb.r.wRCplus), rank: rankOf(T, id, x => x.r.wRCplus), of },
          { label: 'Jonrones', value: F.int(tb.line.HR), rank: rankOf(T, id, x => x.line.HR), of },
          { label: 'Bases robadas', value: F.int(tb.line.SB), rank: rankOf(T, id, x => x.line.SB), of },
          { label: 'BB% / K%', value: `${F.pct(tb.r.BBPct)} / ${F.pct(tb.r.KPct)}`, rank: rankOf(T, id, x => x.r.BBPct - x.r.KPct), of }
        ])}</section>
        <section class="sec">${U.head('Pitcheo')}${tiles([
          { label: 'Carreras permitidas por juego', value: F.dec1(me.RAG), rank: rankOf(sr, id, x => x.RAG, true), of },
          { label: 'EFE', value: F.era(tpi.r.ERA), rank: rankOf(P, id, x => x.r.ERA, true), of },
          { label: 'FIP', value: F.era(tpi.r.FIP), rank: rankOf(P, id, x => x.r.FIP, true), of },
          { label: 'WHIP', value: F.era(tpi.r.WHIP), rank: rankOf(P, id, x => x.r.WHIP, true), of },
          { label: 'K-BB%', value: F.pct(tpi.r.KBBPct), rank: rankOf(P, id, x => x.r.KBBPct), of },
          { label: 'Jonrones permitidos por 9', value: F.era(tpi.r.HR9), rank: rankOf(P, id, x => x.r.HR9, true), of }
        ])}</section>`;
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
        const res = g.status === 'final' ? `<b class="${us.win ? 'w' : 'l'}">${us.win ? 'G' : 'P'} ${us.score}-${them.score}</b>` : g.status === 'live' ? '<b>en vivo</b>' : esc(D.time(g.ts));
        return `<li><a href="#/juego/${g.pk}"><span>${esc(D.short(g.date))}</span><span>${home ? 'vs.' : 'en'} ${esc(team(opp).short)}</span>${res}</a></li>`;
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
      if (bats.length) {
        html += `<section class="sec">${U.head('Bateadores', 'Ordenados por apariciones al plato (PA).')}${U.table([
          { k: 'n', label: 'Jugador', first: true, cls: 'name', html: p => `${U.player(p.id, p.name)} <small>${esc(p.pos)}</small>` },
          { k: 'PA', label: 'PA', get: p => p.line.PA }, { k: 'AVG', label: 'AVE', get: p => p.r.AVG, fmt: F.avg },
          { k: 'OBP', label: 'OBP', get: p => p.r.OBP, fmt: F.avg }, { k: 'SLG', label: 'SLG', get: p => p.r.SLG, fmt: F.avg },
          { k: 'OPS', label: 'OPS', get: p => p.r.OPS, fmt: F.avg }, { k: 'wRC', label: 'wRC+', get: p => p.r.wRCplus, fmt: F.int },
          { k: 'HR', label: 'HR', get: p => p.line.HR }, { k: 'RBI', label: 'CI', get: p => p.line.RBI }, { k: 'SB', label: 'BR', get: p => p.line.SB },
          { k: 'BB', label: 'BB%', get: p => p.r.BBPct, fmt: F.pct }, { k: 'K', label: 'K%', get: p => p.r.KPct, fmt: F.pct }
        ], bats)}</section>`;
      }
      if (pits.length) {
        html += `<section class="sec">${U.head('Lanzadores', 'Ordenados por innings lanzados (IL).')}${U.table([
          { k: 'n', label: 'Lanzador', first: true, cls: 'name', html: p => U.player(p.id, p.name) },
          { k: 'G', label: 'J', title: 'Juegos', get: p => p.line.G }, { k: 'GS', label: 'JI', title: 'Juegos iniciados', get: p => p.line.GS },
          { k: 'WL', label: 'G-P', get: p => `${p.line.W}-${p.line.L}` }, { k: 'SV', label: 'JS', get: p => p.line.SV },
          { k: 'IP', label: 'IL', get: p => F.ip(p.line.OUTS) }, { k: 'ERA', label: 'EFE', get: p => p.r.ERA, fmt: F.era },
          { k: 'FIP', label: 'FIP', get: p => p.r.FIP, fmt: F.era }, { k: 'WHIP', label: 'WHIP', get: p => p.r.WHIP, fmt: F.era },
          { k: 'K', label: 'K%', get: p => p.r.KPct, fmt: F.pct }, { k: 'BB', label: 'BB%', get: p => p.r.BBPct, fmt: F.pct }
        ], pits)}</section>`;
      }
      html += U.fresh(Math.min(API.when(games, th, tp, rh, rp), st.t || Date.now()));
      el.innerHTML = html;

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

  function pctBars(me, pool, defs, nOf, lg) {
    const rows = defs.map(([label, get, hi, fmt, k, lgOf]) => {
      const v = get(me);
      const lgv = lgOf ? lgOf(lg) : null;
      const adj = x => (k && lgv != null ? C.shrink(get(x), nOf(x), lgv, k) : get(x));
      const p = C.pctRank(adj(me), pool.map(adj).filter(x => x != null), hi);
      if (p == null || v == null) return '';
      const bin = p >= 80 ? 'h2' : p >= 60 ? 'h1' : p > 40 ? 'm' : p > 20 ? 'c1' : 'c2';
      return `<li><span class="pc-l">${esc(label)}</span><span class="pc-track"><i class="${bin}" style="width:${p}%"></i><b class="${bin}" style="left:${p}%"></b></span>` +
        `<span class="pc-n">${p}</span><span class="pc-v">${esc(fmt(v))}</span></li>`;
    }).join('');
    return `<ul class="pcts">${rows}</ul>`;
  }

  function statGrid(items) {
    return `<dl class="sgrid">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }

  PC.register('jugador', {
    tab: 'lideres',
    every: () => (PC.state.liveToday ? 180000 : 0),
    async render(el, args, ctx) {
      const pid = +args[0];
      if (!pid) { location.hash = '#/lideres'; return; }
      const season = PC.state.season;
      const [pd, st, games] = await Promise.all([API.person(pid, season), PC.statsCtx(season, 'R'), PC.seasonGames(season)]);
      if (!ctx.alive()) return;
      const p = pd.people && pd.people[0];
      if (!p) { el.innerHTML = U.empty('Jugador no encontrado'); return; }
      const lvbp = s => s && s.league && s.league.id === API.LEAGUE;
      const block = (type, group) => (p.stats || []).filter(s => s.type && s.type.displayName === type && s.group && s.group.displayName === group)
        .reduce((a, s) => a.concat((s.splits || []).filter(lvbp)), []);
      const tg = PC.teamGames(games, 'R');
      const maxG = Math.max(0, ...Object.keys(tg).map(k => tg[k]));
      const lg = st.lg;

      const sb = st.batById.get(pid), sp = st.pitById.get(pid);
      const isPitcher = (p.primaryPosition && p.primaryPosition.code === '1') || (sp && (!sb || sp.line.BF > sb.line.PA));
      const tid = (sb && sb.team) || (sp && sp.team) || null;
      const pos = p.primaryPosition ? p.primaryPosition.abbreviation : '';
      const bt = `Batea ${p.batSide ? (p.batSide.code === 'L' ? 'zurdo' : p.batSide.code === 'S' ? 'ambidiestro' : 'derecho') : '—'} · lanza ${p.pitchHand ? (p.pitchHand.code === 'L' ? 'zurdo' : 'derecho') : '—'}`;
      const born = [p.birthCity, p.birthStateProvince, p.birthCountry].filter(Boolean).join(', ');
      let html = `<nav class="crumbs"><a href="#/lideres" data-back>‹ Volver</a></nav>
        <header class="team-head"><p class="eyebrow">${tid ? `${esc(team(tid).name)} · ` : ''}${esc(pos)}${p.primaryNumber ? ` · #${esc(p.primaryNumber)}` : ''}</p>
        <h1>${esc(p.fullName)}</h1>
        <p class="team-sub">${esc(bt)}${p.currentAge ? ` · ${p.currentAge} años` : ''}${born ? ` · nació en ${esc(born)}` : ''}</p></header>`;

      const showBat = sb && sb.line.PA > 0 && (!isPitcher || sb.line.PA >= 20);
      const showPit = sp && sp.line.BF > 0;
      if (!showBat && !showPit) html += U.empty(`Sin juegos en la LVBP ${PC.seasonLabel(season)}`, 'Cambia la temporada arriba para ver otras.');

      const section = (kind) => {
        if (kind === 'bat') {
          const b = sb, r = b.r, l = b.line;
          const qual = l.PA >= C.QUAL_PA * ((b.team && tg[b.team]) || maxG);
          const pool = st.bats.filter(x => x.line.PA >= C.QUAL_PA * ((x.team && tg[x.team]) || maxG));
          return `<section class="sec">${U.head(`Bateo ${PC.seasonLabel(season)}`, qual ? 'Calificado para los líderes.' : `Aún no califica para los líderes (necesita ${Math.ceil(C.QUAL_PA * ((b.team && tg[b.team]) || maxG))} PA).`)}
            ${statGrid([['AVE', F.avg(r.AVG)], ['OBP', F.avg(r.OBP)], ['SLG', F.avg(r.SLG)], ['OPS', F.avg(r.OPS)], ['wRC+', F.int(r.wRCplus)], ['wOBA', F.avg(r.wOBA)],
              ['OPS+', F.int(r.OPSplus)], ['PA', l.PA], ['H', l.H], ['2B', l.D], ['3B', l.T], ['HR', l.HR], ['CI', l.RBI], ['CA', l.R],
              ['BB', l.BB], ['K', l.SO], ['BR', `${l.SB}-${l.CS}`], ['ISO', F.avg(r.ISO)], ['BABIP', F.avg(r.BABIP)], ['BB%', F.pct(r.BBPct)], ['K%', F.pct(r.KPct)]])}
            ${pool.length >= 10 && l.PA >= 50 ? `${U.head('Percentiles en la liga', `Comparado con los ${pool.length} bateadores calificados, ajustando cada número por el tamaño de su muestra. 50 es el promedio; 90 significa que supera al 90%.`)}${pctBars(b, pool, BAT_PCT, y => y.line.PA, lg)}` : ''}
          </section>`;
        }
        const x = sp, r = x.r, l = x.line;
        const qual = l.OUTS / 3 >= C.QUAL_IP * ((x.team && tg[x.team]) || maxG);
        // Abridores contra abridores y relevistas contra relevistas: los relevistas ponchan más por entrar a tirar duro poco rato.
        const role = starter(x) ? 'abridores' : 'relevistas';
        const same = y => starter(y) === starter(x);
        let pool = st.pits.filter(y => same(y) && y.line.OUTS >= (starter(x) ? 45 : 30));
        if (pool.length < 12) pool = st.pits.filter(y => same(y) && y.line.OUTS >= 15);
        return `<section class="sec">${U.head(`Pitcheo ${PC.seasonLabel(season)}`, qual ? 'Calificado para los líderes.' : 'Aún no califica para los líderes de efectividad.')}
          ${statGrid([['G-P', `${l.W}-${l.L}`], ['EFE', F.era(r.ERA)], ['FIP', F.era(r.FIP)], ['WHIP', F.era(r.WHIP)], ['IL', F.ip(l.OUTS)], ['J / JI', `${l.G} / ${l.GS}`],
            ['JS', l.SV], ['HLD', l.HLD], ['K', l.SO], ['BB', l.BB], ['HR', l.HR], ['K%', F.pct(r.KPct)], ['BB%', F.pct(r.BBPct)], ['K-BB%', F.pct(r.KBBPct)],
            ['K/9', F.dec1(r.K9)], ['BB/9', F.dec1(r.BB9)], ['EFE+', F.int(r.ERAplus)], ['LOB%', F.pct(r.LOBPct)], ['BABIP', F.avg(r.BABIP)], ['AVE rival', F.avg(r.AVGa)]])}
          ${pool.length >= 8 && l.BF >= 40 ? `${U.head('Percentiles en la liga', `Comparado con ${pool.length} ${role} de la liga, ajustando cada número por el tamaño de su muestra.`)}${pctBars(x, pool, PIT_PCT, y => y.line.BF, lg)}` : ''}
        </section>`;
      };
      if (showPit && isPitcher) html += section('pit');
      if (showBat) html += section('bat');
      if (showPit && !isPitcher) html += section('pit');

      // juego a juego, con el promedio acumulado recalculado después de cada juego
      const kind = showPit && isPitcher ? 'pitching' : 'hitting';
      const log = block('gameLog', kind).filter(s => s.date).sort((a, b) => a.date < b.date ? -1 : 1);
      if (log.length) {
        html += `<section class="sec">${U.head('Juego a juego', kind === 'hitting' ? 'AVE y OPS acumulados después de cada juego.' : 'EFE acumulada después de cada juego.')}<div id="pl-chart" class="line-chart"></div>`;
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
        html += U.table(cols, rows.slice().reverse()) + '</section>';
        ctx.data.logRows = rows;
        ctx.data.kind = kind;
      }

      // carrera en la LVBP
      const career = block('yearByYear', isPitcher && showPit ? 'pitching' : 'hitting').filter(s => s.season);
      if (career.length > 1) {
        const pitch = isPitcher && showPit;
        const crow = career.map(s => {
          const line = pitch ? C.pitLine(s.stat) : C.batLine(s.stat);
          return { s, line, r: pitch ? C.pit(line) : C.bat(line) };
        }).sort((a, b) => +b.s.season - +a.s.season);
        const ccols = pitch ? [
          { k: 's', label: 'Temporada', first: true, cls: 'name', html: x => `${esc(PC.seasonLabel(+x.s.season))} <small>${x.s.team ? esc(team(x.s.team.id).abbr) : ''}</small>` },
          { k: 'wl', label: 'G-P', get: x => `${x.line.W}-${x.line.L}` }, { k: 'ip', label: 'IL', get: x => F.ip(x.line.OUTS) },
          { k: 'era', label: 'EFE', get: x => x.r.ERA, fmt: F.era }, { k: 'whip', label: 'WHIP', get: x => x.r.WHIP, fmt: F.era },
          { k: 'k', label: 'K', get: x => x.line.SO }, { k: 'bb', label: 'BB', get: x => x.line.BB }, { k: 'sv', label: 'JS', get: x => x.line.SV }
        ] : [
          { k: 's', label: 'Temporada', first: true, cls: 'name', html: x => `${esc(PC.seasonLabel(+x.s.season))} <small>${x.s.team ? esc(team(x.s.team.id).abbr) : ''}</small>` },
          { k: 'g', label: 'JJ', get: x => x.line.G }, { k: 'pa', label: 'PA', get: x => x.line.PA },
          { k: 'avg', label: 'AVE', get: x => x.r.AVG, fmt: F.avg }, { k: 'obp', label: 'OBP', get: x => x.r.OBP, fmt: F.avg },
          { k: 'slg', label: 'SLG', get: x => x.r.SLG, fmt: F.avg }, { k: 'hr', label: 'HR', get: x => x.line.HR }, { k: 'rbi', label: 'CI', get: x => x.line.RBI }
        ];
        html += `<section class="sec">${U.head('Carrera en la LVBP', 'Temporadas disponibles en la fuente de datos (desde 2016-17).')}${U.table(ccols, crow)}</section>`;
      }
      html += U.fresh(Math.min(API.when(pd, games), st.t || Date.now()));
      el.innerHTML = html;

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
})(window);
