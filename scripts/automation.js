// Feature 1: Midi automation preset and friend-or-foe target prompt.
import { MODULE_ID, log, safe } from "./main.js";
import { MIDI_PRESET, mergePreset } from "./rules.js";

const L = (key) => game.i18n.localize(`BG3FLOW.${key}`);

/** Write the BG3 preset into Midi QOL, Midi target confirmation and dnd5e grouping. */
export async function applyPreset() {
  const current = game.settings.get("midi-qol", "ConfigSettings") ?? {};
  await game.settings.set("midi-qol", "ConfigSettings", mergePreset(current, MIDI_PRESET));

  if (game.settings.settings.has("midi-qol.TargetConfirmation")) {
    const tc = game.settings.get("midi-qol", "TargetConfirmation");
    if (tc && typeof tc === "object" && "enabled" in tc) {
      await game.settings.set("midi-qol", "TargetConfirmation", { ...tc, enabled: false });
    } else log("TargetConfirmation has an unexpected shape, skipped:", tc);
  }
  if (game.settings.settings.has("dnd5e.initiativeGroupCombatants")) {
    await game.settings.set("dnd5e", "initiativeGroupCombatants", false);
  }
  ui.notifications.info(L("Preset.Done"));
}

/** Settings-menu entry: opens a confirm dialog instead of rendering a window. */
export class PresetMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    await foundry.applications.api.DialogV2.confirm({
      window: { title: L("Preset.Title") },
      content: L("Preset.Confirm"),
      yes: { callback: () => applyPreset() }
    });
    return this;
  }
}

export function registerAutomation() {
  // Task 3 registers the friend-or-foe hook here.
}
