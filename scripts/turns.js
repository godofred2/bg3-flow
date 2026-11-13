// Feature 2: BG3 turn flow. Consecutive same-side combatants share a turn; movement is locked off-turn
// and budgeted on-turn. Groups are derived from combat.turns on every call, never stored.
import { MODULE_ID, log, safe, safeSync } from "./main.js";
import { groupBySide, groupOf, jumpTurn, isGroupStart, speedLimit, canMove, isDominated } from "./rules.js";

const L = (key, data) => data ? game.i18n.format(`BG3FLOW.${key}`, data) : game.i18n.localize(`BG3FLOW.${key}`);

const turnsOf = (combat) => combat.turns.map((c) => ({ id: c.id, side: c.token?.disposition ?? 0, defeated: !!c.isDefeated }));
const skipDefeated = (combat) => !!combat.settings?.skipDefeated;
const groupsOf = (combat) => groupBySide(turnsOf(combat));
const combatantFor = (combat, tokenId, sceneId) =>
  combat?.started ? combat.combatants.find((c) => c.tokenId === tokenId && c.sceneId === sceneId) ?? null : null;
const isDash = (combatant) => !!combatant.getFlag(MODULE_ID, "dash");
/** This round's Confusion roll on the combatant (run.js rolls it at the turn's start), or null. */
const confusionRoll = (c) => { const f = c?.getFlag(MODULE_ID, "confusion"); return f && f.round === game.combat?.round ? f.roll : null; };
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
  const turns = turnsOf(combat);
  const g = groupOf(groupBySide(turns), cur.id);
  const dead = new Set(turns.filter((t) => t.defeated).map((t) => t.id));
  return new Set((g ? g.ids : [cur.id]).filter((id) => !dead.has(id))); // a defeated member acts no more: no marker, no circle, no autopilot
}

function limitFor(doc, combatant, action) {
  const type = CONFIG.DND5E?.movementTypes?.[action];
  return speedLimit({
    speeds: doc.actor?.system?.attributes?.movement?.speeds,
    action, walkFallback: !type || !!type.walkFallback, dash: isDash(combatant)
  });
}

const waitsForAll = () => game.settings.get(MODULE_ID, "sharedTurnEnd") !== false;
const nameOf = (c) => c.token?.name ?? c.name;

/** Members of the active group the shared turn still waits for: alive, not flagged done, owned by a connected player (NPC allies and absent players are not waited for). */
export function waitingFor(combat) {
  return [...activeIds(combat)].map((id) => combat.combatants.find((c) => c.id === id))
    .filter((c) => c && !c.getFlag(MODULE_ID, "done") && (c.players ?? []).some((u) => u.active && !u.isGM));
}

/** End turn (the tracker or the HUD button): the user's members are done; a player is told who is left, the GM moves on at once.
 *  A player's last "done" reaches the lead GM through updateCombatant. Returns the members still waited for. */
export async function endTurn(combat, { nextTurn = () => combat.nextTurn() } = {}) {
  const own = (c) => game.user.isGM || c.isOwner; // the GM owns every token
  const waiting = waitingFor(combat), mine = waiting.filter(own), others = waiting.filter((c) => !own(c));
  for (const c of mine) await c.setFlag(MODULE_ID, "done", true);
  if (others.length) ui.notifications.info(L("Turns.Waiting", { names: others.map(nameOf).join(", ") }));
  else if (game.user.isGM) await nextTurn();
  return others;
}

let advancing = false;
/** updateCombatant (lead GM): the last player's "done" moves the pointer past the group. */
export async function onUpdateCombatant(combatant, changes, _options, _userId, { nextTurn } = {}) {
  if (!game.users.activeGM?.isSelf || !waitsForAll() || changes?.flags?.[MODULE_ID]?.done !== true) return;
  const combat = combatant.parent ?? game.combat;
  if (!combat?.started || advancing || !activeIds(combat).has(combatant.id) || waitingFor(combat).length) return;
  advancing = true;
  try { await (nextTurn ?? (() => combat.nextTurn()))(); } finally { advancing = false; }
}

