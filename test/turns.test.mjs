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
  user: { isGM: false },
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

const { onCombatTurn, onCombatTurnChange, onPreMoveToken, onPostUseActivity, drawReach } = await import("../scripts/turns.js");

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

test("combatTurnChange at a group start clears members' histories and dash, posts one message", async () => {
  game.user.isGM = true;
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
