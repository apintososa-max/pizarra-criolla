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
// las carreras por inning de una temporada (los mismos campos que API.teamInnings)
const INN = 'dates,games,gamePk,gameType,officialDate,gameDate,status,abstractGameState,codedGameState,detailedState,teams,away,home,team,id,score,isWinner,linescore,innings,num,runs';

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

  console.log('\nFase 3 con datos armados (sin red)');
  const tryP = (doc, ops) => { try { return C.applyPatch(doc, ops); } catch (e) { return e; } };
  const err = x => x instanceof Error;
  ok(deep(C.applyPatch({ a: 1, l: ['x', 'z'] }, [{ op: 'add', path: '/b', value: 2 }, { op: 'add', path: '/l/1', value: 'y' }, { op: 'add', path: '/l/-', value: 'w' }]), { a: 1, l: ['x', 'y', 'z', 'w'], b: 2 }) &&
    deep(C.applyPatch({ a: 1, b: [1, 2, 3] }, [{ op: 'remove', path: '/a' }, { op: 'remove', path: '/b/1' }]), { b: [1, 3] }) &&
    deep(C.applyPatch({ a: { b: 1 } }, [{ op: 'replace', path: '/a/b', value: { c: [5] } }]), { a: { b: { c: [5] } } }) &&
    deep(C.applyPatch({ l: ['a', 'b', 'c', 'd'] }, [{ op: 'move', from: '/l/1', path: '/l/3' }]), { l: ['a', 'c', 'd', 'b'] }) &&
    deep(C.applyPatch({ a: { x: 1 }, b: {} }, [{ op: 'copy', from: '/a', path: '/b/y' }]), { a: { x: 1 }, b: { y: { x: 1 } } }) &&
    deep(C.applyPatch({ 'a/b': { '~c': 1 } }, [{ op: 'test', path: '/a~1b/~0c', value: 1 }]), { 'a/b': { '~c': 1 } }),
  'applyPatch: add (objeto, posición y "-"), remove, replace, move en una lista, copy y test con ~1 y ~0');
  ok([[{ a: 1 }, [{ op: 'replace', path: '/b', value: 1 }]], [{ a: [1] }, [{ op: 'add', path: '/a/2', value: 1 }]], [{ a: [1] }, [{ op: 'remove', path: '/a/01' }]],
    [{ a: 1 }, [{ op: 'test', path: '/a', value: '1' }]], [{ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b/c' }]], [{ a: 1 }, [{ op: 'otra', path: '/a' }]],
    [{ a: 1 }, [{ op: 'add', path: '/x' }]], [{ a: 1 }, [{ op: 'add', path: 'x', value: 1 }]], [{}, [{ op: 'add', path: '/__proto__/x', value: 1 }]], [{ a: 1 }, null]
  ].every(([d, o]) => err(tryP(d, o))) && ({}).x === undefined, 'applyPatch: lanza error si una operación no aplica (ruta o posición que no existe, test distinto, sin value, __proto__)');
  // el mismo objeto; lo que cambió es nuevo (lo de antes queda como estaba) y lo demás conserva su identidad
  const pl0 = { ev: [1] }, pl1 = { ev: [1] }, doc3 = { meta: { t: 1 }, plays: [pl0, pl1], box: { a: 1 } }, box3 = doc3.box;
  const res3 = C.applyPatch(doc3, [{ op: 'add', path: '/plays/1/ev/-', value: 2 }, { op: 'replace', path: '/meta/t', value: 2 }]);
  // si una falla, o check da false, no toca nada
  const doc4 = { a: 1, b: [1] }, snap4 = JSON.stringify(doc4);
  const e4 = tryP(doc4, [{ op: 'replace', path: '/a', value: 5 }, { op: 'remove', path: '/zz' }]);
  let e5 = null;
  try { C.applyPatch(doc4, [{ op: 'replace', path: '/a', value: 5 }], { check: d => d.a === 1 }); } catch (e) { e5 = e; }
  // el valor del parche no queda compartido con el documento
  const ops6 = [{ op: 'add', path: '/x', value: { k: [1] } }], doc6 = C.applyPatch({}, ops6);
  doc6.x.k.push(2);
  ok(res3 === doc3 && doc3.box === box3 && doc3.plays[0] === pl0 && doc3.plays[1] !== pl1 && deep(pl1.ev, [1]) && deep(doc3.plays[1].ev, [1, 2]) && doc3.meta.t === 2 &&
    err(e4) && err(e5) && JSON.stringify(doc4) === snap4 && deep(ops6[0].value.k, [1]),
  'applyPatch: el mismo objeto, lo que cambió es nuevo y lo demás conserva su identidad; si falla (o check da false) no toca nada; el valor no queda compartido');
  ok(C.norm('José A. Núñez Jr.') === 'jose a nunez jr' && C.norm('PEÑA') === 'pena' && C.norm("O'Neil Güémez-Díaz") === 'oneil guemez diaz' && C.norm(null) === '',
    'norm: minúsculas, sin tildes ni diéresis, ñ → n, sin puntos ni apóstrofos ("José A. Núñez Jr." → "jose a nunez jr")');
  const PL = [{ fullName: 'José Altuve', lastName: 'Altuve', pa: 30 }, { fullName: 'Renato Núñez', lastName: 'Núñez', pa: 239 }, { fullName: 'Darien Núñez', lastName: 'Núñez', bf: 31 },
    { fullName: 'Wladimir Peña', pa: 5 }, { fullName: 'Jose Martinez', lastName: 'Martinez', pa: 208 }, { fullName: 'José A. Martínez', lastName: 'Martínez', pa: 171 },
    { fullName: 'Alberth Martinez', lastName: 'Martinez', pa: 154 }, { fullName: 'Jesús Rodríguez', lastName: 'Rodríguez', pa: 99 }, { fullName: 'Ronald Acuña Jr.', lastName: 'Acuña', pa: 71 }, { fullName: 'Robert Pérez', pa: 300 }];
  const sN = (q, n) => C.searchPlayers(PL, q, n).map(p => p.fullName).join(', ');
  ok(sN('jose') === 'Jose Martinez, José A. Martínez, José Altuve' && sN('ro') === 'Jesús Rodríguez, Robert Pérez, Ronald Acuña Jr.' && sN('nunez') === 'Renato Núñez, Darien Núñez' && sN('núñez') === sN('NUÑEZ') && sN('núñez') === sN('nunez') &&
    sN('pena') === 'Wladimir Peña' && sN('mart', 2) === 'Jose Martinez, José A. Martínez' && sN('martinez jose') === 'Jose Martinez, José A. Martínez' && sN('acuna jr') === 'Ronald Acuña Jr.' &&
    sN('dl') === '' && sN('') === '' && sN('  .  ') === '' && sN('(') === '' && C.searchPlayers(null, 'jose').length === 0 && C.searchPlayers(PL, 'a', 3).length === 3,
  `searchPlayers: "jose" → José, "nunez"/"núñez" → Núñez, "pena" → Peña, "dl" → nada; apellido primero, luego nombre, y por tiempo de juego ("ro" → ${sN('ro')})`);
  // últimos 10 con datos armados: sin repetir gamePk, sin juegos sin ganador ni sin terminar, del más viejo al más nuevo
  const gm = (pk, ts, h, a, hs, as, st) => ({ pk, ts, date: new Date(ts).toISOString().slice(0, 10), type: 'R', status: st || 'final', home: { id: h, score: hs, win: st ? false : hs > as }, away: { id: a, score: as, win: st ? false : as > hs } });
  const G10 = [gm(5, 5e11, 1, 2, 3, 1), gm(1, 1e11, 2, 1, 4, 2), gm(3, 3e11, 1, 3, 0, 5), gm(3, 3e11 - 1, 1, 3, 0, 5), gm(4, 4e11, 3, 1, 2, 2, 'final'), gm(6, 6e11, 1, 2, 0, 0, 'pre')];
  G10[4].home.win = G10[4].away.win = false; // empate
  const lr = C.lastResults(G10, 1, 10);
  ok(lr.map(x => x.pk).join() === '1,3,5' && deep(lr[0], { pk: 1, date: G10[1].date, win: false, rs: 2, ra: 4, vs: 2, home: false }) && lr[2].win && lr[2].home && C.lastResults(G10, 1, 2).map(x => x.pk).join() === '3,5' && !C.lastResults(G10, 9).length,
    'lastResults: solo terminados con ganador, sin repetir gamePk, del más viejo al más nuevo, los últimos n');
  // API.players con respuestas armadas (fetch falso, sin red): une las fases, el equipo de la última, los lanzadores sin turnos no batean
  require('../js/api.js');
  globalThis.PC.calc = C;
  const API = globalThis.PC.api;
  const spl = (id, name, last, team, pos, st) => ({ player: { id, fullName: name, lastName: last }, team: { id: team }, position: { abbreviation: pos }, stat: st });
  const FAKE = {
    'hitting R': [spl(1, 'Renato Núñez', 'Núñez', 696, '1B', { plateAppearances: 200 }), spl(2, 'Keyshawn Askew', 'Askew', 696, 'P', { plateAppearances: 0 }), spl(3, 'Jose Cordoba', 'Cordoba', 692, 'X', { plateAppearances: 0 }), spl(4, 'Sandy León', 'León', 695, 'C', { plateAppearances: 130 })],
    'pitching R': [spl(2, 'Keyshawn Askew', 'Askew', 696, 'P', { battersFaced: 30 }), spl(4, 'Sandy León', 'León', 695, 'P', { battersFaced: 7 })],
    'hitting L': [spl(1, 'Renato Núñez', 'Núñez', 693, '1B', { plateAppearances: 39 }), spl(5, 'Carlos Sepulveda', 'Sepulveda', 696, '2B', { plateAppearances: 37 })]
  };
  const realFetch0 = globalThis.fetch;
  globalThis.fetch = async url => {
    const m = /group=(\w+).*gameType=(\w)/.exec(url), list = m && FAKE[m[1] + ' ' + m[2]];
    return new Response(JSON.stringify({ stats: [{ splits: list || [] }] }), { status: 200 });
  };
  let PLs = [];
  try { PLs = await API.players(1999); } finally { globalThis.fetch = realFetch0; }
  const byId = id => PLs.find(p => p.id === id) || {};
  ok(PLs.length === 5 && byId(1).team === 696 && byId(1).pa === 239 && byId(1).grupo === 'bateo' && byId(1).pos === '1B' && byId(2).grupo === 'pitcheo' && byId(2).pos === 'P' &&
    byId(3).grupo === 'bateo' && byId(3).pos === '' && byId(4).grupo === 'ambos' && byId(4).pos === 'C' && byId(5).team === 696 && (await API.players(1999)) === PLs,
  'API.players: une ronda regular y playoffs (el equipo de la ronda regular, no el del refuerzo; PA sumados), lanzador sin turnos = pitcheo, posición X = "", la misma lista si nada cambió');
  // Consultas lentas del servidor (statsRange, players, teamInnings): plazo de 60 s, y si fallan o se cortan, API.status
  // no cambia (ni "Sin conexión" ni fallas). Sin quiet, el mismo corte sí cuenta. Con fetch y setTimeout falsos, sin red.
  const realST = globalThis.setTimeout, plazos = [];
  globalThis.setTimeout = (f, ms, ...a) => { plazos.push(ms); return realST(f, ms, ...a); };
  const stA = API.status, st0 = { online: stA.online, fails: stA.fails, lastError: stA.lastError };
  const sameSt = () => stA.online === st0.online && stA.fails === st0.fails && stA.lastError === st0.lastError;
  const fails0 = [];
  let quietOk = false, cutQ = null, cutN = null, onlineN = null;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    for (const f of [() => API.statsRange({ group: 'hitting', from: '1998-12-01', to: '1998-12-14', season: 1998 }), () => API.players(1998), () => API.teamInnings(695, 1998)]) {
      try { await f(); fails0.push('no falló'); } catch (e) { fails0.push(e.name); }
    }
    quietOk = sameSt() && plazos.filter(ms => ms === 60e3).length === 10 && !plazos.some(ms => ms === 10e3 || ms === 20e3);
    // corte por tiempo (plazo corto): con quiet no cambia nada; sin quiet, "Sin conexión"
    globalThis.fetch = (url, o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abortado'), { name: 'AbortError' }))));
    try { await API.get('/api/v1/lento?q=1', { timeout: 30, quiet: true }); } catch (e) { cutQ = e.name + (sameSt() ? ' y status igual' : ' y status CAMBIÓ'); }
    try { await API.get('/api/v1/lento?q=2', { timeout: 30 }); } catch (e) { cutN = e.name; onlineN = stA.online; }
  } finally {
    globalThis.fetch = realFetch0;
    globalThis.setTimeout = realST;
    Object.assign(stA, st0); // lo de la prueba sin quiet no queda para las demás
  }
  ok(quietOk && fails0.join() === 'TypeError,TypeError,TypeError' && cutQ === 'AbortError y status igual' && cutN === 'AbortError' && onlineN === false,
    `statsRange, players y teamInnings: plazo de 60 s en sus 10 consultas y, al fallar, API.status igual; corte con quiet: ${cutQ}; sin quiet: sin conexión`);

  console.log('\nTabla calculada vs. tabla oficial, varias temporadas (incluye suspendidos que se terminaron otro día)');
  const T3 = {}; // 2024-25 y 2025-26, para las pruebas de la Fase 3
  for (const season of [2016, 2022, 2023, 2024, 2025]) {
    const sched = await get(`/api/v1/schedule?sportId=17&leagueId=135&season=${season}&gameType=R&hydrate=linescore&fields=${FIELDS}`);
    const all = C.flatSchedule(sched, true), games = C.flatSchedule(sched);
    const finals = games.filter(g => g.status === 'final');
    ok(new Set(finals.map(g => g.pk)).size === finals.length, `${season}: ningún juego repetido (${all.length} apariciones → ${games.length} juegos)`);
    const rows = C.standings(games.filter(g => LVBP.indexOf(g.away.id) >= 0 && LVBP.indexOf(g.home.id) >= 0), LVBP);
    const off = (await get(`/api/v1/standings?leagueId=135&season=${season}&standingsTypes=regularSeason`)).records.flatMap(r => r.teamRecords);
    const bad = off.filter(o => { const m = rows.find(r => r.id === o.team.id); return !m || m.W !== o.wins || m.L !== o.losses || m.RS !== o.runsScored || m.RA !== o.runsAllowed; });
    ok(!bad.length, `${season}: ${off.length} equipos con récord y carreras iguales a la tabla oficial` + (bad.length ? ' — difieren: ' + bad.map(o => o.team.name).join(', ') : ''));
    if (season >= 2024) T3[season] = { games, rows, off };
  }

  console.log('\nFase 3: la temporada fecha por fecha, últimos 10 y carreras por inning (2024-25 y 2025-26)');
  for (const season of [2024, 2025]) {
    const { games, rows, off } = T3[season];
    const sb = C.standingsByDate(games, LVBP, { fase: 'R' }), n = sb.dates.length;
    const lastOf = id => sb.teams[id][n - 1];
    ok(n > 60 && LVBP.every(id => sb.teams[id].length === n) && sb.dates.every((d, i) => new Set(LVBP.map(id => sb.teams[id][i].pos)).size === 8) &&
      rows.every(r => { const x = lastOf(r.id); return x.date === sb.dates[n - 1] && x.pos === r.pos && x.w === r.W && x.l === r.L && x.gb === r.GB && near(x.pct, r.PCT, 1e-12); }) &&
      off.every(o => lastOf(o.team.id).w === o.wins && lastOf(o.team.id).l === o.losses),
    `${season}: standingsByDate, ${n} fechas (${sb.dates[0]} a ${sb.dates[n - 1]}); la última = C.standings = tabla oficial`);
    ok(rows.every(r => deep(C.lastResults(games, r.id, 10), r.log.slice(-10).map(g => ({ pk: g.pk, date: g.date, win: g.win, rs: g.rs, ra: g.ra, vs: g.opp, home: g.home })))),
      `${season}: lastResults = los últimos 10 del registro de C.standings en los 8 equipos`);
    const inn = C.flatSchedule(await get(`/api/v1/schedule?sportId=17&leagueId=135&season=${season}&gameType=R&hydrate=linescore&fields=${INN}`));
    const badR = off.filter(o => {
      const r = C.runsByInning(inn, o.team.id), sum = a => a.reduce((s, x) => s + x.runs, 0);
      return !(r.n === o.wins + o.losses && sum(r.scored) === o.runsScored && sum(r.allowed) === o.runsAllowed && r.scored.length === 10 && near(r.scored[0].avg, r.scored[0].runs / r.n, 1e-12));
    });
    const lgI = C.runsByInningLeague(inn), totR = off.reduce((s, o) => s + o.runsScored, 0);
    ok(!badR.length && lgI.n === inn.filter(g => g.status === 'final').length * 2 && lgI.scored.reduce((s, x) => s + x.runs, 0) === totR,
      `${season}: runsByInning suma las carreras anotadas y permitidas de la tabla oficial en los 8 equipos; la liga, ${totR} carreras en ${lgI.n / 2} juegos` + (badR.length ? ' — difieren: ' + badR.map(o => o.team.name).join(', ') : ''));
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

  console.log('\nFase 3: el juego en vivo con diffPatch (momentos reales, con endTimecode)');
  // Juego completo en t0 + diffPatch(t0 → t1) = juego completo en t1, exacto. 838798: entra un relevista al empezar la baja
  // del 9.º (173 operaciones: move, remove, copy...); 829756: arranca el 10.º con el corredor en 2.ª y otro lanzador.
  const ES = '/feed/live?language=es';
  for (const [pk, t0, t1] of [[838798, '20260203_030025', '20260203_030136'], [829756, '20251019_022301', '20251019_022419']]) {
    const a = await get(`/api/v1.1/game/${pk}${ES}&timecode=${t0}`), b = await get(`/api/v1.1/game/${pk}${ES}&timecode=${t1}`);
    const dr = await fetch(`${B}/api/v1.1/game/${pk}/feed/live/diffPatch?language=es&startTimecode=${t0}&endTimecode=${t1}`);
    const dtxt = await dr.text(), d = JSON.parse(dtxt), ops = [].concat(...d.map(x => x.diff));
    const plays0 = a.liveData.plays.allPlays, first0 = plays0[0];
    const r = C.applyPatch(a, ops);
    ok(r === a && C.sameJSON(a, b) && a.liveData.plays.allPlays[0] === first0 && dr.headers.get('access-control-allow-origin') === '*',
      `${pk} ${t0} → ${t1}: el juego de antes + ${ops.length} operaciones = el juego de después, exacto (CORS: *)`);
    // feedPatch de punta a punta con un fetch falso que sirve esa misma respuesta: modo diff, el mismo objeto
    const a2 = await get(`/api/v1.1/game/${pk}${ES}&timecode=${t0}`);
    const realFetch1 = globalThis.fetch, asked = [];
    globalThis.fetch = async url => { asked.push(url); return new Response(/diffPatch/.test(url) ? dtxt : '{}', { status: 200 }); };
    let fp;
    try { fp = await API.feedPatch(pk, a2, { resync: false }); } finally { globalThis.fetch = realFetch1; }
    ok(fp.modo === 'diff' && fp.feed === a2 && C.sameJSON(a2, b) && fp.bytes === Buffer.byteLength(dtxt) && asked.length === 1 && asked[0].indexOf(`startTimecode=${t0}`) > 0 && /language=es/.test(asked[0]),
      `${pk}: API.feedPatch → 'diff', el mismo objeto, igual al de después (${fp.bytes} bytes sin comprimir)`);
  }
  // casos raros, sin red: sin cambios, parche que no aplica (se baja el completo y lo de antes queda intacto), juego entero, sin señal
  const antes = await get(`/api/v1.1/game/838798${ES}&timecode=20260203_030025`), despues = await get(`/api/v1.1/game/838798${ES}&timecode=20260203_030136`);
  const serve = async (body, f) => {
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async url => (typeof body === 'function' ? body(url) : new Response(/diffPatch/.test(url) ? body : JSON.stringify(despues), { status: 200 }));
    try { return await API.feedPatch(838798, f, { resync: false }); } catch (e) { return e; } finally { globalThis.fetch = realFetch2; }
  };
  const copyB = () => JSON.parse(JSON.stringify(antes));
  const fA = copyB(), rA = await serve('[]', fA);
  const fB = copyB(), snapB = JSON.stringify(fB), rB = await serve('[{"diff":[{"op":"replace","path":"/liveData/plays/allPlays/999/about","value":1}]}]', fB);
  const fC = copyB(), rC = await serve(JSON.stringify(despues), fC);
  const fD = copyB(), snapD = JSON.stringify(fD), rD = await serve(() => { throw new TypeError('Failed to fetch'); }, fD);
  const fE = copyB(), rE = await serve(url => new Response(/diffPatch/.test(url) ? 'error' : JSON.stringify(despues), { status: /diffPatch/.test(url) ? 500 : 200 }), fE);
  ok(rA.modo === 'igual' && rA.feed === fA && rB.modo === 'completo' && rB.feed !== fB && JSON.stringify(fB) === snapB && C.sameJSON(rB.feed, despues) &&
    rC.modo === 'completo' && C.sameJSON(rC.feed, despues) && err(rD) && JSON.stringify(fD) === snapD && rE.modo === 'completo',
  'feedPatch: sin cambios → igual; parche que no aplica → completo y lo de antes intacto; juego entero → completo; error 500 → completo; sin señal → error');
  // juego en Final: no se pide diffPatch (el servidor manda el juego entero cada vez): la vigilancia dice si cambió algo
  const asked2 = [];
  const rF = await serve(url => { asked2.push(url); return new Response(JSON.stringify(despues), { status: 200 }); }, Object.assign(copyB(), { gameData: Object.assign({}, antes.gameData, { status: { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' } }) }));
  ok(rF.modo === 'completo' && asked2.length === 2 && /fields=/.test(asked2[0]) && !asked2.some(u => /diffPatch/.test(u)),
    'feedPatch en Final: no pide diffPatch; con la vigilancia distinta baja el juego completo');
  // El resincronizado (M1), con un juego armado a mano y un "servidor" falso, sin red: el flujo de diffPatch no trae una
  // corrección del anotador que /feed/live sí tiene (como en la AFL el 06/10). Reloj falso para los 40 min.
  const RS = { n: 2, inning: 1, state: 'I', fix: false, mode: '', stale: 0, last: null, diff: 0, live: 0, watch: 0 };
  const tsOf = n => '20261006_' + String(200000 + n * 10);
  const juego = (pk, fix) => {
    const plays = [];
    for (let i = 0; i < RS.n; i++) plays.push({ about: { atBatIndex: i, inning: RS.inning, isComplete: true }, result: { description: 'jugada ' + i } });
    if (fix) plays[0].result.description = 'jugada 0, corregida por el anotador';
    const cp = JSON.parse(JSON.stringify(plays[plays.length - 1]));
    plays[plays.length - 1].matchup = { batterHotColdZoneStats: { zona: 'tibia' } }; // como en la MLB: distintas en las dos
    cp.matchup = { batterHotColdZoneStats: { zona: 'fría' } };
    const fin = RS.state === 'F';
    return { gamePk: pk, metaData: { timeStamp: tsOf(RS.n) }, gameData: { status: { abstractGameState: fin ? 'Final' : 'Live', codedGameState: fin ? 'F' : 'I', detailedState: fin ? 'Final' : 'In Progress' } },
      liveData: { plays: { allPlays: plays, currentPlay: cp }, linescore: { currentInning: RS.inning, teams: { away: { runs: RS.n, hits: 1, errors: 0 }, home: { runs: 0, hits: 0, errors: 0 } } } } };
  };
  const enVivo = pk => juego(pk, RS.fix); // /feed/live: con las correcciones
  const fakeRS = async url => {
    const pk = +/game\/(\d+)\//.exec(url)[1], res = txt => new Response(txt, { status: 200 });
    if (/diffPatch/.test(url)) {
      RS.diff++;
      const start = /startTimecode=(\d+_\d+)/.exec(url)[1], g = juego(pk, false); // el flujo: sin las correcciones
      if (RS.mode === 'repetido' && RS.last) return res(RS.last);
      if (RS.mode === 'completo') return res(JSON.stringify(g));
      if (start === g.metaData.timeStamp) return res('[]');
      RS.last = JSON.stringify([{ diff: ['metaData', 'gameData', 'liveData'].map(k => ({ op: 'replace', path: '/' + k, value: g[k] })) }]);
      return res(RS.last);
    }
    if (/fields=/.test(url)) { RS.watch++; return res(JSON.stringify(enVivo(pk))); }
    RS.live++;
    if (RS.stale > 0) { RS.stale--; const n0 = RS.n; RS.n = Math.max(1, n0 - 2); const viejo = enVivo(pk); RS.n = n0; return res(JSON.stringify(viejo)); }
    return res(JSON.stringify(enVivo(pk)));
  };
  const realFetch3 = globalThis.fetch, realNow = Date.now;
  let reloj = realNow();
  globalThis.fetch = fakeRS;
  Date.now = () => reloj;
  const pasos = [];
  // un paso: el servidor avanza (cambio), se llama a feedPatch y se anota qué pidió
  const paso = async (pk, f, cambio, o) => {
    if (cambio) cambio();
    const d0 = RS.diff, l0 = RS.live;
    const r = await API.feedPatch(pk, f, o);
    pasos.push({ modo: r.modo, sync: !!r.sync, diff: RS.diff - d0, live: RS.live - l0, fix: r.feed.liveData.plays.allPlays[0].result.description !== 'jugada 0', ts: r.feed.metaData.timeStamp });
    return r;
  };
  const P1 = 4242, P2 = 4243, P3 = 4244;
  let mA, mB, mC, mD, mE, mF, mG, mH;
  try {
    let f = enVivo(P1); // lo que bajó juego.js con API.feed
    f = (await paso(P1, f)).feed;                                         // 0: nada nuevo
    f = (await paso(P1, f, () => { RS.n = 3; RS.fix = true; })).feed;     // 1: diff; /feed/live ya tiene la corrección
    f = (await paso(P1, f, () => { RS.n = 4; RS.inning = 2; })).feed;     // 2: diff que abre el 2.º
    const r3 = await paso(P1, f, () => { RS.n = 5; });                   // 3: primer ciclo del 2.º → /feed/live
    mA = r3.modo === 'completo' && r3.sync && pasos[3].live === 1 && pasos[3].diff === 0 && C.sameJSON(r3.feed, enVivo(P1)) && pasos[1].modo === 'diff' && !pasos[1].fix && pasos[3].fix;
    f = r3.feed;
    f = (await paso(P1, f, () => { RS.n = 6; })).feed;                    // 4: mismo inning → diffPatch
    reloj += 30 * 60e3;
    f = (await paso(P1, f, () => { RS.n = 7; })).feed;                    // 5: ídem, a los 30 min: todavía no
    mB = pasos[4].modo === 'diff' && pasos[5].modo === 'diff' && pasos[4].live + pasos[5].live === 0;
    reloj += 10 * 60e3 + 1000;
    const r6 = await paso(P1, f, () => { RS.n = 8; });                   // 6: 40 min sin /feed/live → /feed/live
    mC = r6.sync && r6.modo === 'completo' && pasos[6].live === 1 && pasos[6].diff === 0;
    f = r6.feed;
    reloj += 25 * 60e3;
    const r7 = await paso(P1, f, () => { RS.n = 9; RS.mode = 'completo'; }); // 7: diffPatch manda el juego entero: no cuenta
    f = r7.feed;
    reloj += 16 * 60e3;
    const r8 = await paso(P1, f, () => { RS.n = 10; RS.mode = ''; });    // 8: 41 min desde el último /feed/live → /feed/live
    mD = r7.modo === 'completo' && !r7.sync && pasos[7].live === 0 && r8.sync && pasos[8].live === 1 && pasos[8].diff === 0;
    f = r8.feed;
    // /feed/live más viejo que el armado: no cuenta, el ciclo sigue con diffPatch y se reintenta (hasta 3 por inning)
    f = (await paso(P1, f, () => { RS.n = 11; RS.inning = 3; })).feed;    // 9: abre el 3.º
    for (let i = 0; i < 3; i++) f = (await paso(P1, f, () => { RS.n++; RS.stale = i < 2 ? 1 : 0; })).feed; // 10-12
    mE = pasos.slice(10, 12).every(x => x.modo === 'diff' && !x.sync && x.live === 1 && x.diff === 1) && pasos[12].sync && pasos[12].live === 1 && pasos[12].diff === 0;
    f = (await paso(P1, f, () => { RS.n++; RS.inning = 4; })).feed;       // 13: abre el 4.º
    for (let i = 0; i < 4; i++) f = (await paso(P1, f, () => { RS.n++; RS.stale = 1; })).feed; // 14-17: siempre viejo
    mF = pasos.slice(14, 17).every(x => x.live === 1 && x.diff === 1 && !x.sync) && pasos[17].live === 0 && pasos[17].diff === 1;
    // Final por un parche: en la misma llamada, /feed/live con la corrección
    const rG = await paso(P1, f, () => { RS.n++; RS.state = 'F'; RS.stale = 0; });
    const igualG = C.sameJSON(rG.feed, enVivo(P1));
    // Final por el completo de diffPatch (otro juego): ídem
    RS.state = 'I';
    let g2 = enVivo(P2);
    g2 = (await paso(P2, g2, () => { RS.n++; })).feed;
    const rH = await paso(P2, g2, () => { RS.n++; RS.state = 'F'; RS.mode = 'completo'; });
    const igualH = C.sameJSON(rH.feed, enVivo(P2));
    RS.mode = '';
    mG = rG.modo === 'completo' && rG.sync && pasos[18].live === 1 && pasos[18].diff === 1 && igualG && rG.feed.gameData.status.abstractGameState === 'Final' &&
      rH.modo === 'completo' && rH.sync && pasos[20].live === 1 && pasos[20].diff === 1 && pasos[20].fix && igualH;
    // M2: un parche repetido (la misma hora) no se aplica: se baja /feed/live. Y resync: false no resincroniza.
    RS.state = 'I';
    let g3 = enVivo(P3);
    g3 = (await paso(P3, g3, () => { RS.n++; })).feed;                     // 21: diff (queda guardado como el último)
    const rR = await paso(P3, g3, () => { RS.mode = 'repetido'; });        // 22: el mismo parche otra vez
    RS.mode = '';
    const rN = await paso(P3, rR.feed, () => { RS.n++; RS.inning = 9; }, { resync: false }); // 23: cambia el inning, sin resincronizar
    const rN2 = await paso(P3, rN.feed, () => { RS.n++; }, { resync: false });                // 24: ídem
    mH = pasos[21].modo === 'diff' && rR.modo === 'completo' && rR.sync && pasos[22].live === 1 && pasos[23].modo === 'diff' && pasos[24].modo === 'diff' && pasos[24].live === 0;
  } finally {
    globalThis.fetch = realFetch3;
    Date.now = realNow;
  }
  ok(mA, 'resincronizado: una corrección que diffPatch no trae llega en el primer ciclo del inning nuevo, con /feed/live en vez de diffPatch (sync)');
  ok(mB, 'resincronizado: uno solo por inning (los ciclos siguientes vuelven a diffPatch)');
  ok(mC, 'resincronizado: a los 40 min del último /feed/live, aunque no cambie el inning (a los 30, todavía no; reloj falso)');
  ok(mD, 'resincronizado: el juego completo que manda diffPatch no cuenta (a los 41 min del último /feed/live, igual se baja)');
  ok(mE && mF, '/feed/live más viejo que el armado: no cuenta, el ciclo sigue con diffPatch y se reintenta, hasta 3 veces por inning');
  ok(mG, 'al quedar en Final, por un parche o por el completo de diffPatch, en la misma llamada se baja /feed/live (con la corrección)');
  ok(mH, 'un parche repetido (la misma hora) no se aplica: baja /feed/live; con {resync: false} no se resincroniza');
  const zA = { a: 1, m: { batterHotColdZoneStats: { z: 1 } } }, zB = { a: 1, m: { batterHotColdZoneStats: { z: 2 } } }, zC = { a: 1, m: {} };
  ok(!C.sameJSON(zA, zB) && C.sameJSON(zA, zB, k => k.indexOf('HotColdZone') >= 0) && C.sameJSON(zA, zC, k => k.indexOf('HotColdZone') >= 0) && !C.sameJSON({ a: 1 }, { a: 2 }, () => false) && mA,
    'sameJSON con skip: sin las zonas del bateador (MLB); en el juego armado, currentPlay y la última jugada las traen distintas y los parches igual entran');
  // Un parche con una operación sobre las zonas del bateador que no cuadra (en la MLB vienen ordenadas distinto): entra sin
  // ella, sin bajar el juego entero.
  const P5 = 4245, g5 = juego(P5, false);
  RS.n++;
  const next5 = juego(P5, false);
  RS.n--;
  const ops5 = [{ op: 'replace', path: '/metaData', value: next5.metaData },
    { op: 'replace', path: '/liveData/plays/currentPlay/matchup/batterHotColdZoneStats/stats/0/splits/5/zona', value: 'caliente' }];
  let pedidos5 = [];
  globalThis.fetch = async url => { pedidos5.push(url); return new Response(/diffPatch/.test(url) ? JSON.stringify([{ diff: ops5 }]) : JSON.stringify(g5), { status: 200 }); };
  let r5;
  try { r5 = await API.feedPatch(P5, g5); } finally { globalThis.fetch = realFetch3; }
  ok(r5.modo === 'diff' && r5.feed === g5 && g5.metaData.timeStamp === next5.metaData.timeStamp && pedidos5.length === 1,
    'una operación sobre las zonas del bateador que no cuadra (MLB) se salta: el parche entra sin bajar el juego entero');
  // M4: las consultas de API.players no quedan como datos de la vista abierta (no la repintan); las demás con swr, sí
  const vistos = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ stats: [{ splits: [] }] }), { status: 200 });
  API.watcher = p => vistos.push(p);
  try { await API.players(1997); await API.statsRange({ group: 'hitting', from: '1997-11-01', to: '1997-11-14', season: 1997 }); } finally { API.watcher = null; globalThis.fetch = realFetch3; }
  ok(vistos.length === 1 && /byDateRange/.test(vistos[0]), 'API.players no anota sus 8 consultas en la vista abierta (watch: false); statsRange sí');

  console.log('\nFase 3: la forma reciente (stats=byDateRange con leagueId=135)');
  const g14 = T3[2025].games.filter(g => g.status === 'final' && g.date >= '2025-12-01' && g.date <= '2025-12-14');
  const runs14 = g14.reduce((s, g) => s + g.away.score + g.home.score, 0);
  const [h14, p14] = await Promise.all(['hitting', 'pitching'].map(group => API.statsRange({ group, from: '2025-12-01', to: '2025-12-14', season: 2025 })));
  const sp14 = h14.stats[0].splits, pp14 = p14.stats[0].splits;
  ok(sp14.concat(pp14).every(s => s.league.id === 135 && LVBP.includes(s.team.id)) && sp14.reduce((s, x) => s + x.stat.runs, 0) === runs14 &&
    pp14.reduce((s, x) => s + x.stat.runs, 0) === runs14 && pp14.reduce((s, x) => s + x.stat.gamesStarted, 0) === g14.length * 2,
  `statsRange del 1 al 14/12/2025: solo la LVBP, ${sp14.length} bateadores y ${pp14.length} lanzadores; las carreras suman las de los ${g14.length} juegos (${runs14})`);

  console.log(fails ? `\n${fails} FALLAS` : '\nTodo bien.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
