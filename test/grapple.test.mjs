// Grappling with CAT's grapple (CPR's Grapple item): the Grapple action on every player character, the grappled creature dragged along,
// the grappler at half speed. Against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = { hooks: [], moves: [], created: [], warn: [] };
globalThis.Hooks = { once() {}, on: (h) => calls.hooks.push(h), callAll() {} };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) } };
globalThis.CONFIG = { DND5E: {}, Token: { movement: { actions: { walk: {}, displace: { teleport: true } } } } };
const settings = { grappleAction: true };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat: null, actors: [],
  modules: { get: (id) => (id === "chris-premades" ? { active: true } : undefined) },
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: { wait: async () => null } } }, utils: { escapeHTML: (s) => s } };
const scene = { id: "s", tokens: { contents: [], get: (id) => scene.tokens.contents.find((t) => t.id === id) } };
globalThis.canvas = { scene, grid: { size: 100 }, dimensions: { size: 100 } };

const { heldBy, isHolding, dragSquare, onMoveTokenGrapple, ensureGrapple, GRAPPLE_UUID, registerGrapple } = await import("../scripts/grapple.js");

const grappleSource = (tokenId) => ({ flags: { cat: { identifier: "grappleSource", grapple: { dc: 13, reach: 5, tokenId } } } });
function tok(id, x, y, { effects = [], width = 1 } = {}) {
  const doc = { id, name: id, uuid: `Scene.s.Token.${id}`, x, y, elevation: 0, width, height: width, parent: scene, movementAction: "walk",
    actor: { uuid: `Actor.${id}`, name: id, appliedEffects: effects },
    move: async (wps, opts) => { calls.moves.push([id, wps, opts]); doc.x = wps.at(-1).x; doc.y = wps.at(-1).y; } };
  return doc;
}
const reset = () => { calls.moves = []; calls.created = []; calls.warn = []; scene.tokens.contents = []; game.users.activeGM = { isSelf: true }; };

test("heldBy / isHolding: the tokens CAT says this one grapples (its grappleSource effects) and the ones bg3-flow says it engulfed", () => {
  reset();
  const cube = tok("cube", 0, 0, { effects: [grappleSource("rogue")] }), rogue = tok("rogue", 100, 0), fighter = tok("fighter", 200, 0, { effects: [{ flags: { "bg3-flow": { engulfedBy: "Scene.s.Token.cube" } } }] }), cleric = tok("cleric", 300, 0);
  scene.tokens.contents = [cube, rogue, fighter, cleric];
  assert.deepEqual(heldBy(cube).map((t) => t.id), ["rogue", "fighter"]);
  assert.deepEqual(heldBy(cleric), []);
  assert.equal(isHolding(cube), true);
  assert.equal(isHolding(cleric), false);
  assert.equal(isHolding(null), false);
});

test("dragSquare: the free square next to the mover nearest to where the held creature stood; none when it is already adjacent or every neighbour is taken", () => {
  reset();
  const mover = tok("m", 500, 500), held = tok("h", 100, 500), other = tok("o", 400, 500);
  scene.tokens.contents = [mover, held, other];
  assert.deepEqual(dragSquare(mover, held), { x: 400, y: 400 }); // west is taken by `other`: the nearest free neighbour toward the held one
  other.x = 1000;
  assert.deepEqual(dragSquare(mover, held), { x: 400, y: 500 });
  held.x = 600; held.y = 400;
  assert.equal(dragSquare(mover, held), null); // already adjacent (diagonal)
  held.x = 100; held.y = 100;
  scene.tokens.contents = [mover, held, ...[-1, 0, 1].flatMap((dx) => [-1, 0, 1].filter((dy) => dx || dy).map((dy) => tok(`n${dx}${dy}`, 500 + dx * 100, 500 + dy * 100)))];
  assert.equal(dragSquare(mover, held), null); // boxed in: the creature stays (the DM sorts it out)
});

test("moveToken on the lead GM: the grappler's walk drags its held creatures to its side with a displace move (no opportunity attack, no budget); a teleport, a stranger's move or another client do nothing", async () => {
  reset();
  const grappler = tok("g", 500, 500, { effects: [grappleSource("v")] }), victim = tok("v", 100, 100), bystander = tok("b", 900, 900);
  scene.tokens.contents = [grappler, victim, bystander];
  const movement = (action = "walk") => ({ passed: { waypoints: [{ x: 500, y: 500, action }] } });
  await onMoveTokenGrapple(grappler, movement());
  assert.deepEqual(calls.moves, [["v", [{ x: 400, y: 400, elevation: 0, action: "displace" }], { showRuler: false, bg3Drag: true }]]);
  calls.moves = [];
  await onMoveTokenGrapple(grappler, movement()); // now adjacent: nothing
  await onMoveTokenGrapple(bystander, movement());
  victim.x = 100; victim.y = 100;
  await onMoveTokenGrapple(grappler, movement("displace")); // the grappler itself was displaced (a shove, a teleport): the hold is CAT's to judge, no drag
  game.users.activeGM = { isSelf: false };
  await onMoveTokenGrapple(grappler, movement());
  assert.deepEqual(calls.moves, []);
});

test("ensureGrapple: every player character without the Grapple action gets CPR's item from its compendium; NPCs, characters that have it (by identifier or name), the setting off and a missing CPR are left alone; a missing compendium item warns once", async () => {
  reset();
  const src = { name: "Grapple", toObject: () => ({ name: "Grapple", type: "feat", system: { identifier: "grapple" } }) };
  globalThis.fromUuid = async (u) => (u === GRAPPLE_UUID ? src : null);
  const actor = (name, { type = "character", player = true, items = [] } = {}) => ({ name, type, hasPlayerOwner: player, items, createEmbeddedDocuments: async (t, data) => calls.created.push([name, t, data[0].name]) });
  const pcs = [actor("Cleric"), actor("Rogue", { items: [{ name: "Grapple", system: { identifier: "grapple" } }] }), actor("Fighter", { items: [{ name: "Agarrar", system: {} }] }), actor("Goblin", { type: "npc", player: false }), actor("Priest", { player: false })];
  await ensureGrapple(pcs);
  assert.deepEqual(calls.created, [["Cleric", "Item", "Grapple"]]);
  assert.equal(GRAPPLE_UUID, "Compendium.chris-premades.CPRMisc2014.Item.9wbU6kYxfAaRFrbI");
  calls.created = []; settings.grappleAction = false;
  await ensureGrapple([actor("Bard")]);
  settings.grappleAction = true; game.modules.get = () => undefined;
  await ensureGrapple([actor("Bard")]);
  game.modules.get = (id) => (id === "chris-premades" ? { active: true } : undefined);
  globalThis.fromUuid = async () => null;
  await ensureGrapple([actor("Bard"), actor("Druid")]);
  assert.deepEqual(calls.created, []);
  assert.equal(calls.warn.length, 1);
  game.user.isGM = false;
  globalThis.fromUuid = async () => src;
  await ensureGrapple([actor("Bard")]); // players' clients never add items
  assert.deepEqual(calls.created, []);
  game.user.isGM = true;
});

test("registerGrapple hooks ready, createActor and moveToken; the strings exist in both languages", () => {
  calls.hooks = [];
  registerGrapple();
  for (const h of ["createActor", "moveToken"]) assert.ok(calls.hooks.includes(h), h);
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).BG3FLOW, es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8")).BG3FLOW;
  assert.ok(en.Settings.grappleAction?.Name && es.Settings.grappleAction?.Name);
  assert.ok(en.Grapple?.Missing && es.Grapple?.Missing);
});
