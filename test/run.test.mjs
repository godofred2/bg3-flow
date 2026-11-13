// Piece 4: autopilot execution against stubbed Foundry globals (plans and boards injected).
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { chat: [], hooks: [], render: 0 };
const hookFns = {};
globalThis.Hooks = { once() {}, on: (name, fn) => { calls.hooks.push(name); hookFns[name] = fn; return 1; }, off: (name) => { delete hookFns[name]; }, callAll: (name, ...a) => hookFns[name]?.(...a) };
globalThis.ui = { notifications: { info() {}, warn() {} }, controls: { render() {} }, combat: { render: () => calls.render++ } };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = { time: { turnTime: 6, roundTime: 60 }, Token: { movement: { actions: { walk: {} } } }, DND5E: { movementTypes: { walk: {} } } };
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { ready: true, scene: { id: "scene", tokens: { contents: [] } } };
const settings = { pauseBeforeAttack: false, autoNextTurn: true, intelligenceThreshold: 6, enableTurns: true, autoRecharge: "no", lairActions: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { id: "gm", isGM: true }, users: { activeGM: { isSelf: true } }, combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }, modules: { get: () => ({}) }
};

let order = [], moves = [], uses = [], places = [];
function combatant(id, { disposition = -1, auto = true, defeated = false, playerOwner = false } = {}) {
  const flags = { "bg3-flow": auto ? {} : { autopilot: false } };
  return {
    id, flags, isDefeated: defeated, actor: { hasPlayerOwner: playerOwner },
    getFlag: (m, k) => flags[m]?.[k], setFlag: async (m, k, v) => { flags[m][k] = v; }, unsetFlag: async (m, k) => { delete flags[m][k]; },
    token: { id: `tok-${id}`, name: id, disposition, parent: { id: "scene" }, clearMovementHistory: async () => order.push(`clear ${id}`),
      move: async (wp, opts) => { order.push(`move ${id}`); moves.push([id, wp, opts]); return true; } }
  };
}
function makeCombat(turns, turn = 0) {
  const c = { id: "cmb", started: true, round: 1, turn, turns, combatants: turns, nextTurns: 0, nextTurn: async () => { c.nextTurns++; c.turn++; } };
  c.combatants.get = (id) => turns.find((t) => t.id === id);
  Object.defineProperty(c, "combatant", { get: () => c.turns[c.turn] });
  game.combat = c;
  return c;
}
const sc = { id: "sc", uuid: "A.sc", name: "Scimitar", kind: "attack", slot: "action", range: 5, bonus: 4, damage: 5 };
const enemy = (id, hp = 10, visible = true) => ({ id, uuid: `T.${id}`, name: id, hp, maxHp: 10, ac: 15, saves: {}, distance: 5, visible });
const hw = { id: "hw", uuid: "A.hw", name: "Healing Word", kind: "heal", slot: "bonus", range: 60, healing: 4.5, affects: "creature" };
const fb = { id: "fb", uuid: "A.fb", name: "Fireball", kind: "save", slot: "action", range: 150, dc: 13, saveAbility: "dex", onSave: "half", damage: 28, area: { shape: "sphere", size: 20 }, affects: "creature" };
const boardFor = (c, enemies, allies = []) => ({ me: { id: c.id, name: c.id, intelligence: 10, hp: 7, maxHp: 7, x: 0, y: 0, elevation: 0, cx: 50, cy: 50, w: 1, budget: 30 }, enemies, allies, activities: [sc, hw, fb], multiattack: null, paths: {}, retreats: [], grid: { px: 100, ft: 5 }, reserved: new Set(), threshold: 6 });
const attackPlan = (target = "rogue", n = 1) => ({ move: { x: 400, y: 0, elevation: 0, waypoints: [{ x: 200, y: 0, elevation: 0 }, { x: 400, y: 0, elevation: 0 }] }, actions: Array(n).fill({ activityId: "sc", targetIds: [target] }), reason: `Scimitar vs ${target} (expected 2.5)` });
const approachPlan = { move: { x: 200, y: 0, elevation: 0 }, actions: [], reason: "approach rogue" };
const emptyPlan = { move: null, actions: [], reason: "no visible enemy" };
function deps({ plans, bonus = {}, enemies = () => [enemy("rogue")], allies = () => [], use, pause } = {}) {
  return {
    snap: async (combat, c) => boardFor(c, enemies(), allies()),
    plan: (board, opts) => (opts?.slot === "bonus" ? bonus[board.me.id] ?? { move: null, actions: [], reason: "no bonus action" } : plans[board.me.id]),
    use: use ?? (async (a, uuids, place) => { uses.push([a.id, String(uuids)]); order.push(`use ${uuids}`); places.push(place); return {}; }),
    pause: pause ?? (async () => "execute")
  };
}
function reset() { order = []; moves = []; uses = []; places = []; calls.chat = []; settings.pauseBeforeAttack = false; settings.autoNextTurn = true; settings.enableTurns = true; settings.autoRecharge = "no"; settings.lairActions = true; game.user.isGM = true; }

const { isAuto, runTurn, runLair, onCombatTurnChange, onRenderCombatTracker, pauseDialog, registerAutopilot, arrive, useActivity, rollRecharge, sentinelWatch, awaitOaRegions, commandOf, onPreDeleteEffect, controlledBy } = await import("../scripts/ai/run.js");

test("isAuto: on unless the flag says false or a player owns the actor", () => {
  assert.equal(isAuto(combatant("g")), true);
  assert.equal(isAuto(combatant("g", { auto: false })), false);
  assert.equal(isAuto(combatant("pc", { disposition: 1, playerOwner: true })), false);
});

test("runTurn: moves the whole group first, then uses actions one by one, whispers the reason, passes the turn", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([g1, g2, pc]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: approachPlan } }));
  assert.deepEqual(order, ["clear g1", "clear g2", "move g1", "move g2", "use T.rogue"]);
  assert.deepEqual(moves[0][1], [{ x: 200, y: 0, elevation: 0, action: "walk" }, { x: 400, y: 0, elevation: 0, action: "walk" }]); // the whole route, not just the destination
  assert.equal(moves[0][2].bg3Autopilot, true);
  assert.deepEqual(calls.chat.map((m) => m.whisper), [["gm"], ["gm"]]);
  assert.ok(calls.chat[0].content.includes("Scimitar vs rogue"));
  assert.equal(combat.nextTurns, 1);
});

test("runTurn: a manual group mate is skipped and the turn is not passed; nothing to do on a player's turn", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2", { auto: false }), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([g1, g2, pc]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() } }));
  assert.deepEqual(order, ["clear g1", "move g1", "use T.rogue"]);
  assert.equal(combat.nextTurns, 0);
  reset();
  await runTurn(makeCombat([pc, g1], 0), deps({ plans: { g1: attackPlan() } }));
  assert.deepEqual(order, []);
});

test("runTurn: pause skip drops the action, take over switches the monster off and keeps the turn", async () => {
  reset(); settings.pauseBeforeAttack = true;
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  const answers = ["skip", "manual"];
  await runTurn(combat, deps({ plans: { g1: attackPlan("rogue", 3) }, pause: async () => answers.shift() }));
  assert.deepEqual(uses, []);
  assert.equal(g1.flags["bg3-flow"].autopilot, false);
  assert.equal(combat.nextTurns, 0);
});

test("runTurn: the target died during a Multiattack: the next use is re-picked, none left drops it", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  let rogueHp = 10;
  const d = deps({ plans: { g1: attackPlan("rogue", 2) }, enemies: () => [enemy("rogue", rogueHp), enemy("wizard")], use: async (a, uuid) => { uses.push([a.id, String(uuid)]); rogueHp = 0; return {}; } });
  await runTurn(combat, d);
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue", "T.wizard"]);
  reset(); rogueHp = 10;
  const alone = deps({ plans: { g1: attackPlan("rogue", 2) }, enemies: () => [enemy("rogue", rogueHp)], use: async (a, uuid) => { uses.push([a.id, String(uuid)]); rogueHp = 0; return {}; } });
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), alone);
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue"]);
});

test("runTurn: a use that throws (or Midi refusing) whispers the error, the next monster still acts, the turn is not passed", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() }, use: async (a, uuid) => { if (order.push(`use ${uuid}`) && uses.push(String(uuid)) === 1) throw new Error("boom"); return {}; } }));
  assert.deepEqual(uses, ["T.rogue", "T.rogue"]);
  assert.ok(calls.chat.some((m) => m.content.includes("Autopilot.Error") && m.content.includes("boom")));
  assert.equal(combat.nextTurns, 0);
  reset();
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: attackPlan() }, use: async () => undefined }));
  assert.ok(calls.chat.some((m) => m.content.includes("Autopilot.Error")));
});

