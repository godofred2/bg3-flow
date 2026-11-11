// Piece 6: action economy. One action and one bonus action per turn of the acting group, shown above the token like BG3
// (green dot, orange triangle). Players are stopped, the GM is warned, the autopilot and off-turn uses (reactions) are Midi's.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { activeIds } from "./turns.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const EXTRA_ATTACK = /^(extra attack|ataque (extra|adicional))/i, ACTION_SURGE = /^(action surge|acci[oó]n impetuosa)/i;

export const FRESH = Object.freeze({ attacks: 0, action: false, bonus: false, extra: 0 });
const mode = () => game.settings.get(MODULE_ID, "actionEconomy") ?? "players";
export const stateOf = (combatant) => combatant.getFlag(MODULE_ID, "economy") ?? FRESH;

/** Attacks inside one action: Extra Attack gives two, three with 11 fighter levels, four with 20. */
export function allowanceOf(actor) {
  if (![...(actor?.items ?? [])].some((i) => EXTRA_ATTACK.test(String(i.name ?? "").trim()))) return { attacks: 1 };
  const levels = actor?.classes?.fighter?.system?.levels ?? 0;
  return { attacks: levels >= 20 ? 4 : levels >= 11 ? 3 : 2 };
}

/** What a use costs: "attack" (an action-type attack; "bonus" in dnd5e's off-hand mode), "action", "bonus" or "free". */
export function costOf(activity, { attackMode } = {}) {
  const type = activity?.activation?.type;
  if (type === "bonus") return "bonus";
  if (type !== "action") return "free";
  if (activity.type !== "attack") return "action";
  return /offhand/.test(String(attackMode ?? "")) ? "bonus" : "attack";
}

/** Can `cost` be paid from `state`? An extra action (Action Surge) reopens a spent action. */
export function canSpend(state, cost, allowance) {
  if (cost === "free") return { ok: true };
  if (cost === "bonus") return state.bonus ? { ok: false, kind: "bonus" } : { ok: true };
  const open = cost === "attack" ? !state.action && state.attacks < allowance.attacks : !state.action && state.attacks === 0; // the Attack action, once begun, is the action
  return open || state.extra > 0 ? { ok: true } : { ok: false, kind: "action" };
}

/** The state after paying `cost` (checked with canSpend first). */
export function spend(state, cost, allowance) {
  if (cost === "free") return state;
  if (cost === "bonus") return { ...state, bonus: true };
  if (cost === "attack") {
    if (!state.action && state.attacks < allowance.attacks) return { ...state, attacks: state.attacks + 1 };
    return { ...state, attacks: 1, action: false, extra: state.extra - 1 }; // a fresh action from Action Surge
  }
  if (!state.action && state.attacks === 0) return { ...state, action: true };
  return { ...state, attacks: 0, action: true, extra: state.extra - 1 };
}

/** The combatant acting now for this actor, or null when it is not its group's turn (a reaction, an opportunity attack). */
function actingCombatant(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return null;
  const c = combat.combatants.find((c) => c.actor === actor);
  if (!c) return null;
  const ids = game.settings.get(MODULE_ID, "enableTurns") === false ? new Set([combat.combatant?.id]) : activeIds(combat);
  return ids.has(c.id) ? c : null;
}

/** midi-qol.preTargetingV2: a player out of actions is stopped before anything is spent; the GM is warned and goes on. */
export async function onPreTargetingEconomy({ workflow, usage }) {
  if (mode() !== "players" || usage?.midiOptions?.targetUuids?.length) return; // the autopilot plans its own economy
  const c = actingCombatant(workflow?.actor);
  if (!c) return;
  const cost = costOf(workflow.activity);
  if (cost === "free") return;
  const allowance = allowanceOf(c.actor), state = stateOf(c);
  let check = canSpend(state, cost, allowance);
  if (!check.ok && cost === "attack" && canSpend(state, "bonus", allowance).ok) check = { ok: true }; // it may be the off-hand swing
  if (check.ok) return;
  const name = c.token?.name ?? c.name;
  if (game.user.isGM) { ui.notifications.warn(L("Economy.GmNote", { name, kind: check.kind })); return; }
  ui.notifications.warn(L(check.kind === "bonus" ? "Economy.NoBonus" : "Economy.NoAction", { name }));
  return false;
}

