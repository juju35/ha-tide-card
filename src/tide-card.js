/**
 * tide-card / tide-mini-card: the tides of a port from an existing tide integration (Marées France, NOAA Tides, World
 * Tides, UKHO Tides, Norwegian Tide, or a manual mapping): the curve of the day with the time and height now, the high
 * and low waters, the coefficients of the coming days, and a sea in the header that rises and falls with the tide.
 * https://github.com/juju35/ha-tide-card
 */

// Colour of each state: rising, falling, a spring tide (coefficient of 100 or more), nothing known; the badge's icon
// follows the trend (a spring tide keeps its arrow, in amber).
const TD_COLORS = { rising: "#0c8599", falling: "#1c7ed6", spring: "#e67700", none: "#868e96" };
const TD_ICONS = { rising: "mdi:arrow-up-bold", falling: "mdi:arrow-down-bold", none: "mdi:waves" };
// A coefficient from which the tide is a spring tide (« grande marée »).
const TD_SPRING = 100;
// One loop of the header's animations (s): the waves drift by one wave, the lighthouse turns once.
const TD_LOOP = 4;
// How often Marées France is asked again for its data (ms), and at each new day.
const TD_REFRESH = 30 * 60 * 1000;

// ── Banner ───────────────────────────────────────────────────────────────────
// The sea across the whole banner (two layers of waves drifting apart), its level from `level` (0 the day's lowest
// water, 1 its highest): 1000 × 80, stretched to the banner's width.
const tdSea = ({ night, level, animate }) => {
  const top = Math.round(72 - Math.max(0, Math.min(1, level)) * 30);
  const wave = (y, amp, len) => {
    let d = `M-${len} ${y}`;
    for (let x = -len; x < 1000 + len; x += len) d += ` q${len / 4} -${amp} ${len / 2} 0 t${len / 2} 0`;
    return `${d} V80 H-${len}Z`;
  };
  const drift = (len, dur, back) =>
    animate ? `<animateTransform attributeName="transform" type="translate" values="0 0;${back ? len : -len} 0" dur="${dur}s" repeatCount="indefinite"/>` : "";
  const [far, near] = night ? ["#1f5f78", "#17485e"] : ["#7fc6cf", "#3fa9b6"];
  return `<g opacity=".55"><path d="${wave(top - 4, 4, 80)}" fill="${far}">${drift(80, TD_LOOP, true)}</path></g>
    <g opacity=".6"><path d="${wave(top + 2, 5, 100)}" fill="${near}">${drift(100, TD_LOOP, false)}</path></g>`;
};

// The lighthouse on its rock at the banner's right (120 × 80): by night (the dark theme) its light shines and sweeps.
const tdLighthouse = ({ night, animate }) => {
  const beam = night
    ? `<g opacity=".55"><path d="M73 18 L118 8 L118 28 Z" fill="#ffe8a3">${animate ? `<animate attributeName="opacity" values="1;.15;1" dur="${TD_LOOP}s" repeatCount="indefinite"/>` : ""}</path></g>`
    : "";
  return `${tdSky(night)}<path d="M44 80 Q52 60 66 62 Q84 58 96 80Z" fill="${night ? "#3a4148" : "#8d8476"}"/>
    ${beam}
    <path d="M62 64 L65 22 L77 22 L80 64Z" fill="${night ? "#d9dde2" : "#ffffff"}" stroke="${night ? "#7d8a96" : "#9fcfd5"}" stroke-width="1.5"/>
    <path d="M63.5 46 L78.5 46 L79 54 L63 54Z M64.5 30 L77.5 30 L78 37 L64 37Z" fill="#e03131" opacity=".75"/>
    <rect x="63" y="15" width="16" height="8" rx="1" fill="${night ? "#ffe8a3" : "#dbe4ea"}" stroke="${night ? "#7d8a96" : "#9fcfd5"}"/>
    <path d="M61 15 L71 8 L81 15Z" fill="${night ? "#7d8a96" : "#9fcfd5"}"/>`;
};