test("runTurn: the GM changed the turn mid-run: no more uses, no next turn", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() }, use: async (a, uuid) => { uses.push(String(uuid)); combat.turn = 2; return {}; } }));
  assert.deepEqual(uses, ["T.rogue"]);
  assert.equal(combat.nextTurns, 0);
});

test("runTurn: an empty plan (nothing in range, budget 0) still passes the turn", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: emptyPlan } }));
  assert.deepEqual([moves, uses, combat.nextTurns], [[], [], 1]);
  reset(); settings.autoNextTurn = false;
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: emptyPlan } }));
  assert.equal(game.combat.nextTurns, 0);
});

test("onCombatTurnChange runs only on the lead GM with a started combat", async () => {
  reset();
  const g1 = combatant("g1");
  let snaps = 0;
  const d = { ...deps({ plans: { g1: emptyPlan } }), snap: async (combat, c) => { snaps++; return boardFor(c, []); } };
  const step = [{ round: 0, turn: null }, { round: 1, turn: 0 }];
  game.users.activeGM.isSelf = false;
  await onCombatTurnChange(makeCombat([g1]), ...step, d);
  assert.equal(snaps, 0);
  game.users.activeGM.isSelf = true;
  await onCombatTurnChange({ ...makeCombat([g1]), started: false }, ...step, d);
  assert.equal(snaps, 0);
  await onCombatTurnChange(makeCombat([g1]), ...step, d);
  assert.equal(snaps, 3); // one snapshot before moving, one before acting, one before the bonus action
});

test("onRenderCombatTracker appends an active robot button to NPC rows only, click toggles the flag", async () => {
  const g1 = combatant("g1"), g2 = combatant("g2", { auto: false }), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([g1, g2, pc]);
  const made = [];
  game.user.isGM = false;
  onRenderCombatTracker({ viewed: combat }, { querySelectorAll: () => { throw new Error("players never get the button"); } });
  game.user.isGM = true;
  globalThis.document = { createElement: () => { const el = { classes: new Set(), listeners: {}, classList: { add: (...c) => c.forEach((x) => el.classes.add(x)), toggle: (c, on) => on ? el.classes.add(c) : el.classes.delete(c) }, dataset: {}, setAttribute(k, v) { el[k] = v; }, addEventListener: (ev, fn) => { el.listeners[ev] = fn; } }; made.push(el); return el; } };
  const rows = [g1, g2, pc].map((c) => { const controls = { children: [], append: (el) => controls.children.push(el) }; return { dataset: { combatantId: c.id }, querySelector: (s) => s === ".combatant-controls" ? controls : null, controls }; });
  const html = { querySelectorAll: () => rows };
  onRenderCombatTracker({ viewed: combat }, html);
  assert.deepEqual(rows.map((r) => r.controls.children.length), [1, 1, 0]);
  assert.ok(rows[0].controls.children[0].classes.has("active"));
  assert.ok(!rows[1].controls.children[0].classes.has("active"));
  const ev = { preventDefault() {}, stopPropagation() {} };
  await rows[0].controls.children[0].listeners.click(ev);
  assert.equal(g1.flags["bg3-flow"].autopilot, false);
  await rows[1].controls.children[0].listeners.click(ev);
  assert.equal(g2.flags["bg3-flow"].autopilot, true); // explicit: a legendary monster (off by default) can be switched on the same way
});

test("pauseDialog maps a closed dialog to skip", async () => {
  foundry.applications.api.DialogV2.wait = async () => null;
  assert.equal(await pauseDialog({ name: "g1", reason: "x" }), "skip");
  foundry.applications.api.DialogV2.wait = async () => "manual";
  assert.equal(await pauseDialog({ name: "g1", reason: "x" }), "manual");
});

test("registerAutopilot hooks combatTurnChange and renderCombatTracker and re-renders the tracker", () => {
  calls.hooks = []; calls.render = 0;
  registerAutopilot();
  for (const h of ["combatTurnChange", "renderCombatTracker"]) assert.ok(calls.hooks.includes(h), h);
  assert.equal(calls.render, 1);
});

test("lang files carry every Autopilot and settings key the module uses", async () => {
  const { readFileSync } = await import("node:fs");
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url))).BG3FLOW;
  const es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url))).BG3FLOW;
  for (const k of ["enableAutopilot", "pauseBeforeAttack", "autoNextTurn", "intelligenceThreshold", "fleeEnabled", "fleeThreshold", "escapeRegionName"]) { assert.ok(en.Settings[k]?.Name && en.Settings[k]?.Hint, k); assert.ok(es.Settings[k]?.Name && es.Settings[k]?.Hint, k); }
  for (const k of ["Toggle", "Decision", "Error", "Escaped", "Command", "UnknownCommand", "Controlled", "Confusion", "Dir"]) { assert.ok(en.Autopilot[k], k); assert.ok(es.Autopilot[k], k); }
  for (const k of ["Stumble", "Nothing", "Attack", "NoOne", "Normal"]) { assert.ok(en.Autopilot.Confusion[k], k); assert.ok(es.Autopilot.Confusion[k], k); }
});

test("runTurn: the next turn's monsters are played when the autopilot itself passes the turn", async () => {
  reset();
  const g1 = combatant("g1"), pc = combatant("pc", { disposition: 1, playerOwner: true }), wolf = combatant("wolf", { disposition: 0 }); // not grouped with g1
  const combat = makeCombat([g1, wolf, pc]);
  const d = deps({ plans: { g1: attackPlan(), wolf: attackPlan() } });
  combat.nextTurn = async () => { combat.nextTurns++; combat.turn++; await onCombatTurnChange(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 }, d); }; // Foundry fires the hook inside the update
  await runTurn(combat, d);
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue", "T.rogue"]);
  assert.equal(combat.nextTurns, 2);
});

test("runTurn: after the move, actions come only from where the monster stands (a move that fell short never fires out of reach)", async () => {
  reset();
  const { planTurn } = await import("../scripts/ai/plan.js");
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  const far = () => ({ ...enemy("rogue"), distance: 25 });
  const path = [{ x: 200, y: 0, elevation: 0, cost: 10, distance: 15, occupied: false, waypoints: [{ x: 200, y: 0, elevation: 0 }] }, { x: 400, y: 0, elevation: 0, cost: 20, distance: 5, occupied: false, waypoints: [{ x: 200, y: 0, elevation: 0 }, { x: 400, y: 0, elevation: 0 }] }];
  const d = { ...deps({ plans: {} }), plan: planTurn, snap: async (c, m) => ({ ...boardFor(m, [far()]), paths: { rogue: path } }) }; // the snapshot after the move still shows the rogue 25 ft away: the move fell short
  await runTurn(combat, d);
  assert.equal(moves.length, 1);
  assert.deepEqual(uses, []);
  assert.ok(!calls.chat.some((m) => m.content.includes("Autopilot.Error")));
});

test("onCombatTurnChange ignores a step backwards (previous turn) and plays a step forward or a new round", async () => {
  reset();
  const g1 = combatant("g1");
  let snaps = 0;
  const d = { ...deps({ plans: { g1: emptyPlan } }), snap: async (combat, c) => { snaps++; return boardFor(c, []); } };
  await onCombatTurnChange(makeCombat([g1]), { round: 1, turn: 1 }, { round: 1, turn: 0 }, d);
  await onCombatTurnChange(makeCombat([g1]), { round: 2, turn: 0 }, { round: 1, turn: 0 }, d);
  assert.equal(snaps, 0);
  await onCombatTurnChange(makeCombat([g1]), { round: 1, turn: 2 }, { round: 2, turn: 0 }, d);
  await onCombatTurnChange(makeCombat([g1]), { round: 0, turn: null }, { round: 1, turn: 0 }, d);
  assert.equal(snaps, 6); // three per played turn
});

test("runTurn: with BG3 turn flow off only the current combatant acts", async () => {
  reset(); settings.enableTurns = false;
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() } }));
  assert.deepEqual(order, ["clear g1", "move g1", "use T.rogue"]);
  assert.equal(combat.nextTurns, 1);
});

test("runTurn: a snapshot that throws while planning the moves whispers the error, the others still act, the turn stays", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  const d = deps({ plans: { g1: attackPlan(), g2: attackPlan() } });
  d.snap = async (c, m) => { if (m.id === "g1") throw new Error("odd activity"); return boardFor(m, [enemy("rogue")]); };
  await runTurn(combat, d);
  assert.deepEqual(order, ["clear g1", "clear g2", "move g2", "use T.rogue"]);
  assert.ok(calls.chat.some((m) => m.content.includes("Autopilot.Error") && m.content.includes("odd activity")));
  assert.equal(combat.nextTurns, 0);
});

