// Piece 6: action economy. One action and one bonus action per turn of the acting group, shown above the token like BG3
// (green dot, orange triangle). Players are stopped, the GM is warned, the autopilot and off-turn uses (reactions) are Midi's.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { activeIds } from "./turns.js";
import { commandKind } from "./ai/plan.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);
const EXTRA_ATTACK = /^(extra attack|ataque (extra|adicional))/i, ACTION_SURGE = /^(action surge|acci[oó]n impetuosa)/i, CUNNING = /^(cunning action|acci[oó]n astuta)/i;

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

/** The state after paying `cost`. What cannot be paid (the GM going ahead) leaves the state as it is: spent, never negative. */
export function spend(state, cost, allowance) {
  if (cost === "free") return state;
  if (cost === "bonus") return { ...state, bonus: true };
  if (cost === "attack") {
    if (!state.action && state.attacks < allowance.attacks) return { ...state, attacks: state.attacks + 1 };
    return state.extra > 0 ? { ...state, attacks: 1, action: false, extra: state.extra - 1 } : state; // a fresh action from Action Surge
  }
  if (!state.action && state.attacks === 0) return { ...state, action: true };
  return state.extra > 0 ? { ...state, attacks: 0, action: true, extra: state.extra - 1 } : state;
}

/** A weapon that offers dnd5e's off-hand mode (light): with the action gone, its swing may be the bonus-action off-hand attack. */
const offersOffhand = (workflow) => ((workflow?.item ?? workflow?.activity?.item)?.system?.attackModes ?? []).some((m) => /offhand/.test(String(m?.value ?? m)));
/** The attack mode once rolled: Midi's field, else dnd5e's roll options (set right after the attack roll). */
const modeOf = (workflow) => workflow?.attackMode ?? workflow?.attackRoll?.options?.attackMode;

/** The combatant acting now for this actor, or null when it is not its group's turn (a reaction, an opportunity attack). */
export function actingCombatant(actor) {
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
  if (!check.ok && cost === "attack" && offersOffhand(workflow) && canSpend(state, "bonus", allowance).ok) check = { ok: true }; // a light weapon: it may be the off-hand swing
  if (check.ok) return;
  if (cost === "attack" && offersOffhand(workflow) && state.bonus) check = { ok: false, kind: "bonus" }; // it could only have been the off-hand swing
  return refuse(c, check.kind);
}

/** The economy's refusal: a player gets the text and `false`; the GM gets it with the note and goes on. */
function refuse(c, kind) {
  const text = L(kind === "bonus" ? "Economy.NoBonus" : "Economy.NoAction", { name: c.token?.name ?? c.name });
  if (game.user.isGM) { ui.notifications.warn(`${text} ${L("Economy.GmNote")}`); return; }
  ui.notifications.warn(text);
  return false;
}

/** What hiding costs, as in BG3: the action, or the bonus action with Cunning Action. */
export const hideCost = (actor) => [...(actor?.items ?? [])].some((i) => CUNNING.test(String(i.name ?? "").trim())) ? "bonus" : "action";
const ledger = (actor) => { if (mode() === "off") return null; const c = actingCombatant(actor); return c ? { c, state: stateOf(c), allowance: allowanceOf(c.actor) } : null; };
/** A use outside Midi (the Hide button) on the actor's turn: false when a player cannot pay (told why); the GM is warned and goes on; display mode never refuses. */
export function affordAction(actor, cost) {
  const l = ledger(actor);
  if (!l || mode() !== "players") return true;
  const check = canSpend(l.state, cost, l.allowance);
  return check.ok || refuse(l.c, check.kind) !== false;
}
/** Pay such a use into the combatant's flag (nothing off turn, out of combat or with the economy off). */
export async function payAction(actor, cost) {
  const l = ledger(actor);
  if (!l) return;
  const next = spend(l.state, cost, l.allowance);
  if (next !== l.state) await l.c.setFlag(MODULE_ID, "economy", next);
}

// ---- Command "drop": the last weapon(s) used go down; picking one up costs the action ----

