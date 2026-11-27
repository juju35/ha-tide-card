// A mock Home Assistant for the tests: the screenshots' home (a Marées France port, its websocket commands answered
// and recorded in `hass.ws`) or bare states of any other tide integration. The clock is the "rising" scene's.
import { nowOf, setup, wsData } from "../scripts/screenshots/mock.mjs";

export { nowOf };
export const NOW = nowOf("rising");
export const at = (m, d, h, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
export const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

// The screenshots' home with its Marées France websocket commands answered (and recorded).
export const mockHass = (scene = "rising") => {
  const { hass } = setup({ scene });
  const ws = wsData(nowOf(scene));
  hass.ws = [];
  hass.callWS = async (msg) => {
    hass.ws.push(msg);
    return { "marees_france/get_tides_data": ws.tides, "marees_france/get_water_levels": ws.levels, "marees_france/get_coefficients_data": ws.coefs }[msg.type];
  };
  return hass;
};

// A bare hass holding only the given states (and entity registry entries).
export const makeHass = (states, entities = {}) => ({ entities, states });