test("runTurn: the GM changed the turn while the pause dialog was open: the use does not fire", async () => {
  reset(); settings.pauseBeforeAttack = true;
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: attackPlan() }, pause: async () => { combat.turn = 1; return "execute"; } }));
  assert.deepEqual(uses, []);
  assert.equal(combat.nextTurns, 0);
});

function animating(obj, ms, label) { // Token#movementAnimationPromise: a promise while the sprite moves, null afterwards
  obj.movementAnimationPromise = new Promise((r) => setTimeout(() => { obj.movementAnimationPromise = null; order.push(label); r(); }, ms));
}
test("arrive waits for the token's movement animation (move() resolves before the sprite stops; Token#x is the document's x)", async () => {
  const doc = { x: 400, y: 0, object: { x: 400, y: 0 } };
  animating(doc.object, 15, "sprite arrived");
  order = [];
  await arrive(doc, { poll: 2 });
  order.push("arrive resolved");
  assert.deepEqual(order, ["sprite arrived", "arrive resolved"]);
  await arrive({ x: 1, y: 1, object: null }); // no sprite on this client: nothing to wait for
  const stuck = { x: 400, y: 0, object: { movementAnimationPromise: new Promise(() => {}) } };
  await arrive(stuck, { poll: 1, cap: 5 }); // the cap ends the wait
});

test("runTurn waits for every mover to arrive before the actions and before passing the turn", async () => {
  reset();
  const g1 = combatant("g1");
  g1.token.object = { x: 0, y: 0 };
  g1.token.move = async (wp) => { order.push("move g1"); g1.token.x = wp.at(-1).x; g1.token.y = 0; animating(g1.token.object, 15, "sprite g1"); return true; }; // the document moves at once, the sprite later
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, { ...deps({ plans: { g1: attackPlan() } }), poll: 2 });
  assert.deepEqual(order, ["clear g1", "move g1", "sprite g1", "use T.rogue"]);
});

test("runTurn: a monster at 0 hit points (dropped by an opportunity attack on the way) does nothing more", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  const d = deps({ plans: { g1: attackPlan(), g2: attackPlan() } });
  let moved = false;
  d.snap = async (c, m) => { const b = boardFor(m, [enemy("rogue")]); if (m.id === "g1" && moved) b.me.hp = 0; return b; };
  g1.token.move = async () => { order.push("move g1"); moved = true; return true; };
  await runTurn(combat, d);
  assert.deepEqual(order, ["clear g1", "clear g2", "move g1", "move g2", "use T.rogue"]);
  assert.ok(!calls.chat.some((m) => m.content.includes("Autopilot.Error")));
  assert.equal(combat.nextTurns, 1);
});

test("an area use sends every covered target to Midi in one call", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: { move: null, actions: [{ activityId: "fb", targetIds: ["rogue", "wiz"], aimId: "wiz" }], reason: "Fireball vs rogue (expected 20.0)" } }, enemies: () => [enemy("rogue"), { ...enemy("wiz"), cx: 650, cy: 50 }] }));
  assert.deepEqual(uses, [["fb", "T.rogue,T.wiz"]]);
  assert.deepEqual(places[0], { origin: { cx: 50, cy: 50, w: 1 }, aim: { cx: 650, cy: 50 } }); // where the template goes
});

test("useActivity: no configuration dialog, the target uuids, and no dnd5e template placement", async () => {
  const cfgs = [];
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { cfgs.push([a, cfg, dialog]); return {}; } };
  globalThis.fromUuidSync = (uuid) => ({ uuid });
  await useActivity({ uuid: "A.sc" }, ["T.rogue"]);
  assert.deepEqual(cfgs, [[{ uuid: "A.sc" }, { create: { measuredTemplate: false }, midiOptions: { targetUuids: ["T.rogue"], ignoreUserTargets: true, proceedChecks: { checkAoO: false } } }, { configure: false }]]); // never a reaction in Midi's eyes: a lair action comes off-turn
});

test("useActivity on an area builds the template data itself (no dnd5e placement API: TemplatePlacement.fromActivity is interactive), hands the region uuid to Midi and deletes an instantaneous one afterwards", async () => {
  const cfgs = [], created = [], deleted = [];
  const activity = { uuid: "A.br", duration: { units: "inst" }, item: { uuid: "I.br", system: { level: 0 } }, actor: { uuid: "Ac.d" }, target: { template: { type: "cone", size: "15", width: "" } } };
  // Midi clones the item and runs the use on the clone's activity, which dnd5e announces through dnd5e.preUseActivity; it reads `templates` on that one.
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { const clone = { uuid: a.uuid }; Hooks.callAll("dnd5e.preUseActivity", clone, cfg, dialog, {}); cfgs.push(cfg); cfgs.templates = clone.templates; cfgs.original = a.templates; return {}; } };
  globalThis.game.user = { ...globalThis.game.user, id: "gm", color: "#ff0000" };
  CONFIG.DND5E.areaTargetTypes = { cone: { template: "cone" }, sphere: { template: "circle" }, cube: { template: "rect" }, line: { template: "ray" }, radius: { template: "emanation" } };
  CONFIG.MeasuredTemplate = { defaults: { angle: 53.13 } };
  settings.gridAlignedSquareTemplates = true;
  globalThis.canvas.dimensions = { size: 100, distance: 5 };
  globalThis.canvas.scene.createEmbeddedDocuments = async (type, [data]) => { created.push([type, data]); return [{ _id: "tpl1", uuid: "Scene.s.MeasuredTemplate.tpl1" }]; };
  globalThis.canvas.scene.regions = { get: (id) => ({ uuid: `Scene.s.Region.${id}` }) };
  globalThis.fromUuidSync = (uuid) => uuid === "A.br" ? activity : uuid.includes("Region") ? { uuid, delete: async () => deleted.push(uuid) } : null;
  await useActivity({ uuid: "A.br", area: { shape: "cone", size: 15, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50, w: 1 }, aim: { cx: 450, cy: 350 } });
  const cone = created[0][1];
  assert.deepEqual([created[0][0], cone.t, Math.round(cone.x), Math.round(cone.y), cone.direction, cone.distance, cone.angle, cone.flags.dnd5e.origin, cone.flags["midi-qol"].actorUuid], ["MeasuredTemplate", "cone", 185, 85, 45, 15, 53.13, "A.br", "Ac.d"]); // from the edge of the caster's space (half a square toward the aim), not its centre
  assert.equal(cfgs[0].midiOptions.workflowOptions.templateUuid, "Scene.s.Region.tpl1");
  assert.deepEqual(cfgs.templates.map((t) => t._id), ["tpl1"]); // the proxy MeasuredTemplate document on the clone Midi works with, as dnd5e's own placement hands it over
  assert.equal(cfgs.original, undefined); // nothing left on the sheet's activity
  assert.equal(hookFns["dnd5e.preUseActivity"], undefined); // the hook lives only for this use
  assert.deepEqual(deleted, ["Scene.s.Region.tpl1"]);
  created.length = 0;
  activity.target.template = { type: "sphere", size: "20", width: "" };
  await useActivity({ uuid: "A.br", area: { shape: "sphere", size: 20, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 350 } });
  assert.deepEqual([created[0][1].t, created[0][1].x, created[0][1].y, created[0][1].distance], ["circle", 450, 350, 20]);
  created.length = 0;
  activity.target.template = { type: "cube", size: "10", width: "" };
  await useActivity({ uuid: "A.br", area: { shape: "cube", size: 10, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 350 } });
  assert.deepEqual([created[0][1].t, created[0][1].x, created[0][1].y, created[0][1].direction, Math.round(created[0][1].distance * 100) / 100, created[0][1].width], ["rect", 350, 250, 45, 14.14, 10]); // grid-aligned cube: from its corner, along the diagonal
  created.length = 0;
  activity.target.template = { type: "line", size: "60", width: "5" };
  await useActivity({ uuid: "A.br", area: { shape: "line", size: 60, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 50 } });
  assert.deepEqual([created[0][1].t, created[0][1].x, created[0][1].direction, created[0][1].width], ["ray", 200, 0, 5]); // half a square ahead of the caster's centre
  activity.duration.units = "minute"; deleted.length = 0;
  await useActivity({ uuid: "A.br", area: { shape: "line", size: 60, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 50 } });
  assert.deepEqual(deleted, []); // a lasting area keeps its template
  delete globalThis.canvas.scene.createEmbeddedDocuments; delete globalThis.canvas.scene.regions;
});

