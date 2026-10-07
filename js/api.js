/* Pizarra Criolla · api.js
   Única puerta a los datos: la API pública de estadísticas de MLB (statsapi.mlb.com), que cubre la LVBP
   como liga 135 del deporte 17 (ligas invernales). Lee directo desde el teléfono; no hay servidor propio.
   Guarda copias en memoria y en el navegador para no repetir descargas y para mostrar algo sin señal.
   Cada respuesta lleva la hora en que se bajó (__t), para que la pantalla diga de cuándo es el dato.
   Lo que no es en vivo se sirve al instante desde la copia guardada (aunque esté vencida) y se pide la nueva
   en segundo plano; si llega distinta, avisa con el evento 'pc:datos' para que la vista abierta se repinte.
   Los cambios de conexión se avisan con 'pc:red'. */
(function (root) {
  'use strict';
  const BASE = 'https://statsapi.mlb.com';
  const SPORT = 17, LEAGUE = 135;
  const LS = 'pc1:';
  const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
  const MEM_MAX = 70, FEEDS_MAX = 3;
  // Lo que el servidor calcula al momento la primera vez que alguien lo pide (estadísticas por fechas, consultas con
  // fields propios): tarda 5-15 s y se midieron hasta 43 s. Plazo largo y sin tocar el aviso de conexión (get: quiet).
  const SLOW = { timeout: 60e3, quiet: true };

  const mem = new Map();
  const inflight = new Map();
  const playersMemo = new Map(); // API.players: la lista armada por temporada, mientras las respuestas sean las mismas
  const inningsMemo = new WeakMap(); // API.teamInnings: respuesta → juegos normalizados
  // API.feedPatch: por juego, cuándo y en qué inning se tuvo por última vez /feed/live de verdad (resincronizado).
  // pk → {at, inning, tries, tryInning}; los últimos 5 juegos.
  const synced = new Map();
  const SYNC_MS = 40 * MIN, SYNC_TRIES = 3, SYNC_MAX = 5;
  let forcing = 0; // > 0 mientras dura un "tirar para actualizar": todo se pide fresco
  const doneF = new Set(); // lo que ya se bajó fresco en este "tirar para actualizar": no se baja dos veces

  const stamp = (d, t) => {
    if (d && typeof d === 'object') { try { Object.defineProperty(d, '__t', { value: t, configurable: true }); } catch (e) { /* objeto congelado */ } }
    return d;
  };
  const emit = (name, detail) => {
    try { if (root.dispatchEvent && typeof CustomEvent === 'function') root.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* sin eventos (Node) */ }
  };
  // Huella del texto de la respuesta (FNV-1a): basta para saber si la copia nueva es igual a la guardada.
  const hash = s => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  function lsGet(k) {
    try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  // Se guarda el texto tal como llegó (sin volver a convertirlo): {"t":hora,"h":huella,"d":respuesta}
  function lsSet(k, t, h, txt) {
    const s = `{"t":${t},"h":${h == null ? 'null' : h},"d":${txt}}`;
    if (s.length > 1.5e6) return; // no vale la pena guardar respuestas enormes
    try { localStorage.setItem(LS + k, s); return; } catch (e) { /* cuota llena: liberar espacio */ }
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.indexOf(LS + '/') === 0) { // solo copias de la API, nunca preferencias
          // la hora va al principio de cada entrada: no hace falta leer la respuesta completa
          const m = /^\{"t":(\d+)/.exec(localStorage.getItem(kk) || '');
          keys.push([kk, m ? +m[1] : 0]);
        }
      }
      keys.sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(keys.length / 2)).forEach(([kk]) => localStorage.removeItem(kk));
      localStorage.setItem(LS + k, s);
    } catch (e) { /* sin espacio: seguimos solo con memoria */ }
  }

  // Memoria con límite: lo más viejo sale primero, y de los juegos completos (pesados) solo quedan los últimos 3.
  // La vigilancia (también feed/live, pero recortada con &fields=) pesa poco y no ocupa uno de esos lugares.
  const fullFeed = k => k.indexOf('/feed/live?language') > 0 && k.indexOf('&fields=') < 0;
  function memSet(path, o) {
    mem.delete(path);
    mem.set(path, o);
    if (fullFeed(path)) {
      const feeds = [...mem.keys()].filter(fullFeed);
      feeds.slice(0, Math.max(0, feeds.length - FEEDS_MAX)).forEach(k => mem.delete(k));
    }
    while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
  }

  const status = { online: true, lastOk: 0, lastError: null, fails: 0 };
  const setOnline = on => {
    if (status.online === on) return;
    status.online = on;
    emit('pc:red', { online: on });
  };

  // get(path, {ttl, persist, fresh, swr, timeout, quiet, watch}): ttl en ms; persist guarda en el navegador; fresh salta
  // el caché HTTP; swr devuelve al instante la copia que haya (aunque esté vencida) y la renueva en segundo plano;
  // timeout: el plazo en ms (10 s lo fresco, 20 s lo demás); quiet: si se corta o falla, no toca API.status ni el aviso de
  // conexión (para las consultas que el servidor calcula al momento y tardan: su demora no dice nada de la red);
  // watch: false, con swr, no la anota como dato de la vista abierta (si la copia nueva llega distinta, no la repinta).
  async function get(path, opts) {
    opts = opts || {};
    const ttl = opts.ttl == null ? MIN : opts.ttl;
    let hit = mem.get(path);
    if (!hit && opts.persist) {
      hit = lsGet(path);
      if (hit) { stamp(hit.d, hit.t); memSet(path, hit); }
    }
    if (opts.swr && opts.watch !== false && API.watcher) { try { API.watcher(path); } catch (e) { /* nada */ } } // solo estas avisan después
    const forced = forcing > 0 && !doneF.has(path);
    if (hit && !forced && Date.now() - hit.t < ttl) return hit.d;
    if (hit && !forced && opts.swr) {
      // Copia vencida: se muestra ya y se avisa si la nueva resulta distinta.
      if (!inflight.has(path)) {
        load(path, opts, hit, false).then(d => { if (d !== hit.d) emit('pc:datos', { path }); }, () => { /* sin red: queda la copia */ });
      }
      return hit.d;
    }
    if (inflight.has(path)) return inflight.get(path);
    return load(path, opts, hit, forced);
  }

  // Lo que la señal no corta (el prepedido de index.html salió sin ella) se deja de esperar cuando vence el tiempo:
  // un pedido que se queda colgado no deja la pantalla en su esqueleto para siempre.
  const until = (p, ctrl) => (!ctrl ? p : Promise.race([p, new Promise((res, rej) => {
    const s = ctrl.signal;
    const fail = () => rej(Object.assign(new Error('Tiempo de espera agotado'), { name: 'AbortError' }));
    if (s.aborted) fail(); else s.addEventListener('abort', fail, { once: true });
  })]));

  // Descarga una consulta. Si llega igual a la copia que había, se conserva el mismo objeto (y solo se renueva la hora),
  // para que lo ya calculado a partir de él siga valiendo.
  function load(path, opts, hit, forced) {
    const p = (async () => {
      const now = Date.now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || (opts.fresh ? 10e3 : 20e3)) : null;
      try {
        let url = BASE + path;
        if (opts.fresh) url += (path.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Math.floor(now / 5000);
        // prepedido de index.html (primera visita): la misma consulta ya salió junto con los .js; se usa una sola vez
        const pre = !opts.fresh && !forced && root.__pre && root.__pre[path];
        if (pre) delete root.__pre[path];
        const r = (pre && await until(pre, ctrl).catch(() => null)) ||
          await fetch(url, { cache: opts.fresh ? 'no-store' : forced ? 'no-cache' : 'default', signal: ctrl ? ctrl.signal : undefined });
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { http: r.status });
        const txt = await until(r.text(), ctrl);
        // Si respondió el modo sin señal (sw.js), el dato es de cuando se guardó, no de ahora.
        const saved = +r.headers.get('x-pizarra-guardado') || 0;
        const t = saved || Date.now();
        if (saved) {
          if (!opts.quiet) {
            status.fails++;
            setOnline(false);
          }
          if (hit && hit.t >= saved) return hit.d; // lo que había es igual o más nuevo
        } else {
          status.lastOk = Date.now();
          status.lastError = null;
          status.fails = 0;
          setOnline(true);
          if (forced) doneF.add(path);
        }
        // la huella solo hace falta para comparar (copias guardadas o renovadas en segundo plano)
        const h = opts.persist || opts.swr ? hash(txt) : null;
        if (hit && h != null && hit.h === h) {
          hit.t = Math.max(hit.t, t);
          stamp(hit.d, hit.t);
          memSet(path, hit);
          if (opts.persist) lsSet(path, hit.t, h, txt);
          return hit.d;
        }
        const d = stamp(JSON.parse(txt), t);
        memSet(path, { t, h, d });
        if (opts.persist) lsSet(path, t, h, txt);
        return d;
      } catch (e) {
        if (!opts.quiet) {
          status.lastError = e;
          status.fails++;
          if (!e.http) setOnline(false); // un error de la fuente (404, 500) no es falta de señal
        }
        if (hit) return hit.d; // mejor un dato viejo que una pantalla vacía
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
        inflight.delete(path);
      }
    })();
    inflight.set(path, p);
    return p;
  }

  // Pedido directo, sin memoria ni copia guardada: cada diffPatch sirve una sola vez. Siempre fresco (la marca _t evita la
  // copia de 10 s del servidor). Lleva la cuenta de la conexión igual que load(). → {txt, bytes}; bytes: lo que pesó la
  // respuesta sin comprimir (lo comprimido no se puede leer desde la página: el servidor no manda Timing-Allow-Origin).
  async function raw(path, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 10e3) : null;
    try {
      const url = BASE + path + (path.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Math.floor(Date.now() / 5000);
      const r = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { http: r.status });
      const buf = await until(r.arrayBuffer(), ctrl);
      if (r.headers.get('x-pizarra-guardado')) throw new Error('Sin conexión'); // copia del modo sin señal: no es de ahora
      status.lastOk = Date.now();
      status.lastError = null;
      status.fails = 0;
      setOnline(true);
      return { txt: new TextDecoder().decode(buf), bytes: buf.byteLength };
    } catch (e) {
      status.lastError = e;
      status.fails++;
      if (!e.http) setOnline(false);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ¿Tiene forma de juego completo? (lo que devuelve feed/live, o diffPatch cuando manda todo)
  const isGame = (g, pk) => !!(g && typeof g === 'object' && !Array.isArray(g) && g.gameData && g.liveData && g.liveData.plays &&
    g.metaData && g.metaData.timeStamp && (pk == null || g.gamePk == null || +g.gamePk === +pk));
  // En el juego completo, el turno en curso (currentPlay) es igual a la última jugada de allPlays (se cumple en los ~900
  // momentos del 838798 y el 829756 puestos al día a punta de parches): si después de un parche no, cayó sobre otra base.
  // Sin las zonas calientes y frías del bateador (batterHotColdZoneStats, solo en MLB: los parches las ponen distinto en
  // las dos, y la app no las usa; en la MLB en vivo, eso hacía bajar el juego entero cada pocos turnos).
  const hotCold = k => k.indexOf('HotColdZone') >= 0;
  const playsOk = g => {
    const C = root.PC && root.PC.calc, pl = g.liveData.plays, ap = pl.allPlays, cp = pl.currentPlay;
    return Array.isArray(ap) && (!cp || !ap.length || !C.sameJSON || C.sameJSON(ap[ap.length - 1], cp, hotCold));
  };
  const inningOf = g => { const ls = g && g.liveData && g.liveData.linescore; return ls && ls.currentInning != null ? +ls.currentInning : null; };
  const isFinal = g => !!(g && g.gameData && g.gameData.status && g.gameData.status.abstractGameState === 'Final');
  // Anota que el juego pk se tuvo de /feed/live a la hora at (el registro más reciente queda al final; tope de 5 juegos).
  function syncMark(pk, g, at) {
    const rec = { at: at || Date.now(), inning: inningOf(g), tries: 0, tryInning: null };
    synced.delete(pk);
    synced.set(pk, rec);
    while (synced.size > SYNC_MAX) synced.delete(synced.keys().next().value);
    return rec;
  }

  // Corre fn pidiendo todo fresco (sin tiempos de caché) mientras dura: es el "tirar para actualizar".
  async function force(fn) {
    forcing++;
    try { return await fn(); } finally { if (!--forcing) doneF.clear(); }
  }

  // Hora del dato más viejo entre varias respuestas (para "Actualizado hace…").
  const when = (...objs) => {
    const ts = objs.map(o => o && o.__t).filter(Boolean);
    return ts.length ? Math.min(...ts) : Date.now();
  };

  // Temporada en curso según la fecha: la LVBP arranca en octubre, así que de julio en adelante ya cuenta la nueva.
  function currentSeason(d) {
    d = d || new Date();
    return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  }
  const isPast = season => season < currentSeason();

  // OJO: el prepedido de index.html arma las mismas consultas del calendario y del día con esta misma lista; si cambia
  // aquí (o cambian esas rutas), hay que cambiarla allá, o el prepedido se baja de balde.
  const SCHED_FIELDS = [
    'dates', 'date', 'games', 'gamePk', 'gameType', 'officialDate', 'gameDate', 'status', 'abstractGameState',
    'detailedState', 'codedGameState', 'statusCode', 'reason', 'startTimeTBD', 'teams', 'away', 'home', 'team', 'id', 'name',
    'score', 'isWinner', 'leagueRecord', 'wins', 'losses', 'linescore', 'currentInning', 'scheduledInnings', 'inningHalf',
    'inningState', 'seriesDescription', 'seriesGameNumber', 'doubleHeader', 'gameNumber', 'venue', 'tiebreaker', 'description',
    'resumeDate', 'resumedFrom', 'rescheduleDate', 'rescheduledFrom'
  ].join(',');

  // Carreras por inning de toda una temporada (API.teamInnings): el juego (estado, equipos, marcador, fecha) y las
  // carreras de cada media entrada, nada más. 9,1 KB comprimidos en 2025-26, contra 85 KB sin fields.
  const INN_FIELDS = [
    'dates', 'games', 'gamePk', 'gameType', 'officialDate', 'gameDate', 'status', 'abstractGameState', 'codedGameState',
    'detailedState', 'teams', 'away', 'home', 'team', 'id', 'score', 'isWinner', 'linescore', 'innings', 'num', 'runs'
  ].join(',');

  const WP_FIELDS = [
    'homeTeamWinProbability', 'awayTeamWinProbability', 'homeTeamWinProbabilityAdded', 'leverageIndex',
    'about', 'atBatIndex', 'inning', 'halfInning', 'isTopInning', 'result', 'event', 'description',
    'awayScore', 'homeScore', 'matchup', 'batter', 'pitcher', 'id', 'fullName'
  ].join(',');

  // Lo mínimo para vigilar un juego en vivo (~1 KB comprimido): estado, pizarra con la defensa completa y quién viene,
  // y el turno en curso lanzamiento a lanzamiento (para C.pitchSeq). Si cambia el turno, se baja el juego completo.
  // La API filtra por nombre a cualquier profundidad: defense también trae su batter/onDeck/inHole (unos bytes).
  // eventType, player y position: los relevos y emergentes del turno, para pitcherId/batterId de C.pitchSeq.
  const WATCH_FIELDS = [
    'metaData', 'timeStamp', 'gameData', 'status', 'abstractGameState', 'codedGameState', 'detailedState', 'statusCode', 'reason',
    'liveData', 'linescore', 'currentInning', 'currentInningOrdinal', 'inningState', 'inningHalf', 'isTopInning', 'scheduledInnings',
    'outs', 'balls', 'strikes', 'innings', 'num', 'teams', 'home', 'away', 'runs', 'hits', 'errors', 'offense', 'defense',
    'batter', 'pitcher', 'first', 'second', 'third', 'id', 'fullName',
    'catcher', 'shortstop', 'left', 'center', 'right', 'onDeck', 'inHole',
    'plays', 'currentPlay', 'about', 'atBatIndex', 'halfInning', 'inning', 'isComplete', 'count', 'matchup', 'batSide', 'pitchHand',
    'code', 'playEvents', 'isPitch', 'index', 'details', 'description', 'pitchData', 'coordinates', 'x', 'y',
    'strikeZoneTop', 'strikeZoneBottom', 'eventType', 'player', 'position'
  ].join(',');

  // Historial bateador contra lanzador: solo lo que usa C.vsLine (~0,2 KB comprimido, en vez de 0,7). season y gameType:
  // la fila de cada temporada y fase, para sumar solo las anteriores (o.antes).
  const VS_FIELDS = [
    'stats', 'type', 'displayName', 'splits', 'season', 'gameType', 'stat', 'gamesPlayed', 'plateAppearances', 'atBats', 'hits',
    'doubles', 'triples', 'homeRuns', 'baseOnBalls', 'intentionalWalks', 'strikeOuts', 'hitByPitch', 'sacFlies', 'totalBases'
  ].join(',');

  // Las consultas que no son en vivo usan swr: abren al instante con lo guardado y se renuevan en segundo plano.
  const API = {
    SPORT, LEAGUE, status, get, when, currentSeason, isPast, force,
    pending: () => inflight.size, // pedidos andando (core.js: si una pantalla tarda, ¿es la red?)
    watcher: null, // core.js anota aquí qué consultas usa la vista abierta

    // Calendario completo de una temporada (todas las fases), con marcador final de cada juego.
    season(season, live) {
      return get(`/api/v1/schedule?sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}&gameType=R,F,D,L,W&hydrate=linescore&fields=${SCHED_FIELDS}`,
        { ttl: isPast(season) ? 7 * DAY : (live ? 60e3 : 5 * MIN), persist: true, fresh: !!live, swr: !live });
    },

    // Juegos de un día con pizarra, abridores probables y decisiones. wait: esperar la respuesta (sin swr),
    // para quien necesita saber ya si hay juegos en vivo.
    day(date, live, wait) {
      return get(`/api/v1/schedule?sportId=${SPORT}&leagueId=${LEAGUE}&date=${date}&hydrate=linescore,probablePitcher,decisions`,
        { ttl: live ? 12e3 : 2 * MIN, fresh: !!live, persist: true, swr: !live && !wait });
    },

    // Estadísticas de temporada de todos los jugadores (group: hitting | pitching; type: R, L, W...).
    stats(season, group, type, teamId) {
      const t = teamId ? `&teamId=${teamId}` : '';
      return get(`/api/v1/stats?stats=season&group=${group}&sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}&gameType=${type || 'R'}&playerPool=All&limit=3000${t}`,
        { ttl: isPast(season) ? 7 * DAY : 4 * MIN, persist: !teamId, swr: true });
    },

    // Todos los que jugaron esa temporada en la LVBP (ronda regular, comodín, round robin y final), para buscar:
    // [{id, fullName, lastName, team, pos, grupo: 'bateo' | 'pitcheo' | 'ambos', pa, bf}].
    // - team: id del equipo de la ronda regular (la API da uno por fase: el último si lo cambiaron); si solo jugó playoffs,
    //   el de su primera fase. Así un refuerzo sale con su equipo, no con el que lo tomó para el round robin;
    // - pos: la posición ('P' si lanzó más de lo que bateó; '' si la API no la sabe);
    // - pa y bf: turnos al bate y bateadores enfrentados en todas las fases (el tiempo de juego que desempata la búsqueda).
    // Los lanzadores que salen en el bateo sin ningún turno no cuentan como bateadores.
    // Son 8 consultas chicas en paralelo, recortadas con fields: ~10 KB comprimidos en la ronda regular, ~17 KB con los
    // playoffs (las estadísticas completas pesan 62 KB). Se guardan por horas (una semana las temporadas pasadas). La
    // primera vez el servidor tarda hasta ~15 s: plazo de 60 s y sin tocar el aviso de conexión (SLOW).
    async players(season) {
      const F = 'stats,splits,player,id,fullName,lastName,team,position,abbreviation,stat,plateAppearances,battersFaced';
      const one = (group, type) => get(`/api/v1/stats?stats=season&group=${group}&sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}` +
        `&gameType=${type}&playerPool=All&limit=3000&fields=${F}`, Object.assign({ ttl: isPast(season) ? 7 * DAY : 6 * HOUR, persist: true, swr: true, watch: false }, SLOW));
      // en orden de fase: R, D, L, W; pares = bateo, impares = pitcheo
      const res = await Promise.all(['R', 'D', 'L', 'W'].flatMap(t => [one('hitting', t), one('pitching', t)]).map(p => p.catch(e => e)));
      if (res[0] instanceof Error && res[1] instanceof Error) throw res[0]; // sin la ronda regular no hay lista
      const memo = playersMemo.get(season);
      if (memo && memo.src.length === res.length && memo.src.every((x, i) => x === res[i])) return memo.list; // la misma lista
      const by = new Map();
      res.forEach((r, i) => {
        const st = r && !(r instanceof Error) && r.stats && r.stats[0];
        for (const s of (st && st.splits) || []) {
          const pl = s && s.player;
          if (!pl || pl.id == null) continue;
          let p = by.get(pl.id);
          if (!p) by.set(pl.id, p = { id: pl.id, fullName: pl.fullName || '', lastName: pl.lastName || '', team: null, hpos: '', pa: 0, bf: 0, bat: false, pit: false });
          const x = s.stat || {}, ab = (s.position && s.position.abbreviation) || '';
          if (s.team && s.team.id != null && (p.team == null || i < 2)) p.team = s.team.id; // i < 2: la ronda regular
          if (i % 2) { p.bf += +x.battersFaced || 0; p.pit = true; continue; }
          p.pa += +x.plateAppearances || 0;
          if (ab !== 'P' || +x.plateAppearances > 0) p.bat = true;
          if (ab && ab !== 'P' && ab !== 'X') p.hpos = ab; // X: la API no sabe la posición
        }
      });
      const list = [...by.values()].map(p => ({
        id: p.id, fullName: p.fullName, lastName: p.lastName, team: p.team,
        pos: p.pit && (!p.bat || p.bf >= p.pa) ? 'P' : p.hpos,
        grupo: p.bat && p.pit ? 'ambos' : p.pit ? 'pitcheo' : 'bateo', pa: p.pa, bf: p.bf
      }));
      playersMemo.set(season, { src: res, list });
      return list;
    },

    // Los juegos de un equipo con sus carreras por inning (C.flatSchedule: cada juego trae innings [{num, away, home}]),
    // para C.runsByInning. teamId null: los de toda la liga, para C.runsByInningLeague. Las dos salen de una sola consulta
    // de la temporada entera (~9,1 KB comprimidos en 2025-26; la de un solo equipo pesa 2,8, pero el mapa de calor
    // necesita también la liga). type: el tipo de juego ('R' por defecto). La primera vez tarda ~7 s: SLOW.
    async teamInnings(teamId, season, type) {
      const C = root.PC && root.PC.calc;
      const sched = await get(`/api/v1/schedule?sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}&gameType=${type || 'R'}&hydrate=linescore&fields=${INN_FIELDS}`,
        Object.assign({ ttl: isPast(season) ? 7 * DAY : 30 * MIN, persist: true, swr: true }, SLOW));
      let all = inningsMemo.get(sched);
      if (!all) { all = stamp(C.flatSchedule(sched), sched.__t); inningsMemo.set(sched, all); }
      return teamId == null ? all : stamp(all.filter(g => g.away.id === +teamId || g.home.id === +teamId), sched.__t);
    },

    // Lo mismo que API.stats(season, group, type), pero solo con lo jugado de from a to (AAAA-MM-DD, los dos incluidos):
    // la forma reciente. stats=byDateRange acepta leagueId=135 (verificado: solo trae la LVBP). type: un solo tipo de
    // juego ('R' por defecto; la API no suma varios). Un rango nuevo tarda 5-14 s en el servidor (hasta 43 s medidos):
    // plazo de 60 s, y si se corta o falla no se dice "Sin conexión" (SLOW).
    statsRange(o) {
      o = o || {};
      return get(`/api/v1/stats?stats=byDateRange&group=${o.group}&sportId=${SPORT}&leagueId=${LEAGUE}&season=${o.season}` +
        `&startDate=${o.from}&endDate=${o.to}&gameType=${o.type || 'R'}&playerPool=All&limit=3000`,
        Object.assign({ ttl: isPast(o.season) ? 7 * DAY : 15 * MIN, swr: true }, SLOW));
    },

    teamStats(season, group, type) {
      return get(`/api/v1/teams/stats?stats=season&group=${group}&sportIds=${SPORT}&leagueIds=${LEAGUE}&season=${season}&gameType=${type || 'R'}`,
        { ttl: isPast(season) ? 7 * DAY : 4 * MIN, persist: true, swr: true });
    },

    // Juego completo: pizarra, jugada por jugada (en español) y box score.
    feed(pk, live) {
      return get(`/api/v1.1/game/${pk}/feed/live?language=es`, { ttl: live ? 8e3 : HOUR, fresh: !!live });
    },

    // Pone al día un juego en vivo con diffPatch: solo lo que cambió desde feed.metaData.timeStamp (0,5-3 KB comprimidos
    // por momento, contra 38-76 KB del juego completo). Devuelve {feed, modo, bytes, sync?}:
    // - 'diff': el MISMO objeto puesto al día con C.applyPatch: lo que cambió va en objetos nuevos y lo demás conserva su
    //   identidad, así que hay que volver a leer las partes (linescore, allPlays, currentPlay...) desde feed;
    // - 'completo': un objeto nuevo. El servidor manda el juego entero cuando quiere (atrasos, el paso a Final); también
    //   es completo el /feed/live que se baja aquí: el resincronizado, el cierre o el respaldo si algo falló (operación que
    //   no aplica, resultado que no cuadra, respuesta rara, error del servidor). Nunca uno más viejo que el que se pasó;
    // - 'igual': nada cambió (el mismo objeto).
    // sync: true cuando lo devuelto es /feed/live de verdad. diffPatch (sus parches y sus completos) no trae todas las
    // correcciones del anotador (carreras limpias, trayectorias, códigos de lanzamiento: 21 min de desvío en la AFL), así
    // que se resincroniza con /feed/live en lugar de diffPatch: en el primer ciclo de cada inning nuevo (ya pasó la pausa
    // en que corrige el anotador) y a los 40 min del último /feed/live; si llega más viejo que el armado no cuenta, y se
    // reintenta hasta 3 veces por inning. Al quedar en Final, en la misma llamada se baja /feed/live y se devuelve ese.
    // El completo que manda diffPatch no cuenta como resincronizado. o.resync === false: sin nada de esto (pruebas).
    // Con el juego en Final no se usa diffPatch (ver abajo). bytes: lo que pesaron las respuestas sin comprimir.
    // Si algo falla, feed queda intacto. Sin señal, lanza error.
    async feedPatch(pk, feed, o) {
      const C = root.PC && root.PC.calc;
      const resync = !(o && o.resync === false);
      const path = `/api/v1.1/game/${pk}/feed/live?language=es`;
      const ts = isGame(feed, pk) ? feed.metaData.timeStamp : null;
      const keep = (d, modo, bytes, sync) => {
        const t = Date.now();
        stamp(d, t);
        memSet(path, { t, h: null, d }); // API.feed(pk) devuelve el más nuevo
        return sync ? { feed: d, modo, bytes, sync: true } : { feed: d, modo, bytes };
      };
      // /feed/live de verdad (no el de la memoria: puede ser el mismo que se está poniendo al día). Si llega igual o más
      // nuevo que base, queda anotado como la última base buena; si llega más viejo, d = null.
      const live = async base => {
        const r = await raw(path, 20e3);
        let d = null;
        try { d = JSON.parse(r.txt); } catch (e) { /* abajo */ }
        if (!isGame(d, pk)) throw Object.assign(new Error('Respuesta desconocida del juego ' + pk), { unknown: true });
        if (isGame(base) && d.metaData.timeStamp < base.metaData.timeStamp) return { d: null, bytes: r.bytes };
        syncMark(pk, d);
        return { d, bytes: r.bytes };
      };
      // el respaldo: /feed/live en lugar de lo que no sirvió (si llega más viejo que el que se tiene: 'igual')
      const whole = async bytes => {
        const L = await live(ts ? feed : null);
        return L.d ? keep(L.d, 'completo', bytes + L.bytes, true) : keep(feed, 'igual', bytes + L.bytes);
      };
      // al quedar en Final por diffPatch (va atrasado en las correcciones), el cierre bueno es /feed/live, en la misma llamada
      const close = async res => {
        if (!resync || !isFinal(res.feed)) return res;
        try {
          const L = await live(res.feed);
          if (L.d) return keep(L.d, 'completo', res.bytes + L.bytes, true);
          res.bytes += L.bytes;
        } catch (e) { /* sin señal o respuesta rara: queda lo de diffPatch, y la rama de Final lo vuelve a mirar */ }
        return res;
      };
      if (!ts || !C || typeof C.applyPatch !== 'function') return whole(0);
      // sin señal, error: no vale la pena intentar el completo; con un error del servidor (500, 404…), null
      const ask = p => raw(p).catch(e => { if (!e.http) throw e; return null; });
      // la primera vez, el feed que se pasa es /feed/live (juego.js lo bajó con API.feed)
      const rec = synced.get(pk) || syncMark(pk, feed, feed.__t);
      // Juego terminado: diffPatch ya no da diferencias, manda el juego entero (60-76 KB) cada vez. Basta la vigilancia
      // (~1 KB): si no cambió nada, 'igual'; si cambió (una corrección del anotador), se baja el completo.
      const st = feed.gameData.status || {};
      if (st.abstractGameState === 'Final') {
        const w = await ask(`/api/v1.1/game/${pk}/feed/live?language=es&fields=${WATCH_FIELDS}`);
        let wd = null;
        try { wd = w && JSON.parse(w.txt); } catch (e) { /* abajo */ }
        const tot = g => { const t = (g && g.liveData && g.liveData.linescore && g.liveData.linescore.teams) || {}; return ['away', 'home'].map(s => t[s] ? [t[s].runs, t[s].hits, t[s].errors].join('-') : '').join('|'); };
        const same = wd && wd.metaData && wd.gameData && wd.gameData.status && wd.metaData.timeStamp === ts &&
          wd.gameData.status.codedGameState === st.codedGameState && wd.gameData.status.detailedState === st.detailedState && tot(wd) === tot(feed);
        return same ? keep(feed, 'igual', w.bytes) : whole(w ? w.bytes : 0);
      }
      // El resincronizado: en el primer ciclo de un inning nuevo, o a los 40 min del último /feed/live, este ciclo baja
      // /feed/live en vez de diffPatch. El juego que empieza (de ningún inning al 1.º) no cuenta.
      let pre = 0;
      const inn = inningOf(feed);
      if (rec.inning == null && inn != null) rec.inning = inn;
      if (resync && ((inn != null && inn !== rec.inning) || Date.now() - rec.at >= SYNC_MS)) {
        if (rec.tryInning !== inn) { rec.tryInning = inn; rec.tries = 0; }
        if (rec.tries < SYNC_TRIES) {
          rec.tries++;
          try {
            const L = await live(feed);
            if (L.d) return keep(L.d, 'completo', L.bytes, true);
            pre = L.bytes; // llegó más viejo que el armado: no cuenta; este ciclo sigue con diffPatch
          } catch (e) {
            if (!e.http && !e.unknown) throw e; // sin señal
          }
        }
      }
      const r = await ask(`/api/v1.1/game/${pk}/feed/live/diffPatch?language=es&startTimecode=${ts}`);
      if (!r) return whole(pre);
      const bytes = pre + r.bytes;
      let data = null;
      try { data = JSON.parse(r.txt); } catch (e) { /* abajo */ }
      if (Array.isArray(data)) {
        // una lista de {diff: [operaciones]}, una por momento, en orden; vacía si no hubo cambios
        const ops = [];
        for (const x of data) {
          if (!x || !Array.isArray(x.diff)) return whole(bytes);
          for (const op of x.diff) ops.push(op);
        }
        if (!ops.length) return keep(feed, 'igual', bytes);
        // con operaciones, la hora tiene que avanzar: un parche repetido (la misma hora) no se aplica dos veces
        const check = g => isGame(g, pk) && g.metaData.timeStamp > ts && playsOk(g);
        let out = null;
        try { out = C.applyPatch(feed, ops, { check }); } catch (e) { /* abajo */ }
        // Los avisos del momento (metaData.gameEvents y logicalEvents) vienen vacíos o inventados en un juego completo
        // con fullUpdate, y el parche siguiente ya no les cuadra; las zonas del bateador (batterHotColdZoneStats, MLB)
        // vienen ordenadas distinto en diffPatch y en /feed/live. La app no usa ninguna de las dos: se prueba sin ellas
        // antes de bajar el juego entero de nuevo.
        if (out !== feed) {
          const tr = p => typeof p === 'string' && (/^\/metaData\/(gameEvents|logicalEvents)(\/|$)/.test(p) || hotCold(p));
          const rest = ops.filter(op => !(op && (tr(op.path) || tr(op.from))));
          if (rest.length < ops.length) try { out = C.applyPatch(feed, rest, { check }); } catch (e) { /* abajo */ }
        }
        return out === feed ? close(keep(feed, 'diff', bytes)) : whole(bytes);
      }
      if (isGame(data, pk)) { // el servidor mandó el juego entero: no es /feed/live y no reinicia la cuenta
        if (data.metaData.timeStamp < ts) return keep(feed, 'igual', bytes);
        return close(keep(data, 'completo', bytes));
      }
      return whole(bytes);
    },

    // Vigilancia liviana de un juego: estado, pizarra y el turno en curso (liveData.plays.currentPlay, recortado).
    // En español, como el feed: las descripciones de los lanzamientos salen igual en los dos.
    watch(pk) {
      return get(`/api/v1.1/game/${pk}/feed/live?language=es&fields=${WATCH_FIELDS}`, { ttl: 8e3, fresh: true });
    },

    winProb(pk, live) {
      return get(`/api/v1/game/${pk}/winProbability?language=es&fields=${WP_FIELDS}`, { ttl: live ? 8e3 : HOUR, fresh: !!live });
    },

    person(id, season) {
      return get(`/api/v1/people/${id}?hydrate=currentTeam,stats(group=[hitting,pitching],type=[season,gameLog,yearByYear],sportId=${SPORT},season=${season})`,
        { ttl: isPast(season) ? DAY : 4 * MIN, swr: true });
    },

    // Bateador contra lanzador en las ligas invernales, ya resumido por C.vsLine en {pa, ab, h, d, t, hr, bb, so, avg, ops}
    // (avg y ops null sin turnos oficiales), o null si nunca se enfrentaron. Las muestras son chicas: decirlo.
    // o.tipos: los tipos de juego que se piden (por defecto la temporada regular; 'R,F,D,L,W' suma los playoffs de la LVBP).
    // o.antes y o.tipo: solo lo jugado antes de esa temporada (y de esa fase), para la repetición (ver C.vsLine).
    async vsPlayer(batterId, pitcherId, o) {
      if (batterId == null || pitcherId == null) return null;
      o = o || {};
      const tipos = Array.isArray(o.tipos) ? o.tipos.join(',') : o.tipos;
      const r = await get(`/api/v1/people/${batterId}/stats?stats=vsPlayer&opposingPlayerId=${pitcherId}&sportId=${SPORT}&group=hitting` +
        `${tipos ? '&gameType=' + tipos : ''}&fields=${VS_FIELDS}`, { ttl: 6 * HOUR });
      const C = root.PC && root.PC.calc;
      return C && C.vsLine ? C.vsLine(r, { antes: o.antes, tipo: o.tipo }) : null;
    },

    WATCH_FIELDS // para las pruebas (pruebas/calc.test.js arma la vigilancia de un momento pasado con ?timecode=)
  };

  root.PC = root.PC || {};
  root.PC.api = API;
})(typeof window !== 'undefined' ? window : globalThis);
