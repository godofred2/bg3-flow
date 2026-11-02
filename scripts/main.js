import { depsOk } from "./rules.js";
import { registerAutomation, PresetMenu } from "./automation.js";

export const MODULE_ID = "bg3-flow";

export function log(...args) { console.log(`[${MODULE_ID}]`, ...args); }

/** Wrap a hook body so a failure logs and never breaks Foundry's own flow. */
export function safe(fn) {
  return async function (...args) {
    try { return await fn.apply(this, args); }
    catch (err) { console.error(`[${MODULE_ID}]`, err); }
  };
}

const L = (key) => game.i18n.localize(`BG3FLOW.${key}`);

/** socketlib socket, set once socketlib is ready. GM-side handlers register here. */
export let socket = null;
Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("setRegionFilter", setRegionFilter);
});

/** GM-side: write a Midi regionActivity disposition filter (-1 enemies, 0 all, 1 allies) on a region. */
export async function setRegionFilter(regionUuid, filter) {
  const region = await fromUuid(regionUuid);
  const behaviour = region?.behaviors?.find((b) => b.type === "midi-qol.regionActivity");
  if (!behaviour) return false;
  await behaviour.update({ "system.dispositionFilter": filter });
  return true;
}

Hooks.once("init", () => {
  const reg = (key, type, def) => game.settings.register(MODULE_ID, key, {
    name: L(`Settings.${key}.Name`), hint: L(`Settings.${key}.Hint`),
    scope: "world", config: true, type, default: def
  });
  reg("enableAutomation", Boolean, true);
  reg("enableTurns", Boolean, true);
  reg("enableEncounters", Boolean, true);
  reg("lockGmMovement", Boolean, false);
  reg("defaultEncounterRadius", Number, 60);
  reg("obscuredDarkness", Number, 0.5);
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
  log("ready");
});