test("the bonus phase runs after the action from a fresh snapshot and whispers its own line", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  const g2 = { id: "g2", uuid: "T.g2", name: "g2", cx: 0, cy: 0, w: 1, hp: 2, maxHp: 7, ac: 15, saves: {}, distance: 30, elevation: 0 };
  await runTurn(combat, deps({ plans: { g1: attackPlan() }, bonus: { g1: { move: null, actions: [{ activityId: "hw", targetIds: ["g2"] }], reason: "Healing Word vs g2 (expected 4.5)" } }, allies: () => [g2] }));
  assert.deepEqual(order.slice(-2), ["use T.rogue", "use T.g2"]);
  assert.equal(calls.chat.filter((m) => m.content.includes("g1")).length, 2);
  assert.equal(combat.nextTurns, 1);
});

test("rollRecharge rolls spent recharge items and activities only when dnd5e's autoRecharge is no", async () => {
  const rolled = [];
  const item = (name, spent, recharge, activities = []) => ({ name, system: { uses: { spent, recovery: recharge ? [{ period: "recharge" }] : [], rollRecharge: async () => rolled.push(name) }, activities } });
  const breathAct = { uses: { spent: 1, recovery: [{ period: "recharge" }], rollRecharge: async () => rolled.push("Act") } };
  const c = combatant("d");
  c.actor.items = [item("Breath", 1, true), item("Bite", 0, false), item("Unspent", 0, true), item("Holder", 0, false, [breathAct])];
  settings.autoRecharge = "no";
  await rollRecharge(c);
  assert.deepEqual(rolled, ["Breath", "Act"]);
  rolled.length = 0; settings.autoRecharge = "silent";
  await rollRecharge(c);
  assert.deepEqual(rolled, []);
});

test("runTurn rolls recharge for its members before planning", async () => {
  reset();
  const g1 = combatant("g1");
  g1.actor.items = [{ name: "Breath", system: { uses: { spent: 1, recovery: [{ period: "recharge" }], rollRecharge: async () => order.push("recharge g1") }, activities: [] } }];
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: emptyPlan } }));
  assert.deepEqual(order.slice(0, 2), ["recharge g1", "clear g1"]);
});

test("a Sentinel hit on a moving member stops its movement; a hit by someone without Sentinel or on a standing member does nothing", async () => {
  const g1 = combatant("g1"), g2 = combatant("g2");
  const stopped = [];
  for (const c of [g1, g2]) c.token.stopMovement = () => stopped.push(c.id);
  const off = sentinelWatch([g1], { g1: boardFor(g1, [{ ...enemy("fighter"), sentinel: true }]) }); // only g1 moves, next to a Sentinel fighter
  const fn = hookFns["midi-qol.RollComplete"];
  assert.equal(typeof fn, "function");
  fn({ actor: { items: [{ name: "Longsword" }] }, hitTargets: new Set([{ id: "tok-g1" }]) });
  assert.deepEqual(stopped, []);
  fn({ actor: { items: [{ name: "sentinel" }] }, hitTargets: new Set([{ document: { id: "tok-g2" } }]) });
  assert.deepEqual(stopped, []);
  fn({ actor: { items: [{ name: "Sentinel" }] }, hitTargets: new Set([{ id: "tok-g1" }]) });
  assert.deepEqual(stopped, ["g1"]);
  off();
  assert.equal(hookFns["midi-qol.RollComplete"], undefined);
});

test("runTurn watches for Sentinel while the group moves and stops watching afterwards", async () => {
  reset();
  const g1 = combatant("g1");
  let seen = null;
  g1.token.move = async () => { order.push("move g1"); seen = [typeof hookFns["midi-qol.RollComplete"], typeof hookFns["updateActor"]]; return true; };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: attackPlan() } }));
  assert.deepEqual(seen, ["function", "function"]);
  assert.equal(hookFns["midi-qol.RollComplete"], undefined);
  assert.equal(hookFns["updateActor"], undefined);
});

test("a Sentinel wielder next to the mover hits it on the player's client: the GM sees the hit points drop and stops the monster; no Sentinel nearby or no drop means no stop", async () => {
  const g1 = combatant("g1"), g2 = combatant("g2");
  g1.actor = { ...g1.actor, id: "act-g1", system: { attributes: { hp: { value: 7 } } } };
  g2.actor = { ...g2.actor, id: "act-g2", system: { attributes: { hp: { value: 7 } } } };
  const stopped = [];
  for (const c of [g1, g2]) c.token.stopMovement = () => stopped.push(c.id);
  const boards = { g1: boardFor(g1, [{ ...enemy("fighter"), sentinel: true, distance: 5 }]), g2: boardFor(g2, [{ ...enemy("rogue"), sentinel: false, distance: 5 }]) };
  const off = sentinelWatch([g1, g2], boards);
  const fn = hookFns["updateActor"];
  fn(g1.actor, { system: { attributes: { hp: { value: 7 } } } }); // no drop
  fn(g2.actor, { system: { attributes: { hp: { value: 1 } } } }); // drop, but nobody with Sentinel next to g2
  assert.deepEqual(stopped, []);
  fn(g1.actor, { system: { attributes: { hp: { value: 2 } } } });
  assert.deepEqual(stopped, ["g1"]);
  off();
});

test("an area use sends covered allies to Midi too, mapped from the allies pool", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  const g2 = { id: "g2", uuid: "T.g2", name: "g2", cx: 550, cy: 50, w: 1, hp: 7, maxHp: 7, ac: 15, saves: {}, distance: 25, elevation: 0 };
  await runTurn(combat, deps({ plans: { g1: { move: null, actions: [{ activityId: "fb", targetIds: ["rogue", "g2"] }], reason: "Fireball vs rogue (expected 10.0)" } }, allies: () => [g2] }));
  assert.deepEqual(uses, [["fb", "T.rogue,T.g2"]]);
});

test("a Sentinel hit that only burns temporary hit points still stops the mover", async () => {
  const g1 = combatant("g1");
  g1.actor = { ...g1.actor, id: "act-g1", system: { attributes: { hp: { value: 7, temp: 15 } } } };
  const stopped = [];
  g1.token.stopMovement = () => stopped.push("g1");
  const b = boardFor(g1, [{ ...enemy("fighter"), sentinel: true, distance: 5 }]);
  b.me.temp = 15;
  const off = sentinelWatch([g1], { g1: b });
  hookFns["updateActor"](g1.actor, { system: { attributes: { hp: { temp: 7 } } } });
  assert.deepEqual(stopped, ["g1"]);
  off();
});

test("a monster that did not move in the movement phase may still move when it acts (its heal target walked away)", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  let calls = 0;
  const d = deps({ plans: {} });
  d.plan = (board, opts) => { if (opts?.slot === "bonus") return { move: null, actions: [], reason: "no bonus action" }; calls++; return calls === 1 ? { move: null, actions: [], reason: "approach rogue" } : attackPlan(); }; // nothing from here at first, a move once it acts
  await runTurn(combat, d);
  assert.deepEqual(order, ["clear g1", "move g1", "use T.rogue"]);
  assert.equal(combat.nextTurns, 1);
});

test("a monster that already moved acts from where it stands even if the fresh plan wants to walk on", async () => {
  reset();
  const g1 = combatant("g1");
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  const d = deps({ plans: { g1: attackPlan() } }); // the same plan with a move every time
  await runTurn(combat, d);
  assert.deepEqual(order.filter((o) => o.startsWith("move")), ["move g1"]);
});

test("after the move a token left off the grid (a reaction stopped it) is snapped to the square under its centre", async () => {
  reset();
  const g1 = combatant("g1");
  const updates = [];
  g1.token.x = 1090; g1.token.y = 400;
  g1.token.getCenterPoint = () => ({ x: 1140, y: 450 });
  g1.token.update = async (u) => updates.push(u);
  globalThis.canvas.grid = { getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), getTopLeftPoint: (o) => ({ x: o.j * 100, y: o.i * 100 }) };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: attackPlan() } }));
  // a displace move (a teleport action): Gambit's opportunity attack regions ignore teleports and the movement veto lets them through; an update would be a walk
  assert.deepEqual([updates, moves.at(-1)[1]], [[], [{ x: 1100, y: 400, elevation: 0, action: "displace" }]]);
  delete globalThis.canvas.grid;
});

test("a use Midi never finishes is given up after the cap, and the template it placed is removed", async () => {
  const deleted = [];
  const activity = { uuid: "A.br", duration: { units: "inst" }, item: { uuid: "I.br", system: { level: 0 } }, actor: { uuid: "Ac.d" }, target: { template: { type: "cone", size: "15", width: "" } } };
  globalThis.MidiQOL = { completeActivityUse: () => new Promise(() => {}) };
  globalThis.canvas.scene.createEmbeddedDocuments = async () => [{ _id: "tpl2", uuid: "Scene.s.MeasuredTemplate.tpl2" }];
  globalThis.canvas.scene.regions = { get: (id) => ({ uuid: `Scene.s.Region.${id}` }) };
  globalThis.fromUuidSync = (uuid) => uuid === "A.br" ? activity : uuid.includes("Region") ? { uuid, delete: async () => deleted.push(uuid) } : null;
  await assert.rejects(() => useActivity({ uuid: "A.br", area: { shape: "cone", size: 15, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 350 } }, { timeout: 10 }), /did not finish/);
  assert.deepEqual(deleted, ["Scene.s.Region.tpl2"]);
  delete globalThis.canvas.scene.createEmbeddedDocuments; delete globalThis.canvas.scene.regions;
});

