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

const { allowanceOf, costOf, canSpend, spend, FRESH, onPreTargetingEconomy, onRollCompleteEconomy, onPostUseEconomy, resetEconomy, drawEconomy, hideCost, affordAction, payAction, noteWeapon, dropWeapons, droppedWeapons, onPreUpdateItem, onPreDeleteCommandEffect } = await import("../scripts/economy.js");

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
const act = (activation, type = "attack", name = "Longsword", modes = []) => ({ type, activation: { type: activation }, item: { name, system: { attackModes: modes.map((value) => ({ value })) } } });
const light = ["oneHanded", "offhand", "thrown", "thrown-offhand"]; // a Dagger or a Scimitar
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
  // overspent (the GM going ahead): the state stays spent, no phantom Action Surge
  assert.deepEqual(spend({ attacks: 2, action: false, bonus: false, extra: 0 }, "attack", two), { attacks: 2, action: false, bonus: false, extra: 0 });
  assert.deepEqual(spend(c, "action", { attacks: 1 }), c);
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
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action") }, usage: {} }), false); // a Longsword has no off-hand mode: refused
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action", "attack", "Dagger", light) }, usage: {} }), undefined); // a Dagger may be the off-hand swing: the bonus action is free
  pc.flags["bg3-flow"].economy = { attacks: 0, action: true, bonus: true, extra: 0 }; reset();
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action", "attack", "Dagger", light) }, usage: {} }), false);
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoBonus:{"name":"pc"}']); // the Dagger could only have been the off-hand swing
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("bonus", "heal") }, usage: {} }), false);
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("reaction", "utility") }, usage: {} }), undefined); // free
  game.user.isGM = true; reset();
  assert.equal(await onPreTargetingEconomy({ workflow, usage: {} }), undefined); // the GM goes on, warned
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoAction:{"name":"pc"} BG3FLOW.Economy.GmNote']); // the player's text plus the GM suffix
  pc.flags["bg3-flow"].economy = { attacks: 2, action: false, bonus: true, extra: 0 }; reset();
  assert.equal(await onPreTargetingEconomy({ workflow: { actor: pc.actor, activity: act("action", "attack", "Scimitar", light) }, usage: {} }), undefined);
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoBonus:{"name":"pc"} BG3FLOW.Economy.GmNote']);
  pc.flags["bg3-flow"].economy = { attacks: 0, action: true, bonus: false, extra: 0 }; reset();
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
  const dagger = { actor: pc.actor, activity: act("action", "attack", "Dagger", light), attackRoll: { options: { attackMode: "offhand" } } }; // the mode read from dnd5e's roll at AttackRollComplete
  await onRollCompleteEconomy(dagger);
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 0 });
  await onRollCompleteEconomy(dagger); // RollComplete on the same workflow: paid already
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 0 });
  pc.flags["bg3-flow"].economy = { attacks: 2, action: false, bonus: false, extra: 0 }; // both attacks swung, bonus free
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action", "attack", "Scimitar", light), attackMode: "oneHanded" }); // let through as the off-hand swing: it costs the bonus action
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 2, action: false, bonus: true, extra: 0 });
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action"), attackMode: "oneHanded" }); // the GM going ahead with a Longsword: stays spent
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 2, action: false, bonus: true, extra: 0 });
  pc.flags["bg3-flow"].economy = { attacks: 1, action: false, bonus: true, extra: 0 };
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("action"), aborted: true });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 0 });
  await onRollCompleteEconomy({ actor: pc.actor, activity: act("special", "utility", "Action Surge") });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: true, extra: 1 });
  pc.flags["bg3-flow"].economy = undefined;
  const flame = { actor: pc.actor, activity: act("action", "save", "Sacred Flame") };
  await onPostUseEconomy(flame.activity, { workflow: flame }); // dnd5e.postUseActivity: the card is up, the action is paid now
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 0, action: true, bonus: false, extra: 0 });
  await onRollCompleteEconomy(flame); // seconds later: paid already
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 0, action: true, bonus: false, extra: 0 });
  pc.flags["bg3-flow"].economy = undefined;
  const sword = { actor: pc.actor, activity: act("action") };
  await onPostUseEconomy(sword.activity, { workflow: sword }); // an attack waits for its roll (the mode)
  await onPostUseEconomy(act("action", "save"), {}); // no Midi workflow: not ours
  assert.equal(pc.flags["bg3-flow"].economy, undefined);
  await onRollCompleteEconomy({ ...sword, attackMode: "oneHanded" });
  assert.deepEqual(pc.flags["bg3-flow"].economy, { attacks: 1, action: false, bonus: false, extra: 0 });
  pc.flags["bg3-flow"].economy = { attacks: 1, action: false, bonus: true, extra: 1 };
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
  assert.ok(added[0].zIndex > 200, "above the TokenLayer (zIndex 200) on canvas.interface");
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

