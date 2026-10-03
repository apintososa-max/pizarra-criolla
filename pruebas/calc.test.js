// Prueba los cálculos contra los números oficiales de la API.
// Uso: node pruebas/calc.test.js
const C = require('../js/calc.js');
const B = 'https://statsapi.mlb.com';
const get = async p => { const r = await fetch(B + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok    ' : '  FALLA ') + msg); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const FIELDS = 'dates,games,gamePk,gameType,officialDate,gameDate,status,abstractGameState,detailedState,codedGameState,statusCode,reason,startTimeTBD,teams,away,home,team,id,name,score,isWinner,leagueRecord,wins,losses,linescore,currentInning,scheduledInnings,seriesDescription,doubleHeader,gameNumber,tiebreaker,description,resumeDate,resumedFrom,rescheduleDate,rescheduledFrom';
const LVBP = [692, 693, 694, 695, 696, 697, 698, 699];

(async () => {
  console.log('Estados de juego (sin red)');
  const S = (a, c, d, extra) => Object.assign({ abstractGameState: a, codedGameState: c, detailedState: d }, extra || {});
  const cases = [
    [S('Live', 'P', 'Warmup'), 'pre', 'Calentamiento'],
    [S('Preview', 'P', 'Delayed Start: Rain'), 'pre', 'Inicio demorado por lluvia'],
    [S('Live', 'I', 'Delayed: Rain', { statusCode: 'IR' }), 'live', 'Juego detenido por lluvia'],
    [S('Live', 'I', 'In Progress'), 'live', null],
    [S('Live', 'T', 'Suspended: Rain'), 'susp', 'Suspendido por lluvia'],
    [S('Final', 'F', 'Completed Early', { statusCode: 'FR', reason: 'Rain' }), 'final', 'Final, acortado por lluvia'],
    [S('Final', 'F', 'Final: Tied'), 'final', 'Final, empate'],
    [S('Final', 'D', 'Postponed', { reason: 'Wet Grounds' }), 'post', 'Pospuesto por terreno mojado'],
    [S('Final', 'C', 'Cancelled', { reason: 'Rain' }), 'post', 'Cancelado por lluvia'],
    [S('Final', 'O', 'Game Over'), 'final', null],
    [S('Preview', 'S', 'Scheduled'), 'pre', null]
  ];
  for (const [st, want, text] of cases) {
    const got = C.gameStatus(st), t = C.statusText(st);
    ok(got === want && t === text, `${st.detailedState.padEnd(22)} → ${got}${t ? ' · ' + t : ''}`);
  }

  console.log('\nTextos en español (sin red)');
  ok(C.noteEs('(L, 0-1)(BS, 1)') === '(P, 0-1)(SD, 1)' && C.noteEs('(W, 2-0)') === '(G, 2-0)' && C.noteEs('(H, 1)') === '(HLD, 1)' && C.noteEs('(S, 3)') === '(JS, 3)',
    'decisiones: W→G, L→P, S→JS, H→HLD, BS→SD');
  ok(C.cleanEs('corredor emergente Jose Cordoba reemplaza a replaces Eliezer Alfonzo.') === 'corredor emergente Jose Cordoba reemplaza a Eliezer Alfonzo.', 'limpia "reemplaza a replaces"');
  ok(C.cleanEs('Tucupita Marcano pega doble. Wilfredo Tovar anota Eliezer Alfonzo a 3ra.') === 'Tucupita Marcano pega doble. Wilfredo Tovar anota. Eliezer Alfonzo a 3ra.', 'separa "anota. X a 3ra."');
  ok(C.cleanEs('Wilfredo Tovar recibe base por bolas.') === 'Wilfredo Tovar recibe boleto.', '"base por bolas" → "boleto"');
  ok(C.eventEs({ result: { eventType: 'strikeout' }, playEvents: [{ isPitch: true, details: { code: 'C' } }] }) === 'Ponche cantado' &&
    C.eventEs({ result: { eventType: 'field_out' }, playEvents: [{ hitData: { trajectory: 'popup' } }] }) === 'Elevadito' &&
    C.eventEs({ result: { eventType: 'walk', event: 'Base por Bolas' } }) === 'Boleto', 'nombres de jugadas: ponche cantado, elevadito, boleto');
  ok(C.posEs('PH') === 'BE' && C.posEs('PR') === 'CE' && C.posEs('DH') === 'BD' && C.posEs('SS') === 'SS', 'posiciones: PH→BE, PR→CE, DH→BD');

  console.log('\nTabla calculada vs. tabla oficial, varias temporadas (incluye suspendidos que se terminaron otro día)');
  for (const season of [2016, 2022, 2023, 2024, 2025]) {
    const sched = await get(`/api/v1/schedule?sportId=17&leagueId=135&season=${season}&gameType=R&hydrate=linescore&fields=${FIELDS}`);
    const all = C.flatSchedule(sched, true), games = C.flatSchedule(sched);
    const finals = games.filter(g => g.status === 'final');
    ok(new Set(finals.map(g => g.pk)).size === finals.length, `${season}: ningún juego repetido (${all.length} apariciones → ${games.length} juegos)`);
    const rows = C.standings(games.filter(g => LVBP.indexOf(g.away.id) >= 0 && LVBP.indexOf(g.home.id) >= 0), LVBP);
    const off = (await get(`/api/v1/standings?leagueId=135&season=${season}&standingsTypes=regularSeason`)).records.flatMap(r => r.teamRecords);
    const bad = off.filter(o => { const m = rows.find(r => r.id === o.team.id); return !m || m.W !== o.wins || m.L !== o.losses || m.RS !== o.runsScored || m.RA !== o.runsAllowed; });
    ok(!bad.length, `${season}: ${off.length} equipos con récord y carreras iguales a la tabla oficial` + (bad.length ? ' — difieren: ' + bad.map(o => o.team.name).join(', ') : ''));
  }

  const S25 = 2025;
  const sched = await get(`/api/v1/schedule?sportId=17&leagueId=135&season=${S25}&gameType=R&hydrate=linescore&fields=${FIELDS}`);
  const games = C.flatSchedule(sched);
  const rows = C.standings(games, LVBP);
  const off = (await get(`/api/v1/standings?leagueId=135&season=${S25}&standingsTypes=regularSeason`)).records.flatMap(r => r.teamRecords);
  console.log('\n2025-26: récords parciales');
  for (const o of off) {
    const m = rows.find(r => r.id === o.team.id);
    const sp = (o.records && o.records.splitRecords) || [];
    const f = t => sp.find(x => x.type === t) || {};
    const h = f('home'), a = f('away'), one = f('oneRun'), ex = f('extraInning');
    ok(m.hW === h.wins && m.hL === h.losses && m.aW === a.wins && m.aL === a.losses && m.oneW === one.wins && m.oneL === one.losses && m.exW === ex.wins && m.exL === ex.losses,
      `${o.team.name.padEnd(26)} casa ${m.hW}-${m.hL} · visitante ${m.aW}-${m.aL} · 1 carrera ${m.oneW}-${m.oneL} · extra ${m.exW}-${m.exL}`);
  }
  const triple = rows.filter(r => r.W === 29 && r.L === 27).map(r => r.id);
  ok(triple.length === 3 && rows[1].W === 29 && rows[3].W === 29, `triple empate 29-27 resuelto en orden (${rows.slice(1, 4).map(r => r.id + ':' + (r.tbPct || 0).toFixed(3)).join(', ')})`);

  console.log('\nContexto de liga 2025-26');
  const hit = (await get(`/api/v1/stats?stats=season&group=hitting&sportId=17&leagueId=135&season=${S25}&gameType=R&playerPool=All&limit=3000`)).stats[0].splits;
  const pit = (await get(`/api/v1/stats?stats=season&group=pitching&sportId=17&leagueId=135&season=${S25}&gameType=R&playerPool=All&limit=3000`)).stats[0].splits;
  const lg = C.league(hit.map(s => C.batLine(s.stat)), pit.map(s => C.pitLine(s.stat)));
  const lgB = C.bat(lg.bat, lg), lgP = C.pit(lg.pit, lg);
  ok(near(lgB.wOBA, lg.OBP, 0.004) && near(lgB.wRCplus, 100, 2) && near(lgB.OPSplus, 100, 0.01) && near(lgP.FIP, lg.ERA, 1e-9),
    `wOBA de liga = OBP (${lgB.wOBA.toFixed(3)}), wRC+ 100, OPS+ 100, FIP de liga = EFE (${lg.ERA.toFixed(2)})`);
  let mism = 0;
  for (const s of hit) {
    const r = C.bat(C.batLine(s.stat), lg);
    if (s.stat.atBats > 20 && (Math.abs(r.AVG - +s.stat.avg) > 0.0006 || Math.abs(r.OBP - +s.stat.obp) > 0.0006 || Math.abs(r.SLG - +s.stat.slg) > 0.0006)) mism++;
  }
  ok(mism === 0, `AVE/OBP/SLG = oficiales en todos los bateadores con 20+ VB`);
  let pm = 0;
  for (const s of pit) {
    const r = C.pit(C.pitLine(s.stat), lg);
    if (r.IP >= 5 && (Math.abs(r.ERA - +s.stat.era) > 0.006 || Math.abs(r.WHIP - +s.stat.whip) > 0.006)) pm++;
  }
  ok(pm === 0, `EFE/WHIP = oficiales en lanzadores con 5+ IL`);

  console.log('\nSimulación a mitad de temporada (calendario 2025-26 cortado el 20/11)');
  const cut = Date.parse('2025-11-21T00:00:00Z');
  const half = games.map(g => (g.ts < cut ? g : Object.assign({}, g, { status: g.status === 'final' ? 'pre' : g.status })));
  const hr = C.standings(half, LVBP);
  const pend = C.pending(half);
  const sim = C.simulate(hr, pend, { n: 4000 });
  const sum = (o, k) => Object.values(o).reduce((a, x) => a + x[k], 0);
  ok(near(sum(sim, 'first'), 1, 1e-9) && near(sum(sim, 'top4'), 4, 1e-9) && near(sum(sim, 'rr'), 5, 1e-9) && near(sum(sim, 'top6'), 6, 1e-9),
    'probabilidades suman 1 / 4 / 5 / 6');
  ok(pend.length + hr.reduce((a, r) => a + r.G, 0) / 2 === 224, 'jugados + pendientes = 224');
  const base = {}; hr.forEach(r => { base[r.id] = { pyth: r.pyth, G: r.G }; });
  const fresh = hr.map(r => Object.assign({}, r, { W: 0, L: 0, G: 0, pyth: 0.5 }));
  const rr = C.simulate(fresh.slice(0, 5), pend.filter(g => fresh.slice(0, 5).some(r => r.id === g.home.id) && fresh.slice(0, 5).some(r => r.id === g.away.id)), { n: 4000, base });
  ok(near(sum(rr, 'top2'), 2, 1e-9) && Object.values(rr).some(x => Math.abs(x.str - 0.5) > 0.005), 'Round Robin: parte de la fuerza de la temporada regular (no todos .500)');

  console.log('\nJuegos especiales');
  const feed = await get('/api/v1.1/game/829812/feed/live?language=es');
  const all = feed.liveData.plays.allPlays;
  const st = C.stateAt(all, all.length - 1);
  const L = feed.liveData.linescore;
  ok(st.tot.away.r === L.teams.away.runs && st.tot.home.r === L.teams.home.runs && st.tot.away.h === L.teams.away.hits && st.tot.home.e === L.teams.home.errors,
    `829812: la repetición reconstruye la pizarra (${st.tot.away.r}-${st.tot.home.r}, ${st.tot.away.h} y ${st.tot.home.h} hits)`);
  const short = await get('/api/v1.1/game/829938/feed/live?fields=gameData,status,detailedState,statusCode,reason,codedGameState,abstractGameState,liveData,linescore,currentInning,scheduledInnings');
  ok(C.gameStatus(short.gameData.status) === 'final' && short.liveData.linescore.currentInning === 5 && C.statusText(short.gameData.status) === 'Final, acortado por lluvia',
    `829938: acortado por lluvia en el ${short.liveData.linescore.currentInning}.º → "${C.statusText(short.gameData.status)}"`);
  const wp = await get('/api/v1/game/829812/winProbability?fields=homeTeamWinProbability,homeTeamWinProbabilityAdded,leverageIndex,about,atBatIndex,inning,halfInning,isTopInning,result,description,matchup,batter,pitcher,id,fullName');
  const w = C.wpa(wp);
  const last = w.plays[w.plays.length - 1];
  ok(w.plays.length === all.length && near(w.plays[0].before, 50, 0.01) && near(w.plays[0].before + w.plays.reduce((a, p) => a + p.delta, 0), last.after, 1e-6),
    'probabilidad de ganar: una por turno, arranca en 50% y cierra en el resultado');

  console.log(fails ? `\n${fails} FALLAS` : '\nTodo bien.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