test("a flee plan sets the Dash flag before the move, whispers the flee reason, and a monster that reached the escape region is marked defeated and hidden with a public line", async () => {
  reset();
  const g1 = combatant("g1"), updates = [];
  g1.update = async (u) => updates.push(["combatant", u]); g1.token.update = async (u) => updates.push(["token", u]); g1.token.getCenterPoint = () => ({ x: 450, y: 50 }); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 1 } } };
  globalThis.fromUuidSync = (uuid) => uuid === "Scene.s.Region.r1" ? { testPoint: (p) => p.x > 400 } : null;
  const fleePlan = { move: { x: 400, y: 0, elevation: 0, waypoints: [{ x: 400, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash toward Escape (hp 1/7)", dash: true, escape: "Scene.s.Region.r1" };
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: fleePlan } }));
  assert.equal(g1.flags["bg3-flow"].dash, true);
  assert.deepEqual(order, ["clear g1", "move g1"]);
  assert.deepEqual(updates, [["combatant", { defeated: true }], ["token", { hidden: true }]]);
  assert.deepEqual(calls.chat.map((m) => [m.whisper ?? "public", m.content.includes("Escaped") || m.content.includes("flee")]), [[["gm"], true], ["public", true]]);
  assert.equal(combat.nextTurns, 1);
});
test("a flight that falls short of the region is not an escape: the monster stays in the fight and still gets its bonus action", async () => {
  reset();
  const g1 = combatant("g1"), updates = [];
  g1.update = async (u) => updates.push(u); g1.token.getCenterPoint = () => ({ x: 250, y: 50 });
  globalThis.fromUuidSync = (uuid) => ({ testPoint: (p) => p.x > 400 });
  const fleePlan = { move: { x: 200, y: 0, elevation: 0, waypoints: [{ x: 200, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash toward Escape (hp 1/7)", dash: true, escape: "Scene.s.Region.r1" };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: fleePlan }, bonus: { g1: { move: null, actions: [{ activityId: "hw", targetIds: ["g1"] }], reason: "Healing Word vs g1" } }, allies: () => [{ id: "g1", uuid: "T.g1", name: "g1", hp: 1, maxHp: 7 }] }));
  assert.deepEqual(updates, []);
  assert.deepEqual(order, ["clear g1", "move g1", "use T.g1"]);
});
test("a move split at Tunnel Fighter triggers runs segment by segment, prompts the PC's owner after each, continues on a miss and stops after a Sentinel hit", async () => {
  reset();
  const g1 = combatant("g1"); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 7 } } };
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: true, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const asks = [], hits = [false, true];
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 200, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => ({ id: "p1" }); d.wait = (p) => p;
  d.ask = async (userId, actorUuid, activityUuid, targetUuid) => { asks.push([userId, actorUuid, activityUuid, targetUuid]); return { hit: hits[asks.length - 1] }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(asks, [["p1", "Actor.f", "A.ls", "T.g1"], ["p1", "Actor.f", "A.ls", "T.g1"]]);
  assert.deepEqual(moves.map((m) => m[1].at(-1).x), [100, 200]); // the third segment never runs: the Sentinel hit stopped it
  assert.deepEqual(order.filter((o) => o.startsWith("use")), ["use T.fighter"]); // it still acts from where it stands
});
test("a Tunnel Fighter trigger with no connected owner goes straight to the GM's roll; a hit by a PC without Sentinel does not stop the move", async () => {
  reset();
  const g1 = combatant("g1"); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 7 } } };
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: false, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const gmRolls = [];
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => null; d.ask = async () => { throw new Error("no owner"); }; d.gmAttack = async (a, t) => { gmRolls.push([a, t]); return { hit: true }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(gmRolls, [["A.ls", "T.g1"]]);
  assert.deepEqual(moves.map((m) => m[1].at(-1).x), [100, 400]);
});

