// Feature 3 prompts against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.CONFIG = { DND5E: { skills: { ste: { label: "Stealth" } } } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null,
  settings: { get() {}, set() {}, register() {}, registerMenu() {} }
};

const dialogs = [];
class DialogStub {
  static next = "roll"; static typed = "";
  constructor(config) { this.config = config; this.closed = false; this.listeners = {}; dialogs.push(this); }
  render() { this.rendered = true; return this; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  async close() { this.closed = true; this.listeners.close?.(); }
  dismiss() { return this.close(); } // the header X
  async press(action) { const b = this.config.buttons.find((b) => b.action === action); return b.callback({}, { form: { elements: { value: { value: DialogStub.typed } } } }, this); }
  static async wait(config) { const d = new DialogStub(config); config.render?.({}, d); return d.press(DialogStub.next); }
}
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: DialogStub } }, utils: { escapeHTML: (s) => s } };

const { rollOrType, registerSockets, awaitOrGm, activeOwner } = await import("../scripts/prompts.js");

test("awaitOrGm resolves with the player's answer and closes the waiting dialog", async () => {
  const v = await awaitOrGm(Promise.resolve(17), { title: "t", label: "Roll for them" }, async () => 3);
  assert.equal(v, 17);
  assert.equal(dialogs.at(-1).rendered, true);
  assert.equal(dialogs.at(-1).closed, true);
});

test("awaitOrGm resolves with the GM fallback when the button is pressed first", async () => {
  const never = new Promise(() => {});
  const pending = awaitOrGm(never, { title: "t", label: "Roll for them" }, async () => 3);
  await dialogs.at(-1).press("gm");
  assert.equal(await pending, 3);
});

test("awaitOrGm ignores the player's prompt closing with null once the GM has taken over", async () => {
  let closePlayer; const player = new Promise((r) => { closePlayer = r; });
  const pending = awaitOrGm(player, { title: "t", label: "Roll for them" }, async () => { closePlayer(null); await new Promise((r) => setTimeout(r, 0)); return 9; });
  await dialogs.at(-1).press("gm");
  assert.equal(await pending, 9);
});

test("awaitOrGm runs the fallback once when the button press also closes the waiting dialog", async () => {
  let ran = 0, release;
  const pending = awaitOrGm(new Promise(() => {}), { title: "t", label: "Roll for them" }, () => { ran++; return new Promise((r) => { release = r; }); });
  const d = dialogs.at(-1);
  d.press("gm");
  await d.close(); // DialogV2 closes itself after a button callback
  assert.equal(ran, 1);
  release(4);
  assert.equal(await pending, 4);
});

test("activeOwner picks an active non-GM owner, else null", () => {
  game.users = [{ id: "gm", active: true, isGM: true }, { id: "p1", active: false, isGM: false }, { id: "p2", active: true, isGM: false }];
  const doc = { testUserPermission: (u) => u.id !== "gm" };
  assert.equal(activeOwner(doc)?.id, "p2");
  game.users[2].active = false;
  assert.equal(activeOwner(doc), null);
});

test("rollOrType: roll button returns the skill roll total, use button the typed value, close null", async () => {
  const seen = [];
  const actor = { rollSkill: async (c, d, m) => { seen.push([c, d, m]); return [{ total: 14 }]; } };
  DialogStub.next = "roll";
  assert.equal(await rollOrType({ actor, skill: "ste" }), 14);
  assert.deepEqual(seen[0], [{ skill: "ste" }, { configure: false }, { rollMode: "publicroll" }]);
  DialogStub.next = "use"; DialogStub.typed = "9";
  assert.equal(await rollOrType({ actor, skill: "ste" }), 9);
  DialogStub.typed = "";
  assert.equal(await rollOrType({ actor, skill: "ste" }), null);
  assert.equal(await rollOrType({ actor: null, skill: "ste" }), null);
});

test("registerSockets registers the three handlers and promptInitiative rolls on the player's client", async () => {
  const handlers = {};
  registerSockets({ register: (n, fn) => { handlers[n] = fn; } }, { startEncounter: async (s, g) => ["started", s, g] });
  assert.deepEqual(Object.keys(handlers).sort(), ["promptInitiative", "startEncounter", "tunnelFighter"]);
  assert.deepEqual(await handlers.startEncounter("scene", "g"), ["started", "scene", "g"]);
  const rolled = [];
  const combat = { combatants: new Map([["c1", { initiative: 12 }]]), rollInitiative: async (ids, o) => rolled.push([ids, o]) };
  game.combat = null; // the player may be viewing another combat or scene: the handler must not depend on it
  game.combats = new Map([["cb", combat]]);
  assert.equal(await handlers.promptInitiative("cb", "c1"), 12);
  assert.deepEqual(rolled, [[["c1"], { messageMode: "publicroll" }]]); // v14: messageOptions.rollMode is deprecated for messageMode
  assert.equal(await handlers.promptInitiative("cb", "nope"), null);
  assert.equal(await handlers.promptInitiative("gone", "c1"), null);
});

test("awaitOrGm runs the fallback when the GM dismisses the dialog with its X", async () => {
  const never = new Promise(() => {});
  const pending = awaitOrGm(never, { title: "t", label: "Roll for them" }, async () => 5);
  await dialogs.at(-1).dismiss();
  assert.equal(await pending, 5);
});

test("awaitOrGm does not run the fallback when it closes the dialog itself after the answer", async () => {
  let ran = 0;
  await awaitOrGm(Promise.resolve(1), { title: "t", label: "l" }, async () => { ran++; return 5; });
  assert.equal(ran, 0);
});

test("the tunnelFighter socket handler attacks through Midi with the monster as the only target and no reaction check, passes on Pass, close or after 30 s", async () => {
  const uses = [];
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { uses.push([a.uuid, cfg.midiOptions, dialog]); return { hitTargets: new Set([{}]) }; } };
  globalThis.fromUuidSync = (uuid) => uuid === "A.ls" ? { uuid, name: "Longsword", actor: { name: "Fighter" } } : uuid === "T.g1" ? { name: "Goblin" } : null;
  const handlers = {};
  registerSockets({ register: (n, fn) => { handlers[n] = fn; } }, { startEncounter() {} });
  DialogStub.next = "attack";
  assert.deepEqual(await handlers.tunnelFighter("Actor.f", "A.ls", "T.g1"), { hit: true });
  assert.deepEqual(uses, [["A.ls", { targetUuids: ["T.g1"], ignoreUserTargets: true, proceedChecks: { checkAoO: false } }, { configure: false }]]);
  assert.ok(dialogs.at(-1).config.window.title.includes("Fighter") && dialogs.at(-1).config.window.title.includes("Goblin"));
  DialogStub.next = "pass";
  assert.deepEqual(await handlers.tunnelFighter("Actor.f", "A.ls", "T.g1"), { hit: false });
  assert.equal(uses.length, 1);
});
