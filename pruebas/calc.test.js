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
  ok(C.surname('José A. Martínez') === 'Martínez' && C.surname('Ronald Acuña Jr.') === 'Acuña Jr.' && C.surname('Tovar') === 'Tovar', 'apellidos como en la pantalla: "José A. Martínez" → Martínez');

  console.log('\nFase 2 con datos armados (sin red)');
  const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // datos raros: nada lanza error
  let threw = 0;
  for (const x of [null, undefined, {}, [], [{}], [null], [{ about: {} }], [{ playEvents: [null, {}], runners: [null, {}], about: { inning: 2 } }]]) {
    try {
      C.pitchSeq(x); C.pitchSeq(Array.isArray(x) ? x[0] : x); C.stateAt(x, 0); C.stateAtPitch(x, 0, 0); C.stateAtPitch(x, 5, -3);
      C.zoneBox(x); C.wpMarks(x); C.sprayPoints(x); C.moments(x, -1, 3, x, x); C.pitchIndex(x); C.vsLine(x);
      C.defenseAt(x, 0); C.defenseAt({ liveData: { plays: { allPlays: x }, boxscore: x } }, 2);
    } catch (e) { threw++; console.log(e); }
  }
  ok(!threw, 'datos raros (null, jugadas vacías, sin playEvents ni runners): ninguna función lanza error');
  // sin cuenta de la API (no debería pasar): se lleva a mano
  const sq = C.pitchSeq({ playEvents: ['B', 'F', 'F', 'F', 'S'].map((code, index) => ({ isPitch: true, index, details: { code } })) });
  ok(sq.map(s => `${s.balls}-${s.strikes}`).join(' ') === '1-0 1-1 1-2 1-2 1-3' && sq[4].last && sq[4].label === 'Strike tirándole' && sq[1].call === 'foul',
    'pitchSeq sin cuenta: B F F F S → 1-0 1-1 1-2 1-2 1-3');
  // carrera por wild pitch a mitad de turno
  const wpPlay = {
    about: { inning: 3, isTopInning: false }, result: { eventType: 'strikeout', awayScore: 0, homeScore: 1 }, count: { outs: 1, balls: 1, strikes: 3 },
    matchup: { batter: { id: 1, fullName: 'Eduardo Garcia' }, pitcher: { id: 9, fullName: 'Gregory Infante' } },
    playEvents: [{ isPitch: true, index: 0, details: { code: 'B' }, count: { balls: 1, strikes: 0 } },
      { index: 1, type: 'action', details: { eventType: 'wild_pitch', description: 'Lanzamiento desviado. Jermaine Palacios anota.' } },
      { isPitch: true, index: 2, details: { code: 'S' }, count: { balls: 1, strikes: 1 } }, { isPitch: true, index: 3, details: { code: 'S' }, count: { balls: 1, strikes: 2 } },
      { isPitch: true, index: 4, details: { code: 'S' }, count: { balls: 1, strikes: 3 } }],
    runners: [{ movement: { start: '3B', end: 'score' }, details: { eventType: 'wild_pitch', playIndex: 1, runner: { id: 2, fullName: 'Jermaine Palacios' } } },
      { movement: { start: null, end: null, isOut: true }, details: { eventType: 'strikeout', playIndex: 4, runner: { id: 1, fullName: 'Eduardo Garcia' } } }]
  };
  const wpPrev = { about: { inning: 3, isTopInning: false }, result: { eventType: 'triple', awayScore: 0, homeScore: 0 }, count: { outs: 0 }, matchup: { postOnThird: { id: 2, fullName: 'Jermaine Palacios' } } };
  const w0 = C.stateAtPitch([wpPrev, wpPlay], 1, -1), w1 = C.stateAtPitch([wpPrev, wpPlay], 1, 0);
  const wm1 = C.moments([wpPrev, wpPlay], 0, 1, null, { away: 'ARA', home: 'LAR' });
  ok(w0.bases[2] && w0.bases[2].fullName === 'Jermaine Palacios' && w0.home === 0 && !w1.bases[2] && w1.home === 1 && w1.tot.home.r === 1 && w1.innings[2].home.r === 1 && w1.outs === 0 && w1.balls === 1,
    'stateAtPitch: el wild pitch del primer lanzamiento ya anota en ese lanzamiento (no en el siguiente)');
  ok(wm1.length === 1 && wm1[0].title === 'CARRERA · LAR 1-0' && wm1[0].text === 'Lanzamiento desviado; anota Palacios', `moments: carrera por wild pitch → "${wm1[0] && wm1[0].text}"`);
  // juego sin hits del visitante: el home club anota con jonrón en el 1.º y gana sin batear el 9.º
  const mk = (inn, top, ev, outs, h) => ({ about: { inning: inn, isTopInning: top }, result: { eventType: ev, awayScore: 0, homeScore: h }, count: { outs }, matchup: { batter: { id: 1, fullName: 'Juan Pérez' } } });
  const syn = [];
  for (let inn = 1; inn <= 9; inn++) {
    for (let o2 = 1; o2 <= 3; o2++) syn.push(mk(inn, true, 'strikeout', o2, inn > 1 ? 1 : 0));
    if (inn === 9) break;
    if (inn === 1) syn.push(Object.assign(mk(1, false, 'home_run', 0, 1), { runners: [{ movement: { end: 'score' }, details: { eventType: 'home_run', runner: { id: 1, fullName: 'Juan Pérez' } } }] }));
    for (let o2 = 1; o2 <= 3; o2++) syn.push(mk(inn, false, 'strikeout', o2, 1));
  }
  const sm = C.moments(syn, -1, syn.length - 1, null, { away: 'MAG', home: 'LAR' });
  const nh = sm.filter(m => m.type === 'nohit'), lastM = sm[sm.length - 2];
  ok(sm[0].title === 'MITAD DEL 1.º' && sm[1].title === 'JONRÓN · LAR 1-0' && sm[1].text === 'Pérez, jonrón solitario' && nh.length === 4 &&
    nh[0].text === 'MAG sigue sin hits después de 6 innings' && nh[0].title === 'SIN HIT NI CARRERA' && lastM.title === 'FIN DEL 9.º' && nh[3].text === 'MAG terminó sin hits',
    `moments: sin hits del 6.º en adelante (${nh.length}) y "FIN DEL 9.º" cuando el home club gana sin batear el 9.º`);
  // Cara a cara sin datos del futuro (respuestas guardadas de vsPlayer el 05/10/2026, con gameType=R,F,D,L,W)
  const st1 = (pa, ab, h, bb) => ({ plateAppearances: pa, atBats: ab, hits: h, baseOnBalls: bb, doubles: 0, homeRuns: 0, strikeOuts: 0 });
  const vsTP = { stats: [ // Tovar contra Paulino: 3 turnos en la final de 2025-26 y 2 en su round robin
    { type: { displayName: 'vsPlayer' }, splits: [{ season: '2025', gameType: 'W', stat: st1(3, 2, 1, 1) }, { season: '2025', gameType: 'L', stat: st1(2, 2, 0, 0) }] },
    { type: { displayName: 'vsPlayerTotal' }, splits: [{ gameType: 'W', stat: st1(3, 2, 1, 1) }, { gameType: 'L', stat: st1(2, 2, 0, 0) }] }] };
  const vsTV = { stats: [ // Tovar contra Felipe Vázquez: 2 turnos en 2024-25 y 3 en 2025-26
    { type: { displayName: 'vsPlayer' }, splits: [{ season: '2024', gameType: 'R', stat: st1(2, 1, 0, 1) }, { season: '2025', gameType: 'R', stat: st1(3, 3, 0, 0) }] },
    { type: { displayName: 'vsPlayerTotal' }, splits: [{ gameType: 'R', stat: st1(5, 4, 0, 1) }] }] };
  const pa = x => (x ? x.pa : 0);
  ok(pa(C.vsLine(vsTP)) === 5 && C.vsLine(vsTP, { antes: 2025 }) === null && pa(C.vsLine(vsTP, { antes: 2025, tipo: 'W' })) === 2 &&
    pa(C.vsLine(vsTV)) === 5 && pa(C.vsLine(vsTV, { antes: 2025 })) === 2 && pa(C.vsLine(vsTV, { antes: 2026 })) === 5,
  'vsLine con antes: solo temporadas anteriores (y con tipo, las fases anteriores de esa temporada)');

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

  console.log('\nFase 2: el juego lanzamiento a lanzamiento (838798 en Puerto La Cruz, 829812, 829756 con extrainnings)');
  const F2 = { 838798: await get('/api/v1.1/game/838798/feed/live?language=es'), 829812: feed, 829756: await get('/api/v1.1/game/829756/feed/live?language=es') };
  const D2 = {};
  for (const pk of Object.keys(F2)) {
    const fd = F2[pk], L2 = fd.liveData.linescore, tm = fd.gameData.teams;
    const done = D2[pk] = fd.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete);
    const o = { away: tm.away.abbreviation, home: tm.home.abbreviation };
    const tag = `${pk} ${o.away} ${L2.teams.away.runs}-${L2.teams.home.runs} ${o.home}:`;
    const wm = C.wpMarks(done);
    const rA = wm.halves.filter(h => h.top).reduce((a, h) => a + h.runs, 0), rH = wm.halves.filter(h => !h.top).reduce((a, h) => a + h.runs, 0);
    ok(rA === L2.teams.away.runs && rH === L2.teams.home.runs, `${tag} las carreras de las ${wm.halves.length} medias entradas suman las finales`);
    let n = 0, cnt = 0, eq = 0, track = 0, closing = 0;
    done.forEach((q, k) => {
      const seq = C.pitchSeq(q), lp = seq[seq.length - 1];
      if (lp) { n++; if (lp.balls === q.count.balls && lp.strikes === q.count.strikes) cnt++; }
      const { balls, strikes, k: k2, p, lim, ...rest } = C.stateAtPitch(done, k, seq.length - 1);
      if (deep(rest, C.stateAt(done, k))) eq++;
      // El seguimiento de corredores de mitad de turno, llevado hasta el final de la jugada (con un lanzamiento de
      // relleno al final), da las mismas bases, outs y marcador que la API en las jugadas que no cierran el inning.
      if (q.count.outs >= 3) { closing++; return; }
      const fake = Object.assign({}, q, { playEvents: (q.playEvents || []).concat([{ isPitch: true, index: 9999, details: { code: 'B' } }]) });
      const d2 = done.slice(); d2[k] = fake;
      const s = C.stateAtPitch(d2, k, C.pitchSeq(fake).length - 2), m = q.matchup;
      if (deep(s.bases.map(x => x && x.id), [m.postOnFirst, m.postOnSecond, m.postOnThird].map(x => (x ? x.id : null))) &&
        s.outs === q.count.outs && s.away === q.result.awayScore && s.home === q.result.homeScore) track++;
    });
    ok(cnt === n, `${tag} la cuenta final de pitchSeq coincide con play.count (${n} turnos)`);
    ok(eq === done.length, `${tag} stateAtPitch del último lanzamiento = stateAt en las ${done.length} jugadas`);
    ok(track === done.length - closing, `${tag} a mitad de turno, el seguimiento de corredores cuadra con la API en ${track} de ${done.length - closing} jugadas`);
    const sp = C.sprayPoints(done);
    const bip = done.filter(q => (q.playEvents || []).some(e => e.hitData && e.hitData.coordinates && e.hitData.coordinates.coordX != null)).length;
    ok(sp.length === bip && sp.every(x => x.hit === ['single', 'double', 'triple', 'home_run'].includes(done[x.k].result.eventType)), `${tag} sprayPoints = batazos con coordenadas (${bip})`);
    const mo = C.moments(done, -1, done.length - 1, L2, o);
    const hrK = done.map((q, k) => (q.result.eventType === 'home_run' ? k : -1)).filter(k => k >= 0);
    const subK = [];
    done.forEach((q, k) => (q.playEvents || []).forEach(e => { if (e.details && e.details.eventType === 'pitching_substitution') subK.push(k); }));
    ok(deep(mo.filter(m => m.type === 'jonron').map(m => m.k), hrK) && deep(wm.hr, hrK) && deep(mo.filter(m => m.type === 'cambio').map(m => m.k), subK) && deep(wm.changes.map(c => c.k), subK),
      `${tag} moments y wpMarks traen los ${hrK.length} jonrones y los ${subK.length} cambios de lanzador`);
    const bx = fd.liveData.boxscore.teams;
    ok(wm.changes.every(c => bx[c.side].pitchers.some(id => done[c.k].playEvents.some(e => e.player && e.player.id === id && e.details.eventType === 'pitching_substitution'))),
      `${tag} cada cambio de lanzador queda del lado del equipo que cambió`);
    // Los dejados en base salen del linescore; sin él, del seguimiento de corredores: tienen que dar lo mismo.
    const mo2 = C.moments(done, -1, done.length - 1, null, o);
    ok(deep(mo, mo2), `${tag} los ${mo.filter(m => m.type === 'fin').length} finales de media entrada dan lo mismo con y sin linescore (dejados en base incluidos)`);
    const def = C.defenseAt(fd, done.length - 1), LD = L2.defense;
    const off = Object.keys(def).filter(key => !def[key] || !LD[key] || def[key].id !== LD[key].id);
    ok(!off.length, `${tag} defenseAt de la última jugada = linescore.defense del final` + (off.length ? ' — difieren: ' + off.join(', ') : ''));
    const zb = C.zoneBox(done);
    ok(zb.fromGame && zb.x0 < zb.x1 && zb.y0 < zb.y1 && zb.inPlayUnreliable === (pk === '838798'),
      `${tag} zona de strike ${zb.x0}-${zb.x1} × ${zb.y0}-${zb.y1}${zb.inPlayUnreliable ? ', lo puesto en juego marcado al centro' : ''}`);
  }
  // casos reales a mitad de turno
  const sx = (pk, k, p) => C.stateAtPitch(D2[pk], k, p);
  const at = (s, i) => (s.bases[i] ? s.bases[i].fullName : '-');
  ok(at(sx(829812, 64, 1), 0) === 'Jermaine Palacios' && at(sx(829812, 64, 2), 1) === 'Jermaine Palacios' && !sx(829812, 64, 2).bases[0] && sx(829812, 64, 2).balls === 1,
    '829812 #64: Palacios pasa a 2.ª con el wild pitch del 3.er lanzamiento (1-2)');
  ok(at(sx(829812, 3, 2), 0) === 'Lorenzo Cedrola' && at(sx(829812, 3, 3), 1) === 'Lorenzo Cedrola' && /roba/.test(sx(829812, 3, 3).desc),
    '829812 #3: Cedrola se roba la 2.ª en el 3-1');
  ok(sx(829812, 27, 1).outs === 3 && C.pitchSeq(D2[829812][27])[0].label === 'Bola automática (reloj)' && C.pitchSeq(D2[829812][27])[0].auto,
    '829812 #27: "Bola automática (reloj)" (sin lanzamiento) y atrapado robando para el 3.er out');
  ok(at(sx(829756, 78, -1), 1) === 'Luis Suisbel' && sx(829756, 78, -1).outs === 0 && sx(829756, 78, -1).p === -1,
    '829756 #78: en el 10.º, Suisbel arranca en 2.ª antes del primer lanzamiento');
  const ibb = C.pitchSeq(D2[829756][90]);
  ok(ibb.length === 4 && ibb.every(s => s.auto && s.x == null && s.label === 'Bola intencional') && ibb[3].balls === 4, '829756 #90: boleto intencional = 4 bolas automáticas sin ubicación');
  const d68 = C.defenseAt(F2[838798], 68), d59 = C.defenseAt(F2[838798], 59);
  ok(d59.center.fullName === 'Angel Reyes' && d59.first.fullName === 'Eliezer Alfonzo' && d68.center.fullName === 'Jose Cordoba' && d68.right.fullName === 'Angel Reyes' && d68.first.fullName === 'Renato Núñez',
    '838798: tras el corredor emergente, Cordoba al center, Reyes al right y Núñez a 1.ª (defenseAt 59 → 68)');
  const g47 = await get('/api/v1.1/game/829747/feed/live?fields=liveData,plays,allPlays,about,inning,isTopInning,isComplete,result,awayScore,homeScore,eventType,runners,credits,credit,player,id,details,playIndex,playEvents,index,linescore,teams,away,home,runs,hits,errors');
  const d47 = g47.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete), s47 = C.stateAt(d47, d47.length - 1), L47 = g47.liveData.linescore.teams;
  ok(s47.tot.away.e === L47.away.errors && s47.tot.home.e === L47.home.errors && L47.away.errors === 2,
    `829747: el elevado de foul que se le cae al receptor cuenta como error en la repetición (${s47.tot.away.e}-${s47.tot.home.e})`);
  const pi = C.pitchIndex(D2[838798]);
  ok(pi.steps.length === D2[838798].reduce((a, q) => a + Math.max(1, C.pitchSeq(q).length), 0) && pi.first.length === D2[838798].length && deep(pi.steps[pi.first[5]], { k: 5, p: 0 }),
    `pitchIndex: ${pi.steps.length} pasos de repetición para ${D2[838798].length} jugadas`);

  console.log('\nVigilancia en vivo (838798 tal como estaba en dos momentos, con ?timecode=)');
  require('../js/api.js');
  const WF = globalThis.PC.api.WATCH_FIELDS;
  for (const tc of ['20260203_005420', '20260203_030523']) {
    const lite = await get(`/api/v1.1/game/838798/feed/live?language=es&timecode=${tc}&fields=${WF}`);
    const full = await get(`/api/v1.1/game/838798/feed/live?language=es&timecode=${tc}`);
    const a = C.pitchSeq(full.liveData.plays.currentPlay), b = C.pitchSeq(lite.liveData.plays.currentPlay);
    const ld = lite.liveData.linescore;
    ok(b.length > 0 && deep(a, b) && ['pitcher', 'catcher', 'first', 'second', 'third', 'shortstop', 'left', 'center', 'right'].every(key => ld.defense[key] && ld.defense[key].fullName) &&
      ld.offense.onDeck && ld.offense.inHole && lite.liveData.plays.currentPlay.matchup.batSide.code,
    `${tc}: pitchSeq igual con el turno recortado que con el completo (${b.map(s => s.code).join(' ')}), defensa completa y quién viene`);
  }

  console.log('\nBateador contra lanzador');
  const vsRaw = await get('/api/v1/people/672779/stats?stats=vsPlayer&opposingPlayerId=605636&sportId=17&group=hitting');
  const vs = C.vsLine(vsRaw), vt = vsRaw.stats.find(s => s.type.displayName === 'vsPlayerTotal').splits[0].stat;
  ok(vs && vs.pa === vt.plateAppearances && vs.h === vt.hits && vs.hr === vt.homeRuns && near(vs.avg, +vt.avg, 0.0006) && near(vs.ops, +vt.ops, 0.0011),
    `Marcano vs. Centeno: ${vs && `${vs.h}-${vs.ab}, ${vs.hr} HR, ${vs.pa} turnos`} (AVE y OPS = API)`);
  const vsAll = await get('/api/v1/people/672779/stats?stats=vsPlayer&opposingPlayerId=692637&sportId=17&group=hitting&gameType=R,F,D,L,W');
  const va = C.vsLine(vsAll), vrows = vsAll.stats.find(s => s.type.displayName === 'vsPlayerTotal').splits;
  ok(vrows.length > 1 && va.pa === vrows.reduce((a, s) => a + s.stat.plateAppearances, 0) && va.d === vrows.reduce((a, s) => a + s.stat.doubles, 0),
    `Marcano vs. Perrone en todas las fases (${vrows.map(s => s.gameType).join(', ')}): suma las filas → ${va.h}-${va.ab}, ${va.pa} turnos`);
  ok(C.vsLine(await get('/api/v1/people/672779/stats?stats=vsPlayer&opposingPlayerId=999999&sportId=17&group=hitting')) === null, 'sin enfrentamientos → null');

  console.log('\nCorrecciones de la revisión (M1 a M5)');
  // M1: relevo y emergente a mitad de turno
  const g46 = await get('/api/v1.1/game/829946/feed/live?language=es'), g50 = await get('/api/v1.1/game/829950/feed/live?language=es');
  const d46 = g46.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete), d50 = g50.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete);
  const at69 = p => C.stateAtPitch(d46, 68, p), c69 = C.moments(d46, 67, 68, null).filter(m => m.type === 'cambio');
  ok(C.pitchSeq(d46[68]).map(s => s.pitcherId).join() === '677868,677868,677868,677868,677868,514981' && at69(3).pitcher.fullName === 'Francis Peguero' &&
    at69(4).pitcher.fullName === 'Diego Moreno' && C.defenseAt(g46, 68, at69(3).lim).pitcher.fullName === 'Francis Peguero' &&
    C.defenseAt(g46, 68, at69(4).lim).pitcher.fullName === 'Diego Moreno' && c69.map(m => m.ix).join() === '0,6' && c69[1].ix < at69(4).lim && !(c69[1].ix < at69(3).lim),
  '829946, jugada 69: 5 lanzamientos de Peguero y después Moreno (pitchSeq, stateAtPitch, defenseAt con lim y el ix de los dos cambios)');
  const at36 = p => C.stateAtPitch(d50, 35, p);
  ok(at36(2).batter.fullName === 'Eduardo Garcia' && at36(3).batter.fullName === 'César Izturis Jr.' && C.pitchSeq(d50[35]).map(s => s.batterId).join() === ',,,,672544',
    '829950, jugada 36: batea García y, desde que entra el emergente en 3-1, Izturis Jr.');
  const boxPit = (fd, done) => {
    const cnt = new Map(), STR = new Set(['cantado', 'tirandole', 'foul', 'enjuego']);
    done.forEach((q, k) => {
      const start = C.stateAtPitch(done, k, -1).pitcher;
      for (const s of C.pitchSeq(q)) {
        if (s.auto) continue;
        const id = s.pitcherId != null ? s.pitcherId : start && start.id, c = cnt.get(id) || { n: 0, s: 0 };
        c.n++; if (STR.has(s.call)) c.s++; cnt.set(id, c);
      }
    });
    const bx = fd.liveData.boxscore.teams, r = [0, 0];
    for (const sd of ['away', 'home']) for (const id of bx[sd].pitchers) {
      const b = bx[sd].players['ID' + id].stats.pitching, c = cnt.get(id) || { n: 0, s: 0 };
      r[1]++; if (c.n === b.numberOfPitches && c.s === b.strikes) r[0]++;
    }
    return r;
  };
  const bp = [[g46, d46], [g50, d50], [F2[838798], D2[838798]], [F2[829812], D2[829812]], [F2[829756], D2[829756]]].map(([fd, d]) => boxPit(fd, d));
  ok(bp.every(([a, b]) => a === b), `lanzamientos y strikes de cada lanzador (pitcherId, o el que empezó el turno) = box score: ${bp.reduce((a, x) => a + x[0], 0)} de ${bp.reduce((a, x) => a + x[1], 0)} en 5 juegos`);
  ok(C.stateAtPitch(d46, 64, 0).bases[0].fullName === 'Leobaldo Cabrera', '829946, jugada 65: el corredor emergente sale con su nombre (de la descripción del cambio)');
  // M2: quién impulsó
  const t19 = C.moments(D2[838798], 17, 18, F2[838798].liveData.linescore, { away: 'MAG', home: 'ORI' }).find(m => m.type === 'carrera');
  ok(t19 && t19.text === 'Valera, rolata al campocorto; anota Rodriguez por error del inicialista', `838798, jugada 19: "${t19 && t19.text}"`);
  const tc50 = await get('/api/v1.1/game/829950/feed/live?language=es&timecode=20251023_010347');
  const dd50 = tc50.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete), open50 = dd50.concat([tc50.liveData.plays.currentPlay]);
  const kb = d50.findIndex(q => q.about.atBatIndex === 38);
  const tLive = C.moments(open50, dd50.length - 1, open50.length - 1, tc50.liveData.linescore).map(m => m.text);
  const tRep = C.moments(d50, kb - 1, kb, g50.liveData.linescore).filter(m => m.type === 'carrera').map(m => m.text);
  ok(tLive.join() === 'Balk; anota Quevedo' && tRep.join() === 'Balk; anota Quevedo', `829950 a las 01:03:47 (turno sin terminar) y en la repetición: "${tLive.join()}"`);
  // M4: juegos sin lanzamiento a lanzamiento
  const PF = 'liveData,plays,allPlays,about,isComplete,playEvents,isPitch,details,code';
  const doneOf = async pk => (await get(`/api/v1.1/game/${pk}/feed/live?fields=${PF}`)).liveData.plays.allPlays.filter(p => p.about && p.about.isComplete);
  const viejos = [await doneOf(289404), await doneOf(416644)].map(C.pitchDataOk);
  const nuevos = [D2[838798], D2[829812], D2[829756], d46, d50];
  for (const pk of [829863, 829776, 829893, 829755, 829922, 829842, 829754, 829833]) nuevos.push(await doneOf(pk));
  ok(viejos.every(x => x === false) && nuevos.every(C.pitchDataOk), `pitchDataOk: false en 289404 (2010) y 416644 (2014), true en los ${nuevos.length} juegos 2025-26 de la revisión`);
  // M5: la interferencia del receptor es error
  const g55 = await get('/api/v1.1/game/829755/feed/live?fields=liveData,plays,allPlays,about,inning,isTopInning,isComplete,result,awayScore,homeScore,eventType,runners,credits,credit,player,id,details,playIndex,playEvents,index,linescore,teams,away,home,runs,hits,errors');
  const d55 = g55.liveData.plays.allPlays.filter(p => p.about && p.about.isComplete), s55 = C.stateAt(d55, d55.length - 1), L55 = g55.liveData.linescore.teams;
  ok(s55.tot.home.e === L55.home.errors && s55.tot.away.e === L55.away.errors && C.stateAt(d55, 30).tot.home.e === 1,
    `829755, jugada 31: la interferencia del receptor cuenta como error (E ${s55.tot.away.e}-${s55.tot.home.e}, igual que la API)`);
  // M5: la vigilancia no ocupa uno de los 3 lugares de juego completo en la memoria de api.js (fetch falso, sin red)
  const realFetch = globalThis.fetch, pedidos = [];
  globalThis.fetch = async url => { pedidos.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }; };
  try {
    const A = globalThis.PC.api;
    await A.feed(1); await A.feed(2); await A.feed(3); await A.watch(10); await A.watch(11);
    const n0 = pedidos.length;
    await A.feed(1); await A.feed(2); await A.feed(3);
    ok(pedidos.length === n0, 'con 2 juegos vigilados siguen 3 juegos completos en memoria (no se vuelven a bajar)');
  } finally { globalThis.fetch = realFetch; }

  console.log(fails ? `\n${fails} FALLAS` : '\nTodo bien.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