// The sky beside the lighthouse: the sun by day, the moon and a few stars by night.
const tdSky = (night) =>
  night
    ? `<circle cx="24" cy="18" r="7" fill="#f1f3f5" opacity=".85"/><circle cx="27.5" cy="15.5" r="6" fill="#17242f"/>
       <g fill="#fff" opacity=".7"><circle cx="8" cy="9" r=".9"/><circle cx="44" cy="7" r=".8"/><circle cx="100" cy="6" r=".9"/></g>`
    : `<circle cx="24" cy="18" r="8" fill="#ffd27a"/><circle cx="24" cy="18" r="12" fill="#ffd27a" opacity=".25"/>`;

// The status pill's place, decided by measurement after each render and each new width (the same rule on every
// card): on the title row, right after the title, only when the whole title and the pill's whole label fit there;
// otherwise on its own line under the subtitle (clamped to one line). When the label is still cut there, or the text
// block leaves the banner or runs over its ground strip, the pill keeps its dot alone, on the title row (its label
// stays in title and aria-label). A card of 200 px or less shows the dot alone anyway (CSS), beside the title.
const tdPlacePill = (head, row, ground) => {
  if (!head) return;
  head.removeAttribute("data-wrap");
  head.removeAttribute("data-dot");
  const pill = row.querySelector(":scope > .bpill, :scope > .pill");
  const text = pill?.querySelector(".bpt, .pt");
  if (!text?.getBoundingClientRect || text.getBoundingClientRect().width <= 1) return;
  const name = row.querySelector(".title");
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const title = name ? (name.scrollWidth > name.clientWidth ? name.scrollWidth : name.getBoundingClientRect().width) + gap : 0;
  if (title + pill.getBoundingClientRect().width <= row.getBoundingClientRect().width + 0.5) return;
  head.setAttribute("data-wrap", "");
  const box = row.parentElement.getBoundingClientRect();
  const frame = head.getBoundingClientRect();
  const out = ground && (box.bottom > ground.getBoundingClientRect().top + 0.5 || box.top < frame.top - 0.5);
  if (text.scrollWidth > text.clientWidth + 0.5 || out) {
    head.removeAttribute("data-wrap");
    head.setAttribute("data-dot", "");
  }
};

// ── Card ─────────────────────────────────────────────────────────────────────
class TideCard extends RcCard {
  static tag = "tide-card";
  static i18n = TD_I18N;
  static defaults = { illustration: true, illustration_theme: "auto", show_subtitle: true, animations: true, show_curve: true, show_extremes: true, show_coefficients: true };

  // The first tide entity of the home, when there is one.
  static getStubConfig(hass) {
    const entity = hass ? tdCandidates(hass)[0] : undefined;
    return entity ? { entity } : {};
  }

  getCardSize() {
    return 6;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._timer ??= setInterval(() => {
      this._ws = null;
      this._sig = null;
      this._render();
    }, TD_REFRESH);
    // A new width: the status pill is fitted again (in the next frame, and only for a new width).
    if (typeof ResizeObserver !== "function") return;
    this._resize ??= new ResizeObserver((entries) => {
      const w = Math.round(entries.at(-1).contentRect.width);
      if (w === this._fitWidth) return;
      this._fitWidth = w;
      cancelAnimationFrame(this._fitFrame);
      this._fitFrame = requestAnimationFrame(() => this._fitPill());
    });
    this._resize.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    clearInterval(this._timer);
    this._timer = undefined;
    this._resize?.disconnect();
    this._fitWidth = undefined;
    if (this._fitFrame) cancelAnimationFrame(this._fitFrame);
  }

