/* Pizarra Criolla · juegos.js
   Juegos del día (marcador en vivo) y la pantalla de cada juego: pizarra, probabilidad de ganar, figuras,
   jugadas clave, box score y jugada por jugada. Un juego terminado se puede repetir jugada a jugada. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, CH = PC.charts, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc;
  const team = (id, api) => PC.team(id, api);

  // "José A. Martínez" -> "Martínez" ; "Ronald Acuña Jr." -> "Acuña Jr."
  const surname = n => {
    const p = String(n || '').split(' ').filter(x => x && !/^[A-Z]\.$/.test(x));
    return p.length > 1 ? p.slice(1).join(' ') : (p[0] || '');
  };
  const ord = n => `${n}.º`;
  // "2023-11-01T21:00:00Z" -> fecha en Venezuela
  const dayOf = iso => (iso ? D.isoOf(Date.parse(iso)) : null);

  function inningShort(g) {
    if (!g.inning) return g.label || 'En vivo';
    if (g.inningState === 'Middle') return `Mitad ${ord(g.inning)}`;
    if (g.inningState === 'End') return `Fin ${ord(g.inning)}`;
    return `${g.half === 'Top' ? '▲' : '▼'} ${ord(g.inning)}`;
  }

  // "Final", "Final · 10 inn.", "Final · 5 inn. (lluvia)", "Final · empate"
  function finalText(inn, sched, reason, tied) {
    if (tied) return 'Final · empate';
    sched = sched || 9;
    if (inn && inn > sched) return `Final · ${inn} inn.`;
    if (inn && inn < sched) { const why = C.reasonEs(reason); return `Final · ${inn} inn.${why ? ` (${why})` : ''}`; }
    return 'Final';
  }

  function pill(g) {
    if (g.status === 'live') {
      if (/delayed/i.test(g.detailed)) return `<span class="pill warn">${esc(g.label || 'Juego detenido')}</span>`;
      return `<span class="pill live"><i aria-hidden="true"></i>${esc(inningShort(g))}</span>`;
    }
    if (g.status === 'final') {
      const tied = !g.away.win && !g.home.win && /tied/i.test(g.detailed);
      return `<span class="pill fin">${esc(finalText(g.inning, g.sched, g.reason, tied))}</span>`;
    }
    if (g.status === 'post' || g.status === 'susp') return `<span class="pill warn">${esc(g.label || (g.status === 'post' ? 'Pospuesto' : 'Suspendido'))}</span>`;
    if (g.label) return `<span class="pill ${/demorado/.test(g.label) ? 'warn' : 'pre'}">${esc(g.label)}</span>`;
    if (g.tbd) return `<span class="pill pre">${g.dh === 2 ? 'Al terminar el 1.º' : 'Hora por definir'}</span>`;
    return `<span class="pill pre">${esc(D.time(g.ts))}</span>`;
  }

  // Notas de la tarjeta: fase, desempate, doble cartelera, suspendido o reprogramado, estadio.
  function notes(g) {
    const out = [];
    if (g.type !== 'R') out.push(PC.phaseLabel(D.seasonOf(g.date), g.type, g.series) + (g.seriesGame ? ` · juego ${g.seriesGame}` : ''));
    if (g.tiebreaker) out.push('Juego de desempate');
    if (g.dh) out.push(`Doble cartelera, juego ${g.dh}${g.sched && g.sched !== 9 ? ` a ${g.sched} inn.` : ''}`);
    if (g.resumedFrom) out.push(`Reanudación del juego del ${D.short(dayOf(g.resumedFrom))}`);
    else if (g.resumeDate) out.push(g.status === 'final' ? `Suspendido; se terminó el ${D.short(dayOf(g.resumeDate))}` : `Se reanuda el ${D.short(dayOf(g.resumeDate))}`);
    if (g.rescheduledFrom && !g.resumedFrom) out.push(`Reprogramado del ${D.short(dayOf(g.rescheduledFrom))}`);
    if (g.status === 'post' && g.rescheduleDate && dayOf(g.rescheduleDate) !== D.isoOf(g.ts)) out.push(`Se juega el ${D.short(dayOf(g.rescheduleDate))}`);
    out.push(PC.venue(g.venue));
    return out.filter(Boolean).join(' · ');
  }

  // ---------- tarjeta de un juego en la lista ----------
  function card(g, stats) {
    const row = s => {
      const t = g[s];
      const win = g.status === 'final' && t.win;
      const rec = t.rec ? `${t.rec.W}-${t.rec.L}` : '';
      return `<div class="gc-row${win ? ' win' : ''}">${U.chip(t.id)}<span class="gc-name">${esc(team(t.id, { name: t.name }).short)}<small>${rec}</small></span>` +
        `<span class="gc-score">${t.score == null || g.status === 'pre' || g.status === 'post' ? '' : t.score}</span></div>`;
    };
    let foot = '';
    if (g.status === 'final' && g.dec) {
      foot = [['W', 'G'], ['L', 'P'], ['S', 'JS']].filter(([k]) => g.dec[k]).map(([k, l]) => `${l}: ${esc(surname(g.dec[k].name))}`).join(' · ');
    } else if (g.status === 'live') {
      foot = `<span class="gc-live">${U.bases(g.bases)}${U.outs(g.outs)}<span class="cnt">${g.balls || 0}-${g.strikes || 0}</span></span>` +
        `<span class="gc-mu">${g.batter ? `Batea ${esc(surname(g.batter.name))}` : ''}${g.pitcher ? ` · Lanza ${esc(surname(g.pitcher.name))}` : ''}</span>`;
    } else if (g.status === 'pre' && (g.away.prob || g.home.prob)) {
      const pp = s => {
        const p = g[s].prob;
        if (!p) return 'por anunciar';
        const st = stats && stats.pitById.get(p.id);
        return esc(surname(p.name)) + (st && st.line.OUTS ? ` <small>(${F.era(st.r.ERA)})</small>` : '');
      };
      foot = `Abridores: ${pp('away')} vs. ${pp('home')}`;
    }
    return `<a class="gcard ${g.status}" href="#/juego/${g.pk}"><div class="gc-top">${pill(g)}<span class="gc-meta">${esc(notes(g))}</span></div>` +
      `${row('away')}${row('home')}${foot ? `<div class="gc-foot">${foot}</div>` : ''}</a>`;
  }

  // Días con juegos alrededor de una fecha (para las flechas anterior / siguiente).
  async function navDates(date) {
    const s = D.seasonOf(date);
    const seasons = [s - 1, s, s + 1].filter(x => x >= 2016 && x <= API.currentSeason());
    const lists = await Promise.all(seasons.map(x => PC.seasonGames(x, false, true).catch(() => [])));
    const dates = [...new Set([].concat(...lists).filter(g => g.status !== 'post').map(g => D.isoOf(g.ts)))].sort();
    let prev = null, next = null;
    for (const d of dates) { if (d < date) prev = d; else if (d > date && !next) next = d; }
    return { prev, next };
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

  function countdown(up) {
    const g = up.game, days = D.diff(D.today(), g.date);
    const when = days > 1 ? `Faltan ${days} días` : days === 1 ? 'Arranca mañana' : 'Arranca hoy';
    return `<section class="countdown">
      <p class="eyebrow">Temporada ${PC.seasonLabel(up.season)}</p>
      <p class="cd-big">${when}</p>
      <p class="cd-game"><b>${esc(team(g.away.id).name)}</b> visita a <b>${esc(team(g.home.id).name)}</b></p>
      <p class="cd-meta">${esc(D.long(g.date))} · ${esc(D.time(g.ts))} · ${esc(PC.venue(g.venue))}</p>
    </section>`;
  }

  // ---------- vista: juegos del día ----------
  async function drawDay(el, ctx) {
    const date = ctx.data.date, today = D.today(), isToday = date === today;
    const live = !!ctx.data.live;
    const tasks = [API.day(date, live), navDates(date)];
    if (isToday) tasks.push(API.day(D.add(date, -1), live).catch(() => null));
    const [day, nav, prevDay] = await Promise.all(tasks);
    if (!ctx.alive()) return;
    // Un juego de anoche que sigue en vivo pasada la medianoche se queda en "Hoy".
    const carry = prevDay ? C.flatSchedule(prevDay).filter(g => g.status === 'live') : [];
    const games = carry.concat(C.flatSchedule(day))
      .filter(g => !(g.status === 'final' && (!PC.TEAMS[g.away.id] || !PC.TEAMS[g.home.id]))); // juegos de relleno "por definir"
    ctx.data.live = games.some(g => g.status === 'live');
    ctx.data.pending = date >= D.add(today, -1) && games.some(g => g.status === 'pre' || g.status === 'live' || g.status === 'susp');
    let stats = null;
    if (games.some(g => g.status === 'pre' && (g.away.prob || g.home.prob))) {
      try { stats = await PC.statsCtx(Math.min(D.seasonOf(date), PC.state.season), 'R'); } catch (e) { stats = null; }
      if (!ctx.alive()) return;
    }
    const dd = D.diff(today, date);
    const rel = isToday ? 'Hoy' : dd === -1 ? 'Ayer' : dd === 1 ? 'Mañana' : dd < 0 ? `Hace ${-dd} días` : `En ${dd} días`;
    let html = `<div class="datebar">
      ${nav.prev ? `<a class="db-btn" href="#/juegos/${nav.prev}" aria-label="Día de juego anterior: ${esc(D.long(nav.prev))}">‹</a>` : '<span class="db-btn off" aria-hidden="true">‹</span>'}
      <div class="db-mid">
        <label class="db-date" for="pick-date">${esc(D.long(date, D.seasonOf(date) !== D.seasonOf(today)))}</label>
        <p class="db-sub">${esc(rel)}${isToday ? '' : ` · <a href="#/juegos/${today}">ir a hoy</a>`}</p>
        <input type="date" id="pick-date" class="db-input" value="${date}" aria-label="Elegir fecha">
      </div>
      ${nav.next ? `<a class="db-btn" href="#/juegos/${nav.next}" aria-label="Siguiente día de juego: ${esc(D.long(nav.next))}">›</a>` : '<span class="db-btn off" aria-hidden="true">›</span>'}
    </div>`;
    const up = PC.state.upcoming;
    if (up && date <= up.game.date && date >= D.add(up.game.date, -60)) html += countdown(up);
    if (games.length) {
      html += `<div class="games">${games.map(g => card(g, stats)).join('')}</div>`;
      if (carry.length) html += U.note('Los juegos de anoche que siguen en vivo se quedan aquí hasta que terminen.');
    } else {
      const go = [];
      if (nav.next) go.push(`<a class="btn" href="#/juegos/${nav.next}">Próximos juegos: ${esc(D.long(nav.next))}</a>`);
      if (nav.prev) go.push(`<a class="btn ghost" href="#/juegos/${nav.prev}">Últimos juegos: ${esc(D.long(nav.prev))}</a>`);
      html += U.empty('No hay juegos este día', go.join(' '));
      if (up) {
        const last = await PC.seasonGames(PC.state.season).catch(() => []);
        const ch = champion(last);
        if (ch && ctx.alive()) {
          html += `<section class="champ"><p class="eyebrow">Campeón ${PC.seasonLabel(PC.state.season)}</p>
            <p class="champ-t">${esc(team(ch.id).name)}</p>
            <p>Ganó la final ${ch.w}-${ch.l} a ${esc(team(ch.opp).name)}. <a href="#/tabla/W">Ver la serie</a> · <a href="#/lideres">Líderes de la temporada</a></p></section>`;
        }
      }
    }
    html += U.fresh(API.when(day));
    if (!ctx.alive()) return;
    el.innerHTML = html;
    const pick = el.querySelector('#pick-date');
    if (pick) pick.addEventListener('change', () => { if (pick.value) location.hash = '#/juegos/' + pick.value; });
  }

  PC.register('juegos', {
    tab: 'juegos',
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

  // La pizarra: marcador por inning, C-H-E y, en vivo, cuenta, outs, corredores y el duelo actual.
  function boardHTML(d) {
    const f = d.feed, g = f.gameData, ls = d.ls || f.liveData.linescore || {};
    const stObj = d.st || g.status || {};
    const st = d.cursor != null ? C.stateAt(d.done, d.cursor) : null;
    const A = side(d, 'away'), H = side(d, 'home');
    const sched = ls.scheduledInnings || 9;
    let inns, tot;
    if (st) {
      inns = st.innings.map(I => ({ away: I.played.away ? I.away.r : null, home: I.played.home ? I.home.r : null }));
      tot = st.tot;
    } else {
      inns = (ls.innings || []).map(I => ({
        away: I.away && I.away.runs != null ? I.away.runs : null,
        home: I.home && I.home.runs != null ? I.home.runs : null
      }));
      const T = ls.teams || { away: {}, home: {} };
      tot = {
        away: { r: T.away.runs || 0, h: T.away.hits || 0, e: T.away.errors || 0 },
        home: { r: T.home.runs || 0, h: T.home.hits || 0, e: T.home.errors || 0 }
      };
    }
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
    const curInn = st ? st.inning : ls.currentInning;
    const curTop = st ? st.top : ls.isTopInning;
    const live = d.status === 'live' && !st;
    const isCur = (i, s) => (live || st) && i + 1 === curInn && (s === 'away') === !!curTop;
    const score = s => (s === 'away' ? tot.away.r : tot.home.r);
    const lead = d.status === 'pre' || d.status === 'post' ? null : score('away') > score('home') ? 'away' : score('home') > score('away') ? 'home' : null;
    const rec = s => { const r = g.teams[s].record; return r && r.wins != null ? `${r.wins}-${r.losses}` : ''; };
    const label = C.statusText(stObj);

    let status;
    if (st) status = `<span class="pill replay">Repetición</span> ${esc(halfLabel(st.inning, st.top))} · ${st.outs} out${st.outs === 1 ? '' : 's'}`;
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
      const bases = st ? st.bases : [!!(ls.offense && ls.offense.first), !!(ls.offense && ls.offense.second), !!(ls.offense && ls.offense.third)];
      const outs = st ? st.outs : ls.outs || 0;
      const bulbs = (n2, on, lab) => `<span class="bulbs" role="img" aria-label="${lab}: ${on}"><b>${lab[0]}</b>${Array.from({ length: n2 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
      const counts = live ? bulbs(3, ls.balls || 0, 'Bolas') + bulbs(2, ls.strikes || 0, 'Strikes') : '';
      const bat = st ? st.batter : ls.offense && ls.offense.batter;
      const pit = st ? st.pitcher : ls.defense && ls.defense.pitcher;
      const bl = bat && player(d, bat.id), pl = pit && player(d, pit.id);
      const bLine = bl && bl.stats && bl.stats.batting && !st ? ` <small>${bl.stats.batting.hits || 0}-${bl.stats.batting.atBats || 0} hoy</small>` : '';
      const pLine = pl && pl.stats && pl.stats.pitching && !st ? ` <small>${pl.stats.pitching.numberOfPitches || pl.stats.pitching.pitchesThrown || 0} lanzamientos</small>` : '';
      duel = `<div class="duel">
        <div class="duel-state">${U.bases(bases, true)}${counts}${bulbs(2, Math.min(2, outs), 'Outs')}</div>
        <div class="duel-mu">
          ${bat ? `<p><span>${st ? 'Bateó' : 'Batea'}</span> ${U.player(bat.id, bat.fullName)}${bLine}</p>` : ''}
          ${pit ? `<p><span>${st ? 'Lanzó' : 'Lanza'}</span> ${U.player(pit.id, pit.fullName)}${pLine}</p>` : ''}
        </div></div>`;
      const cp = f.liveData.plays.currentPlay;
      const last = st ? st.desc : (cp && cp.result && cp.result.description) || (d.done.length ? d.done[d.done.length - 1].result.description : '');
      if (last) duel += `<p class="lastplay">${esc(C.cleanEs(last))}</p>`;
    }

    const teamRow = (s, t) => {
      const link = PC.TEAMS[t.id] ? `href="#/equipo/${t.id}"` : '';
      return `<div class="bt-row${lead === s ? ' lead' : ''}"><span class="bt-abbr">${esc(t.abbr)}</span>` +
        `<a class="bt-name" ${link} title="${esc(t.name)}">${esc(t.short)}<small>${rec(s)}</small></a>` +
        `<span class="bt-runs">${d.status === 'pre' || d.status === 'post' ? '' : score(s)}</span></div>`;
    };
    const lineTable = d.status === 'pre' || d.status === 'post' ? '' : `<div class="bt-line"><table aria-label="Carreras por inning">
      <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th class="rhe">C</th><th class="rhe">H</th><th class="rhe">E</th></tr></thead>
      <tbody>${[['away', A], ['home', H]].map(([s, t]) => `<tr><th scope="row">${esc(t.abbr)}</th>${Array.from({ length: n }, (_, i) =>
        `<td${isCur(i, s) ? ' class="cur"' : ''}>${cell(i, s)}</td>`).join('')}<td class="rhe r">${tot[s].r}</td><td class="rhe">${tot[s].h}</td><td class="rhe">${tot[s].e}</td></tr>`).join('')}</tbody>
    </table></div>`;
    return `<div class="board">
      <p class="bt-status">${status}<span class="bt-venue">${esc(PC.venue(g.venue && g.venue.name))}</span></p>
      ${teamRow('away', A)}${teamRow('home', H)}
      ${lineTable}
      ${duel}
    </div>`;
  }

  // ---------- probabilidad de ganar, figuras y jugadas clave (hasta la jugada elegida) ----------
  function wpPlays(d) {
    if (!d.wpa) return [];
    return d.cursor != null ? d.wpa.plays.slice(0, d.cursor + 1) : d.wpa.plays;
  }

  function wpNowHTML(d) {
    const plays = wpPlays(d);
    if (!plays.length) return '';
    const v = plays[plays.length - 1].after;
    const a = Math.round(100 - v), h = Math.round(v);
    return `<div class="wp-now">
      <p><span class="k away" aria-hidden="true"></span>${esc(side(d, 'away').short)} <b>${a}%</b></p>
      <p><span class="k home" aria-hidden="true"></span>${esc(side(d, 'home').short)} <b>${h}%</b></p>
    </div>`;
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
      return `<li class="${worst ? 'worst' : ''}"><span class="fig-n">${worst ? 'El que más restó' : i + 1}</span>` +
        `<span class="fig-who">${U.player(r.id, r.name)} <small><span class="tchip">${esc(t.abbr)}</span> ${r.role === 'bat' ? 'bateador' : 'lanzador'}</small></span>` +
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
      return `<section class="box-team"><h3><span class="tchip">${esc(t.abbr)}</span> ${esc(t.name)}</h3>
        ${U.table(bcols, bats, { cls: 'box', help: false, foot: { n: 'Totales', ab: tb.atBats, r: tb.runs, h: tb.hits, rbi: tb.rbi, bb: tb.baseOnBalls, so: tb.strikeOuts, lob: tb.leftOnBase } })}
        ${U.table(pcols, pits, { cls: 'box', help: false })}
      </section>`;
    }).join('') + U.note('BE: bateador emergente · CE: corredor emergente · BD: bateador designado · LOB: dejados en base · Enf.: bateadores enfrentados · Lz-St: lanzamientos y strikes. Decisiones: G ganador, P perdedor, JS salvado, HLD hold, SD salvado desperdiciado.');
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
      (p.playEvents || []).forEach(e => {
        const et = e.details && e.details.eventType;
        if (e.type === 'action' && ACTIONS.has(et) && et !== p.result.eventType && e.details.description) {
          gr.items.push({ act: C.cleanEs(e.details.description) });
        }
      });
      gr.items.push({ p, w: wp[i] });
    });
    const A = side(d, 'away'), H = side(d, 'home');
    return groups.reverse().map(gr => {
      const bat = gr.top ? A : H;
      return `<section class="half"><h4>${esc(halfLabel(gr.inning, gr.top))} <small>${esc(bat.short)} al bate</small></h4><ol>` +
        gr.items.slice().reverse().map(it => {
          if (it.act) return `<li class="act"><p>${esc(it.act)}</p></li>`;
          const p = it.p, w = it.w, sc = p.about.isScoringPlay;
          const dl = w ? `<span class="pl-d" title="Cambio en la probabilidad del equipo al bate">${F.signed(w.dswing, 1)}</span>` : '';
          return `<li class="${sc ? 'score' : ''}"><p><b class="pl-ev">${esc(C.eventEs(p))}</b>${dl}</p>` +
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
      return `<div class="prob"><p class="prob-t"><span class="tchip">${esc(t.abbr)}</span> ${esc(t.short)}</p>` +
        (p ? `<p class="prob-n">${U.player(p.id, p.fullName)}</p><p class="prob-l">${esc(line)}</p>` : '<p class="prob-n">Por anunciar</p>') + '</div>';
    };
    return `<section class="sec">${U.head('Abridores probables')}<div class="probs">${one('away')}${one('home')}</div></section>`;
  }

  // ---------- montaje ----------
  function drawWP(el, d) {
    const box = el.querySelector('#wp-chart');
    if (!box || !d.wpa) return;
    const total = d.status === 'final' ? d.wpa.plays.length : Math.max(d.wpa.plays.length + 8, 78);
    CH.responsive(box, () => CH.winProb(box, d.wpa.plays, {
      away: side(d, 'away').abbr, home: side(d, 'home').abbr, total, cursor: d.cursor
    }));
  }

  function refreshDynamic(el, d) {
    const set = (sel, html) => { const n = el.querySelector(sel); if (n) n.innerHTML = html; };
    set('.board-wrap', boardHTML(d));
    set('#wp-now', wpNowHTML(d));
    set('#figs', figsHTML(d));
    set('#keys', keysHTML(d));
    set('#tab-jugadas', playsHTML(d));
    drawWP(el, d);
    const lab = el.querySelector('.rp-label');
    if (lab) {
      const k = d.cursor == null ? d.done.length - 1 : d.cursor;
      const p = d.done[k];
      lab.textContent = p ? `Jugada ${k + 1} de ${d.done.length} · ${halfLabel(p.about.inning, p.about.isTopInning)}` : '';
    }
  }

  function stopReplay(d) {
    if (d && d.timer) { clearInterval(d.timer); d.timer = null; }
  }

  function draw(el, ctx, keep) {
    const d = ctx.data, g = d.feed.gameData;
    const y = keep ? window.scrollY : 0;
    const tab = (keep && d.tab) || (d.status === 'pre' || d.status === 'post' ? 'info' : 'box');
    d.tab = tab;
    const hasWP = d.wpa && d.wpa.plays.length;
    const A = side(d, 'away'), H = side(d, 'home');
    const replay = d.status === 'final' && hasWP ? `<section class="replay" aria-label="Repetir el juego">
        <div class="rp-row"><button type="button" class="btn rp-play" aria-pressed="false">▶ Repetir</button>
        <input type="range" id="rp" min="0" max="${d.done.length - 1}" value="${d.cursor == null ? d.done.length - 1 : d.cursor}" aria-label="Elegir jugada"></div>
        <p class="rp-label"></p></section>` : '';
    const wp = hasWP ? `<section class="sec">
        ${U.head('Probabilidad de ganar', 'Se recalcula en cada turno con el marcador, el inning, los outs y los corredores. Toca la curva para ver la jugada.')}
        <div id="wp-now">${wpNowHTML(d)}</div>
        <div id="wp-chart" class="wp-chart"></div>
        <p class="viz-key"><span class="k away" aria-hidden="true"></span>${esc(A.abbr)} gana hacia arriba · <span class="k home" aria-hidden="true"></span>${esc(H.abbr)} hacia abajo · barras: presión del turno (LI)</p>
      </section>
      <section class="sec">${U.head('Figuras del juego', 'Aporte a la victoria (WPA): puntos de probabilidad que cada uno le sumó o le restó a su equipo.')}<div id="figs">${figsHTML(d)}</div></section>
      <section class="sec">${U.head('Jugadas clave', 'Las que más movieron la probabilidad de ganar.')}<div id="keys">${keysHTML(d)}</div></section>` : '';
    const tabs = [['box', 'Box score'], ['jugadas', 'Jugada a jugada'], ['info', 'Datos']];
    const noBox = d.status === 'pre' || d.status === 'post';
    const html = `<nav class="crumbs"><a href="#/juegos/${g.datetime.officialDate}">‹ Juegos del ${esc(D.short(g.datetime.officialDate))}</a></nav>
      <section class="board-wrap">${boardHTML(d)}</section>
      ${replay}
      ${d.status === 'pre' ? preHTML(d) : ''}
      ${wp}
      <section class="sec">
        <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div id="tab-box" role="tabpanel" ${tab === 'box' ? '' : 'hidden'}>${noBox ? U.note('El box score aparece cuando empiece el juego.') : boxHTML(d)}</div>
        <div id="tab-jugadas" role="tabpanel" ${tab === 'jugadas' ? '' : 'hidden'}>${playsHTML(d)}</div>
        <div id="tab-info" role="tabpanel" ${tab === 'info' ? '' : 'hidden'}>${infoHTML(d)}</div>
      </section>
      ${U.fresh(API.when(d.feed))}`;
    el.innerHTML = html;
    drawWP(el, d);

    el.querySelectorAll('.seg [data-tab]').forEach(b => b.addEventListener('click', () => {
      d.tab = b.dataset.tab;
      el.querySelectorAll('.seg [data-tab]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      ['box', 'jugadas', 'info'].forEach(k => { el.querySelector('#tab-' + k).hidden = k !== d.tab; });
    }));

    const rp = el.querySelector('#rp');
    if (rp) {
      const btn = el.querySelector('.rp-play');
      const last = d.done.length - 1;
      const setK = k => { d.cursor = k >= last ? null : k; rp.value = String(k); refreshDynamic(el, d); };
      rp.addEventListener('input', () => { stopReplay(d); btn.textContent = '▶ Repetir'; btn.setAttribute('aria-pressed', 'false'); setK(+rp.value); });
      btn.addEventListener('click', () => {
        if (d.timer) { stopReplay(d); btn.textContent = '▶ Seguir'; btn.setAttribute('aria-pressed', 'false'); return; }
        let k = d.cursor == null ? 0 : d.cursor;
        setK(k);
        btn.textContent = '❚❚ Pausa';
        btn.setAttribute('aria-pressed', 'true');
        d.timer = setInterval(() => {
          k++;
          if (k >= last || !ctx.alive()) { stopReplay(d); setK(last); btn.textContent = '▶ Repetir'; btn.setAttribute('aria-pressed', 'false'); return; }
          setK(k);
        }, 900);
      });
      refreshDynamic(el, d);
    }
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
      // Primero la vigilancia (0,6 KB, siempre fresca): si el juego no ha terminado, el completo se pide fresco también.
      const watch = await API.watch(pk).catch(() => null);
      if (!ctx.alive()) return;
      const live = !watch || C.gameStatus(watch.gameData.status) !== 'final';
      const feed = await API.feed(pk, live);
      if (!ctx.alive()) return;
      await load(ctx, feed, live, watch);
      if (!ctx.alive()) return;
      draw(el, ctx);
    },
    async refresh(el, args, ctx) {
      const d = ctx.data;
      const watch = await API.watch(d.pk);
      if (!ctx.alive() || !watch || !watch.gameData) return;
      if (sigOf(watch.liveData && watch.liveData.linescore, watch.gameData.status) === d.sig) {
        d.ls = watch.liveData.linescore; // solo cambió la cuenta: se repinta la pizarra
        d.st = watch.gameData.status;
        const w = el.querySelector('.board-wrap');
        if (w) w.innerHTML = boardHTML(d);
        const fr = el.querySelector('[data-ago]');
        if (fr) fr.dataset.ago = String(API.when(watch));
        return;
      }
      const feed = await API.feed(d.pk, true);
      if (!ctx.alive()) return;
      await load(ctx, feed, true, watch);
      if (!ctx.alive()) return;
      draw(el, ctx, true);
    },
    leave(ctx) { stopReplay(ctx.data); }
  });
})(window);
