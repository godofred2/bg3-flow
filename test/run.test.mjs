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
const settings = { pauseBeforeAttack: false, autoNextTurn: true, intelligenceThreshold: 6, enableTurns: true, autoRecharge: "no" };
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
function reset() { order = []; moves = []; uses = []; places = []; calls.chat = []; settings.pauseBeforeAttack = false; settings.autoNextTurn = true; settings.enableTurns = true; settings.autoRecharge = "no"; game.user.isGM = true; }

const { isAuto, runTurn, onCombatTurnChange, onRenderCombatTracker, pauseDialog, registerAutopilot, arrive, useActivity, rollRecharge, sentinelWatch } = await import("../scripts/ai/run.js");

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
  assert.equal(g2.flags["bg3-flow"].autopilot, undefined);
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
  for (const k of ["enableAutopilot", "pauseBeforeAttack", "autoNextTurn", "intelligenceThreshold"]) { assert.ok(en.Settings[k]?.Name && en.Settings[k]?.Hint, k); assert.ok(es.Settings[k]?.Name && es.Settings[k]?.Hint, k); }
  for (const k of ["Toggle", "Decision", "Error"]) { assert.ok(en.Autopilot[k], k); assert.ok(es.Autopilot[k], k); }
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
  assert.deepEqual(places[0], { origin: { cx: 50, cy: 50 }, aim: { cx: 650, cy: 50 } }); // where the template goes
});

test("useActivity: no configuration dialog, the target uuids, and no dnd5e template placement", async () => {
  const cfgs = [];
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { cfgs.push([a, cfg, dialog]); return {}; } };
  globalThis.fromUuidSync = (uuid) => ({ uuid });
  await useActivity({ uuid: "A.sc" }, ["T.rogue"]);
  assert.deepEqual(cfgs, [[{ uuid: "A.sc" }, { create: { measuredTemplate: false }, midiOptions: { targetUuids: ["T.rogue"], ignoreUserTargets: true } }, { configure: false }]]);
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
  await useActivity({ uuid: "A.br", area: { shape: "cone", size: 15, width: 5 } }, ["T.rogue"], { origin: { cx: 150, cy: 50 }, aim: { cx: 450, cy: 350 } });
  const cone = created[0][1];
  assert.deepEqual([created[0][0], cone.t, cone.x, cone.y, cone.direction, cone.distance, cone.angle, cone.flags.dnd5e.origin, cone.flags["midi-qol"].actorUuid], ["MeasuredTemplate", "cone", 150, 50, 45, 15, 53.13, "A.br", "Ac.d"]);
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
  assert.deepEqual([created[0][1].t, created[0][1].x, created[0][1].direction, created[0][1].width], ["ray", 150, 0, 5]);
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
  assert.deepEqual(updates, [{ x: 1100, y: 400 }]);
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