  // Marées France keeps the tides of several days, the measured water levels and the coefficients behind websocket
  // commands: asked for at first, every TD_REFRESH and at each new day.
  async _fetchMf(device) {
    const h = this._hass;
    if (!h?.callWS || !device || this._busy) return;
    this._busy = true;
    const now = Date.now();
    const today = tdDayKey(now);
    const ask = (type, extra = {}) => Promise.resolve(h.callWS({ type, device_id: device, ...extra })).catch(() => null);
    try {
      const [tides, levels, coefs] = await Promise.all([
        ask("marees_france/get_tides_data"),
        ask("marees_france/get_water_levels", { date: today }),
        ask("marees_france/get_coefficients_data", { date: today, days: 7 }),
      ]);
      this._ws = { device, day: today, tides: tides || {}, levels: levels || {}, coefs: coefs || {} };
    } finally {
      this._busy = false;
    }
    this._sig = null;
    this._render();
  }

  _collect() {
    const h = this._hass;
    const c = this._config;
    const now = Date.now();
    let m = tdModel(h, c, this._ws, now);
    if (m?.source === "marees_france" && m.device && (!this._ws || this._ws.device !== m.device || this._ws.day !== tdDayKey(now))) this._fetchMf(m.device);
    if (m && !m.curve.length && m.height == null) m = null;
    const level = !m ? "none" : m.coef >= TD_SPRING ? "spring" : m.trend || "none";
    // The title: the config's, else the port's name (Marées France names its device after the port), else "Tides".
    return { m, now, level, name: c.title || m?.name || this._t("title") };
  }

  _night() {
    const theme = this._config.illustration_theme;
    if (theme === "night" || theme === "day") return theme === "night";
    return this._dark();
  }

  _dark() {
    return !!this._hass.themes?.darkMode;
  }

  _animate() {
    if (this._config.animations === false) return false;
    try {
      return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return true;
    }
  }

  // 16:51 in the language's and the user's time format.
  _clock(t) {
    const tf = this._hass.locale?.time_format;
    const opts = { hour: "2-digit", minute: "2-digit", ...(tf === "12" ? { hour12: true } : tf === "24" ? { hour12: false } : {}) };
    try {
      return tdIntl(Intl.DateTimeFormat, this._lang(), opts).format(new Date(t));
    } catch {
      return new Date(t).toTimeString().slice(0, 5);
    }
  }

  _weekday(t) {
    try {
      return tdIntl(Intl.DateTimeFormat, this._lang(), { weekday: "short" }).format(new Date(t)).replace(".", "");
    } catch {
      return "";
    }
  }

  // A height with its unit: "9.4 m", "6.1 ft".
  _height(h, unit) {
    if (h == null) return "";
    const u = unit === "cm" ? "m" : unit || "m";
    const v = unit === "cm" ? h / 100 : h;
    try {
      return `${tdIntl(Intl.NumberFormat, this._lang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} ${u}`;
    } catch {
      return `${v.toFixed(1)} ${u}`;
    }
  }

  // "2 h 14 min", "38 min".
  _dur(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? this._t("dur_hm", { h, m: String(m).padStart(2, "0") }) : this._t("dur_m", { m });
  }

  // "Rising · high water in 2 h 14 min".
  _sub(d) {
    const m = d.m;
    if (!m || this._config.show_subtitle === false) return "";
    const trend = m.trend ? this._t(`st_${m.trend}`) : "";
    const text = m.next ? this._t("sub_next", { trend, type: this._t(m.next.type === "high" ? "hw_l" : "lw_l"), dur: this._dur(m.next.t - d.now) }) : trend;
    return text ? `<div class="subt">${rcEsc(text.replace(/^ · /, ""))}</div>` : "";
  }

  // Where the sea stands in the header: the height now between the day's lowest and highest waters.
  _level(m) {
    if (!m?.curve.length) return 0.5;
    const hs = m.curve.map((p) => p[1]);
    const lo = Math.min(...hs);
    const hi = Math.max(...hs);
    const h = m.height ?? (lo + hi) / 2;
    return hi > lo ? (h - lo) / (hi - lo) : 0.5;
  }

