// Feature 2 hooks against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { warn: [], chat: [], cleared: [], flags: [] };
const hookCalls = [];
globalThis.Hooks = { once() {}, on() {}, callAll: (name, ...a) => hookCalls.push([name, ...a]) };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) } };
globalThis.canvas = null;
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = {
  time: { turnTime: 6, roundTime: 60 },
  Token: { movement: { actions: { walk: {}, fly: {}, blink: { teleport: true } } } },
  DND5E: { movementTypes: { walk: {}, fly: { walkFallback: false }, swim: { walkFallback: true } } }
};
const settings = { lockGmMovement: false, dashNames: "Dash, Carrera" };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: false }, users: [],
  settings: { get: (m, k) => settings[k], set() {}, settings: new Map() },
  modules: { get: () => ({}) },
  combat: null
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => "enemies" } } }, utils: { escapeHTML: (s) => s } };

function combatant(id, disposition, { dash = false, speeds = { walk: 30 }, defeated = false, actor = null } = {}) {
  const flags = { "bg3-flow": { dash } };
  const token = { id: `tok-${id}`, disposition, clearMovementHistory: async () => calls.cleared.push(id) };
  return {
    id, tokenId: `tok-${id}`, sceneId: "scene", flags, token, isDefeated: defeated,
    actor: actor ?? { id: `act-${id}`, system: { attributes: { movement: { speeds } } } },
    getFlag: (m, k) => flags[m]?.[k],
    setFlag: async (m, k, v) => { flags[m][k] = v; calls.flags.push([id, k, v]); },
    unsetFlag: async (m, k) => { delete flags[m][k]; calls.flags.push([id, k, undefined]); }
  };
}
function combat(order, turn) {
  const turns = order;
  return { started: true, round: 1, turn, turns, combatants: turns, settings: { skipDefeated: true }, get combatant() { return turns[turn]; } };
}
const tokenDoc = (c) => ({ id: c.tokenId, parent: { id: "scene" }, actor: c.actor, movementAction: "walk" });
const move = ({ action = "walk", cost = 10, pending = 0, spent = 0 } = {}) => ({
  passed: { cost, waypoints: [{ action }] }, pending: { cost: pending, waypoints: [] }, history: { cost: spent }
});

const { onCombatTurn, onCombatTurnChange, onPreMoveToken, onPostUseActivity, onPreTargetingTurns, drawReach, registerTurns, refreshTurnMarker, refreshTurnMarkers, activeIds, lairTurn } = await import("../scripts/turns.js");

const cleric = combatant("c", 1), rogue = combatant("r", 1), g1 = combatant("g1", -1), g2 = combatant("g2", -1);

test("combatTurn forward from a group's first member jumps past the group", () => {
  const cb = combat([cleric, rogue, g1, g2], 0);
  const upd = { round: 1, turn: 1 };
  onCombatTurn(cb, upd, { direction: 1 });
  assert.deepEqual(upd, { round: 1, turn: 2 });
});

test("combatTurn with no group leaves updateData alone", () => {
  const cb = combat([cleric, g1, rogue], 0);
  const upd = { round: 1, turn: 1 };
  onCombatTurn(cb, upd, { direction: 1 });
  assert.deepEqual(upd, { round: 1, turn: 1 });
});

test("preMoveToken vetoes a player's token outside the active set", () => {
  game.combat = combat([cleric, rogue, g1, g2], 2);
  calls.warn = [];
  assert.equal(onPreMoveToken(tokenDoc(cleric), move()), false);
  assert.deepEqual(calls.warn, ["BG3FLOW.Turns.NotYourTurn"]);
});

test("preMoveToken allows a group mate on the shared turn within budget", () => {
  game.combat = combat([cleric, rogue, g1, g2], 0);
  assert.equal(onPreMoveToken(tokenDoc(rogue), move({ cost: 20, spent: 10 })), undefined);
});

