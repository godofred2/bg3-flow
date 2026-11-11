// Action economy (piece 6) against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { warn: [], flags: [] };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) } };
globalThis.canvas = null;
globalThis.ChatMessage = { create: async () => {} };
globalThis.CONFIG = { time: { turnTime: 6, roundTime: 60 }, Token: { movement: { actions: { walk: {} } } }, DND5E: { movementTypes: { walk: {} } } };
const settings = { actionEconomy: "players", enableTurns: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: false }, users: { activeGM: { isSelf: true } },
  settings: { get: (m, k) => settings[k], set() {}, settings: new Map() },
  modules: { get: () => ({}) },
  combat: null
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };

const { allowanceOf, costOf, canSpend, spend, FRESH, onPreTargetingEconomy, onRollCompleteEconomy, resetEconomy, drawEconomy } = await import("../scripts/economy.js");

const actor = ({ items = [], fighter = 0, player = true } = {}) => ({ hasPlayerOwner: player, items: items.map((name) => ({ name })), classes: fighter ? { fighter: { system: { levels: fighter } } } : {} });
function combatant(id, disposition, a = actor()) {
  const flags = { "bg3-flow": {} };
  return {
    id, tokenId: `tok-${id}`, sceneId: "scene", flags, isDefeated: false, actor: a,
    token: { id: `tok-${id}`, name: id, disposition, parent: { id: "scene" } },
    getFlag: (m, k) => flags[m]?.[k],
    setFlag: async (m, k, v) => { flags[m][k] = v; calls.flags.push([id, k, v]); },
    unsetFlag: async (m, k) => { delete flags[m][k]; calls.flags.push([id, k, undefined]); }
  };
}
const combat = (order, turn) => ({ started: true, round: 1, turn, turns: order, combatants: order, settings: { skipDefeated: true }, get combatant() { return this.turns[this.turn]; } });
const act = (activation, type = "attack", name = "Longsword") => ({ type, activation: { type: activation }, item: { name } });
const reset = () => { calls.warn = []; calls.flags = []; };

test("allowanceOf: one attack per action; Extra Attack gives two, three with 11 fighter levels, four with 20", () => {
  assert.deepEqual(allowanceOf(actor()), { attacks: 1 });
  assert.deepEqual(allowanceOf(actor({ items: ["Extra Attack"], fighter: 5 })), { attacks: 2 });
  assert.deepEqual(allowanceOf(actor({ items: ["Ataque adicional"] })), { attacks: 2 });
  assert.deepEqual(allowanceOf(actor({ items: ["Extra Attack"], fighter: 11 })), { attacks: 3 });
  assert.deepEqual(allowanceOf(actor({ items: ["Extra Attack"], fighter: 20 })), { attacks: 4 });
});

test("costOf: an action-type attack is an attack of the action (the bonus action in off-hand mode), another action-type use is the whole action, bonus is bonus, the rest is free", () => {
  assert.equal(costOf(act("action")), "attack");
  assert.equal(costOf(act("action"), { attackMode: "offhand" }), "bonus");
  assert.equal(costOf(act("action"), { attackMode: "thrown-offhand" }), "bonus");
  assert.equal(costOf(act("action", "save", "Sacred Flame")), "action");
  assert.equal(costOf(act("bonus", "heal", "Healing Word")), "bonus");
  for (const a of ["reaction", "legendary", "lair", "minute", "special", "", undefined]) assert.equal(costOf(act(a, "utility")), "free", a);
});

test("canSpend/spend: a fighter with Extra Attack swings twice, not three times, and casts nothing after swinging; the bonus action goes once; Action Surge opens a fresh action", () => {
  const two = { attacks: 2 };
  let s = FRESH;
  assert.equal(canSpend(s, "action", two).ok, true);
  assert.equal(canSpend(s, "attack", two).ok, true);
  s = spend(s, "attack", two);
  assert.deepEqual(s, { attacks: 1, action: false, bonus: false, extra: 0 });
  assert.equal(canSpend(s, "action", two).ok, false); // the Attack action is taken: no spell on top
  assert.equal(canSpend(s, "attack", two).ok, true);
  s = spend(s, "attack", two);
  assert.deepEqual(canSpend(s, "attack", two), { ok: false, kind: "action" });
  assert.equal(canSpend(s, "bonus", two).ok, true);
  s = spend(s, "bonus", two);
  assert.deepEqual(canSpend(s, "bonus", two), { ok: false, kind: "bonus" });
  assert.equal(canSpend(s, "free", two).ok, true);
  s = { ...s, extra: 1 }; // Action Surge
  assert.equal(canSpend(s, "attack", two).ok, true);
  s = spend(s, "attack", two); // a fresh action: attacks count from zero again
  assert.deepEqual(s, { attacks: 1, action: false, bonus: true, extra: 0 });
  assert.equal(canSpend(s, "attack", two).ok, true);
  // a caster: one action-type use spends the action, an Action Surge gives another
  let c = spend(FRESH, "action", { attacks: 1 });
  assert.deepEqual(canSpend(c, "action", { attacks: 1 }), { ok: false, kind: "action" });
  c = spend({ ...c, extra: 1 }, "action", { attacks: 1 });
  assert.deepEqual(c, { attacks: 0, action: true, bonus: false, extra: 0 });
});

