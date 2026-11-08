// House rules against stubbed Foundry globals (the module's main.js needs Hooks, game and ui at import time).
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
const settings = { enlargeStrength: true, preparedSpells: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };

const { enlargeChanges, registerHouseRules, prepareOnCreate } = await import("../scripts/houserules.js");
const str = '[{"k":"roll.attack.classification","v":"weapon","o":"exact"},{"k":"roll.ability","v":"str","o":"exact"}]', notStr = '[{"k":"roll.attack.classification","v":"weapon","o":"exact"},{"o":"NOT","v":{"k":"roll.ability","v":"str","o":"exact"}}]';
// dnd5e 6 checks the conditions of an attribute change at data preparation (no roll in sight), so the Strength bonus must be a
// rule-type change (type "dnd5e.bonus", key "damage"): collected at every damage roll and filtered with that roll's data.
const pair = [{ key: "damage", type: "dnd5e.bonus", value: "@abilities.str.mod", conditions: str }, { key: "damage", type: "dnd5e.bonus", value: "1d4", conditions: notStr }];

test("enlargeChanges: the Enlarge 1d4 (melee and thrown, legacy or new keys) becomes one rule pair: the Strength modifier on Strength weapon attacks, 1d4 on the other weapon attacks", () => {
  const legacy = [{ _id: "a", key: "system.bonuses.mwak.damage", value: "+1d4", type: "add", phase: "initial", conditions: "{}" }, { key: "system.bonuses.rwak.damage", value: "1d4", type: "add" }, { key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }];
  assert.deepEqual(enlargeChanges("Enlarged", legacy), [{ key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }, ...pair]);
  assert.deepEqual(enlargeChanges("Agrandar/Reducir: Agrandado", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add" }]), pair);
  assert.equal(enlargeChanges("Favored Foe", [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }]), null); // not Enlarge
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.bonuses.mwak.damage", value: "1d6", type: "add" }]), null); // not the 1d4
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "downgrade" }]), null); // not an added bonus
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add", conditions: str }]), null); // already conditional: someone's hand
  assert.equal(enlargeChanges("Enlarged", [...pair, { key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }]), null); // already rewritten
  assert.equal(enlargeChanges("Enlarged", []), null);
});

test("registerHouseRules rewrites an Enlarge effect as it is created, unless the setting is off", () => {
  const hooks = {}; const on = Hooks.on; Hooks.on = (n, fn) => { hooks[n] = fn; };
  try { registerHouseRules(); } finally { Hooks.on = on; }
  const updates = [];
  const effect = { toObject: () => ({ name: "Enlarged", system: { changes: [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }] } }), updateSource: (u) => updates.push(u) };
  settings.enlargeStrength = true;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.deepEqual(updates[0]["system.changes"].map((c) => [c.type, c.value]), [["dnd5e.bonus", "@abilities.str.mod"], ["dnd5e.bonus", "1d4"]]);
  settings.enlargeStrength = false;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.equal(updates.length, 1);
});

test("prepareOnCreate: a spell of a preparing method created on a character arrives prepared (dnd5e 6: system.method and system.prepared 0/1/2; CPR's automation leaves imported spells at 0); other methods, other actors, prepared ones and the setting off are left alone", () => {
  const item = ({ type = "spell", actor = "character", method = "spell", prepared = 0 } = {}) => {
    const it = { type, parent: actor && { type: actor }, system: { method, prepared }, updates: [], updateSource(u) { it.updates.push(u); } };
    return it;
  };
  const a = item();
  assert.equal(prepareOnCreate(a), true);
  assert.deepEqual(a.updates, [{ "system.prepared": 1 }]);
  for (const it of [item({ prepared: 1 }), item({ prepared: 2 }), item({ method: "pact" }), item({ method: "innate" }), item({ method: "atwill" }), item({ actor: "npc" }), item({ actor: null }), item({ type: "feat" })]) {
    assert.equal(prepareOnCreate(it), false); assert.deepEqual(it.updates, []);
  }
  CONFIG.DND5E.spellcasting = { spell: { prepares: true }, pact: { prepares: true }, innate: { prepares: false } }; // the system says which methods prepare (2024 pact magic does)
  const p = item({ method: "pact" });
  assert.equal(prepareOnCreate(p), true); assert.deepEqual(p.updates, [{ "system.prepared": 1 }]);
  assert.equal(prepareOnCreate(item({ method: "innate" })), false);
  delete CONFIG.DND5E.spellcasting;
  settings.preparedSpells = false;
  const b = item();
  assert.equal(prepareOnCreate(b), false); assert.deepEqual(b.updates, []);
  settings.preparedSpells = true;
});
