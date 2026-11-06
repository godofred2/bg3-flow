// House rules against stubbed Foundry globals (the module's main.js needs Hooks, game and ui at import time).
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { enlargeStrength: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };

const { enlargeChanges, registerHouseRules } = await import("../scripts/houserules.js");
const str = JSON.stringify([{ k: "roll.ability", v: "str", o: "exact" }]), notStr = JSON.stringify([{ o: "NOT", v: { k: "roll.ability", v: "str", o: "exact" } }]);

test("enlargeChanges: the Enlarge 1d4 becomes the Strength modifier on Strength attacks and stays 1d4 on the rest, legacy or new keys, melee and thrown", () => {
  const legacy = [{ _id: "a", key: "system.bonuses.mwak.damage", value: "+1d4", type: "add", phase: "initial", conditions: "{}" }, { key: "system.bonuses.rwak.damage", value: "1d4", type: "add" }, { key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }];
  assert.deepEqual(enlargeChanges("Enlarged", legacy), [
    { key: "system.rolls.damage.mwak.bonus", value: "@abilities.str.mod", type: "add", phase: "initial", conditions: str },
    { key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add", phase: "initial", conditions: notStr },
    { key: "system.rolls.damage.rwak.bonus", value: "@abilities.str.mod", type: "add", conditions: str },
    { key: "system.rolls.damage.rwak.bonus", value: "1d4", type: "add", conditions: notStr },
    { key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }
  ]);
  assert.equal(enlargeChanges("Agrandar/Reducir: Agrandado", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add" }]).length, 2);
  assert.equal(enlargeChanges("Favored Foe", [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }]), null); // not Enlarge
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.bonuses.mwak.damage", value: "1d6", type: "add" }]), null); // not the 1d4
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add", conditions: str }]), null); // already conditional: someone's hand
  assert.equal(enlargeChanges("Enlarged", []), null);
});

test("registerHouseRules rewrites an Enlarge effect as it is created, unless the setting is off", () => {
  const hooks = {}; const on = Hooks.on; Hooks.on = (n, fn) => { hooks[n] = fn; };
  try { registerHouseRules(); } finally { Hooks.on = on; }
  const updates = [];
  const effect = { toObject: () => ({ name: "Enlarged", system: { changes: [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }] } }), updateSource: (u) => updates.push(u) };
  settings.enlargeStrength = true;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.deepEqual(updates[0]["system.changes"].map((c) => c.value), ["@abilities.str.mod", "1d4"]);
  settings.enlargeStrength = false;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.equal(updates.length, 1);
});