test("onPreTargetingEconomy: a player whose action is spent is stopped (false, a warning); the GM is warned and goes on; off turn, the autopilot's own targets, no combat and the display setting never stop anyone; an attack passes while the bonus action is free (it may be an off-hand swing)", async () => {
  reset();
  const pc = combatant("pc", 1), gob = combatant("gob", -1, actor({ player: false }));
  const cb = combat([pc, gob], 0);
  game.combat = cb;
  const workflow = { actor: pc.actor, activity: act("action", "save", "Sacred Flame") };
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined); // fresh
  pc.flags["bg3-flow"].economy = { attacks: 0, action: true, bonus: false, extra: 0 };
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), false);
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoAction:{"name":"pc"}']);
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action") }, usage: {} }), undefined); // an attack may be the off-hand swing: the bonus action is free
  pc.flags["bg3-flow"].economy = { attacks: 0, action: true, bonus: true, extra: 0 };
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action") }, usage: {} }), false);
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("bonus", "heal") }, usage: {} }), false);
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("reaction", "utility") }, usage: {} }), undefined); // free
  game.user.isGM = true; reset();
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined); // the GM goes on, warned
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.GmNote:{"name":"pc","kind":"action"}']);
  game.user.isGM = false;
  cb.turn = 1; // the goblins' turn: the PC's use is a reaction or an opportunity attack, Midi's business
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined);
  cb.turn = 0;
  assert.equal(await onPreTargetingEconomy({ workflow, usage: { midiOptions: { targetUuids: ["T.x"] } } }), undefined); // the autopilot decided
  settings.actionEconomy = "display";
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined);
  settings.actionEconomy = "players";
  game.combat = null;
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined);
});

test("onRollCompleteEconomy: a finished use on the actor's turn is spent into the combatant's flag (the attack mode decides off-hand); an aborted one, an off-turn one and the setting off spend nothing; Action Surge grants an extra action", async () => {
  reset();
  const pc = combatant("pc", 1, actor({ items: ["Extra Attack", "Action Surge"], fighter: 5 })), gob = combatant("gob", -1, actor({ player: false }));
  const cb = combat([pc, gob], 0);
  game.combat = cb;
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action"), attackMode: "oneHanded" });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: false, extra: 0 });
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action"), attackMode: "offhand" });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 0 });
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action"), aborted: true });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 0 });
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("special", "utility", "Action Surge") });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 1 });
  cb.turn = 1;
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action") }); // an opportunity attack: not its turn
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 1 });
  cb.turn = 0; settings.actionEconomy = "off";
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action") });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 1 });
  settings.actionEconomy = "players";
  game.combat = null;
});

test("resetEconomy: a turn change clears the new acting group's state (lead GM only); a combat start clears everyone's", async () => {
  reset();
  const pc = combatant("pc", 1), pc2 = combatant("pc2", 1), gob = combatant("gob", -1, actor({ player: false }));
  for (const c of [pc, pc2, gob]) c.flags["bg3-flow"].economy = { attacks: 1, action: false, bonus: true, extra: 0 };
  const cb = combat([pc, pc2, gob], 0);
  game.combat = cb;
  await resetEconomy(cb, { round: 1, turn: 2 }, { round: 2, turn: 0 });
  assert.deepEqual([pc.flags["bg3-flow"].economy, pc2.flags["bg3-flow"].economy, !!gob.flags["bg3-flow"].economy], [undefined, undefined, true]);
  await resetEconomy(cb);
  assert.equal(gob.flags["bg3-flow"].economy, undefined);
  gob.flags["bg3-flow"].economy = { attacks: 1, action: false, bonus: false, extra: 0 };
  game.users.activeGM = { isSelf: false };
  await resetEconomy(cb);
  assert.ok(gob.flags["bg3-flow"].economy); // another GM leads
  game.users.activeGM = { isSelf: true };
  game.combat = null;
});

test("drawEconomy: above every active token the user can see, a filled green dot and orange triangle while available, hollow once spent; nothing without a combat", () => {
  const drawn = [];
  globalThis.PIXI = { Graphics: class { destroyed = false; destroy() { this.destroyed = true; } circle(x, y, r) { drawn.push(["dot", x, y]); return this; } poly(pts) { drawn.push(["tri", pts[0], pts[1]]); return this; } fill(o) { drawn.push(["fill", o.color]); return this; } stroke(o) { drawn.push(["stroke", o.color]); return this; } } };
  const pc = combatant("pc", 1), gob = combatant("gob", -1, actor({ player: false }));
  pc.flags["bg3-flow"].economy = { attacks: 1, action: false, bonus: true, extra: 0 }; // one attack of one: action spent; bonus spent
  const cb = combat([pc, gob], 0);
  game.combat = cb;
  const tok = (c, x, y, visible = true) => ({ id: c.tokenId, visible, center: { x, y }, h: 100, w: 100, document: { id: c.tokenId, parent: { id: "scene" } } });
  const added = [];
  globalThis.canvas = { ready: true, scene: { id: "scene" }, dimensions: { size: 100, distance: 5 }, tokens: { placeables: [tok(pc, 150, 150), tok(gob, 450, 150)] }, interface: { addChild: (g) => added.push(g) } };
  drawEconomy();
  assert.deepEqual(drawn.filter((d) => d[0] !== "fill" && d[0] !== "stroke"), [["dot", 138, 90], ["tri", 157, 97]]); // the PC only: the goblin is not in the acting group
  assert.deepEqual(drawn.filter((d) => d[0] === "fill").length, 0); // both spent: outlines only
  drawn.length = 0;
  pc.flags["bg3-flow"].economy = undefined;
  drawEconomy();
  assert.deepEqual(drawn.filter((d) => d[0] === "fill").map((d) => d[1]), [0x3ec15c, 0xff8c1a]); // fresh: filled green dot, filled orange triangle
  game.combat = null; drawn.length = 0;
  drawEconomy();
  assert.deepEqual(drawn, []);
  globalThis.canvas = null;
});
