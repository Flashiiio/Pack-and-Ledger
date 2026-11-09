import { MODULE_ID, SLOTS, SLOT_WEIGHT_UNITS } from "../core/constants.js";
import { esc, loc } from "./helpers.js";
import { logError } from "../debug/logger.js";

/*
 * The module's configuration window: all world settings grouped into tabs, with switches, segmented choices,
 * slot tiles and live checks of the name patterns. Opened from the module's entry in the game settings.
 */

/** Pattern settings (regular expressions) and what a match means, in the order the module checks them. */
const PATTERNS = ["freePattern", "clothingPattern", "jugPattern", "trinketPattern"];

/**
 * Layout of the window. A field is a setting key, or an object with:
 * - requires: setting keys (or "key=value") that must be on/set for the field to apply
 * - unit:     a unit shown next to a number (an PACK_LEDGER.Config.Unit key or a literal)
 * - min/step: limits of a number input
 */
const TABS: any[] = [
  {
    id: "general",
    icon: "fa-solid fa-sliders",
    sections: [
      { fields: ["gmBypass", "notifyLevel", "fileLog", { key: "logRetentionDays", requires: ["fileLog"] }] }
    ]
  },
  {
    id: "containers",
    icon: "fa-solid fa-box-open",
    sections: [{
      fields: [
        "enforceCapacity",
        { key: "overfillMode", requires: ["enforceCapacity"] },
        { key: "overfillHardLimit", requires: ["enforceCapacity", "overfillMode=risk"], unit: "%", min: 0, step: 1 },
        { key: "tearChanceFactor", requires: ["enforceCapacity", "overfillMode=risk"], unit: "×", min: 0, step: 0.1 }
      ]
    }]
  },
  {
    id: "slots",
    icon: "fa-solid fa-person",
    sections: [
      {
        fields: [
          "enforceSlots",
          { key: "slotActorTypes", requires: ["enforceSlots"] },
          { key: "autoStow", requires: ["enforceSlots"] }
        ]
      },
      { title: "Limits", hint: "LimitsHint", slots: true, requires: ["enforceSlots"] }
    ]
  },
  {
    id: "detection",
    icon: "fa-solid fa-wand-magic-sparkles",
    sections: [
      { title: "DetectTypes", fields: ["trinketEquipmentTypes", "trinketConsumableTypes"] },
      { title: "DetectNames", fields: PATTERNS.map(key => ({ key, pattern: true })) },
      { title: "Test", hint: "TestHint", test: true }
    ]
  },
  {
    id: "map",
    icon: "fa-solid fa-map-location-dot",
    sections: [
      {
        title: "Piles",
        fields: [
          "pilesEnabled",
          { key: "pileRange", requires: ["pilesEnabled"], unit: "Squares", min: 0, step: 1 },
          { key: "pileDeleteEmpty", requires: ["pilesEnabled"] },
          { key: "pileMaskConsumables", requires: ["pilesEnabled"] }
        ]
      },
      {
        title: "Secrets",
        hint: "SecretsHint",
        requires: ["pilesEnabled"],
        fields: [
          "pilePassiveDiscovery",
          { key: "pileDiscoveryRange", unit: "Squares", min: 0, step: 1 },
          { key: "pileDiscoveryDC", unit: "DC", min: 1, step: 1 },
          { key: "pileLockDC", unit: "DC", min: 1, step: 1 }
        ]
      },
      {
        title: "Trade",
        fields: ["tradeEnabled", { key: "tradeRange", requires: ["tradeEnabled"], unit: "Squares", min: 0, step: 1 }]
      }
    ]
  },
  {
    id: "currency",
    icon: "fa-solid fa-coins",
    sections: [
      {
        title: "CoinAudit",
        fields: [
          "currencyAudit",
          { key: "currencyAuditGM", requires: ["currencyAudit"] },
          { key: "currencyAskReason", requires: ["currencyAudit"] },
          { key: "currencySuspiciousCount", requires: ["currencyAudit"], unit: "Changes", min: 0, step: 1 },
          { key: "currencySuspiciousSeconds", requires: ["currencyAudit"], unit: "Seconds", min: 0, step: 0.5 }
        ]
      },
      { title: "CoinInput", fields: ["currencyMath", "currencyAutoConvert"] },
      { title: "CoinChange", hint: "CoinChangeHint", fields: ["currencyPlatinum", "currencyElectrum"] },
      { title: "Invoices", fields: ["invoicesEnabled"] }
    ]
  },
  {
    id: "tracker",
    icon: "fa-solid fa-user-pen",
    sections: [
      {
        fields: [
          "trackerEnabled",
          { key: "trackerHideGM", requires: ["trackerEnabled"] },
          { key: "trackerAllOwned", requires: ["trackerEnabled"] },
          { key: "trackerConcentration", requires: ["trackerEnabled"] },
          { key: "trackerSpells", requires: ["trackerEnabled"] }
        ]
      },
      {
        title: "TrackerPrivate",
        requires: ["trackerEnabled"],
        fields: ["trackerPrivate", { key: "trackerPrivateFields", requires: ["trackerPrivate=false"] }]
      }
    ]
  },
  {
    id: "weight",
    icon: "fa-solid fa-weight-hanging",
    sections: [{
      fields: ["bodyWeightEnabled", { key: "bodyWeightPercent", requires: ["bodyWeightEnabled"], unit: "%", min: 0, step: 1 }]
    }]
  },
  {
    id: "provisions",
    icon: "fa-solid fa-wheat-awn",
    sections: [
      {
        fields: ["provisionsEnabled", { key: "provisionsAuto", requires: ["provisionsEnabled"] }]
      },
      {
        title: "ProvisionsNeed",
        hint: "ProvisionsNeedHint",
        requires: ["provisionsEnabled"],
        fields: [
          { key: "provisionsFoodPerDay", min: 0, step: 0.5 },
          { key: "provisionsWaterPerDay", min: 0, step: 0.5 }
        ]
      },
      {
        title: "ProvisionsNames",
        hint: "ProvisionsNamesHint",
        requires: ["provisionsEnabled"],
        fields: [{ key: "provisionsFoodPattern", pattern: true }, { key: "provisionsWaterPattern", pattern: true }]
      },
      {
        title: "ProvisionsRest",
        hint: "ProvisionsRestHint",
        requires: ["provisionsEnabled"],
        fields: [
          "restEnabled",
          { key: "restGMOnly", requires: ["restEnabled"] },
          { key: "restAdvanceTime", requires: ["restEnabled"] },
          { key: "restMealsPropose", requires: ["restEnabled"] },
          { key: "restExternalFood", requires: ["restEnabled"] },
          { key: "restExternalWater", requires: ["restEnabled"] }
        ]
      },
      {
        title: "ProvisionsExhaustion",
        hint: "ProvisionsExhaustionHint",
        requires: ["provisionsEnabled", "restEnabled"],
        fields: [
          "restExhaustion",
          { key: "restHalfWaterDC", requires: ["restExhaustion"], min: 0, step: 1 },
          { key: "restNoFoodDays", requires: ["restExhaustion"] }
        ]
      }
    ]
  }
];

