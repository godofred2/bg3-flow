// Target picker (single-target spells and attacks) against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, remove() {} }, controls: { render() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { targetPicker: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: false, targets: new Set() }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { ready: true, dimensions: { size: 100, distance: 5 }, scene: { id: "scene" } };

const { needsPick, onPreTargetingPick, pickTargets } = await import("../scripts/targeting.js");

const act = ({ type = "save", affects = "creature", count = "1", template = "", units = "ft", value = 60, item = { type: "spell" } } = {}) => ({
  type, name: "X", item: { type: item.type, system: { range: item.range ?? {} } },
  target: { affects: { type: affects, count }, template: { type: template } }, range: { units, value, override: false }
});

test("needsPick: a single-target spell, a touch spell or a weapon attack used with nothing targeted asks for its targets within its range; areas, self spells, aimless utilities, decided targets and the setting off do not", () => {
  assert.deepEqual(needsPick({ activity: act(), targeted: 0 }), { count: 1, range: 60, self: true }); // Sacred Flame
  assert.deepEqual(needsPick({ activity: act({ type: "heal", units: "touch", value: null }), targeted: 0 }), { count: 1, range: 5, self: true }); // Cure Wounds: the caster may click itself
  assert.deepEqual(needsPick({ activity: act({ type: "attack", affects: "", item: { type: "weapon", range: { reach: 5, value: null } } }), targeted: 0 }), { count: 1, range: 5, self: false }); // a weapon: dnd5e leaves affects blank; never yourself
  assert.deepEqual(needsPick({ activity: act({ affects: "enemy" }), targeted: 0 }), { count: 1, range: 60, self: false });
  assert.deepEqual(needsPick({ activity: act({ count: "2", units: "any", value: null }), targeted: 0 }), { count: 2, range: Infinity, self: true });
  assert.equal(needsPick({ activity: act({ template: "sphere" }), targeted: 0 }), null); // Fireball: the template picks
  assert.equal(needsPick({ activity: act({ affects: "self", units: "self", value: null }), targeted: 0 }), null); // Shield
  assert.equal(needsPick({ activity: act({ type: "utility", affects: "" }), targeted: 0 }), null); // nothing to aim at
  assert.equal(needsPick({ activity: act(), targeted: 1 }), null); // the player targeted already
  assert.equal(needsPick({ activity: act(), targeted: 0, usage: { midiOptions: { targetUuids: ["T.x"] } } }), null); // the autopilot decided
  settings.targetPicker = false;
  assert.equal(needsPick({ activity: act(), targeted: 0 }), null);
  settings.targetPicker = true;
});

test("onPreTargetingPick: runs the picker for the caster with the activity's range and count and lets Midi go on with the picked targets; a cancelled pick aborts the use (false); targets already set skip it", async () => {
  const calls = [], t = { id: "t1" };
  const pick = async (o) => { calls.push(o); return [t]; };
  const workflow = { activity: act(), token: { id: "caster" } };
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.deepEqual(calls, [{ token: workflow.token, range: 60, count: 1, self: true, name: "X" }]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick: async () => null }), false); // Esc: Midi removes the workflow, nothing is spent
  game.user.targets = new Set([t]);
  assert.equal(await onPreTargetingPick({ workflow, usage: {} }, { pick }), undefined);
  assert.equal(calls.length, 1);
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