const itemsOf = (actor) => [...(actor?.items ?? [])];
const itemOf = (actor, id) => actor?.items?.get?.(id) ?? itemsOf(actor).find((i) => i.id === id);
const nameOf = (actor) => actingCombatant(actor)?.token?.name ?? actor?.name;
const isDropped = (item) => !!(item?.getFlag?.(MODULE_ID, "dropped") ?? item?.flags?.[MODULE_ID]?.dropped);

/** midi-qol.AttackRollComplete: the weapon just swung, newest first, two at most, each stamped with its turn (two in one turn = dual wielding). */
export async function noteWeapon(workflow) {
  const item = workflow?.item, actor = workflow?.actor;
  if (item?.type !== "weapon" || !actor?.setFlag) return;
  const combat = game.combat, stamp = combat?.started ? `${combat.id ?? ""}:${combat.round}:${combat.turn}` : "";
  const list = [{ id: item.id, stamp }, ...(actor.getFlag(MODULE_ID, "lastWeapons") ?? []).filter((e) => e.id !== item.id)].slice(0, 2);
  await actor.setFlag(MODULE_ID, "lastWeapons", list);
}

/** The weapons the actor dropped on Command and has not picked up. */
export const droppedWeapons = (actor) => itemsOf(actor).filter(isDropped);

/** Command "drop": the weapons used in the latest turn go unequipped and flagged (both when dual wielding); without a note, what it holds (two at most). */
export async function dropWeapons(actor) {
  const list = actor?.getFlag?.(MODULE_ID, "lastWeapons") ?? [], latest = list[0]?.stamp;
  let items = list.filter((e) => e.stamp === latest).map((e) => itemOf(actor, e.id)).filter((i) => i && i.system?.equipped !== false);
  if (!items.length) items = itemsOf(actor).filter((i) => i.type === "weapon" && i.system?.equipped).slice(0, 2);
  if (!items.length) return [];
  for (const i of items) await i.update({ "system.equipped": false, [`flags.${MODULE_ID}.dropped`]: true });
  await ChatMessage.create({ content: L("Economy.Dropped", { name: nameOf(actor), weapons: items.map((i) => i.name).join(", ") }) });
  return items;
}

/** The autopilot picking a dropped weapon back up: the item update pays the action through onPreUpdateItem on this same client. */
export async function pickUpWeapon(actor, item) {
  await item.update({ "system.equipped": true, flags: { [MODULE_ID]: { "-=dropped": null } } });
  await ChatMessage.create({ content: L("Economy.PickUp", { name: nameOf(actor), weapon: item.name }) });
}

/** preUpdateItem: equipping a dropped weapon back. In combat only on the actor's turn and for the action (one per weapon); out of combat free. */
export function onPreUpdateItem(item, changes) {
  const equipping = changes?.system?.equipped ?? changes?.["system.equipped"];
  if (equipping !== true || !isDropped(item)) return;
  if (game.combat?.started) {
    if (!actingCombatant(item.actor)) { ui.notifications.warn(L("Turns.NotYourTurn")); if (!game.user.isGM) return false; }
    else if (affordAction(item.actor, "action") === false) return false;
    else payAction(item.actor, "action");
  }
  changes.flags ??= {};
  changes.flags[MODULE_ID] = { ...(changes.flags[MODULE_ID] ?? {}), "-=dropped": null }; // in hand again: the next equip is free
}

/** preDeleteActiveEffect: a player character's Command "drop" (Gambit's effect, expiring at its turn start) drops its weapons. Monsters: the autopilot. */
export async function onPreDeleteCommandEffect(effect) {
  const word = effect?.flags?.["gambits-premades"]?.commandWord, actor = effect?.parent;
  if (!word || commandKind(word) !== "drop" || !actor?.hasPlayerOwner || !actingCombatant(actor)) return;
  await dropWeapons(actor);
}

/**
 * dnd5e.postUseActivity (non-attacks, at the card), midi-qol.AttackRollComplete (attacks: the mode is known once rolled) and
 * midi-qol.RollComplete (whatever is left): a use on the actor's turn is paid once into the combatant's flag. A light weapon swung with the action gone is the off-hand swing and costs the bonus action,
 * whatever mode was picked. Action Surge grants an extra action.
 */
