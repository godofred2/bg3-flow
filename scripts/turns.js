// Feature 2: BG3 turn flow. Consecutive same-side combatants share a turn; movement is locked off-turn
// and budgeted on-turn. Groups are derived from combat.turns on every call, never stored.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { groupBySide, groupOf, jumpTurn, isGroupStart, speedLimit, canMove } from "./rules.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

const turnsOf = (combat) => combat.turns.map((c) => ({ id: c.id, side: c.token?.disposition ?? 0, defeated: !!c.isDefeated }));
const skipDefeated = (combat) => !!combat.settings?.skipDefeated;
const groupsOf = (combat) => groupBySide(turnsOf(combat));
const combatantFor = (combat, tokenId, sceneId) =>
  combat?.started ? combat.combatants.find((c) => c.tokenId === tokenId && c.sceneId === sceneId) ?? null : null;
const isDash = (combatant) => !!combatant.getFlag(MODULE_ID, "dash");
// ponytail: Foundry 14 runs preMoveToken twice on a player client for one vetoed move(); drop the echo.
let lastWarn = { msg: "", at: 0 };
function warn(msg) {
  const now = Date.now();
  if (msg === lastWarn.msg && now - lastWarn.at < 500) return;
  lastWarn = { msg, at: now };
  ui.notifications.warn(msg);
}

/** Ids of the combatants that may act right now: the current one's group, or just the current one. */
export function activeIds(combat) {
  const cur = combat?.combatant;
  if (!cur) return new Set();
  const g = groupOf(groupsOf(combat), cur.id);
  return new Set(g ? g.ids : [cur.id]);
}

function limitFor(doc, combatant, action) {
  const type = CONFIG.DND5E?.movementTypes?.[action];
  return speedLimit({
    speeds: doc.actor?.system?.attributes?.movement?.speeds,
    action, walkFallback: !type || !!type.walkFallback, dash: isDash(combatant)
  });
}

/** combatTurn (initiating client): move the pointer past the whole group, or back to a group's first member. */
export function onCombatTurn(combat, updateData, updateOptions) {
  const jump = jumpTurn({ turns: turnsOf(combat), groups: groupsOf(combat), turn: combat.turn, direction: updateOptions?.direction ?? 1, skipDefeated: skipDefeated(combat) });
  if (!jump) return;
  updateData.turn = jump.turn;
  if (jump.roundDelta) {
    // Foundry would have gone through nextRound(): mirror what it does so round listeners and world time stay right.
    updateData.round = combat.round + jump.roundDelta;
    if (updateOptions?.worldTime) updateOptions.worldTime.delta = CONFIG.time?.roundTime ?? updateOptions.worldTime.delta;
    Hooks.callAll("combatRound", combat, updateData, updateOptions);
  }
}

/** combatTurnChange (GM only acts): at a group's first member, reset members' movement and Dash, announce the shared turn. */
export async function onCombatTurnChange(combat, prior, current) {
  if (!game.user.isGM || !combat?.started) return;
  const turns = turnsOf(combat), groups = groupsOf(combat);
  if (!isGroupStart(groups, turns, current.turn, skipDefeated(combat))) return;
  const members = groupOf(groups, turns[current.turn].id).ids.map((id) => combat.combatants.find((c) => c.id === id)).filter(Boolean);
  for (const c of members) {
    await c.token?.clearMovementHistory?.();
    if (isDash(c)) await c.unsetFlag(MODULE_ID, "dash");
  }
  await ChatMessage.create({ content: L("Turns.Shared", { names: members.map((c) => c.token?.name ?? c.name).join(", ") }) });
}