test("preMoveToken vetoes over budget, dash doubles", () => {
  game.combat = combat([cleric, rogue, g1, g2], 0);
  calls.warn = [];
  assert.equal(onPreMoveToken(tokenDoc(rogue), move({ cost: 25, spent: 10 })), false);
  assert.match(calls.warn[0], /BG3FLOW.Turns.NoMovement/);
  const dasher = combatant("d", 1, { dash: true });
  game.combat = combat([dasher, cleric], 0);
  assert.equal(onPreMoveToken(tokenDoc(dasher), move({ cost: 25, spent: 30 })), undefined);
});

test("preMoveToken ignores teleports, GM when lock is off, and tokens outside combat", () => {
  game.combat = combat([cleric, rogue, g1, g2], 2);
  assert.equal(onPreMoveToken(tokenDoc(cleric), move({ action: "blink" })), undefined);
  game.user.isGM = true;
  assert.equal(onPreMoveToken(tokenDoc(cleric), move()), undefined);
  game.user.isGM = false;
  assert.equal(onPreMoveToken({ id: "stranger", parent: { id: "scene" } }, move()), undefined);
});

test("combatTurnChange on a GM that is not the lead GM does nothing: one chat line however many GMs", async () => {
  game.user.isGM = true; game.users.activeGM = { isSelf: false };
  const cb = combat([g1, g2, cleric, rogue], 2);
  calls.cleared = []; calls.chat = [];
  await onCombatTurnChange(cb, { turn: 1 }, { turn: 2, combatantId: "c" });
  assert.deepEqual(calls.cleared, []);
  assert.equal(calls.chat.length, 0);
  game.user.isGM = false;
});

test("combatTurnChange at a group start clears members' histories and dash, posts one message", async () => {
  game.user.isGM = true; game.users.activeGM = { isSelf: true };
  const dasher = combatant("r2", 1, { dash: true });
  const cb = combat([g1, g2, cleric, dasher], 2);
  calls.cleared = []; calls.chat = []; calls.flags = [];
  await onCombatTurnChange(cb, { turn: 1 }, { turn: 2, combatantId: "c" });
  assert.deepEqual(calls.cleared, ["c", "r2"]);
  assert.deepEqual(calls.flags, [["r2", "dash", undefined]]);
  assert.equal(calls.chat.length, 1);
  calls.cleared = []; calls.chat = [];
  await onCombatTurnChange(cb, { turn: 2 }, { turn: 3, combatantId: "r2" });
  assert.deepEqual(calls.cleared, []);
  assert.equal(calls.chat.length, 0);
  game.user.isGM = false;
});

test("postUseActivity flags Dash on the actor's combatant by item name", async () => {
  game.combat = combat([cleric, rogue], 0);
  calls.flags = [];
  await onPostUseActivity({ item: { name: "carrera" }, actor: rogue.actor });
  assert.deepEqual(calls.flags, [["r", "dash", true]]);
  await onPostUseActivity({ item: { name: "Fireball" }, actor: rogue.actor });
  assert.equal(calls.flags.length, 1);
});

test("combatTurn round wrap goes through combatRound with a full round of world time", () => {
  const cb = combat([g1, cleric, rogue], 1);
  const upd = { round: 1, turn: 2 }, opts = { direction: 1, worldTime: { delta: 6 } };
  hookCalls.length = 0;
  onCombatTurn(cb, upd, opts);
  assert.deepEqual(upd, { round: 2, turn: 0 });
  assert.equal(opts.worldTime.delta, 60);
  assert.deepEqual(hookCalls.map((h) => h[0]), ["combatRound"]);
});

test("combatTurn forward lands past a defeated combatant", () => {
  const dead = combatant("dead", 1, { defeated: true });
  const cb = combat([g1, g2, dead, rogue], 1);
  const upd = { round: 1, turn: 2 };
  onCombatTurn(cb, upd, { direction: 1 });
  assert.equal(upd.turn, 3);
});

