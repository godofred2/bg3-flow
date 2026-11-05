// Piece 4: autopilot execution against stubbed Foundry globals (plans and boards injected).
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { chat: [], hooks: [], render: 0 };
globalThis.Hooks = { once() {}, on: (name) => calls.hooks.push(name), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} }, controls: { render() {} }, combat: { render: () => calls.render++ } };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = { time: { turnTime: 6, roundTime: 60 }, Token: { movement: { actions: { walk: {} } } }, DND5E: { movementTypes: { walk: {} } } };
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { ready: true, scene: { id: "scene", tokens: { contents: [] } } };
const settings = { pauseBeforeAttack: false, autoNextTurn: true, intelligenceThreshold: 6 };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { id: "gm", isGM: true }, users: { activeGM: { isSelf: true } }, combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }, modules: { get: () => ({}) }
};

let order = [], moves = [], uses = [];
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
const boardFor = (c, enemies) => ({ me: { id: c.id, name: c.id, intelligence: 10, hp: 7, maxHp: 7, x: 0, y: 0, elevation: 0, budget: 30 }, enemies, activities: [sc], multiattack: null, paths: {}, reserved: new Set(), threshold: 6 });
const attackPlan = (target = "rogue", n = 1) => ({ move: { x: 400, y: 0, elevation: 0 }, actions: Array(n).fill({ activityId: "sc", targetId: target }), reason: `Scimitar vs ${target} (expected 2.5)` });
const approachPlan = { move: { x: 200, y: 0, elevation: 0 }, actions: [], reason: "approach rogue" };
const emptyPlan = { move: null, actions: [], reason: "no visible enemy" };
function deps({ plans, enemies = () => [enemy("rogue")], use, pause } = {}) {
  return {
    snap: async (combat, c) => boardFor(c, enemies()),
    plan: (board) => plans[board.me.id],
    use: use ?? (async (a, uuid) => { uses.push([a.id, uuid]); order.push(`use ${uuid}`); return {}; }),
    pause: pause ?? (async () => "execute")
  };
}
function reset() { order = []; moves = []; uses = []; calls.chat = []; settings.pauseBeforeAttack = false; settings.autoNextTurn = true; }

const { isAuto, runTurn, onCombatTurnChange, onRenderCombatTracker, pauseDialog, registerAutopilot } = await import("../scripts/ai/run.js");

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
  assert.deepEqual(moves[0][1], { x: 400, y: 0, elevation: 0, action: "walk" });
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
  const d = deps({ plans: { g1: attackPlan("rogue", 2) }, enemies: () => [enemy("rogue", rogueHp), enemy("wizard")], use: async (a, uuid) => { uses.push([a.id, uuid]); rogueHp = 0; return {}; } });
  await runTurn(combat, d);
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue", "T.wizard"]);
  reset(); rogueHp = 10;
  const alone = deps({ plans: { g1: attackPlan("rogue", 2) }, enemies: () => [enemy("rogue", rogueHp)], use: async (a, uuid) => { uses.push([a.id, uuid]); rogueHp = 0; return {}; } });
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), alone);
  assert.deepEqual(uses.map((u) => u[1]), ["T.rogue"]);
});

test("runTurn: a use that throws (or Midi refusing) whispers the error, the next monster still acts, the turn is not passed", async () => {
  reset();
  const g1 = combatant("g1"), g2 = combatant("g2");
  const combat = makeCombat([g1, g2, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() }, use: async (a, uuid) => { if (order.push(`use ${uuid}`) && uses.push(uuid) === 1) throw new Error("boom"); return {}; } }));
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
  await runTurn(combat, deps({ plans: { g1: attackPlan(), g2: attackPlan() }, use: async (a, uuid) => { uses.push(uuid); combat.turn = 2; return {}; } }));
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
  game.users.activeGM.isSelf = false;
  await onCombatTurnChange(makeCombat([g1]), d);
  assert.equal(snaps, 0);
  game.users.activeGM.isSelf = true;
  await onCombatTurnChange({ ...makeCombat([g1]), started: false }, d);
  assert.equal(snaps, 0);
  await onCombatTurnChange(makeCombat([g1]), d);
  assert.equal(snaps, 2); // one snapshot before moving, one before acting
});

test("onRenderCombatTracker appends an active robot button to NPC rows only, click toggles the flag", async () => {
  const g1 = combatant("g1"), g2 = combatant("g2", { auto: false }), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([g1, g2, pc]);
  const made = [];
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
