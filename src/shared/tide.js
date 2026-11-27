// ── Tides ────────────────────────────────────────────────────────────────────
// The card reads the tide entities of an existing integration and brings them down to one model: the high and low
// waters it knows ({ type: "high" | "low", t (ms), h, coef }), the water height now and its trend, a curve over the
// day (measured when the integration gives one, else drawn between the high and low waters) and the coefficients of
// the coming days when the integration has some. One adapter per integration:
// - Marées France (marees_france, SHOM): its websocket commands give the tides of several days, the measured water
//   levels and the coefficients; its "now" sensor gives the height and the trend.
// - NOAA Tides (Home Assistant core, noaa_tides): the next tide in the state ("High tide at 3:41 PM"), the two after
//   it in attributes.
// - NOAA Tides fork (Flight-Lab / jshufro, noaa_tides custom): last, next and following tides with their levels.
// - World Tides (core worldtidesinfo and the custom worldtidesinfocustom): the next high and low waters with their
//   heights, the height now for the custom one.
// - UKHO Tides (ukho_tides): the list of predictions of the coming days, Rising / Falling in the state.
// - Norwegian Tide (norwegiantide, Kartverket): the next high and low waters, in centimetres.
// - A manual mapping (`mapping:`) for anything else: template or REST sensors (Stormglass…).
export const TD_HALF = 6.21 * 3600000; // half a tidal cycle (semi-diurnal): 6 h 12.6 min
export const TD_DAY = 86400000;
export const TD_SOURCES = ["marees_france", "noaa", "noaa_fork", "worldtides", "ukho", "norwegian", "manual"];

// A number from a state or an attribute: 8.2, "8.2", "8.2m", "1,8 m"; null when none.
export const tdNum = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(v));
  return m ? Number(m[0].replace(",", ".")) : null;
};

// A date-time (ms) from an ISO string (a "+0000" offset accepted), an epoch in seconds or ms, a Date; null when none.
export const tdTime = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  const s = String(v)
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

// A clock time without a date ("3:41 PM", "15:41") as the occurrence of it closest after (`dir` 1) or before (`dir`
// -1) `ref`.
export const tdClock = (v, ref, dir) => {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  let h = Number(m[1]) % 24;
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  const d = new Date(ref);
  d.setHours(h, Number(m[2]), 0, 0);
  let t = d.getTime();
  if (dir > 0 && t <= ref) t += TD_DAY;
  if (dir < 0 && t > ref) t -= TD_DAY;
  return t;
};

export const tdMidnight = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// "YYYY-MM-DD" of a local day, as Marées France keys its days.
export const tdDayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Sorted by time, one per time (two sources of the same tide), with a known height.
export const tdOrder = (list) => {
  const out = [];
  for (const e of list.filter((x) => x && x.t != null && (x.type === "high" || x.type === "low")).sort((a, b) => a.t - b.t)) {
    const last = out.at(-1);
    if (last && Math.abs(last.t - e.t) < 60000) {
      last.h ??= e.h;
      last.coef ??= e.coef;
    } else out.push({ ...e });
  }
  // A tide whose height is unknown takes the height of the closest tide of its type.
  for (const e of out) {
    if (e.h != null) continue;
    const same = out.filter((x) => x.type === e.type && x.h != null).sort((a, b) => Math.abs(a.t - e.t) - Math.abs(b.t - e.t));
    e.h = same[0]?.h ?? null;
  }
  return out.filter((e) => e.h != null);
};

// The high and low waters, carried on past the known ones by half tidal cycles (each one as high as the last one of
// its type), so that a curve covers [from, to].
export const tdExtend = (ext, from, to) => {
  if (!ext.length) return [];
  const out = ext.map((e) => ({ ...e }));
  const lastOf = (type, list) => [...list].reverse().find((e) => e.type === type) ?? list.find((e) => e.type === type);
  while (out[0].t > from) {
    const type = out[0].type === "high" ? "low" : "high";
    const like = out.find((e) => e.type === type) ?? { h: out[0].h };
    out.unshift({ type, t: out[0].t - TD_HALF, h: like.h, estimated: true });
  }
  while (out.at(-1).t < to) {
    const type = out.at(-1).type === "high" ? "low" : "high";
    const like = lastOf(type, out) ?? { h: out.at(-1).h };
    out.push({ type, t: out.at(-1).t + TD_HALF, h: like.h, estimated: true });
  }
  return out;
};