test("drawEconomy: on PIXI 7 (Foundry 14.369 ships 7.4.3) the icons are drawn with beginFill/drawCircle/drawPolygon", () => {
  const drawn = [];
  globalThis.PIXI = { Graphics: class { destroyed = false; destroy() { this.destroyed = true; } lineStyle(w, color) { drawn.push(["line", color]); return this; } beginFill(color) { drawn.push(["fill", color]); return this; } endFill() { return this; } drawCircle(x, y, r) { drawn.push(["dot", x, y]); return this; } drawPolygon(pts) { drawn.push(["tri", pts[0], pts[1]]); return this; } } };
  const pc = combatant("pc", 1), gob = combatant("gob", -1, actor({ player: false }));
  game.combat = combat([pc, gob], 0);
  globalThis.canvas = { ready: true, scene: { id: "scene" }, dimensions: { size: 100, distance: 5 }, tokens: { placeables: [{ id: pc.tokenId, visible: true, center: { x: 150, y: 150 }, h: 100, w: 100 }] }, interface: { addChild() {} } };
  drawEconomy();
  assert.deepEqual(drawn.filter((d) => d[0] !== "line"), [["fill", 0x3ec15c], ["dot", 138, 90], ["fill", 0xff8c1a], ["tri", 157, 97]]);
  game.combat = null; globalThis.canvas = null;
});

test("hideCost: the action, or the bonus action with Cunning Action (English or Spanish name)", () => {
  assert.equal(hideCost(actor()), "action");
  assert.equal(hideCost(actor({ items: ["Cunning Action"] })), "bonus");
  assert.equal(hideCost(actor({ items: ["Acción Astuta"] })), "bonus");
});

test("affordAction/payAction: a use outside Midi (the Hide button) on the actor's turn: a player who cannot pay is refused with the economy's text, the GM warned and let through; paid into the flag; free off turn, in display mode and with the economy off", async () => {
  const pc = combatant("pc", 1), cb = combat([pc], 0);
  game.combat = cb; reset();
  assert.equal(affordAction(pc.actor, "action"), true);
  await payAction(pc.actor, "action");
  assert.deepEqual(pc.getFlag("bg3-flow", "economy"), { ...FRESH, action: true });
  assert.equal(affordAction(pc.actor, "action"), false);
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoAction:{"name":"pc"}']);
  assert.equal(affordAction(pc.actor, "bonus"), true); // Cunning Action: the bonus action is still there
  game.user.isGM = true; reset();
  assert.equal(affordAction(pc.actor, "action"), true);
  assert.deepEqual(calls.warn, ['BG3FLOW.Economy.NoAction:{"name":"pc"} BG3FLOW.Economy.GmNote']);
  game.user.isGM = false;
  game.combat = combat([pc, combatant("gob", -1)], 1); reset();
  assert.equal(affordAction(pc.actor, "action"), true); // the goblins' turn: a reaction-time Hide is not counted
  await payAction(pc.actor, "bonus");
  assert.equal(pc.getFlag("bg3-flow", "economy").bonus, false);
  game.combat = cb; settings.actionEconomy = "display"; reset();
  assert.equal(affordAction(pc.actor, "action"), true); // icons only: never refused
  assert.deepEqual(calls.warn, []);
  await payAction(pc.actor, "bonus");
  assert.equal(pc.getFlag("bg3-flow", "economy").bonus, true); // but paid, so the icon empties
  settings.actionEconomy = "off";
  pc.flags["bg3-flow"].economy = { ...FRESH };
  await payAction(pc.actor, "action");
  assert.deepEqual(pc.getFlag("bg3-flow", "economy"), FRESH);
  settings.actionEconomy = "players"; game.combat = null;
});

