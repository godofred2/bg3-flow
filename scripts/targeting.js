// Target picker: a single-target spell or attack used with nothing targeted shows its range and takes its targets from clicks, like BG3.
import { MODULE_ID, log, safe } from "./main.js";
import { rangeOf } from "./ai/board.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

/** What the picker must collect for this use ({ count, range } in scene units), or null when nothing is to be picked. */
export function needsPick({ activity, usage, targeted }) {
  if (game.settings.get(MODULE_ID, "targetPicker") === false || targeted > 0 || usage?.midiOptions?.targetUuids?.length) return null;
  if (!activity || activity.target?.template?.type) return null; // an area: the template picks
  const affects = activity.target?.affects?.type ?? "", units = activity.range?.units;
  if (affects === "self" || units === "self") return null;
  if (!affects && activity.type !== "attack") return null; // nothing to aim at (a weapon's attack leaves affects blank)
  const count = Math.max(1, parseInt(activity.target?.affects?.count) || 1);
  return { count, range: ["any", "spec"].includes(units) ? Infinity : rangeOf(activity) };
}

/** midi-qol.preTargetingV2: with nothing targeted, pick before Midi reads the targets; a cancelled pick aborts the use (nothing spent). */
export async function onPreTargetingPick({ workflow, usage }, { pick = pickTargets } = {}) {
  const need = needsPick({ activity: workflow?.activity, usage, targeted: game.user.targets?.size ?? 0 });
  if (!need || !workflow?.token) return;
  const picked = await pick({ token: workflow.token, range: need.range, count: need.count, name: workflow.item?.name ?? workflow.activity.name });
  if (!picked?.length) { log("target picker: cancelled"); return false; }
  log(`target picker: ${picked.map((t) => t.name).join(", ")}`);
}

/** Range circle round the caster, a prompt, and clicks on creatures until `count` are targeted. Esc or a right click cancels (null). */
export function pickTargets({ token, range, count, name }) {
  return new Promise((resolve) => {
    const picked = [], view = canvas.app?.view ?? canvas.app?.canvas;
    const g = drawRange(token, range);
    const units = canvas.scene?.grid?.units || "ft";
    const note = ui.notifications.info(L("Picker.Pick", { name, count, range: Number.isFinite(range) ? `${range} ${units}` : L("Picker.Anywhere") }), { permanent: true });
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
      if (!t || t === token || picked.includes(t) || !t.visible) return;
      const d = MidiQOL.computeDistance?.(token, t, { wallsBlock: false }) ?? 0;
      if (d > range) { ui.notifications.warn(L("Picker.OutOfRange", { name: t.name, distance: Math.round(d), range, units })); return; }
      t.setTarget(true, { user: game.user, releaseOthers: picked.length === 0, groupSelection: true });
      picked.push(t);
      if (picked.length >= count) finish(picked);
    };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(null); } };
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
  log("target picker on");
}