// The height at `t` between two tides: a half cosine from one to the next (the rule of twelfths, smoothed).
export const tdBetween = (a, b, t) => {
  const f = (t - a.t) / (b.t - a.t);
  return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * f);
};

// A curve [[t, h], …] over [from, to], every `step` ms, from the high and low waters.
export const tdCurve = (ext, from, to, step = 10 * 60000) => {
  const all = tdExtend(ext, from, to);
  if (all.length < 2) return [];
  const pts = [];
  let i = 0;
  for (let t = from; t <= to; t += step) {
    while (i < all.length - 2 && all[i + 1].t < t) i++;
    pts.push([t, tdBetween(all[i], all[i + 1], t)]);
  }
  return pts;
};

// The height at `t` on a curve, linear between its points; null outside it.
export const tdAt = (curve, t) => {
  if (!curve.length || t < curve[0][0] || t > curve.at(-1)[0]) return null;
  for (let i = 1; i < curve.length; i++) {
    const [t1, h1] = curve[i];
    if (t1 >= t) {
      const [t0, h0] = curve[i - 1];
      return t1 === t0 ? h1 : h0 + ((h1 - h0) * (t - t0)) / (t1 - t0);
    }
  }
  return curve.at(-1)[1];
};

// rising / falling from a trend text (Marées France, UKHO, Norwegian Tide, a template sensor) or a flag.
export const tdTrendOf = (v) => {
  const s = String(v ?? "").toLowerCase();
  if (/^(rising|flow|flood|incoming|montante|up|on)$/.test(s) || /rising|flood|incoming|montant/.test(s)) return "rising";
  if (/^(falling|ebb|outgoing|descendante|down|off)$/.test(s) || /falling|ebb|outgoing|descendant/.test(s)) return "falling";
  return null;
};

const tdType = (v) => (/^h|high|haute|pm|tide\.high/i.test(String(v ?? "")) ? "high" : /^l|low|basse|bm|tide\.low/i.test(String(v ?? "")) ? "low" : null);

// ── Adapters ─────────────────────────────────────────────────────────────────
// The integration behind an entity, from its platform in the entity registry, else from its attributes.
export const tdSourceOf = (hass, id) => {
  const st = hass?.states?.[id];
  const platform = hass?.entities?.[id]?.platform;
  const a = st?.attributes || {};
  if (platform === "marees_france") return "marees_france";
  if (platform === "ukho_tides" || Array.isArray(a.predictions) || "next_high_tide_at" in a) return "ukho";
  if (platform === "norwegiantide" || ("next_tide_high" in a && "next_tide_low" in a)) return "norwegian";
  if ("next_tide_time" in a && "next_tide_type" in a) return "noaa_fork";
  if (platform === "worldtidesinfo" || platform === "worldtidesinfocustom" || "high_tide_time_utc" in a) return "worldtides";
  if (platform === "noaa_tides" || ("high_tide_time" in a && "low_tide_time" in a)) return "noaa";
  return null;
};

// The tide entities of the home, for the card picker's first config: one per port or station.
export const tdCandidates = (hass) =>
  Object.keys(hass?.states || {}).filter((id) => {
    if (!id.startsWith("sensor.")) return false;
    const src = tdSourceOf(hass, id);
    if (src !== "marees_france") return !!src;
    return hass.entities?.[id]?.translation_key === "now_tide";
  });

