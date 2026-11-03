// Feature 1: Midi automation preset and friend-or-foe target prompt.
import { log, safe } from "./main.js";
import { MIDI_PRESET, mergePreset, presetUnknownKeys, shouldPrompt, splitTargets, applyChoice, dispositionFilterFor } from "./rules.js";

const L = (key) => game.i18n.localize(`BG3FLOW.${key}`);

/** Write the BG3 preset into Midi QOL, Midi target confirmation and dnd5e grouping. */
export async function applyPreset() {
  const current = game.settings.get("midi-qol", "ConfigSettings") ?? {};
  const unknown = presetUnknownKeys(current, MIDI_PRESET);
  if (unknown.length) log("preset keys not found in this Midi version, skipped:", unknown);
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

/** Ask the caster before the area is placed. Closing the dialog counts as "enemies", like BG3. */
async function promptFriendOrFoe() {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: L("Targets.Title") },
    content: `<p>${L("Targets.Hint")}</p>`,
    rejectClose: false,
    buttons: [
      { action: "enemies", label: L("Targets.EnemiesOnly"), icon: "fas fa-skull", default: true },
      { action: "everyone", label: L("Targets.Everyone"), icon: "fas fa-users" }
    ]
  });
  return result === "everyone" ? "everyone" : "enemies";
}

/**
 * midi-qol.preTargetingV2: runs before Midi's target confirmation and before the template (region) exists,
 * so the Midi region behaviour is created with the chosen disposition filter and its entry triggers respect it.
 */
export async function onPreTargeting({ workflow, usage }) {
  const activity = workflow?.activity;
  if (!shouldPrompt({ choice: activity?.target?.affects?.choice, templateType: activity?.target?.template?.type })) return;
  // Midi forces its own confirmation dialog for "Allow choosing targets"; this is the documented way to skip it.
  workflow.workflowOptions.targetConfirmation = "none";
  if (usage?.midiOptions?.workflowOptions) usage.midiOptions.workflowOptions.targetConfirmation = "none";

  const choice = await promptFriendOrFoe();
  workflow.bg3flowChoice = choice;
  const filter = dispositionFilterFor(choice);
  // This activity is Midi's per-use clone; Midi reads its regionBehavior when it attaches the region behaviour.
  activity.updateSource({ "regionBehavior.dispositionFilter": filter });
  if (activity.regionBehavior) activity.regionBehavior.dispositionFilter = filter; // ponytail: in case updateSource does not re-initialise
  log(`friend-or-foe: ${choice}, region filter ${filter}`);
}

/** midi-qol.targetingComplete: apply the choice to the cast's own targets (saves rolled at cast time). */
export async function onTargetingComplete(workflow) {
  const choice = workflow.bg3flowChoice;
  if (!choice) return;
  const tokens = Array.from(workflow.targets ?? []);
  const targets = tokens.map((t) => ({ id: t.id, name: t.name, disposition: t.document.disposition }));
  const { friends, foes } = splitTargets(workflow.token?.document?.disposition ?? null, targets, workflow.token?.id ?? null);
  const keepIds = new Set(applyChoice({ choice, friends, foes }).map((t) => t.id));
  const kept = tokens.filter((t) => keepIds.has(t.id));
  workflow.setTargets(new Set(kept));                     // resets Midi's derived sets too
  canvas.tokens.setTargets(kept.map((t) => t.id));
  log(`friend-or-foe: ${choice}, keeping ${kept.length}/${tokens.length} targets`);
}

export function registerAutomation() {
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargeting));
  Hooks.on("midi-qol.targetingComplete", safe(onTargetingComplete));
}
