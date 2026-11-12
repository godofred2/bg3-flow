// Target picker (single-target spells and attacks) against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, remove() {} }, controls: { render() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { targetPicker: true, enableTurns: false };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: false, targets: new Set() }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };

const { needsPick, onPreTargetingPick, pickTargets } = await import("../scripts/targeting.js");

const act = ({ type = "save", affects = "creature", count = "1", template = "", units = "ft", value = 60, item = { type: "spell" }, activation = "action" } = {}) => ({
  type, name: "X", item: { type: item.type, system: { range: item.range ?? {} } }, activation: { type: activation },
  target: { affects: { type: affects, count }, template: { type: template } }, range: { units, value, override: false }
});

test("needsPick: a single-target spell, a touch spell or a weapon attack asks for its targets within its range at every use, targets left from the last use included; areas, self spells, aimless utilities, decided targets, targets set off the actor's turn or for a reaction, and the setting off do not", () => {
  assert.deepEqual(needsPick({ activity: act(), targeted: 0 }), { count: 1, range: 60, self: true }); // Sacred Flame
  assert.deepEqual(needsPick({ activity: act({ type: "heal", units: "touch", value: null }), targeted: 0 }), { count: 1, range: 5, self: true }); // Cure Wounds: the caster may click itself
  assert.deepEqual(needsPick({ activity: act({ type: "attack", affects: "", item: { type: "weapon", range: { reach: 5, value: null } } }), targeted: 0 }), { count: 1, range: 5, self: false }); // a weapon: dnd5e leaves affects blank; never yourself
  assert.deepEqual(needsPick({ activity: act({ affects: "enemy" }), targeted: 0 }), { count: 1, range: 60, self: false });
  assert.deepEqual(needsPick({ activity: act({ count: "2", units: "any", value: null }), targeted: 0 }), { count: 2, range: Infinity, self: true });
  assert.equal(needsPick({ activity: act({ template: "sphere" }), targeted: 0 }), null); // Fireball: the template picks
  assert.equal(needsPick({ activity: act({ affects: "self", units: "self", value: null }), targeted: 0 }), null); // Shield
  assert.equal(needsPick({ activity: act({ type: "utility", affects: "" }), targeted: 0 }), null); // nothing to aim at
  assert.deepEqual(needsPick({ activity: act(), targeted: 1 }), { count: 1, range: 60, self: true }); // the last use's target still marked: picked again (a heal, then an attack, both went to the ally)
  assert.equal(needsPick({ activity: act(), targeted: 1, onTurn: false }), null); // off its turn (Gambit's opportunity attack targets for the reacting actor): the targets set stand
  assert.deepEqual(needsPick({ activity: act(), targeted: 0, onTurn: false }), { count: 1, range: 60, self: true }); // nothing targeted off turn: still picked
  assert.equal(needsPick({ activity: act({ activation: "reaction" }), targeted: 1 }), null); // Counterspell with its target set by the reaction prompt
  assert.equal(needsPick({ activity: act(), targeted: 0, usage: { midiOptions: { targetUuids: ["T.x"] } } }), null); // the autopilot decided
  settings.targetPicker = false;
  assert.equal(needsPick({ activity: act(), targeted: 0 }), null);
  settings.targetPicker = true;
});

test("onPreTargetingPick: runs the picker for the caster with the activity's range and count and lets Midi go on with the picked targets; a cancelled pick aborts the use (false); targets already set are picked again on the actor's turn, kept off it", async () => {
  const calls = [], t = { id: "t1" }, actor = { id: "a1" };
  const pick = async (o) => { calls.push(o); return [t]; };
  const workflow = { activity: act(), token: { id: "caster" }, actor };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.deepEqual(calls, [{ token: workflow.token, range: 60, count: 1, self: true, name: "X" }]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick: async () => null }), false); // Esc: Midi removes the workflow, nothing is spent
  game.user.targets = new Set([t]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 2); // no combat: picked again
  game.combat = { started: true, combatants: [{ id: "c1", actor }, { id: "c2", actor: {} }], combatant: { id: "c2" } };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 2); // not its turn: the targets set stand
  game.combat.combatant = { id: "c1" };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 3); // its turn: picked again
  game.combat = null;
  game.user.targets = new Set();
});

test("pickTargets: a click on the caster's own token counts when the activity can affect it (a touch heal, a potion), never for an attack", async () => {
  const view = { fn: null, addEventListener(type, fn) { this.fn = fn; }, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.MidiQOL = { computeDistance: () => 0 };
  const targeted = [];
  const me = { name: "Cleric", center: { x: 0, y: 0 }, visible: true, setTarget() { targeted.push(this.name); } }, other = { name: "Rogue", center: { x: 0, y: 0 }, visible: true, setTarget() { targeted.push(this.name); } };
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" }, app: { view }, tokens: { hover: me } };
  const heal = pickTargets({ token: me, range: 5, count: 1, name: "Cure Wounds", self: true });
  view.fn({ button: 0 });
  assert.deepEqual((await heal).map((t) => t.name), ["Cleric"]);
  const swing = pickTargets({ token: me, range: 5, count: 1, name: "Longsword", self: false });
  view.fn({ button: 0 }); // own token: ignored, still waiting
  canvas.tokens.hover = other;
  view.fn({ button: 0 });
  assert.deepEqual((await swing).map((t) => t.name), ["Rogue"]);
  assert.deepEqual(targeted, ["Cleric", "Rogue"]);
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };
});

test("pickTargets: the targets left from the last use are cleared as the picker opens, and Enter confirms fewer targets than the count once at least one is picked", async () => {
  const view = { fn: null, addEventListener(type, fn) { this.fn = fn; }, removeEventListener() {} };
  let onKey = null;
  globalThis.window = { addEventListener(type, fn) { onKey = fn; }, removeEventListener() {} };
  globalThis.MidiQOL = { computeDistance: () => 0 };
  const cleared = [];
  const me = { name: "Wizard", center: { x: 0, y: 0 }, visible: true }, goblin = { name: "Goblin", center: { x: 0, y: 0 }, visible: true, setTarget() {} };
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" }, app: { view }, tokens: { hover: goblin, setTargets: (ids) => cleared.push(ids) } };
  game.user.targets = new Set([{ id: "stale" }]);
  const rays = pickTargets({ token: me, range: 120, count: 3, name: "Scorching Ray", self: false });
  assert.deepEqual(cleared, [[]]); // the ally healed a moment ago is no longer marked
  onKey({ key: "Enter", stopPropagation() {}, preventDefault() {} }); // nothing picked yet: ignored
  view.fn({ button: 0 });
  onKey({ key: "Enter", stopPropagation() {}, preventDefault() {} });
  assert.deepEqual((await rays).map((t) => t.name), ["Goblin"]); // all three rays at the one goblin
  game.user.targets = new Set();
  globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };
});