// The unit of an entity's heights: its own, else the unit system's (ft in imperial), else metres. Centimetres
// (Norwegian Tide) are shown in metres.
export const tdUnit = (hass, st, fallback) => {
  const u = st?.attributes?.unit_of_measurement ?? st?.attributes?.["Unit displayed"];
  if (u === "ft" || u === "imperial") return "ft";
  if (u === "m" || u === "metric") return "m";
  if (u === "cm") return "cm";
  return fallback ?? (hass?.config?.unit_system?.length === "mi" ? "ft" : "m");
};

// Marées France: the sibling entities of a port (same device), and the data its websocket commands return
// (`ws`: { tides, levels, coefs }).
export const tdMfSiblings = (hass, id) => {
  const dev = hass.entities?.[id]?.device_id;
  const ids = Object.keys(hass.entities || {}).filter((e) => hass.entities[e].platform === "marees_france" && (!dev || hass.entities[e].device_id === dev));
  const byKey = (k) => ids.find((e) => hass.entities[e].translation_key === k);
  return { device: dev, now: byKey("now_tide") ?? id, height: byKey("water_height") };
};

export const tdFromMf = (hass, id, ws) => {
  const sib = tdMfSiblings(hass, id);
  const now = hass.states[sib.now];
  const a = now?.attributes || {};
  const ext = [];
  for (const [day, list] of Object.entries(ws?.tides || {})) {
    for (const e of Array.isArray(list) ? list : []) {
      const type = tdType(e?.[0]);
      const t = /^\d{4}-\d\d-\d\d$/.test(day) ? tdTime(`${day}T${String(e?.[1]).slice(0, 5)}:00`) : null;
      if (type && t != null) ext.push({ type, t, h: tdNum(e[2]), coef: type === "high" ? tdNum(e[3]) : null });
    }
  }
  // The current tide's span from the "now" sensor, when the websocket data is not in yet.
  if (!ext.length && a.starting_time && a.finished_time) {
    const trend = tdTrendOf(a.tide_trend ?? now.state);
    ext.push({ type: trend === "rising" ? "low" : "high", t: tdTime(a.starting_time), h: tdNum(a.starting_height) });
    ext.push({ type: trend === "rising" ? "high" : "low", t: tdTime(a.finished_time), h: tdNum(a.finished_height), coef: tdNum(a.coefficient) });
  }
  const levels = [];
  for (const [day, list] of Object.entries(ws?.levels || {})) {
    for (const p of Array.isArray(list) ? list : []) {
      const t = tdTime(`${day}T${String(p?.[0]).slice(0, 8).padEnd(8, ":00")}`);
      const h = tdNum(p?.[1]);
      if (t != null && h != null) levels.push([t, h]);
    }
  }
  levels.sort((x, y) => x[0] - y[0]);
  const coefs = Object.entries(ws?.coefs || {})
    .map(([day, list]) => ({ day: tdTime(`${day}T00:00:00`), coef: Math.max(...(Array.isArray(list) ? list : [list]).map(tdNum).filter((n) => n != null)) }))
    .filter((c) => c.day != null && Number.isFinite(c.coef));
  const height = tdNum(a.current_height) ?? tdNum(hass.states[sib.height]?.state);
  return {
    source: "marees_france",
    id: sib.now,
    device: sib.device,
    name: hass.devices?.[sib.device]?.name ?? null,
    unit: "m",
    height,
    trend: tdTrendOf(a.tide_trend ?? now?.state),
    coef: tdNum(a.coefficient),
    extremes: ext,
    levels,
    coefs,
  };
};

// NOAA Tides (core): state "High tide at 3:41 PM" (the next tide, no height), attributes the two after it.
export const tdFromNoaa = (hass, id, now) => {
  const st = hass.states[id];
  const a = st.attributes || {};
  const ext = [];
  const m = /(high|low)\D+(\d{1,2}:\d{2}\s*[AaPp]?[Mm]?)/i.exec(st.state || "");
  if (m) ext.push({ type: tdType(m[1]), t: tdClock(m[2], now, 1), h: null });
  ext.push({ type: "high", t: tdTime(a.high_tide_time), h: tdNum(a.high_tide_height) });
  ext.push({ type: "low", t: tdTime(a.low_tide_time), h: tdNum(a.low_tide_height) });
  return { source: "noaa", id, unit: tdUnit(hass, st), extremes: ext };
};