test("postUseActivity flags the combatant whose actor is the very same object (unlinked tokens share ids)", async () => {
  const shared = { id: "act-gob", system: { attributes: { movement: { speeds: { walk: 30 } } } } };
  const twin = { ...shared };
  const a = combatant("ga", -1, { actor: shared }), b = combatant("gb", -1, { actor: twin });
  game.combat = combat([a, b], 0);
  calls.flags = [];
  await onPostUseActivity({ item: { name: "Dash" }, actor: twin });
  assert.deepEqual(calls.flags, [["gb", "dash", true]]);
});

test("drawReach survives a circle already destroyed by a scene change", () => {
  let made = [];
  globalThis.PIXI = { Graphics: class { destroyed = false; destroy() { if (this.destroyed) throw new Error("destroyed twice"); this.destroyed = true; } } };
  globalThis.canvas = { ready: true, tokens: { controlled: [] }, scene: { id: "scene" }, interface: { addChild: (g) => made.push(g) }, dimensions: { distance: 5, size: 100 } };
  game.combat = combat([cleric, rogue], 0);
  drawReach();
  made[0].destroyed = true; // the interface layer tore it down
  assert.doesNotThrow(() => drawReach());
  assert.equal(made.length, 2);
  globalThis.canvas = null;
});

test("a refused move warns once even when Foundry asks twice", () => {
  const fresh = combatant("f", 1); // the shared rogue still carries Dash from an earlier test
  game.combat = combat([cleric, fresh, g1], 0);
  calls.warn = [];
  const mv = move({ cost: 15, spent: 25 });
  onPreMoveToken(tokenDoc(fresh), mv);
  onPreMoveToken(tokenDoc(fresh), mv);
  assert.equal(calls.warn.length, 1);
});

test("preTargetingV2: a shared-turn member's attack is not an opportunity attack for Midi", async () => {
  game.combat = combat([g1, g2, cleric], 0); // Goblin 1 is Foundry's current combatant, Goblin 2 shares the turn
  const usage = { midiOptions: {} };
  await onPreTargetingTurns({ workflow: { actor: g2.actor }, usage });
  assert.equal(usage.midiOptions.proceedChecks.checkAoO, false);
  const outside = { midiOptions: {} };
  await onPreTargetingTurns({ workflow: { actor: cleric.actor }, usage: outside });
  assert.equal(outside.midiOptions.proceedChecks, undefined);
});

test("the circle follows the sprite: redrawn at token.center on refreshToken position changes", () => {
  const circles = [];
  globalThis.PIXI = { Graphics: class { destroyed = false; destroy() { this.destroyed = true; } circle(x, y) { circles.push([x, y]); return this; } fill() { return this; } stroke() { return this; } } };
  const doc = { ...tokenDoc(rogue), movementHistory: [] };
  const token = { id: rogue.tokenId, document: doc, center: { x: 550, y: 1050 }, controlled: true, visible: true };
  globalThis.canvas = { ready: true, tokens: { controlled: [token] }, scene: { id: "scene" }, interface: { addChild() {} }, dimensions: { distance: 5, size: 100 } };
  game.combat = combat([cleric, rogue], 0);
  const hooks = {};
  globalThis.Hooks.on = (name, fn) => { hooks[name] = fn; };
  registerTurns();
  hooks.refreshToken(token, { refreshPosition: true });
  token.center = { x: 550, y: 650 }; // animation frame moved the sprite
  hooks.refreshToken(token, { refreshPosition: true });
  hooks.refreshToken(token, { refreshPosition: false }); // not a position change: no redraw
  assert.deepEqual(circles, [[550, 1050], [550, 650]]);
  globalThis.Hooks.on = () => {};
  globalThis.canvas = null;
});