test("a flight that falls short never attacks afterwards, even when the fresh plan from the new square would (the Dash was the action)", async () => {
  reset();
  const g1 = combatant("g1");
  g1.token.getCenterPoint = () => ({ x: 250, y: 50 });
  globalThis.fromUuidSync = () => ({ testPoint: () => false });
  const fleePlan = { move: { x: 200, y: 0, elevation: 0, waypoints: [{ x: 200, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash toward Escape (hp 1/7)", dash: true, escape: "Scene.s.Region.r1" };
  const d = deps({ plans: {} });
  d.plan = (board, opts) => opts?.slot === "bonus" ? { move: null, actions: [], reason: "no bonus action" } : board.me.budget === 0 ? attackPlan() : fleePlan; // the real planner would shoot from the new square
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(order, ["clear g1", "move g1"]);
  assert.deepEqual(calls.chat.map((m) => m.content.includes("flee")), [true]); // one whisper: the flight
});
test("a segment that left the token short of its square (a Sentinel reaction stopped it) ends the move: no prompt for a square never entered, no further segment", async () => {
  reset();
  const g1 = combatant("g1"); g1.token.uuid = "T.g1"; g1.token.x = 0; g1.token.y = 0; g1.actor.system = { attributes: { hp: { value: 7 } } };
  g1.token.move = async (wp, opts) => { order.push("move g1"); moves.push(["g1", wp, opts]); g1.token.x = 20; return true; }; // stopped 20 px along, far from the segment's end at 100
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: true, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const asks = [];
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => ({ id: "p1" }); d.wait = (p) => p; d.ask = async () => { asks.push(1); return { hit: false }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual([asks, moves.length], [[], 1]);
});
test("a stale Dash flag from the previous turn is cleared before planning; a flight sets it again", async () => {
  reset();
  const g1 = combatant("g1"); g1.flags["bg3-flow"].dash = true;
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: attackPlan() } }));
  assert.equal(g1.flags["bg3-flow"].dash, undefined);
  const g2 = combatant("g2"); g2.flags["bg3-flow"].dash = true; g2.token.getCenterPoint = () => ({ x: 0, y: 0 });
  globalThis.fromUuidSync = () => ({ testPoint: () => false });
  reset();
  await runTurn(makeCombat([g2, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g2: { move: { x: 200, y: 0, elevation: 0 }, actions: [], reason: "flee: Dash away from enemies (hp 1/7)", dash: true, escape: null } } }));
  assert.equal(g2.flags["bg3-flow"].dash, true);
});
test("two monsters passing the same Tunnel Fighter in one shared turn are prompted one after the other, never at once", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  for (const g of [g1, g2]) { g.token.uuid = `T.${g.id}`; g.actor.system = { attributes: { hp: { value: 7 } } }; }
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: false, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const d = deps({ plans: { g1: attackPlan(), g2: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => ({ id: "p1" }); d.wait = (p) => p;
  d.ask = async () => { order.push("ask start"); await new Promise((r) => setTimeout(r, 20)); order.push("ask end"); return { hit: false }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(order.filter((o) => o.startsWith("ask")), ["ask start", "ask end", "ask start", "ask end"]);
});

test("the flee decision is whispered before the monster moves, and only once", async () => {
  reset();
  const g1 = combatant("g1"), seen = [];
  g1.token.move = async () => { seen.push(calls.chat.length); return true; };
  g1.token.getCenterPoint = () => ({ x: 250, y: 50 });
  globalThis.fromUuidSync = () => ({ testPoint: () => false });
  const fleePlan = { move: { x: 200, y: 0, elevation: 0, waypoints: [{ x: 200, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash away from enemies (hp 1/7)", dash: true, escape: null };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: fleePlan } }));
  assert.deepEqual([seen, calls.chat.map((m) => m.content.includes("flee"))], [[1], [true]]);
});

test("the decision is whispered once, before the move, with the toll and the alternatives of the plan that chose it; the re-plan from the new square is silent when it keeps the action", async () => {
  reset();
  const g1 = combatant("g1"), seen = [];
  g1.token.move = async () => { seen.push(calls.chat.length); return true; };
  const full = { move: { x: 100, y: 100, elevation: 0 }, actions: [{ activityId: "sc", targetIds: ["rogue"] }], reason: "Shortbow vs rogue (expected 2.9; opportunity attacks 0.4); also: Scimitar 1.6" };
  const still = { move: null, actions: [{ activityId: "sc", targetIds: ["rogue"] }], reason: "Shortbow vs rogue (expected 3.3)" };
  const d = deps({ plans: { g1: full } });
  d.plan = (board, opts) => (opts?.slot === "bonus" ? { move: null, actions: [], reason: "no bonus action" } : board.me.budget === 0 ? still : full);
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual([seen, calls.chat.map((m) => m.content.includes("opportunity attacks 0.4"))], [[1], [true]]);
});
test("a re-plan after the move that changes the action is whispered again", async () => {
  reset();
  const g1 = combatant("g1");
  const full = { move: { x: 100, y: 100, elevation: 0 }, actions: [{ activityId: "sc", targetIds: ["rogue"] }], reason: "Scimitar vs rogue (expected 2.5)" };
  const still = { move: null, actions: [{ activityId: "sc", targetIds: ["fighter"] }], reason: "Scimitar vs fighter (expected 2.0)" };
  const d = deps({ plans: { g1: full }, enemies: () => [enemy("rogue"), enemy("fighter")] });
  d.plan = (board, opts) => (opts?.slot === "bonus" ? { move: null, actions: [], reason: "no bonus action" } : board.me.budget === 0 ? still : full);
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(calls.chat.map((m) => m.content.includes("vs fighter")), [false, true]);
});

const lairPlan = { move: null, actions: [{ activityId: "A.ap", targetIds: ["rogue"], aimId: "rogue" }], reason: "lair: Acid Pool vs rogue (expected 7.7); not scored: Grasping Roots" };
const lairNone = { move: null, actions: [], reason: "lair: nothing to score; by hand: Acid Pool, Grasping Roots" };
const ap = { id: "A.ap", uuid: "A.ap", name: "Acid Pool", kind: "save", slot: "lair", range: Infinity, dc: 15, saveAbility: "dex", onSave: "half", damage: 9, affects: "creature" };
// A sheet with a legacy lair (initiative 20) and, optionally, legendary actions; hp as given.
const sheet = (c, { lair = true, legact = 0, hp = 7 } = {}) => { c.actor.system = { attributes: { hp: { value: hp, max: 7 } }, resources: { lair: { value: lair, initiative: lair ? 20 : null, inside: false }, legact: { max: legact, spent: 0, value: legact } } }; return c; };
function lairDeps() {
  const d = deps({ plans: {} });
  d.snap = async (combat, c) => ({ ...boardFor(c, [enemy("rogue")]), activities: [sc, ap], me: { ...boardFor(c, []).me, lair: true, lairLast: c.getFlag("bg3-flow", "lairLast") ?? null, lairNames: ["Acid Pool", "Grasping Roots"] } });
  d.plan = (board, opts) => (opts?.slot === "lair" ? (board.me.lairLast === "A.ap" ? lairNone : lairPlan) : emptyPlan);
  return d;
}
test("isAuto: a monster with legendary actions is the DM's unless the flag says true; the robot button sets the flag to the opposite of isAuto", () => {
  const g = sheet(combatant("g"), { legact: 3 });
  assert.equal(isAuto(g), false);
  g.flags["bg3-flow"].autopilot = true;
  assert.equal(isAuto(g), true);
  assert.equal(isAuto(sheet(combatant("plain"))), true);
  const owned = combatant("pc", { disposition: 1, playerOwner: true }); owned.flags["bg3-flow"].autopilot = true;
  assert.equal(isAuto(owned), false); // a player's creature is never the module's, whatever the flag says
});
test("runLair: 'take over' in the pause dialog only skips the lair action: the monster's own autopilot flag is untouched and nothing is remembered", async () => {
  reset(); settings.pauseBeforeAttack = true;
  const g1 = sheet(combatant("g1")), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const d = lairDeps(); d.pause = async () => "manual";
  await runLair(makeCombat([pc, g1], 0), d);
  assert.deepEqual([uses, g1.flags["bg3-flow"].autopilot, g1.flags["bg3-flow"].lairLast], [[], undefined, undefined]);
});
test("runLair: at the top of the round every monster in its lair takes its best lair action from where it stands, remembers it, skips it next round and tells the GM; no flag, no uses, no movement", async () => {
  reset();
  const g1 = sheet(combatant("g1", { auto: false })), g2 = sheet(combatant("g2"), { lair: false }), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc, g1, g2], 0);
  const snapped = []; const d = lairDeps(); const snap = d.snap; d.snap = async (combat, c) => { snapped.push(c.id); return snap(combat, c); };
  await runLair(combat, d);
  assert.deepEqual([uses, moves, [...new Set(snapped)], g1.flags["bg3-flow"].lairLast], [[["A.ap", "T.rogue"]], [], ["g1"], "A.ap"]); // g1 (autopilot off!) acted (snapped before and after the use); g2 has no lair: not even a snapshot
  assert.deepEqual(calls.chat.map((m) => [m.whisper, m.content.includes("lair: Acid Pool")]), [[["gm"], true]]);
  reset();
  await runLair(combat, lairDeps()); // next round: Acid Pool was last round's
  assert.deepEqual([uses, calls.chat.map((m) => m.content.includes("by hand: Acid Pool, Grasping Roots")), g1.flags["bg3-flow"].lairLast], [[], [true], undefined]);
  reset();
  await runLair(combat, lairDeps()); // the round after: available again
  assert.equal(uses.length, 1);
  reset();
  sheet(g1, { hp: 0 });
  await runLair(combat, lairDeps());
  assert.deepEqual([uses, calls.chat], [[], []]); // dead dragon, quiet lair
  sheet(g1);
  reset(); settings.lairActions = false;
  await runLair(combat, lairDeps());
  assert.deepEqual([uses, calls.chat], [[], []]);
  reset();
  const druid = sheet(combatant("druid", { disposition: 1, playerOwner: true }));
  await runLair(makeCombat([druid], 0), lairDeps());
  assert.deepEqual(uses, []); // a player's lair is the player's
});
test("onCombatTurnChange runs the lair phase on a new round before the new turn, never on a turn step or backwards, under one running guard", async () => {
  reset();
  const g1 = sheet(combatant("g1")), pc1 = combatant("pc1", { disposition: 1, playerOwner: true });
  const seen = [];
  const d = lairDeps(); const plan = d.plan; d.plan = (b, o) => { seen.push(o?.slot ?? "action"); return plan(b, o); };
  const c1 = makeCombat([pc1, g1], 1);
  await onCombatTurnChange(c1, { round: 1, turn: 0 }, { round: 1, turn: 1 }, d); // a turn step inside the round: no lair, g1's turn plays
  assert.deepEqual([seen.includes("lair"), uses.length, c1.nextTurns], [false, 0, 1]);
  seen.length = 0; reset();
  const c2 = makeCombat([pc1, g1], 0);
  await onCombatTurnChange(c2, { round: 1, turn: 1 }, { round: 2, turn: 0 }, d); // new round: the lair acts, then the PCs' turn (not auto)
  assert.deepEqual([seen[0], uses.map((u) => u[0]), calls.chat[0].content.includes("lair:")], ["lair", ["A.ap"], true]);
  reset();
  await onCombatTurnChange(makeCombat([pc1, g1], 1), { round: 2, turn: 0 }, { round: 1, turn: 1 }, lairDeps()); // backwards: nothing
  assert.deepEqual([uses, calls.chat], [[], []]);
});

test("a turn change that arrives while the autopilot is busy (a Midi dialog pending) is replayed when the run ends: the new round's lair and the new turn are not dropped", async () => {
  reset();
  const g1 = sheet(combatant("g1")), pc1 = combatant("pc1", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc1, g1], 1);
  const d = lairDeps();
  d.plan = (board, opts) => (opts?.slot === "lair" ? lairPlan : opts?.slot === "bonus" ? { move: null, actions: [], reason: "no bonus action" } : attackPlan());
  d.use = async (a, uuids) => {
    uses.push([a.id, String(uuids)]);
    if (a.id === "sc") { combat.round = 2; combat.turn = 0; await onCombatTurnChange(combat, { round: 1, turn: 1 }, { round: 2, turn: 0 }, d); } // the GM presses next turn mid-use
    return {};
  };
  await onCombatTurnChange(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 }, d); // g1's turn: Scimitar, during which the GM moves on
  assert.deepEqual([uses.map((u) => u[0]), combat.nextTurns, calls.chat.some((m) => m.content.includes("lair:"))], [["sc", "A.ap"], 0, true]); // the pending change ran after the use: lair of round 2, then the PCs' turn (not auto)
});

test("the lair loses initiative ties: with a PC at 20 or more it acts after that group's turn and before the goblins, not at the top of the round", async () => {
  reset();
  const g1 = sheet(combatant("g1")), pc1 = combatant("pc1", { disposition: 1, playerOwner: true });
  pc1.initiative = 22; g1.initiative = 15;
  const combat = makeCombat([pc1, g1], 0);
  const d = lairDeps();
  await onCombatTurnChange(combat, { round: 1, turn: 1 }, { round: 2, turn: 0 }, d); // new round, the PC's turn first: no lair yet
  assert.deepEqual([uses, calls.chat], [[], []]);
  combat.turn = 1;
  await onCombatTurnChange(combat, { round: 2, turn: 0 }, { round: 2, turn: 1 }, d); // then the goblin: the lair first, then its own turn
  assert.deepEqual([uses.map((u) => u[0]), calls.chat[0].content.includes("lair:"), combat.nextTurns], [["A.ap"], true, 1]);
});

test("several turn changes while the autopilot is busy are replayed as one, from the first 'before' to the last 'after': the round you land in keeps its lair", async () => {
  reset();
  const g1 = sheet(combatant("g1")), pc1 = combatant("pc1", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc1, g1], 1);
  const d = lairDeps();
  d.plan = (board, opts) => (opts?.slot === "lair" ? lairPlan : opts?.slot === "bonus" ? { move: null, actions: [], reason: "no bonus action" } : attackPlan());
  let pressed = false;
  d.use = async (a, uuids) => {
    uses.push([a.id, String(uuids)]);
    if (a.id === "sc" && !pressed) { pressed = true; // the GM presses next turn twice mid-use: into round 2, then on to the goblin's turn of round 2
      combat.round = 2; combat.turn = 0; await onCombatTurnChange(combat, { round: 1, turn: 1 }, { round: 2, turn: 0 }, d);
      combat.turn = 1; await onCombatTurnChange(combat, { round: 2, turn: 0 }, { round: 2, turn: 1 }, d);
    }
    return {};
  };
  await onCombatTurnChange(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 }, d);
  assert.deepEqual([uses.map((u) => u[0]), calls.chat.filter((m) => m.content.includes("lair:")).length], [["sc", "A.ap", "sc"], 1]); // one lair for round 2, not zero (the last step alone never crosses the lair's place) and not two; then the goblin's round-2 turn
});

test("useActivity with an attack mode sets it on the activity clone Midi rolls with (thrown: the weapon's range, not its reach)", async () => {
  reset();
  const cfgs = [];
  globalThis.fromUuidSync = (uuid) => ({ uuid });
  // Midi forces its roll dialog on a thrown weapon unless the activity's forceRollDialog is "never": the autopilot never wants a dialog
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { const clone = { uuid: a.uuid, midiProperties: { forceRollDialog: "default" } }; Hooks.callAll("dnd5e.preUseActivity", clone, cfg, dialog, {}); cfgs.push([cfg.attackMode, clone.attackMode, clone.midiProperties.forceRollDialog]); return {}; } };
  await useActivity({ uuid: "A.sc", attackMode: "thrown" }, ["T.rogue"]);
  await useActivity({ uuid: "A.sc" }, ["T.rogue"]);
  assert.deepEqual(cfgs, [["thrown", "thrown", "never"], [undefined, undefined, "never"]]);
  assert.equal(hookFns["dnd5e.preUseActivity"], undefined);
});

