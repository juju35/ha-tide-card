import assert from "node:assert/strict";
import { test } from "node:test";
import { at, makeHass, mockHass, NOW, nowOf, st } from "./hass.mjs";
import { fakeNode, load } from "./load.mjs";

const td = load({ now: NOW });
const { cards } = td;
const json = (v) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((r) => setTimeout(r, 0));

const make = async (tag, config, hass = mockHass(), loader = td) => {
  const card = new loader.cards[tag]();
  card.attachShadow();
  const nodes = {};
  card.shadowRoot.querySelector = (s) => (nodes[s] ||= fakeNode());
  card.setConfig({ type: `custom:${tag}`, ...config });
  card.hass = hass;
  await settle();
  await settle();
  return card;
};

test("both cards are registered, with their editors and a picker entry", () => {
  for (const tag of ["tide-card", "tide-mini-card"]) {
    assert.ok(td.customElements.get(tag), tag);
    assert.ok(td.customElements.get(`${tag}-editor`), `${tag}-editor`);
  }
  assert.deepEqual(json(td.window.customCards.map((c) => c.type)), ["tide-card", "tide-mini-card"]);
  // The first tide entity of the home: the "now" sensor of a Marées France port, a NOAA station…
  assert.deepEqual(json(cards["tide-card"].getStubConfig(mockHass())), { entity: "sensor.saint_malo_now_tide" });
  assert.deepEqual(json(cards["tide-card"].getStubConfig({ states: {} })), {});
});

test("numbers, times and clock times from every integration's formats", () => {
  assert.equal(td.tdNum("8.2m"), 8.2);
  assert.equal(td.tdNum("1,8 m"), 1.8);
  assert.equal(td.tdNum("---"), null);
  assert.equal(td.tdTime("2026-11-26T19:05+0000"), Date.UTC(2026, 10, 26, 19, 5));
  assert.equal(td.tdTime("2026-11-26 19:05:00"), at(11, 26, 19, 5));
  assert.equal(td.tdTime(1795000000), 1795000000000);
  assert.equal(td.tdClock("7:05 PM", NOW, 1), at(11, 26, 19, 5));
  assert.equal(td.tdClock("1:20 AM", NOW, -1), at(11, 26, 1, 20));
  assert.equal(td.tdClock("4:00 PM", NOW, 1), at(11, 27, 16, 0), "a time already past today: tomorrow");
  assert.equal(td.tdTrendOf("rising"), "rising");
  assert.equal(td.tdTrendOf("Falling"), "falling");
  assert.equal(td.tdTrendOf("ebb"), "falling");
  assert.equal(td.tdTrendOf("whatever"), null);
});

test("each integration is recognised from its platform or its attributes", () => {
  const hass = makeHass({
    "sensor.port": st("sensor.port", "rising"),
    "sensor.noaa": st("sensor.noaa", "High tide at 7:05 PM", { high_tide_time: "2026-11-27T07:20", low_tide_time: "2026-11-27T01:58" }),
    "sensor.fork": st("sensor.fork", "High tide at 7:05 PM", { next_tide_type: "High", next_tide_time: "7:05 PM" }),
    "sensor.wt": st("sensor.wt", "High tide at 07:05 PM", { high_tide_time_utc: "2026-11-26T18:05+0000" }),
    "sensor.ukho": st("sensor.ukho", "Rising", { predictions: [], next_high_tide_at: "2026-11-26T19:05:00+01:00" }),
    "sensor.no": st("sensor.no", "250", { next_tide_high: {}, next_tide_low: {} }),
    "sensor.other": st("sensor.other", "12"),
  }, { "sensor.port": { platform: "marees_france" } });
  const got = Object.fromEntries(Object.keys(hass.states).map((id) => [id, td.tdSourceOf(hass, id)]));
  assert.deepEqual(json(got), {
    "sensor.port": "marees_france",
    "sensor.noaa": "noaa",
    "sensor.fork": "noaa_fork",
    "sensor.wt": "worldtides",
    "sensor.ukho": "ukho",
    "sensor.no": "norwegian",
    "sensor.other": null,
  });
});

test("Marées France: tides of several days, the measured levels and the week's coefficients", async () => {
  const hass = mockHass();
  const card = await make("tide-card", { entity: "sensor.saint_malo_now_tide" }, hass);
  assert.deepEqual(
    hass.ws.map((m) => m.type),
    ["marees_france/get_tides_data", "marees_france/get_water_levels", "marees_france/get_coefficients_data"],
  );
  assert.ok(hass.ws.every((m) => m.device_id === "port"));
  assert.equal(hass.ws[1].date, "2026-11-26");
  const m = card._items.m;
  assert.equal(m.source, "marees_france");
  assert.equal(m.name, "Saint-Malo");
  assert.equal(m.trend, "rising");
  assert.equal(m.coef, 98);
  assert.equal(m.measured, true);
  assert.deepEqual(json(m.next), { type: "high", t: at(11, 26, 19, 5), h: 12.1, coef: 98 });
  assert.deepEqual(json(m.day.map((e) => [e.type, e.t])), [
    ["low", at(11, 26, 1, 20)],
    ["high", at(11, 26, 6, 42)],
    ["low", at(11, 26, 12, 58)],
    ["high", at(11, 26, 19, 5)],
  ]);
  assert.deepEqual(json(m.coefs.map((c) => c.coef)), [98, 102, 104, 101, 94, 85, 74]);
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /Saint-Malo/);
  assert.match(html, /Coef\. 98/);
  assert.match(html, /Rising · high water in 2 h 14 min/);
  assert.match(html, /HW · next/);
  assert.match(html, /Spring tide Fri · coef\. 102/);
  assert.equal((html.match(/class="cb(?: sp)?"/g) || []).length, 7);
  assert.doesNotMatch(html, /Curve drawn/, "a measured curve");
  assert.match(html, /lvl-rising/);
});

