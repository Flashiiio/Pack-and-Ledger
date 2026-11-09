import { registerSetting } from "./base-settings.js";
import { logError, purgeOldLogs } from "../../debug/logger.js";

/* Tab "General" */
Hooks.once("init", () => {
  registerSetting("gmBypass", { type: Boolean, default: false });
  registerSetting("fileLog", { type: Boolean, default: true });
  registerSetting("logRetentionDays", {
    type: Number,
    default: 0,
    onChange: () => purgeOldLogs().catch(err => logError("Could not empty old log files", err))
  });
  registerSetting("notifyLevel", {
    type: String,
    default: "important",
    choices: {
      important: "PACK_LEDGER.Settings.notifyLevel.Important",
      all: "PACK_LEDGER.Settings.notifyLevel.All"
    }
  });
});
