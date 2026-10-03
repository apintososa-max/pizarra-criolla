/* Pizarra Criolla · api.js
   Única puerta a los datos: la API pública de estadísticas de MLB (statsapi.mlb.com), que cubre la LVBP
   como liga 135 del deporte 17 (ligas invernales). Lee directo desde el teléfono; no hay servidor propio.
   Guarda copias en memoria y en el navegador para no repetir descargas y para mostrar algo sin señal.
   Cada respuesta lleva la hora en que se bajó (__t), para que la pantalla diga de cuándo es el dato. */
(function (root) {
  'use strict';
  const BASE = 'https://statsapi.mlb.com';
  const SPORT = 17, LEAGUE = 135;
  const LS = 'pc1:';
  const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
  const MEM_MAX = 70, FEEDS_MAX = 3;

  const mem = new Map();
  const inflight = new Map();

  const stamp = (d, t) => {
    if (d && typeof d === 'object') { try { Object.defineProperty(d, '__t', { value: t, configurable: true }); } catch (e) { /* objeto congelado */ } }
    return d;
  };

  function lsGet(k) {
    try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    let s;
    try { s = JSON.stringify(v); } catch (e) { return; }
    if (s.length > 1.5e6) return; // no vale la pena guardar respuestas enormes
    try { localStorage.setItem(LS + k, s); return; } catch (e) { /* cuota llena: liberar espacio */ }
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.indexOf(LS) === 0 && kk !== LS + 'prefs') {
          let t = 0;
          try { t = JSON.parse(localStorage.getItem(kk)).t || 0; } catch (e) { /* entrada dañada */ }
          keys.push([kk, t]);
        }
      }
      keys.sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(keys.length / 2)).forEach(([kk]) => localStorage.removeItem(kk));
      localStorage.setItem(LS + k, s);
    } catch (e) { /* sin espacio: seguimos solo con memoria */ }
  }

  // Memoria con límite: lo más viejo sale primero, y de los juegos completos (pesados) solo quedan los últimos 3.
  function memSet(path, o) {
    mem.delete(path);
    mem.set(path, o);
    if (path.indexOf('/feed/live?language') > 0) {
      const feeds = [...mem.keys()].filter(k => k.indexOf('/feed/live?language') > 0);
      feeds.slice(0, Math.max(0, feeds.length - FEEDS_MAX)).forEach(k => mem.delete(k));
    }
    while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
  }

  const status = { online: true, lastOk: 0, lastError: null, fails: 0 };

  // get(path, {ttl, persist, fresh}): ttl en ms; persist guarda en el navegador; fresh salta el caché HTTP.
  async function get(path, opts) {
    opts = opts || {};
    const ttl = opts.ttl == null ? MIN : opts.ttl;
    const now = Date.now();
    let hit = mem.get(path);
    if (!hit && opts.persist) {
      hit = lsGet(path);
      if (hit) { stamp(hit.d, hit.t); memSet(path, hit); }
    }
    if (hit && now - hit.t < ttl) return hit.d;
    if (inflight.has(path)) return inflight.get(path);
    const p = (async () => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.fresh ? 10e3 : 20e3) : null;
      try {
        let url = BASE + path;
        if (opts.fresh) url += (path.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Math.floor(now / 5000);
        const r = await fetch(url, { cache: opts.fresh ? 'no-store' : 'default', signal: ctrl ? ctrl.signal : undefined });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        // Si respondió el modo sin señal (sw.js), el dato es de cuando se guardó, no de ahora.
        const saved = +r.headers.get('x-pizarra-guardado') || 0;
        const o = { t: saved || Date.now(), d: stamp(d, saved || Date.now()) };
        if (saved) {
          status.online = false;
          status.fails++;
          if (hit && hit.t > saved) return hit.d; // lo que había en memoria es más nuevo
        } else {
          status.online = true;
          status.lastOk = Date.now();
          status.lastError = null;
          status.fails = 0;
        }
        memSet(path, o);
        if (opts.persist) lsSet(path, o);
        return d;
      } catch (e) {
        status.online = false;
        status.lastError = e;
        status.fails++;
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

  // Lo mínimo para vigilar un juego en vivo (~0,6 KB): estado y pizarra. Si algo cambia, se baja el juego completo.
  const WATCH_FIELDS = [
    'metaData', 'timeStamp', 'gameData', 'status', 'abstractGameState', 'codedGameState', 'detailedState', 'statusCode', 'reason',
    'liveData', 'linescore', 'currentInning', 'currentInningOrdinal', 'inningState', 'inningHalf', 'isTopInning', 'scheduledInnings',
    'outs', 'balls', 'strikes', 'innings', 'num', 'teams', 'home', 'away', 'runs', 'hits', 'errors', 'offense', 'defense',
    'batter', 'pitcher', 'first', 'second', 'third', 'id', 'fullName'
  ].join(',');

  const API = {
    SPORT, LEAGUE, status, get, when, currentSeason, isPast,

    // Calendario completo de una temporada (todas las fases), con marcador final de cada juego.
    season(season, live) {
      return get(`/api/v1/schedule?sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}&gameType=R,F,D,L,W&hydrate=linescore&fields=${SCHED_FIELDS}`,
        { ttl: isPast(season) ? 7 * DAY : (live ? 60e3 : 5 * MIN), persist: true, fresh: !!live });
    },

    // Juegos de un día con pizarra, abridores probables y decisiones.
    day(date, live) {
      return get(`/api/v1/schedule?sportId=${SPORT}&leagueId=${LEAGUE}&date=${date}&hydrate=linescore,probablePitcher,decisions`,
        { ttl: live ? 12e3 : 2 * MIN, fresh: !!live });
    },

    // Estadísticas de temporada de todos los jugadores (group: hitting | pitching; type: R, L, W...).
    stats(season, group, type, teamId) {
      const t = teamId ? `&teamId=${teamId}` : '';
      return get(`/api/v1/stats?stats=season&group=${group}&sportId=${SPORT}&leagueId=${LEAGUE}&season=${season}&gameType=${type || 'R'}&playerPool=All&limit=3000${t}`,
        { ttl: isPast(season) ? 7 * DAY : 4 * MIN, persist: !teamId });
    },

    teamStats(season, group, type) {
      return get(`/api/v1/teams/stats?stats=season&group=${group}&sportIds=${SPORT}&leagueIds=${LEAGUE}&season=${season}&gameType=${type || 'R'}`,
        { ttl: isPast(season) ? 7 * DAY : 4 * MIN, persist: true });
    },

    // Juego completo: pizarra, jugada por jugada (en español) y box score.
    feed(pk, live) {
      return get(`/api/v1.1/game/${pk}/feed/live?language=es`, { ttl: live ? 8e3 : HOUR, fresh: !!live });
    },

    // Vigilancia liviana de un juego: estado + pizarra.
    watch(pk) {
      return get(`/api/v1.1/game/${pk}/feed/live?fields=${WATCH_FIELDS}`, { ttl: 8e3, fresh: true });
    },

    winProb(pk, live) {
      return get(`/api/v1/game/${pk}/winProbability?language=es&fields=${WP_FIELDS}`, { ttl: live ? 8e3 : HOUR, fresh: !!live });
    },

    person(id, season) {
      return get(`/api/v1/people/${id}?hydrate=currentTeam,stats(group=[hitting,pitching],type=[season,gameLog,yearByYear],sportId=${SPORT},season=${season})`,
        { ttl: isPast(season) ? DAY : 4 * MIN });
    }
  };

  root.PC = root.PC || {};
  root.PC.api = API;
})(typeof window !== 'undefined' ? window : globalThis);
