// Feature 1: Midi automation preset and friend-or-foe target prompt.
import { log, safe, socket, setRegionFilter } from "./main.js";
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

/** Ask the caster which allies inside a choice-enabled area to spare. Returns {choice, checkedIds}. */
async function promptFriendOrFoe(friends) {
  const boxes = friends.map((f) =>
    `<label class="checkbox"><input type="checkbox" name="keep" value="${f.id}" checked> ${foundry.utils.escapeHTML(f.name)}</label>`
  ).join("");
  const content = `<p>${L("Targets.Hint")}</p><div class="form-group stacked">${boxes}</div>`;
  const read = (btn) => ({
    choice: "checked",
    checkedIds: Array.from(btn.form?.querySelectorAll?.('input[name="keep"]:checked') ?? [], (i) => i.value)
  });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: L("Targets.Title") },
    content,
    rejectClose: false,
    buttons: [
      { action: "enemies", label: L("Targets.EnemiesOnly"), icon: "fas fa-skull" },
      { action: "everyone", label: L("Targets.Everyone"), icon: "fas fa-users", default: true },
      { action: "checked", label: L("Targets.OnlyChecked"), icon: "fas fa-check-square",
        callback: (event, button) => read(button) }
    ]
  });
  if (result === null || result === undefined) return { choice: "everyone", checkedIds: [] };
  if (typeof result === "string") return { choice: result, checkedIds: [] };
  return { choice: "checked", checkedIds: result.checkedIds ?? [] };
}

/** Write the chosen filter onto the Midi region behaviour created by this cast, if any. Players relay through the GM. */
async function updateRegionFilter(region, choice) {
  const filter = dispositionFilterFor(choice);
  if (filter === null || !(region instanceof RegionDocument)) return;
  if (game.user.isGM) await setRegionFilter(region.uuid, filter);
  else if (socket) await socket.executeAsGM("setRegionFilter", region.uuid, filter);
  else log("socketlib not ready, region filter not written");
}

export async function onTargetingComplete(workflow) {
  const tokens = Array.from(workflow.targets ?? []);
  const targets = tokens.map((t) => ({ id: t.id, name: t.name, disposition: t.document.disposition }));
  const casterDisposition = workflow.token?.document?.disposition ?? null;
  const choiceFlag = workflow.activity?.target?.affects?.choice === true;
  if (!shouldPrompt({ choice: choiceFlag, casterDisposition, targets })) return;

  const { friends, foes } = splitTargets(casterDisposition, targets);
  const { choice, checkedIds } = await promptFriendOrFoe(friends);
  const keepIds = new Set(applyChoice({ choice, friends, foes, checkedIds }).map((t) => t.id));
  const kept = tokens.filter((t) => keepIds.has(t.id));

  await updateRegionFilter(workflow.template, choice);   // first: a targeting failure must not skip it
  workflow.setTargets(new Set(kept));                     // resets Midi's derived sets too
  canvas.tokens.setTargets(kept.map((t) => t.id));
  log(`friend-or-foe: ${choice}, keeping ${kept.length}/${tokens.length} targets`);
}

export function registerAutomation() {
  Hooks.on("midi-qol.targetingComplete", safe(onTargetingComplete));
}