test("a spring tide (coefficient 100 and more) colours the card amber", async () => {
  const loader = load({ now: nowOf("spring") });
  const card = await make("tide-card", { entity: "sensor.saint_malo_now_tide" }, mockHass("spring"), loader);
  assert.equal(card._items.level, "spring");
  assert.equal(card._items.m.trend, "falling");
  assert.match(card.shadowRoot.innerHTML, /lvl-spring/);
  assert.match(card.shadowRoot.innerHTML, /Falling · low water in 3 h 10 min/);
});

test("NOAA Tides: the next tide from the state, the two after it from the attributes, the curve drawn between them", async () => {
  const card = await make("tide-card", { entity: "sensor.harbor_tides", title: "Harbor" });
  const m = card._items.m;
  assert.equal(m.source, "noaa");
  assert.deepEqual(json(m.extremes.map((e) => [e.type, e.t])), [
    ["high", at(11, 26, 19, 5)],
    ["low", at(11, 27, 1, 58)],
    ["high", at(11, 27, 7, 20)],
  ]);
  assert.equal(m.next.h, m.extremes[2].h, "the next tide's height: the one of the next tide of its type");
  assert.equal(m.trend, "rising");
  assert.equal(m.measured, false);
  assert.equal(m.coef, null);
  assert.equal(m.curve.length, 145, "every 10 min from 0 h to 24 h");
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /Curve drawn between the high and low waters/);
  assert.doesNotMatch(html, /class="bpill"/, "no coefficient, no pill");
  assert.doesNotMatch(html, /class="coefs"/);
});

test("the drawn curve goes through every high and low water and stays between them", () => {
  const ext = [
    { type: "low", t: at(11, 26, 1, 20), h: 2 },
    { type: "high", t: at(11, 26, 6, 42), h: 12 },
    { type: "low", t: at(11, 26, 12, 58), h: 1.8 },
  ];
  const curve = td.tdCurve(ext, at(11, 26, 0), at(11, 27, 0), 60000);
  for (const e of ext) assert.ok(Math.abs(td.tdAt(curve, e.t) - e.h) < 0.01, `${e.type} at ${new Date(e.t).toTimeString()}`);
  const hs = curve.map((p) => p[1]);
  assert.ok(Math.min(...hs) >= 1.8 - 1e-9 && Math.max(...hs) <= 12 + 1e-9);
  assert.equal(td.tdAt(curve, at(11, 28, 0)), null, "outside the curve");
});

test("World Tides, UKHO Tides, Norwegian Tide and the NOAA fork", () => {
  const hass = makeHass({
    wt: st("wt", "High tide at 07:05 PM", { high_tide_time_utc: "2026-11-26T18:05+0000", high_tide_height: 4.2, low_tide_time_utc: "2026-11-27T00:20+0000", low_tide_height: -0.3, current_height: 3.1, "Unit displayed": "metric" }),
    ukho: st("ukho", "Rising", { predictions: [["2026-11-26 12:00:00", 1.1], ["2026-11-26 18:10:00", 5.4], ["2026-11-27 00:25:00", 1.0]] }),
    no: st("no", "180", { unit_of_measurement: "cm", ebb_flow: "flow", next_tide_high: { time: "2026-11-26T19:30:00+01:00", value: "260" }, next_tide_low: { time: "2026-11-27T01:40:00+01:00", value: "40" } }),
    fork: st("fork", "High tide at 7:05 PM", { next_tide_type: "High", next_tide_time: "7:05 PM", next_tide_level: 4.9, following_tide_type: "Low", following_tide_time: "1:58 AM", following_tide_level: 0.4, last_tide_type: "Low", last_tide_time: "12:58 PM", last_tide_level: 0.3 }),
  });
  const wt = td.tdModel(hass, { entity: "wt" }, null, NOW);
  assert.deepEqual([wt.source, wt.height, wt.unit, wt.next.type, wt.next.t], ["worldtides", 3.1, "m", "high", Date.UTC(2026, 10, 26, 18, 5)]);
  const uk = td.tdModel(hass, { entity: "ukho" }, null, NOW);
  assert.deepEqual(json(uk.extremes.map((e) => e.type)), ["low", "high", "low"]);
  assert.equal(uk.trend, "rising");
  const no = td.tdModel(hass, { entity: "no" }, null, NOW);
  assert.deepEqual([no.source, no.unit, no.height, no.next.h, no.trend], ["norwegian", "m", 1.8, 2.6, "rising"]);
  const fork = td.tdModel(hass, { entity: "fork" }, null, NOW);
  assert.deepEqual(json(fork.extremes.map((e) => [e.type, e.t, e.h])), [
    ["low", at(11, 26, 12, 58), 0.3],
    ["high", at(11, 26, 19, 5), 4.9],
    ["low", at(11, 27, 1, 58), 0.4],
  ]);
});