  // The illustrated header: the badge, the title, `sub` and the pill on the left, the sea across, the lighthouse at
  // the right, a sand strip edge to edge.
  _banner(d, sub, pill = "") {
    const c = this._config;
    const nav = c.navigation_path;
    const night = this._night();
    const animate = this._animate();
    const chip = pill ? `<span class="bpill" title="${rcEsc(pill)}" aria-label="${rcEsc(pill)}"><span class="bdot"></span><span class="bpt">${rcEsc(pill)}</span></span>` : "";
    return `
      <div class="banner${night ? " night" : ""}">
        <svg class="sea" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">${tdSea({ night, level: this._level(d.m), animate })}</svg>
        <div class="head${nav ? " nav" : ""}"${nav ? ' role="link" tabindex="0"' : ""}>
          <div class="badge"><ha-icon icon="${TD_ICONS[d.m?.trend || "none"]}"></ha-icon></div>
          <div class="tt"><div class="trow"><div class="title">${rcEsc(d.name)}</div>${chip}</div>${sub}</div>
        </div>
        <svg class="room" viewBox="0 0 120 80" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">${tdLighthouse({ night, animate })}</svg>
        <div class="ground"></div>
      </div>`;
  }

  // The status pill's place, on the banner and on the classic header (see tdPlacePill).
  _fitPill() {
    for (const row of this.shadowRoot?.querySelectorAll?.(".trow") || []) {
      const banner = row.closest(".banner");
      tdPlacePill(banner || row.closest(".head"), row, banner?.querySelector(".ground"));
    }
  }

  _coefText(m) {
    return m?.coef != null ? this._t("coef", { n: m.coef }) : "";
  }