export async function onRollCompleteEconomy(workflow) {
  if (mode() === "off" || workflow?.aborted || workflow?.bg3flowPaid) return;
  const c = actingCombatant(workflow?.actor);
  if (!c) return;
  workflow.bg3flowPaid = true;
  const allowance = allowanceOf(c.actor);
  let cost = costOf(workflow.activity, { attackMode: modeOf(workflow) }), state = stateOf(c);
  if (ACTION_SURGE.test(String(workflow.activity?.item?.name ?? "").trim())) state = { ...state, extra: state.extra + 1 };
  if (cost === "attack" && !canSpend(state, cost, allowance).ok && offersOffhand(workflow) && !state.bonus) cost = "bonus";
  if (cost !== "free") state = spend(state, cost, allowance);
  if (state !== stateOf(c)) await c.setFlag(MODULE_ID, "economy", state);
}

/** dnd5e.postUseActivity: a non-attack use is paid as soon as its card is up (an attack waits for its roll: the mode decides). */
export async function onPostUseEconomy(activity, usage) {
  if (!usage?.workflow || costOf(activity) === "attack") return;
  return onRollCompleteEconomy(usage.workflow);
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
  const g = new PIXI.Graphics(), s = (canvas.dimensions?.size ?? 100) / 100, v8 = typeof g.circle === "function"; // Foundry 14.369 ships PIXI 7.4.3
  const shape = (draw, color, available) => {
    const line = { width: 2 * s, color: available ? color : 0x888888, alpha: available ? 1 : 0.7 };
    if (v8) { draw(); if (available) g.fill({ color, alpha: 0.95 }); g.stroke(line); return; }
    g.lineStyle(line.width, line.color, line.alpha);
    if (available) g.beginFill(color, 0.95);
    draw();
    g.endFill();
  };
  for (const token of canvas.tokens?.placeables ?? []) {
    const c = combat.combatants.find((c) => c.tokenId === token.id && c.sceneId === canvas.scene?.id);
    if (!c || !ids.has(c.id)) continue;
    if (!game.user.isGM && !token.visible) continue;
    const state = stateOf(c), allowance = allowanceOf(c.actor);
    const action = canSpend(state, "attack", allowance).ok || canSpend(state, "action", allowance).ok, bonus = !state.bonus;
    const { x: cx, y: cy } = token.center, y = cy - (token.h ?? 0) / 2 - 10 * s;
    const tri = [cx + 7 * s, y + 7 * s, cx + 21 * s, y + 7 * s, cx + 14 * s, y - 7 * s];
    shape(() => v8 ? g.circle(cx - 12 * s, y, 7 * s) : g.drawCircle(cx - 12 * s, y, 7 * s), 0x3ec15c, action);
    shape(() => v8 ? g.poly(tri) : g.drawPolygon(tri), 0xff8c1a, bonus);
  }
  g.zIndex = 300; // canvas.interface sorts by zIndex: above the TokenLayer (200) and turn markers
  canvas.interface.addChild(g);
  layer = g;
}

export function registerEconomy() {
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargetingEconomy)); // safe() passes the return on: a `false` reaches Midi
  Hooks.on("dnd5e.postUseActivity", safe(onPostUseEconomy)); // non-attacks paid at the card
  Hooks.on("midi-qol.AttackRollComplete", safe(onRollCompleteEconomy)); // attacks paid as soon as the mode is known, not seconds later at RollComplete
  Hooks.on("midi-qol.AttackRollComplete", safe(noteWeapon)); // Command "drop" needs the last weapon(s) used
  Hooks.on("preUpdateItem", safeSync(onPreUpdateItem)); // picking a dropped weapon up costs the action (a `false` reaches Foundry)
  Hooks.on("preDeleteActiveEffect", safe(onPreDeleteCommandEffect));
  Hooks.on("midi-qol.RollComplete", safe(onRollCompleteEconomy));
  Hooks.on("combatTurnChange", safe(resetEconomy));
  Hooks.on("combatStart", safe((combat) => resetEconomy(combat)));
  for (const h of ["combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady", "sightRefresh"]) Hooks.on(h, safeSync(drawEconomy));
  Hooks.on("refreshToken", safeSync((token, flags) => { if (flags?.refreshPosition && game.combat?.started) drawEconomy(); }));
  log("action economy on");
}