// Command "drop": the last weapon(s) used go unequipped; equipping one back costs the action (one per weapon).
calls.items = []; calls.chat = [];
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
const weapon = (id, name, equipped = true, flags = {}) => {
  const w = { id, name, type: "weapon", system: { equipped }, flags: { "bg3-flow": { ...flags } }, getFlag: (m, k) => w.flags[m]?.[k],
    update: async (u) => { calls.items.push([id, u]); if ("system.equipped" in u) w.system.equipped = u["system.equipped"]; if (u["flags.bg3-flow.dropped"]) w.flags["bg3-flow"].dropped = true; } };
  return w;
};
const armed = (weapons, player = true) => {
  const a = { hasPlayerOwner: player, name: "pc", items: weapons, classes: {}, flags: { "bg3-flow": {} }, getFlag: (m, k) => a.flags[m]?.[k], setFlag: async (m, k, v) => { a.flags[m][k] = v; } };
  for (const w of weapons) w.actor = a;
  return a;
};
const inTurn = (a, turn = 0) => { const c = combatant("pc", 1, a), g = combatant("g", -1); game.combat = combat([c, g], turn); return c; };

test("noteWeapon: the last two distinct weapons used, newest first, each stamped with the turn; other items are not noted", async () => {
  const sword = weapon("w1", "Longsword"), dagger = weapon("w2", "Dagger"), axe = weapon("w3", "Handaxe"), a = armed([sword, dagger, axe]);
  inTurn(a);
  await noteWeapon({ item: sword, actor: a });
  assert.deepEqual(a.getFlag("bg3-flow", "lastWeapons"), [{ id: "w1", stamp: ":1:0" }]);
  await noteWeapon({ item: dagger, actor: a });
  await noteWeapon({ item: sword, actor: a });
  assert.deepEqual(a.getFlag("bg3-flow", "lastWeapons"), [{ id: "w1", stamp: ":1:0" }, { id: "w2", stamp: ":1:0" }]);
  await noteWeapon({ item: { id: "s1", name: "Fire Bolt", type: "spell" }, actor: a });
  assert.equal(a.getFlag("bg3-flow", "lastWeapons").length, 2);
  game.combat.round = 2;
  await noteWeapon({ item: axe, actor: a });
  assert.deepEqual(a.getFlag("bg3-flow", "lastWeapons"), [{ id: "w3", stamp: ":2:0" }, { id: "w1", stamp: ":1:0" }]);
  game.combat = null;
  await noteWeapon({ item: sword, actor: a }); // out of combat: no stamp
  assert.deepEqual(a.getFlag("bg3-flow", "lastWeapons")[0], { id: "w1", stamp: "" });
});

test("dropWeapons: the weapons used in the latest turn (both when dual wielding) go unequipped and flagged, the table is told; without a note, the equipped weapons (two at most); nothing without weapons", async () => {
  calls.items = []; calls.chat = [];
  const sword = weapon("w1", "Longsword"), dagger = weapon("w2", "Dagger"), a = armed([sword, dagger]);
  inTurn(a);
  a.flags["bg3-flow"].lastWeapons = [{ id: "w2", stamp: ":1:0" }, { id: "w1", stamp: ":1:0" }];
  assert.deepEqual((await dropWeapons(a)).map((w) => w.id), ["w2", "w1"]);
  assert.deepEqual(calls.items, [["w2", { "system.equipped": false, "flags.bg3-flow.dropped": true }], ["w1", { "system.equipped": false, "flags.bg3-flow.dropped": true }]]);
  assert.deepEqual(calls.chat, [{ content: 'BG3FLOW.Economy.Dropped:{"name":"pc","weapons":"Dagger, Longsword"}' }]);
  assert.deepEqual(droppedWeapons(a).map((w) => w.id), ["w1", "w2"]); // inventory order
  calls.items = [];
  const b = armed([weapon("w1", "Longsword"), weapon("w2", "Dagger")]);
  b.flags["bg3-flow"].lastWeapons = [{ id: "w2", stamp: ":2:0" }, { id: "w1", stamp: ":1:0" }]; // the dagger alone this turn
  assert.deepEqual((await dropWeapons(b)).map((w) => w.id), ["w2"]);
  const c = armed([weapon("w1", "Longsword"), weapon("w2", "Dagger", false), weapon("w3", "Handaxe"), weapon("w4", "Club")]);
  assert.deepEqual((await dropWeapons(c)).map((w) => w.id), ["w1", "w3"]); // no note: what it holds, two at most
  calls.chat = [];
  assert.deepEqual(await dropWeapons(armed([])), []);
  assert.deepEqual(calls.chat, []);
  game.combat = null;
});

