/* Pizarra Criolla · calc.js
   Todos los cálculos de la app. Funciones puras: reciben datos ya descargados y devuelven números.
   Se cargan igual en el navegador (window.PC.calc) y en Node (module.exports) para poder probarlas. */
(function (root) {
  'use strict';
  const C = {};

  const num = v => { if (v == null || v === '') return 0; const n = +v; return Number.isFinite(n) ? n : 0; };
  const div = (a, b) => (b > 0 ? a / b : null);
  const arr = x => (Array.isArray(x) ? x : []); // listas de la API que pueden faltar o venir raras
  C.num = num;
  C.div = div;

  // Reglas de calificación de la LVBP (deducidas de la API: 2,7 PA y 0,8 IL por juego del equipo).
  C.QUAL_PA = 2.7;
  C.QUAL_IP = 0.8;

  // "45.2" = 45 innings y 2 outs
  C.ipToOuts = ip => {
    if (ip == null || ip === '') return 0;
    const [w, f] = String(ip).split('.');
    return (parseInt(w, 10) || 0) * 3 + (parseInt(f || '0', 10) || 0);
  };
  C.outsToIp = outs => `${Math.floor(outs / 3)}.${outs % 3}`;

  // ---------- líneas de bateo y pitcheo (a partir del objeto stat de la API) ----------
  C.batLine = s => ({
    G: num(s.gamesPlayed), PA: num(s.plateAppearances), AB: num(s.atBats), R: num(s.runs),
    H: num(s.hits), D: num(s.doubles), T: num(s.triples), HR: num(s.homeRuns), RBI: num(s.rbi),
    BB: num(s.baseOnBalls), IBB: num(s.intentionalWalks), SO: num(s.strikeOuts), HBP: num(s.hitByPitch),
    SF: num(s.sacFlies), SH: num(s.sacBunts), SB: num(s.stolenBases), CS: num(s.caughtStealing),
    GIDP: num(s.groundIntoDoublePlay), TB: num(s.totalBases), GO: num(s.groundOuts), AO: num(s.airOuts),
    NP: num(s.numberOfPitches), LOB: num(s.leftOnBase)
  });

  C.pitLine = s => ({
    G: num(s.gamesPitched != null ? s.gamesPitched : s.gamesPlayed), GS: num(s.gamesStarted),
    W: num(s.wins), L: num(s.losses), SV: num(s.saves), SVO: num(s.saveOpportunities),
    HLD: num(s.holds), BS: num(s.blownSaves),
    OUTS: s.outs != null ? num(s.outs) : C.ipToOuts(s.inningsPitched),
    H: num(s.hits), R: num(s.runs), ER: num(s.earnedRuns), HR: num(s.homeRuns), BB: num(s.baseOnBalls),
    IBB: num(s.intentionalWalks), SO: num(s.strikeOuts),
    HBP: num(s.hitBatsmen != null ? s.hitBatsmen : s.hitByPitch),
    WP: num(s.wildPitches), BK: num(s.balks), BF: num(s.battersFaced),
    NP: num(s.numberOfPitches != null ? s.numberOfPitches : s.pitchesThrown), STR: num(s.strikes),
    AB: num(s.atBats), SF: num(s.sacFlies), GO: num(s.groundOuts), AO: num(s.airOuts),
    IR: num(s.inheritedRunners), IRS: num(s.inheritedRunnersScored),
    CG: num(s.completeGames), SHO: num(s.shutouts), GF: num(s.gamesFinished)
  });

  C.sum = lines => {
    const t = {};
    for (const l of lines) for (const k in l) t[k] = (t[k] || 0) + (l[k] || 0);
    return t;
  };

  // ---------- contexto de liga ----------
  // Valor en carreras de cada evento por encima de un out (pesos lineales de referencia).
  // Se re-escalan para que el wOBA promedio de la liga sea igual a su OBP, como hace FanGraphs.
  const LW = { uBB: 0.555, HBP: 0.580, S: 0.710, D: 1.010, T: 1.280, HR: 1.651 };
  C.LW = LW;

  C.league = (batLines, pitLines) => {
    const b = C.sum(batLines);
    const p = C.sum(pitLines);
    const S = b.H - b.D - b.T - b.HR;
    const den = b.AB + b.BB - b.IBB + b.SF + b.HBP;
    const raw = den > 0 ? (LW.uBB * (b.BB - b.IBB) + LW.HBP * b.HBP + LW.S * S + LW.D * b.D + LW.T * b.T + LW.HR * b.HR) / den : 0;
    const OBP = div(b.H + b.BB + b.HBP, b.AB + b.BB + b.HBP + b.SF) || 0;
    const scale = raw > 0 ? OBP / raw : 1.2;
    const w = {};
    for (const k in LW) w[k] = LW[k] * scale;
    const IP = (p.OUTS || 0) / 3;
    const ERA = IP > 0 ? 9 * p.ER / IP : 0;
    const cFIP = IP > 0 ? ERA - (13 * p.HR + 3 * (p.BB + p.HBP) - 2 * p.SO) / IP : 3.1;
    return {
      bat: b, pit: p, w, wOBAScale: scale, wOBA: OBP,
      AVG: div(b.H, b.AB) || 0, OBP, SLG: div(b.TB, b.AB) || 0,
      RPA: div(b.R, b.PA) || 0, RG: null,
      KPct: div(b.SO, b.PA) || 0, BBPct: div(b.BB, b.PA) || 0,
      BABIP: div(b.H - b.HR, b.AB - b.SO - b.HR + b.SF) || 0,
      IP, ERA, cFIP, FIP: ERA,
      WHIP: IP > 0 ? (p.BB + p.H) / IP : 0,
      pKPct: div(p.SO, p.BF) || 0, pBBPct: div(p.BB, p.BF) || 0
    };
  };

  // ---------- métricas de un bateador (o de un equipo) ----------
  C.bat = (b, lg) => {
    const S = b.H - b.D - b.T - b.HR;
    const TB = b.TB || (S + 2 * b.D + 3 * b.T + 4 * b.HR);
    const AVG = div(b.H, b.AB);
    const OBP = div(b.H + b.BB + b.HBP, b.AB + b.BB + b.HBP + b.SF);
    const SLG = div(TB, b.AB);
    const r = {
      AVG, OBP, SLG,
      OPS: OBP != null && SLG != null ? OBP + SLG : null,
      ISO: SLG != null && AVG != null ? SLG - AVG : null,
      BABIP: div(b.H - b.HR, b.AB - b.SO - b.HR + b.SF),
      KPct: div(b.SO, b.PA), BBPct: div(b.BB, b.PA), BBK: div(b.BB, b.SO),
      SBPct: div(b.SB, b.SB + b.CS), XBH: b.D + b.T + b.HR, TB, S,
      ABHR: div(b.AB, b.HR), PPA: div(b.NP, b.PA), GOAO: div(b.GO, b.AO)
    };
    if (lg && lg.OBP > 0) {
      const w = lg.w;
      r.wOBA = div(w.uBB * (b.BB - b.IBB) + w.HBP * b.HBP + w.S * S + w.D * b.D + w.T * b.T + w.HR * b.HR,
        b.AB + b.BB - b.IBB + b.SF + b.HBP);
      if (r.wOBA != null && b.PA > 0) {
        r.wRAA = ((r.wOBA - lg.wOBA) / lg.wOBAScale) * b.PA;
        r.wRCplus = lg.RPA > 0 ? ((r.wRAA / b.PA + lg.RPA) / lg.RPA) * 100 : null;
      }
      if (OBP != null && SLG != null && lg.SLG > 0) r.OPSplus = 100 * (OBP / lg.OBP + SLG / lg.SLG - 1);
    }
    return r;
  };

  // ---------- métricas de un lanzador (o del pitcheo de un equipo) ----------
  C.pit = (p, lg) => {
    const IP = p.OUTS / 3;
    const lobDen = p.H + p.BB + p.HBP - 1.4 * p.HR;
    const r = {
      IP,
      ERA: div(9 * p.ER, IP), RA9: div(9 * p.R, IP), WHIP: div(p.BB + p.H, IP),
      K9: div(9 * p.SO, IP), BB9: div(9 * p.BB, IP), HR9: div(9 * p.HR, IP), H9: div(9 * p.H, IP),
      KBB: div(p.SO, p.BB), KPct: div(p.SO, p.BF), BBPct: div(p.BB, p.BF),
      BABIP: div(p.H - p.HR, p.AB - p.SO - p.HR + p.SF),
      LOBPct: lobDen > 0 ? (p.H + p.BB + p.HBP - p.R) / lobDen : null,
      PIP: div(p.NP, IP), AVGa: div(p.H, p.AB), GOAO: div(p.GO, p.AO), WPct: div(p.W, p.W + p.L)
    };
    r.KBBPct = r.KPct != null && r.BBPct != null ? r.KPct - r.BBPct : null;
    if (lg && IP > 0) {
      r.FIP = (13 * p.HR + 3 * (p.BB + p.HBP) - 2 * p.SO) / IP + lg.cFIP;
      if (lg.ERA > 0) {
        r.ERAminus = r.ERA != null ? 100 * r.ERA / lg.ERA : null;
        r.FIPminus = 100 * r.FIP / lg.ERA;
        r.ERAplus = r.ERA > 0 ? 100 * lg.ERA / r.ERA : null;
      }
    }
    return r;
  };

  // ---------- calendario y resultados ----------
  // Estado simplificado de un juego: pre (por jugarse), live, final, post (pospuesto o cancelado), susp (suspendido).
  // Se decide por codedGameState: el calentamiento llega como "Live" con código P y no es juego en vivo.
  C.gameStatus = st => {
    st = st || {};
    const a = st.abstractGameState, d = st.detailedState || '', c = st.codedGameState || '';
    if (c === 'D' || c === 'C' || /postpon|cancel/i.test(d)) return 'post';
    if (c === 'T' || c === 'U' || /suspend/i.test(d)) return 'susp';
    if (c === 'P' || c === 'S' || (a !== 'Final' && /warmup|pre-game|scheduled|delayed start/i.test(d))) return 'pre';
    if (a === 'Live') return 'live';
    if (a === 'Final') return 'final';
    return 'pre';
  };

  const REASONS = {
    Rain: 'lluvia', 'Wet Grounds': 'terreno mojado', Venue: 'problemas en el estadio', Weather: 'mal tiempo',
    Power: 'falla eléctrica', Lights: 'falla de luces', Fog: 'neblina', Inclement: 'mal tiempo', Other: ''
  };
  C.reasonEs = r => (r == null ? '' : REASONS[r] != null ? REASONS[r] : String(r).toLowerCase());

  // Texto en español para los estados especiales; null cuando basta con el normal (hora, inning o "Final").
  C.statusText = st => {
    st = st || {};
    const d = st.detailedState || '';
    const why = C.reasonEs(st.reason || (d.indexOf(':') > 0 ? d.split(':')[1].trim() : ''));
    const por = why ? ` por ${why}` : '';
    if (/warmup/i.test(d)) return 'Calentamiento';
    if (/delayed start/i.test(d)) return 'Inicio demorado' + por;
    if (/delayed/i.test(d)) return 'Juego detenido' + por;
    if (/challenge|review/i.test(d)) return 'Revisión de video';
    if (/completed early/i.test(d)) return 'Final, acortado' + por;
    if (/tied/i.test(d)) return 'Final, empate';
    if (/suspend/i.test(d)) return 'Suspendido' + por;
    if (/postpon/i.test(d)) return 'Pospuesto' + por;
    if (/cancel/i.test(d)) return 'Cancelado' + por;
    return null;
  };

  C.normGame = g => {
    const ls = g.linescore || {};
    const side = s => {
      const t = (g.teams && g.teams[s]) || {};
      const lt = (ls.teams && ls.teams[s]) || {};
      return {
        id: t.team ? t.team.id : null,
        name: t.team ? t.team.name : '',
        score: t.score == null ? null : num(t.score),
        win: !!t.isWinner,
        rec: t.leagueRecord ? { W: num(t.leagueRecord.wins), L: num(t.leagueRecord.losses) } : null,
        prob: t.probablePitcher ? { id: t.probablePitcher.id, name: t.probablePitcher.fullName } : null,
        hits: lt.hits != null ? num(lt.hits) : null,
        errors: lt.errors != null ? num(lt.errors) : null
      };
    };
    const off = ls.offense || {}, def = ls.defense || {};
    const dec = g.decisions || null;
    const st = g.status || {};
    return {
      pk: g.gamePk, type: g.gameType, date: g.officialDate, ts: Date.parse(g.gameDate),
      status: C.gameStatus(st), detailed: st.detailedState || '', code: st.statusCode || '',
      reason: st.reason || '', label: C.statusText(st),
      tbd: !!(st.startTimeTBD || g.startTimeTBD),
      resumeDate: g.resumeDate || null, resumedFrom: g.resumedFrom || null,
      rescheduledFrom: g.rescheduledFrom || null, rescheduleDate: g.rescheduleDate || null,
      tiebreaker: g.tiebreaker === 'Y', desc: g.description || '',
      series: g.seriesDescription || '', seriesGame: g.seriesGameNumber || null,
      away: side('away'), home: side('home'),
      inning: ls.currentInning || null, sched: ls.scheduledInnings || g.scheduledInnings || 9,
      half: ls.inningHalf || null, inningState: ls.inningState || null,
      outs: ls.outs != null ? num(ls.outs) : null, balls: ls.balls != null ? num(ls.balls) : null,
      strikes: ls.strikes != null ? num(ls.strikes) : null,
      bases: [!!off.first, !!off.second, !!off.third],
      batter: off.batter ? { id: off.batter.id, name: off.batter.fullName } : null,
      pitcher: def.pitcher ? { id: def.pitcher.id, name: def.pitcher.fullName } : null,
      venue: g.venue ? g.venue.name : null,
      dec: dec ? {
        W: dec.winner ? { id: dec.winner.id, name: dec.winner.fullName } : null,
        L: dec.loser ? { id: dec.loser.id, name: dec.loser.fullName } : null,
        S: dec.save ? { id: dec.save.id, name: dec.save.fullName } : null
      } : null,
      dh: g.doubleHeader && g.doubleHeader !== 'N' ? g.gameNumber : null
    };
  };

  // Un mismo juego (gamePk) puede venir varias veces: pospuesto en su fecha original y jugado en otra, o suspendido
  // un día y terminado al siguiente (las dos apariciones como "Final", con ganador). Se deja una sola, la más avanzada;
  // entre dos finales, la última (la que terminó el juego). keepAll devuelve todas, para saber qué días hubo juego.
  const RANK = { final: 5, live: 4, susp: 3, pre: 2, post: 1 };
  C.flatSchedule = (data, keepAll) => {
    const all = [];
    for (const d of (data && data.dates) || []) for (const g of d.games || []) all.push(C.normGame(g));
    const byTime = (a, b) => a.ts - b.ts || a.pk - b.pk;
    if (keepAll) return all.sort(byTime);
    const best = new Map();
    for (const g of all) {
      const b = best.get(g.pk);
      if (!b || RANK[g.status] > RANK[b.status] || (RANK[g.status] === RANK[b.status] && g.ts > b.ts)) best.set(g.pk, g);
    }
    return [...best.values()].sort(byTime);
  };

  // Juegos que faltan por jugarse (un juego pospuesto reaparece con el mismo número en su nueva fecha).
  C.pending = games => {
    const seen = new Set();
    return games.filter(g => {
      if (!(g.status === 'pre' || g.status === 'live' || g.status === 'susp')) return false;
      if (seen.has(g.pk)) return false;
      seen.add(g.pk);
      return true;
    });
  };

  // ---------- tabla de posiciones, calculada juego por juego ----------
  C.standings = (games, teamIds) => {
    const T = new Map();
    for (const id of teamIds) {
      T.set(id, { id, W: 0, L: 0, RS: 0, RA: 0, hW: 0, hL: 0, aW: 0, aL: 0, oneW: 0, oneL: 0, exW: 0, exL: 0, vs: {}, log: [] });
    }
    const finals = games.filter(g => g.status === 'final' && (g.away.win || g.home.win)).sort((a, b) => a.ts - b.ts);
    for (const g of finals) {
      const A = T.get(g.away.id), H = T.get(g.home.id);
      if (!A || !H) continue;
      const one = Math.abs(g.away.score - g.home.score) === 1;
      const extra = (g.inning || 9) > (g.sched || 9);
      for (const [t, me, opp, isHome] of [[A, g.away, g.home, false], [H, g.home, g.away, true]]) {
        const win = me.win;
        t[win ? 'W' : 'L']++;
        t[(isHome ? 'h' : 'a') + (win ? 'W' : 'L')]++;
        if (one) t[win ? 'oneW' : 'oneL']++;
        if (extra) t[win ? 'exW' : 'exL']++;
        t.RS += me.score;
        t.RA += opp.score;
        const v = t.vs[opp.id] || (t.vs[opp.id] = { W: 0, L: 0, RS: 0, RA: 0 });
        v[win ? 'W' : 'L']++;
        v.RS += me.score;
        v.RA += opp.score;
        t.log.push({ pk: g.pk, date: g.date, opp: opp.id, home: isHome, rs: me.score, ra: opp.score, win });
      }
    }
    const rows = [...T.values()].map(t => {
      const G = t.W + t.L;
      const rpg = G ? (t.RS + t.RA) / G : 0;
      const x = rpg > 0 ? Math.pow(rpg, 0.287) : 1.83; // exponente Pythagenpat
      const pyth = t.RS + t.RA > 0 ? Math.pow(t.RS, x) / (Math.pow(t.RS, x) + Math.pow(t.RA, x)) : 0.5;
      const n = t.log.length;
      let streak = '';
      if (n) {
        const last = t.log[n - 1].win;
        let k = 0;
        while (k < n && t.log[n - 1 - k].win === last) k++;
        streak = (last ? 'G' : 'P') + k;
      }
      const l10 = t.log.slice(-10);
      const l10W = l10.filter(x2 => x2.win).length;
      return Object.assign(t, {
        G, PCT: G ? t.W / G : 0, DIFF: t.RS - t.RA, RSG: div(t.RS, G), RAG: div(t.RA, G),
        pyth, xW: pyth * G, luck: t.W - pyth * G, streak, l10W, l10L: l10.length - l10W
      });
    });
    // Desempate (criterio por confirmar con la LVBP): récord entre los equipos empatados, luego diferencia de
    // carreras, luego carreras anotadas. Se resuelve por grupo para que un triple empate quede bien ordenado.
    rows.sort((a, b) => b.PCT - a.PCT);
    const ordered = [];
    for (let i = 0; i < rows.length;) {
      let j = i + 1;
      while (j < rows.length && Math.abs(rows[j].PCT - rows[i].PCT) < 1e-9) j++;
      const grp = rows.slice(i, j);
      if (grp.length > 1) {
        const ids = grp.map(r => r.id);
        grp.forEach(r => {
          let w = 0, l = 0;
          ids.forEach(o => { if (o !== r.id && r.vs[o]) { w += r.vs[o].W; l += r.vs[o].L; } });
          r.tbPct = w + l ? w / (w + l) : 0.5;
        });
        grp.sort((a, b) => (b.tbPct - a.tbPct) || (b.DIFF - a.DIFF) || (b.RS - a.RS) || (a.id - b.id));
      }
      ordered.push(...grp);
      i = j;
    }
    const lead = ordered[0];
    ordered.forEach((r, i) => {
      r.pos = i + 1;
      r.GB = lead ? ((lead.W - r.W) + (r.L - lead.L)) / 2 : 0;
    });
    return ordered;
  };

  // ---------- probabilidad de clasificar (Monte Carlo del calendario restante) ----------
  // Fuerza de cada equipo = % pitagórico regresado hacia .500 (pesa menos al principio de la temporada).
  // Formato LVBP: 4 primeros directo al Round Robin; comodín 5.º vs 6.º (al 5.º le basta 1 triunfo, el 6.º necesita 2).
  // Calibración con 2016-2025: el home club gana .544 (ventaja ≈ .045) y el talento real entre equipos es muy parejo
  // (desviación ≈ .032), así que en cada simulación la fuerza de cada equipo varía un poco según lo poco que se sabe de él.
  // o.base: {id: {pyth, G}} de la temporada regular, para fases cortas como el Round Robin.
  C.simulate = (rows, pending, o) => {
    o = o || {};
    const n = o.n || 5000, hfa = o.hfa == null ? 0.045 : o.hfa, K = o.regress || 60, SD = o.sd == null ? 0.032 : o.sd;
    const ids = rows.map(r => r.id);
    const str = {}, sig = {};
    rows.forEach(r => {
      const b = (o.base && o.base[r.id]) || { pyth: 0.5, G: 0 };
      const G = r.G + b.G;
      str[r.id] = (r.pyth * r.G + b.pyth * b.G + 0.5 * K) / (G + K);
      sig[r.id] = SD * Math.sqrt(K / (G + K));
    });
    const log5 = (a, b) => (a - a * b) / (a + b - 2 * a * b);
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const gs = pending.filter(g => str[g.home.id] != null && str[g.away.id] != null).map(g => [g.home.id, g.away.id]);
    let seed = o.seed || 20261012;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const acc = {}, W0 = {}, G0 = {};
    rows.forEach(r => { acc[r.id] = { first: 0, top2: 0, top4: 0, top6: 0, rr: 0, W: 0 }; W0[r.id] = r.W; G0[r.id] = r.G; });
    for (let s = 0; s < n; s++) {
      const W = Object.assign({}, W0), G = Object.assign({}, G0), S = {};
      ids.forEach(id => { S[id] = clamp(str[id] + sig[id] * gauss(), 0.25, 0.75); });
      for (const [h, a] of gs) {
        if (rnd() < clamp(log5(S[h], S[a]) + hfa, 0.1, 0.9)) W[h]++; else W[a]++;
        G[h]++; G[a]++;
      }
      const ord = ids.map(id => ({ id, k: (G[id] ? W[id] / G[id] : 0) + rnd() * 1e-6 })).sort((x, y) => y.k - x.k);
      ord.forEach((x, i) => {
        const c = acc[x.id];
        c.W += W[x.id];
        if (i === 0) c.first++;
        if (i < 2) c.top2++;
        if (i < 4) { c.top4++; c.rr++; }
        if (i < 6) c.top6++;
      });
      if (ord.length >= 6) {
        // comodín en casa del 5.º: al 5.º le basta un triunfo, el 6.º necesita los dos
        const fifth = ord[4].id, sixth = ord[5].id, q = clamp(log5(S[sixth], S[fifth]) - hfa, 0.1, 0.9);
        if (rnd() < q && rnd() < q) acc[sixth].rr++; else acc[fifth].rr++;
      }
    }
    const out = {};
    ids.forEach(id => {
      const c = acc[id];
      out[id] = { first: c.first / n, top2: c.top2 / n, top4: c.top4 / n, top6: c.top6 / n, rr: c.rr / n, W: c.W / n, str: str[id] };
    });
    return out;
  };

  // ---------- probabilidad de ganar y aporte de cada jugador (WPA) ----------
  // wp: respuesta de /winProbability, un elemento por turno al bate. Valores en puntos de % (0-100).
  C.wpa = wp => {
    const plays = [], by = {};
    let prev = null;
    (wp || []).forEach((p, i) => {
      const after = num(p.homeTeamWinProbability);
      const apiAdded = p.homeTeamWinProbabilityAdded != null ? num(p.homeTeamWinProbabilityAdded) : null;
      // delta: cambio real entre una jugada y la anterior (curva y jugadas clave).
      // added: lo que la API le atribuye al turno; excluye robos o lanzamientos salvajes dentro del turno (WPA del jugador).
      const before = prev == null ? (apiAdded != null ? after - apiAdded : 50) : prev;
      const delta = after - before;
      const added = apiAdded != null ? apiAdded : delta;
      const ab = p.about || {};
      const top = ab.isTopInning != null ? !!ab.isTopInning : ab.halfInning === 'top';
      const swing = top ? -added : added; // a favor del equipo que batea
      const m = p.matchup || {}, res = p.result || {};
      const play = {
        i, idx: ab.atBatIndex != null ? ab.atBatIndex : i, inning: ab.inning, top,
        before, after, delta, added, swing, dswing: top ? -delta : delta,
        li: p.leverageIndex != null ? num(p.leverageIndex) : null,
        desc: res.description || '', event: res.event || '',
        away: res.awayScore, home: res.homeScore,
        batter: m.batter || null, pitcher: m.pitcher || null
      };
      plays.push(play);
      const add = (person, v, role, side) => {
        if (!person || person.id == null) return;
        const key = role + person.id;
        const r = by[key] || (by[key] = { id: person.id, name: person.fullName, role, side, wpa: 0, n: 0 });
        r.wpa += v;
        r.n++;
      };
      add(m.batter, swing, 'bat', top ? 'away' : 'home');
      add(m.pitcher, -swing, 'pit', top ? 'home' : 'away');
      prev = after;
    });
    return { plays, players: Object.values(by) };
  };

  // ---------- estado de un juego terminado después de la jugada k (para repetirlo) ----------
  const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run']);
  // Un jugador como lo usa la pantalla: {id, fullName} o null.
  const who = x => (x && x.id != null ? { id: x.id, fullName: x.fullName || '' } : null);
  // Número de la API o null (coordenadas que pueden faltar).
  const fin = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
  const sameHalf = (a, b) => !!(a && b && a.about && b.about && a.about.inning === b.about.inning && !!a.about.isTopInning === !!b.about.isTopInning);
  const inningOf = (innings, inn) => {
    while (innings.length < inn) innings.push({ away: { r: 0, h: 0, e: 0 }, home: { r: 0, h: 0, e: 0 }, played: { away: false, home: false } });
    return innings[inn - 1];
  };
  // Índice (en playEvents) del evento en que se movió un corredor; sin dato, al final de la jugada.
  const runIdx = rn => { const v = rn && rn.details ? rn.details.playIndex : null; return v != null && Number.isFinite(+v) ? +v : Infinity; };
  const evIdx = (e, i) => (e.index != null && Number.isFinite(+e.index) ? +e.index : i);
  // ¿el evento ix entra en el tramo que termina antes de lim? (sin lim o con Infinity: toda la jugada)
  const inside = (ix, lim) => lim == null || lim === Infinity || ix < lim;
  // Errores de la jugada q: un error por jugador acreditado en los corredores (como el box score; la interferencia del
  // receptor también es error), más los errores que solo vienen como acción, sin corredor que se mueva (un elevado de
  // foul que se cae). lim: solo antes de ese evento. El de la jugada completa se guarda por jugada (las jugadas del feed
  // no cambian: cada descarga trae objetos nuevos), así la pizarra acumulada no recorre los eventos cada vez.
  const isErr = c => !!c && (/error/i.test(c.credit || '') || c.credit === 'c_catcher_interf');
  const errMemo = new WeakMap();
  const errorsOf = (q, lim) => {
    const whole = lim == null || lim === Infinity, memo = whole && q && typeof q === 'object';
    if (memo && errMemo.has(q)) return errMemo.get(q);
    const n = countErrors(q, lim);
    if (memo) errMemo.set(q, n);
    return n;
  };
  function countErrors(q, lim) {
    const errs = new Set(), at = new Set();
    for (const rn of arr(q && q.runners)) {
      if (!rn || !inside(runIdx(rn), lim)) continue;
      at.add(runIdx(rn));
      for (const c of arr(rn.credits)) if (isErr(c) && c.player) errs.add(c.player.id);
    }
    let solo = 0;
    arr(q && q.playEvents).forEach((e, i) => {
      const ix = e ? evIdx(e, i) : i;
      if (e && e.details && e.details.eventType === 'error' && inside(ix, lim) && !at.has(ix)) solo++;
    });
    return errs.size + solo;
  }

  // Carreras, hits y errores por inning y totales de las jugadas 0..k (un solo recorrido, sin copiar el arreglo).
  function board(plays, k) {
    const innings = [];
    const tot = { away: { r: 0, h: 0, e: 0 }, home: { r: 0, h: 0, e: 0 } };
    let lastA = 0, lastH = 0;
    const n = Math.min(k, plays.length - 1);
    for (let i = 0; i <= n; i++) {
      const q = plays[i];
      if (!q) continue;
      const ab = q.about || {}, res = q.result || {};
      const inn = ab.inning || 1, top = !!ab.isTopInning;
      const I = inningOf(innings, inn);
      const bat = top ? 'away' : 'home', fld = top ? 'home' : 'away';
      I.played[bat] = true;
      const a = res.awayScore != null ? num(res.awayScore) : lastA, h = res.homeScore != null ? num(res.homeScore) : lastH;
      const runs = top ? a - lastA : h - lastH;
      I[bat].r += runs; tot[bat].r += runs;
      lastA = a; lastH = h;
      if (HIT_EVENTS.has(res.eventType)) { I[bat].h++; tot[bat].h++; }
      const e = errorsOf(q);
      I[fld].e += e; tot[fld].e += e;
    }
    return { innings, tot, away: lastA, home: lastH };
  }

  // bases: [1.ª, 2.ª, 3.ª] con {id, fullName} del corredor o null (!!bases[i] sigue diciendo si hay corredor).
  C.stateAt = (allPlays, k) => {
    const plays = arr(allPlays);
    const b = board(plays, k);
    const p = plays[Math.min(k, plays.length - 1)] || {};
    const m = p.matchup || {}, ab = p.about || {}, cnt = p.count || {};
    return {
      inning: ab.inning || 1, top: !!ab.isTopInning, outs: num(cnt.outs),
      away: b.away, home: b.home, innings: b.innings, tot: b.tot,
      bases: [who(m.postOnFirst), who(m.postOnSecond), who(m.postOnThird)],
      batter: m.batter || null, pitcher: m.pitcher || null,
      desc: (p.result && p.result.description) || ''
    };
  };

  // ---------- lanzamiento a lanzamiento ----------
  // Código de cada lanzamiento (/api/v1/pitchCodes) → [tipo para la zona, texto corto].
  const PITCH = {
    B: ['bola', 'Bola'], '*B': ['bola', 'Bola'], P: ['bola', 'Bola'], I: ['bola', 'Bola intencional'],
    C: ['cantado', 'Strike cantado'], K: ['cantado', 'Strike'],
    S: ['tirandole', 'Strike tirándole'], W: ['tirandole', 'Strike tirándole'], Q: ['tirandole', 'Strike tirándole'],
    M: ['tirandole', 'Toque fallido'], T: ['tirandole', 'Foul tip'], O: ['tirandole', 'Foul tip de toque'],
    F: ['foul', 'Foul'], R: ['foul', 'Foul'], L: ['foul', 'Foul de toque'],
    X: ['enjuego', 'En juego'], D: ['enjuego', 'En juego'], E: ['enjuego', 'En juego'],
    Y: ['enjuego', 'En juego'], J: ['enjuego', 'En juego'], Z: ['enjuego', 'En juego'],
    H: ['golpeado', 'Golpeado'],
    // Sin lanzamiento (isPitch false), pero cambian la cuenta: bola o strike automáticos (reloj, boleto intencional).
    // VS es la infracción del shift, no el reloj.
    V: ['bola', 'Bola automática (reloj)'], VP: ['bola', 'Bola automática (reloj)'], VC: ['bola', 'Bola automática (reloj)'],
    VS: ['bola', 'Bola automática'], VB: ['bola', 'Bola intencional'],
    A: ['cantado', 'Strike automático'], AB: ['cantado', 'Strike automático'], AC: ['cantado', 'Strike automático']
  };
  const AUTO = new Set(['V', 'VP', 'VC', 'VS', 'VB', 'A', 'AB', 'AC']);

  // Emergente al bate (no corredor emergente): posición PH; sin posición, lo dice la descripción.
  const isPH = (e, d) => d.eventType === 'offensive_substitution' && !!e.player && e.player.id != null &&
    (e.position ? e.position.code === '11' || e.position.abbreviation === 'PH' : /bateador emergente|pinch[- ]?hitter/i.test(d.description || ''));
  // Nombres que trae la descripción de un cambio: el que entra ("corredor emergente X reemplaza a…", "Cambio de
  // Lanzador: X reemplaza a…", "X empieza el inning en la 2da base") y el que sale.
  const ENTRA = [/(?:emergente|pinch[- ]?(?:hitter|runner))\s+(.+?)\s+(?:reemplaza a|replaces)\s/i, /:\s*(.+?)\s+(?:reemplaza a|replaces)\s/i,
    /^(.+?)\s+(?:empieza el inning|starts the inning)/i];
  const entra = e => {
    const s = C.cleanEs(e && e.details && e.details.description);
    for (const re of ENTRA) { const m = re.exec(s); if (m) return m[1].trim(); }
    return '';
  };
  const sale = e => { const m = /(?:reemplaza a|replaces)\s+(.+?)\.?\s*$/i.exec(C.cleanEs(e && e.details && e.details.description)); return m ? m[1].trim() : ''; };

  // Los lanzamientos de un turno, con la cuenta después de cada uno. Sirve con la jugada completa del feed y con el
  // turno en curso recortado de la vigilancia (api.js). Las bolas y strikes automáticos entran sin ubicación (auto).
  // index: el del evento en playEvents (lo usa stateAtPitch).
  // pitcherId / batterId: el lanzador y el bateador de ese lanzamiento si cambiaron dentro del turno (relevo o emergente
  // anotados antes del lanzamiento); null = el que empezó el turno (C.stateAtPitch(done, k, -1) o la jugada anterior).
  C.pitchSeq = play => {
    const out = [];
    const evs = arr(play && play.playEvents);
    let b = 0, s = 0, pit = null, bat = null;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (!e) continue;
      const d = e.details || {};
      if (!e.isPitch) {
        if (d.eventType === 'pitching_substitution' && e.player && e.player.id != null) pit = e.player.id;
        else if (isPH(e, d)) bat = e.player.id;
      }
      const code = d.code || (d.call && d.call.code) || '';
      const auto = !e.isPitch && AUTO.has(code);
      if (!e.isPitch && !auto) continue;
      const t = PITCH[code] || ['otro', C.cleanEs(d.description) || 'Lanzamiento'];
      const cnt = e.count;
      if (cnt && cnt.balls != null && cnt.strikes != null) { b = num(cnt.balls); s = num(cnt.strikes); }
      else if (t[0] === 'bola' || t[0] === 'golpeado') b++; // sin cuenta de la API: se lleva a mano
      else if (t[0] === 'cantado' || t[0] === 'tirandole' || code === 'L' || (t[0] === 'foul' && s < 2)) s++;
      const pd = e.pitchData || {}, c = pd.coordinates || {};
      out.push({
        p: out.length, code, call: t[0], label: t[1], balls: b, strikes: s,
        x: fin(c.x), y: fin(c.y), szTop: fin(pd.strikeZoneTop), szBot: fin(pd.strikeZoneBottom),
        last: false, auto, index: evIdx(e, i), pitcherId: pit, batterId: bat
      });
    }
    if (out.length) out[out.length - 1].last = true;
    return out;
  };

  // Acciones que se cuentan en el jugada a jugada (la última del tramo sirve de "última jugada" a mitad de turno).
  const ACTS = new Set(['pitching_substitution', 'offensive_substitution', 'defensive_substitution', 'defensive_switch', 'runner_placed',
    'stolen_base_2b', 'stolen_base_3b', 'stolen_base_home', 'caught_stealing_2b', 'caught_stealing_3b', 'caught_stealing_home',
    'pickoff_1b', 'pickoff_2b', 'pickoff_3b', 'pickoff_caught_stealing_2b', 'pickoff_caught_stealing_3b', 'pickoff_caught_stealing_home',
    'wild_pitch', 'passed_ball', 'balk', 'defensive_indiff', 'other_advance', 'error']);
  const BASE = { '1B': 0, '2B': 1, '3B': 2 };

  // Nombre de un jugador del que solo viene el id (corredor colocado en 2.ª en extrainnings, emergente, relevista):
  // se busca en los turnos, primero hacia atrás desde k y luego hacia adelante.
  function nameIn(plays, k, id) {
    const look = q => {
      if (!q) return '';
      for (const rn of arr(q.runners)) { const r = rn && rn.details && rn.details.runner; if (r && r.id === id && r.fullName) return r.fullName; }
      const m = q.matchup || {};
      for (const x of [m.batter, m.pitcher, m.postOnFirst, m.postOnSecond, m.postOnThird]) if (x && x.id === id && x.fullName) return x.fullName;
      return '';
    };
    for (let i = Math.min(k, plays.length - 1); i >= 0; i--) { const n = look(plays[i]); if (n) return n; }
    for (let i = k + 1; i < plays.length; i++) { const n = look(plays[i]); if (n) return n; }
    return '';
  }

  // Movimientos en orden: por evento y, dentro del mismo evento, el corredor que iba más adelante primero (la API a veces
  // anota primero al bateador, que "pasaría" por una base todavía ocupada); cada corredor conserva el orden de los suyos.
  function order(list) {
    const lead = new Map();
    const key = rn => runIdx(rn) + '|' + (rn.details && rn.details.runner ? rn.details.runner.id : '');
    for (const rn of list) {
      const kk = key(rn);
      if (!lead.has(kk)) { const s = BASE[(rn.movement || {}).start]; lead.set(kk, s == null ? -1 : s); }
    }
    return list.map((rn, i) => ({ rn, i, ix: runIdx(rn), lead: lead.get(key(rn)) }))
      .sort((a, b) => a.ix - b.ix || b.lead - a.lead || a.i - b.i).map(x => x.rn);
  }

  // Corredores de la jugada q antes del evento lim (índice de playEvents): mueve bases (se cambia ahí mismo) y
  // devuelve outs, carreras y errores de ese tramo, y la descripción de la última acción (robo, wild pitch...).
  // Eventos y movimientos van en el orden en que pasaron. lim = Infinity: la jugada completa.
  // nameOf(id, evento): el nombre de quien entra (corredor colocado o emergente).
  function advance(q, bases, lim, nameOf) {
    let outs = 0, runs = 0, act = null;
    const evs = arr(q.playEvents);
    const mv = order(arr(q.runners).filter(rn => rn && inside(runIdx(rn), lim)));
    let j = 0;
    // ¿el corredor id se vuelve a mover en lo que falta del tramo?
    const later = id => { for (let t = j; t < mv.length; t++) { const r = mv[t].details && mv[t].details.runner; if (r && r.id === id) return true; } return false; };
    // Si la base está ocupada por alguien que ya no se mueve, ese corredor fue forzado sin movimiento propio (pasa en
    // el tercer out por fuerza): avanza una base. Si sí se mueve después, su propio movimiento lo vuelve a poner.
    const put = (b, r) => {
      const x = bases[b];
      if (x && x.id !== r.id && !later(x.id) && b < 2) put(b + 1, x);
      bases[b] = r;
    };
    const move = upTo => {
      while (j < mv.length && runIdx(mv[j]) <= upTo) {
        const rn = mv[j++], m = rn.movement || {}, r = who(rn.details && rn.details.runner);
        if (r) for (let b = 0; b < 3; b++) if (bases[b] && bases[b].id === r.id) bases[b] = null;
        if (m.isOut) outs++;
        else if (BASE[m.end] != null) { if (r) put(BASE[m.end], r); }
        else if (m.end === 'score') runs++;
      }
    };
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (!e) continue;
      const ix = evIdx(e, i), d = e.details || {};
      if (!inside(ix, lim)) continue;
      move(ix - 1);
      // extrainnings: el corredor colocado en 2.ª no trae movimiento, solo esta acción
      if (d.eventType === 'runner_placed' && e.player && e.player.id != null && e.base >= 1 && e.base <= 3) {
        bases[e.base - 1] = { id: e.player.id, fullName: nameOf(e.player.id, e) };
      }
      // corredor emergente: toma la base del que sale
      if (d.eventType === 'offensive_substitution' && e.player && e.player.id != null && e.replacedPlayer) {
        for (let b = 0; b < 3; b++) if (bases[b] && bases[b].id === e.replacedPlayer.id) bases[b] = { id: e.player.id, fullName: nameOf(e.player.id, e) };
      }
      if (ACTS.has(d.eventType) && d.description) act = d.description;
    }
    move(Infinity);
    return { outs, runs, errs: errorsOf(q, lim), act };
  }

  // Lanzador con que empezó el turno k: el de la última jugada en que fildeaba el mismo equipo. En el primer turno del
  // juego para ese equipo, el del turno si no hubo cambio en él (si lo hubo a mitad de turno, no se sabe: null).
  function startPitcher(plays, k) {
    const q = plays[k] || {}, top = !!(q.about && q.about.isTopInning);
    for (let i = k - 1; i >= 0; i--) {
      const z = plays[i];
      if (z && z.about && !!z.about.isTopInning === top && z.matchup && z.matchup.pitcher) return who(z.matchup.pitcher);
    }
    return arr(q.playEvents).some(e => e && e.details && e.details.eventType === 'pitching_substitution') ? null : who((q.matchup || {}).pitcher);
  }
  // Bateador con que empezó el turno k: si entró un emergente, el que él reemplazó; si no, el del turno.
  function startBatter(plays, k) {
    const q = plays[k] || {}, ph = arr(q.playEvents).find(e => e && isPH(e, e.details || {}));
    if (!ph || !ph.replacedPlayer || ph.replacedPlayer.id == null) return who((q.matchup || {}).batter);
    const id = ph.replacedPlayer.id;
    return { id, fullName: nameIn(plays, k, id) || sale(ph) };
  }
  // {id, fullName} de quien entra con el evento e de la jugada k (relevista o emergente).
  const entrant = (plays, k, e, mine) => {
    const id = e.player.id;
    return { id, fullName: (mine && mine.id === id && mine.fullName) || nameIn(plays, k, id) || entra(e) };
  };

  // Estado después del lanzamiento p del turno k (p = -1: antes del primero). Igual que stateAt más la cuenta, y a mitad
  // de turno con los robos, wild pitch, pasbol, balk o pickoff de ese tramo. La API anota esas acciones DESPUÉS del
  // lanzamiento en que pasan, así que el tramo del lanzamiento p llega hasta antes del lanzamiento p+1. El último
  // lanzamiento (o una jugada sin lanzamientos) da la jugada completa: exactamente C.stateAt(done, k). Si la última
  // jugada es el turno en curso del feed en vivo (about.isComplete false), su último p sigue a los corredores hasta ahora.
  // pitcher y batter: los que están en ese momento, con el mismo tramo: un relevo o un emergente anotado entre el
  // lanzamiento p y el p+1 ya sale en p (como en la vigilancia en vivo). Quién hizo cada lanzamiento: pitchSeq().pitcherId.
  // lim: el tope de eventos de ese momento (el índice del lanzamiento p+1), para C.defenseAt(feed, k, lim) y para saber
  // si ya pasó un cambio (momento 'cambio' de la jugada k con ix < lim); null = la jugada completa.
  // Un recorrido por las jugadas hasta k, sin copias: sirve para arrastrar la curva.
  C.stateAtPitch = (done, k, p) => {
    const plays = arr(done);
    if (k == null || k > plays.length - 1) k = plays.length - 1;
    if (k < 0) return Object.assign(C.stateAt(plays, -1), { balls: 0, strikes: 0, k: -1, p: -1, lim: null });
    if (p != null) { p = Math.floor(+p); if (p < -1) p = -1; }
    const q = plays[k] || {};
    const seq = C.pitchSeq(q);
    const last = seq.length - 1;
    const open = !!(q.about && q.about.isComplete === false);
    if (p == null || !(p < last)) {
      const lp = seq[last], cnt = q.count || {};
      if (!open) return Object.assign(C.stateAt(plays, k), { balls: lp ? lp.balls : num(cnt.balls), strikes: lp ? lp.strikes : num(cnt.strikes), k, p: last, lim: null });
      p = last;
    }
    const lim = p < last ? seq[p + 1].index : Infinity;
    const prev = plays[k - 1], same = sameHalf(prev, q);
    const b = board(plays, k - 1);
    const pm = (same && prev.matchup) || {};
    const bases = [who(pm.postOnFirst), who(pm.postOnSecond), who(pm.postOnThird)];
    const adv = advance(q, bases, lim, (id, e) => nameIn(plays, k, id) || entra(e));
    const ab = q.about || {}, m = q.matchup || {};
    // lanzador y bateador de ese momento: los que empezaron el turno, con los cambios anotados en el tramo
    let pe = null, be = null;
    arr(q.playEvents).forEach((e, i) => {
      if (!e || !inside(evIdx(e, i), lim)) return;
      const d = e.details || {};
      if (d.eventType === 'pitching_substitution' && e.player && e.player.id != null) pe = e;
      else if (isPH(e, d)) be = e;
    });
    const pitcher = pe ? entrant(plays, k, pe, m.pitcher) : startPitcher(plays, k);
    const batter = be ? entrant(plays, k, be, m.batter) : startBatter(plays, k);
    const inn = ab.inning || 1, top = !!ab.isTopInning;
    const bat = top ? 'away' : 'home', fld = top ? 'home' : 'away';
    const I = inningOf(b.innings, inn);
    I.played[bat] = true;
    I[bat].r += adv.runs; b.tot[bat].r += adv.runs;
    I[fld].e += adv.errs; b.tot[fld].e += adv.errs;
    const pt = p >= 0 ? seq[p] : null;
    return {
      inning: inn, top, outs: Math.min(3, (same ? num((prev.count || {}).outs) : 0) + adv.outs),
      away: b.away + (top ? adv.runs : 0), home: b.home + (top ? 0 : adv.runs), innings: b.innings, tot: b.tot,
      bases, batter, pitcher,
      desc: adv.act || (prev && prev.result && prev.result.description) || '',
      balls: pt ? pt.balls : 0, strikes: pt ? pt.strikes : 0, k, p, lim: Number.isFinite(lim) ? lim : null
    };
  };

  // Pasos de la repetición lanzamiento a lanzamiento: steps[i] = {k, p}, uno por lanzamiento; una jugada sin
  // lanzamientos ocupa un paso con p = -1 (que ya es la jugada completa). first[k]: primer paso de la jugada k.
  C.pitchIndex = done => {
    const steps = [], first = [];
    arr(done).forEach((q, k) => {
      first.push(steps.length);
      const n = C.pitchSeq(q).length;
      if (!n) steps.push({ k, p: -1 });
      for (let p = 0; p < n; p++) steps.push({ k, p });
    });
    return { steps, first };
  };

  // ¿El juego trae lanzamiento a lanzamiento? En muchos juegos de 2010-2014 la API solo guarda el lanzamiento puesto
  // en juego. false si más del 40 % de los turnos tiene un solo lanzamiento, o si el promedio es menor que 2 por turno.
  // Se cuentan lanzamientos de verdad (sin bolas ni strikes automáticos) en los turnos que tienen alguno. Con menos de
  // 10 turnos no se juzga (true): ningún juego completo de 2016-2026 baja de esas marcas desde el 10.º turno (los de
  // 2025-26 rondan 3,4-4,3 por turno y un 3-22 % con uno solo; el 289404 de 2010 da 1,4 y 79 %).
  C.pitchDataOk = done => {
    let turns = 0, one = 0, total = 0;
    for (const q of arr(done)) {
      let n = 0;
      for (const s of C.pitchSeq(q)) if (!s.auto) n++;
      if (!n) continue;
      turns++; total += n;
      if (n === 1) one++;
    }
    if (turns < 10) return true;
    return !(one / turns > 0.4 || total / turns < 2);
  };

  // Caja de strike en las coordenadas de la API (vista desde el center). Con los strikes cantados del juego: del
  // percentil 5 al 95, más 10 px de margen, mezclada con la caja fija según cuántos haya (peso n/(n+40)): al principio
  // del juego manda la fija. Medido en 33 juegos de 2025-26: separa cantados de bolas en el 99,2 % de los casos al
  // final del juego y en el 98,7-98,9 % con 12-20 cantados (la caja fija sola, 98,5 %; el peor juego, 96,6 contra 95,6).
  // inPlayUnreliable: los lanzamientos puestos en juego vienen marcados en el centro (desviación lateral < 5 px; pasa
  // casi siempre en Puerto La Cruz y Maracay, y en algunos juegos de Valencia y Caracas); con menos de 8 no se sabe.
  const ZONE = { x0: 84, x1: 132, y0: 120, y1: 176 };
  const pctl = (s, p) => { const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  C.zoneBox = done => {
    const xs = [], ys = [], inPlay = [];
    for (const q of arr(done)) for (const e of arr(q && q.playEvents)) {
      if (!e || !e.isPitch) continue;
      const c = (e.pitchData && e.pitchData.coordinates) || {};
      const x = fin(c.x), y = fin(c.y);
      if (x == null || y == null) continue;
      const code = (e.details && e.details.code) || '';
      if (code === 'C') { xs.push(x); ys.push(y); } else if (PITCH[code] && PITCH[code][0] === 'enjuego') inPlay.push(x);
    }
    const box = { x0: ZONE.x0, x1: ZONE.x1, y0: ZONE.y0, y1: ZONE.y1, fromGame: false, inPlayUnreliable: false };
    const n = xs.length;
    if (n >= 12) {
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const w = n / (n + 40);
      const est = { x0: pctl(xs, 0.05) - 10, x1: pctl(xs, 0.95) + 10, y0: pctl(ys, 0.05) - 10, y1: pctl(ys, 0.95) + 10 };
      for (const key in est) box[key] = Math.round((w * est[key] + (1 - w) * ZONE[key]) * 10) / 10;
      box.fromGame = true;
    }
    if (inPlay.length >= 8) {
      const m = inPlay.reduce((a, b) => a + b, 0) / inPlay.length;
      box.inPlayUnreliable = Math.sqrt(inPlay.reduce((a, b) => a + (b - m) * (b - m), 0) / inPlay.length) < 5;
    }
    return box;
  };

  // ---------- la defensa en el campo ----------
  const POSK = { 1: 'pitcher', 2: 'catcher', 3: 'first', 4: 'second', 5: 'third', 6: 'shortstop', 7: 'left', 8: 'center', 9: 'right' };
  const POSA = { P: 'pitcher', C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'shortstop', LF: 'left', CF: 'center', RF: 'right' };
  const posKey = pos => (pos ? POSK[pos.code] || POSA[pos.abbreviation] || null : null);
  const SUBS = new Set(['defensive_substitution', 'defensive_switch', 'pitching_substitution']);

  // Los nueve del equipo que fildea en la jugada k de done (k = índice entre las jugadas completas). Parte de los titulares
  // del box score (bate terminado en 00 y su primera posición) y del abridor (el primero de pitchers), y aplica los cambios
  // defensivos y de lanzador de las jugadas 0..k (cada jugador va al equipo al que pertenece). El designado no fildea.
  // lim: de la jugada k solo cuentan los eventos con índice menor (el lim de C.stateAtPitch); sin lim, todos.
  // Si falta algo, null en esa posición; nunca lanza error.
  C.defenseAt = (feed, k, lim) => {
    const out = { pitcher: null, catcher: null, first: null, second: null, third: null, shortstop: null, left: null, center: null, right: null };
    try {
      const ld = (feed && feed.liveData) || {};
      const teams = (ld.boxscore && ld.boxscore.teams) || {};
      const gp = (feed && feed.gameData && feed.gameData.players) || {};
      const D = { away: {}, home: {} }, sideOf = {}, names = {};
      for (const s of ['away', 'home']) {
        const t = teams[s] || {}, pl = t.players || {};
        for (const key in pl) {
          const x = pl[key], per = x && x.person;
          if (!per || per.id == null) continue;
          sideOf[per.id] = s;
          names[per.id] = per.fullName || '';
          if (/^\d00$/.test(String(x.battingOrder || ''))) {
            const pos = posKey((x.allPositions && x.allPositions[0]) || x.position);
            if (pos) D[s][pos] = per.id;
          }
        }
        const sp = arr(t.pitchers)[0];
        if (sp != null) { D[s].pitcher = sp; if (!sideOf[sp]) sideOf[sp] = s; }
      }
      let j = -1, cur = null;
      for (const q of arr(ld.plays && ld.plays.allPlays)) {
        if (!q || !q.about || !q.about.isComplete) continue;
        if (k != null && ++j > k) break;
        cur = q;
        const cut = k != null && j === k;
        arr(q.playEvents).forEach((e, i) => {
          const et = e && e.details && e.details.eventType;
          if (!SUBS.has(et) || !e.player || e.player.id == null || (cut && !inside(evIdx(e, i), lim))) return;
          const id = e.player.id;
          const d = D[sideOf[id] || (q.about.isTopInning ? 'home' : 'away')];
          const pos = posKey(e.position) || (et === 'pitching_substitution' ? 'pitcher' : null);
          for (const p in d) if (d[p] === id) d[p] = null; // sale de donde estaba
          if (pos) d[pos] = id;
        });
      }
      const fld = cur && !cur.about.isTopInning ? 'away' : 'home';
      for (const p in out) {
        const id = D[fld][p];
        if (id == null) continue;
        const g = gp['ID' + id];
        out[p] = { id, fullName: names[id] || (g && g.fullName) || '' };
      }
    } catch (e) { /* datos raros: queda lo que se haya armado */ }
    return out;
  };

  // ---------- marcas de la curva y mapa de batazos ----------
  // hr: jugadas con jonrón; changes: cambios de lanzador (side: el equipo que cambió, el que fildea);
  // halves: primera jugada de cada media entrada y las carreras que anotó ahí el equipo al bate.
  C.wpMarks = done => {
    const hr = [], changes = [], halves = [];
    let lastA = 0, lastH = 0, cur = null;
    arr(done).forEach((q, k) => {
      if (!q) return;
      const ab = q.about || {}, res = q.result || {};
      const inn = ab.inning || 1, top = !!ab.isTopInning;
      if (!cur || cur.inning !== inn || cur.top !== top) halves.push(cur = { k, inning: inn, top, runs: 0 });
      const a = res.awayScore != null ? num(res.awayScore) : lastA, h = res.homeScore != null ? num(res.homeScore) : lastH;
      cur.runs += top ? a - lastA : h - lastH;
      lastA = a; lastH = h;
      if (res.eventType === 'home_run') hr.push(k);
      for (const e of arr(q.playEvents)) {
        if (e && e.details && e.details.eventType === 'pitching_substitution') changes.push({ k, side: top ? 'home' : 'away' });
      }
    });
    return { hr, changes, halves };
  };

  // Batazos con coordenadas (hitData.coordinates, unidades de la API: home en ≈ (125,4; 198,3), 1 unidad ≈ 2,5 pies).
  // side: el equipo al bate; out: ni hit ni error (incluye selección y sacrificios).
  C.sprayPoints = done => {
    const out = [];
    arr(done).forEach((q, k) => {
      if (!q) return;
      const evs = arr(q.playEvents);
      let hd = null;
      for (let i = evs.length - 1; i >= 0 && !hd; i--) {
        const h = evs[i] && evs[i].hitData, c = h && h.coordinates;
        if (c && fin(c.coordX) != null && fin(c.coordY) != null) hd = h;
      }
      if (!hd) return;
      const ab = q.about || {}, res = q.result || {}, m = q.matchup || {};
      const top = !!ab.isTopInning, t = res.eventType;
      const hit = HIT_EVENTS.has(t), error = t === 'field_error';
      out.push({
        k, side: top ? 'away' : 'home', x: +hd.coordinates.coordX, y: +hd.coordinates.coordY, traj: hd.trajectory || null,
        event: C.eventEs(q), hit, hr: t === 'home_run', out: !hit && !error, error, batter: who(m.batter),
        inning: ab.inning || null, top, desc: C.cleanEs(res.description)
      });
    });
    return out;
  };

  // ---------- textos del jugada a jugada y del box score, en español venezolano ----------
  // La API en español dice "Base por Bolas", "Pelotazo", "Roletazo de Doble Play" y junta el elevado con el elevadito;
  // aquí el nombre sale del tipo de jugada y de la trayectoria del batazo.
  const OUT_BY_TRAJ = { ground_ball: 'Rolata', fly_ball: 'Elevado', line_drive: 'Línea', popup: 'Elevadito', bunt_popup: 'Elevadito de toque', bunt_grounder: 'Toque', bunt_line_drive: 'Línea de toque' };
  const EVENTS = {
    single: 'Sencillo', double: 'Doble', triple: 'Triple', home_run: 'Jonrón',
    walk: 'Boleto', intent_walk: 'Boleto intencional', hit_by_pitch: 'Golpeado',
    grounded_into_double_play: 'Rolata para doble play', double_play: 'Doble play', triple_play: 'Triple play',
    strikeout_double_play: 'Ponche y doble play', strikeout_triple_play: 'Ponche y triple play',
    force_out: 'Out forzado', fielders_choice: 'Selección', fielders_choice_out: 'Selección, out',
    sac_fly: 'Elevado de sacrificio', sac_bunt: 'Toque de sacrificio', sac_fly_double_play: 'Elevado de sacrificio y doble play',
    sac_bunt_double_play: 'Toque de sacrificio y doble play', field_error: 'Error', catcher_interf: 'Interferencia del receptor',
    batter_interference: 'Interferencia del bateador', fan_interference: 'Interferencia de un fanático',
    caught_stealing_2b: 'Atrapado robando la 2.ª', caught_stealing_3b: 'Atrapado robando la 3.ª', caught_stealing_home: 'Atrapado robando home',
    pickoff_1b: 'Sorprendido en 1.ª', pickoff_2b: 'Sorprendido en 2.ª', pickoff_3b: 'Sorprendido en 3.ª',
    pickoff_caught_stealing_2b: 'Sorprendido robando la 2.ª', pickoff_caught_stealing_3b: 'Sorprendido robando la 3.ª',
    pickoff_caught_stealing_home: 'Sorprendido robando home', stolen_base_2b: 'Robo de la 2.ª', stolen_base_3b: 'Robo de la 3.ª',
    stolen_base_home: 'Robo de home', wild_pitch: 'Lanzamiento desviado', passed_ball: 'Pasbol', balk: 'Balk',
    other_out: 'Out', runner_double_play: 'Doble play'
  };
  C.eventEs = play => {
    const r = (play && play.result) || {};
    const t = r.eventType;
    const evs = arr(play && play.playEvents);
    if (t === 'strikeout') {
      const last = evs.filter(e => e.isPitch).pop();
      const code = last && last.details && last.details.code;
      return code === 'C' ? 'Ponche cantado' : 'Ponche tirándole';
    }
    if (t === 'field_out') {
      const hd = evs.length ? evs[evs.length - 1].hitData : null;
      return (hd && OUT_BY_TRAJ[hd.trajectory]) || 'Out';
    }
    return EVENTS[t] || r.event || '';
  };

  // Arreglos fijos al texto en español de la API.
  C.cleanEs = s => String(s || '')
    .replace(/reemplaza a replaces/g, 'reemplaza a')
    .replace(/batea rodado batea para/g, 'batea rodado para')
    .replace(/recibe base por bolas intencional/g, 'recibe boleto intencional')
    .replace(/recibe base por bolas/g, 'recibe boleto')
    .replace(/otorga base por bolas intencional a/g, 'le da boleto intencional a')
    .replace(/otorga base por bolas a/g, 'le da boleto a')
    .replace(/ anota (?=[A-ZÁÉÍÓÚÑ])/g, ' anota. ')
    .replace(/Corri�/g, 'Corrió')
    .replace(/�/g, '');

  // Decisiones del box score: (W, 2-0) (L, 0-1) (S, 3) (H, 1) (BS, 1) -> G, P, JS, HLD, SD
  const DECS = { W: 'G', L: 'P', S: 'JS', SV: 'JS', H: 'HLD', HLD: 'HLD', BS: 'SD' };
  C.noteEs = s => String(s || '').replace(/\((W|L|SV|S|HLD|H|BS)\b/g, (m, k) => '(' + DECS[k]);

  const POS = { PH: 'BE', PR: 'CE', DH: 'BD' };
  C.posEs = a => POS[a] || a;

  // ---------- momentos de la transmisión (la banda amarilla) ----------
  // "José A. Martínez" -> "Martínez" ; "Ronald Acuña Jr." -> "Acuña Jr." (igual que la pantalla de juegos)
  C.surname = n => {
    const p = String(n || '').split(' ').filter(x => x && !/^[A-Z]\.$/.test(x));
    return p.length > 1 ? p.slice(1).join(' ') : (p[0] || '');
  };
  // hitData.location: la posición que fildeó (outs y errores) o la zona del batazo (hits)
  const LOC = { 1: 'al pitcher', 2: 'al receptor', 3: 'por primera', 4: 'por segunda', 5: 'por tercera', 6: 'al campocorto',
    7: 'al left', 8: 'al center', 9: 'al right', 78: 'entre left y center', 89: 'entre center y right' };
  const DEL = { 1: 'del pitcher', 2: 'del receptor', 3: 'del inicialista', 4: 'del camarero', 5: 'del antesalista', 6: 'del campocorto',
    7: 'del jardinero izquierdo', 8: 'del jardinero central', 9: 'del jardinero derecho' };
  // "rolata al campocorto", pero "sencillo por el campocorto"; "error del camarero"
  const locEs = (l, t) => {
    if (l == null || l === '') return '';
    const s = String(l), d = s.charAt(0);
    if (t === 'field_error') return DEL[d] || '';
    if (HIT_EVENTS.has(t) && s === '6') return 'por el campocorto';
    return LOC[s] || LOC[d] || '';
  };
  const listEs = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);
  const lower = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
  const upper = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const HR_KIND = { 1: 'solitario', 2: 'de dos carreras', 3: 'de tres carreras', 4: 'con las bases llenas' };

  // Lo que hace anotar sin el batazo: wild pitch, pasbol, balk, robo (o error en un pickoff o un robo).
  const RUN_ACT = /^(wild_pitch|passed_ball|balk|stolen_base|caught_stealing|pickoff)/;
  // "Marcano, doble al right; anota Tovar" · "Marcano, jonrón de dos carreras al right". Lo que anota por otra causa a
  // mitad de turno (wild pitch, pasbol, balk, robo de home) va aparte: "Lanzamiento desviado; anota Palacios". Lo que
  // entra por error se dice con quién lo cometió: "Valera, rolata al campocorto; anota Rodriguez por error del
  // inicialista". Con el turno sin terminar (en vivo), result trae el último evento y no un batazo: cada corredor va con
  // el suyo y sin el bateador ("Balk; anota Quevedo").
  function runText(q) {
    const res = q.result || {}, m = q.matchup || {}, evs = arr(q.playEvents);
    const open = !!(q.about && q.about.isComplete === false);
    let hd = null;
    for (let i = evs.length - 1; i >= 0 && !hd; i--) hd = evs[i] && evs[i].hitData;
    const loc = locEs(hd && hd.location, res.eventType);
    const batId = m.batter ? m.batter.id : null;
    // posición del que cometió el error: la del crédito de ese movimiento o, si no la trae, la del primer error de la jugada
    const errAt = list => { for (const c of arr(list)) if (c && /error/i.test(c.credit || '') && c.position) return c.position.code; return null; };
    const errPos = rn => { let pos = errAt(rn.credits); for (const x of arr(q.runners)) if (pos == null && x) pos = errAt(x.credits); return pos; };
    const groups = [];
    for (const rn of arr(q.runners)) {
      const mv = (rn && rn.movement) || {}, d = (rn && rn.details) || {};
      if (mv.end !== 'score' || mv.isOut) continue;
      const t = d.eventType || '';
      let kind, key;
      // la API marca 'error' también al que de todos modos anotaba con el batazo: ese trae la impulsada (rbi) y va con él
      if ((t === 'error' || (t === 'field_error' && t !== res.eventType)) && !(d.rbi === true && !open)) { kind = 'err'; key = 'E' + (errPos(rn) || ''); }
      else if (open || RUN_ACT.test(t)) { kind = 'act'; key = t; }
      else { kind = 'main'; key = ''; }
      let g = groups.find(x => x.key === key);
      if (!g) groups.push(g = { kind, key, who: [], idx: runIdx(rn), pos: kind === 'err' ? errPos(rn) : null });
      g.who.push(d.runner || {});
    }
    groups.sort((a, b) => a.idx - b.idx);
    const bat = C.surname(m.batter && m.batter.fullName);
    const lead = t => (bat ? `${bat}, ${lower(t)}` : upper(t));
    // el bateador que le da la vuelta al cuadro (por error) va de último: "anotan Barreto y Querecuto"
    const anota = w => {
      const names = w.filter(x => x.id !== batId).concat(w.filter(x => x.id === batId)).map(x => C.surname(x.fullName));
      return `anota${names.length > 1 ? 'n' : ''} ${listEs(names)}`;
    };
    const delOf = g => (DEL[g.pos] ? ' ' + DEL[g.pos] : '');
    // la jugada del bateador, terminada: una frase con sus carreras y, al final, las que entraron por error en ella
    const parts = [];
    let play = null;
    for (const g of groups) {
      if (g.kind === 'act') parts.push(`${EVENTS[g.key] || 'Avance'}; ${anota(g.who)}`);
      else if (open) parts.push(upper(`error${delOf(g)}; ${anota(g.who)}`));
      else {
        if (!play) parts.push(play = { main: null, errs: [] });
        if (g.kind === 'main') play.main = g; else play.errs.push(g);
      }
    }
    const said = x => {
      if (typeof x === 'string') return x;
      let s = res.eventType === 'home_run' && x.main ? lead(['Jonrón', HR_KIND[x.main.who.length], loc].filter(Boolean).join(' '))
        : lead(C.eventEs(q) + (loc ? ' ' + loc : '')) + (x.main ? '; ' + anota(x.main.who) : '');
      for (const g of x.errs) s += `; ${anota(g.who)} por error${delOf(g)}`;
      return s;
    };
    return parts.map(said).join(' · ') || C.cleanEs(res.description);
  }

  // "MAG: entra Vizcaya por Vázquez". Los nombres salen de la descripción de la API y, si no, de los turnos.
  function changeText(plays, k, e, abbr) {
    const id = e.player && e.player.id;
    const mm = /:\s*(.+?)\s+(?:reemplaza a|replaces)\s+(.+?)\.?\s*$/i.exec(C.cleanEs(e.details && e.details.description));
    let inN = mm ? mm[1] : '', outN = mm ? mm[2] : '';
    const top = !!(plays[k] && plays[k].about && plays[k].about.isTopInning);
    for (let i = k; i < plays.length && !inN; i++) {
      const z = plays[i] && plays[i].matchup;
      if (z && z.pitcher && z.pitcher.id === id) inN = z.pitcher.fullName || '';
    }
    for (let i = k - 1; i >= 0 && !outN; i--) {
      const z = plays[i];
      if (z && z.about && !!z.about.isTopInning === top && z.matchup && z.matchup.pitcher && z.matchup.pitcher.id !== id) outN = z.matchup.pitcher.fullName || '';
    }
    const t = `entra ${C.surname(inN) || 'un relevista'}${outN ? ' por ' + C.surname(outN) : ''}`;
    return abbr ? `${abbr}: ${t}` : upper(t);
  }

  // Dejados en base al terminar la jugada k, siguiendo a los corredores (en la del tercer out la API ya no los trae).
  function lobOf(plays, k) {
    const q = plays[k], prev = plays[k - 1];
    const pm = (sameHalf(prev, q) && prev.matchup) || {};
    const bases = [who(pm.postOnFirst), who(pm.postOnSecond), who(pm.postOnThird)];
    advance(q, bases, Infinity, () => '');
    return bases.filter(Boolean).length;
  }

  // Momentos entre las jugadas fromK (sin incluir; puede ser -1) y toK (incluida), en orden. ls: el linescore, para las
  // carreras, hits, errores y dejados de cada media entrada; lo que no traiga sale de done. o: {away, home} con las siglas
  // de los equipos para los títulos ("CARRERA · MAG 4-3"); sin ellas, VIS y HC.
  // Dentro de una jugada: cambio de lanzador, carrera o jonrón, fin de la media entrada y sin hits (del 6.º en adelante).
  C.moments = (done, fromK, toK, ls, o) => {
    const plays = arr(done), out = [];
    if (!plays.length) return out;
    o = o || {};
    const abbr = { away: o.away || 'VIS', home: o.home || 'HC' };
    const from = fromK == null ? -1 : fromK;
    const to = toK == null || toK > plays.length - 1 ? plays.length - 1 : toK;
    const sched = (ls && ls.scheduledInnings) || 9;
    const lsInn = inn => arr(ls && ls.innings).find(I => I && I.num === inn) || arr(ls && ls.innings)[inn - 1] || null;
    const hits = { away: 0, home: 0 };
    let lastA = 0, lastH = 0, half = null;
    for (let k = 0; k <= to; k++) {
      const q = plays[k];
      if (!q) continue;
      const ab = q.about || {}, res = q.result || {};
      const inn = ab.inning || 1, top = !!ab.isTopInning, bat = top ? 'away' : 'home', fld = top ? 'home' : 'away';
      if (!half || half.inn !== inn || half.top !== top) half = { inn, top, r: 0, h: 0, e: 0 };
      const a = res.awayScore != null ? num(res.awayScore) : lastA, h = res.homeScore != null ? num(res.homeScore) : lastH;
      const runs = top ? a - lastA : h - lastH;
      lastA = a; lastH = h;
      half.r += runs;
      half.e += errorsOf(q);
      if (HIT_EVENTS.has(res.eventType)) { hits[bat]++; half.h++; }
      if (k <= from) continue;
      const score = `${abbr[bat]} ${top ? a : h}-${top ? h : a}`;
      // ix: el índice del evento (un relevo a mitad de turno pasa cuando la repetición llega a él: ix < lim de stateAtPitch)
      arr(q.playEvents).forEach((e, i) => {
        if (e && e.details && e.details.eventType === 'pitching_substitution') {
          out.push({ type: 'cambio', side: fld, k, ix: evIdx(e, i), title: 'CAMBIO DE LANZADOR', text: changeText(plays, k, e, o[fld] || '') });
        }
      });
      if (res.eventType === 'home_run') out.push({ type: 'jonron', side: bat, k, title: `JONRÓN · ${score}`, text: runText(q) });
      else if (runs > 0) out.push({ type: 'carrera', side: bat, k, title: `${runs > 1 ? runs + ' CARRERAS' : 'CARRERA'} · ${score}`, text: runText(q) });
      // fin de la media entrada: tercer out, la jugada siguiente es de otra mitad, o el home club deja en el terreno
      const next = plays[k + 1];
      const walkoff = !top && !next && inn >= sched && h > a;
      if (num((q.count || {}).outs) >= 3 || (next && !sameHalf(q, next)) || walkoff) {
        const over = inn >= sched && (top ? h > a : h !== a); // ahí se acabó el juego
        const L = lsInn(inn), lb = L && L[bat], lf = L && L[fld];
        const r = lb && lb.runs != null ? num(lb.runs) : half.r;
        const hh = lb && lb.hits != null ? num(lb.hits) : half.h;
        const ee = lf && lf.errors != null ? num(lf.errors) : half.e;
        const lob = lb && lb.leftOnBase != null ? num(lb.leftOnBase) : lobOf(plays, k);
        out.push({
          type: 'fin', side: bat, k, title: `${top && !over ? 'MITAD' : 'FIN'} DEL ${inn}.º`,
          text: `${abbr[bat]}: ${plural(r, 'carrera', 'carreras')}, ${plural(hh, 'hit', 'hits')}, ${plural(ee, 'error', 'errores')}, ${plural(lob, 'dejado', 'dejados')} en base`
        });
        if (inn >= 6 && !hits[bat]) {
          out.push({
            type: 'nohit', side: bat, k, title: (top ? a : h) ? 'SIN HITS' : 'SIN HIT NI CARRERA',
            text: over ? `${abbr[bat]} terminó sin hits` : `${abbr[bat]} sigue sin hits después de ${inn} innings`
          });
        }
      }
    }
    return out;
  };

  // Historial del bateador contra el lanzador (/people/{id}/stats?stats=vsPlayer, deporte 17): suma las filas del total
  // (una por tipo de juego si se piden varios: R, L, W...). null si nunca se enfrentaron. Muestras chicas: decirlo.
  // o.antes (temporada, ej. 2025): solo las temporadas anteriores, para no usar datos del futuro en la repetición. Con
  // o.tipo (el tipo del juego: R, F, D, L o W), además las fases de esa misma temporada que se juegan antes que esa
  // (la final suma la ronda regular, el comodín y el round robin de su temporada). Necesita la fila por temporada (season).
  const PHASE = { R: 0, F: 1, D: 2, L: 3, W: 4 };
  C.vsLine = (r, o) => {
    o = o || {};
    const st = arr(r && r.stats);
    const pick = name => st.find(s => s && s.type && s.type.displayName === name && arr(s.splits).length);
    let rows;
    if (o.antes != null) {
      const g = pick('vsPlayer'), before = +o.antes, ph = PHASE[o.tipo];
      rows = (g ? g.splits : []).filter(x => {
        const s = x && x.season != null && x.season !== '' ? +x.season : NaN;
        return s < before || (s === before && ph != null && PHASE[x.gameType || 'R'] < ph);
      });
    } else {
      const g = pick('vsPlayerTotal') || pick('vsPlayer');
      rows = g ? g.splits : [];
    }
    if (!rows.length) return null;
    const lines = rows.map(x => C.batLine((x && x.stat) || {}));
    const b = lines.length === 1 ? lines[0] : C.sum(lines);
    if (!b.PA) return null;
    const m = C.bat(b);
    return { pa: b.PA, ab: b.AB, h: b.H, d: b.D, t: b.T, hr: b.HR, bb: b.BB, so: b.SO, avg: m.AVG, ops: m.OPS };
  };

  // Encoge una tasa hacia el promedio de la liga según su muestra (n) y su punto de estabilización (k).
  C.shrink = (x, n, lgx, k) => (x == null || lgx == null || !(n >= 0) ? x : (x * n + lgx * k) / (n + k));

  // ---------- percentil de un valor dentro de un grupo ----------
  C.pctRank = (v, arr, higherBetter) => {
    if (v == null || !arr || !arr.length) return null;
    let below = 0, eq = 0;
    for (const x of arr) { if (x < v) below++; else if (x === v) eq++; }
    let p = (below + eq / 2) / arr.length;
    if (higherBetter === false) p = 1 - p;
    return Math.max(1, Math.min(99, Math.round(p * 100)));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else { root.PC = root.PC || {}; root.PC.calc = C; }
})(typeof window !== 'undefined' ? window : globalThis);