// NOAA Tides fork: last / next / following tides, as clock times with their levels.
export const tdFromNoaaFork = (hass, id, now) => {
  const a = hass.states[id].attributes || {};
  const next = tdClock(a.next_tide_time, now, 1);
  const ext = [
    { type: tdType(a.last_tide_type), t: tdClock(a.last_tide_time, now, -1), h: tdNum(a.last_tide_level) },
    { type: tdType(a.next_tide_type), t: next, h: tdNum(a.next_tide_level) },
    { type: tdType(a.following_tide_type), t: next != null ? tdClock(a.following_tide_time, next, 1) : null, h: tdNum(a.following_tide_level) },
  ];
  return { source: "noaa_fork", id, unit: tdUnit(hass, hass.states[id]), extremes: ext };
};

// World Tides (core and custom): the next high and low waters (UTC), the height now on the custom one.
export const tdFromWorldTides = (hass, id) => {
  const st = hass.states[id];
  const a = st.attributes || {};
  return {
    source: "worldtides",
    id,
    unit: tdUnit(hass, st),
    height: tdNum(a.current_height),
    trend: tdTrendOf(a.tide_tendancy),
    extremes: [
      { type: "high", t: tdTime(a.high_tide_time_utc), h: tdNum(a.high_tide_height) },
      { type: "low", t: tdTime(a.low_tide_time_utc), h: tdNum(a.low_tide_height) },
    ],
  };
};

// UKHO Tides: [["YYYY-MM-DD HH:MM:SS" (UTC), height], …], high and low waters alternating (told apart by their
// neighbours' heights), Rising / Falling in the state.
export const tdFromUkho = (hass, id) => {
  const st = hass.states[id];
  const a = st.attributes || {};
  const list = (Array.isArray(a.predictions) ? a.predictions : []).map((p) => ({ t: tdTime(`${String(p?.[0]).replace(" ", "T")}Z`), h: tdNum(p?.[1]) })).filter((p) => p.t != null && p.h != null);
  const ext = list.map((p, i) => {
    const other = list[i + 1] ?? list[i - 1];
    return { ...p, type: other && p.h >= other.h ? "high" : "low" };
  });
  if (!ext.length) {
    ext.push({ type: "high", t: tdTime(a.next_high_tide_at), h: tdNum(a.next_high_tide_height) });
    ext.push({ type: "low", t: tdTime(a.next_low_tide_at), h: tdNum(a.next_low_tide_height) });
  }
  return { source: "ukho", id, unit: "m", trend: tdTrendOf(st.state), extremes: ext };
};

// Norwegian Tide: the next high and low waters ({ time, value } in cm), the forecast height now in the state.
export const tdFromNorwegian = (hass, id) => {
  const st = hass.states[id];
  const a = st.attributes || {};
  const cm = tdUnit(hass, st, "cm") === "cm" ? 0.01 : 1;
  const scale = (v) => (v == null ? null : v * cm);
  const one = (type, x) => ({ type, t: tdTime(x?.time), h: scale(tdNum(x?.value)) });
  return {
    source: "norwegian",
    id,
    unit: cm === 1 ? tdUnit(hass, st) : "m",
    height: scale(tdNum(st.state)),
    trend: tdTrendOf(a.ebb_flow ?? a.tide_state),
    extremes: [one("high", a.next_tide_high), one("low", a.next_tide_low)],
  };
};

// The manual mapping: each key an entity id, or { entity, attribute }.
export const tdRead = (hass, ref) => {
  const r = typeof ref === "string" ? { entity: ref } : ref;
  const st = r?.entity ? hass.states[r.entity] : null;
  if (!st) return null;
  const v = r.attribute ? st.attributes?.[r.attribute] : st.state;
  return ["unavailable", "unknown", ""].includes(v) ? null : v;
};

