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

  const mem = new Map();
  const inflight = new Map();
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

  // get(path, {ttl, persist, fresh, swr}): ttl en ms; persist guarda en el navegador; fresh salta el caché HTTP;
  // swr devuelve al instante la copia que haya (aunque esté vencida) y la renueva en segundo plano.
  async function get(path, opts) {
    opts = opts || {};
    const ttl = opts.ttl == null ? MIN : opts.ttl;
    let hit = mem.get(path);
    if (!hit && opts.persist) {
      hit = lsGet(path);
      if (hit) { stamp(hit.d, hit.t); memSet(path, hit); }
    }
    if (opts.swr && API.watcher) { try { API.watcher(path); } catch (e) { /* nada */ } } // solo estas avisan después
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
      const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.fresh ? 10e3 : 20e3) : null;
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
          status.fails++;
          setOnline(false);
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
        status.lastError = e;
        status.fails++;
        if (!e.http) setOnline(false); // un error de la fuente (404, 500) no es falta de señal
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

    teamStats(season, group, type) {
      return get(`/api/v1/teams/stats?stats=season&group=${group}&sportIds=${SPORT}&leagueIds=${LEAGUE}&season=${season}&gameType=${type || 'R'}`,
        { ttl: isPast(season) ? 7 * DAY : 4 * MIN, persist: true, swr: true });
    },

    // Juego completo: pizarra, jugada por jugada (en español) y box score.
    feed(pk, live) {
      return get(`/api/v1.1/game/${pk}/feed/live?language=es`, { ttl: live ? 8e3 : HOUR, fresh: !!live });
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
