// Renders the tide cards with the mock port and station and saves the README screenshots.
// Usage: npm install && npm run build && node scripts/screenshots/tide.mjs
// Captures (each with its -dark twin): td-rising, td-spring, td-noaa, td-none, td-narrow, td-mini-rising, td-mini-zoom,
// td-mini-spring.
import { pair, shoot } from "./harness.mjs";
import { pageScript, setup } from "./mock.mjs";

// Stills: animations: false stops the waves and the lighthouse, so a capture only changes when the card does.
const still = (file, s) => pair(file, { ...s, config: { animations: false, ...s.config } });
for (const scene of ["rising", "spring", "noaa", "none"]) {
  await shoot({ prefix: "td", tag: "tide-card", shots: still(scene, { scene }), setup, ws: pageScript(scene) });
}
await shoot({ prefix: "td", tag: "tide-card", shots: still("narrow", { scene: "rising", width: 300 }), setup, ws: pageScript("rising") });
await shoot({ prefix: "td-mini", tag: "tide-mini-card", shots: [...still("rising", { scene: "rising" }), ...still("zoom", { scene: "rising", open: ".zoom" })], setup, ws: pageScript("rising") });
await shoot({ prefix: "td-mini", tag: "tide-mini-card", shots: still("spring", { scene: "spring" }), setup, ws: pageScript("spring") });
