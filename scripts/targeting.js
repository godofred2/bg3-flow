// Target picker: a single-target spell or attack shows its range and takes its targets from clicks at every use, like BG3; a spell cast
// at a higher level asks for the extra targets once the slot is chosen.
import { MODULE_ID, log, safe } from "./main.js";
import { rangeOf } from "./ai/board.js";
import { actingCombatant } from "./economy.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

/** What the picker must collect for this use ({ count, range, self } in scene units; `self`: the caster may click itself), or null when nothing is to be picked.
 *  Targets left marked from the last use are picked again (a heal, then an attack: both went to the ally), except off the actor's turn or for a
 *  reaction, where the targets were set by whoever prompted it (Gambit's opportunity attack, a Counterspell prompt). */
export function needsPick({ activity, usage, targeted, onTurn = true }) {
  if (game.settings.get(MODULE_ID, "targetPicker") === false || usage?.midiOptions?.targetUuids?.length) return null;
  if (targeted > 0 && (!onTurn || activity?.activation?.type === "reaction")) return null;
  if (!activity || activity.target?.template?.type) return null; // an area: the template picks
  const affects = activity.target?.affects?.type ?? "", units = activity.range?.units;
  const creatures = ["creature", "creatureOrObject", "ally", "enemy", "willing", "object"].includes(affects);
  if (affects === "self" || (units === "self" && !creatures)) return null; // range self with creature targets (the 2024 Engulf: what the monster covers) is asked within reach
  // Nothing to aim at (a weapon's attack leaves affects blank), except a save at reach with no target type (the SRD Engulf): Midi would aim it at the monster itself.
  if (!affects && activity.type !== "attack" && !(activity.type === "save" && ["touch", "ft"].includes(units))) return null;
  const given = parseInt(activity.target?.affects?.count);
  const count = Math.max(1, given || (units === "self" ? 4 : 1)); // no count at range self ("any creatures it covers"): up to four, Enter confirms fewer
  const range = units === "self" ? 5 : ["any", "spec"].includes(units) ? Infinity : rangeOf(activity);
  return { count, range, self: activity.type !== "attack" && affects !== "enemy" && !!affects && units !== "self" }; // blank affects (Engulf) or range self: never the monster itself
}

const MORE = /(one|1) additional (creature|target|humanoid|beast|person)|(criatura|objetivo|humanoide|bestia|persona)s? adicional/i;
/** Upcasting: how many more targets the chosen level buys, once the slot is known (the scaled clone's count; dnd5e marks its item with
 *  flags.dnd5e.scaling). ponytail: data whose count carries no @scaling (SRD imports) falls back to the "one additional creature" text. */
export function extraTargets({ activity, targeted }) {
  const scaling = activity?.item?.flags?.dnd5e?.scaling ?? 0;
  if (!(scaling > 0)) return 0;
  const need = needsPick({ activity, targeted: 0 });
  if (!need) return 0;
  const scalesInData = /@scaling/.test(String(activity._source?.target?.affects?.count ?? "")); // the clone's count is resolved; its source keeps the formula
  const total = need.count + (!scalesInData && MORE.test(activity.item?.system?.description?.value ?? "") ? scaling : 0);
  return Math.max(0, total - targeted); // whatever Enter declined before, the level's own targets are offered
}

/** The picked tokens replace Midi's snapshot of the targets taken at the start of the use (workflowOptions.preSelectedTargetUuids, which
 *  setupTargets prefers to the marks on screen) on the usage and on the workflow; preSelectedTargets feeds sculpt spells. */
function snapshot(usage, workflow, tokens) {
  const uuids = tokens.map((t) => t.document?.uuid).filter(Boolean);
  if (usage) ((usage.midiOptions ??= {}).workflowOptions ??= {}).preSelectedTargetUuids = uuids;
  if (workflow.workflowOptions) workflow.workflowOptions.preSelectedTargetUuids = uuids;
  workflow.preSelectedTargets = new Set(tokens);
}

/** midi-qol.targetingComplete (awaited by Midi, the card up, the slot chosen and spent): a higher level's extra targets are picked and
 *  added to the workflow's, the first ones kept. Esc goes on with what is there. */