export const tdFromMapping = (hass, map) => {
  const ref = typeof map.height === "string" ? map.height : map.height?.entity;
  return {
    source: "manual",
    id: ref ?? (typeof map.next_high === "string" ? map.next_high : map.next_high?.entity) ?? null,
    unit: tdUnit(hass, ref ? hass.states[ref] : null),
    height: tdNum(tdRead(hass, map.height)),
    trend: tdTrendOf(tdRead(hass, map.trend)),
    coef: tdNum(tdRead(hass, map.coefficient)),
    extremes: [
      { type: "high", t: tdTime(tdRead(hass, map.next_high)), h: tdNum(tdRead(hass, map.next_high_height)) },
      { type: "low", t: tdTime(tdRead(hass, map.next_low)), h: tdNum(tdRead(hass, map.next_low_height)) },
    ],
  };
};

// ── Model ────────────────────────────────────────────────────────────────────
// What the card draws, at `now`: { source, id, name, unit, height, trend, coef, next, extremes (known, sorted),
// day (the high and low waters to show), curve (today, 0 h to 24 h), measured, coefs (the coming days) }; null when
// nothing is known.
export const tdModel = (hass, config, ws, now) => {
  const id = config.entity;
  const st = id ? hass.states[id] : null;
  const unavailable = !st || ["unavailable", "unknown"].includes(st.state);
  let src = config.source && TD_SOURCES.includes(config.source) ? config.source : id ? tdSourceOf(hass, id) : null;
  if (!src && config.mapping) src = "manual";
  let raw = null;
  if (src === "manual") raw = tdFromMapping(hass, config.mapping || {});
  else if (src && !unavailable) {
    raw = {
      marees_france: () => tdFromMf(hass, id, ws),
      noaa: () => tdFromNoaa(hass, id, now),
      noaa_fork: () => tdFromNoaaFork(hass, id, now),
      worldtides: () => tdFromWorldTides(hass, id),
      ukho: () => tdFromUkho(hass, id),
      norwegian: () => tdFromNorwegian(hass, id),
    }[src]();
  }
  if (!raw) return null;
  const extremes = tdOrder(raw.extremes);
  const start = tdMidnight(now);
  const end = start + TD_DAY;
  const measured = (raw.levels || []).filter(([t]) => t >= start - 3600000 && t <= end + 3600000);
  const curve = measured.length > 12 ? measured : tdCurve(extremes, start, end);
  if (!extremes.length && !curve.length && raw.height == null) return null;
  const height = raw.height ?? tdAt(curve, now);
  const next = extremes.find((e) => e.t > now) ?? null;
  const trend = raw.trend ?? (next ? (next.type === "high" ? "rising" : "falling") : null);
  // The day's high and low waters, then the next ones, up to four: only those the integration gives (the curve
  // carries on past them, the tiles do not).
  const day = [...extremes.filter((e) => e.t >= start && e.t < end), ...extremes.filter((e) => e.t >= end)].slice(0, 4);
  const coefs = (raw.coefs || []).filter((c) => c.day >= start).sort((a, b) => a.day - b.day).slice(0, 7);
  const coef = raw.coef ?? next?.coef ?? coefs[0]?.coef ?? null;
  return { source: src, id: raw.id, device: raw.device ?? null, name: raw.name ?? null, unit: raw.unit, height, trend, coef, next, extremes, day, curve, measured: measured.length > 12, coefs };
};

// The Intl formats, made once per language and options (a render formats many times and numbers).
export const tdIntlCache = new Map();
export const tdIntl = (Kind, lang, opts) => {
  const key = `${Kind.name}|${lang}|${JSON.stringify(opts)}`;
  if (!tdIntlCache.has(key)) tdIntlCache.set(key, new Kind(lang, opts));
  return tdIntlCache.get(key);
};
