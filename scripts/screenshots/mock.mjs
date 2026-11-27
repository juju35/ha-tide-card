// The mock home of the screenshots, the animations and the browser tests: a port on Marées France (its "now" and water
// height sensors, and its websocket data: the tides of three days, the water levels of the day, the coefficients of
// the week) and a NOAA Tides station. The clock is fixed, so that a capture only changes when the card does.
const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes, last_changed: "2026-11-01T00:00:00Z" });
const at = (m, d, h, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const key = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

// The port's high and low waters, 25 to 28 November: [type, local time, height (m), coefficient].
const TIDES = [
  ["low", at(11, 25, 0, 41), 2.3, null],
  ["high", at(11, 25, 6, 4), 11.6, 92],
  ["low", at(11, 25, 12, 19), 2.1, null],
  ["high", at(11, 25, 18, 27), 11.8, 94],
  ["low", at(11, 26, 1, 20), 2.0, null],
  ["high", at(11, 26, 6, 42), 11.9, 96],
  ["low", at(11, 26, 12, 58), 1.8, null],
  ["high", at(11, 26, 19, 5), 12.1, 98],
  ["low", at(11, 27, 1, 58), 1.7, null],
  ["high", at(11, 27, 7, 20), 12.3, 102],
  ["low", at(11, 27, 13, 40), 1.4, null],
  ["high", at(11, 27, 19, 44), 12.4, 102],
  ["low", at(11, 28, 2, 35), 1.3, null],
  ["high", at(11, 28, 8, 0), 12.5, 104],
];
// The day's highest coefficient, from 26 November.
const COEFS = [98, 102, 104, 101, 94, 85, 74, 66];

// The height between two tides (half a cosine), as the integration measures it.
const heightAt = (t) => {
  for (let i = 1; i < TIDES.length; i++) {
    const [, t1, h1] = TIDES[i];
    if (t1 >= t) {
      const [, t0, h0] = TIDES[i - 1];
      return (h0 + h1) / 2 + ((h0 - h1) / 2) * Math.cos((Math.PI * (t - t0)) / (t1 - t0));
    }
  }
  return TIDES.at(-1)[2];
};

// `scene`: rising (Thursday 16:51, coefficient 98), spring (Friday 10:30, falling, a spring tide), noaa (a NOAA Tides
// station, the curve drawn between its tides), none (the sensor unavailable).
const SCENES = {
  rising: { now: at(11, 26, 16, 51), entity: "sensor.saint_malo_now_tide" },
  spring: { now: at(11, 27, 10, 30), entity: "sensor.saint_malo_now_tide" },
  noaa: { now: at(11, 26, 16, 51), entity: "sensor.harbor_tides" },
  none: { now: at(11, 26, 16, 51), entity: "sensor.harbor_tides", unavailable: true },
};

export const nowOf = (scene) => SCENES[scene].now;

// The Marées France websocket answers for the day of `now`.
export const wsData = (now) => {
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const tides = {};
  for (const [type, t, h, c] of TIDES) (tides[key(t)] ||= []).push([`tide.${type}`, hhmm(t), h.toFixed(1), c == null ? "---" : String(c)]);
  const levels = { [key(day0)]: [] };
  for (let t = day0.getTime(); t < day0.getTime() + 86400000; t += 5 * 60000) levels[key(day0)].push([`${hhmm(t)}:00`, heightAt(t).toFixed(2)]);
  const coefs = {};
  COEFS.forEach((c, i) => {
    coefs[key(at(11, 26 + i, 12))] = [String(c - 2), String(c)];
  });
  return { tides, levels, coefs };
};

// The page's clock and the card's callWS, as script source: window.Date fixed at the scene's time, window.__ws
// answering the Marées France commands.
export const pageScript = (scene) => `(() => {
  const N = ${SCENES[scene].now};
  const R = Date;
  window.Date = class extends R {
    constructor(...a) { super(...(a.length ? a : [N])); }
    static now() { return N; }
  };
  const WS = ${JSON.stringify(wsData(SCENES[scene].now))};
  window.__ws = async (msg) => ({ "marees_france/get_tides_data": WS.tides, "marees_france/get_water_levels": WS.levels, "marees_france/get_coefficients_data": WS.coefs })[msg.type] || {};
})();`;

export const states = (scene) => {
  const v = SCENES[scene];
  const now = v.now;
  const next = TIDES.find(([, t]) => t > now);
  const prev = [...TIDES].reverse().find(([, t]) => t <= now);
  const trend = next[0] === "high" ? "rising" : "falling";
  const after = TIDES.filter(([, t]) => t > now);
  const clock = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const iso = (t) => `${key(t)}T${hhmm(t)}`;
  const nextHigh = after.find(([type]) => type === "high");
  const nextLow = after.find(([type]) => type === "low");
  return {
    "sensor.saint_malo_now_tide": st("sensor.saint_malo_now_tide", trend, {
      friendly_name: "Saint-Malo Current tide",
      tide_trend: trend,
      current_height: Number(heightAt(now).toFixed(2)),
      coefficient: String(next[3] ?? after.find((e) => e[3])?.[3] ?? ""),
      starting_time: new Date(prev[1]).toISOString(),
      finished_time: new Date(next[1]).toISOString(),
      starting_height: String(prev[2]),
      finished_height: String(next[2]),
    }),
    "sensor.saint_malo_water_height": st("sensor.saint_malo_water_height", heightAt(now).toFixed(2), { unit_of_measurement: "m" }),
    "sensor.harbor_tides": v.unavailable
      ? st("sensor.harbor_tides", "unavailable", {})
      : st("sensor.harbor_tides", `${next[0] === "high" ? "High" : "Low"} tide at ${clock(next[1])}`, {
          friendly_name: "Harbor tides",
          high_tide_time: iso(after.filter(([type]) => type === "high")[next[0] === "high" ? 1 : 0][1]),
          high_tide_height: (nextHigh[2] - 7.4).toFixed(2),
          low_tide_time: iso(after.filter(([type]) => type === "low")[next[0] === "low" ? 1 : 0][1]),
          low_tide_height: (nextLow[2] - 1.2).toFixed(2),
        }),
  };
};

export const setup = (s) => {
  const v = SCENES[s.scene];
  return {
    hass: {
      language: "en",
      locale: { language: "en", time_format: "24" },
      config: { unit_system: { length: "km" } },
      entities: {
        "sensor.saint_malo_now_tide": { entity_id: "sensor.saint_malo_now_tide", platform: "marees_france", device_id: "port", translation_key: "now_tide" },
        "sensor.saint_malo_water_height": { entity_id: "sensor.saint_malo_water_height", platform: "marees_france", device_id: "port", translation_key: "water_height" },
        "sensor.harbor_tides": { entity_id: "sensor.harbor_tides", platform: "noaa_tides" },
      },
      devices: { port: { id: "port", name: "Saint-Malo" } },
      states: states(s.scene),
    },
    config: { entity: v.entity, ...(s.scene === "noaa" || s.scene === "none" ? { title: "Harbor" } : {}), ...s.config },
    open: s.open,
  };
};