test("awaitOaRegions: with Gambit's opportunity attacks on, waits until its regions stop appearing (created asynchronously at combat start); nothing to wait for otherwise", async () => {
  const regions = [];
  globalThis.canvas.scene.regions = regions;
  settings["Enable Opportunity Attack"] = true;
  game.modules = { get: (id) => (id === "gambits-premades" ? { active: true } : undefined) };
  game.combat = { combatants: [{ token: {} }, { token: {} }, { token: {} }, { token: {} }] }; // four combatants: Gambit's makes up to four regions
  const region = (u) => ({ flags: { "gambits-premades": { actorUuid: u } } });
  setTimeout(() => regions.push(region("Actor.g")), 5);
  setTimeout(() => regions.push(region("Actor.c")), 18); // gaps longer than one poll: one unchanged poll must not end the wait (Gambit's creates them ~250 ms apart)
  setTimeout(() => regions.push(region("Actor.r")), 31);
  let t = Date.now();
  await awaitOaRegions({ poll: 10, max: 500 });
  assert.equal(regions.length, 3); // returned once the count held still for two polls, well before the cap
  assert.ok(Date.now() - t < 400);
  regions.length = 0; t = Date.now();
  setTimeout(() => regions.push(region("a"), region("b"), region("c"), region("d")), 5);
  await awaitOaRegions({ poll: 40, max: 500 });
  assert.ok(Date.now() - t < 90, "every combatant has its region: no need to wait for stability (two more polls would be 120 ms)");
  regions.length = 0; t = Date.now();
  await awaitOaRegions({ poll: 3, max: 30 }); // none ever appear (nobody with a melee weapon): the cap ends the wait
  assert.ok(Date.now() - t >= 25);
  settings["Enable Opportunity Attack"] = false; t = Date.now();
  await awaitOaRegions({ poll: 3, max: 500 }); // Gambit's opportunity attacks off: no wait
  assert.ok(Date.now() - t < 20);
  game.modules = { get: () => ({}) };
  delete globalThis.canvas.scene.regions;
});

test("runTurn waits for Gambit's opportunity attack regions before the first move of a fresh combat only (round 1, first turn): a monster acting first would otherwise walk past a fighter with no prompt", async () => {
  reset();
  const g1 = combatant("g1");
  const d = { ...deps({ plans: { g1: attackPlan() } }), grace: async () => order.push("grace") };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })], 0), d);
  assert.deepEqual(order.slice(0, 3), ["clear g1", "grace", "move g1"]);
  reset();
  const c = makeCombat([combatant("pc", { disposition: 1, playerOwner: true }), g1], 1);
  await runTurn(c, d);
  assert.ok(!order.includes("grace"));
  reset();
  const c2 = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })], 0); c2.round = 2;
  await runTurn(c2, d);
  assert.ok(!order.includes("grace"));
});

// Command: Gambit's effect carries flags.gambits-premades.commandWord and expires at the target's turn start (DAE), which may land
// before the autopilot reads it; the word is kept from preDeleteActiveEffect for that turn.
const commandEffect = (word, origin = "Actor.pc.Item.cmd") => ({ id: "fx1", name: "Command", origin, flags: { "gambits-premades": { command: true, commandWord: word } } });
test("commandOf: the live effect's word, else the word kept when the effect expired this round; nothing otherwise", () => {
  const g = combatant("g1"); const combat = makeCombat([g]);
  assert.equal(commandOf(g, combat), null);
  g.actor.effects = [commandEffect("Drop")];
  assert.deepEqual(commandOf(g, combat), { word: "Drop", kind: "drop", origin: "Actor.pc.Item.cmd" });
  g.actor.effects = [];
  const other = makeCombat([combatant("pc", { disposition: 1, playerOwner: true }), g], 0); // the PC's turn
  onPreDeleteEffect({ ...commandEffect("Drop"), parent: g.actor });
  assert.equal(commandOf(g, other), null); // removed by hand on someone else's turn: not an expiry, not kept
  game.combat = combat;
  onPreDeleteEffect({ ...commandEffect("Huye"), parent: g.actor });
  assert.deepEqual(commandOf(g, combat), { word: "Huye", kind: "flee", origin: "Actor.pc.Item.cmd" });
  combat.round = 2;
  assert.equal(commandOf(g, combat), null); // a stale word from another round is not obeyed
  onPreDeleteEffect({ name: "Bless", flags: {}, parent: g.actor }); // not a command
  assert.equal(commandOf(g, combat), null);
});

test("runTurn: a commanded monster obeys instead of its plan: Drop and Halt take no action and no bonus action, Grovel falls prone, the table is told, the turn passes; the kept word is used once", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2"), g3 = combatant("g3"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const statuses = []; g3.actor.toggleStatusEffect = async (s, o) => statuses.push([s, o.active]);
  g1.actor.effects = [commandEffect("Drop")]; g2.actor.effects = [commandEffect("Halt")]; g3.actor.effects = [commandEffect("Grovel")];
  const combat = makeCombat([g1, g2, g3, pc]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan(), g3: attackPlan() }, bonus: { g1: { move: null, actions: [{ activityId: "hw", targetIds: ["g2"] }], reason: "heal" } } }));
  assert.deepEqual(uses, []);
  assert.deepEqual(moves, []);
  assert.deepEqual(statuses, [["prone", true]]);
  const told = calls.chat.filter((m) => !m.whisper).map((m) => m.content);
  assert.deepEqual(told, ['BG3FLOW.Autopilot.Command:{"name":"g1","word":"Drop"}', 'BG3FLOW.Autopilot.Command:{"name":"g2","word":"Halt"}', 'BG3FLOW.Autopilot.Command:{"name":"g3","word":"Grovel"}']);
  assert.equal(combat.nextTurns, 1);
  reset(); g1.actor.effects = []; g2.actor.effects = []; g3.actor.effects = [];
  onPreDeleteEffect({ ...commandEffect("Drop"), parent: g1.actor }); // expired at turn start, before the read
  const again = makeCombat([g1, pc]);
  await runTurn(again, deps({ plans: { g1: attackPlan() } }));
  assert.deepEqual(uses, []);
  reset();
  await runTurn(makeCombat([g1, pc]), deps({ plans: { g1: attackPlan() } })); // the word was spent: back to normal
  assert.equal(uses.length, 1);
});