test("the manual mapping: entities or attributes, for anything else (a Stormglass template, say)", () => {
  const hass = makeHass({
    "sensor.level": st("sensor.level", "2.4", { unit_of_measurement: "m" }),
    "sensor.next_high": st("sensor.next_high", "2026-11-26T19:05:00+01:00", { height: 4.4 }),
    "sensor.next_low": st("sensor.next_low", "2026-11-27T01:58:00+01:00", { height: 0.6 }),
  });
  const mapping = {
    height: "sensor.level",
    next_high: "sensor.next_high",
    next_high_height: { entity: "sensor.next_high", attribute: "height" },
    next_low: "sensor.next_low",
    next_low_height: { entity: "sensor.next_low", attribute: "height" },
  };
  const m = td.tdModel(hass, { mapping }, null, NOW);
  assert.deepEqual([m.source, m.height, m.trend, m.next.h, m.extremes.length], ["manual", 2.4, "rising", 4.4, 2]);
  assert.equal(td.tdModel(hass, {}, null, NOW), null, "nothing configured");
});

test("an unavailable sensor: the card says there is no tide data", async () => {
  const card = await make("tide-card", { entity: "sensor.harbor_tides" }, mockHass("none"));
  assert.equal(card._items.m, null);
  assert.equal(card._items.level, "none");
  assert.match(card.shadowRoot.innerHTML, /No tide data: choose a tide entity/);
});

test("options hide the curve, the tiles and the coefficients; no illustration gives the classic header", async () => {
  const card = await make("tide-card", { entity: "sensor.saint_malo_now_tide", show_curve: false, show_extremes: false, show_coefficients: false, illustration: false });
  const html = card.shadowRoot.innerHTML;
  assert.doesNotMatch(html, /class="curve"|class="exs"|class="coefs"|class="banner/);
  assert.match(html, /class="pill"/);
});

test("mini card: the next high water and when on one line, the coefficient as status", async () => {
  const card = await make("tide-mini-card", { entity: "sensor.saint_malo_now_tide" });
  const html = card.shadowRoot.innerHTML;
  assert.match(html, /HW 7:05 PM · 12\.1 m · 2 h 14 min/, "English defaults to a 12-hour clock");
  assert.match(html, /Coef\. 98/);
  assert.match(html, /class="lvl-rising bn/);
  assert.equal(card.getCardSize(), 1);
});

test("the Marées France data is asked for again on the refresh timer", async () => {
  const hass = mockHass();
  const card = await make("tide-card", { entity: "sensor.saint_malo_now_tide" }, hass);
  card.connectedCallback();
  const before = hass.ws.length;
  td.window.tick();
  await settle();
  assert.equal(hass.ws.length, before + 3);
  card.disconnectedCallback();
});

test("editor: the entity, the options and the manual mapping in the advanced part", () => {
  const ed = new (td.customElements.get("tide-card-editor"))();
  ed.setConfig({ type: "custom:tide-card" });
  ed.hass = mockHass();
  const names = [];
  const walk = (list) => {
    for (const s of list) {
      if (s.schema) walk(s.schema);
      else names.push(s.name);
    }
  };
  walk(ed._form.schema);
  assert.deepEqual(json(names), ["title", "navigation_path", "entity", "show_title", "show_subtitle", "illustration", "animations", "show_curve", "show_extremes", "show_coefficients", "illustration_theme", "mapping", "language"]);
  const mini = new (td.customElements.get("tide-mini-card-editor"))();
  mini.setConfig({ type: "custom:tide-mini-card" });
  mini.hass = mockHass();
  assert.ok(JSON.stringify(mini._form.schema).includes('"zoom"'));
});

test("every language has every key of the English table", () => {
  const en = Object.keys(td.TD_I18N.en).sort();
  for (const [lang, table] of Object.entries(td.TD_I18N)) assert.deepEqual(Object.keys(table).sort(), en, lang);
});

test("12-hour clocks drop the leading zero, 24-hour clocks keep it", async () => {
  const twelve = await make("tide-card", { entity: "sensor.saint_malo_now_tide" }, { ...mockHass(), locale: { language: "en", time_format: "12" } });
  assert.equal(twelve._clock(at(11, 27, 7, 20)), "7:20 AM");
  assert.equal(twelve._clock(at(11, 27, 19, 44)), "7:44 PM");
  const day = await make("tide-card", { entity: "sensor.saint_malo_now_tide" }, { ...mockHass(), locale: { language: "en", time_format: "24" } });
  assert.equal(day._clock(at(11, 27, 7, 20)), "07:20");
});
