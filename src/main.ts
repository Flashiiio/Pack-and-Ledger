import { MODULE_ID } from "./core/constants.js";

// ── 0. Banner ──
Hooks.once("init", () => {
  const mod = game.modules.get(MODULE_ID);
  const title = (mod?.title ?? "Pack & Ledger").split("–")[0].trim().toUpperCase();
  const version = mod?.version ?? "unknown";

  console.log(`%c${title}`, [
    "color:#c9a227", "font-size:40px", "font-weight:900",
    "letter-spacing:2px", "text-shadow:6px 6px 0 rgba(0,0,0,0.55)"
  ].join(";"));

  console.log(`%cv${version} | Loaded`, [
    "color:#c9a227", "font-size:14px", "font-weight:700",
    "text-shadow:2px 2px 0 rgba(0,0,0,0.55)"
  ].join(";"));
});

// ── 1. Debug ──
import "./debug/logger.js";

// ── 2. Settings ──
import "./core/settings/base-settings.js";
import "./core/settings/general-settings.js";
import "./core/settings/container-settings.js";
import "./core/settings/slot-settings.js";
import "./core/settings/detection-settings.js";
import "./core/settings/map-settings.js";
import "./core/settings/bodyweight-settings.js";
import "./core/settings/currency-settings.js";
import "./core/settings/tracker-settings.js";
import "./core/settings/provision-settings.js";

// ── 3. Socket (GM requests, notifications) ──
import "./core/socket.js";

// ── 4. Features ──
import "./feature/activity-log.js";
import "./feature/body-weight.js";
import "./feature/enforcement.js";
import "./feature/container-tear.js";
import "./feature/piles/index.js";
import "./feature/trade/index.js";
import "./feature/currency/index.js";
import "./feature/tracker/index.js";
import "./feature/provisions/index.js";

// ── 5. UI ──
import "./ui/actor-sheet.js";
import "./ui/log-tab.js";

// ── 6. API ──
import "./api.js";