const fieldOf = (f?: any) => (typeof f === "string") ? { key: f } : f;

/** Every setting the window edits. */
function allKeys() {
  const keys = new Set<any>();
  for ( const tab of TABS ) {
    for ( const section of tab.sections ) {
      for ( const f of section.fields ?? [] ) keys.add(fieldOf(f).key);
      if ( section.slots ) {
        for ( const s of Object.values(SLOTS) ) {
          keys.add(s.setting);
          if ( s.weightSetting ) keys.add(s.weightSetting);
        }
      }
    }
  }
  return [...keys];
}

const configOf = (key?: any) => game.settings.settings.get(`${MODULE_ID}.${key}`);

function unitLabel(unit?: any) {
  if ( !unit ) return "";
  return game.i18n.has(`PACK_LEDGER.Config.Unit.${unit}`) ? loc(`Config.Unit.${unit}`) : unit;
}

function validRegex(pattern?: any) {
  if ( !String(pattern ?? "").trim() ) return true;
  try { new RegExp(pattern, "i"); return true; }
  catch { return false; }
}


/**
 * A setting's hint: one paragraph, or – when it has several lines – a list, with what comes before a colon in bold
 * (e.g. the options of a choice); a line without a colon is a closing note.
 */
function hintHtml(text: string): string {
  const lines = String(text ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  if ( lines.length <= 1 ) return `<p class="hint">${esc(lines[0] ?? "")}</p>`;
  const items: string[] = [];
  const notes: string[] = [];
  for ( const line of lines ) {
    const match = /^([^:]{1,40}):\s+(.+)$/.exec(line);
    if ( match ) items.push(`<li><strong>${esc(match[1])}:</strong> ${esc(match[2])}</li>`);
    else notes.push(`<p class="hint">${esc(line)}</p>`);
  }
  return `${items.length ? `<ul class="hint hint-list">${items.join("")}</ul>` : ""}${notes.join("")}`;
}

let SettingsAppClass: any = null;

/** The configuration window class (built on first use, once the Foundry API is available). */
export function getSettingsAppClass() {
  if ( SettingsAppClass ) return SettingsAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;

  SettingsAppClass = class PackLedgerSettingsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-settings",
      classes: ["pack-ledger-settings"],
      window: { icon: "fa-solid fa-boxes-stacked", resizable: true },
      position: { width: 920, height: 740 },
      actions: {
        switchTab: PackLedgerSettingsApp.#onTab,
        reset: PackLedgerSettingsApp.#onReset,
        resetAll: PackLedgerSettingsApp.#onResetAll,
        save: PackLedgerSettingsApp.#onSave,
        cancel: PackLedgerSettingsApp.#onCancel
      }
    };

    /** The tab shown. */
    activeTab = "general";

    /** Whether anything was changed since opening. */
    dirty = false;

    get title() {
      return loc("Config.Title");
    }

    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-settings-layout";
      root.innerHTML = `
        <nav class="pack-ledger-settings-nav" aria-label="${esc(loc("Config.Title"))}">
          ${TABS.map(tab => `
            <button type="button" class="pack-ledger-settings-tab${tab.id === this.activeTab ? " active" : ""}"
                    data-action="switchTab" data-tab="${tab.id}">
              <i class="${tab.icon} fa-fw" inert></i>
              <span>${esc(loc(`Config.Tabs.${tab.id}.Name`))}</span>
            </button>`).join("")}
        </nav>
        <form class="pack-ledger-settings-body" autocomplete="off">
          ${TABS.map(tab => this.#renderTab(tab)).join("")}
        </form>
        <footer class="pack-ledger-settings-footer">
          <button type="button" class="pack-ledger-settings-reset-all" data-action="resetAll">
            <i class="fa-solid fa-arrow-rotate-left" inert></i> ${esc(loc("Config.ResetAll"))}
          </button>
          <span class="pack-ledger-settings-dirty">${esc(loc("Config.Unsaved"))}</span>
          <button type="button" data-action="cancel">${esc(loc("Config.Cancel"))}</button>
          <button type="button" class="pack-ledger-settings-save" data-action="save">
            <i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("Config.Save"))}
          </button>
        </footer>`;
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    #renderTab(tab?: any) {
      return `
        <section class="pack-ledger-settings-panel${tab.id === this.activeTab ? " active" : ""}" data-tab="${tab.id}">
          <header class="pack-ledger-settings-header">
            <i class="${tab.icon}" inert></i>
            <div>
              <h2>${esc(loc(`Config.Tabs.${tab.id}.Name`))}</h2>
              <p>${esc(loc(`Config.Tabs.${tab.id}.Hint`))}</p>
            </div>
          </header>
          ${tab.sections.map((section?: any) => this.#renderSection(section)).join("")}
        </section>`;
    }

    #renderSection(section?: any) {
      let body = "";
      if ( section.fields ) body = section.fields.map((f?: any) => this.#renderField(fieldOf(f))).join("");
      else if ( section.slots ) body = this.#renderSlots();
      else if ( section.test ) body = this.#renderTest();
      const requires = section.requires ? ` data-requires="${esc(section.requires.join(" "))}"` : "";
      return `
        <div class="pack-ledger-settings-card"${requires}>
          ${section.title ? `<h3>${esc(loc(`Config.Section.${section.title}`))}</h3>` : ""}
          ${section.hint ? `<p class="card-hint">${esc(loc(`Config.Section.${section.hint}`))}</p>` : ""}
          ${body}
        </div>`;
    }

    #renderField(field?: any) {
      const { key } = field;
      const config = configOf(key);
      if ( !config ) return "";
      const value = game.settings.get(MODULE_ID, key);
      const requires = field.requires ? ` data-requires="${esc(field.requires.join(" "))}"` : "";
      const wide = field.pattern || ((config.type === String) && !config.choices);
      return `
        <div class="pack-ledger-settings-row${wide ? " wide" : ""}" data-key="${key}"${requires}>
          <div class="label">
            <label for="pack-ledger-setting-${key}">${esc(game.i18n.localize(config.name))}</label>
            ${hintHtml(game.i18n.localize(config.hint))}
          </div>
          <div class="control">
            ${this.#renderControl(field, config, value)}
            <button type="button" class="reset" data-action="reset" data-key="${key}"
                    data-tooltip-text="${esc(loc("Config.Reset"))}" aria-label="${esc(loc("Config.Reset"))}">
              <i class="fa-solid fa-arrow-rotate-left" inert></i>
            </button>
          </div>
        </div>`;
    }

    #renderControl(field: any, config: any, value?: any) {
      const { key } = field;
      const id = `pack-ledger-setting-${key}`;
      if ( config.type === Boolean ) {
        return `<label class="pack-ledger-switch"><input type="checkbox" id="${id}" name="${key}"${value ? " checked" : ""}>
          <span class="track" inert><span class="thumb"></span></span></label>`;
      }
      if ( config.choices ) {
        return `<div class="pack-ledger-segmented" role="radiogroup" id="${id}">
          ${Object.entries(config.choices).map(([choice, label]: any) => `
            <label><input type="radio" name="${key}" value="${esc(choice)}"${choice === value ? " checked" : ""}>
              <span>${esc(game.i18n.localize(label))}</span></label>`).join("")}
        </div>`;
      }
      if ( config.type === Number ) {
        const unit = unitLabel(field.unit);
        return `<div class="pack-ledger-number">
          <input type="number" id="${id}" name="${key}" value="${esc(value)}"
                 ${field.min !== undefined ? `min="${field.min}"` : ""} step="${field.step ?? "any"}">
          ${unit ? `<span class="unit">${esc(unit)}</span>` : ""}
        </div>`;
      }
      const cls = field.pattern ? "pattern" : "";
      return `<input type="text" id="${id}" name="${key}" class="${cls}" value="${esc(value)}" spellcheck="false">`;
    }

    #renderSlots() {
      const tiles = Object.entries(SLOTS).map(([slot, data]: any) => {
        const limit = game.settings.get(MODULE_ID, data.setting);
        const config = configOf(data.setting);
        const weight = data.weightSetting ? game.settings.get(MODULE_ID, data.weightSetting) : null;
        const weightConfig = data.weightSetting ? configOf(data.weightSetting) : null;
        return `
          <div class="pack-ledger-slot-tile" data-key="${data.setting}"
               data-tooltip-text="${esc(game.i18n.localize(config?.hint ?? ""))}">
            <i class="${data.icon}" inert></i>
            <span class="name">${esc(loc(`Slots.${slot}`))}</span>
            <input type="number" name="${data.setting}" value="${esc(limit)}" min="0" step="1"
                   aria-label="${esc(game.i18n.localize(config?.name ?? slot))}">
            ${data.weightSetting ? `
              <label class="weight" data-tooltip-text="${esc(game.i18n.localize(weightConfig?.hint ?? ""))}">
                <span>&lt;</span>
                <input type="number" name="${data.weightSetting}" value="${esc(weight)}" min="0" step="0.5"
                       aria-label="${esc(game.i18n.localize(weightConfig?.name ?? ""))}">
                <span>${esc(SLOT_WEIGHT_UNITS)}</span>
              </label>` : ""}
          </div>`;
      }).join("");
      return `<div class="pack-ledger-slot-grid">${tiles}</div>`;
    }

    #renderTest() {
      return `
        <div class="pack-ledger-settings-test">
          <input type="text" class="test-name" placeholder="${esc(loc("Config.TestPlaceholder"))}" spellcheck="false"
                 aria-label="${esc(loc("Config.Section.Test"))}">
          <div class="test-result"></div>
        </div>`;
    }

    /* ---------------------------------------- */
    /*  Interaction                             */
    /* ---------------------------------------- */

    async _onRender(context: any, options?: any) {
      await super._onRender(context, options);
      const form = this.form;
      form.addEventListener("submit", (event?: any) => {
        event.preventDefault();
        PackLedgerSettingsApp.#onSave.call(this);
      });
      form.addEventListener("input", (event?: any) => this.#onInput(event));
      form.addEventListener("change", (event?: any) => this.#onInput(event));
      this.#refreshDependencies();
      for ( const input of form.querySelectorAll("input.pattern") ) this.#checkPattern(input);
      this.#refreshTest();
      this.element.classList.toggle("dirty", this.dirty);
    }

    get form() {
      return this.element.querySelector("form.pack-ledger-settings-body");
    }

    #onInput(event?: any) {
      if ( event.target.classList.contains("test-name") ) return this.#refreshTest();
      this.dirty = true;
      this.element.classList.add("dirty");
      if ( event.target.classList.contains("pattern") ) {
        this.#checkPattern(event.target);
        this.#refreshTest();
      }
      this.#refreshDependencies();
    }

    /** Read a setting's current value from the form. */
    #formValue(key?: any) {
      const inputs = this.form.querySelectorAll(`[name="${key}"]`);
      if ( !inputs.length ) return undefined;
      const first = inputs[0];
      if ( first.type === "checkbox" ) return first.checked;
      if ( first.type === "radio" ) return [...inputs].find(i => i.checked)?.value ?? configOf(key)?.default;
      if ( first.type === "number" ) {
        const n = first.valueAsNumber;
        return Number.isFinite(n) ? n : configOf(key)?.default;
      }
      return first.value;
    }

    /** Write a value into the form. */
    #setFormValue(key: any, value?: any) {
      for ( const input of this.form.querySelectorAll(`[name="${key}"]`) ) {
        if ( input.type === "checkbox" ) input.checked = !!value;
        else if ( input.type === "radio" ) input.checked = (input.value === value);
        else input.value = value ?? "";
        if ( input.classList.contains("pattern") ) this.#checkPattern(input);
      }
    }

    /** Dim fields whose setting has no effect with the current choices. */
    #refreshDependencies() {
      for ( const el of this.form.querySelectorAll("[data-requires]") ) {
        const met = el.dataset.requires.split(" ").every((req?: any) => {
          const [key, wanted] = req.split("=");
          const value = this.#formValue(key);
          return (wanted === undefined) ? !!value : (String(value) === wanted);
        });
        el.classList.toggle("inactive", !met);
      }
    }

    #checkPattern(input?: any) {
      const ok = validRegex(input.value);
      input.classList.toggle("invalid", !ok);
      input.closest(".pack-ledger-settings-row")?.classList.toggle("invalid", !ok);
      if ( ok ) input.removeAttribute("data-tooltip-text");
      else input.dataset.tooltipText = loc("Config.InvalidRegex");
    }

    /** Show which patterns an example name matches. */
    #refreshTest() {
      const input = this.form.querySelector(".test-name");
      const out = this.form.querySelector(".test-result");
      if ( !input || !out ) return;
      const name = input.value.trim();
      if ( !name ) {
        out.innerHTML = `<span class="muted">${esc(loc("Config.TestEmpty"))}</span>`;
        return;
      }
      const hits = PATTERNS.filter(key => {
        const pattern = String(this.#formValue(key) ?? "");
        if ( !pattern.trim() || !validRegex(pattern) ) return false;
        return new RegExp(pattern, "i").test(name);
      });
      if ( !hits.length ) {
        out.innerHTML = `<span class="muted">${esc(loc("Config.TestNone"))}</span>`;
        return;
      }
      out.innerHTML = hits.map((key, i) => `
        <span class="chip${i === 0 ? " primary" : ""}">${esc(loc(`Config.TestResult.${key}`))}</span>`).join("");
    }

    static #onTab(this: PackLedgerSettingsApp, event: any, target?: any) {
      this.activeTab = target.dataset.tab;
      for ( const el of this.element.querySelectorAll(".pack-ledger-settings-tab") ) {
        el.classList.toggle("active", el.dataset.tab === this.activeTab);
      }
      for ( const el of this.element.querySelectorAll(".pack-ledger-settings-panel") ) {
        el.classList.toggle("active", el.dataset.tab === this.activeTab);
      }
      this.form.scrollTop = 0;
    }

    static #onReset(this: PackLedgerSettingsApp, event: any, target?: any) {
      const key = target.dataset.key;
      this.#setFormValue(key, configOf(key)?.default);
      this.dirty = true;
      this.element.classList.add("dirty");
      this.#refreshDependencies();
      this.#refreshTest();
    }

    static async #onResetAll(this: PackLedgerSettingsApp) {
      const confirmed = await DialogV2.confirm({
        window: { title: loc("Config.ResetAll"), icon: "fa-solid fa-arrow-rotate-left" },
        content: `<p>${esc(loc("Config.ResetAllConfirm"))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      for ( const key of allKeys() ) this.#setFormValue(key, configOf(key)?.default);
      this.dirty = true;
      this.element.classList.add("dirty");
      this.#refreshDependencies();
      this.#refreshTest();
    }

    static async #onSave(this: PackLedgerSettingsApp) {
      // Invalid patterns would silently stop matching; show where they are instead.
      const invalid = this.form.querySelector("input.pattern.invalid");
      if ( invalid ) {
        const tab = invalid.closest(".pack-ledger-settings-panel")?.dataset.tab;
        if ( tab ) PackLedgerSettingsApp.#onTab.call(this, null, { dataset: { tab } });
        invalid.focus();
        return ui.notifications.warn(loc("Config.InvalidRegex"));
      }
      try {
        for ( const key of allKeys() ) {
          const value = this.#formValue(key);
          if ( value === undefined ) continue;
          if ( !foundry.utils.objectsEqual({ v: value }, { v: game.settings.get(MODULE_ID, key) }) ) {
            await game.settings.set(MODULE_ID, key, value);
          }
        }
      } catch(err) {
        logError(`Could not save the settings`, err);
        return ui.notifications.error(loc("Config.SaveFailed"));
      }
      this.dirty = false;
      return this.close();
    }

    static #onCancel(this: PackLedgerSettingsApp) {
      this.dirty = false;
      return this.close();
    }
  };
  return SettingsAppClass;
}
