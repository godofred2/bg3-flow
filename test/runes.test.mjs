// Rune Knight features bg3-flow plays: the Cloud Rune reaction (an equipped item, or the Rune Knight's own feature) and Giant's Might.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], chat: [], reactions: [], items: [], effects: [], tokens: [], deleted: [] };
globalThis.Hooks = { once() {}, on: (h) => calls.hooks.push(h), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: {} };
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
const settings = { runeFeatures: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat: null,
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
globalThis.canvas = { scene: { tokens: { contents: [] } } };
const used = new Set();
globalThis.MidiQOL = { hasUsedReaction: (a) => used.has(a.uuid), setReactionUsed: async (a) => { used.add(a.uuid); calls.reactions.push(a.name); } };

const { cloudRuneOf, cloudRuneReactors, redirectChoices, onHitsChecked, isGiantsMight, onRollCompleteGiant, onDeleteEffectGiant, registerRunes } = await import("../scripts/runes.js");

function tok(id, x, { items = [], hp = 10, ac = 12, hidden = false, width = 1 } = {}) {
  const actor = { uuid: `Actor.${id}`, name: id, items, effects: [], statuses: new Set(), system: { attributes: { hp: { value: hp }, ac: { value: ac } } },
    createEmbeddedDocuments: async (t, data) => { calls.effects.push([id, ...data]); return data; } };
  const doc = { id, name: id, uuid: `Scene.s.Token.${id}`, x, y: 0, hidden, width, height: width, actor,
    update: async (u) => { calls.tokens.push([id, u]); Object.assign(doc, u); } };
  doc.object = { document: doc };
  for (const i of items) i.parent = actor;
  return doc;
}
const rune = (type = "feat", equipped = undefined, uses = { max: "1", spent: 0 }) => { const i = { name: "Cloud Rune", type, system: { uses, ...(equipped === undefined ? {} : { equipped }) }, update: async (u) => { calls.items.push(u); i.system.uses.spent = u["system.uses.spent"]; } }; return i; };
const dist = (a, b) => Math.abs(a.x - b.x) / 20; // 100 px = 5 ft
const deps = (answer) => ({ see: () => true, dist, ask: async (r, data) => { calls.asked = [r.doc.id, data.choices.map((c) => c.name)]; return answer(data); } });
const workflow = (attacker, target, { total = 15, crit = false } = {}) => {
  const hit = new Set([target.object]);
  return { activity: { type: "attack" }, token: attacker.object, attackTotal: total, isCritical: crit, hitTargets: hit, hitTargetsEC: new Set(), targets: new Set([target.object]) };
};
const reset = () => { calls.chat = []; calls.reactions = []; calls.items = []; calls.effects = []; calls.tokens = []; calls.asked = null; used.clear(); };

test("cloudRuneOf: the Rune Knight's feature, or an equipped item named Cloud Rune, with a use left; an unequipped item, a spent one or another name is not", () => {
  assert.ok(cloudRuneOf({ items: [rune()] }));
  assert.ok(cloudRuneOf({ items: [rune("equipment", true)] }));
  assert.equal(cloudRuneOf({ items: [rune("equipment", false)] }), null);
  assert.equal(cloudRuneOf({ items: [rune("feat", undefined, { max: "1", spent: 1 })] }), null);
  assert.ok(cloudRuneOf({ items: [rune("feat", undefined, { max: "", spent: 0 })] })); // no uses set: the reaction is the limit
  assert.ok(cloudRuneOf({ items: [{ ...rune(), name: "Runa de las nubes" }] }));
  assert.equal(cloudRuneOf({ items: [{ ...rune(), name: "Fire Rune" }] }), null);
});

test("cloudRuneReactors / redirectChoices: holders within 30 ft of the creature hit who see it and have their reaction (the attacker never); the choices are the other creatures within 30 ft of the holder, not the attacker nor the creature hit, alive and visible", () => {
  reset();
  const goblin = tok("goblin", 0), fighter = tok("fighter", 100), marek = tok("marek", 500, { items: [rune()] }), far = tok("far", 1500, { items: [rune()] }), ogre = tok("ogre", 700), dead = tok("dead", 600, { hp: 0 }), hid = tok("hid", 650, { hidden: true });
  canvas.scene.tokens.contents = [goblin, fighter, marek, far, ogre, dead, hid];
  assert.deepEqual(cloudRuneReactors(fighter, goblin, { see: () => true, dist }).map((r) => r.doc.id), ["marek"]);
  used.add("Actor.marek");
  assert.deepEqual(cloudRuneReactors(fighter, goblin, { see: () => true, dist }), []);
  used.clear();
  assert.deepEqual(cloudRuneReactors(fighter, goblin, { see: () => false, dist }), []);
  for (const s of ["blinded", "incapacitated", "unconscious"]) { marek.actor.statuses = new Set([s]); assert.deepEqual(cloudRuneReactors(fighter, goblin, { see: () => true, dist }), [], s); } // can't see, or can't react
  marek.actor.statuses = new Set();
  assert.deepEqual(redirectChoices(marek, fighter, goblin, { dist }).map((d) => d.id), ["marek", "ogre"]); // himself counts; goblin (attacker), fighter (hit), dead, hidden do not
});

test("onHitsChecked: the holder's owner chooses another creature; the same roll against its AC: a hit moves the hit there, the ally is no longer hit, the reaction and the rune's use are spent, the table is told; a miss frees the ally and hits nobody; a crit always hits; a pass changes nothing", async () => {
  reset();
  const goblin = tok("goblin", 0), fighter = tok("fighter", 100), marek = tok("marek", 500, { items: [rune()] }), ogre = tok("ogre", 700, { ac: 11 });
  canvas.scene.tokens.contents = [goblin, fighter, marek, ogre];
  let wf = workflow(goblin, fighter, { total: 14 });
  await onHitsChecked(wf, deps((d) => d.choices.find((c) => c.name === "ogre").uuid));
  assert.deepEqual(calls.asked, ["marek", ["marek", "ogre"]]);
  assert.deepEqual([[...wf.hitTargets].map((t) => t.document.id), [...wf.targets].map((t) => t.document.id)], [["ogre"], ["ogre"]]);
  assert.deepEqual(calls.reactions, ["marek"]);
  assert.deepEqual(calls.items, [{ "system.uses.spent": 1 }]);
  assert.deepEqual(calls.chat.map((m) => m.content), ['BG3FLOW.Runes.Redirect:{"reactor":"marek","attacker":"goblin","target":"fighter","other":"ogre","result":"BG3FLOW.Runes.Hit"}']);
  reset(); marek.actor.items[0].system.uses.spent = 0; ogre.actor.system.attributes.ac.value = 20;
  wf = workflow(goblin, fighter, { total: 14 });
  await onHitsChecked(wf, deps((d) => d.choices.find((c) => c.name === "ogre").uuid));
  assert.deepEqual([[...wf.hitTargets], [...wf.targets].map((t) => t.document.id)], [[], ["ogre"]]); // 14 vs AC 20: a miss
  assert.match(calls.chat[0].content, /Runes.Miss/);
  reset(); marek.actor.items[0].system.uses.spent = 0;
  wf = workflow(goblin, fighter, { total: 14, crit: true });
  await onHitsChecked(wf, deps((d) => d.choices.find((c) => c.name === "ogre").uuid));
  assert.deepEqual([...wf.hitTargets].map((t) => t.document.id), ["ogre"]);
  reset(); marek.actor.items[0].system.uses.spent = 0;
  wf = workflow(goblin, fighter);
  await onHitsChecked(wf, deps(() => null));
  assert.deepEqual([[...wf.hitTargets].map((t) => t.document.id), calls.reactions, calls.items, calls.chat], [["fighter"], [], [], []]);
  reset();
  wf = workflow(goblin, fighter); wf.activity = { type: "save" };
  await onHitsChecked(wf, deps(() => { throw new Error("asked on a save"); }));
  settings.runeFeatures = false;
  await onHitsChecked(workflow(goblin, fighter), deps(() => { throw new Error("asked with the setting off"); }));
  settings.runeFeatures = true;
});

test("Giant's Might: on use, an effect on the Rune Knight (advantage on Strength checks and saves, size Large, the Strength modifier again on Strength weapon damage, 1 minute) and its Medium token grows to 2x2; a second use refreshes it; an item that carries its own effect is left alone; the effect's end puts the token back", async () => {
  reset();
  const marek = tok("marek", 0);
  canvas.scene.tokens.contents = [marek];
  const item = { name: "Giant's Might", uuid: "Actor.marek.Item.gm", img: "gm.webp", effects: { size: 0 } };
  assert.equal(isGiantsMight("Giant’s Might"), true);
  assert.equal(isGiantsMight("Poder del gigante"), true);
  assert.equal(isGiantsMight("Giant Strength"), false);
  await onRollCompleteGiant({ item, actor: marek.actor, token: marek.object });
  const [id, fx] = calls.effects[0];
  assert.equal(id, "marek");
  const keys = Object.fromEntries(fx.changes.map((c) => [c.key, c.value]));
  assert.deepEqual(keys, { "flags.midi-qol.advantage.check.str": "1", "flags.midi-qol.advantage.save.str": "1", "system.traits.size": "lg", "damage": "@abilities.str.mod" }); // Midi 14.6.8's keys (no "ability.")
  const dmg = fx.changes.find((c) => c.key === "damage"); // the table's "Strength twice" rule instead of the 1d6: Strength weapon attacks add the Strength modifier again
  assert.deepEqual([dmg.type, JSON.parse(dmg.conditions)], ["dnd5e.bonus", [{ k: "roll.attack.classification", v: "weapon", o: "exact" }, { k: "roll.ability", v: "str", o: "exact" }]]);
  assert.deepEqual([fx.origin, fx.duration.rounds, fx.flags["bg3-flow"].giantsMight.prev], ["Actor.marek.Item.gm", 10, { width: 1, height: 1 }]);
  assert.deepEqual(calls.tokens, [["marek", { width: 2, height: 2, x: 0, y: 0 }]]); // x and y kept: a size-only update lets Foundry shift the token off the grid
  // a second use while it lasts: the old effect goes without shrinking the token (its stored size cleared first), the new one carries that size
  const old = { flags: { "bg3-flow": { giantsMight: { prev: { width: 1, height: 1 } } } }, parent: marek.actor,
    update: async (u) => { old.flags["bg3-flow"].giantsMight.prev = u["flags.bg3-flow.giantsMight.prev"]; }, delete: async () => { calls.deleted.push("old"); await onDeleteEffectGiant(old); } };
  marek.actor.effects = [old]; calls.tokens = []; calls.effects = [];
  await onRollCompleteGiant({ item, actor: marek.actor, token: marek.object });
  assert.deepEqual(calls.deleted, ["old"]);
  assert.deepEqual(calls.tokens, []); // no shrink and grow
  assert.deepEqual(calls.effects[0][1].flags["bg3-flow"].giantsMight.prev, { width: 1, height: 1 });
  marek.actor.effects = []; calls.tokens = []; calls.effects = [];
  await onRollCompleteGiant({ item: { ...item, effects: { size: 1 } }, actor: marek.actor, token: marek.object }); // configured by hand
  await onRollCompleteGiant({ item, actor: marek.actor, token: marek.object, aborted: true });
  assert.deepEqual([calls.effects, calls.tokens], [[], []]);
  const big = tok("big", 0, { width: 2 }); canvas.scene.tokens.contents = [big];
  await onRollCompleteGiant({ item, actor: big.actor, token: big.object }); // already Large: no growth, no size to put back
  assert.deepEqual([calls.tokens, calls.effects[0][1].flags["bg3-flow"].giantsMight.prev], [[], null]);
  game.users.activeGM = { isSelf: false }; calls.tokens = []; canvas.scene.tokens.contents = [marek];
  await onDeleteEffectGiant({ flags: { "bg3-flow": { giantsMight: { prev: { width: 1, height: 1 } } } }, parent: marek.actor }); // only the lead GM restores
  assert.deepEqual(calls.tokens, []);
  game.users.activeGM = { isSelf: true };
  marek.x = 600; marek.y = 1500;
  await onDeleteEffectGiant({ flags: { "bg3-flow": { giantsMight: { prev: { width: 1, height: 1 } } } }, parent: marek.actor });
  assert.deepEqual(calls.tokens, [["marek", { width: 1, height: 1, x: 600, y: 1500 }]]);
});

test("registerRunes hooks hitsChecked, RollComplete and deleteActiveEffect; the strings exist in both languages", () => {
  calls.hooks = [];
  registerRunes();
  for (const h of ["midi-qol.hitsChecked", "midi-qol.RollComplete", "deleteActiveEffect"]) assert.ok(calls.hooks.includes(h), h);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  for (const k of ["Ask", "Pass", "Redirect", "Hit", "Miss", "MightBonus"]) { assert.ok(en.Runes?.[k], k); assert.ok(es.Runes?.[k], k); }
  assert.ok(en.Settings.runeFeatures?.Name && es.Settings.runeFeatures?.Name);
});