test("every active token the user can see gets a circle, selected or not; the GM sees them all; hidden enemies stay hidden to players", () => {
  const circles = [];
  globalThis.PIXI = { Graphics: class { destroyed = false; destroy() { this.destroyed = true; } circle(x, y) { circles.push([x, y]); return this; } fill() { return this; } stroke() { return this; } } };
  const tok = (c, center, visible) => ({ id: c.tokenId, document: { ...tokenDoc(c), movementHistory: [] }, center, visible, controlled: false });
  const clericToken = tok(cleric, { x: 150, y: 150 }, true), rogueToken = tok(rogue, { x: 550, y: 1050 }, false);
  globalThis.canvas = { ready: true, tokens: { controlled: [], placeables: [clericToken, rogueToken] }, scene: { id: "scene" }, interface: { addChild() {} }, dimensions: { distance: 5, size: 100 } };
  game.combat = combat([cleric, rogue], 0); // shared turn: both active
  game.user.isGM = false;
  drawReach();
  assert.deepEqual(circles, [[150, 150]]); // the rogue is out of this player's sight
  circles.length = 0; game.user.isGM = true;
  drawReach();
  assert.deepEqual(circles, [[150, 150], [550, 1050]]);
  // a move of any active token redraws, not only a selected one
  const hooks = {};
  globalThis.Hooks.on = (name, fn) => { hooks[name] = fn; };
  registerTurns();
  circles.length = 0;
  hooks.refreshToken(rogueToken, { refreshPosition: true });
  assert.equal(circles.length, 2);
  assert.equal(typeof hooks.sightRefresh, "function"); // vision changes redraw too
  globalThis.Hooks.on = () => {};
  globalThis.canvas = null; game.user.isGM = false;
});


test("the shared-turn chat line leaves GM-hidden tokens out", async () => {
  calls.chat = [];
  game.users = { activeGM: { isSelf: true } };
  const hiddenGoblin = combatant("g2", -1); hiddenGoblin.token.hidden = true; hiddenGoblin.token.name = "Goblin 2";
  const goblin = combatant("g1", -1); goblin.token.name = "Goblin 1";
  const c = combat([goblin, hiddenGoblin], 0);
  c.started = true;
  await onCombatTurnChange(c, { round: 0, turn: null }, { round: 1, turn: 0 });
  assert.ok(calls.chat[0].content.includes("Goblin 1"));
  assert.ok(!calls.chat[0].content.includes("Goblin 2"));
});