/** midi-qol.RollComplete: a finished use on the actor's turn is paid into the combatant's flag; Action Surge grants an extra action. */
export async function onRollCompleteEconomy(workflow) {
  if (mode() === "off" || workflow?.aborted) return;
  const c = actingCombatant(workflow?.actor);
  if (!c) return;
  const cost = costOf(workflow.activity, { attackMode: workflow.attackMode });
  let state = stateOf(c);
  if (ACTION_SURGE.test(String(workflow.activity?.item?.name ?? "").trim())) state = { ...state, extra: state.extra + 1 };
  if (cost !== "free") state = spend(state, cost, allowanceOf(c.actor));
  if (state !== stateOf(c)) await c.setFlag(MODULE_ID, "economy", state);
}

/** combatTurnChange: the new acting group starts fresh; combatStart (no `current`): everyone does. Lead GM only. */
export async function resetEconomy(combat, prior, current) {
  if (!game.users.activeGM?.isSelf || !combat) return;
  const ids = current ? (game.settings.get(MODULE_ID, "enableTurns") === false ? new Set([combat.combatant?.id]) : activeIds(combat)) : null;
  for (const c of combat.combatants) if ((!ids || ids.has(c.id)) && c.getFlag(MODULE_ID, "economy") !== undefined) await c.unsetFlag(MODULE_ID, "economy");
}

let layer = null;
/** Above every token of the acting group the user can see: a green dot (action) and an orange triangle (bonus action), hollow once spent. */
export function drawEconomy() {
  if (!canvas?.ready) return;
  if (layer && !layer.destroyed) layer.destroy();
  layer = null;
  const combat = game.combat;
  if (!combat?.started || mode() === "off" || typeof PIXI === "undefined") return;
  const ids = game.settings.get(MODULE_ID, "enableTurns") === false ? new Set([combat.combatant?.id]) : activeIds(combat);
  const g = new PIXI.Graphics(), s = (canvas.dimensions?.size ?? 100) / 100;
  const shape = (draw, color, available) => { draw(); if (available) g.fill({ color, alpha: 0.95 }); g.stroke({ width: 2 * s, color: available ? color : 0x888888, alpha: available ? 1 : 0.7 }); };
  for (const token of canvas.tokens?.placeables ?? []) {
    const c = combat.combatants.find((c) => c.tokenId === token.id && c.sceneId === canvas.scene?.id);
    if (!c || !ids.has(c.id)) continue;
    if (!game.user.isGM && !token.visible) continue;
    const state = stateOf(c), allowance = allowanceOf(c.actor);
    const action = canSpend(state, "attack", allowance).ok || canSpend(state, "action", allowance).ok, bonus = !state.bonus;
    const { x: cx, y: cy } = token.center, y = cy - (token.h ?? 0) / 2 - 10 * s;
    if (typeof g.circle !== "function") continue; // PIXI 7: no icons (Foundry 14 ships PIXI 8)
    shape(() => g.circle(cx - 12 * s, y, 7 * s), 0x3ec15c, action);
    shape(() => g.poly([cx + 7 * s, y + 7 * s, cx + 21 * s, y + 7 * s, cx + 14 * s, y - 7 * s]), 0xff8c1a, bonus);
  }
  canvas.interface.addChild(g);
  layer = g;
}

export function registerEconomy() {
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargetingEconomy)); // safe() passes the return on: a `false` reaches Midi
  Hooks.on("midi-qol.RollComplete", safe(onRollCompleteEconomy));
  Hooks.on("combatTurnChange", safe(resetEconomy));
  Hooks.on("combatStart", safe((combat) => resetEconomy(combat)));
  for (const h of ["combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady", "sightRefresh"]) Hooks.on(h, safeSync(drawEconomy));
  Hooks.on("refreshToken", safeSync((token, flags) => { if (flags?.refreshPosition && game.combat?.started) drawEconomy(); }));
  log("action economy on");
}