  // The curve of the day (0 h to 24 h): the water drawn as an area, "now" as a dashed line and a dot with the time
  // and height; the hours under it.
  _curve(d) {
    const m = d.m;
    const pts = m.curve;
    if (pts.length < 2) return "";
    const start = tdMidnight(d.now);
    const hs = pts.map((p) => p[1]);
    const lo = Math.min(...hs);
    const hi = Math.max(...hs);
    const span = hi - lo || 1;
    const x = (t) => ((t - start) / TD_DAY) * 1000;
    const y = (h) => 92 - ((h - lo) / span) * 80;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.at(-1)[0]).toFixed(1)} 100 L${x(pts[0][0]).toFixed(1)} 100Z`;
    const nx = Math.max(0, Math.min(100, ((d.now - start) / TD_DAY) * 100));
    const hNow = m.height ?? tdAt(pts, d.now);
    const ny = hNow == null ? null : (y(hNow) / 100) * 100;
    const label = [this._clock(d.now), this._height(hNow, m.unit)].filter(Boolean).join(" · ");
    const hours = [0, 6, 12, 18].map((hr) => `<span style="left:${(hr / 24) * 100}%">${rcEsc(this._clock(start + hr * 3600000))}</span>`).join("");
    return `<div class="curve">
        <div class="plot">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <path class="grid" d="M0 12H1000M0 52H1000M0 92H1000"/>
            <path class="area" d="${area}"/><path class="line" d="${line}"/>
            <path class="nowl" d="M${(nx * 10).toFixed(1)} 0V100"/>
          </svg>
          ${ny == null ? "" : `<span class="dot" style="left:${nx.toFixed(2)}%;top:${ny.toFixed(2)}%"></span>`}
          <span class="nowt${nx > 70 ? " end" : nx < 30 ? " start" : ""}" style="left:${nx.toFixed(2)}%">${rcEsc(label)}</span>
        </div>
        <div class="hours">${hours}</div>
        ${m.measured ? "" : `<div class="note">${rcEsc(this._t("estimated"))}</div>`}
      </div>`;
  }

  // The day's high and low waters (then the next ones), the next one outlined.
  _extremes(d) {
    const m = d.m;
    if (!m.day.length) return "";
    const tiles = m.day
      .map((e) => {
        const next = m.next && e.t === m.next.t;
        const label = `${this._t(e.type === "high" ? "hw" : "lw")}${next ? ` · ${this._t("next_tag")}` : ""}`;
        const sub = [this._height(e.h, m.unit), e.coef != null ? String(e.coef) : ""].filter(Boolean).join(" · ");
        return `<div class="ex ${e.type}${next ? " next" : ""}"><span class="el">${rcEsc(label)}</span><span class="et">${rcEsc(this._clock(e.t))}</span><span class="es">${rcEsc(sub)}</span></div>`;
      })
      .join("");
    return `<div class="exs" style="--n:${m.day.length}">${tiles}</div>`;
  }

  // The coefficients of the coming days as bars, spring tides (100 and more) in amber, and the next spring tide.
  _coefs(d) {
    const list = d.m.coefs;
    if (!list.length) return "";
    const bars = list
      .map((c) => {
        const high = Math.max(8, Math.min(100, ((c.coef - 20) / 100) * 100));
        return `<div class="cb${c.coef >= TD_SPRING ? " sp" : ""}"><span class="cn">${c.coef}</span><span class="cr"><span style="height:${high.toFixed(0)}%"></span></span><span class="cd">${rcEsc(this._weekday(c.day))}</span></div>`;
      })
      .join("");
    const spring = list.find((c) => c.coef >= TD_SPRING);
    const note = spring ? `<div class="sn">${rcEsc(this._t("spring_note", { day: this._weekday(spring.day), n: spring.coef }))}</div>` : "";
    return `<div class="coefs"><div class="ch">${rcEsc(this._t("coefs"))}</div><div class="cbs" style="--n:${list.length}">${bars}</div>${note}</div>`;
  }

  _draw(d) {
    const c = this._config;
    const dark = this._dark();
    const night = this._night();
    const minute = Math.floor(d.now / 60000);
    if (!this._changed([d.m, d.level, d.name, dark, night, minute])) return;
    const head =
      c.illustration !== false
        ? this._banner(d, this._sub(d), this._coefText(d.m))
        : `<div class="head${c.navigation_path ? " nav" : ""}"${c.navigation_path ? ' role="link" tabindex="0"' : ""}>
            <div class="badge"><ha-icon icon="${TD_ICONS[d.m?.trend || "none"]}"></ha-icon></div>
            <div class="tt"><div class="trow"><div class="title">${rcEsc(d.name)}</div>${d.m?.coef != null ? `<span class="pill"><span class="pt">${rcEsc(this._coefText(d.m))}</span></span>` : ""}</div>${this._sub(d)}</div>
          </div>`;
    const body = d.m
      ? `${c.show_curve !== false ? this._curve(d) : ""}${c.show_extremes !== false ? this._extremes(d) : ""}${c.show_coefficients !== false ? this._coefs(d) : ""}`
      : `<div class="none">${rcEsc(this._t("nothing"))}</div>`;
    this._paint(d.level, head + body, "", `${dark ? " dk" : ""}`);
    this._fitPill();
  }

  _bindAfter(root) {
    const id = this._items?.m?.id;
    if (!id) return;
    for (const el of root.querySelectorAll(".curve, .exs") || []) {
      el.classList.add("more");
      el.addEventListener("click", () => rcMoreInfo(this, id));
    }
  }

  static styles = `
    ha-card { --c: ${TD_COLORS.none}; }
    ha-card.lvl-rising { --c: ${TD_COLORS.rising}; } ha-card.lvl-falling { --c: ${TD_COLORS.falling}; }
    ha-card.lvl-spring { --c: ${TD_COLORS.spring}; } ha-card.lvl-none { --c: ${TD_COLORS.none}; }
    .tt { flex: 1 1 0; min-width: 5ch; display: flex; flex-direction: column; }
    .tt .title { flex: none; }
    .subt { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :host([hide-title]) .head .tt { visibility: hidden; }
    .none { margin-top: 10px; border-radius: 12px; padding: 12px; font-size: 13px; color: var(--secondary-text-color);
            background: var(--secondary-background-color, rgba(127,127,127,.08)); }
    .more { cursor: pointer; }
    /* The curve of the day. */
    .curve { margin-top: 12px; }
    .plot { position: relative; height: 120px; margin-top: 18px; }
    .plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .plot .grid { stroke: var(--divider-color, rgba(127,127,127,.2)); stroke-width: 1; vector-effect: non-scaling-stroke; fill: none; }
    .plot .area { fill: color-mix(in srgb, #0c8599 16%, transparent); }
    .plot .line { fill: none; stroke: #0c8599; stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .plot .nowl { stroke: var(--primary-text-color); stroke-width: 1.2; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; opacity: .7; }
    .dot { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; box-sizing: border-box; border-radius: 50%;
           background: var(--card-background-color, #fff); border: 3px solid #0c8599; }
    .nowt { position: absolute; top: -18px; transform: translateX(-50%); font-size: 11px; font-weight: 700; white-space: nowrap;
            color: var(--primary-text-color); }
    .nowt.end { transform: translateX(-100%); } .nowt.start { transform: none; }
    .hours { position: relative; height: 14px; margin-top: 6px; font-size: 11px; color: var(--secondary-text-color); }
    .hours span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .hours span:first-child { transform: none; }
    .note { margin-top: 6px; font-size: 11px; color: var(--secondary-text-color); }
    /* The high and low waters: calm tiles, the next one outlined. */
    .exs { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .ex { min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 9px 10px; border-radius: 12px; box-sizing: border-box;
          background: var(--secondary-background-color, rgba(127,127,127,.08)); border: 1.5px solid transparent; }
    .ex.next { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--card-background-color, #fff)); }
    .el { font-size: 11.5px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ex.high .el { color: color-mix(in srgb, #0c8599 70%, var(--primary-text-color, #212121)); }
    .et { font-size: 15px; font-weight: 700; color: var(--primary-text-color); }
    .es { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ha-card.dk .ex.high .el { color: color-mix(in srgb, #0c8599 50%, #fff); }
    /* The coefficients of the coming days. */
    .coefs { margin-top: 14px; }
    .ch { font-size: 11.5px; font-weight: 600; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
    .cbs { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 6px; align-items: end; }
    .cb { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
    .cn { font-size: 11px; font-weight: 700; color: var(--primary-text-color); }
    .cr { display: flex; align-items: flex-end; width: 100%; height: 44px; }
    .cr span { display: block; width: 100%; border-radius: 5px; background: #0c8599; opacity: .8; }
    .cb.sp .cn { color: color-mix(in srgb, #e67700 75%, var(--primary-text-color, #212121)); }
    .cb.sp .cr span { background: #e67700; }
    .cd { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .sn { margin-top: 8px; font-size: 12px; font-weight: 600; color: color-mix(in srgb, #e67700 75%, var(--primary-text-color, #212121)); }
    ha-card.dk .sn, ha-card.dk .cb.sp .cn { color: color-mix(in srgb, #e67700 60%, #fff); }
    @container (max-width: 340px) {
      .exs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    /* Illustrated header (banner): 90 px, edge to edge, the title over a sea whose level follows the tide, the
       lighthouse at the right, a 10 px sand strip at the bottom. The badge's icon is in the state's colour. */
    .banner { position: relative; display: flex; height: 90px; margin: -12px -12px 0; overflow: hidden;
              background: linear-gradient(180deg, #e7f5f7 0%, #d4eef1 100%);
              --bt: #0d2a45; --bs: #2f5368; --ic: color-mix(in srgb, var(--c) 85%, #10283f); --sw: 120px; }
    .banner.night { background: linear-gradient(180deg, #142230 0%, #1b2f3f 100%); --bt: #fff; --bs: rgba(255,255,255,.8); --ic: color-mix(in srgb, var(--c) 65%, #fff); }
    .banner .sea { position: absolute; left: 0; right: 0; bottom: 10px; width: 100%; height: 80px; }
    .banner .head { position: relative; z-index: 1; flex: 1; min-width: 0; height: 80px; box-sizing: border-box;
                    padding: 0 calc(var(--sw) - 16px) 0 14px; flex-wrap: nowrap; }
    .banner .head::after { content: none; }
    .banner .badge { position: relative; color: var(--ic); background: rgba(255,255,255,.78); box-shadow: inset 0 0 0 1px rgba(13,42,69,.12); }
    .banner.night .badge { background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
    .banner .title { color: var(--bt); }
    .banner .subt { color: var(--bs); font-size: 13px; font-weight: 500; }
    .banner .room { position: absolute; right: 0; bottom: 10px; width: var(--sw); height: 80px; }
    .banner .ground { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: linear-gradient(180deg, #ead9b4, #dcc69a); }
    .banner.night .ground { background: linear-gradient(180deg, #4a4334, #3b352a); }
    /* The mini card's expand / collapse button: 24 px, frosted, 5 px from the banner's top right corner. */
    .banner .zoom { position: absolute; z-index: 2; top: 5px; right: 5px; width: 24px; height: 24px; margin: 0; color: #33506b;
                    background: rgba(255,255,255,.55); box-shadow: inset 0 0 0 1px rgba(255,255,255,.7); backdrop-filter: blur(4px); }
    .banner.night .zoom { color: #fff; background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }
    .banner .zoom:hover { background: rgba(255,255,255,.75); color: #33506b; }
    .banner.night .zoom:hover { background: rgba(255,255,255,.22); color: #fff; }
    .banner .tt { min-width: 0; flex: 1 1 auto; }
    /* Status pill right after the title (see tdPlacePill). */
    .trow { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .trow > .title { flex: 0 1 auto; min-width: 0; }
    .trow > .bpill, .trow > .pill { flex: none; max-width: none; }
    :host([hide-title]) .trow .title { visibility: hidden; }
    .head:has(.trow) { flex-wrap: nowrap; }
    .head:has(.trow)::after { content: none; }
    .bpill { display: inline-flex; align-items: center; gap: 4px; min-width: 0; box-sizing: border-box; overflow: hidden;
             white-space: nowrap; padding: 1px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; line-height: 16px;
             background: color-mix(in srgb, var(--c) 18%, rgba(255,255,255,.82)); color: color-mix(in srgb, var(--c) 45%, #0d2a45); }
    .banner.night .bpill { background: color-mix(in srgb, var(--c) 30%, rgba(8,18,38,.55)); color: color-mix(in srgb, var(--c) 35%, #ffffff); }
    .bdot { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex: none; }
    .bpt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    [data-wrap] .trow { display: contents; }
    [data-wrap] .trow > .bpill, [data-wrap] .trow > .pill { order: 9; align-self: flex-start; max-width: 100%; margin-top: 3px; }
    .banner[data-wrap] .trow > .bpill { max-width: calc(100cqw - 80px); }
    [data-wrap] .subt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    [data-dot] .bpill { padding: 0; background: none; }
    [data-dot] .bpt, [data-dot] .trow > .pill .pt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    [data-dot] .trow > .pill { padding: 0; width: 18px; height: 18px; justify-content: center; background: none; }
    [data-dot] .trow > .pill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    @container (max-width: 200px) {
      .bpill { padding: 0; background: none; }
      .bpt, .trow > .pill .pt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .trow > .pill { padding: 0; width: 18px; height: 18px; justify-content: center; background: none; }
      .trow > .pill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    }
    /* The mini card: the banner alone. */
    ha-card.bn { padding: 0; }
    ha-card.bn > .banner { margin: 0; --sw: 96px; }
    ha-card.bn > .banner .room { right: 26px; }
    /* Narrower cards: a smaller lighthouse, then none (the sea stays). */
    @container (max-width: 380px) { .banner { --sw: 92px; } }
    @container (max-width: 300px) { .banner .room { display: none; } .banner .head { padding-right: 34px; } }
    /* The mini card's second line: the next high or low water, plain text cut with an ellipsis. */
    .banner .evt { all: unset; display: block; min-width: 0; color: var(--bs); font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .banner .evt[data-id] { cursor: pointer; }
    .banner .evt:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
  `;
}

// ── Editor ───────────────────────────────────────────────────────────────────
const tdSchema = (booleans) => (lang) => [
  { name: "title", selector: { text: {} } },
  { name: "navigation_path", selector: { navigation: {} } },
  { name: "entity", selector: { entity: { domain: "sensor" } } },
  ...rcBooleans(...booleans),
  {
    name: "illustration_theme",
    selector: { select: { mode: "dropdown", options: ["auto", "day", "night"].map((value) => ({ value, label: rcT(TD_I18N, lang, `ed_theme_${value}`) })) } },
  },
  ...rcAdvanced(TD_I18N, lang, "mapping", "language"),
];

const TD_HELPERS = ["title", "entity", "zoom", "mapping", "language"];
const TD_BOOLEANS = ["show_title", "show_subtitle", "illustration", "animations", "show_curve", "show_extremes", "show_coefficients"];

const TideCardEditor = rcEditor({ card: TideCard, helpers: TD_HELPERS, schema: tdSchema(TD_BOOLEANS) });

rcRegister(TideCard, TideCardEditor, "Tide Card", "The tides of a port: the curve of the day, the high and low waters and the coefficients, under a sea that follows the tide");

// ── Mini card ────────────────────────────────────────────────────────────────
// The tide on two lines: the title and the coefficient (or the trend), then the next high or low water and when; the
// zoom button opens the full card in place.
class TideMiniCard extends rcMini(TideCard, "tide-mini-card", "") {
  getCardSize() {
    return this._zoomed ? super.getCardSize() : 1;
  }

  _drawMini(d) {
    const night = this._night();
    const dark = this._dark();
    const m = d.m;
    if (!this._changed(["mini", m, d.level, d.name, night, dark, Math.floor(d.now / 60000)])) return;
    const status = !m ? this._t("st_none") : this._coefText(m) || (m.trend ? this._t(`st_${m.trend}`) : "");
    const next = m?.next;
    const text = next
      ? `${this._t(next.type === "high" ? "hw" : "lw")} ${this._clock(next.t)} · ${this._height(next.h, m.unit)} · ${this._dur(next.t - d.now)}`
      : m
        ? this._height(m.height, m.unit)
        : this._t("nothing");
    const line = `<button class="subt evt"${m?.id ? ` data-id="${rcEsc(m.id)}"` : ""} title="${rcEsc(text)}">${rcEsc(text)}</button>`;
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${RC_BASE_STYLES}${this.constructor.styles}</style>
      <ha-card class="lvl-${d.level} bn${dark ? " dk" : ""}">${this._banner(d, line, status)}</ha-card>`;
    const root = this.shadowRoot;
    if (c.navigation_path) rcBindNav(root.querySelector(".head"), c.navigation_path);
    for (const el of root.querySelectorAll(".evt[data-id]")) el.addEventListener("click", () => rcMoreInfo(this, el.dataset.id));
    this._fitPill();
  }
}

const TideMiniCardEditor = rcEditor({ card: TideMiniCard, helpers: TD_HELPERS, schema: tdSchema([...TD_BOOLEANS, "zoom"]) });

rcRegister(TideMiniCard, TideMiniCardEditor, "Tide Mini Card", "The tide on two lines: the coefficient or the trend, the next high or low water and when, with a zoom to the full card");