/** preMoveToken (initiating client): veto off-turn moves and moves beyond the speed budget. */
export function onPreMoveToken(doc, movement) {
  const combat = game.combat;
  const combatant = combatantFor(combat, doc.id, doc.parent?.id);
  if (!combatant) return;
  const waypoints = [...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])];
  const action = waypoints.at(-1)?.action ?? doc.movementAction ?? "walk"; // the last waypoint carries this move's action
  if (CONFIG.Token.movement.actions[action]?.teleport) return;
  if (game.user.isGM && !game.settings.get(MODULE_ID, "lockGmMovement")) return;
  if (!activeIds(combat).has(combatant.id)) { warn(L("Turns.NotYourTurn")); return false; }
  const limit = limitFor(doc, combatant, action);
  const spent = movement.history?.cost ?? 0;
  const cost = (movement.passed?.cost ?? 0) + (movement.pending?.cost ?? 0);
  const { ok } = canMove({ spent, cost, limit });
  if (!ok) { warn(L("Turns.NoMovement", { spent: Math.round(spent), limit })); return false; }
}

/**
 * midi-qol.preTargetingV2: Midi marks any attack by someone other than Foundry's current combatant as an
 * opportunity attack and spends their reaction. A shared-turn member is on turn, so skip that check for them.
 */
export async function onPreTargetingTurns({ workflow, usage }) {
  const combat = game.combat;
  if (!combat?.started || !usage?.midiOptions) return;
  const combatant = combat.combatants.find((c) => c.actor === workflow?.actor);
  if (!combatant || !activeIds(combat).has(combatant.id)) return;
  usage.midiOptions.proceedChecks = { ...usage.midiOptions.proceedChecks, checkAoO: false };
}

/** dnd5e.postUseActivity: using an item named like Dash flags the combatant until its group's next turn. */
export async function onPostUseActivity(activity) {
  const names = String(game.settings.get(MODULE_ID, "dashNames") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!names.includes(String(activity?.item?.name ?? "").trim().toLowerCase())) return;
  // Same object, not same id: unlinked tokens' synthetic actors all share the base actor's id.
  const combatant = game.combat?.started ? game.combat.combatants.find((c) => c.actor === activity.actor) : null;
  if (combatant) await combatant.setFlag(MODULE_ID, "dash", true);
}

/** Macro / GM helper: `game.modules.get("bg3-flow").api.toggleDash(combatant)`. */
export async function toggleDash(combatant) {
  if (isDash(combatant)) await combatant.unsetFlag(MODULE_ID, "dash");
  else await combatant.setFlag(MODULE_ID, "dash", true);
  drawReach();
}

let reach = null;
/** Plain circle of remaining movement around controlled tokens that may act now. */
export function drawReach() {
  if (!canvas?.ready) return;
  if (reach && !reach.destroyed) reach.destroy();
  reach = null;
  const combat = game.combat;
  if (!combat?.started) return;
  const active = activeIds(combat);
  const g = new PIXI.Graphics();
  for (const token of canvas.tokens.controlled) {
    const combatant = combatantFor(combat, token.id, canvas.scene.id);
    if (!combatant || !active.has(combatant.id)) continue;
    const doc = token.document;
    const limit = limitFor(doc, combatant, doc.movementAction ?? "walk");
    const spent = (doc.movementHistory ?? []).reduce((s, w) => s + (w.cost ?? 0), 0);
    const remaining = limit - spent;
    if (remaining <= 0) continue;
    const px = remaining / canvas.dimensions.distance * canvas.dimensions.size;
    const { x, y } = doc.getCenterPoint?.() ?? token.center; // the sprite may still be animating towards doc.x/y
    if (typeof g.circle === "function") g.circle(x, y, px).fill({ color: 0x44aaff, alpha: 0.08 }).stroke({ width: 2, color: 0x44aaff, alpha: 0.8 }); // PIXI 8
    else g.lineStyle(2, 0x44aaff, 0.8).beginFill(0x44aaff, 0.08).drawCircle(x, y, px).endFill(); // PIXI 7
  }
  canvas.interface.addChild(g);
  reach = g;
}

export function registerTurns() {
  Hooks.on("combatTurn", safeSync(onCombatTurn));
  Hooks.on("combatTurnChange", safe(onCombatTurnChange));
  Hooks.on("preMoveToken", safeSync(onPreMoveToken)); // sync: a Promise would never veto
  Hooks.on("dnd5e.postUseActivity", safe(onPostUseActivity));
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargetingTurns));
  for (const h of ["controlToken", "moveToken", "combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady"]) {
    Hooks.on(h, safe(drawReach));
  }
  log("turns on");
}