// Foundry's turn marker (v13+): core shows it on the current combatant only; the wrapper adds it to the rest of the shared turn.
class MarkerStub { constructor(token) { this.token = token; this.drawn = 0; } draw() { this.drawn++; } destroy() { this.destroyed = true; } }
function markerWorld() {
  globalThis.CONST = { TOKEN_TURN_MARKER_MODES: { DISABLED: 0, DEFAULT: 1, CUSTOM: 2 } };
  CONFIG.Combat = { settings: { turnMarker: { enabled: true } } };
  foundry.canvas = { placeables: { tokens: { TokenTurnMarker: MarkerStub } } };
  globalThis.canvas = { ready: true, scene: { id: "scene" }, tokens: { turnMarkers: new Set(), placeables: [] } };
  const token = (c) => { const t = { id: c.tokenId, document: { parent: { id: "scene" }, turnMarker: { mode: 1 } }, turnMarker: null, added: [], addChildAt(m, i) { this.added.push([m, i]); return m; }, flags: [] }; t.renderFlags = { set: (f) => t.flags.push(f) }; return t; };
  return token;
}
test("a shared-turn member that is not Foundry's current combatant gets its own turn marker, registered for animation and drawn; core is left alone otherwise", () => {
  const token = markerWorld();
  game.combat = combat([cleric, rogue, g1, g2], 0);
  const t = token(rogue);
  let wrapped = 0;
  refreshTurnMarker(t, () => wrapped++);
  assert.ok(t.turnMarker instanceof MarkerStub);
  assert.deepEqual([t.added.length, t.added[0][1], t.turnMarker.drawn, canvas.tokens.turnMarkers.has(t), wrapped], [1, 0, 1, true, 0]);
  refreshTurnMarker(t, () => wrapped++); // again: the same marker, drawn again (as core does), still one child
  assert.deepEqual([t.added.length, t.turnMarker.drawn, wrapped], [1, 2, 0]);
  for (const other of [token(cleric), token(g1)]) { refreshTurnMarker(other, () => wrapped++); assert.equal(other.turnMarker, null); } // the current combatant and another group: core's call
  assert.equal(wrapped, 2);
  CONFIG.Combat.settings.turnMarker.enabled = false;
  refreshTurnMarker(token(rogue), () => wrapped++);
  assert.equal(wrapped, 3); // markers off: core's call (it removes any marker)
  CONFIG.Combat.settings.turnMarker.enabled = true;
  const off = token(rogue); off.document.turnMarker.mode = 0;
  refreshTurnMarker(off, () => wrapped++);
  assert.deepEqual([off.turnMarker, wrapped], [null, 4]); // this token's marker disabled
  game.combat = null;
  refreshTurnMarker(token(rogue), () => wrapped++);
  assert.equal(wrapped, 5);
});
test("refreshTurnMarkers asks every token on the canvas to refresh its marker (core only flags the current one and those already marked)", () => {
  const token = markerWorld();
  const a = token(cleric), b = token(g1);
  canvas.tokens.placeables = [a, b];
  refreshTurnMarkers();
  assert.deepEqual([a.flags, b.flags], [[{ refreshTurnMarker: true }], [{ refreshTurnMarker: true }]]);
  globalThis.canvas = null;
  refreshTurnMarkers(); // no canvas: nothing
});
test("registerTurns wraps Token#_refreshTurnMarker through libWrapper (MIXED) and refreshes the markers on turn changes", () => {
  const regs = [], hooks = [];
  globalThis.libWrapper = { register: (...a) => regs.push(a) };
  const on = Hooks.on; Hooks.on = (name) => hooks.push(name);
  try { registerTurns(); } finally { Hooks.on = on; delete globalThis.libWrapper; }
  assert.deepEqual([regs[0][0], regs[0][1], regs[0][3]], ["bg3-flow", "foundry.canvas.placeables.Token.prototype._refreshTurnMarker", "MIXED"]);
  for (const h of ["combatTurnChange", "combatStart", "deleteCombat", "updateCombatant", "canvasReady", "createActiveEffect", "deleteActiveEffect"]) assert.ok(hooks.includes(h), h);
});

test("a defeated member of the shared turn may not act: left out of activeIds, so its turn marker is core's call (removed)", () => {
  const dead = combatant("dead", -1, { defeated: true });
  const cb = combat([cleric, rogue, g1, dead, g2], 2);
  assert.deepEqual([...activeIds(cb)].sort(), ["g1", "g2"]);
  const token = markerWorld();
  game.combat = cb;
  let wrapped = 0;
  const t = token(dead);
  refreshTurnMarker(t, () => wrapped++);
  assert.deepEqual([t.turnMarker, wrapped], [null, 1]);
});

test("lairTurn: the lair acts before the first group whose leader is below 20 (a group led by a 20+ acts whole first), at the top of the round when nobody is below 20", () => {
  const init = (c, n) => ({ ...c, initiative: n });
  const cb = combat([init(cleric, 22), init(rogue, 18), init(g1, 15), init(g2, 12)], 0);
  assert.equal(lairTurn(cb), 2); // the Rogue is below 20 but shares the Cleric's turn: after that group, before the goblins
  assert.equal(lairTurn(cb, false), 1); // no shared turns: right after the Cleric
  assert.equal(lairTurn(combat([init(cleric, 19), init(rogue, 18), init(g1, 15), init(g2, 12)], 0)), 0);
  assert.equal(lairTurn(combat([init(cleric, 25), init(rogue, 24), init(g1, 21), init(g2, 20)], 0)), 0); // nobody below 20: top of the round
  assert.equal(lairTurn(combat([init(g1, 21), init(cleric, 18), init(rogue, 17)], 0)), 1);
});