test("onPreUpdateItem: equipping a dropped weapon on the actor's turn costs the action (refused when it is spent), out of turn is refused, out of combat it is free; the dropped flag is cleared with the update; other items are untouched", async () => {
  reset(); calls.items = [];
  const sword = weapon("w1", "Longsword", false, { dropped: true }), a = armed([sword]);
  const c = inTurn(a);
  let changes = { system: { equipped: true } };
  assert.equal(onPreUpdateItem(sword, changes), undefined);
  assert.deepEqual(changes.flags, { "bg3-flow": { "-=dropped": null } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(canSpend(c.getFlag("bg3-flow", "economy"), "action", allowanceOf(a)).ok, false); // the action went on the pick-up
  changes = { "system.equipped": true };
  assert.equal(onPreUpdateItem(sword, changes), false); // a second weapon: no action left
  assert.deepEqual(calls.warn.at(-1), 'BG3FLOW.Economy.NoAction:{"name":"pc"}');
  game.user.isGM = true; calls.warn = [];
  assert.equal(onPreUpdateItem(sword, { system: { equipped: true } }), undefined); // the GM is warned and goes ahead
  assert.match(calls.warn.at(-1), /GmNote/);
  game.user.isGM = false;
  game.combat.turn = 1; calls.warn = []; // the goblin's turn
  assert.equal(onPreUpdateItem(sword, { system: { equipped: true } }), false);
  assert.deepEqual(calls.warn, ["BG3FLOW.Turns.NotYourTurn"]);
  game.combat = null; changes = { system: { equipped: true } };
  assert.equal(onPreUpdateItem(sword, changes), undefined); // out of combat: free
  assert.deepEqual(changes.flags, { "bg3-flow": { "-=dropped": null } });
  const plain = weapon("w2", "Dagger", false); changes = { system: { equipped: true } };
  assert.equal(onPreUpdateItem(plain, changes), undefined);
  assert.equal(changes.flags, undefined);
  assert.equal(onPreUpdateItem(sword, { system: { equipped: false } }), undefined); // unequipping is never the module's business
});

test("onPreDeleteCommandEffect: a player character under Command \"drop\" drops its weapons when the effect expires on its turn; other words, other turns and monsters (the autopilot's) are left alone", async () => {
  calls.items = [];
  const sword = weapon("w1", "Longsword"), a = armed([sword]);
  inTurn(a);
  const fx = (word, parent) => ({ flags: { "gambits-premades": { commandWord: word } }, parent });
  await onPreDeleteCommandEffect(fx("Halt", a));
  assert.deepEqual(calls.items, []);
  await onPreDeleteCommandEffect(fx("suelta", a));
  assert.deepEqual(calls.items.map(([id, u]) => [id, u["system.equipped"]]), [["w1", false]]);
  calls.items = []; sword.system.equipped = true; delete sword.flags["bg3-flow"].dropped;
  game.combat.turn = 1;
  await onPreDeleteCommandEffect(fx("Drop", a)); // not its turn: the DM's hand, not an expiry
  assert.deepEqual(calls.items, []);
  const m = armed([weapon("w9", "Scimitar")], false);
  game.combat = combat([combatant("m", -1, m)], 0);
  await onPreDeleteCommandEffect(fx("Drop", m)); // a monster: the autopilot drops on its turn
  assert.deepEqual(calls.items, []);
  game.combat = null;
});
