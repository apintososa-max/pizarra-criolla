/* Pizarra Criolla · juego.js
   La pantalla de un juego (ruta #/juego/<pk>): la pizarra con el turno, las pestañas y todo lo que pasa en vivo
   o en la repetición. La lista de juegos del día sigue en juegos.js.
   - La pizarra: en vivo y en la repetición pone "el turno arriba", en ocho filas fijas: estado · marcador con los
     bombillos B-S-O · campo y zona · secuencia · duelo · fichas y última jugada · línea por inning. Un juego terminado
     sin repetición, uno por jugar o uno pospuesto la dejan como siempre (los equipos, las carreras y la línea).
   - Debajo, las pestañas: Previa (antes del juego) · Resumen · Box · Jugadas · Datos.
   - La curva manda: arrastrarla mueve la chapita (la mini pizarra fija de arriba) a ese momento, y la pizarra al
     soltar; tocar una jugada clave o un batazo del mapa, también.
   - En vivo, cada ciclo pone el juego al día con diffPatch (api.js: feedPatch): baja solo lo que cambió. Cada
     lanzamiento repinta bombillos, campo, zona y duelo; un turno nuevo recalcula todo. Si diffPatch falla dos veces
     seguidas, vuelve un rato a la vigilancia liviana de la Fase 2 (el juego completo solo al cambiar el turno).
     Carreras, jonrones, cambios de lanzador y fines de inning salen en una banda amarilla sobre la franja de comentario
     (fichas y última jugada).
   - El modo TV (css/tv.css): el juego a pantalla completa y en horizontal, para tenerlo al lado de la TV, con un
     retraso ajustable para ir a la par de la transmisión. Sale solo al girar el teléfono, o con su botón.
   Los dibujos (curva, mapa de batazos, zona y campo) son de charts.js y los cálculos de calc.js: si alguno falta o falla,
   esa parte no sale y lo demás sigue. */
