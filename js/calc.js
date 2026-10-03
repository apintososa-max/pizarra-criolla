/* Pizarra Criolla · calc.js
   Todos los cálculos de la app. Funciones puras: reciben datos ya descargados y devuelven números.
   Se cargan igual en el navegador (window.PC.calc) y en Node (module.exports) para poder probarlas. */
(function (root) {
  'use strict';
  const C = {};

  const num = v => { if (v == null || v === '') return 0; const n = +v; return Number.isFinite(n) ? n : 0; };
  const div = (a, b) => (b > 0 ? a / b : null);
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
  C.stateAt = (allPlays, k) => {
    const plays = allPlays.slice(0, k + 1);
    const innings = [];
    let lastA = 0, lastH = 0;
    const tot = { away: { r: 0, h: 0, e: 0 }, home: { r: 0, h: 0, e: 0 } };
    for (const q of plays) {
      const ab = q.about || {}, res = q.result || {};
      const inn = ab.inning || 1, top = !!ab.isTopInning;
      while (innings.length < inn) innings.push({ away: { r: 0, h: 0, e: 0 }, home: { r: 0, h: 0, e: 0 }, played: { away: false, home: false } });
      const I = innings[inn - 1];
      const bat = top ? 'away' : 'home', fld = top ? 'home' : 'away';
      I.played[bat] = true;
      const a = num(res.awayScore), h = num(res.homeScore);
      const runs = top ? a - lastA : h - lastH;
      I[bat].r += runs; tot[bat].r += runs;
      lastA = a; lastH = h;
      if (HIT_EVENTS.has(res.eventType)) { I[bat].h++; tot[bat].h++; }
      const errs = new Set();
      for (const rn of q.runners || []) for (const c of rn.credits || []) {
        if (/error/i.test(c.credit || '') && c.player) errs.add(c.player.id);
      }
      I[fld].e += errs.size; tot[fld].e += errs.size;
    }
    const p = plays[plays.length - 1] || {};
    const m = p.matchup || {}, ab = p.about || {}, cnt = p.count || {};
    return {
      inning: ab.inning || 1, top: !!ab.isTopInning, outs: num(cnt.outs),
      away: lastA, home: lastH, innings, tot,
      bases: [!!m.postOnFirst, !!m.postOnSecond, !!m.postOnThird],
      batter: m.batter || null, pitcher: m.pitcher || null,
      desc: (p.result && p.result.description) || ''
    };
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
    const evs = (play && play.playEvents) || [];
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