test("runTurn: Approach walks toward the caster and does not act; an unknown word is whispered and the monster plays as usual", async () => {
  reset();
  const g1 = combatant("g1"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  g1.actor.effects = [commandEffect("Approach", "Actor.cleric.Item.cmd")];
  const cleric = { ...enemy("cleric"), actorUuid: "Actor.cleric", distance: 40 };
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [enemy("rogue"), cleric] });
  const snap = d.snap; d.snap = async (...a) => ({ ...(await snap(...a)), paths: { cleric: [{ x: 300, y: 0, elevation: 0, cost: 15, distance: 25, occupied: false, waypoints: [{ x: 300, y: 0, elevation: 0 }] }] } });
  await runTurn(makeCombat([g1, pc]), d);
  assert.deepEqual(moves.map((m) => [m[0], m[1].at(-1).x]), [["g1", 300]]);
  assert.deepEqual(uses, []);
  reset();
  g1.actor.effects = [commandEffect("Dance")];
  await runTurn(makeCombat([g1, pc]), deps({ plans: { g1: attackPlan() } }));
  assert.equal(uses.length, 1);
  assert.ok(calls.chat.some((m) => m.whisper && m.content === 'BG3FLOW.Autopilot.UnknownCommand:{"name":"g1","word":"Dance"}'));
});

test("controlledBy / isAuto: a charmed or dominated monster (the status, or an effect named Dominate/Charm, English or Spanish) is the DM's: left out of the autopilot, whispered once, the turn not passed", async () => {
  reset();
  assert.equal(controlledBy({ statuses: new Set(["charmed"]) }), true);
  assert.equal(controlledBy({ effects: [{ name: "Dominate Person" }] }), true);
  assert.equal(controlledBy({ effects: [{ name: "Hechizar persona" }] }), true);
  assert.equal(controlledBy({ effects: [{ name: "Bless" }], statuses: new Set(["prone"]) }), false);
  const g1 = combatant("g1"), g2 = combatant("g2"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  g2.actor.effects = [{ name: "Dominate Monster" }];
  assert.equal(isAuto(g2), false);
  const combat = makeCombat([g1, g2, pc]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() } }));
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue"]); // g1 only
  assert.ok(calls.chat.some((m) => m.whisper && m.content === 'BG3FLOW.Autopilot.Controlled:{"name":"g2"}'));
  assert.equal(combat.nextTurns, 0);
  reset(); // alone in its group: nobody on the autopilot, the whisper still comes and the turn still holds
  const alone = makeCombat([g2, pc]);
  await runTurn(alone, deps({ plans: { g2: attackPlan() } }));
  assert.deepEqual(uses, []);
  assert.ok(calls.chat.some((m) => m.whisper && m.content === 'BG3FLOW.Autopilot.Controlled:{"name":"g2"}'));
  assert.equal(alone.nextTurns, 0);
});

test("registerAutopilot keeps the command word from preDeleteActiveEffect", () => {
  const before = new Set(calls.hooks);
  registerAutopilot();
  assert.ok(calls.hooks.includes("preDeleteActiveEffect"));
  void before;
});

// Confusion: the d10 at the creature's turn start (the lead GM rolls, monsters and player characters alike); for 7-8 the creature within reach is drawn.
const confusedEffect = { name: "Confusion" };
const tokenAt = (c, x, y = 0, hp = 10) => { c.token.x = x; c.token.y = y; c.token.width = 1; c.token.actor = { system: { attributes: { hp: { value: hp } } } }; return c.token; };
test("runTurn rolls the Confusion d10 once per round for every confused member, tells the table, and the monster obeys: 1 stumbles, 3 nothing, 7 attacks the creature drawn within reach (an ally too), 9 plays as usual", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  g1.actor.effects = [confusedEffect];
  canvas.scene.tokens.contents = [tokenAt(g1, 0), tokenAt(g2, 100), tokenAt(pc, 500)]; // g2 adjacent, the pc far
  const run = async (d10, d8 = 3) => { delete g1.flags["bg3-flow"].confusion; const combat = makeCombat([g1, g2, pc]); await runTurn(combat, { ...deps({ plans: { g1: attackPlan(), g2: emptyPlan }, allies: () => [{ id: "tok-g2", uuid: "T.g2", name: "g2", hp: 10, maxHp: 10, cx: 150, cy: 50 }] }), d10: async () => d10, d8: async () => d8, rand: () => 0 }); return combat; };
  await run(1);
  assert.deepEqual(moves.map((m) => [m[0], m[1].at(-1).x]), [["g1", 600]]); // east, 30 ft
  assert.deepEqual(uses, []);
  assert.deepEqual(g1.getFlag("bg3-flow", "confusion"), { round: 1, roll: 1, dir: 3, target: null });
  assert.ok(calls.chat.some((m) => !m.whisper && m.content === 'BG3FLOW.Autopilot.Confusion.Stumble:{"name":"g1","roll":1,"dir":"BG3FLOW.Autopilot.Dir.E"}'));
  reset(); await run(3);
  assert.deepEqual([moves, uses], [[], []]);
  reset(); await run(7);
  assert.deepEqual(uses, [["sc", "T.g2"]]); // the creature drawn within reach: its own ally
  assert.deepEqual(moves, []);
  reset(); await run(9);
  assert.deepEqual(uses, [["sc", "T.rogue"]]); // as usual
  reset(); const again = makeCombat([g1, g2, pc]); g1.flags["bg3-flow"].confusion = { round: 1, roll: 3, dir: 1, target: null };
  await runTurn(again, { ...deps({ plans: { g1: attackPlan(), g2: emptyPlan } }), d10: async () => { throw new Error("rolled twice"); } });
  assert.deepEqual(uses, []); // the round's roll stands
  canvas.scene.tokens.contents = [];
});

test("a confused player character: the GM's client rolls for it at its turn start, tells the table, moves it on a 1 and flags the roll for the player's vetoes", async () => {
  reset();
  const pc = combatant("pc", { disposition: 1, playerOwner: true }), g1 = combatant("g1");
  pc.actor.effects = [confusedEffect]; pc.actor.system = { attributes: { movement: { speeds: { walk: 25 } } } };
  canvas.scene.tokens.contents = [tokenAt(pc, 0), tokenAt(g1, 100)];
  await runTurn(makeCombat([pc, g1]), { ...deps({ plans: {} }), d10: async () => 1, d8: async () => 5, rand: () => 0 }); // the PC's turn: no autopilot member
  assert.deepEqual(moves.map((m) => [m[0], m[1].at(-1).x, m[1].at(-1).y]), [["pc", 0, 500]]); // south, 25 ft
  reset(); delete pc.flags["bg3-flow"].confusion;
  const dims = canvas.dimensions; canvas.dimensions = { size: 100, distance: 5, sceneRect: { x: 0, y: 0, width: 1000, height: 300 } };
  await runTurn(makeCombat([pc, g1]), { ...deps({ plans: {} }), d10: async () => 1, d8: async () => 5, rand: () => 0 });
  assert.deepEqual(moves.map((m) => [m[0], m[1].at(-1).x, m[1].at(-1).y]), [["pc", 0, 200]]); // cut at the scene's bottom edge, on the grid
  canvas.dimensions = dims;
  assert.deepEqual(pc.getFlag("bg3-flow", "confusion"), { round: 1, roll: 1, dir: 5, target: null });
  reset(); delete pc.flags["bg3-flow"].confusion;
  await runTurn(makeCombat([pc, g1]), { ...deps({ plans: {} }), d10: async () => 8, d8: async () => 1, rand: () => 0 });
  assert.deepEqual(pc.getFlag("bg3-flow", "confusion"), { round: 1, roll: 8, dir: 0, target: "tok-g1" }); // the direction is only rolled on a 1
  assert.ok(calls.chat.some((m) => !m.whisper && m.content === 'BG3FLOW.Autopilot.Confusion.Attack:{"name":"pc","roll":8,"target":"g1"}'));
  assert.deepEqual(moves, []);
  canvas.scene.tokens.contents = [];
});