export async function onTargetingCompletePick(workflow, { pick = pickTargets } = {}) {
  const have = [...(workflow?.targets ?? [])];
  if (!workflow?.token) return;
  const extra = extraTargets({ activity: workflow.activity, targeted: have.length });
  if (!extra) return;
  const need = needsPick({ activity: workflow.activity, targeted: 0 });
  const picked = await pick({ token: workflow.token, range: need.range, count: extra, self: need.self, name: workflow.item?.name ?? workflow.activity.name, keep: true });
  if (!picked?.length) { log("target picker: higher level, kept the targets as they were"); return; }
  const all = [...have, ...picked.filter((t) => !have.includes(t))];
  workflow.setTargets?.(new Set(all));
  snapshot(null, workflow, all);
  log(`target picker: +${picked.map((t) => t.name).join(", ")} (higher level)`);
}

/** midi-qol.preTargetingV2: pick before Midi reads the targets; a cancelled pick aborts the use (nothing spent). */
export async function onPreTargetingPick({ workflow, usage }, { pick = pickTargets } = {}) {
  const onTurn = !game.combat?.started || !!actingCombatant(workflow?.actor);
  const need = needsPick({ activity: workflow?.activity, usage, targeted: game.user.targets?.size ?? 0, onTurn });
  if (!need || !workflow?.token) return;
  const picked = await pick({ token: workflow.token, range: need.range, count: need.count, self: need.self, name: workflow.item?.name ?? workflow.activity.name });
  if (!picked?.length) { log("target picker: cancelled"); return false; }
  snapshot(usage, workflow, picked);
  log(`target picker: ${picked.map((t) => t.name).join(", ")}`);
}

/** Range circle round the caster, a prompt, and clicks on creatures until `count` are targeted; Enter settles for fewer. Esc or a right click
 *  cancels (null). `keep`: the targets already marked stay (a higher level's extra targets). */
export function pickTargets({ token, range, count, name, self = false, keep = false }) {
  return new Promise((resolve) => {
    const picked = [], view = canvas.app?.view ?? canvas.app?.canvas;
    if (!keep && game.user.targets?.size) canvas.tokens.setTargets?.([]); // the last use's targets: this use picks its own
    const g = drawRange(token, range);
    const units = canvas.scene?.grid?.units || "ft";
    const text = L(keep ? "Picker.More" : "Picker.Pick", { name, count, range: Number.isFinite(range) ? `${range} ${units}` : L("Picker.Anywhere") });
    const note = ui.notifications.info(count > 1 ? `${text} ${L("Picker.Fewer")}` : text, { permanent: true });
    const finish = (result) => {
      view?.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      g?.destroy();
      if (note && ui.notifications.remove) ui.notifications.remove(note);
      resolve(result);
    };
    const onDown = (ev) => {
      if (ev.button === 2) return finish(null);
      const t = canvas.tokens.hover; // the token under the pointer: Foundry tracks it for every visible token
      if (!t || (t === token && !self) || picked.includes(t) || !t.visible) return; // yourself only for what can affect you (a touch heal, a potion)
      const d = MidiQOL.computeDistance?.(token, t, { wallsBlock: false }) ?? 0;
      if (d > range) { ui.notifications.warn(L("Picker.OutOfRange", { name: t.name, distance: Math.round(d), range, units })); return; }
      t.setTarget(true, { user: game.user, releaseOthers: !keep && picked.length === 0, groupSelection: true });
      picked.push(t);
      if (picked.length >= count) finish(picked);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(null); }
      else if (ev.key === "Enter" && picked.length) { ev.stopPropagation(); ev.preventDefault(); finish(picked); } // Scorching Ray, all rays at one goblin
    };
    view?.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  });
}

/** An orange circle of `range` from the edge of the caster's space; none for an unlimited range. */
function drawRange(token, range) {
  if (!Number.isFinite(range) || !canvas?.ready || typeof PIXI === "undefined") return null;
  const g = new PIXI.Graphics();
  const { x, y } = token.center;
  const px = range / canvas.dimensions.distance * canvas.dimensions.size + Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (typeof g.circle === "function") g.circle(x, y, px).fill({ color: 0xffaa33, alpha: 0.08 }).stroke({ width: 2, color: 0xffaa33, alpha: 0.9 }); // PIXI 8
  else g.lineStyle(2, 0xffaa33, 0.9).beginFill(0xffaa33, 0.08).drawCircle(x, y, px).endFill(); // PIXI 7
  canvas.interface.addChild(g);
  return g;
}

export function registerTargeting() {
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargetingPick)); // safe() passes the return on: a `false` reaches Midi and aborts the use
  Hooks.on("midi-qol.targetingComplete", safe(onTargetingCompletePick)); // the slot is known only here: a higher level's extra targets
  log("target picker on");
}
