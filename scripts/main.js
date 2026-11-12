import { depsOk } from "./rules.js";
import { registerAutomation, PresetMenu } from "./automation.js";
import { registerTurns, toggleDash } from "./turns.js";
import { registerSockets } from "./prompts.js";
import { startEncounter, registerEncounters, markEncounter } from "./encounters.js";
import { registerAutopilot, runTurn } from "./ai/run.js";
import { registerHouseRules } from "./houserules.js";
import { registerTargeting } from "./targeting.js";
import { registerEconomy } from "./economy.js";

export const MODULE_ID = "bg3-flow";

export function log(...args) { console.log(`[${MODULE_ID}]`, ...args); }

/** Wrap a hook body so a failure logs and never breaks Foundry's own flow. */
export function safe(fn) {
  return async function (...args) {
    try { return await fn.apply(this, args); }
    catch (err) { console.error(`[${MODULE_ID}]`, err); }
  };
}

/** Same, for hooks whose return value matters synchronously (preMoveToken veto, combatTurn mutation). */
export function safeSync(fn) {
  return function (...args) {
    try { return fn.apply(this, args); }
    catch (err) { console.error(`[${MODULE_ID}]`, err); }
  };
}

const L = (key) => game.i18n.localize(`BG3FLOW.${key}`);

/** socketlib socket for GM-side handlers (features 2 and 3 register theirs here). */
export let socket = null;
Hooks.once("socketlib.ready", () => { socket = socketlib.registerModule(MODULE_ID); registerSockets(socket, { startEncounter }); });

Hooks.once("init", () => {
  const reg = (key, type, def) => game.settings.register(MODULE_ID, key, {
    name: L(`Settings.${key}.Name`), hint: L(`Settings.${key}.Hint`),
    scope: "world", config: true, type, default: def
  });
  reg("enableAutomation", Boolean, true);
  reg("enableTurns", Boolean, true);
  reg("enableEncounters", Boolean, true);
  reg("lockGmMovement", Boolean, false);
  reg("sharedTurnEnd", Boolean, true);
  reg("defaultEncounterRadius", Number, 60);
  reg("obscuredDarkness", Number, 0.5);
  reg("dashNames", String, "Dash, Carrera, Correr");
  reg("enableAutopilot", Boolean, true);
  reg("pauseBeforeAttack", Boolean, false);
  reg("autoNextTurn", Boolean, true);
  reg("intelligenceThreshold", Number, 6);
  reg("fleeEnabled", Boolean, true);
  reg("fleeThreshold", Number, 25);
  reg("escapeRegionName", String, "escape");
  reg("lairActions", Boolean, true);
  reg("enlargeStrength", Boolean, true);
  reg("preparedSpells", Boolean, true);
  reg("askSpellLevel", Boolean, true);
  reg("targetPicker", Boolean, true);
  game.settings.register(MODULE_ID, "actionEconomy", {
    name: L("Settings.actionEconomy.Name"), hint: L("Settings.actionEconomy.Hint"), scope: "world", config: true, type: String, default: "players",
    choices: { players: L("Settings.actionEconomy.Players"), display: L("Settings.actionEconomy.Display"), off: L("Settings.actionEconomy.Off") }
  });
  game.settings.registerMenu(MODULE_ID, "preset", {
    name: L("Preset.Menu"), label: L("Preset.Menu"), hint: L("Preset.Hint"),
    icon: "fas fa-bolt", type: PresetMenu, restricted: true
  });
});

Hooks.once("ready", () => {
  const { ok, missing } = depsOk({
    dnd5e: game.system.id === "dnd5e" ? game.system.version : null,
    midi: game.modules.get("midi-qol")?.active ? game.modules.get("midi-qol").version : null,
    libWrapper: !!game.modules.get("lib-wrapper")?.active,
    socketlib: !!game.modules.get("socketlib")?.active
  });
  if (!ok) {
    ui.notifications.warn(`${L("DepsMissing")} ${missing.join(", ")}`, { permanent: true });
    log("disabled, missing:", missing);
    return;
  }
  if (game.settings.get(MODULE_ID, "enableAutomation")) registerAutomation();
  if (game.settings.get(MODULE_ID, "enableTurns")) registerTurns();
  if (game.settings.get(MODULE_ID, "enableEncounters")) registerEncounters();
  if (game.settings.get(MODULE_ID, "enableAutopilot")) registerAutopilot();
  registerHouseRules();
  registerEconomy(); // before the picker: a player out of actions is refused before being asked to pick a target
  registerTargeting();
  game.modules.get(MODULE_ID).api = { toggleDash, startEncounter, markEncounter, runTurn };
  log(`v${game.modules.get(MODULE_ID)?.version} ready`);
});