(function (root) {
  'use strict';
  const PC = root.PC;
  const C = PC.calc, API = PC.api, CH = PC.charts, F = PC.F, D = PC.D, U = PC.U, esc = PC.esc;
  // de juegos.js
  const { surname, ord, dayOf, chipOf, finalSub, finalText, paint, reduced, I_LEFT } = PC;
  const team = (id, api) => PC.team(id, api);

  const I_PLAY = '<svg class="ic-f" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8c.6-.4.6-1.2 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z"/></svg>';
  const I_PAUSE = '<svg class="ic-f" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';

  const BAND_MS = 8000;   // lo que dura la banda de un momento
  const WAIT_MS = 4000;   // lo que dura la que estuvo esperando en la cola (como mucho 2 esperan)
  const KEY_PAUSE = 1800; // la repetición se detiene así en las jugadas clave y los jonrones
  const STEP_MS = 900;    // un lanzamiento de la repetición a 1×
  const SPEEDS = [1, 2, 4];
  const PATCH_RETRY = 5 * 60e3; // diffPatch falló dos veces seguidas: la vigilancia de la Fase 2 por este rato
  const TV_DELAYS = [0, 15, 30, 45, 60, 90]; // retraso del modo TV, en segundos
  const TV_KEEP = 130e3; // lo que se guarda del vivo para mostrarlo con retraso (90 s y un margen)

  // "1.er lanzamiento", "3.er turno", "2.º lanzamiento"
  const ordM = n => (n === 1 || n === 3 ? `${n}.er` : `${n}.º`);
  const outsTxt = n => `${n} out${n === 1 ? '' : 's'}`;

  // ---------- lo que viene de calc.js y charts.js ----------
  // Se pregunta en cada uso (no al cargar): si una función no está, su parte no sale.
  const has = (o, k) => !!o && typeof o[k] === 'function';
  function safe(f, ...a) { try { return f(...a); } catch (e) { console.warn('juego', e); return null; } }

  // Secuencia de lanzamientos de una jugada (calc.js), guardada por jugada. diffPatch cambia una jugada por otra nueva
  // (calc.js: applyPatch), pero por si acaso lo guardado vale solo con la misma cantidad de eventos.
  const seqMemo = new WeakMap();
  function seqOf(play) {
    if (!play || !has(C, 'pitchSeq')) return null;
    const n = play.playEvents ? play.playEvents.length : 0;
    let m = seqMemo.get(play);
    if (!m || m.n !== n) { m = { n, s: safe(C.pitchSeq, play) || [] }; seqMemo.set(play, m); }
    return m.s;
  }
  // La repetición va lanzamiento a lanzamiento si calc.js sabe la secuencia y el estado a mitad de turno; si no, por jugada.
  const byPitch = () => has(C, 'pitchSeq') && has(C, 'stateAtPitch');
  // Lo que cuenta como strike en el conteo del lanzador (C.pitchSeq: call); las bolas y strikes automáticos (auto) no
  // son lanzamientos
  const STRIKE = new Set(['cantado', 'tirandole', 'foul', 'enjuego']);
  const HITS = new Set(['single', 'double', 'triple', 'home_run']);
  // Turnos que no cuentan como vez al bate
  const NO_AB = new Set(['walk', 'intent_walk', 'hit_by_pitch', 'sac_fly', 'sac_bunt', 'sac_fly_double_play', 'sac_bunt_double_play', 'catcher_interf']);
  // Jugadas de corredores: terminan la jugada pero no el turno del bateador
  const RUNNER = /^(caught_stealing|pickoff|stolen_base|wild_pitch|passed_ball|balk|other_advance|defensive_indiff)/;

  const side = (d, s) => { const t = d.feed.gameData.teams[s]; return Object.assign({ id: t.id }, team(t.id, t)); };

  function halfLabel(inning, top, state) {
    if (state === 'Middle') return `Mitad del ${ord(inning)}`;
    if (state === 'End') return `Fin del ${ord(inning)}`;
    return `${top ? 'Alta' : 'Baja'} del ${ord(inning)}`;
  }
  // La pausa entre medias entradas (en vivo): la API deja en currentPlay el último turno de la mitad que terminó,
  // pero offense y defense ya son los de la que viene.
  const pauseOf = ls => !!ls && (ls.inningState === 'Middle' || ls.inningState === 'End');

  // El turno en curso que trae la vigilancia (api.js lo pide desde la Fase 2); null si no lo trae.
  const cpOf = w => (w && w.liveData && w.liveData.plays && w.liveData.plays.currentPlay) || null;

  // ---------- firma del momento ----------
  // turn cambia con el turno (estado, inning, outs, carreras, bateador, lanzador o jugada terminada): hay que bajar el
  // juego completo (con el lanzador nuevo baja también el cambio, y su banda sale a tiempo).
  // pitch cambia con cada lanzamiento (cuenta, lanzamientos del turno, corredores): basta con la vigilancia.
  function sigOf(ls, st, cp) {
    ls = ls || {};
    const t = ls.teams || {}, o = ls.offense || {}, df = ls.defense || {}, ab = (cp && cp.about) || {};
    const id = x => (x && x.id) || '';
    const turn = [st && st.statusCode, st && st.codedGameState, ls.currentInning, ls.inningHalf, ls.inningState, ls.outs,
      t.away && t.away.runs, t.home && t.home.runs, id(o.batter), id(df.pitcher), cp ? ab.atBatIndex : '', cp && ab.isComplete ? 1 : 0].join('|');
    const n = cp && cp.playEvents ? cp.playEvents.filter(e => e.isPitch).length : '';
    const pitch = [ls.balls, ls.strikes, n, id(o.first), id(o.second), id(o.third)].join('|');
    return { turn, pitch };
  }

  // ---------- estado del juego en un momento ----------
  // Jugadas completas hasta el momento elegido (las que ya se ven): todas, o hasta la jugada del cursor si ya terminó.
  const uptoOf = d => (d.cursor == null ? d.done.length : d.pitch == null ? d.cursor + 1 : d.cursor);

  // Estado tras el lanzamiento p de la jugada k (p null: la jugada ya terminó), guardado por (k, p).
  function stateAt(d, k, p) {
    const key = k + '|' + p;
    let s = d.memo.get(key);
    if (!s) {
      s = (p != null && byPitch() && safe(C.stateAtPitch, d.done, k, p)) || C.stateAt(d.done, k);
      d.memo.set(key, s);
    }
    return s;
  }
  // La defensa en la jugada k hasta el evento lim (stateAtPitch: un relevo a mitad de turno ya cambia la defensa).
  function defenseAt(d, k, lim) {
    if (!has(C, 'defenseAt')) return null;
    const key = k + '|' + (lim == null ? '' : lim);
    if (!d.defMemo.has(key)) d.defMemo.set(key, safe(C.defenseAt, d.feed, k, lim == null ? undefined : lim));
    return d.defMemo.get(key);
  }
  // Quién empezó lanzando el turno k de plays: el del turno si no hubo relevo dentro de él; si lo hubo, calc.js
  // (C.stateAtPitch con p = -1). Para atribuir cada lanzamiento: s.pitcherId o este.
  const subIn = q => ((q && q.playEvents) || []).some(e => e && e.details && e.details.eventType === 'pitching_substitution');
  function starterOf(d, plays, k) {
    const q = plays[k];
    if (!subIn(q)) return q && q.matchup && q.matchup.pitcher ? q.matchup.pitcher.id : null;
    const key = 'sp' + k, mine = plays === d.done;
    if (mine && d.memo.has(key)) return d.memo.get(key);
    const s = has(C, 'stateAtPitch') ? safe(C.stateAtPitch, plays, k, -1) : null;
    const id = s && s.pitcher ? s.pitcher.id : null;
    if (mine) d.memo.set(key, id);
    return id;
  }
  // Último batazo de una jugada: {x, y, traj, event} en la escala de la API (event: un jonrón, el campo lo dice).
  function hitOf(play) {
    const evs = (play && play.playEvents) || [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const h = evs[i].hitData, c = h && h.coordinates;
      if (c && c.coordX != null && c.coordY != null) return { x: c.coordX, y: c.coordY, traj: h.trajectory || null, event: (play.result && play.result.eventType) || null };
    }
    return null;
  }
  // El que viene después del bateador de la jugada k en su equipo (en cubierta, o el que viene si el turno terminó).
  function nextBatter(d, k) {
    const p = d.done[k];
    if (!p || !p.matchup || !p.matchup.batter) return null;
    const top = !!p.about.isTopInning, id = p.matchup.batter.id;
    for (let j = k + 1; j < d.done.length; j++) {
      const q = d.done[j];
      if (!!q.about.isTopInning === top && q.matchup && q.matchup.batter && q.matchup.batter.id !== id) return q.matchup.batter;
    }
    return null;
  }

  // Un campo que se calcula la primera vez que se lee (la chapita, en cada cuadro de un arrastre, no usa la defensa ni
  // el que viene: así no se calculan).
  function lazy(o, k, f) {
    Object.defineProperty(o, k, {
      enumerable: true, configurable: true,
      get() { const v = f(); Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true }); return v; }
    });
  }
  // Lo que muestra la pizarra: el momento de la repetición (jugada d.cursor, lanzamiento d.pitch) o el de ahora.
  function moment(d) {
    const f = d.feed, fls = f.liveData.linescore || {}, ls = d.ls || fls;
    if (d.cursor != null) {
      const k = d.cursor, p = d.pitch, play = d.done[k] || {};
      const st = stateAt(d, k, p), seq = d.byPitch ? seqOf(play) : null, end = p == null;
      const m = play.matchup || {}, cnt = play.count || {};
      // quién batea y quién lanza en ese lanzamiento (un relevo o un emergente a mitad de turno ya cuentan: calc.js)
      const bat = st.batter || m.batter || null;
      const M = {
        ls, st, rep: true, k, p, play, end, tot: st.tot,
        inning: st.inning, top: st.top, state: null, bases: st.bases || [], outs: st.outs || 0,
        balls: st.balls != null ? st.balls : end ? cnt.balls || 0 : 0,
        strikes: st.strikes != null ? st.strikes : end ? cnt.strikes || 0 : 0,
        batter: bat, pitcher: st.pitcher || m.pitcher || null,
        batSide: m.batSide && (!bat || !m.batter || bat.id === m.batter.id) ? m.batSide.code : null,
        pitches: seq ? (end ? seq : seq.slice(0, p + 1)) : null,
        li: d.wpa && d.wpa.plays[k] ? d.wpa.plays[k].li : null,
        upto: end ? k + 1 : k
      };
      lazy(M, 'defense', () => defenseAt(d, k, st.lim));
      lazy(M, 'hit', () => (end ? hitOf(play) : null));
      lazy(M, 'onDeck', () => nextBatter(d, k));
      return M;
    }
    const T = ls.teams || { away: {}, home: {} };
    const cp = d.cp || f.liveData.plays.currentPlay || null;
    const off = ls.offense || {}, fo = fls.offense || {};
    // la vigilancia de antes traía la defensa a medias: entonces vale la del juego completo (se baja en cada turno)
    const def = ls.defense && ls.defense.catcher ? ls.defense : fls.defense || ls.defense || null;
    const tot = {
      away: { r: T.away.runs || 0, h: T.away.hits || 0, e: T.away.errors || 0 },
      home: { r: T.home.runs || 0, h: T.home.hits || 0, e: T.home.errors || 0 }
    };
    if (pauseOf(ls)) {
      // entre medias entradas, todo de la mitad que viene: abre offense.batter contra defense.pitcher, sin cuenta ni
      // zona (la última jugada sigue diciendo lo que pasó)
      return {
        ls, st: null, rep: false, play: cp, end: false, pause: true, tot,
        inning: ls.currentInning, top: ls.isTopInning, state: ls.inningState,
        nextTop: !ls.isTopInning, nextInning: ls.isTopInning ? ls.currentInning : (ls.currentInning || 0) + 1,
        bases: [off.first || null, off.second || null, off.third || null], outs: 0, balls: 0, strikes: 0,
        batter: off.batter || null, pitcher: (def && def.pitcher) || null, batSide: null,
        pitches: [], defense: def, hit: null, onDeck: off.onDeck || null, li: d.liLive, upto: d.done.length
      };
    }
    const seq = cp ? seqOf(cp) : null, end = !!(cp && cp.about && cp.about.isComplete);
    const m = (cp && cp.matchup) || {}, last = d.done[d.done.length - 1];
    return {
      ls, st: null, rep: false, play: cp, end, tot,
      inning: ls.currentInning, top: ls.isTopInning, state: ls.inningState,
      bases: [off.first || null, off.second || null, off.third || null],
      outs: ls.outs || 0, balls: ls.balls || 0, strikes: ls.strikes || 0,
      batter: m.batter || off.batter || null, pitcher: m.pitcher || (def && def.pitcher) || null,
      batSide: m.batSide ? m.batSide.code : null,
      pitches: seq, defense: def,
      // el recorrido del batazo mientras la jugada está fresca (o hasta el primer lanzamiento del turno siguiente)
      hit: end ? hitOf(cp) : seq && !seq.length && last ? hitOf(last) : null,
      onDeck: off.onDeck || fo.onDeck || null, li: d.liLive, upto: d.done.length
    };
  }

  // ---------- lo que hizo cada uno hoy (hasta el momento que se ve) ----------
  // Lo largo, más corto en la lista de "hoy": "ponche tirándole" -> "ponche", "rolata para doble play" -> "doble play"
  const SHORT = { 'ponche tirándole': 'ponche', 'ponche cantado': 'ponche', 'boleto intencional': 'boleto', 'rolata para doble play': 'doble play',
    'elevado de sacrificio': 'sacrificio', 'toque de sacrificio': 'sacrificio', 'selección, out': 'selección' };
  // Bateador: {ab, h, pa, ev: ['doble', 'elevadito']}
  function todayBat(d, id, upto) {
    const r = { ab: 0, h: 0, pa: 0, ev: [] };
    for (let i = 0; i < upto; i++) {
      const p = d.done[i], t = p.result && p.result.eventType;
      if (!t || !p.matchup || !p.matchup.batter || p.matchup.batter.id !== id || RUNNER.test(t)) continue;
      r.pa++;
      if (!NO_AB.has(t)) r.ab++;
      if (HITS.has(t)) r.h++;
      const e = C.eventEs(p).toLowerCase();
      r.ev.push(SHORT[e] || e);
    }
    return r;
  }
  // Lanzador: lanzamientos y strikes hasta el momento, y la jugada en que entró. Cada lanzamiento es de quien lo hizo
  // (C.pitchSeq: pitcherId; null, el que empezó el turno): con un relevo a mitad de turno, los de antes son del que
  // salió. Las bolas y strikes automáticos no son lanzamientos.
  function pitchesBy(d, plays, k, max, id) {
    const r = { n: 0, s: 0 }, q = plays[k], seq = seqOf(q);
    if (!seq) return r;
    const start = starterOf(d, plays, k);
    (max == null ? seq : seq.slice(0, max)).forEach(x => {
      if (x.auto || (x.pitcherId != null ? x.pitcherId : start) !== id) return;
      r.n++;
      if (STRIKE.has(x.call)) r.s++;
    });
    return r;
  }
  // ¿Pudo lanzar en la jugada q? (la terminó, o hubo un relevo dentro de ella)
  const mayPitch = (q, id) => !!q && ((q.matchup && q.matchup.pitcher && q.matchup.pitcher.id === id) || subIn(q));
  function todayPit(d, id, M) {
    const r = { n: 0, s: 0, first: null };
    const cur = M.play && M.play.about ? M.play.about.atBatIndex : null;
    for (let i = 0; i < M.upto; i++) {
      const p = d.done[i];
      if (!mayPitch(p, id) || (cur != null && p.about.atBatIndex === cur)) continue; // el turno a la vista, abajo
      const x = pitchesBy(d, d.done, i, null, id);
      if (r.first == null && (x.n || (p.matchup && p.matchup.pitcher && p.matchup.pitcher.id === id))) r.first = i;
      r.n += x.n; r.s += x.s;
    }
    if (M.play && M.pitcher && M.pitcher.id === id && !M.pause) {
      // lo que se ve del turno: en la repetición es la jugada k; en vivo, el turno en curso (o el que acaba de terminar)
      let plays = d.done, k = cur != null ? d.done.findIndex(p => p.about.atBatIndex === cur) : -1;
      if (k < 0) { plays = d.done.concat([M.play]); k = plays.length - 1; }
      const x = pitchesBy(d, plays, k, M.pitches ? M.pitches.length : null, id);
      if (r.first == null) r.first = plays === d.done ? k : -1;
      r.n += x.n; r.s += x.s;
    }
    return r;
  }

  // ---------- la pizarra ----------
  // Los outs los dicen los bombillos: en la línea de estado van solo para el lector.
  const outsSr = n => `<span class="sr"> · ${outsTxt(n)}</span>`;
  function statusHTML(d, M) {
    const g = d.feed.gameData, ls = M.ls, stObj = d.st || g.status || {};
    const label = C.statusText(stObj);
    const sched = ls.scheduledInnings || 9;
    const venue = `<span class="bt-venue">${esc(PC.venue(g.venue && g.venue.name))}</span>`;
    // d.finale: el final del juego (o de la repetición) con su banda sobre la pizarra del turno de la última jugada
    if (M.rep && !d.finale) {
      // en vivo (o suspendido) se vuelve a lo de ahora con un toque; el terminado tiene la repetición debajo
      const back = d.status === 'final' ? venue : `<button type="button" class="bt-back" data-go="ahora">${d.status === 'live' ? 'Volver al vivo' : 'Salir'}</button>`;
      return `<span class="pill rp-pill">Repetición</span> ${esc(halfLabel(M.inning, M.top))}${outsSr(M.outs)}${back}`;
    }
    if (d.status === 'live' && /delayed/i.test(stObj.detailedState || '')) return `<span class="pill warn">${esc(label || 'Juego detenido')}</span> ${esc(halfLabel(ls.currentInning, ls.isTopInning, ls.inningState))}${venue}`;
    if (d.status === 'live') {
      return `<span class="pill live"><i aria-hidden="true"></i>En vivo</span> ${esc(halfLabel(ls.currentInning, ls.isTopInning, ls.inningState))}${M.pause ? '' : outsSr(M.outs)}${label ? ` · ${esc(label)}` : ''}${venue}`;
    }
    if (d.status === 'final') {
      const tied = /tied/i.test(stObj.detailedState || '');
      return `<span class="pill fin">${esc(finalText(ls.currentInning, sched, stObj.reason, tied))}</span>${venue}`;
    }
    if (d.status === 'post' || d.status === 'susp') return `<span class="pill warn">${esc(label || (d.status === 'post' ? 'Pospuesto' : 'Suspendido'))}</span>${venue}`;
    const tbd = stObj.startTimeTBD || (g.datetime && g.datetime.startTimeTBD);
    const when = label || (tbd ? (g.game && g.game.gameNumber === 2 ? 'Al terminar el 1.º' : 'Hora por definir') : D.time(Date.parse(g.datetime.dateTime)));
    return `<span class="pill ${/demorado/.test(label || '') ? 'warn' : 'pre'}">${esc(when)}</span> ${esc(D.long(g.datetime.officialDate))}${venue}`;
  }

  // Marcador por inning con C-H-E. Cada casilla lleva data-k/data-v: si cambia, se prende (pizarra viva). Todo lleva
  // data-p (la tabla, las filas y las casillas): al repintar cambia solo la casilla que cambió, no la tabla.
  function lineHTML(d, M) {
    const ls = M.ls, st = M.st, tot = M.tot;
    const A = side(d, 'away'), H = side(d, 'home');
    const sched = ls.scheduledInnings || 9;
    const inns = st
      ? st.innings.map(I => ({ away: I.played.away ? I.away.r : null, home: I.played.home ? I.home.r : null }))
      : (ls.innings || []).map(I => ({
        away: I.away && I.away.runs != null ? I.away.runs : null,
        home: I.home && I.home.runs != null ? I.home.runs : null
      }));
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
    const now = (d.status === 'live' && !st) || !!st;
    // en la pausa entre medias entradas, la casilla de la mitad que viene
    const inn = M.pause ? M.nextInning : M.inning, top = M.pause ? M.nextTop : M.top;
    const isCur = (i, s) => now && i + 1 === inn && (s === 'away') === !!top;
    return `<div class="bt-line" data-p="ln"><table aria-label="Carreras por inning" data-p="t">
      <thead data-p="h"><tr data-p="r"><th data-p="e"><span class="sr">Equipo</span></th>${Array.from({ length: n }, (_, i) => `<th data-p="i${i}">${i + 1}</th>`).join('')}<th class="rhe" data-p="C">C</th><th class="rhe" data-p="H">H</th><th class="rhe" data-p="E">E</th></tr></thead>
      <tbody data-p="b">${[['away', A], ['home', H]].map(([s, t], r) => `<tr data-p="${s}"><th scope="row" data-p="n">${esc(t.abbr)}</th>${Array.from({ length: n }, (_, i) => {
        const v = cell(i, s);
        return `<td${isCur(i, s) ? ' class="cur"' : ''} data-p="i${i}" data-k="c${r}-${i}" data-v="${v}">${v}</td>`;
      }).join('')}<td class="rhe r" data-p="C">${tot[s].r}</td><td class="rhe" data-p="H">${tot[s].h}</td><td class="rhe" data-p="E">${tot[s].e}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  // La banda de los momentos: vive en la pizarra (data-keep: el repintado no la toca). En la del turno va sobre la
  // franja de comentario; en la de siempre, abajo, sobre la línea por inning.
  const BAND = '<div class="mo-band" data-p="mo" data-keep="mo" aria-hidden="true"></div>';

  // La pizarra de siempre: un juego terminado sin repetición, por jugar, pospuesto o suspendido.
  function boardClassic(d, M) {
    const g = d.feed.gameData;
    const A = side(d, 'away'), H = side(d, 'home');
    const pre = d.status === 'pre' || d.status === 'post';
    const score = s => M.tot[s].r;
    const lead = pre ? null : score('away') > score('home') ? 'away' : score('home') > score('away') ? 'home' : null;
    const rec = s => { const r = g.teams[s].record; return r && r.wins != null ? `${r.wins}-${r.losses}` : ''; };
    const teamRow = (s, t) => {
      const link = PC.TEAMS[t.id] ? `href="#/equipo/${t.id}"` : '';
      return `<div class="bt-row${lead === s ? ' lead' : ''}" data-p="${s}"><span class="bt-abbr">${esc(t.abbr)}</span>` +
        `<a class="bt-name" ${link} title="${esc(t.name)}">${esc(t.short)}<small>${rec(s)}</small></a>` +
        `<span class="bt-runs">${pre ? '' : score(s)}</span></div>`;
    };
    return `<p class="bt-status" data-p="st">${statusHTML(d, M)}</p>${teamRow('away', A)}${teamRow('home', H)}${pre ? '' : lineHTML(d, M) + BAND}`;
  }

  // Los bombillos B-S-O: la cuenta va una sola vez, aquí (topan solos en 3-2). Sin lanzamiento a lanzamiento (juegos
  // viejos, en la repetición), solo los outs.
  function bulbsHTML(d, M) {
    const b = Math.min(3, M.balls || 0), s = Math.min(2, M.strikes || 0), o = Math.min(3, M.outs || 0);
    const bl = (n, on, lab, key, said) => `<span class="bl" role="img" aria-label="${lab}: ${said}" data-p="${key}"><b aria-hidden="true">${lab[0]}</b><span>${Array.from({ length: n }, (_, i) => {
      const x = i < on ? 1 : 0;
      return `<i class="${x ? 'on' : ''}" data-k="${key}${i}" data-v="${x}"></i>`;
    }).join('')}</span></span>`;
    const cnt = !M.rep || d.byPitch;
    return `<div class="bl3" data-p="b">${cnt ? bl(3, b, 'Bolas', 'b', b) + bl(2, s, 'Strikes', 's', s) : ''}${bl(2, Math.min(2, o), 'Outs', 'o', o)}</div>`;
  }

  // El marcador en una línea con los bombillos a la derecha: MAG 3 – 3 ANZ · B S O. Las siglas van junto a sus
  // carreras (los nombres, solo con espacio: css/juegos.css). Las carreras ruedan cuando cambian. El lector oye
  // "Magallanes 3, Caribes 3": lo de la vista va escondido para él, salvo los enlaces a los equipos.
  function scoreHTML(d, M, withBases) {
    const A = side(d, 'away'), H = side(d, 'home');
    const r = s => M.tot[s].r;
    const lead = r('away') > r('home') ? 'away' : r('home') > r('away') ? 'home' : null;
    const tm = (s, t) => {
      const in_ = `<span class="bt-abbr" aria-hidden="true">${esc(t.abbr)}</span><span class="sc-nm" aria-hidden="true">${esc(t.short)}</span>`;
      return PC.TEAMS[t.id] ? `<a class="sc-t ${s}" href="#/equipo/${t.id}" title="${esc(t.name)}" aria-label="${esc(t.short)}" data-p="t${s[0]}">${in_}</a>`
        : `<span class="sc-t ${s}" title="${esc(t.name)}" aria-hidden="true" data-p="t${s[0]}">${in_}</span>`;
    };
    const n = s => `<span class="sc-r flip${lead === s ? ' lead' : ''}" data-p="r${s[0]}" data-k="r${s[0]}" data-v="${r(s)}" aria-hidden="true"><span class="n">${r(s)}</span></span>`;
    return `<div class="sc-row" data-p="scr"><div class="sc" data-p="sc"><span class="sr" data-p="sr">${esc(A.short)} ${r('away')}, ${esc(H.short)} ${r('home')}</span>` +
      `${tm('away', A)}${n('away')}<span class="sc-dash" data-p="dh" aria-hidden="true">–</span>${n('home')}${tm('home', H)}</div>` +
      bulbsHTML(d, M) + (withBases ? `<div class="cnt-bases" data-p="bs">${U.bases(M.bases, true)}</div>` : '') + '</div>';
  }

  // Campo y zona en una fila, y debajo la secuencia del turno a lo ancho. Son cajas de charts.js (data-keep): el
  // repintado no las toca. Si uno falló al dibujarse, ya no sale (sin campo, las bases van junto a los bombillos).
  // Sin lanzamiento a lanzamiento (juegos viejos), sin zona.
  function nowHTML(d) {
    const fld = has(CH, 'field') && !d.broken.fld, zn = d.byPitch && has(CH, 'zone') && !d.broken.zn;
    if (!fld && !zn) return '';
    return `<div class="tn-now${fld ? '' : ' sin-campo'}${zn ? '' : ' sin-zona'}" data-p="now">` +
      (fld ? '<div class="tn-field" data-p="fld" data-keep="fld"></div>' : '') +
      (zn ? '<div class="tn-zone" data-p="zn" data-keep="zn"></div><div class="tn-seq" data-p="sq" data-keep="sq"></div>' : '') + '</div>';
  }

  // La mano, corta a la vista ("Z") y en palabras para el lector. Si el turno no la trae (un relevo a mitad de turno),
  // la de la ficha del jugador en el juego.
  const HAND = { L: ['Z', 'zurdo'], R: ['D', 'derecho'], S: ['A', 'ambidiestro'] };
  const handOf = (d, id, k) => { const p = d.feed.gameData.players && d.feed.gameData.players['ID' + id]; return (p && p[k] && p[k].code) || null; };
  const handHTML = c => {
    const h = HAND[c];
    return h ? ` <small class="dc-mano" title="${h[1]}"><span aria-hidden="true">${h[0]}</span><span class="sr">${h[1]}</span></small>` : '';
  };
  // El duelo: dos tarjetas de tres líneas (rótulo con el turno o "Entró en el 5.º", nombre y lo de hoy). La temporada
  // está en la ficha del jugador, a un toque del nombre.
  function duelHTML(d, M) {
    const bat = M.batter, pit = M.pitcher;
    if (!bat && !pit) return '';
    let cards = '';
    if (bat) {
      const t = todayBat(d, bat.id, M.upto);
      const n = M.end ? t.pa : t.pa + 1;
      const hoy = t.pa ? `Hoy <b>${t.h}-${t.ab}</b>${t.ev.length ? `: ${esc(t.ev.join(', '))}` : ''}` : 'Primer turno del juego';
      // en la pausa entre medias entradas, el que abre la mitad que viene
      const lab = M.pause ? ['Abre', `${M.nextTop ? 'alta' : 'baja'} del ${ord(M.nextInning)}`] : ['Al bate', n ? `${ordM(n)} turno` : ''];
      cards += `<div class="dc" data-p="bat"><p class="dc-lab" data-p="l"><span>${lab[0]}</span>${lab[1] ? `<span>${lab[1]}</span>` : ''}</p>` +
        `<p class="dc-nm" data-p="n">${U.player(bat.id, bat.fullName)}${handHTML(M.batSide || handOf(d, bat.id, 'batSide'))}</p>` +
        `<p class="dc-ln" data-p="h">${hoy}</p></div>`;
    }
    if (pit) {
      const t = todayPit(d, pit.id, M);
      const p0 = t.first != null && t.first >= 0 ? d.done[t.first] : null;
      // abridor: nadie lanzó antes por su equipo (el que fildea en las altas es el home club)
      const before = top => d.done.slice(0, p0 ? t.first : M.upto).some(q => !!q.about.isTopInning === top);
      const top = M.pause ? !!M.nextTop : M.top;
      const ph = (!M.pause && M.play && M.play.matchup && M.play.matchup.pitcher && M.play.matchup.pitcher.id === pit.id && M.play.matchup.pitchHand ? M.play.matchup.pitchHand.code : null) || handOf(d, pit.id, 'pitchHand');
      const when = p0 ? (before(!!p0.about.isTopInning) ? `Entró en el ${ord(p0.about.inning)}` : 'Abridor')
        : top == null ? '' : before(!!top) ? 'Recién entra' : 'Abridor';
      cards += `<div class="dc" data-p="pit"><p class="dc-lab" data-p="l"><span>Lanza</span>${when ? `<span>${when}</span>` : ''}</p>` +
        `<p class="dc-nm" data-p="n">${U.player(pit.id, pit.fullName)}${handHTML(ph)}</p>` +
        (M.rep && !d.byPitch ? '' : `<p class="dc-ln" data-p="h"><b>${t.n}</b> <span aria-hidden="true">lanz.</span><span class="sr">lanzamiento${t.n === 1 ? '' : 's'}</span> · <b>${t.s}</b> strike${t.s === 1 ? '' : 's'}</p>`) + '</div>';
    }
    return `<div class="tn-duel" data-p="du">${cards}</div>`;
  }

  // Las fichas de contexto, en una fila que se desliza: el que viene, la presión del turno y el historial entre los
  // dos (un toque). Sin "Viene" en la pausa entre medias entradas ni cuando el turno cerró el inning.
  function ctxHTML(d, M) {
    const bat = M.batter, pit = M.pitcher, cx = [];
    const closed = M.end && M.outs >= 3;
    if (M.onDeck && !M.pause && !closed && (!bat || M.onDeck.id !== bat.id)) {
      const t = todayBat(d, M.onDeck.id, M.upto);
      cx.push(`<span class="cx" data-p="od">${M.end ? 'Viene' : 'En cubierta'} <b>${esc(surname(M.onDeck.fullName))}</b>${t.pa ? ` (${t.h}-${t.ab})` : ''}</span>`);
    }
    // la presión solo cuando pesa (LI de 1 en adelante), con punto decimal como la EFE; el aro desde 1,5
    if (M.li != null && M.li >= 1) cx.push(`<span class="cx${M.li >= 1.5 ? ' hot' : ''}" data-p="li" title="Presión del turno (LI): 1 es lo normal">Presión <b>×${F.dec1(M.li)}</b></span>`);
    const key = bat && pit ? `${bat.id}-${pit.id}` : '';
    const vs = key ? d.vs.get(key) : null, busy = vs === 'cargando';
    if (key && has(API, 'vsPlayer')) {
      const got = !!vs && !busy;
      cx.push(`<button type="button" class="cx vs-btn" data-p="vs" data-vs="${key}"${busy ? ' aria-disabled="true"' : ''}${got ? ` aria-expanded="${d.vsOpen === key}"` : ''}>${busy ? 'Buscando…' : 'Cara a cara'}</button>`);
    }
    // el historial, en una región que el lector anuncia (role=status): ya está mientras se busca (vacía); el botón
    // lo muestra y lo esconde
    let out = null;
    if (key && vs) out = busy ? '' : d.vsOpen !== key ? null : vs === 'error' ? 'No se pudo traer el historial entre los dos.' : vs;
    return (cx.length ? `<div class="tn-ctx" data-p="cx">${cx.join('')}</div>` : '') +
      (out == null ? '' : `<p class="vs-out" role="status" data-p="vso">${out}</p>`);
  }

  // Lo último que pasó: la jugada (si terminó) o "Antes:" la anterior, con la acción del turno (cambio, robo…).
  const ACTIONS = new Set(['pitching_substitution', 'offensive_substitution', 'defensive_substitution', 'defensive_switch', 'runner_placed',
    'stolen_base_2b', 'stolen_base_3b', 'stolen_base_home', 'caught_stealing_2b', 'caught_stealing_3b', 'caught_stealing_home',
    'pickoff_1b', 'pickoff_2b', 'pickoff_3b', 'pickoff_caught_stealing_2b', 'pickoff_caught_stealing_3b', 'pickoff_caught_stealing_home',
    'wild_pitch', 'passed_ball', 'balk', 'defensive_indiff', 'other_advance', 'error']);
  // Sin el tipo de evento (la vigilancia no lo trae) se descartan por el texto los que no cuentan nada.
  const NOISE = /^(viraje|visita al mont|tiempo del|cambio de estatus|bola autom|strike autom|mound visit|batter timeout|pickoff attempt)/i;
  function lastHTML(d, M) {
    const P = M.play;
    let html = '';
    if (M.end && P && P.result && P.result.description) {
      html = (P.result.eventType === 'home_run' ? '<b class="tag">Jonrón</b>' : '') + esc(C.cleanEs(P.result.description));
    } else {
      // la acción más reciente del turno hasta el lanzamiento que se ve: lo que pasa después de un lanzamiento (un robo,
      // un wild pitch) va con él, hasta antes del siguiente (index de C.pitchSeq, como en C.stateAtPitch). En la pausa
      // entre medias entradas, solo lo que pasó.
      const seq = M.rep ? seqOf(P) : null, nx = seq && M.pitches ? seq[M.pitches.length] : null;
      const lim = nx && nx.index != null ? nx.index : Infinity;
      let act = '';
      if (!M.pause) {
        ((P && P.playEvents) || []).forEach((e, i) => {
          const ix = e.index != null && isFinite(+e.index) ? +e.index : i, dt = e.details || {}, et = dt.eventType;
          if (e.isPitch || !(ix < lim) || !dt.description) return;
          if (et ? ACTIONS.has(et) : !NOISE.test(dt.description)) act = dt.description;
        });
      }
      const prev = M.rep ? d.done[M.k - 1] : d.done[d.done.length - 1];
      const before = prev && prev.result && prev.result.description ? `<b class="lp-antes">Antes:</b> ${esc(C.cleanEs(prev.result.description))}` : '';
      html = [before, act ? esc(C.cleanEs(act)) : ''].filter(Boolean).join(' ');
    }
    return html ? `<p class="lastplay" data-p="lp"><span class="lp-t">${html}</span></p>` : '';
  }

  // La pizarra con el turno arriba (en vivo y en la repetición), en filas fijas. La franja de comentario (.tn-com:
  // fichas, historial y última jugada) mide al menos lo que la banda, que va encima de ella y no tapa nada más.
  function boardTurno(d, M) {
    const fld = has(CH, 'field') && !d.broken.fld;
    return `<p class="bt-status" data-p="st">${statusHTML(d, M)}</p>${scoreHTML(d, M, !fld)}${nowHTML(d)}${duelHTML(d, M)}` +
      `<div class="tn-com" data-p="com">${ctxHTML(d, M)}${lastHTML(d, M)}${BAND}</div>${lineHTML(d, M)}`;
  }
  const turnoOn = d => d.cursor != null || d.status === 'live';

  // ---------- campo y zona (charts.js) dentro de la pizarra ----------
  // Se crean una vez por caja y después solo se actualizan con lo que cambió: nunca se rehace el SVG en un arrastre.
  function kill(c) { if (c && c.ctl && typeof c.ctl.destroy === 'function') safe(() => c.ctl.destroy()); }
  function chart(d, name, box, data, make, upd) {
    let c = d.ctl[name];
    if (c && c.box !== box) { kill(c); c = d.ctl[name] = null; }
    if (!box) return;
    const key = JSON.stringify(data);
    if (c && (c.key === key || c.failed)) return;
    try {
      if (c && c.ctl && typeof c.ctl.update === 'function') upd(c.ctl, data);
      else { if (c) kill(c); c = d.ctl[name] = { box, ctl: make(box, data) || null }; }
      c.key = key;
    } catch (e) {
      console.warn('juego', name, e);
      box.hidden = true; // falló: esa parte no sale (y en la próxima pintada ya no se pide)
      d.ctl[name] = { box, ctl: null, key, failed: true };
      d.broken[name] = true;
    }
  }
  // Las bases como las quiere charts.js: {id, fullName} o null. Un corredor sin nombre (un emergente que la API no
  // nombra) lo busca en los jugadores del juego.
  function basesOf(d, M) {
    const ps = d.feed.gameData.players || {};
    return [0, 1, 2].map(i => {
      const b = M.bases && M.bases[i];
      if (!b) return null;
      if (typeof b !== 'object') return { id: null, fullName: '' };
      if (b.fullName || b.id == null) return b;
      const p = ps['ID' + b.id];
      return p && p.fullName ? { id: b.id, fullName: p.fullName } : b;
    });
  }
  // Lo que reciben el campo y la zona en un momento (la pizarra y el modo TV).
  function chartData(d, M) {
    const bases = basesOf(d, M);
    // el bateador que ya está en base (al cerrar la jugada, o en vivo mientras la API la termina de anotar) no sigue en
    // el plato
    const batter = M.batter && bases.some(b => b && b.id != null && b.id === M.batter.id) ? null : M.batter || null;
    return {
      fld: { defense: M.defense || null, bases, batter, batSide: batter ? M.batSide || null : null, lastHit: M.hit || null },
      zn: { pitches: M.pitches || [], box: d.zbox || null, batSide: M.batSide || null }
    };
  }
  // CH.responsive los redibuja al girar el teléfono con lo último que les llegó por update (charts.js lo guarda).
  // La zona va sin la cuenta (la dicen los bombillos) y sin la leyenda (está en Jugadas, al abrir un turno).
  function boardCharts(d, board, M) {
    const A = side(d, 'away'), H = side(d, 'home');
    const cd = chartData(d, M);
    const fb = board && board.querySelector('.tn-field');
    // el zurdo va a la derecha del plato: "Ver defensa" pasa a la otra esquina (css/juegos.css)
    if (fb && fb.classList.contains('bat-z') !== (!!cd.fld.batter && M.batSide === 'L')) fb.classList.toggle('bat-z');
    chart(d, 'fld', fb, cd.fld,
      (box, s) => { const o = { away: A.abbr, home: H.abbr }; return CH.responsive(box, () => CH.field(box, s, o)); },
      (ctl, s) => ctl.update(s));
    const seq = board && board.querySelector('.tn-seq');
    chart(d, 'zn', board && board.querySelector('.tn-zone'), cd.zn,
      (box, z) => {
        const o = { box: z.box, batSide: z.batSide, seqBox: seq || undefined, count: false, legend: false };
        return CH.responsive(box, () => CH.zone(box, z.pitches, o));
      },
      (ctl, z) => ctl.update(z.pitches, { box: z.box, batSide: z.batSide }));
  }

  // ---------- pizarra viva: lo que cambió se prende (carreras que ruedan, la casilla del inning, bombillos, bases) ----------
  function valuesOf(board) {
    const m = new Map();
    board.querySelectorAll('[data-k]').forEach(n => m.set(n.dataset.k, n.dataset.v));
    return m;
  }
  function markChanges(board, before) {
    board.querySelectorAll('[data-k]').forEach(n => {
      const k = n.dataset.k, v0 = before.get(k), v = n.dataset.v;
      if (v0 === undefined || v0 === v) return;
      // una casilla del inning solo se prende si entró una carrera (no al empezar la mitad con un 0)
      if (k[0] === 'c' && !(+v > 0)) return;
      n.dataset.prev = v0;
      n.classList.add('chg');
    });
  }
  // La base a la que llega un corredor destella (las bases del campo de charts.js: .gf-base[data-base]). Primero se
  // leen las medidas de todas y después se escribe.
  function baseFlash(el, d, M, anim) {
    const was = d.bs || [], now = [0, 1, 2].map(i => !!(M.bases && M.bases[i]));
    d.bs = now;
    if (!anim) return;
    const wrap = el.querySelector('.board-wrap'), fb = wrap && wrap.querySelector('.tn-field');
    if (!fb) return;
    const lit = now.map((on, i) => (on && !was[i] ? fb.querySelector(`[data-base="${i + 1}"]`) : null)).filter(Boolean);
    if (!lit.length) return;
    const w = wrap.getBoundingClientRect(), at = lit.map(b => b.getBoundingClientRect());
    at.forEach(r => {
      const x = document.createElement('i');
      x.className = 'base-luz';
      x.setAttribute('aria-hidden', 'true');
      x.style.left = (r.left + r.width / 2 - w.left).toFixed(1) + 'px';
      x.style.top = (r.top + r.height / 2 - w.top).toFixed(1) + 'px';
      wrap.appendChild(x);
      setTimeout(() => x.remove(), 1000);
    });
  }

  // La pizarra entera. how: 'paso' (en vivo o la repetición andando: con la pizarra viva), 'cuadro' (un cuadro de un
  // arrastre: solo escribe, sin leer ninguna medida) o nada (un salto: todo, sin animar).
  function paintBoard(el, d, how) {
    const wrap = el.querySelector('.board-wrap'), board = wrap && wrap.querySelector('.board');
    if (!board) return;
    const M = moment(d), on = turnoOn(d);
    const anim = how === 'paso' && !reduced();
    const before = anim && on && board.classList.contains('turno') ? valuesOf(board) : null;
    if (board.classList.contains('turno') !== on) board.classList.toggle('turno', on);
    paint(board, on ? boardTurno(d, M) : boardClassic(d, M));
    const broke = Object.keys(d.broken).length;
    boardCharts(d, on ? board : null, M);
    // un dibujo acaba de fallar: la pizarra otra vez, ya sin él (y con las bases junto a los bombillos si era el campo)
    if (on && Object.keys(d.broken).length > broke) { paint(board, boardTurno(d, M)); boardCharts(d, board, M); }
    if (before) markChanges(board, before);
    watchScore(d, board);
    if (how === 'cuadro') { d.bs = [0, 1, 2].map(i => !!(M.bases && M.bases[i])); return; }
    baseFlash(el, d, M, !!before);
    showInning(el);
  }

  // ---------- la repetición fija abajo ----------
  // Mientras la pizarra ocupa la pantalla, la repetición queda fija abajo (css/juegos.css) y se achica: solo el botón y
  // el deslizador. El texto y la velocidad vuelven en su lugar, justo debajo de la pizarra. "Pegada" sale de un
  // marcador de alto 0 en el lugar de la barra (.rp-marca, al pie de la pizarra, donde ella empieza): si la barra
  // entera, en su lugar, ya no cabría sobre la barra de secciones, va pegada. No depende del alto que tenga en ese momento: no parpadea.
  function watchBar(el, d) {
    if (d.bio) { d.bio.disconnect(); d.bio = null; }
    const mk = el.querySelector('.rp-marca'), rp = el.querySelector(':scope > .replay');
    if (!mk || !rp || typeof IntersectionObserver === 'undefined') return;
    // lo que ocupa abajo: la barra entera (sin pegar) y su distancia al borde (bottom de css/juegos.css); se lee una
    // vez, después del cuadro siguiente al pintar (con el cálculo ya hecho: no lo fuerza)
    requestAnimationFrame(() => setTimeout(() => {
      if (!mk.isConnected) return;
      const was = rp.classList.contains('pegada');
      if (was) rp.classList.remove('pegada');
      const h = rp.offsetHeight, b = parseFloat(getComputedStyle(rp).bottom) || 0;
      if (was) rp.classList.add('pegada');
      const quieta = getComputedStyle(rp).position !== 'sticky'; // apaisado: la barra va en su lugar
      d.bio = new IntersectionObserver(es => {
        const e = es[es.length - 1];
        const on = !quieta && !e.isIntersecting && e.boundingClientRect.top > (e.rootBounds ? e.rootBounds.top : 0);
        if (rp.classList.contains('pegada') !== on) rp.classList.toggle('pegada', on);
      }, { rootMargin: `0px 0px -${Math.round(h + b)}px 0px` });
      d.bio.observe(mk);
    }, 0));
  }

  // ---------- la línea de innings: lo que se ve y lo que queda escondido ----------
  // C, H y E van fijas a la derecha (styles.css) y los innings que no caben pasan por debajo: un inning se ve si
  // queda a la izquierda de C, no del borde de la línea. FADE: lo que ocupa el degradado que avisa que hay más, junto
  // a C (sus 24 px y los 2 de la sombra de C) o en el borde izquierdo (css/juegos.css).
  const FADE = 26;
  // La pista: .ln-r en la pizarra si queda algún inning debajo de C-H-E, .ln-l si se fueron por la izquierda.
  // Va en .board y no en la línea: paint() compara la línea con la nueva y una clase de más la haría rehacer.
  function lineEdges(board, line) {
    const max = line.scrollWidth - line.clientWidth, x = line.scrollLeft;
    if (board.classList.contains('ln-l') !== x > 1) board.classList.toggle('ln-l', x > 1);
    if (board.classList.contains('ln-r') !== x < max - 1) board.classList.toggle('ln-r', x < max - 1);
  }
  // El inning en juego (o el de la jugada elegida en la repetición) a la vista, fuera del degradado. Solo cuando
  // cambia la casilla en juego o con force (al girar, al llegar la letra): si la persona deslizó la línea para ver otro
  // inning, un lanzamiento no se la devuelve. Sin cambio, no lee nada.
  function showInning(el, force) {
    const board = el.querySelector('.board-wrap > .board'), line = board && board.querySelector('.bt-line');
    if (!line) return;
    const cur = line.querySelector('td.cur');
    const k = cur ? `${cur.parentNode.dataset.p}-${cur.dataset.p}` : '';
    if (!force && k === board._cur && line === board._line) return;
    board._cur = k;
    board._line = line;
    if (cur) {
      const r = cur.getBoundingClientRect(), lr = line.getBoundingClientRect(), c = cur.parentNode.querySelector('.rhe');
      const end = (c ? c.getBoundingClientRect().left : lr.right) - FADE, start = lr.left + FADE;
      const max = line.scrollWidth - line.clientWidth;
      // si lo que quedaría escondido de ese lado es poco (la columna de los equipos, un inning), hasta el borde
      if (r.right > end) { const x = line.scrollLeft + r.right - end; line.scrollLeft = x > max - 2 * FADE ? max : x; }
      else if (r.left < start) { const x = line.scrollLeft - (start - r.left); line.scrollLeft = x < 2 * FADE ? 0 : x; }
    }
    lineEdges(board, line);
  }
  // La pista sigue a la persona cuando desliza la línea (scroll no burbujea: se escucha en la captura).
  document.addEventListener('scroll', e => {
    const t = e.target, b = t && t.classList && t.classList.contains('bt-line') && t.closest('.board');
    if (b) lineEdges(b, t);
  }, { capture: true, passive: true });
  // Al girar el teléfono cambia lo que cabe: la pista se recalcula y el inning en juego vuelve a la vista. Lo segundo
  // solo si cambió el ancho: en el teléfono la barra del navegador cambia el alto al desplazarse la página.
  let lastW = root.innerWidth, lastH = root.innerHeight;
  root.addEventListener('resize', () => {
    const w = root.innerWidth, h = root.innerHeight, el = view && view.el;
    if (el && w !== lastW) { showInning(el, true); moveInd(el, true); }
    // la barra de la repetición: su alto y lo que hay abajo cambian al girar (y con la letra)
    if (el && view.d && (w !== lastW || Math.abs(h - lastH) > 120)) watchBar(el, view.d);
    lastW = w; lastH = h;
  });

  // ---------- momentos: banda amarilla sobre la franja de comentario, una a la vez ----------
  // En vivo hacen cola: la primera dura 8 s y las que esperaban (2 como mucho) 4 s cada una. En la repetición, la más
  // importante del paso reemplaza a la que está (la repetición corre más que la banda); en el último paso, o con la
  // repetición detenida, esperan hasta 2. Escape o un toque la cierran. El lector la oye por #vivo-sr (en la
  // repetición, solo a 1× y solo carreras, jonrones y sin hits); la banda es solo para la vista.
  const RANK = { jonron: 5, carrera: 4, nohit: 3, cambio: 2, fin: 1 };
  const rank = m => RANK[m.type] || 0;
  const SAY_REP = new Set(['jonron', 'carrera', 'nohit']);
  // Los momentos nuevos de las jugadas fromK (sin incluir) a toK (calc.js), con las siglas de los equipos en los títulos.
  // plays: las jugadas completas y, en vivo, el turno en curso (solo para sus cambios de lanzador: así sale cuando
  // pasa y no al terminar ese turno). Cada momento sale una sola vez (d.seen; un cambio por su evento, ix: dos relevos
  // en el mismo turno son dos bandas). only: solo ese tipo, y pred: solo los que cumplen (los demás no se marcan).
  // La clave de un momento (un cambio de lanzador por su evento, ix: dos relevos en el mismo turno son dos bandas).
  const moKey = m => `${m.type}|${m.k}|${m.ix != null ? m.ix : ''}|${m.title}`;
  function momentsOf(d, fromK, toK, plays, only, pred) {
    if (!has(C, 'moments') || toK <= fromK) return [];
    const list = safe(C.moments, plays || d.done, fromK, toK, d.feed.liveData.linescore, { away: side(d, 'away').abbr, home: side(d, 'home').abbr }) || [];
    return list.filter(m => {
      if ((only && m.type !== only) || (pred && !pred(m))) return false;
      const key = moKey(m);
      if (d.seen.has(key)) return false;
      d.seen.add(key);
      return true;
    });
  }
  // El turno en curso, si no ha terminado (va al final de las jugadas para los momentos en vivo).
  const playing = d => { const cp = d.feed.liveData.plays.currentPlay; return cp && cp.about && !cp.about.isComplete ? cp : null; };
  // Los cambios de lanzador del turno en curso (en vivo): las carreras y los jonrones salen al terminar el turno, ya
  // sumados (una carrera por wild pitch a mitad de turno no sale dos veces).
  const changesNow = d => { const cp = playing(d); return cp ? momentsOf(d, d.done.length - 1, d.done.length, d.done.concat([cp]), 'cambio') : []; };
  // De una lista, las n más importantes, en su orden.
  function topOf(list, n) {
    if (list.length <= n) return list;
    const keep = list.slice().sort((a, b) => rank(b) - rank(a)).slice(0, n);
    return list.filter(m => keep.indexOf(m) >= 0);
  }
  // how: 'vivo' (cola), 'paso' (la repetición andando: la más importante reemplaza) o 'fin' (último paso o
  // repetición detenida: esperan hasta 2).
  function pushMoments(el, d, list, how) {
    if (!list || !list.length) return;
    if (how !== 'vivo') list.forEach(m => { m.rep = true; });
    // con el modo TV abierto, la banda sale allá (en vivo, con su retraso: tvLive); lo que sale en la pizarra ya no
    // vuelve a salir en el modo TV
    if (tvOn(d)) { if (!tv.live) tvMoments(list, how); return; }
    if (how === 'vivo') { const seen = tvSeen(d); list.forEach(m => seen.add(moKey(m))); }
    if (how === 'paso') {
      d.mq = [topOf(list, 1)[0]];
      showMoment(el, d, true);
      return;
    }
    if (how === 'fin') { d.mq = []; list = topOf(list, 2); if (d.mo) d.mo = null; }
    list.forEach(m => { m.waited = !!d.mo || d.mq.length > 0; d.mq.push(m); });
    // como mucho 2 esperando (las más importantes)
    if (d.mo) d.mq = topOf(d.mq, 2);
    else if (d.mq.length > 3) d.mq = [d.mq[0]].concat(topOf(d.mq.slice(1), 2));
    if (!d.mo) showMoment(el, d);
  }
  function clearMoments(el, d) {
    d.mq = [];
    if (d.mo) showMoment(el, d);
  }
  // now: reemplaza a la que está sin esperar (la repetición andando).
  function showMoment(el, d, now) {
    clearTimeout(d.mt);
    d.mt = 0;
    const box = el.querySelector('.board .mo-band');
    const m = d.mq.shift() || null, was0 = d.mo;
    d.mo = m;
    if (!box) { d.mq = []; d.mo = null; if (was0) paintChapita(d); return; }
    if (!m) {
      box.classList.remove('in');
      // terminó la banda del final de la repetición: la pizarra de siempre
      if (d.finale) { d.finale = false; d.cursor = null; d.pitch = null; still(el, () => update(el, d)); }
      else paintChapita(d); // la chapita vuelve a la jugada
      return;
    }
    // con la pizarra fuera de la vista, el título va en la chapita (y destella si no tenía otro)
    paintChapita(d);
    if (!was0 && !m.rep) flashChapita(d);
    const parts = String(m.title || '').split(' · ');
    const ms = m.waited && !now ? WAIT_MS : BAND_MS;
    const was = box.classList.contains('in');
    box.className = `mo-band ${m.type || ''}${was ? ' in' : ''}`;
    box.innerHTML = `<p class="mo-h"><b class="mo-t">${esc(parts[0])}</b>${parts.length > 1 ? `<span class="mo-s">${esc(parts.slice(1).join(' · '))}</span>` : ''}</p>` +
      (m.text ? `<p class="mo-d">${esc(m.text)}</p>` : '') + `<span class="mo-bar"><i style="animation-duration:${ms}ms"></i></span>`;
    // jonrón: además se prenden las estrellas de la bandera, arriba (la banda no las tapa)
    if (m.type === 'jonron') stars(el);
    if (!was) requestAnimationFrame(() => { if (d.mo === m) box.classList.add('in'); });
    if (!m.rep || ((d.speed || 1) === 1 && SAY_REP.has(m.type))) say(el, d, [parts.join(', '), m.text || ''].filter(Boolean).join('. '));
    d.mt = setTimeout(() => showMoment(el, d), ms);
  }
  // Escape cierra la banda (y sale la siguiente, si espera alguna).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !view || !view.d || !view.d.mo) return;
    showMoment(view.el, view.d);
  });

  // ---------- lo que oye el lector de pantalla (#vivo-sr) ----------
  // De a uno: lo que llega mientras dice algo espera su turno (2,5 s entre uno y otro, y un respiro de 250 ms para que
  // el lector vea la región antes del texto si la pantalla se acaba de rehacer).
  function say(el, d, txt) {
    if (!txt || tvOn(d)) return; // con el modo TV abierto, habla el modo TV (con su retraso)
    d.srq.push(txt);
    if (!d.srt) sayNext(el, d);
  }
  function sayNext(el, d) {
    const wait = Math.max(250, (d.srAt || 0) + 2500 - Date.now());
    d.srt = setTimeout(() => {
      d.srt = 0;
      const t = d.srq.shift(), box = el.querySelector('#vivo-sr');
      if (t == null || !box || !box.isConnected) { d.srq = []; return; }
      box.textContent = t;
      d.srAt = Date.now();
      if (d.srq.length) sayNext(el, d);
    }, wait);
  }

  // Jonrón: las 8 estrellas de la pizarra se prenden de izquierda a derecha (centros en el viewBox 220×96 de --stars,
  // que styles.css pone a 34 px del borde de arriba y centrado, 230×100).
  const STARS = [[13.45, 81.4], [29.55, 47.9], [56.75, 22.65], [91.45, 9.05], [128.55, 9.05], [163.25, 22.65], [190.45, 47.9], [206.55, 81.4]];
  function stars(el) {
    if (reduced()) return;
    const wrap = el.querySelector('.board-wrap'), board = wrap && wrap.querySelector('.board');
    if (!board) return;
    wrap.querySelectorAll('.estrella').forEach(e => e.remove());
    const s = 100 / 96, x0 = board.clientWidth / 2 - 115 + 0.42;
    STARS.forEach(([x, y], i) => {
      const e = document.createElement('i');
      e.className = 'estrella';
      e.setAttribute('aria-hidden', 'true');
      e.style.cssText = `--i:${i};left:${(x0 + x * s).toFixed(1)}px;top:${(34 + y * s).toFixed(1)}px`;
      wrap.appendChild(e);
    });
    setTimeout(() => wrap.querySelectorAll('.estrella').forEach(e => e.remove()), 2000);
  }

  // ---------- mini pizarra fija ("chapita"): aparece bajo la cabecera cuando el marcador sale de la pantalla ----------
  // Dos líneas: el marcador, el inning, las bases, los outs y la cuenta; y debajo la jugada del momento, corta ("Doble
  // de Marcano"; a mitad de turno, "Turno de Cedeño"). Mientras se arrastra la curva es lo que se mueve. Cada pieza
  // lleva su data-p: al cambiar la cuenta o las bases se cambia solo esa pieza (las bases, en su lugar).
  // Insignia con las siglas de la pizarra (en otras ligas, las del equipo de la API).
  function chipSide(d, s, size) {
    const t = side(d, s);
    return PC.TEAMS[t.id] ? chipOf({ id: t.id, name: t.name }, size) : `<span class="tchip ${size || ''}" title="${esc(t.name)}">${esc(t.abbr)}</span>`;
  }
  // La jugada del momento, corta: "Doble de Marcano", "Turno de Cedeño", "Abre Sucre".
  function playShort(M) {
    const b = M.batter, who = b ? surname(b.fullName) : '';
    if (M.pause) return who ? `Abre ${who}` : '';
    const P = M.play, t = P && P.result && P.result.eventType;
    if (M.end && t) {
      const e = C.eventEs(P).toLowerCase(), s = SHORT[e] || e, cap = s.charAt(0).toUpperCase() + s.slice(1);
      return RUNNER.test(t) || !who ? cap : `${cap} de ${who}`;
    }
    return who ? `Turno de ${who}` : '';
  }
  function chapitaHTML(d, M) {
    M = M || moment(d);
    const tm = s => `<span class="ch-tm" data-p="${s}">${chipSide(d, s, 's inv')}<b>${M.tot[s].r}</b></span>`;
    const inn = M.inning ? `${M.top ? '▲' : '▼'}${M.inning}` : '';
    const bases = U.bases(M.bases).replace('<svg ', '<svg data-p="b" ');
    const outs = `<span data-p="o">${U.outs(M.outs)}</span>`;
    const cnt = M.rep && !d.byPitch ? '' : `<b class="ch-cnt" data-p="c">${Math.min(3, M.balls || 0)}-${Math.min(2, M.strikes || 0)}</b>`;
    // mientras dura la banda de un momento (que está en la pizarra, fuera de la vista), su título va en lugar de la
    // jugada: "CARRERA · MAG 4-3"
    const pl = t => (d.mo && d.mo.title ? `<span class="ch-mo ${esc(d.mo.type || '')}" data-p="mo">${esc(d.mo.title)}</span>` : t ? `<span class="ch-pl" data-p="pl">${esc(t)}</span>` : '');
    let right, two = '';
    if (M.rep) {
      right = `<span class="ch-inn" data-p="in">${inn}</span>${bases}${outs}${cnt}`;
      two = (d.finale ? '' : `<span class="ch-tag" data-p="tg"><span class="ch-tag-l">Repetición</span><span class="ch-tag-s" aria-hidden="true">REP</span></span>`) + pl(playShort(M));
    } else if (d.status === 'live') {
      const stObj = d.st || d.feed.gameData.status || {};
      if (/delayed/i.test(stObj.detailedState || '')) right = `<span class="ch-inn" data-p="in">${inn}</span><span class="ch-txt" data-p="tx">Detenido</span>`;
      else if (M.pause) right = `<span class="ch-inn" data-p="in">${M.state === 'Middle' ? 'Mitad' : 'Fin'} ${ord(M.inning)}</span>`;
      else right = `<span class="ch-inn" data-p="in">${inn}</span>${bases}${outs}${cnt}`;
      two = pl(playShort(M));
    } else if (d.status === 'final') {
      const ls = M.ls, stObj = d.st || d.feed.gameData.status || {};
      const sub = finalSub(ls.currentInning, ls.scheduledInnings, stObj.reason, /tied/i.test(stObj.detailedState || ''));
      right = `<span class="ch-txt" data-p="tx">Final</span>${sub ? `<small data-p="sb">${esc(sub)}</small>` : ''}`;
    } else right = `<span class="ch-txt" data-p="tx">${esc(C.statusText(d.st || d.feed.gameData.status) || 'Suspendido')}</span>`;
    return `<span class="ch-l1" data-p="l1">${tm('away')}${tm('home')}<span class="ch-sep" data-p="sep"></span><span class="ch-st" data-p="st">${right}</span></span>` +
      (two ? `<span class="ch-l2" data-p="l2">${two}</span>` : '');
  }

  let chapEl = null;
  // Alto de la cabecera fija más la franja tricolor: lo deja core.js en --top-h (sin medir aquí).
  const topH = () => { const v = parseFloat(document.documentElement.style.getPropertyValue('--top-h')); return v > 0 ? v : 62; };
  function chapita() {
    if (chapEl) return chapEl;
    chapEl = document.createElement('div');
    chapEl.className = 'chapita';
    chapEl.innerHTML = '<button type="button" class="ch-in" aria-label="Subir a la pizarra"></button>';
    chapEl.firstChild.addEventListener('click', () => {
      const w = document.querySelector('#view .board-wrap');
      if (!w) return;
      const y = w.getBoundingClientRect().top + window.scrollY - topH() - 8;
      window.scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'auto' : 'smooth' });
    });
    document.body.appendChild(chapEl);
    return chapEl;
  }
  // Lo que dice el lector al llegar a la chapita: el marcador y el momento, y luego qué hace el botón.
  function chapitaLabel(d, M) {
    M = M || moment(d);
    const A = side(d, 'away'), H = side(d, 'home');
    const half = M.inning ? halfLabel(M.inning, M.top, M.state).toLowerCase() : '';
    const cnt = M.rep && !d.byPitch ? '' : `, cuenta ${Math.min(3, M.balls || 0)}-${Math.min(2, M.strikes || 0)}`;
    let when = '';
    if (M.rep && !d.finale) when = `repetición, ${half}, ${outsTxt(M.outs)}${cnt}`;
    else if (d.status === 'live') {
      const stopped = /delayed/i.test((d.st || d.feed.gameData.status || {}).detailedState || '');
      when = stopped ? [half, 'juego detenido'].filter(Boolean).join(', ')
        : M.pause ? half : [half, outsTxt(M.outs)].filter(Boolean).join(', ') + cnt;
    } else if (d.status === 'final') when = 'final';
    else when = (C.statusText(d.st || d.feed.gameData.status) || '').toLowerCase();
    const pl = M.rep || d.status === 'live' ? playShort(M) : '';
    return `${A.abbr} ${M.tot.away.r}, ${H.abbr} ${M.tot.home.r}${when ? `, ${when}` : ''}.${pl ? ` ${pl}.` : ''} Subir a la pizarra`;
  }
  function paintChapita(d) {
    if (!chapEl) return;
    if (d.chOn) {
      const M = moment(d); // uno solo para las dos (en un arrastre, en cada cuadro)
      paint(chapEl.firstChild, chapitaHTML(d, M));
      const lab = chapitaLabel(d, M);
      if (chapEl.firstChild.getAttribute('aria-label') !== lab) chapEl.firstChild.setAttribute('aria-label', lab);
    }
    if (chapEl.classList.contains('on') !== !!d.chOn) chapEl.classList.toggle('on', !!d.chOn);
  }
  // Tocar una jugada clave o un batazo del mapa no sube la página: la chapita destella una vez (sin "menos movimiento").
  function flashChapita(d) {
    if (!chapEl || !d.chOn || reduced()) return;
    chapEl.classList.remove('destella');
    requestAnimationFrame(() => {
      chapEl.classList.add('destella');
      clearTimeout(chapEl._t);
      chapEl._t = setTimeout(() => chapEl.classList.remove('destella'), 650);
    });
  }
  function unwatch(d) {
    if (d.io) { d.io.disconnect(); d.io = null; }
    d.ioT = null;
    d.chOn = false;
    if (chapEl) chapEl.classList.remove('on');
  }
  // La fila del marcador (en la pizarra de siempre, la del home club): la chapita sale cuando queda bajo la cabecera.
  const scoreEl = board => board.querySelector('.sc-row') || board.querySelector('.bt-row[data-p="home"]') || board;
  // Al repintar: si la fila es otra (la pizarra cambió de forma), el observador pasa a ella.
  function watchScore(d, board) {
    if (!d.io) return;
    const t = scoreEl(board);
    if (t === d.ioT) return;
    if (d.ioT) d.io.unobserve(d.ioT);
    d.ioT = t;
    d.io.observe(t);
  }
  function watchBoard(el, d) {
    const board = el.querySelector('.board-wrap > .board');
    if (!board || typeof IntersectionObserver === 'undefined' || d.status === 'pre' || d.status === 'post') { unwatch(d); return; }
    if (d.io) d.io.disconnect(); // al rehacer la pantalla la chapita no se esconde: el observador nuevo decide
    // la chapita se pega bajo la cabecera con --top-h (core.js lo renueva si la cabecera cambia de alto); aquí el alto
    // solo hace falta para el margen del observador
    const h = topH();
    chapita();
    d.ioT = null;
    d.io = new IntersectionObserver(es => {
      const e = es.filter(x => x.target === d.ioT).pop();
      if (!e) return;
      d.scIn = e.isIntersecting; // ¿se ve el marcador? (al empezar un arrastre decide si la pizarra se pinta en cada cuadro)
      d.chOn = !e.isIntersecting && e.boundingClientRect.top < h; // ya pasó hacia arriba (no está más abajo)
      paintChapita(d);
    }, { rootMargin: `-${h}px 0px 0px 0px` });
    watchScore(d, board);
  }

  // ---------- Resumen: probabilidad de ganar, mapa de batazos, figuras y jugadas clave (hasta el momento elegido) ----------
  function wpPlays(d) {
    if (!d.wpa) return [];
    return d.cursor != null ? d.wpa.plays.slice(0, uptoOf(d)) : d.wpa.plays;
  }
  // El cursor de la curva: la última jugada completa que se ve (null: todo el juego, sin cursor).
  const wpCur = d => (d.cursor == null ? null : uptoOf(d) - 1);

  // Dos columnas fijas: el nombre de un equipo no se corre cuando cambia el porcentaje del otro.
  function wpNowHTML(d) {
    const plays = wpPlays(d);
    if (!plays.length) return '';
    const v = plays[plays.length - 1].after;
    const a = Math.round(100 - v), h = Math.round(v);
    return `<p data-p="a"><span class="k away" aria-hidden="true"></span>${esc(side(d, 'away').short)} <b>${a}%</b></p>` +
      `<p data-p="h"><span class="k home" aria-hidden="true"></span>${esc(side(d, 'home').short)} <b>${h}%</b></p>`;
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
    return `<ol class="figs" data-p="ol">${pick.map((r, i) => {
      const worst = i === 3;
      // toda la fila lleva al jugador (como en Líderes): se hunde al tocarla y además navega
      return `<li class="rowlink${worst ? ' worst' : ''}" data-p="${r.role}${r.id}"><span class="fig-n">${worst ? 'El que más restó' : i + 1}</span>` +
        `<span class="fig-who">${U.player(r.id, r.name).replace('class="plink"', 'class="plink stretch"')} <small>${chipSide(d, r.side, 's')} ${r.role === 'bat' ? 'bateador' : 'lanzador'}</small></span>` +
        `<span class="fig-v">${F.signed(r.wpa, 1)}<small> pts</small></span></li>`;
    }).join('')}</ol>`;
  }

  // Las 5 jugadas que más movieron la curva; tocar una lleva la pizarra a ese momento. Al elegir una, solo cambian su
  // clase y aria-current (el botón es el mismo: el foco no se pierde).
  function keysHTML(d) {
    const plays = wpPlays(d);
    if (!plays.length) return '';
    const top = plays.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
    const on = d.cursor != null && d.pitch == null ? d.cursor : null;
    return `<ol class="keys" data-p="ol">${top.map(p => {
      const gain = side(d, p.delta < 0 ? 'away' : 'home'), here = on === p.i;
      return `<li data-p="k${p.i}"><button type="button" class="key-go${here ? ' on' : ''}" data-p="b" data-go="${p.i}"${here ? ' aria-current="true"' : ''}>` +
        `<span class="key-h"><span>${esc(halfLabel(p.inning, p.top))}</span><b>${esc(gain.abbr)} ${F.signed(Math.abs(p.delta), 1)} pts</b></span>` +
        `<span class="key-d">${esc(C.cleanEs(p.desc))}</span></button></li>`;
    }).join('')}</ol>`;
  }

  // La curva se dibuja una vez por jugada nueva; el cursor se mueve sin redibujarla (charts.js: setCursor). El
  // controlador sirve aunque CH.responsive la redibuje al girar el teléfono. Con el Resumen escondido no se dibuja
  // (se sabe por d.tab, sin medir): se dibuja al abrirlo.
  function drawWP(el, d) {
    const box = el.querySelector('#wp-chart');
    if (!box || !d.wpa || !d.wpa.plays.length || d.tab !== 'resumen') return;
    const n = d.wpa.plays.length;
    const drawn = !!d.wp && d.wp.box === box, c = drawn ? d.wp.ctl : null;
    // sin setCursor (charts.js de antes) la curva se redibuja con el cursor, como en la Fase 1
    const keyOf = ctl => `${n}|${d.wpa.plays[n - 1].after}|${d.status}${ctl && typeof ctl.setCursor === 'function' ? '' : '|' + wpCur(d)}`;
    if (drawn && box._k === keyOf(c)) { if (c && typeof c.setCursor === 'function') safe(() => c.setCursor(wpCur(d))); return; }
    const total = d.status === 'final' ? n : Math.max(n + 8, 78);
    const A = side(d, 'away'), H = side(d, 'home');
    const o = {
      away: A.abbr, home: H.abbr, total, cursor: wpCur(d), marks: d.marks || null,
      // las etiquetas de las dos jugadas más grandes dicen lo mismo que el mapa ("Doble de Marcano")
      labelOf: i => { const p = d.done[i], b = p && p.matchup && p.matchup.batter; return p ? [C.eventEs(p), b ? surname(b.fullName) : ''].filter(Boolean).join(' de ') : ''; },
      animate: !d.wpAnim && !reduced(), // se dibuja de izquierda a derecha solo al abrir la pantalla
      onPick: i => pickPlay(el, d, i, true),
      onRelease: i => pickPlay(el, d, i, false)
    };
    d.wpAnim = true;
    const foc = box.contains(document.activeElement);
    const ctl = safe(CH.responsive, box, () => CH.winProb(box, d.wpa.plays, o));
    d.wp = { box, ctl: ctl || null };
    box._k = keyOf(d.wp.ctl);
    refocusSvg(box, foc);
  }
  // Si el dibujo viejo tenía el foco (teclado), lo toma el nuevo.
  function refocusSvg(box, foc) {
    const s = foc && box.querySelector('svg[tabindex]');
    if (s && document.activeElement !== s) s.focus({ preventScroll: true });
  }

  // El mapa de batazos (charts.js), con el aro en el batazo de la jugada elegida.
  // La última jugada completa que se ve: el mapa le pone el aro (si tuvo batazo) y deja tenue lo que viene después
  // (también sin batazo; con -1, al principio del juego, todo tenue).
  const sprayHL = d => (d.cursor == null ? null : uptoOf(d) - 1);
  function drawSpray(el, d) {
    const box = el.querySelector('#spray-chart');
    if (!box || !d.spray || !has(CH, 'spray') || d.tab !== 'resumen') return;
    const hl = sprayHL(d), c = d.sp && d.sp.box === box ? d.sp.ctl : null;
    const key = `${d.spray.length}|${d.side || ''}`;
    if (box._k === key && c) {
      if (box._hl !== hl && typeof c.setHighlight === 'function') { box._hl = hl; safe(() => c.setHighlight(hl)); }
      return;
    }
    box._k = key;
    box._hl = hl;
    const A = side(d, 'away'), H = side(d, 'home');
    // dimAfter: en la repetición, los batazos que todavía no han pasado quedan tenues
    const o = { side: d.side || null, away: A.abbr, home: H.abbr, highlight: hl, dimAfter: true, onPick: k => pickPlay(el, d, k, false, 'toque') };
    const foc = box.contains(document.activeElement);
    const ctl = safe(CH.responsive, box, () => CH.spray(box, d.spray, o));
    d.sp = { box, ctl: ctl || null };
    refocusSvg(box, foc);
  }
  const spFilterHTML = d => {
    const A = side(d, 'away'), H = side(d, 'home');
    return [[null, 'Ambos'], ['away', A.abbr], ['home', H.abbr]].map(([s, l]) =>
      `<button type="button" data-side="${s || ''}" aria-pressed="${(d.side || null) === s}">${esc(l)}</button>`).join('');
  };

  // Al abrir la pantalla (d.lazyRes) la curva sale ya y el mapa, las figuras y las jugadas clave en el cuadro siguiente.
  function paintResumen(el, d) {
    paint(el.querySelector('#wp-now'), wpNowHTML(d));
    drawWP(el, d);
    if (d.lazyRes) {
      d.lazyRes = false;
      requestAnimationFrame(() => { if (view && view.d === d && d.tab === 'resumen') restResumen(el, d); });
      return;
    }
    restResumen(el, d);
  }
  function restResumen(el, d) {
    drawSpray(el, d);
    paint(el.querySelector('#figs'), figsHTML(d));
    paint(el.querySelector('#keys'), keysHTML(d));
  }
  function resumenHTML(d) {
    const A = side(d, 'away'), H = side(d, 'home');
    const wp = d.wpa && d.wpa.plays.length;
    const sp = d.spray && has(CH, 'spray');
    let h = '';
    if (wp) {
      h += `<section class="sec">
        ${U.head('Probabilidad de ganar', 'Se recalcula en cada turno con el marcador, el inning, los outs y los corredores. Arrastra el dedo por la curva: la pizarra se mueve a ese momento.')}
        <div id="wp-now" class="wp-now"></div>
        <div id="wp-chart" class="wp-chart"></div>
        <p class="viz-key"><span><span class="k away" aria-hidden="true"></span>${esc(A.abbr)} gana hacia arriba ·</span> <span><span class="k home" aria-hidden="true"></span>${esc(H.abbr)} hacia abajo ·</span> <span class="vk-li">barras: presión del turno (LI)</span></p>
      </section>`;
    }
    if (sp) {
      h += `<section class="sec">
        ${U.head('Batazos del juego', 'Dónde cayó cada pelota puesta en juego. Toca un punto para ir a esa jugada. La ubicación la marca a mano el anotador: es aproximada.')}
        <div class="sp-fil" role="group" aria-label="Batazos de">${spFilterHTML(d)}</div>
        <div id="spray-chart" class="spray-chart"></div>
      </section>`;
    }
    if (wp) {
      h += `<section class="sec">${U.head('Figuras del juego', 'Aporte a la victoria (WPA): puntos de probabilidad que cada uno le sumó o le restó a su equipo.')}<div id="figs"></div></section>
        <section class="sec">${U.head('Jugadas clave', 'Las que más movieron la probabilidad de ganar. Toca una para ver ese momento en la pizarra.')}<div id="keys"></div></section>`;
    }
    return h || U.note('La curva de probabilidad y el mapa de batazos aparecen con la primera jugada.');
  }

  // ---------- box score ----------
  const ABBR = [['BE', 'bateador emergente'], ['CE', 'corredor emergente'], ['BD', 'bateador designado'], ['LOB', 'corredores dejados en base'],
    ['Enf.', 'bateadores enfrentados'], ['Lz-St', 'lanzamientos y strikes'], ['G · P', 'lanzador ganador y perdedor'], ['JS', 'juego salvado'],
    ['HLD', 'hold: sostuvo la ventaja en relevo'], ['SD', 'salvado desperdiciado']];
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
      // Toda la fila lleva al jugador (tr.tap: el oyente de core.js toca su primer enlace), no solo el nombre.
      const tap = p => (p.person && p.person.id ? 'tap' : '');
      // label: el nombre con que el lector anuncia cada tabla ("Bateo de Magallanes"), no "Tabla" las cuatro
      return `<section class="box-team" data-p="${s}"><h3>${chipSide(d, s)} ${esc(t.name)}</h3>
        ${U.table(bcols, bats, { cls: 'box', help: false, rowClass: tap, label: `Bateo de ${t.short}`, foot: { n: 'Totales', ab: tb.atBats, r: tb.runs, h: tb.hits, rbi: tb.rbi, bb: tb.baseOnBalls, so: tb.strikeOuts, lob: tb.leftOnBase } })}
        ${U.table(pcols, pits, { cls: 'box', help: false, rowClass: tap, label: `Pitcheo de ${t.short}` })}
      </section>`;
    }).join('') + `<details class="cols-help" data-p="ley"><summary>Qué significa cada abreviatura</summary><dl>` +
      ABBR.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl></details>';
  }

  // ---------- jugada a jugada ----------
  // Además del resultado de cada turno: cambios de lanzador, emergentes, robos, wild pitch, balk y el corredor
  // que arranca en 2.ª en extrainnings (si no, la carrera del 10.º aparece de la nada). Tocar un turno abre su zona y
  // su secuencia (charts.js), que se dibujan al abrirlo.
  function playsHTML(d) {
    const plays = d.done.slice(0, uptoOf(d));
    if (!plays.length) return U.note('Todavía no hay jugadas.');
    const wp = d.wpa ? d.wpa.plays : [];
    // sin lanzamiento a lanzamiento (juegos viejos) no hay zona que abrir
    const zones = d.byPitch && has(CH, 'zone');
    const groups = [];
    plays.forEach((p, i) => {
      const k = p.about.inning + (p.about.isTopInning ? 't' : 'b');
      let gr = groups[groups.length - 1];
      if (!gr || gr.k !== k) groups.push(gr = { k, inning: p.about.inning, top: p.about.isTopInning, items: [] });
      const ab = p.atBatIndex != null ? p.atBatIndex : i;
      (p.playEvents || []).forEach((e, j) => {
        const et = e.details && e.details.eventType;
        if (e.type === 'action' && ACTIONS.has(et) && et !== p.result.eventType && e.details.description) {
          gr.items.push({ key: `a${ab}-${e.index != null ? e.index : j}`, act: C.cleanEs(e.details.description) });
        }
      });
      gr.items.push({ key: 'p' + ab, p, i, w: wp[i] });
    });
    const A = side(d, 'away'), H = side(d, 'home');
    // Lo más reciente arriba; cada mitad e inning lleva su clave para que una jugada nueva solo agregue su fila.
    return groups.reverse().map(gr => {
      const bat = gr.top ? A : H;
      return `<section class="half" data-p="h${gr.k}"><h4 data-p="t">${esc(halfLabel(gr.inning, gr.top))} <small>${esc(bat.short)} al bate</small></h4><ol data-p="l">` +
        gr.items.slice().reverse().map(it => {
          if (it.act) return `<li class="act" data-p="${it.key}"><p>${esc(it.act)}</p></li>`;
          const p = it.p, w = it.w, sc = p.about.isScoringPlay;
          const dl = w ? `<span class="pl-d" title="Cambio en la probabilidad del equipo al bate">${F.signed(w.dswing, 1)}</span>` : '';
          const meta = `${p.count ? outsTxt(p.count.outs) : ''}${sc ? ` · <b>${esc(A.abbr)} ${p.result.awayScore} – ${p.result.homeScore} ${esc(H.abbr)}</b>` : ''}`;
          const n = zones ? (seqOf(p) || []).filter(x => !x.auto).length : 0; // las bolas y strikes automáticos no son lanzamientos
          if (!n) {
            return `<li class="${sc ? 'score' : ''}" data-p="${it.key}"><p><b class="pl-ev">${esc(C.eventEs(p))}</b>${dl}</p>` +
              `<p>${esc(C.cleanEs(p.result.description))}</p><p class="pl-meta">${meta}</p></li>`;
          }
          return `<li class="pl-z${sc ? ' score' : ''}" data-p="${it.key}"><details class="pl-x" data-p="x" data-j="${it.i}">` +
            `<summary data-p="s"><span class="pl-l"><b class="pl-ev">${esc(C.eventEs(p))}</b>${dl}</span>` +
            `<span class="pl-l">${esc(C.cleanEs(p.result.description))}</span>` +
            `<span class="pl-l pl-meta">${meta}${meta ? ' · ' : ''}<span class="pl-more">${n} lanzamiento${n === 1 ? '' : 's'}</span></span></summary>` +
            `<div class="pl-zone" data-p="z" data-keep="z${it.i}"></div></details></li>`;
        }).join('') + '</ol></section>';
    }).join('');
  }
  // La zona de un turno abierto en el jugada a jugada (una vez por caja).
  function drawPlayZone(d, det) {
    const box = det.querySelector('.pl-zone'), play = d.done[+det.dataset.j];
    if (!box || box._drawn || !play || !has(CH, 'zone')) return;
    box._drawn = true;
    const m = play.matchup || {};
    const ctl = safe(CH.zone, box, seqOf(play) || [], { box: d.zbox || null, batSide: m.batSide ? m.batSide.code : null });
    d.plz = d.plz.filter(z => (z.box.isConnected ? true : (kill(z), false)));
    d.plz.push({ box, ctl });
  }
  // 'toggle' no burbujea: se escucha en la captura.
  document.addEventListener('toggle', e => {
    const det = e.target;
    if (!view || !det || !det.matches || !det.open || !det.matches('#tab-jugadas details.pl-x')) return;
    drawPlayZone(view.d, det);
  }, true);

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
    if (dt.resumeDate || dt.resumedFromDate || dt.resumedFrom) {
      // las fechas de la API tal cual (resumeDate, resumedFromDate): la hora UTC cambiaría el día
      const a = dt.resumedFromDate || (dt.resumedFrom ? dayOf(dt.resumedFrom) : dt.officialDate);
      const b = dt.resumeDate || (dt.resumeDateTime ? dayOf(dt.resumeDateTime) : D.isoOf(Date.parse(dt.dateTime)));
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
      return `<div class="prob"><p class="prob-t">${chipSide(d, s, 's')} ${esc(t.short)}</p>` +
        (p ? `<p class="prob-n">${U.player(p.id, p.fullName)}</p><p class="prob-l">${esc(line)}</p>` : '<p class="prob-n">Por anunciar</p>') + '</div>';
    };
    return `<section class="sec">${U.head('Abridores probables')}<div class="probs">${one('away')}${one('home')}</div></section>`;
  }

  // ---------- pestañas: Previa · Resumen · Box · Jugadas · Datos ----------
  function tabsOf(d) {
    if (d.status === 'pre') return [['previa', 'Previa'], ['info', 'Datos']];
    // pospuesto o cancelado: los abridores probables de un juego que no se juega no dicen nada
    if (d.status === 'post') return [['info', 'Datos']];
    return [['resumen', 'Resumen'], ['box', 'Box'], ['jugadas', 'Jugadas'], ['info', 'Datos']];
  }
  const defTab = d => (d.status === 'pre' ? 'previa' : d.status === 'post' ? 'info' : 'resumen');
  const PANELS = {
    previa: preHTML,
    box: boxHTML,
    jugadas: playsHTML,
    info: infoHTML
  };
  // Solo se pinta la pestaña visible; las otras quedan marcadas y se pintan al abrirlas.
  function paintTab(el, d, k) {
    d.stale.delete(k);
    if (k === 'resumen') { paintResumen(el, d); return; }
    const box = el.querySelector('#tab-' + k);
    if (!box || !PANELS[k]) return;
    paint(box, PANELS[k](d));
    if (k === 'jugadas') box.querySelectorAll('details.pl-x[open]').forEach(det => drawPlayZone(d, det));
  }
  // Con letra grande la fila de pestañas se desliza: un degradado en el borde avisa que hay más (como la línea por
  // inning).
  function tabEdges(seg) {
    const max = seg.scrollWidth - seg.clientWidth, x = seg.scrollLeft;
    if (seg.classList.contains('ed-l') !== x > 1) seg.classList.toggle('ed-l', x > 1);
    if (seg.classList.contains('ed-r') !== x < max - 1) seg.classList.toggle('ed-r', x < max - 1);
  }
  // El indicador se desliza a la pestaña elegida (solo transform). instant: sin animar (al pintar, al girar).
  function moveInd(el, instant) {
    const seg = el.querySelector('.gm-tabs'), ind = seg && seg.querySelector('.seg-ind'), on = seg && seg.querySelector('[aria-selected="true"]');
    if (!ind || !on || !on.offsetWidth) return;
    if (instant) ind.classList.add('quieto');
    ind.style.transform = `translateX(${on.offsetLeft}px) scaleX(${(on.offsetWidth / 100).toFixed(3)})`;
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => ind.classList.remove('quieto')));
    // si la fila no cabe (letra grande), la pestaña elegida a la vista
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l - 8 < seg.scrollLeft) seg.scrollLeft = Math.max(0, l - 8);
    else if (r + 8 > seg.scrollLeft + seg.clientWidth) seg.scrollLeft = r + 8 - seg.clientWidth;
    tabEdges(seg);
  }
  function showTab(el, d, k, instant) {
    d.tab = k;
    // con el teclado, Tab entra solo a la pestaña elegida; las flechas cambian de pestaña (draw)
    el.querySelectorAll('.gm-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    el.querySelectorAll('.gm-tabsec > [role=tabpanel]').forEach(p => { p.hidden = p.id !== 'tab-' + k; });
    // el indicador mide las pestañas: en el cuadro siguiente, sin forzar un cálculo en medio de la pintada (al abrir la
    // pantalla, después de ese cuadro: con el cálculo ya hecho)
    const go = () => { if (el.isConnected) moveInd(el, instant); };
    requestAnimationFrame(instant ? () => setTimeout(go, 0) : go);
    if (d.stale.has(k)) paintTab(el, d, k);
    if (k === 'resumen' && !instant) wpCatchUp(d); // la curva, al día
  }

  // ---------- la repetición, lanzamiento a lanzamiento ----------
  const stepsOf = (d, k) => (k + 1 < d.first.length ? d.first[k + 1] : d.steps.length) - d.first[k];
  // El paso que se ve (el último: el juego terminado, sin repetición).
  function curStep(d) {
    if (d.cursor == null) return d.steps.length - 1;
    const i0 = d.first[d.cursor];
    return d.pitch == null ? i0 + stepsOf(d, d.cursor) - 1 : i0 + d.pitch;
  }
  function setStep(d, i) {
    const last = d.steps.length - 1;
    if (i >= last) { d.cursor = null; d.pitch = null; return; }
    const [k, p] = d.steps[Math.max(0, i)];
    d.cursor = k;
    d.pitch = p == null || p >= stepsOf(d, k) - 1 ? null : p;
  }
  // "Jugada 38 de 89 · Alta del 5.º"; withPitch (para el lector): "… · 1.er lanzamiento" (un automático dice lo que
  // es: "Bola intencional"; los lanzamientos se cuentan sin ellos). A la vista va sin el lanzamiento (ya lo dice la
  // pizarra): así el texto no cambia de largo en cada paso y la fila no salta.
  const rpText = (d, withPitch) => {
    const k = d.cursor == null ? d.done.length - 1 : d.cursor, p = d.done[k];
    if (!p) return '';
    let s = `Jugada ${k + 1} de ${d.done.length} · ${halfLabel(p.about.inning, p.about.isTopInning)}`;
    if (withPitch && d.cursor != null && d.pitch != null) {
      const seq = seqOf(p) || [], x = seq[d.pitch];
      s += x && x.auto ? ` · ${x.label}` : ` · ${ordM(seq.slice(0, d.pitch + 1).filter(q => !q.auto).length)} lanzamiento`;
    }
    return s;
  };
  const rpButton = s => (s === 'pausa' ? `${I_PAUSE}<span>Pausa</span>` : `${I_PLAY}<span>${s === 'seguir' ? 'Seguir' : 'Repetir'}</span>`);
  // El botón dice lo que hace ("Pausa", "Seguir", "Repetir"): sin aria-pressed, que lo diría dos veces.
  function setBtn(el, d) {
    const btn = el.querySelector('.rp-play');
    if (!btn) return;
    const s = d.timer ? 'pausa' : d.cursor == null || d.finale ? 'repetir' : 'seguir';
    if (btn.dataset.s === s) return;
    btn.dataset.s = s;
    btn.innerHTML = rpButton(s);
  }
  function stopReplay(d) {
    if (d && d.timer) { clearTimeout(d.timer); d.timer = 0; }
  }
  // Al pausar (el botón, el final o el deslizador), el lector oye dónde quedó: "Pausa. Jugada 38 de 89, alta del 5.º,
  // 1 out, MAG 3-3, cuenta 1-0".
  function pauseText(d) {
    if (d.cursor == null || d.finale) return `Fin de la repetición. ${liveText(d)}`;
    const M = moment(d), A = side(d, 'away'), H = side(d, 'home'), a = M.tot.away.r, h = M.tot.home.r;
    const score = h > a ? `${H.abbr} ${h}-${a}` : `${A.abbr} ${a}-${h}`;
    return `Pausa. Jugada ${d.cursor + 1} de ${d.done.length}, ${halfLabel(M.inning, M.top).toLowerCase()}, ${outsTxt(M.outs)}, ${score}` +
      (d.byPitch ? `, cuenta ${Math.min(3, M.balls || 0)}-${Math.min(2, M.strikes || 0)}` : '');
  }
  // Ir al paso i. how: 'drag' (cada cuadro de un arrastre del deslizador: la chapita), 'play' (la repetición andando:
  // con la pizarra viva y los momentos que va pasando) o 'jump' (un salto: todo, sin animar).
  function goStep(el, d, i, how) {
    const u0 = uptoOf(d);
    d.finale = false;
    setStep(d, i);
    if (how === 'drag') { dragFrame(el, d, true); return; }
    // el final de la repetición andando: sus momentos (la carrera del dejado en el terreno, el fin del juego) salen sobre
    // la pizarra del turno de la última jugada, y la de siempre vuelve cuando termina la banda (showMoment)
    let list = null;
    if (how === 'play' && d.cursor == null && d.done.length) {
      list = momentsOf(d, u0 - 1, d.done.length - 1);
      if (list.length) { d.cursor = d.done.length - 1; d.pitch = null; d.finale = true; }
    }
    update(el, d, { anim: how === 'play' });
    if (how !== 'play') { d.seen = new Set(); clearMoments(el, d); return; } // un salto: los momentos vuelven a salir
    const u1 = uptoOf(d);
    if (!list) list = u1 > u0 ? momentsOf(d, u0 - 1, u1 - 1) : [];
    // a mitad de turno: el cambio de lanzador de la jugada en curso sale cuando la repetición pasa su evento (ix < lim)
    if (d.cursor != null && d.pitch != null) {
      const st = stateAt(d, d.cursor, d.pitch);
      list = list.concat(momentsOf(d, d.cursor - 1, d.cursor, null, 'cambio', m => st.lim == null || m.ix == null || m.ix < st.lim));
    }
    pushMoments(el, d, list, i >= d.steps.length - 1 ? 'fin' : 'paso');
  }
  // Pausa al terminar el paso i si cierra una jugada clave o un jonrón.
  function delayAfter(d, i) {
    const ms = STEP_MS / (d.speed || 1), k = d.steps[i] && d.steps[i][0];
    const ends = i + 1 >= d.steps.length || d.steps[i + 1][0] !== k;
    return ends && d.pause.has(k) ? Math.max(ms, KEY_PAUSE) : ms;
  }
  function playReplay(el, ctx) {
    const d = ctx.data, last = d.steps.length - 1;
    d.finale = false;
    const i = curStep(d);
    const tick = () => {
      d.timer = 0;
      if (!ctx.alive()) return;
      const j = curStep(d) + 1;
      if (j >= last) { goStep(el, d, last, 'play'); setBtn(el, d); say(el, d, pauseText(d)); return; }
      d.timer = setTimeout(tick, delayAfter(d, j)); // marcado antes de pintar: el botón dice "Pausa"
      goStep(el, d, j, 'play');
    };
    if (i >= last) {
      // "Repetir" desde el final: primero el botón (ya dice "Pausa" en el cuadro siguiente) y después, el salto al
      // principio: el toque responde enseguida
      d.timer = -1;
      setBtn(el, d);
      requestAnimationFrame(() => setTimeout(() => {
        if (!ctx.alive() || d.timer !== -1) return;
        goStep(el, d, 0, 'jump');
        d.timer = setTimeout(tick, delayAfter(d, 0));
      }, 0));
      return;
    }
    d.timer = setTimeout(tick, delayAfter(d, i));
    setBtn(el, d);
  }

  // Lo que se toca debajo de la pizarra (la curva, el deslizador, una jugada clave, un batazo) no se mueve cuando la
  // pizarra cambia de alto (la de siempre mide la mitad que la del turno): la página se corre lo mismo. Solo si se ve
  // algo debajo de la pizarra; si se está mirando la pizarra, no. El anclaje del navegador se apaga mientras tanto,
  // para no correrla dos veces. Una medida antes y otra después: al soltar o al saltar, no en cada cuadro.
  function still(el, fn) {
    const w = el.querySelector('.board-wrap');
    if (!w) { fn(); return; }
    const r = w.getBoundingClientRect(), de = document.documentElement, was = de.style.overflowAnchor;
    de.style.overflowAnchor = 'none';
    fn();
    const dh = w.getBoundingClientRect().height - r.height;
    if (r.bottom < root.innerHeight && Math.abs(dh) >= 1) root.scrollBy(0, dh);
    de.style.overflowAnchor = was;
  }

  // La curva, una jugada clave o un batazo del mapa llevan la pizarra a la jugada k (terminada). dragging: un cuadro
  // del arrastre (la chapita); al soltar o al tocar, todo lo demás. how 'toque' (jugada clave, batazo): la página no
  // sube, la chapita destella.
  function pickPlay(el, d, k, dragging, how) {
    if (!view || view.d !== d || k == null || !(k >= 0)) return;
    stopReplay(d);
    d.finale = false;
    const last = d.done.length - 1;
    k = Math.min(k, last);
    if (dragging) {
      // arrastrando, el final también es una jugada: la pizarra de siempre sale al soltar (sin saltar de alto)
      d.cursor = k;
      d.pitch = null;
      dragFrame(el, d, false);
      return;
    }
    d.drag = null;
    // el final del juego (o lo último en vivo) es la pizarra de siempre, sin repetición
    if (k >= last && (d.status === 'final' || d.status === 'live')) { d.cursor = null; d.pitch = null; } else { d.cursor = k; d.pitch = null; }
    if (d.status === 'final') d.seen = new Set(); // al volver atrás, los momentos vuelven a salir al pasar por ellos
    clearMoments(el, d);
    still(el, () => update(el, d));
    if (how === 'toque') flashChapita(d);
  }

  // ---------- montaje ----------
  // Un cuadro del arrastre (la curva, el deslizador o las flechas): la chapita, los % grandes y, si el arrastre es en
  // el deslizador, el cursor de la curva. La pizarra grande solo si se veía el marcador al empezar el gesto (lo sabe el
  // observador de la chapita, sin medir), y sin leer medidas después (la primera vez, still: puede cambiar de forma).
  // Al soltar se pinta todo.
  function dragFrame(el, d, slider) {
    const first = !d.drag;
    if (first) d.drag = { board: !!d.scIn };
    if (d.drag.board) {
      if (first) still(el, () => paintBoard(el, d, 'cuadro'));
      else paintBoard(el, d, 'cuadro');
    }
    paintChapita(d);
    if (d.tab === 'resumen') paint(el.querySelector('#wp-now'), wpNowHTML(d));
    if (slider && d.wp && d.wp.ctl && typeof d.wp.ctl.setCursor === 'function') safe(() => d.wp.ctl.setCursor(wpCur(d)));
  }
  // Refresco y repetición: cada pieza se compara con la que hay y cambia solo si hace falta.
  function update(el, d, o) {
    o = o || {};
    paintBoard(el, d, o.anim ? 'paso' : null);
    tabsOf(d).forEach(([k]) => d.stale.add(k));
    paintTab(el, d, d.tab);
    const rp = el.querySelector('#rp');
    if (rp) {
      const i = String(curStep(d)), t = rpText(d);
      if (rp.value !== i) rp.value = i;
      // el lector dice "Jugada 88 de 89 · Baja del 9.º · 2.º lanzamiento", no "88"
      rp.setAttribute('aria-valuetext', rpText(d, true));
      const lab = el.querySelector('.rp-label');
      if (lab && lab.textContent !== t) lab.textContent = t;
      setBtn(el, d);
    }
    paintChapita(d);
    announce(el, d);
    if (tvOn(d) && !tv.live) tvRepShow(d); // la repetición en el modo TV
  }

  // Lo que obliga a rehacer la pantalla: cambia el estado (por jugar, en vivo, final), aparece la curva o la primera
  // jugada (la repetición). El mapa sale con la curva: su caja ya está aunque todavía no haya batazos.
  const layoutOf = d => `${d.status}|${d.wpa && d.wpa.plays.length ? 1 : 0}|${d.spray ? 1 : 0}|${d.done.length ? 1 : 0}`;

  // ---------- lo que oye el lector de pantalla en vivo ----------
  // "Magallanes 5, Caribes 4. Baja del 7.º, 2 outs. <la última jugada completa, si no se dijo ya>. Al bate <el que
  // batea>." Un turno sin terminar no tiene resultado: lo que trae es lo último que se anotó, como "Visita al
  // montículo", que no es noticia. d.srLast: la última jugada que ya se dijo (aquí o en la banda).
  const lastDone = d => { const cp = d.cp || d.feed.liveData.plays.currentPlay; return cp && cp.about && cp.about.isComplete ? cp : d.done[d.done.length - 1]; };
  function liveText(d) {
    const M = moment(d), A = side(d, 'away'), H = side(d, 'home');
    const score = `${A.short} ${M.tot.away.r}, ${H.short} ${M.tot.home.r}.`;
    if (d.status === 'final') return `Final. ${score}`;
    const when = M.inning ? `${halfLabel(M.inning, M.top, M.state)}${M.pause ? '' : `, ${outsTxt(M.outs)}`}.` : '';
    const lp = lastDone(d), last = lp && lp.result && lp.result.description;
    const news = last && last !== d.srLast ? C.cleanEs(last) : '';
    if (last) d.srLast = last;
    const cp = d.cp || d.feed.liveData.plays.currentPlay;
    const now = M.pause ? (M.batter ? `Abre ${M.batter.fullName}.` : '')
      : cp && cp.about && !cp.about.isComplete && M.batter ? `Al bate ${M.batter.fullName}.` : '';
    return [score, when, news, now].filter(Boolean).join(' ');
  }
  // Se anuncia solo cuando cambia el turno (carreras, inning, outs, bateador o lanzador: sigOf), no en cada
  // lanzamiento. Al abrir la pantalla no se anuncia nada (la pizarra ya se lee); la repetición tiene su control. Si en
  // ese cambio hubo un momento (carrera, jonrón…), lo dice la banda; si llega con otra banda puesta, espera su turno.
  function announce(el, d) {
    if (d.cursor != null) return;
    const was = d.srSig;
    d.srSig = d.sig.turn;
    if (was == null || was === d.sig.turn || (d.status !== 'live' && d.status !== 'final')) return;
    say(el, d, liveText(d));
  }

  // ---------- historial bateador contra lanzador (api.js: vsPlayer) ----------
  // api.js lo da resumido por C.vsLine ({pa, ab, h, hr, bb, so…}, o null si nunca se enfrentaron): el total en las
  // ligas invernales. o: { antes } en la repetición de un juego terminado (solo las temporadas anteriores: nada del
  // futuro) y { post } en la postemporada (se suman los playoffs).
  function vsText(r, o) {
    const where = o.post ? 'en ligas invernales, con la postemporada' : 'en temporada regular de ligas invernales';
    if (!r || !(+r.pa > 0)) return o.antes ? 'No se habían enfrentado antes de esta temporada.' : `No se habían enfrentado ${where}.`;
    const pa = +r.pa, extra = [];
    const n = (v, one, many) => (+v ? `${+v} ${+v === 1 ? one : many}` : '');
    [n(r.hr, 'jonrón', 'jonrones'), n(r.bb, 'boleto', 'boletos'), n(r.so, 'ponche', 'ponches')].forEach(x => { if (x) extra.push(x); });
    return `Cara a cara ${where}${o.antes ? ', hasta la temporada pasada' : ''}: <b>${+r.h || 0}-${+r.ab || 0}</b>${extra.length ? `, ${extra.join(', ')}` : ''} en ${pa} turno${pa === 1 ? '' : 's'}.` +
      (pa < 20 ? ' Muestra chica: dice poco.' : '');
  }
  // El botón queda en su sitio ("Buscando…", aria-disabled) y el resultado entra en una región que el lector anuncia
  // (role=status, ya puesta mientras se busca): el foco no se pierde.
  async function vsLoad(el, d, key) {
    const [bat, pit] = key.split('-').map(Number);
    if (!has(API, 'vsPlayer') || d.vs.get(key) === 'cargando') return;
    const gm = d.feed.gameData.game || {}, post = !!gm.type && gm.type !== 'R';
    const o = { post, antes: d.status === 'final' && +gm.season ? +gm.season : null };
    const q = {};
    if (post) q.tipos = 'R,F,D,L,W';
    if (o.antes) q.antes = o.antes;
    d.vs.set(key, 'cargando');
    paintBoard(el, d);
    let txt;
    try { txt = vsText(await API.vsPlayer(bat, pit, q), o); } catch (e) { txt = 'error'; }
    if (!view || view.d !== d) return;
    d.vs.set(key, txt);
    d.vsOpen = key;
    const box = el.querySelector('.board .vs-out');
    if (box) box.innerHTML = txt === 'error' ? 'No se pudo traer el historial entre los dos.' : txt;
    paintBoard(el, d);
  }

  // ---------- modo TV: el juego a pantalla completa, para tenerlo al lado de la TV ----------
  // Sale solo al girar el teléfono (en horizontal) o con su botón; se sale con "Salir", Escape o Atrás (si se abrió con
  // un toque, suma un paso en el historial). Arriba el estado, el retraso y "Salir"; en tres columnas el marcador con
  // los bombillos y el campo, la zona con su secuencia, y el duelo con la última jugada (la banda de los momentos va
  // encima de ella); abajo una franja de la curva. Números grandes: se lee a metro y medio. Mantiene la pantalla
  // encendida (Wake Lock, si existe).
  // En vivo, cada cambio del juego deja un cuadro (d.hist: el HTML y los datos de los dibujos de ese momento) y el modo
  // TV muestra el último que ya cumplió su retraso. El retraso se cuenta desde la hora del dato en la API (más la demora
  // mínima con que llegan los datos, que absorbe la hora del teléfono): todos los momentos van igual de atrasados aunque
  // el refresco sea cada 12 s. Se guardan los últimos ~2 minutos: al abrir el modo TV o al subir el retraso se puede
  // mostrar lo de hace 90 s. En la repetición (un juego terminado) va al momento de la repetición, sin retraso, con su
  // botón de seguir y pausa.
  const tv = { el: null, d: null, live: false, auto: false, dismissed: false, paso: false, ctl: {}, broken: {}, shown: null, timer: 0,
    mq: [], mo: null, mt: 0, seen: new Set(), srq: [], srt: 0, srAt: 0, lastTurn: null, lock: null, quietos: [], opener: null, off: [] };
  const tvOn = d => !!tv.el && !!d && tv.d === d;
  // Los momentos que ya salieron (en la pizarra o en el modo TV), por juego: abrir y cerrar el modo TV, o girar el
  // teléfono, no los repite.
  function tvSeen(d) {
    if (tv.seenPk !== d.pk) { tv.seen = new Set(); tv.seenPk = d.pk; }
    return tv.seen;
  }
  const tvAllowed = d => !!d && !!d.feed && (d.status === 'live' || (d.status === 'final' && d.done.length > 0));
  const tvDelay = () => { const s = +PC.state.prefs.tvRet; return TV_DELAYS.indexOf(s) >= 0 ? s : 0; };
  // Lo de ahora (sin el cursor de la repetición), para los cuadros del vivo. Un juego terminado no tiene "ahora" con
  // turno: va su última jugada, como la banda del final (d.finale).
  function withLive(d, fn) {
    const c = d.cursor, p = d.pitch, fi = d.finale, end = d.status === 'final' && d.done.length > 0;
    d.cursor = end ? d.done.length - 1 : null; d.pitch = null; d.finale = end;
    try { return fn(); } finally { d.cursor = c; d.pitch = p; d.finale = fi; }
  }
  const I_TV = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="12" rx="2"/><path d="M8.5 21h7M12 17.5V21"/></svg>';
  // compartir: el mismo ícono de las fichas (equipos.js), el de Android
  const I_SHARE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="17.5" cy="5.5" r="2.4"/><circle cx="6.5" cy="12" r="2.4"/>' +
    '<circle cx="17.5" cy="18.5" r="2.4"/><path d="M8.6 10.8l6.8-4M8.6 13.2l6.8 4"/></svg>';
  const I_X = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
  const I_RELOJ = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/></svg>';

  // El estado arriba: "EN VIVO · Alta del 5.º", "REPETICIÓN · Baja del 9.º", "FINAL".
  function tvStatusHTML(d, M) {
    const stObj = d.st || d.feed.gameData.status || {}, ls = M.ls || {};
    let pill;
    if (M.rep && !d.finale) pill = '<span class="pill rp-pill">Repetición</span>';
    else if (d.status === 'final') pill = `<span class="pill fin">${esc(finalText(ls.currentInning, ls.scheduledInnings || 9, stObj.reason, /tied/i.test(stObj.detailedState || '')))}</span>`;
    else if (/delayed/i.test(stObj.detailedState || '')) pill = `<span class="pill warn">${esc(C.statusText(stObj) || 'Juego detenido')}</span>`;
    else if (d.status === 'live') pill = '<span class="pill live"><i aria-hidden="true"></i>En vivo</span>';
    else pill = `<span class="pill warn">${esc(C.statusText(stObj) || '')}</span>`;
    const half = M.inning && !(d.status === 'final' && !M.rep) ? halfLabel(M.inning, M.top, M.state) : '';
    return `${pill}${half ? ` <b class="tv-inn">${esc(half)}</b>` : ''}${M.pause || !half ? '' : outsSr(M.outs)}`;
  }
  // El marcador grande (las carreras ruedan, como en la pizarra).
  function tvScoreHTML(d, M) {
    const A = side(d, 'away'), H = side(d, 'home'), r = s => M.tot[s].r;
    const lead = r('away') > r('home') ? 'away' : r('home') > r('away') ? 'home' : null;
    const n = s => `<span class="sc-r flip tv-r${lead === s ? ' lead' : ''}" data-p="r${s[0]}" data-k="r${s[0]}" data-v="${r(s)}" aria-hidden="true"><span class="n">${r(s)}</span></span>`;
    // con dos cifras las carreras van un poco más chicas: el marcador cabe a lo ancho (css/tv.css)
    return `<div class="tv-sc${r('away') > 9 || r('home') > 9 ? ' dos' : ''}" data-p="sc"><span class="sr" data-p="sr">${esc(A.short)} ${r('away')}, ${esc(H.short)} ${r('home')}</span>` +
      `<span class="bt-abbr" aria-hidden="true" data-p="ta">${esc(A.abbr)}</span>${n('away')}<span class="tv-dash" aria-hidden="true" data-p="dh">–</span>` +
      `${n('home')}<span class="bt-abbr" aria-hidden="true" data-p="th">${esc(H.abbr)}</span></div>`;
  }
  // Los bombillos B-S-O y la cuenta en número (de lejos se lee mejor que los bombillos).
  function tvCountHTML(d, M) {
    const cnt = (M.rep && !d.byPitch) || M.pause || (d.status === 'final' && !M.rep) ? ''
      : `<b class="tv-cnt" data-p="c"><span class="sr">Cuenta </span>${Math.min(3, M.balls || 0)}-${Math.min(2, M.strikes || 0)}</b>`;
    return bulbsHTML(d, M) + cnt;
  }
  // Las fichas del modo TV: el que viene y la presión (el historial entre los dos se busca en la pantalla de siempre).
  function tvCtxHTML(d, M) {
    const cx = [], closed = M.end && M.outs >= 3;
    if (M.onDeck && !M.pause && !closed && (!M.batter || M.onDeck.id !== M.batter.id)) cx.push(`<span class="cx" data-p="od">${M.end ? 'Viene' : 'En cubierta'} <b>${esc(surname(M.onDeck.fullName))}</b></span>`);
    if (M.li != null && M.li >= 1) cx.push(`<span class="cx${M.li >= 1.5 ? ' hot' : ''}" data-p="li">Presión <b>×${F.dec1(M.li)}</b></span>`);
    return cx.length ? `<div class="tn-ctx" data-p="cx">${cx.join('')}</div>` : '';
  }
  // Lo que oye el lector cuando cambia el turno en el modo TV.
  function tvSrText(d, M) {
    const A = side(d, 'away'), H = side(d, 'home');
    const score = `${A.short} ${M.tot.away.r}, ${H.short} ${M.tot.home.r}.`;
    if (d.status === 'final' && !M.rep) return `Final. ${score}`;
    const when = M.inning ? `${halfLabel(M.inning, M.top, M.state)}${M.pause ? '' : `, ${outsTxt(M.outs)}`}.` : '';
    const lp = M.end && M.play && M.play.result && M.play.result.description ? C.cleanEs(M.play.result.description) : '';
    const now = M.pause ? (M.batter ? `Abre ${M.batter.fullName}.` : '') : !M.end && M.batter ? `Al bate ${M.batter.fullName}.` : '';
    return [score, when, lp, now].filter(Boolean).join(' ');
  }
  // La curva de un vistazo: lo que se ve de la probabilidad de ganar (hasta el momento) y el largo del eje.
  function tvWp(d) {
    const plays = wpPlays(d);
    if (!plays.length) return null;
    const all = d.wpa.plays.length;
    return { v: plays.map(p => p.after), first: plays[0].before, total: d.status === 'final' ? all : Math.max(all + 8, 78) };
  }
  // Un cuadro: todo lo que muestra el modo TV en un momento.
  function tvFrame(d, M) {
    const cd = chartData(d, M);
    // el duelo sin enlaces: el modo TV es para mirar (un enlace sacaría del juego)
    const du = duelHTML(d, M).replace(/<a class="plink" href="[^"]*">([^<]*)<\/a>/g, '<span class="plink">$1</span>');
    const f = {
      st: tvStatusHTML(d, M), sc: tvScoreHTML(d, M), cu: tvCountHTML(d, M), du, cx: tvCtxHTML(d, M), lp: lastHTML(d, M),
      fld: cd.fld, zn: cd.zn, wp: tvWp(d), sr: tvSrText(d, M), mo: [],
      turn: [M.rep ? 'r' : 'v', M.inning, M.top, M.state, M.outs, M.tot.away.r, M.tot.home.r, M.batter && M.batter.id, M.pitcher && M.pitcher.id, M.end ? 1 : 0].join('|')
    };
    f.key = [f.st, f.sc, f.cu, f.du, f.cx, f.lp, JSON.stringify(cd), f.wp ? f.wp.v.length + ':' + f.wp.v[f.wp.v.length - 1] : ''].join('#');
    return f;
  }

  // ---- el vivo con retraso ----
  // Cuándo se muestra un cuadro: su hora en la API más la demora mínima observada, más el retraso; nunca antes de que
  // llegue. Sin hora de la API, desde que llegó.
  const dueOf = (d, f, D) => (f.ts == null || d.lag == null ? f.at + D : Math.max(f.at, f.ts + d.lag + D));
  // Un cambio del vivo: se guarda su cuadro (con los momentos que trajo) y, con el modo TV abierto, se mira qué toca.
  // ts: la hora del dato que trajo el cambio (con la vigilancia de la Fase 2, la de la vigilancia; si no, la del juego).
  function tvLive(d, list, ts) {
    if (!d.hist || !d.feed || !(d.status === 'live' || tvOn(d))) return;
    const f = withLive(d, () => tvFrame(d, moment(d)));
    f.at = Date.now();
    f.ts = ts != null ? ts : tsMs(d.feed);
    f.mo = list && list.length ? list.slice() : [];
    const H = d.hist, last = H[H.length - 1];
    if (last && last.key === f.key && !f.mo.length) return; // nada nuevo a la vista
    // la demora mínima entre la hora del dato y su llegada (sin el primer cuadro, que puede ser de hace rato)
    if (f.ts != null && H.length) { const lag = f.at - f.ts; d.lag = d.lag == null ? lag : Math.min(d.lag, lag); }
    H.push(f);
    // fuera lo viejo, salvo el cuadro que se está mostrando y lo que viene después
    const cut = f.at - TV_KEEP, keep = tvOn(d) && tv.shown ? H.indexOf(tv.shown) : H.length - 1;
    let i = 0;
    while (i < H.length - 1 && i < keep && H[i].at < cut) i++;
    if (i) H.splice(0, i);
    if (tvOn(d) && tv.live) tvPump();
  }
  // El cuadro que ya cumplió su retraso (el último), y el reloj para el siguiente.
  function tvPump() {
    clearTimeout(tv.timer);
    tv.timer = 0;
    const d = tv.d;
    if (!tv.el || !tv.live || !d || !d.hist.length) return;
    const H = d.hist, now = Date.now(), D = tvDelay() * 1000;
    // el último que ya cumplió su retraso (al subir el retraso puede ser uno anterior al que se ve: se vuelve atrás)
    let k = -1;
    for (let i = 0; i < H.length; i++) if (dueOf(d, H[i], D) <= now) k = i;
    const j = tv.shown ? H.indexOf(tv.shown) : -1;
    // nada tan viejo: al abrir, lo más viejo que hay; si ya se ve algo, se queda
    const pick = k >= 0 ? k : j < 0 ? 0 : -1;
    if (pick >= 0 && pick !== j) {
      // los momentos de lo que se salta van a la cola de la banda (como en vivo: esperan 2 como mucho); al abrir, los de
      // lo que ya pasó no salen
      const list = [];
      if (j >= 0) for (let i = j + 1; i <= pick; i++) list.push(...H[i].mo);
      tvShow(d, H[pick], !!tv.shown);
      tvMoments(list, 'vivo');
    }
    const nx = H[k + 1];
    if (nx) tv.timer = setTimeout(tvPump, Math.max(60, dueOf(d, nx, D) - now + 20));
  }
  // La repetición en el modo TV: el momento de la repetición, al instante (sin empezar, el final del juego).
  function tvRepShow(d) {
    if (!tvOn(d)) return;
    const f = d.cursor == null ? withLive(d, () => tvFrame(d, moment(d))) : tvFrame(d, moment(d));
    tvShow(d, f, d.timer !== 0 && !!tv.shown);
    const b = tv.el.querySelector('.tv-play'), l = tv.el.querySelector('.tv-rpl');
    if (b) { const s = d.timer ? 'pausa' : d.cursor == null || d.finale ? 'repetir' : 'seguir'; if (b.dataset.s !== s) { b.dataset.s = s; b.innerHTML = rpButton(s); } }
    if (l) { const t = rpText(d); if (l.textContent !== t) l.textContent = t; }
  }
  // Pinta un cuadro (anim: con la pizarra viva, si cambió algo).
  function tvShow(d, f, anim) {
    const T = tv.el;
    if (!T || !f) return;
    const before = anim && !reduced() ? valuesOf(T) : null;
    const was = tv.shown;
    tv.shown = f;
    paint(T.querySelector('.tv-st'), f.st);
    paint(T.querySelector('.tv-score'), f.sc);
    paint(T.querySelector('.tv-cuenta'), f.cu);
    paint(T.querySelector('.tv-duel'), f.du);
    paint(T.querySelector('.tv-cxs'), f.cx);
    paint(T.querySelector('.tv-lp'), f.lp);
    if (before) markChanges(T, before);
    tvCharts(d, f);
    tvStrip(d, f.wp);
    tvFit();
    // el lector: el estado cuando cambia el turno (los momentos los dice la banda)
    if (was && f.turn !== tv.lastTurn && !f.mo.length) tvSay(f.sr);
    tv.lastTurn = f.turn;
  }
  // La franja de comentario, entera o nada: si las fichas y la última jugada no caben (la letra grande), primero se
  // esconden las fichas y después la jugada; nunca queda una línea cortada a la mitad. Una medida por cuadro.
  function tvFit() {
    const T = tv.el, com = T && T.querySelector('.tv-com');
    if (!com) return;
    const cx = com.querySelector('.tv-cxs'), lp = com.querySelector('.tv-lp');
    cx.hidden = false;
    lp.hidden = false;
    const gap = parseFloat(getComputedStyle(com).rowGap) || 0;
    const fits = () => {
      const hs = [cx, lp].filter(e => !e.hidden).map(e => e.offsetHeight).filter(h => h > 0);
      return hs.reduce((a, h) => a + h, 0) + Math.max(0, hs.length - 1) * gap <= com.clientHeight + 0.5;
    };
    if (!fits()) cx.hidden = true;
    if (!fits()) lp.hidden = true;
  }
  // El campo y la zona del modo TV: se crean una vez y después solo se actualizan.
  function tvCharts(d, f) {
    const T = tv.el, A = side(d, 'away'), H = side(d, 'home');
    const one = (name, box, make, upd) => {
      if (!box || tv.broken[name]) return;
      try {
        if (!tv.ctl[name]) tv.ctl[name] = make() || null;
        else upd(tv.ctl[name]);
      } catch (e) {
        console.warn('juego: modo TV', name, e);
        tv.broken[name] = true;
        box.hidden = true;
      }
    };
    const fb = T.querySelector('.tv-field');
    // el campo entero con la defensa (sin "Ver defensa": aquí no hay botones de más)
    if (has(CH, 'field')) one('fld', fb, () => { const s = f.fld, o = { away: A.abbr, home: H.abbr, narrow: false }; return CH.responsive(fb, () => CH.field(fb, s, o)); }, c => c.update(f.fld));
    const zb = T.querySelector('.tv-zone'), sq = T.querySelector('.tv-seq');
    if (d.byPitch && has(CH, 'zone')) {
      // las opciones, una sola vez: al redibujar (girar) charts.js se queda con lo último que llegó por update
      one('zn', zb, () => { const ps = f.zn.pitches, o = { box: f.zn.box, batSide: f.zn.batSide, seqBox: sq || undefined, count: false, legend: false }; return CH.responsive(zb, () => CH.zone(zb, ps, o)); },
        c => c.update(f.zn.pitches, { box: f.zn.box, batSide: f.zn.batSide }));
    } else if (!T.classList.contains('sin-zona')) T.classList.add('sin-zona'); // sin lanzamiento a lanzamiento: el campo solo
  }
  // La franja de la curva: dorada arriba (va ganando el visitante) y azul abajo (el home club), como en el Resumen; a
  // la derecha, el que va arriba con su %. La dibuja aquí (SVG estirado a lo ancho): es una pieza del modo TV.
  function tvStrip(d, w) {
    const box = tv.el && tv.el.querySelector('.tv-wp');
    if (!box) return;
    const key = w ? `${w.v.length}|${w.v[w.v.length - 1]}|${w.total}` : '';
    if (box._k === key) return;
    box._k = key;
    const A = side(d, 'away'), H = side(d, 'home');
    const keyHTML = `<p class="tv-wp-k" aria-hidden="true"><span>${esc(A.abbr)}</span><span>${esc(H.abbr)}</span></p>`;
    if (!w) {
      box.setAttribute('aria-label', 'Probabilidad de ganar: todavía sin jugadas');
      box.innerHTML = keyHTML + '<svg class="tv-wp-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<line x1="0" x2="1000" y1="50" y2="50" class="tv-wp-base" vector-effect="non-scaling-stroke"/></svg>';
      return;
    }
    const x = i => ((i / w.total) * 1000).toFixed(1), y = v => (+v).toFixed(1);
    let line = `M0 ${y(w.first)}`;
    w.v.forEach((v, i) => { line += `L${x(i + 1)} ${y(v)}`; });
    const end = x(w.v.length), area = `${line}L${end} 50L0 50Z`, last = w.v[w.v.length - 1];
    const fav = last < 50 ? ['away', A, Math.round(100 - last)] : ['home', H, Math.round(last)];
    box.setAttribute('aria-label', `Probabilidad de ganar: ${fav[1].short} ${fav[2]} %`);
    box.innerHTML = keyHTML +
      `<svg class="tv-wp-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
      '<defs><clipPath id="tvwp-a"><rect width="1000" height="50"/></clipPath><clipPath id="tvwp-h"><rect y="50" width="1000" height="50"/></clipPath></defs>' +
      `<path d="${area}" class="tv-wp-area away" clip-path="url(#tvwp-a)"/><path d="${area}" class="tv-wp-area home" clip-path="url(#tvwp-h)"/>` +
      '<line x1="0" x2="1000" y1="50" y2="50" class="tv-wp-base" vector-effect="non-scaling-stroke"/>' +
      `<path d="${line}" class="tv-wp-line away" clip-path="url(#tvwp-a)" vector-effect="non-scaling-stroke"/><path d="${line}" class="tv-wp-line home" clip-path="url(#tvwp-h)" vector-effect="non-scaling-stroke"/></svg>` +
      `<p class="tv-wp-n" aria-hidden="true"><span class="k ${fav[0]}"></span>${esc(fav[1].abbr)} <b>${fav[2]}%</b></p>`;
  }

  // ---- la banda de los momentos en el modo TV (como la de la pizarra: 8 s, y 4 s las que esperaron) ----
  function tvMoments(list, how) {
    if (!tv.el || !list || !list.length) return;
    // en vivo, cada momento una vez (al subir el retraso se vuelve a pasar por cuadros ya vistos); en la repetición ya
    // vienen contados (d.seen, que se olvida en cada salto)
    const fresh = how !== 'vivo' ? list : list.filter(m => {
      const key = moKey(m);
      if (tv.seen.has(key)) return false;
      tv.seen.add(key);
      return true;
    });
    if (!fresh.length) return;
    if (how === 'paso') { tv.mq = [topOf(fresh, 1)[0]]; tvBand(true); return; }
    fresh.forEach(m => { m.waited = !!tv.mo || tv.mq.length > 0; tv.mq.push(m); });
    if (tv.mo) tv.mq = topOf(tv.mq, 2);
    else if (tv.mq.length > 3) tv.mq = [tv.mq[0]].concat(topOf(tv.mq.slice(1), 2));
    if (!tv.mo) tvBand();
  }
  function tvBand(now) {
    clearTimeout(tv.mt);
    tv.mt = 0;
    const box = tv.el && tv.el.querySelector('.tv-band');
    const m = tv.mq.shift() || null;
    tv.mo = m;
    if (!box) { tv.mq = []; tv.mo = null; return; }
    if (!m) { box.classList.remove('in'); return; }
    const parts = String(m.title || '').split(' · '), ms = m.waited && !now ? WAIT_MS : BAND_MS;
    const was = box.classList.contains('in');
    box.className = `mo-band tv-band ${m.type || ''}${was ? ' in' : ''}`;
    box.innerHTML = `<p class="mo-h"><b class="mo-t">${esc(parts[0])}</b>${parts.length > 1 ? `<span class="mo-s">${esc(parts.slice(1).join(' · '))}</span>` : ''}</p>` +
      (m.text ? `<p class="mo-d">${esc(m.text)}</p>` : '') + `<span class="mo-bar"><i style="animation-duration:${ms}ms"></i></span>`;
    // que el texto no se monte en la barrita: si no cabe en 2 líneas, en 1; si tampoco, solo el título
    for (const c of ['corta', 'cortisima']) {
      if (box.scrollHeight <= box.clientHeight + 1) break;
      box.classList.remove('corta');
      box.classList.add(c);
    }
    if (!was) requestAnimationFrame(() => { if (tv.mo === m) box.classList.add('in'); });
    const d = tv.d;
    if (!m.rep || (((d && d.speed) || 1) === 1 && SAY_REP.has(m.type))) tvSay([parts.join(', '), m.text || ''].filter(Boolean).join('. '));
    tv.mt = setTimeout(() => tvBand(), ms);
  }
  // El lector en el modo TV: de a uno, con 2,5 s entre uno y otro (como say).
  function tvSay(txt) {
    if (!txt || !tv.el) return;
    tv.srq.push(txt);
    if (!tv.srt) tvSayNext();
  }
  function tvSayNext() {
    tv.srt = setTimeout(() => {
      tv.srt = 0;
      const t = tv.srq.shift(), box = tv.el && tv.el.querySelector('#tv-sr');
      if (t == null || !box) { tv.srq = []; return; }
      box.textContent = t;
      tv.srAt = Date.now();
      if (tv.srq.length) tvSayNext();
    }, Math.max(250, tv.srAt + 2500 - Date.now()));
  }

  // ---- abrir y cerrar ----
  const tvActivated = () => !navigator.userActivation || navigator.userActivation.isActive;
  function tvShell(d) {
    const ret = tvDelay();
    const ctl = tv.live
      ? `<div class="tv-ret" role="group" aria-label="Retraso, para ir a la par de la TV"><span class="tv-ret-l" aria-hidden="true">${I_RELOJ}<span class="tv-ret-lt">Retraso</span></span>` +
        TV_DELAYS.map(s => `<button type="button" data-ret="${s}" aria-pressed="${s === ret}"><span aria-hidden="true">${s}</span><span class="sr">${s ? `${s} segundos` : 'sin retraso'}</span></button>`).join('') +
        '<span class="tv-ret-u" aria-hidden="true">s</span></div>'
      : `<div class="tv-rp"><button type="button" class="btn tv-play" data-s="">${rpButton('repetir')}</button><span class="tv-rpl" aria-hidden="true"></span></div>`;
    // Cada pieza en su lugar de la cuadrícula (css/tv.css): el campo y la zona dentro de una caja que mide lo que le
    // toca, para que el dibujo quepa también de alto.
    return `<div class="tv-bar"><p class="tv-st"></p><span class="tv-aviso" role="status" hidden></span>${ctl}<button type="button" class="tv-x" aria-label="Salir del modo TV">${I_X}<span class="tv-x-t" aria-hidden="true">Salir</span></button></div>` +
      '<div class="tv-a"><div class="tv-score"></div><div class="tv-fld"><div class="tv-field"></div></div></div>' +
      '<div class="tv-b"><div class="tv-cuenta"></div><div class="tv-zn"><div class="tv-zone"></div></div><div class="tv-seq"></div></div>' +
      '<div class="tv-c"><div class="tv-duel"></div><div class="tv-com"><div class="tv-cxs"></div><div class="tv-lp"></div><div class="mo-band tv-band" aria-hidden="true"></div></div></div>' +
      '<div class="tv-wp" role="img"></div><p class="sr" id="tv-sr" aria-live="polite"></p>';
  }
  // Si lo que se ve es viejo, se dice en la barra: "Sin conexión" (api.js lo sabe), o "Sin datos nuevos hace N min" si
  // pasaron más de 45 s sin un dato al día con el juego en vivo. El aviso toma el lugar de la píldora "En vivo" (tv.css);
  // en una pantalla angosta se ve corto ("Sin señal", "Hace N min") y el lector oye la frase entera. Se mira cada 5 s,
  // cuando cambia la conexión y después de cada ciclo del vivo.
  function tvAviso() {
    const T = tv.el, d = tv.d;
    if (!T || !d || !d.feed) return;
    let txt = '', corto = '', sr = '';
    if (tv.live && d.status === 'live') {
      if (API.status && API.status.online === false) { txt = sr = 'Sin conexión'; corto = 'Sin señal'; }
      else {
        const s = (Date.now() - freshOf(d)) / 1000;
        if (s > 45) {
          const m = Math.max(1, Math.round(s / 60));
          txt = `Sin datos nuevos hace ${m} min`;
          corto = `Hace ${m} min`;
          sr = `Sin datos nuevos hace ${m} minuto${m === 1 ? '' : 's'}`;
        }
      }
    }
    const box = T.querySelector('.tv-aviso');
    if (box && box.dataset.t !== txt) {
      box.dataset.t = txt;
      box.innerHTML = txt ? (corto !== txt ? `<span class="tv-av-c" aria-hidden="true">${esc(corto)}</span>` : '') +
        `<span class="tv-av-l" aria-hidden="true">${esc(txt)}</span><span class="sr">${esc(sr)}</span>` : '';
      box.hidden = !txt;
    }
    if (T.classList.contains('viejo') !== !!txt) T.classList.toggle('viejo', !!txt);
  }
  window.addEventListener('pc:red', () => tvAviso());
  // La pantalla encendida mientras esté abierto (si el navegador lo permite; si no, nada).
  async function tvLock() {
    if (!tv.el || tv.lock || document.hidden) return;
    const wl = navigator.wakeLock;
    if (!wl || typeof wl.request !== 'function' || navigator.standalone === true) { tvLockAviso(); return; }
    try {
      const l = await wl.request('screen');
      if (!tv.el) { l.release().catch(() => {}); return; }
      tv.lock = l;
      l.addEventListener('release', () => { if (tv.lock === l) tv.lock = null; });
    } catch (e) { tv.lock = null; tvLockAviso(); }
  }
  // Una vez por sesión: la pantalla puede apagarse sola (el aviso corto de core.js, encima del modo TV).
  function tvLockAviso() {
    let ya = !!tv.lockAvisado;
    try { ya = ya || sessionStorage.getItem('pc:tv-pantalla') === '1'; sessionStorage.setItem('pc:tv-pantalla', '1'); } catch (e) { /* sin almacenamiento */ }
    tv.lockAvisado = true;
    if (!ya && typeof PC.toast === 'function') PC.toast('Tu teléfono puede apagar la pantalla: alarga el bloqueo automático en Ajustes.', { ms: 6000 });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tv.el) tvLock(); });
  function tvOpen(d, auto) {
    if (tv.el || !view || view.d !== d || !tvAllowed(d)) return;
    const el = view.el, A = side(d, 'away'), H = side(d, 'home');
    tv.d = d; tv.live = d.status !== 'final'; tv.auto = !!auto;
    tv.ctl = {}; tv.broken = {}; tv.shown = null; tv.mq = []; tv.mo = null; tv.srq = []; tv.lastTurn = null;
    tvSeen(d);
    tv.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    // en vivo, lo de ahora: si se estaba mirando otro momento de la curva, se vuelve al vivo; la banda de la pizarra
    // pasa al modo TV
    if (tv.live && d.cursor != null) { stopReplay(d); d.cursor = null; d.pitch = null; update(el, d); }
    clearMoments(el, d);
    const T = document.createElement('div');
    T.className = 'tv' + (tv.live ? ' tv-vivo' : ' tv-rep');
    T.setAttribute('role', 'dialog');
    T.setAttribute('aria-modal', 'true');
    T.setAttribute('aria-label', `Modo TV: ${A.short} en ${H.short}`);
    T.tabIndex = -1;
    T.innerHTML = tvShell(d);
    document.body.appendChild(T);
    tv.el = T;
    // lo de atrás, inerte: no se toca y el teclado y el lector no entran
    tv.quietos = Array.from(document.body.children).filter(n => n !== T && n.id !== 'toast' && !/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(n.tagName) && !n.hasAttribute('inert'));
    tv.quietos.forEach(n => n.setAttribute('inert', ''));
    document.documentElement.classList.add('tv-on');
    if (!auto && tvActivated()) {
      try { history.pushState(Object.assign({}, history.state, { tv: 1 }), ''); tv.paso = true; } catch (e) { tv.paso = false; }
    }
    T.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('.tv-x')) { tvClose(d, 'boton'); return; }
      const r = t.closest('[data-ret]');
      if (r) {
        PC.state.prefs.tvRet = +r.dataset.ret;
        PC.savePrefs();
        T.querySelectorAll('[data-ret]').forEach(b => b.setAttribute('aria-pressed', String(b === r)));
        tvPump();
        return;
      }
      if (t.closest('.tv-play')) {
        // el botón de la repetición de la pantalla (lo mismo que tocarlo allá); al pausar, el lector oye dónde quedó
        const b = el.querySelector('.rp-play'), was = !!d.timer;
        if (b) b.click();
        tvRepShow(d);
        if (was && !d.timer) tvSay(pauseText(d));
        return;
      }
      if (t.closest('.tv-band')) tvBand();
    });
    // teclado: Escape sale; Tab da la vuelta dentro del modo TV
    const onKey = e => {
      if (!tv.el) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tvClose(d, 'escape'); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(T.querySelectorAll('button:not([disabled])')).filter(n => n.getClientRects().length);
      if (!f.length) { e.preventDefault(); T.focus(); return; }
      const a = f[0], z = f[f.length - 1], now = document.activeElement;
      if (e.shiftKey && (now === a || now === T || !T.contains(now))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (now === z || !T.contains(now))) { e.preventDefault(); a.focus(); }
    };
    const onFocus = e => { if (tv.el && !T.contains(e.target)) { try { T.focus({ preventScroll: true }); } catch (err) { /* nada */ } } };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    tv.off = [() => document.removeEventListener('keydown', onKey, true), () => document.removeEventListener('focusin', onFocus, true)];
    tvLock();
    if (tv.live) { if (!d.hist.length) tvLive(d, null); tvPump(); wpCatchUp(d); } else tvRepShow(d);
    tv.avisoT = setInterval(tvAviso, 5000);
    tvAviso();
    // al girar o cambiar de tamaño, lo que cabe en la franja de comentario cambia
    const onResize = () => { if (tv.el) tvFit(); };
    window.addEventListener('resize', onResize);
    tv.off.push(() => window.removeEventListener('resize', onResize));
    try { T.focus({ preventScroll: true }); } catch (e) { /* nada */ }
  }
  // why: 'boton', 'escape', 'atras' (Atrás del teléfono), 'giro' (volvió a vertical) o 'ruta' (se fue del juego).
  function tvClose(d, why) {
    if (!tv.el || (d && tv.d !== d)) return;
    const T = tv.el, dd = tv.d;
    // lo que el modo TV todavía no mostró (los cuadros que esperaban su retraso y la cola de la banda) sale en la
    // pizarra al volver, como mucho 2 (salvo si se fue del juego)
    let pend = [];
    if (why !== 'ruta' && tv.live && dd && dd.hist) {
      const H = dd.hist, j = H.indexOf(tv.shown);
      pend = tv.mq.slice();
      for (let i = j + 1; i < H.length; i++) H[i].mo.forEach(m => { if (!tv.seen.has(moKey(m))) pend.push(m); });
    }
    clearTimeout(tv.timer); clearTimeout(tv.mt); clearTimeout(tv.srt); clearInterval(tv.avisoT);
    tv.timer = tv.mt = tv.srt = tv.avisoT = 0;
    Object.keys(tv.ctl).forEach(k => { const c = tv.ctl[k]; if (c && typeof c.destroy === 'function') safe(() => c.destroy()); });
    tv.ctl = {};
    tv.off.forEach(f => f());
    tv.off = [];
    tv.quietos.forEach(n => n.removeAttribute('inert'));
    tv.quietos = [];
    document.documentElement.classList.remove('tv-on');
    tv.el = null;
    tv.d = null;
    tv.shown = null;
    tv.mo = null;
    tv.mq = [];
    T.remove();
    if (tv.lock) { const l = tv.lock; tv.lock = null; l.release().catch(() => {}); }
    // abierto solo al girar y cerrado a mano: no vuelve a salir hasta que se gire otra vez
    if (tv.auto && why !== 'giro' && why !== 'ruta') tv.dismissed = true;
    if (tv.paso && why !== 'atras' && why !== 'ruta') { tv.paso = false; try { history.back(); } catch (e) { /* nada */ } }
    tv.paso = false;
    if (why !== 'ruta' && dd && view && view.d === dd) {
      // de vuelta en la pantalla de siempre (que siguió al día por debajo)
      const o = tv.opener && tv.opener.isConnected ? tv.opener : view.el.querySelector('.gm-tv');
      if (o) { try { o.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
      paintChapita(dd);
      if (pend.length) pushMoments(view.el, dd, topOf(pend, 2), 'vivo');
    }
    tv.opener = null;
  }
  window.addEventListener('popstate', () => {
    if (tv.el && tv.paso && !(history.state && history.state.tv)) { tv.paso = false; tvClose(tv.d, 'atras'); return; }
    // Adelante hasta el paso de un modo TV que ya se cerró: se salta
    if (!tv.el && history.state && history.state.tv) history.back();
  });
  // En el teléfono, girarlo a horizontal abre el modo TV; volver a vertical lo cierra (si se abrió así).
  const tvMq = root.matchMedia ? root.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)') : null;
  function tvTurn() {
    if (!tvMq) return;
    if (tvMq.matches) { if (view && view.d && !tv.el && !tv.dismissed && view.d.layout) tvOpen(view.d, true); }
    else { tv.dismissed = false; if (tv.el && tv.auto) tvClose(tv.d, 'giro'); }
  }
  if (tvMq) { if (tvMq.addEventListener) tvMq.addEventListener('change', tvTurn); else if (tvMq.addListener) tvMq.addListener(tvTurn); }

  // ---------- compartir ----------
  // "MAG 3-2 ANZ · alta del 7.º" (en vivo), "MAG 14-6 ANZ · Final", "MAG vs. ANZ · sáb 12 oct, 7:00 p. m." (por jugar), y
  // el enlace al juego (core.js: PC.share completa la dirección).
  function shareText(d) {
    const A = side(d, 'away'), H = side(d, 'home'), g = d.feed.gameData, stObj = d.st || g.status || {};
    const M = withLive(d, () => moment(d)), ls = M.ls || {};
    const score = `${A.abbr} ${M.tot.away.r}-${M.tot.home.r} ${H.abbr}`, vs = `${A.abbr} vs. ${H.abbr}`;
    if (d.status === 'live') {
      const st = /delayed/i.test(stObj.detailedState || '') ? (C.statusText(stObj) || 'juego detenido').toLowerCase() : M.inning ? halfLabel(M.inning, M.top, M.state).toLowerCase() : 'en vivo';
      return `${score} · ${st}`;
    }
    if (d.status === 'final') return `${score} · ${finalText(ls.currentInning, ls.scheduledInnings || 9, stObj.reason, /tied/i.test(stObj.detailedState || ''))}`;
    if (d.status === 'pre') {
      const dt = g.datetime || {}, tbd = stObj.startTimeTBD || dt.startTimeTBD;
      return `${vs} · ${D.short(dt.officialDate)}${tbd ? '' : `, ${D.time(Date.parse(dt.dateTime))}`}`;
    }
    return `${d.done.length ? score : vs} · ${C.statusText(stObj) || (d.status === 'post' ? 'Pospuesto' : 'Suspendido')}`;
  }
  // Con el menú de compartir abierto, otro toque no hace nada; los avisos los da PC.share ("Enlace copiado", el error).
  let sharing = false;
  function shareGame(d) {
    if (sharing || !d || !d.feed || typeof PC.share !== 'function') return;
    const A = side(d, 'away'), H = side(d, 'home');
    sharing = true;
    let p;
    try { p = PC.share({ title: `${A.short} en ${H.short}`, text: shareText(d), url: `#/juego/${d.pk}` }); } catch (e) { p = null; }
    Promise.resolve(p).catch(() => {}).then(() => { sharing = false; });
  }

  // ---------- la pantalla ----------
  function killCharts(d) {
    if (!d.ctl) return;
    kill(d.ctl.fld); kill(d.ctl.zn); kill(d.wp); kill(d.sp);
    (d.plz || []).forEach(kill);
    d.ctl = {}; d.wp = null; d.sp = null; d.plz = [];
  }

  function draw(el, ctx, keep) {
    const d = ctx.data, g = d.feed.gameData;
    const y = keep ? window.scrollY : 0;
    const tabs = tabsOf(d);
    if (!d.tab || !tabs.some(([k]) => k === d.tab)) d.tab = defTab(d);
    d.layout = layoutOf(d);
    killCharts(d);
    const A = side(d, 'away'), H = side(d, 'home');
    const last = d.steps.length - 1;
    const speed = d.speed || 1;
    const replay = d.status === 'final' && d.done.length ? `<section class="replay" aria-label="Repetir el juego">
        <div class="rp-row"><button type="button" class="btn rp-play">${rpButton(d.cursor == null || d.finale ? 'repetir' : 'seguir')}</button>
        <input type="range" id="rp" min="0" max="${last}" value="${curStep(d)}" aria-label="Elegir ${d.byPitch ? 'lanzamiento' : 'jugada'}"></div>
        <div class="rp-foot"><p class="rp-label">${esc(rpText(d))}</p>
        <div class="rp-vel" role="group" aria-label="Velocidad">${SPEEDS.map(s => `<button type="button" data-vel="${s}" aria-pressed="${s === speed}">${s}×</button>`).join('')}</div></div></section>` : '';
    const date = g.datetime.officialDate;
    // El armazón va vacío; las piezas (pizarra, pestaña visible, curva, mapa) las llena update(), el camino del refresco.
    // La miga no lleva data-back: dice "Juegos del 27 dic" y lleva a ese día (core.js vuelve atrás solo si la
    // pantalla anterior es ese día; si se llegó desde un equipo o un jugador, abre el día como paso nuevo).
    // El h1 y la región que se anuncia en vivo son solo para el lector de pantalla. .rp-marca: el lugar de la barra de
    // la repetición (watchBar).
    // A la derecha de la miga, el modo TV (en vivo y con repetición) y compartir (si core.js lo trae).
    const acts = (tvAllowed(d) ? `<button type="button" class="gm-act gm-tv" aria-label="Modo TV: el juego a pantalla completa" title="Modo TV">${I_TV}</button>` : '') +
      (typeof PC.share === 'function' ? `<button type="button" class="gm-act gm-share" aria-label="Compartir el juego" title="Compartir">${I_SHARE}</button>` : '');
    el.innerHTML = `<nav class="crumbs gm-crumbs"><a class="gm-back" href="#/juegos/${date}">${I_LEFT}<span>Juegos del ${esc(D.short(date))}</span></a>${acts ? `<span class="gm-acts">${acts}</span>` : ''}</nav>
      <h1 class="sr">${esc(A.name)} en ${esc(H.name)}</h1>
      <section class="board-wrap" aria-label="Pizarra"><div class="board"></div>${replay ? '<i class="rp-marca" aria-hidden="true"></i>' : ''}</section>
      <p id="vivo-sr" class="sr" aria-live="polite"></p>
      ${replay}
      <section class="sec gm-tabsec">
        <div class="seg gm-tabs" role="tablist" aria-label="Detalle del juego">${tabs.map(([k, l]) => `<button type="button" role="tab" id="tb-${k}" data-tab="${k}" aria-controls="tab-${k}" aria-selected="false" tabindex="-1">${l}</button>`).join('')}<span class="seg-ind" aria-hidden="true"></span></div>
        ${tabs.map(([k]) => `<div id="tab-${k}" class="${k === 'resumen' ? 'gm-res' : ''}" role="tabpanel" aria-labelledby="tb-${k}" hidden>${k === 'resumen' ? resumenHTML(d) : ''}</div>`).join('')}
      </section>
      ${U.fresh(freshOf(d))}`;
    d.stale = new Set();
    d.mo = null;
    d.mq = [];
    clearTimeout(d.mt);
    // La pestaña a la vista antes de pintar: los gráficos miden su ancho. update() pinta la pizarra mostrando el inning
    // en juego (showInning: extrainnings, letra grande). Si la letra de la pizarra todavía está cargando, las casillas
    // cambian de ancho al llegar: se vuelve a mirar. Al abrir, el mapa, las figuras y las jugadas clave van en el
    // cuadro siguiente (d.lazyRes).
    showTab(el, d, d.tab, true);
    d.lazyRes = !keep;
    update(el, d);
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (ctx.alive()) { showInning(el, true); moveInd(el, true); } });

    const seg = el.querySelector('.gm-tabs');
    seg.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(el, d, b.dataset.tab); });
    seg.addEventListener('scroll', () => tabEdges(seg), { passive: true });
    // Teclado de unas pestañas (role=tab): flechas a los lados, Inicio y Fin.
    seg.addEventListener('keydown', e => {
      const keys = tabs.map(([k]) => k), i = keys.indexOf(d.tab), n = keys.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      showTab(el, d, keys[j]);
      seg.querySelector(`[data-tab="${keys[j]}"]`).focus();
    });
    // La pizarra: el historial entre los dos (buscarlo, mostrarlo o esconderlo), volver a lo de ahora, cerrar la banda.
    el.querySelector('.board-wrap').addEventListener('click', e => {
      const t = e.target;
      const vs = t.closest('[data-vs]');
      if (vs) {
        if (vs.getAttribute('aria-disabled') === 'true') return;
        const key = vs.dataset.vs, got = d.vs.get(key);
        if (got && got !== 'error') { d.vsOpen = d.vsOpen === key ? null : key; paintBoard(el, d); } else vsLoad(el, d, key);
        return;
      }
      if (t.closest('[data-go="ahora"]')) { stopReplay(d); d.cursor = null; d.pitch = null; clearMoments(el, d); still(el, () => update(el, d)); return; }
      if (t.closest('.mo-band')) showMoment(el, d);
    });
    // Resumen: una jugada clave lleva a ese momento (sin subir la página); el filtro del mapa por equipo.
    const res = el.querySelector('#tab-resumen');
    if (res) res.addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go) { pickPlay(el, d, +go.dataset.go, false, 'toque'); return; }
      const sb = e.target.closest('.sp-fil [data-side]');
      if (!sb) return;
      d.side = sb.dataset.side || null;
      sb.parentNode.querySelectorAll('[data-side]').forEach(b => b.setAttribute('aria-pressed', String(b === sb)));
      const box = el.querySelector('#spray-chart');
      if (box) box._k = null;
      drawSpray(el, d);
    });

    const rp = el.querySelector('#rp');
    if (rp) {
      // arrastrar el deslizador: un cuadro por vez, la chapita (y la pizarra si se ve); al soltar, todo. Si la
      // repetición andaba, al soltar el lector oye dónde quedó.
      rp.addEventListener('input', () => {
        if (d.timer) { stopReplay(d); d.paused = true; setBtn(el, d); }
        d.dragTo = +rp.value;
        if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (ctx.alive()) goStep(el, d, d.dragTo, 'drag'); });
      });
      rp.addEventListener('change', () => {
        if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
        const was = d.paused || !!d.timer;
        stopReplay(d);
        d.drag = null;
        d.paused = false;
        still(el, () => goStep(el, d, +rp.value, 'jump'));
        if (was) say(el, d, pauseText(d));
      });
      el.querySelector('.rp-play').addEventListener('click', () => {
        if (d.timer) { stopReplay(d); setBtn(el, d); say(el, d, pauseText(d)); return; }
        playReplay(el, ctx);
        // a ver la pizarra: si quedó arriba, fuera de la pantalla, se sube a ella (el control queda abajo, fijo)
        const w = el.querySelector('.board-wrap');
        if (w && w.getBoundingClientRect().top < topH()) {
          root.scrollTo({ top: Math.max(0, w.getBoundingClientRect().top + root.scrollY - topH() - 8), behavior: reduced() ? 'auto' : 'smooth' });
        }
      });
      el.querySelector('.rp-vel').addEventListener('click', e => {
        const b = e.target.closest('[data-vel]');
        if (!b) return;
        d.speed = +b.dataset.vel;
        b.parentNode.querySelectorAll('[data-vel]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        PC.state.prefs.rpSpeed = d.speed;
        PC.savePrefs();
      });
    }
    // modo TV y compartir
    const actsEl = el.querySelector('.gm-acts');
    if (actsEl) actsEl.addEventListener('click', e => {
      if (e.target.closest('.gm-tv')) tvOpen(d, false);
      else if (e.target.closest('.gm-share')) shareGame(d);
    });
    watchBoard(el, d);
    watchBar(el, d);
    if (keep) window.scrollTo(0, y);
    // el teléfono ya está en horizontal al abrir el juego: el modo TV de una vez (salvo que lo hayan cerrado así)
    else if (tvMq && tvMq.matches && !tv.dismissed && !tv.el) tvOpen(d, true);
  }

  // Datos que salen de las jugadas (calc.js): la zona del juego, las marcas de la curva, el mapa y los pasos de la
  // repetición. Los juegos viejos (2010-2014) no traen lanzamiento a lanzamiento (C.pitchDataOk): su repetición va
  // jugada a jugada, sin zona ni cuenta.
  function derive(d) {
    const done = d.done;
    d.memo = new Map();
    d.defMemo = new Map();
    d.byPitch = byPitch() && (!has(C, 'pitchDataOk') || safe(C.pitchDataOk, done) !== false);
    d.zbox = done.length && has(C, 'zoneBox') ? safe(C.zoneBox, done) : null;
    d.marks = d.wpa && has(C, 'wpMarks') ? safe(C.wpMarks, done) : null;
    d.spray = has(C, 'sprayPoints') ? safe(C.sprayPoints, done) || [] : null;
    // un paso por lanzamiento (sin la secuencia, uno por jugada); el último cierra el juego
    d.steps = [];
    d.first = [];
    done.forEach((p, k) => {
      d.first[k] = d.steps.length;
      const n = d.byPitch ? (seqOf(p) || []).length : 0;
      if (!n) d.steps.push([k, null]);
      else for (let i = 0; i < n; i++) d.steps.push([k, i]);
    });
    // la repetición se detiene un momento en las 5 jugadas clave y en los jonrones
    d.pause = new Set();
    if (d.wpa) d.wpa.plays.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5).forEach(p => d.pause.add(p.i));
    done.forEach((p, k) => { if (p.result && p.result.eventType === 'home_run') d.pause.add(k); });
  }

  // El juego completo y la probabilidad de ganar se piden a la vez (wp: la respuesta ya pedida; undefined, se pide aquí).
  const wpFor = (d, st) => !/^(pre|post)$/.test(st || '');
  // Las jugadas terminadas de un juego completo, y el turno en curso (su índice; null si no hay uno sin terminar).
  const doneOf = feed => (feed.liveData.plays.allPlays || []).reduce((a, p) => a + (p.about && p.about.isComplete ? 1 : 0), 0);
  const abOf = feed => { const cp = feed.liveData.plays.currentPlay; return cp && cp.about && !cp.about.isComplete ? cp.about.atBatIndex : null; };
  // La probabilidad se pide con cada turno (cada jugada terminada y cada turno nuevo) mientras la presión del último turno
  // que se sabe llegue a esto; si no, cada 2 jugadas (0: siempre con cada turno). Así entra en 1,5 MB por juego.
  const WP_LI = 0.8;
  // La probabilidad de ganar de una respuesta (d.wpRaw, tal cual: el vivo la vuelve a usar hasta el próximo pedido).
  // Valen las jugadas que ya estaban terminadas cuando se pidió (d.wpN): la que venía en curso pudo terminar distinto.
  // La presión del turno en curso, si la respuesta lo trae y sigue siendo ese turno.
  function wpUse(d, wp) {
    d.wpRaw = wp || null;
    d.wpa = wp ? safe(C.wpa, wp) : null;
    d.liLive = null;
    d.liLast = null;
    if (!d.wpa) return;
    const k = Math.min(d.done.length, d.wpN != null ? d.wpN : d.done.length), cur = d.wpa.plays[k] || null;
    if (k === d.done.length && cur) d.liLive = cur.li;
    // la presión más nueva que se sabe (wpDue): la del turno que estaba en curso al pedir o, si no vino, la última jugada
    d.liLast = cur && cur.li != null ? cur.li : k > 0 && d.wpa.plays[k - 1] ? d.wpa.plays[k - 1].li : null;
    d.wpa.plays = d.wpa.plays.slice(0, k);
  }
  // En vivo, ¿toca pedir la probabilidad de ganar? Con presión (la más nueva que se sabe, d.liLast, ≥ WP_LI, o sin
  // saberla): con cada jugada terminada desde el último pedido (d.wpAt: la curva al día) y con cada turno nuevo (d.wpAb:
  // su presión). Sin presión: con 2 jugadas terminadas, con una carrera o el tercer out, o si todavía no hay ninguna.
  // En Final, solo si a la curva le falta alguna jugada (si la API venía atrasada, se vuelve a pedir en los ciclos del
  // Final). Más, al abrir la curva o el modo TV (wpCatchUp).
  function wpDue(d, feed, n, st, ab) {
    const k = d.wpAt || 0;
    if (st === 'final') return n > (d.wpN || 0) || !d.wpa || d.wpa.plays.length < n;
    if (!(WP_LI > 0) || d.liLast == null || d.liLast >= WP_LI) return n > k || (ab != null && ab !== d.wpAb);
    if (n <= k) return false;
    if (n - k >= 2 || !d.wpRaw || pauseOf(feed.liveData.linescore)) return true;
    // una carrera o el tercer out entre las jugadas nuevas: la curva se mueve
    return (feed.liveData.plays.allPlays || []).filter(p => p.about && p.about.isComplete).slice(k, n)
      .some(p => (p.count && p.count.outs >= 3) || p.about.isScoringPlay);
  }
  // Al abrir la curva (la pestaña Resumen) o el modo TV en vivo: si a la probabilidad le faltan jugadas, se pide ya y
  // se repinta (si mientras tanto el vivo trajo una más nueva, queda esa).
  async function wpCatchUp(d) {
    if (d.status !== 'live' || d.wpBusy || !d.feed || !d.done.length || (d.wpRaw && (d.wpN || 0) >= d.done.length)) return;
    const n = d.done.length, ab = abOf(d.feed);
    d.wpBusy = true;
    let wp = null;
    try { wp = await API.winProb(d.pk, true); } catch (e) { wp = null; }
    d.wpBusy = false;
    const v = view;
    if (!wp || !v || v.d !== d || !v.ctx.alive() || (d.wpN || 0) > n) return;
    d.wpN = n;
    if (n >= (d.wpAt || 0)) { d.wpAt = n; d.wpAb = ab; }
    wpUse(d, wp);
    derive(d);
    if (layoutOf(d) !== d.layout) draw(v.el, v.ctx, true);
    else still(v.el, () => update(v.el, d, {}));
    tvLive(d, null);
  }
  async function load(ctx, feed, live, watch, wp) {
    const d = ctx.data;
    const before = d.status;
    d.feed = feed;
    d.ls = null;
    d.cp = null; // el turno en curso sale del juego completo hasta la próxima vigilancia
    d.st = watch && watch.gameData ? watch.gameData.status : null;
    d.status = C.gameStatus(feed.gameData.status);
    d.warm = /warmup/i.test(feed.gameData.status.detailedState || '');
    if (watch) d.wcp = !!cpOf(watch);
    d.sig = sigOf(feed.liveData.linescore, feed.gameData.status, d.wcp ? feed.liveData.plays.currentPlay : null);
    if (d.status === 'final' && before && before !== 'final') d.finalAt = Date.now(); // seguir un rato: llegan las decisiones
    d.done = (feed.liveData.plays.allPlays || []).filter(p => p.about && p.about.isComplete);
    d.wpa = null;
    d.liLive = null;
    if (wpFor(d, d.status) && d.done.length) {
      if (wp === undefined) { d.wpN = d.wpAt = d.done.length; d.wpAb = abOf(feed); try { wp = await API.winProb(d.pk, live); } catch (e) { wp = null; } }
      wpUse(d, wp);
    }
    if ((d.status === 'pre' || d.status === 'post') && !d.stats) {
      try { d.stats = await PC.statsCtx(+feed.gameData.game.season, 'R'); } catch (e) { d.stats = null; }
    }
    derive(d);
  }
  // Hora del dato de un juego completo según la API ("20260203_004000"): para no pintar uno viejo como nuevo.
  const tsOf = f => (f && f.metaData && f.metaData.timeStamp) || '';
  // La misma hora en milisegundos (UTC), o null.
  const tsMs = f => {
    const m = /^(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)$/.exec(tsOf(f));
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  };
  // "Actualizado hace…": lo último que se confirmó al día (diffPatch puede confirmar sin bajar nada).
  const freshOf = d => Math.max(API.when(d.feed), d.okAt || 0);

  // ---------- el vivo ----------
  // Lo que sigue a un juego recalculado (diffPatch o la vigilancia de la Fase 2): los momentos de las jugadas nuevas,
  // completas, y del turno en curso solo sus cambios de lanzador (si la persona no está mirando otro momento de la
  // curva); la pantalla por piezas, o entera si cambió de forma (empezó o terminó el juego).
  function afterLoad(el, ctx, from) {
    const d = ctx.data, fr = el.querySelector('[data-ago]');
    const list = d.cursor == null ? momentsOf(d, from - 1, d.done.length - 1).concat(changesNow(d)) : [];
    if (list.length) { d.srSig = d.sig.turn; const lp = lastDone(d); d.srLast = lp && lp.result && lp.result.description; } // lo dice la banda
    if (layoutOf(d) === d.layout) {
      still(el, () => update(el, d, { anim: d.cursor == null }));
      if (fr) fr.dataset.ago = String(freshOf(d));
    } else {
      // el juego acaba de terminar con momentos (la carrera del final, el fin del juego): salen sobre la pizarra del
      // turno de la última jugada, y la de siempre vuelve cuando termina la banda (showMoment). Con el modo TV abierto, la
      // banda sale allá: aquí queda la de siempre.
      if (d.status === 'final' && list.length && d.done.length && d.cursor == null && !tvOn(d)) { d.cursor = d.done.length - 1; d.pitch = null; d.finale = true; }
      draw(el, ctx, true);
    }
    tvLive(d, list); // el modo TV lo muestra con su retraso
    if (!tvOn(d)) pushMoments(el, d, list, 'vivo');
  }

  // Un ciclo con diffPatch (api.js: feedPatch). Devuelve false si este ciclo va con la vigilancia de la Fase 2: diffPatch
  // falló dos veces seguidas (entonces la Fase 2 sigue por PATCH_RETRY y después se vuelve a probar).
  // ¿Un error de red? (sin señal, la conexión se cortó o tardó demasiado). No cuenta como falla de diffPatch: el ciclo
  // siguiente vuelve a probar con diffPatch; la vigilancia de la Fase 2 no ayudaría sin red. Cuentan solo las respuestas
  // que no sirven (api.js: el juego que no es juego, un error del servidor).
  const deRed = e => !!e && !e.http && (e.name === 'TypeError' || e.name === 'AbortError' || /sin conexi/i.test(String(e.message || '')) || API.status.online === false);
  async function refreshPatch(el, ctx) {
    const d = ctx.data;
    let r = null, red = false;
    try { r = await API.feedPatch(d.pk, d.feed); } catch (e) { r = null; red = deRed(e); }
    if (!ctx.alive()) return true;
    const feed = r && r.feed;
    if (!feed || !feed.gameData || !feed.liveData || !feed.liveData.plays) {
      if (red) return true; // sin red: el próximo ciclo, diffPatch otra vez
      d.pf = (d.pf || 0) + 1;
      if (d.pf < 2) return true; // el próximo ciclo vuelve a probar
      d.pf = 0;
      d.f2At = Date.now();
      return false;
    }
    d.pf = 0;
    d.f2At = 0;
    d.okAt = Date.now();
    await fromPatch(el, ctx, feed, r.modo);
    return true;
  }
  // El juego al día. diffPatch no copia el juego: el objeto es el mismo y lo que cambió es nuevo (calc.js: applyPatch),
  // así que todo se lee otra vez desde d.feed. Las firmas y lo que se repinta son los de la Fase 2: con la misma firma
  // del turno solo la pizarra (si cambió la del lanzamiento); con otra, todo. La probabilidad de ganar, cuando toca
  // (wpDue). El resincronizado de api.js (/feed/live, 'completo' con sync) entra por el mismo camino: trae las mismas
  // jugadas con las correcciones del anotador, y como los momentos salen solo de las jugadas nuevas (afterLoad) y una
  // sola vez (d.seen), no repite bandas.
  async function fromPatch(el, ctx, feed, modo) {
    const d = ctx.data, fr = el.querySelector('[data-ago]');
    const ago = () => { if (fr) fr.dataset.ago = String(freshOf(d)); };
    const same = feed === d.feed;
    if (same && modo === 'igual') { ago(); return; }
    // un juego completo más viejo que el que ya está no se pinta
    const t1 = tsOf(feed), t0 = tsOf(d.feed);
    if (!same && t1 && t0 && t1 < t0) { ago(); return; }
    // todo sale del juego, que ya está al día (nada de la vigilancia)
    d.ls = null; d.cp = null; d.st = null; d.wcp = true;
    const cp = feed.liveData.plays.currentPlay || null;
    const sig = sigOf(feed.liveData.linescore, feed.gameData.status, cp);
    if (same && sig.turn === d.sig.turn) {
      if (sig.pitch !== d.sig.pitch) {
        d.sig = sig;
        // si se está leyendo más abajo (el box, el jugada a jugada), lo que se lee no se mueve
        still(el, () => paintBoard(el, d, d.cursor == null ? 'paso' : null));
        paintChapita(d);
        tvLive(d, null);
      }
      ago();
      return;
    }
    const from = d.done.length;
    const n = doneOf(feed), st = C.gameStatus(feed.gameData.status), ab = abOf(feed);
    let wp = d.wpRaw;
    if (wpFor(d, st) && n && wpDue(d, feed, n, st, ab)) {
      // si falla, sigue la que había (con sus jugadas) y no se reintenta hasta la próxima jugada o el próximo turno
      let ok = true;
      const r = await API.winProb(d.pk, true).catch(() => { ok = false; return null; });
      if (!ctx.alive()) return;
      d.wpAt = n;
      d.wpAb = ab;
      if (ok) { wp = r; d.wpN = n; }
    }
    await load(ctx, feed, true, null, wp);
    if (!ctx.alive()) return;
    afterLoad(el, ctx, from);
    ago();
  }

  // Un ciclo con la vigilancia de la Fase 2: la consulta liviana; el juego completo solo si cambió el turno.
  async function refreshWatch(el, ctx) {
    const d = ctx.data;
    const watch = await API.watch(d.pk);
    if (!ctx.alive() || !watch || !watch.gameData) return;
    d.okAt = Date.now(); // dato al día (el modo TV avisa si pasa mucho sin esto)
    const fr = el.querySelector('[data-ago]');
    const wls = watch.liveData && watch.liveData.linescore, wcp = cpOf(watch);
    d.wcp = !!wcp;
    const sig = sigOf(wls, watch.gameData.status, wcp);
    // la pizarra con lo de la vigilancia: la cuenta, los corredores y la zona
    const byWatch = () => {
      d.ls = wls;
      d.st = watch.gameData.status;
      if (wcp) d.cp = wcp;
      // si se está leyendo más abajo (el box, el jugada a jugada), lo que se lee no se mueve
      still(el, () => paintBoard(el, d, d.cursor == null ? 'paso' : null));
      paintChapita(d);
      tvLive(d, null, tsMs(watch)); // el retraso del modo TV, desde la hora de la vigilancia
    };
    if (sig.turn === d.sig.turn) {
      if (sig.pitch !== d.sig.pitch) { d.sig = sig; byWatch(); } else { d.ls = wls; d.st = watch.gameData.status; if (wcp) d.cp = wcp; }
      if (fr) fr.dataset.ago = String(API.when(watch));
      return;
    }
    const from = d.done.length;
    // la Fase 2 pide la probabilidad con cada juego completo (el juego pesa mucho más); si falla, sigue la que había
    let wpOk = true;
    const [feed, wp] = await Promise.all([API.feed(d.pk, true), API.winProb(d.pk, true).catch(() => { wpOk = false; return d.wpRaw || null; })]);
    if (!ctx.alive()) return;
    // un juego completo que no es más nuevo que el que ya está (falló la red y api.js dio la copia, o llegó tarde):
    // no se pinta como si fuera de ahora. La pizarra sigue con la vigilancia y d.sig no cambia: el próximo ciclo lo
    // vuelve a pedir. Con la misma hora pero otro estado sí vale: el paso a Final llega sin cambiar la hora del dato.
    const t1 = tsOf(feed), t0 = tsOf(d.feed);
    const otroEstado = (feed.gameData.status || {}).statusCode !== (d.feed.gameData.status || {}).statusCode;
    if (feed === d.feed || (t1 && t0 && (t1 < t0 || (t1 === t0 && !otroEstado)))) { byWatch(); return; }
    d.wpAt = doneOf(feed);
    d.wpAb = abOf(feed);
    if (wpOk) d.wpN = d.wpAt;
    await load(ctx, feed, true, watch, wp);
    if (!ctx.alive()) return;
    afterLoad(el, ctx, from);
  }

  // La posición de cada juego en el historial (pestaña, jugada de la repetición, filtro del mapa), para cuando se vuelve:
  // al abrir un jugador desde el juego y volver atrás, la pantalla se rehace (core.js) y sin esto volvería al Resumen y
  // al final del juego. Se guarda por juego y por su lugar en el historial (history.state.pc, lo pone core.js antes de
  // pintar); si desde el juego se vuelve atrás (a un lugar anterior), se olvida: entrar otra vez al juego desde la lista
  // lo abre como siempre.
  const spots = new Map();
  function keepSpot(d) {
    if (d.spot == null || !d.layout) return; // se fue antes de pintar: lo guardado sigue valiendo
    const s = history.state, back = !!s && typeof s.pc === 'number' && s.pc < d.pos;
    spots.delete(d.spot);
    if (!back) spots.set(d.spot, { tab: d.tab, side: d.side || null, cursor: d.cursor, pitch: d.pitch });
    if (spots.size > 20) spots.delete(spots.keys().next().value);
  }

  // La pantalla abierta (para lo que llega por eventos del documento: abrir un turno del jugada a jugada, Escape).
  let view = null;

  PC.register('juego', {
    tab: 'juegos',
    // el esqueleto de un juego en vivo tiene la forma de la pizarra del turno (la lista avisa con PC.state.hint)
    skeleton: args => { const h = PC.state && PC.state.hint; return h && +h.pk === +args[0] && h.status === 'live' ? 'juegoVivo' : 'juego'; },
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
      d.pitch = null;
      d.ctl = {};
      d.broken = {}; // dibujos de charts.js que fallaron en esta pantalla
      d.plz = [];
      d.mq = [];
      d.srq = [];
      d.seen = new Set();
      d.vs = new Map();
      d.speed = SPEEDS.indexOf(+PC.state.prefs.rpSpeed) >= 0 ? +PC.state.prefs.rpSpeed : 1;
      d.hist = []; // el vivo, para el modo TV con retraso
      view = { el, d, ctx };
      // lugar en el historial de esta pantalla (keepSpot); se lee antes de esperar a la red
      d.pos = history.state && typeof history.state.pc === 'number' ? history.state.pc : null;
      d.spot = d.pos == null ? null : `${d.pos}|${pk}`;
      // Primero la vigilancia (~1 KB, siempre fresca): si el juego no ha terminado, el completo se pide fresco también.
      // El juego completo y la probabilidad, a la vez.
      const watch = await API.watch(pk).catch(() => null);
      if (!ctx.alive()) return;
      const ws = watch ? C.gameStatus(watch.gameData.status) : null;
      const live = ws !== 'final';
      const [feed, wp] = await Promise.all([API.feed(pk, live), wpFor(d, ws) ? API.winProb(pk, live).catch(() => null) : undefined]);
      if (!ctx.alive()) return;
      if (wp !== undefined) { d.wpN = d.wpAt = doneOf(feed); d.wpAb = abOf(feed); } // con esta probabilidad ya bajada
      await load(ctx, feed, live, watch, wp);
      if (!ctx.alive()) return;
      // lo que ya pasó en el turno en curso (un cambio de lanzador) no sale después como novedad
      changesNow(d);
      // de vuelta de un jugador: la misma pestaña, el mismo filtro y la repetición donde estaba
      const s = d.spot == null ? null : spots.get(d.spot);
      if (s) {
        d.tab = s.tab;
        d.side = s.side;
        if (s.cursor != null && d.status === 'final' && s.cursor < d.done.length) { d.cursor = s.cursor; d.pitch = s.pitch; }
      }
      // el primer cuadro del vivo para el modo TV (con retraso muestra lo de hace un rato: desde aquí se guarda)
      if (d.status === 'live') tvLive(d, null);
      draw(el, ctx);
    },
    // En vivo: diffPatch (api.js: feedPatch), salvo que haya fallado dos veces seguidas; entonces la vigilancia de la
    // Fase 2 por PATCH_RETRY. Sin feedPatch (un api.js de antes), la vigilancia.
    async refresh(el, args, ctx) {
      const d = ctx.data;
      if (!d.feed) return;
      const patch = has(API, 'feedPatch') && !(d.f2At && Date.now() - d.f2At < PATCH_RETRY);
      if (!(patch && await refreshPatch(el, ctx)) && ctx.alive()) await refreshWatch(el, ctx);
      if (tvOn(d)) tvAviso();
    },
    leave(ctx) {
      const d = ctx.data;
      tvClose(d, 'ruta');
      stopReplay(d);
      unwatch(d);
      if (d.bio) { d.bio.disconnect(); d.bio = null; }
      keepSpot(d);
      clearTimeout(d.mt);
      clearTimeout(d.srt);
      d.srt = 0;
      d.srq = [];
      if (d.raf) cancelAnimationFrame(d.raf);
      killCharts(d);
      if (view && view.d === d) view = null;
    }
  });

  // ---------- esqueleto: la forma de un juego terminado (lo más común al abrir uno) ----------
  // Las mismas clases de la pantalla (draw y boardClassic): la miga, la pizarra apagada, la repetición, las pestañas y el
  // comienzo del Resumen. Un texto de muestra que no se ve (.sk-t) mide lo mismo que el de verdad.
  const sk = (w, h, more) => `<span class="sk" style="width:${w};height:${h}${more ? ';' + more : ''}"></span>`;
  const ghost = t => `<span class="sk-t">${esc(t)}</span>`;
  const times = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  // la miga con el modo TV y compartir, apagados
  const skCrumbs = () => `<nav class="crumbs gm-crumbs"><a class="gm-back">${I_LEFT}${ghost('Juegos del 00 oct')}</a>` +
    `<span class="gm-acts"><span class="gm-act">${I_TV}</span><span class="gm-act">${I_SHARE}</span></span></nav>`;
  const skLine = () => {
    const tr = () => `<tr><th>&nbsp;</th>${times(9, () => '<td>&nbsp;</td>')}<td class="rhe r">&nbsp;</td><td class="rhe">&nbsp;</td><td class="rhe">&nbsp;</td></tr>`;
    return `<div class="bt-line"><table><thead><tr><th></th>${times(9, i => `<th>${i + 1}</th>`)}<th class="rhe">C</th><th class="rhe">H</th><th class="rhe">E</th></tr></thead>` +
      `<tbody>${tr()}${tr()}</tbody></table></div>`;
  };
  const skTabs = () => `<div class="sec gm-tabsec"><div class="seg gm-tabs">${['Resumen', 'Box', 'Jugadas', 'Datos'].map(t => `<button type="button" tabindex="-1">${ghost(t)}</button>`).join('')}</div>` +
    `<div class="gm-res" role="tabpanel"><div class="sec"><div class="sec-head"><h2>${ghost('Probabilidad de ganar')}</h2></div>` +
    `<div class="wp-now"><p>${ghost('Magallanes')} <b>${ghost('00%')}</b></p><p>${ghost('Cardenales')} <b>${ghost('00%')}</b></p></div>` +
    `${sk('100%', '13rem', 'border-radius:12px')}</div></div></div>`;
  U.skeletons.juego = () => {
    const row = name => `<div class="bt-row"><span class="bt-abbr">···</span><a class="bt-name">${ghost(name)}<small>${ghost('00-00')}</small></a><span class="bt-runs">0</span></div>`;
    return skCrumbs() +
      `<section class="board-wrap"><div class="board"><p class="bt-status"><span class="pill">Final</span>` +
      `<span class="bt-venue">${ghost('Estadio Alfonso Chico Carrasquel')}</span></p>${row('Magallanes')}${row('Cardenales')}${skLine()}</div></section>` +
      `<div class="replay"><div class="rp-row">${sk('112px', '44px', 'border-radius:10px')}${sk('auto', '6px', 'flex:1')}</div>` +
      `<div class="rp-foot"><p class="rp-label">${ghost('Jugada 00 de 00 · Baja del 9.º')}</p><div class="rp-vel">${SPEEDS.map(s => `<button type="button" tabindex="-1">${ghost(s + '×')}</button>`).join('')}</div></div></div>` +
      skTabs();
  };
  // Un juego en vivo (la lista deja PC.state.hint = {pk, status} al tocar su tarjeta): la pizarra del turno, con las
  // mismas clases de boardTurno (estado, marcador con los bombillos, campo y zona, secuencia, duelo, franja de
  // comentario y línea), así la pizarra no salta al llegar. El campo y la zona miden lo que miden sus dibujos.
  U.skeletons.juegoVivo = () => {
    const bl = (n, l) => `<span class="bl"><b>${l}</b><span>${times(n, () => '<i></i>')}</span></span>`;
    const card = (a, b) => `<div class="dc"><p class="dc-lab"><span>${ghost(a)}</span></p><p class="dc-nm">${ghost(b)}</p><p class="dc-ln">${ghost('Hoy 0-0: sencillo')}</p></div>`;
    return skCrumbs() +
      `<section class="board-wrap"><div class="board turno"><p class="bt-status"><span class="pill live">En vivo</span> ${ghost('Alta del 0.º')}</p>` +
      `<div class="sc-row"><div class="sc"><span class="sc-t away"><span class="bt-abbr">···</span></span><span class="sc-r flip">0</span><span class="sc-dash">–</span>` +
      `<span class="sc-r flip">0</span><span class="sc-t home"><span class="bt-abbr">···</span></span></div><div class="bl3">${bl(3, 'B')}${bl(2, 'S')}${bl(2, 'O')}</div></div>` +
      `<div class="tn-now"><div class="tn-field"><span class="sk sk-fld"></span></div><div class="tn-zone"><span class="sk sk-zn"></span></div>` +
      `<div class="tn-seq"><span class="sk sk-seq"></span></div></div>` +
      `<div class="tn-duel">${card('Al bate', 'Nombre Apellido')}${card('Lanza', 'Nombre Apellido')}</div>` +
      `<div class="tn-com"><div class="tn-ctx"><span class="cx">${ghost('En cubierta Apellido')}</span></div>` +
      `<p class="lastplay"><span class="lp-t">${ghost('Antes: rolata al campocorto, out en primera.')}</span></p></div>${skLine()}</div></section>` +
      skTabs();
  };
})(window);