/** renderTokenHUD: a chequered flag on the left column for an owned member of the shared turn that has not ended yet. */
export function onRenderTokenHUD(app, html) {
  const root = html?.querySelector ? html : html?.[0];
  const doc = app.object?.document ?? app.document, col = root?.querySelector(".col.left");
  const combat = game.combat, c = combatantFor(combat, doc?.id, doc?.parent?.id);
  if (!doc?.isOwner || !col || !c || !waitsForAll() || !activeIds(combat).has(c.id) || c.getFlag(MODULE_ID, "done")) return;
  col.insertAdjacentHTML("beforeend", `<button type="button" class="control-icon bg3-end-turn" data-tooltip="${L("Turns.EndButton")}"><i class="fa-solid fa-flag-checkered"></i></button>`);
  col.querySelector(".bg3-end-turn")?.addEventListener("click", safe(() => endTurn(combat)));
}

/** combatTurn (initiating client): move the pointer past the whole group, or back to a group's first member. A player's End turn while
 *  another connected player of the group has not ended only ends their own part: the pointer, the round and the world time hold. */
export function onCombatTurn(combat, updateData, updateOptions) {
  if ((updateOptions?.direction ?? 1) > 0 && !game.user.isGM && waitsForAll() && waitingFor(combat).some((c) => !c.isOwner)) {
    endTurn(combat); // flags and the notice; nothing to await inside a sync hook
    updateData.turn = combat.turn;
    updateData.round = combat.round;
    if (updateOptions?.worldTime) updateOptions.worldTime.delta = 0;
    return;
  }
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
  if (!game.users.activeGM?.isSelf || !combat?.started) return; // one GM acts, however many are connected
  const turns = turnsOf(combat), groups = groupsOf(combat);
  if (!isGroupStart(groups, turns, current.turn, skipDefeated(combat))) return;
  const members = groupOf(groups, turns[current.turn].id).ids.map((id) => combat.combatants.find((c) => c.id === id)).filter(Boolean);
  for (const c of members) {
    await c.token?.clearMovementHistory?.();
    if (isDash(c)) await c.unsetFlag(MODULE_ID, "dash");
    if (c.getFlag(MODULE_ID, "done")) await c.unsetFlag(MODULE_ID, "done");
  }
  const shown = members.filter((c) => !c.token?.hidden); // a GM-hidden token gives nothing away in the public line
  if (shown.length) await ChatMessage.create({ content: L("Turns.Shared", { names: shown.map((c) => c.token?.name ?? c.name).join(", ") }) });
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
  if (!game.user.isGM) { // a dominated character is the DM's; a confused one walks only on a 9-10 (a 1 is walked by the GM's client)
    const name = combatant.token?.name ?? doc.name, roll = confusionRoll(combatant);
    if (isDominated(doc.actor)) { warn(L("Turns.Dominated", { name })); return false; }
    if (roll && roll <= 8) { warn(L("Turns.Confused", { name, roll })); return false; }
  }
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
  if (!combat?.started) return;
  const combatant = combat.combatants.find((c) => c.actor === workflow?.actor);
  if (!game.user.isGM) { // a dominated character is the DM's; a confused one acts only on a 7-10 (7-8: only the melee attack the table was told of)
    const name = combatant?.token?.name ?? workflow?.actor?.name, roll = confusionRoll(combatant), a = workflow?.activity;
    const melee = a?.type === "attack" && a?.attack?.type?.value === "melee";
    if (isDominated(workflow?.actor)) { ui.notifications.warn(L("Turns.Dominated", { name })); return false; }
    if (roll && (roll <= 6 || (roll <= 8 && !melee))) { ui.notifications.warn(L("Turns.Confused", { name, roll })); return false; }
  }
  if (!usage?.midiOptions || !combatant || !activeIds(combat).has(combatant.id)) return;
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
/** Plain circle of remaining movement around every token that may act now and that this user can see (the GM sees them all). */
export function drawReach() {
  if (!canvas?.ready) return;
  if (reach && !reach.destroyed) reach.destroy();
  reach = null;
  const combat = game.combat;
  if (!combat?.started) return;
  const active = activeIds(combat);
  const g = new PIXI.Graphics();
  for (const token of canvas.tokens.placeables ?? canvas.tokens.controlled) {
    const combatant = combatantFor(combat, token.id, canvas.scene.id);
    if (!combatant || !active.has(combatant.id)) continue;
    if (!game.user.isGM && !token.visible) continue; // hidden or out of sight: no hint of where it is
    const doc = token.document;
    const limit = limitFor(doc, combatant, doc.movementAction ?? "walk");
    const spent = (doc.movementHistory ?? []).reduce((s, w) => s + (w.cost ?? 0), 0);
    const remaining = limit - spent;
    if (remaining <= 0) continue;
    const px = remaining / canvas.dimensions.distance * canvas.dimensions.size;
    const { x, y } = token.center; // live sprite position: refreshToken redraws while it animates
    if (typeof g.circle === "function") g.circle(x, y, px).fill({ color: 0x44aaff, alpha: 0.08 }).stroke({ width: 2, color: 0x44aaff, alpha: 0.8 }); // PIXI 8
    else g.lineStyle(2, 0x44aaff, 0.8).beginFill(0x44aaff, 0.08).drawCircle(x, y, px).endFill(); // PIXI 7
  }
  canvas.interface.addChild(g);
  reach = g;
}

/**
 * Foundry's turn marker (v13+) shows on the current combatant only; a shared turn shows it on every member. Wrapper body for
 * Token#_refreshTurnMarker (MIXED): a member that is not Foundry's current combatant gets the same marker core would give it
 * (child at index 0, registered in canvas.tokens.turnMarkers so the layer animates it, drawn); anything else is core's call.
 */
export function refreshTurnMarker(token, wrapped) {
  const combat = game.combat;
  const c = combatantFor(combat, token.id, token.document?.parent?.id ?? canvas?.scene?.id);
  const member = !!c && combat.combatant?.id !== c.id && activeIds(combat).has(c.id);
  const enabled = !!CONFIG.Combat?.settings?.turnMarker?.enabled && token.document?.turnMarker?.mode !== CONST.TOKEN_TURN_MARKER_MODES?.DISABLED;
  const Marker = foundry.canvas?.placeables?.tokens?.TokenTurnMarker;
  if (!member || !enabled || !Marker) return wrapped();
  if (!token.turnMarker) token.turnMarker = token.addChildAt(new Marker(token), 0);
  canvas.tokens.turnMarkers.add(token);
  token.turnMarker.draw();
}

/** Initiative count 20, losing ties: the lair acts before the first group (or turn, without shared turns) that starts below 20, and at
 *  the top of the round when nobody is below 20. Returns the turn index the lair precedes. */
export function lairTurn(combat, grouped = true) {
  const turns = combat.turns ?? [];
  const i0 = turns.findIndex((c) => !((c.initiative ?? 0) >= 20));
  if (i0 < 0) return 0;
  if (!grouped) return i0;
  const groups = groupsOf(combat), ts = turnsOf(combat);
  for (let i = i0; i < turns.length; i++) if (!groupOf(groups, ts[i].id) || isGroupStart(groups, ts, i, skipDefeated(combat))) return i; // a lone combatant is its own start
  return 0;
}

/** Core only flags the current combatant's token and the tokens already marked: ask every token to look again when the group changes. */
export function refreshTurnMarkers() {
  if (!canvas?.ready) return;
  for (const t of canvas.tokens?.placeables ?? []) t.renderFlags?.set?.({ refreshTurnMarker: true });
}

export function registerTurns() {
  if (typeof libWrapper !== "undefined") {
    libWrapper.register(MODULE_ID, "foundry.canvas.placeables.Token.prototype._refreshTurnMarker", function (wrapped, ...args) { return refreshTurnMarker(this, () => wrapped(...args)); }, "MIXED");
  }
  for (const h of ["combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady", "createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, safe(refreshTurnMarkers)); // the effects: a dead status (Midi's at 0 hp) defeats without touching the combatant
  Hooks.on("combatTurn", safeSync(onCombatTurn));
  Hooks.on("combatTurnChange", safe(onCombatTurnChange));
  Hooks.on("updateCombatant", safe(onUpdateCombatant));
  Hooks.on("renderTokenHUD", safeSync(onRenderTokenHUD));
  Hooks.on("preMoveToken", safeSync(onPreMoveToken)); // sync: a Promise would never veto
  Hooks.on("dnd5e.postUseActivity", safe(onPostUseActivity));
  Hooks.on("midi-qol.preTargetingV2", safe(onPreTargetingTurns));
  // moveToken fires before the sprite moves; follow the animation instead.
  Hooks.on("refreshToken", safeSync((token, flags) => {
    if (!flags?.refreshPosition) return;
    const c = combatantFor(game.combat, token.id, canvas?.scene?.id);
    if (c && activeIds(game.combat).has(c.id)) drawReach();
  }));
  for (const h of ["combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady", "sightRefresh", "createActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(h, safe(drawReach));
  }
  log("turns on");
}
