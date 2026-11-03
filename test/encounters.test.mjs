// Feature 3 hooks against stubbed Foundry globals.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = { flags: [], status: [], warn: [], chat: [], gm: [] };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn: (m) => calls.warn.push(m) }, controls: { render: (o) => calls.render.push(o) } };
calls.render = [];
globalThis.ChatMessage = { create: async (d) => calls.chat.push(d) };
globalThis.CONFIG = { DND5E: { skills: { ste: { label: "Stealth" }, prc: { label: "Perception" } } }, Canvas: { polygonBackends: { sight: { testCollision: () => false } } } };
let nextId = 0;
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, DialogV2: class { constructor(c) { this.config = c; } render() { return this; } addEventListener() {} async close() {} static async wait() { return null; } static async prompt() { return null; } } } }, utils: { escapeHTML: (s) => s, randomID: () => `id${++nextId}` } };
const settings = { defaultEncounterRadius: 60, obscuredDarkness: 0.5 };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { isGM: true }, users: [], combat: null, combats: [], scenes: new Map(),
  settings: { get: (m, k) => settings[k], set() {}, register() {}, registerMenu() {} }
};
globalThis.canvas = null;

function tokenDoc(id, { flags = {}, owner = true, hp = 10, passive = 10, darkvision = 0, hidden = false, type = "npc", playerOwner = false, at = { x: 0, y: 0 }, roll = async () => [{ total: 10 }] } = {}) {
  const f = { "bg3-flow": { ...flags } };
  const doc = {
    id, name: id, uuid: `Scene.scene.Token.${id}`, isOwner: owner, hidden, flags: f, actorId: `act-${id}`,
    parent: { id: "scene" },
    getCenterPoint: (d) => (d && d.x !== undefined) ? { x: d.x, y: d.y } : at,
    testUserPermission: () => playerOwner,
    getFlag: (m, k) => f[m]?.[k],
    setFlag: async (m, k, v) => { f[m][k] = v; calls.flags.push([id, k, v]); },
    unsetFlag: async (m, k) => { delete f[m][k]; calls.flags.push([id, k, undefined]); }
  };
  doc.actor = {
    id: `act-${id}`, type, hasPlayerOwner: playerOwner,
    system: { attributes: { hp: { value: hp }, senses: { ranges: { darkvision } } }, skills: { prc: { passive } } },
    toggleStatusEffect: async (s, o) => calls.status.push([id, s, o.active]),
    getActiveTokens: () => [doc],
    rollSkill: roll
  };
  return doc;
}

const { markEncounter, onSceneControls, hideToken, revealToken, onPostUseActivityReveal, onRenderTokenHUD, onMoveToken, startEncounter, onApplyDamage, onRollComplete, registerEncounters } = await import("../scripts/encounters.js");

test("markEncounter sets one shared id and the radius on every token, and clears when all are marked", async () => {
  const a = tokenDoc("g1"), b = tokenDoc("g2");
  calls.flags = [];
  await markEncounter([a, b], 45);
  const fa = a.getFlag("bg3-flow", "encounter"), fb = b.getFlag("bg3-flow", "encounter");
  assert.equal(fa.id, fb.id);
  assert.deepEqual([fa.radius, fb.radius], [45, 45]);
  calls.flags = [];
  await markEncounter([a, b], 45);
  assert.deepEqual(calls.flags, [["g1", "encounter", undefined], ["g2", "encounter", undefined]]);
});

test("onSceneControls adds a GM-only button tool under tokens", () => {
  const controls = { tokens: { tools: {} } };
  game.user.isGM = true;
  onSceneControls(controls);
  const tool = controls.tokens.tools.bg3Encounter;
  assert.equal(tool.button, true);
  assert.equal(tool.visible, true);
  assert.equal(typeof tool.onChange, "function");
  game.user.isGM = false;
  onSceneControls(controls);
  assert.equal(controls.tokens.tools.bg3Encounter.visible, false);
  game.user.isGM = true;
});

test("hideToken stores the Stealth value and turns the hiding status on; again clears it", async () => {
  const r = tokenDoc("r");
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => 13);
  assert.deepEqual(r.getFlag("bg3-flow", "stealth"), { value: 13, hidden: true });
  assert.deepEqual(calls.status, [["r", "hiding", true]]);
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => 99);
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["r", "hiding", false]]);
});

test("hideToken does nothing when the dialog is closed", async () => {
  const r = tokenDoc("r2");
  calls.flags = []; calls.status = [];
  await hideToken(r, async () => null);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.status, []);
});

test("an attack or save activity reveals the actor's stealthy tokens; other activities do not", async () => {
  const r = tokenDoc("r4", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  calls.status = [];
  await onPostUseActivityReveal({ type: "utility", actor: r.actor });
  assert.equal(r.getFlag("bg3-flow", "stealth").value, 15);
  await onPostUseActivityReveal({ type: "attack", actor: r.actor });
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["r4", "hiding", false]]);
  await revealToken(r); // idempotent
  assert.equal(r.getFlag("bg3-flow", "stealth"), undefined);
});

test("renderTokenHUD adds the Hide button only for owned tokens", () => {
  const added = []; const clicks = [];
  const col = { insertAdjacentHTML: (pos, h) => added.push(h), querySelector: () => ({ addEventListener: (ev, fn) => clicks.push(fn) }) };
  const html = { querySelector: (sel) => sel === ".col.left" ? col : null };
  onRenderTokenHUD({ object: { document: tokenDoc("r5", { owner: true }) } }, html);
  assert.equal(added.length, 1);
  assert.match(added[0], /fa-eye-slash/);
  assert.equal(clicks.length, 1);
  onRenderTokenHUD({ object: { document: tokenDoc("g9", { owner: false }) } }, html);
  assert.equal(added.length, 1);
});

// ---- Detection ----
// 100 px per 5 ft square. Enemies at x=400 are 20 ft from a player at x=0.
// lights: [{ x, y, bright, dim }] radii in px; darknessSource puts the whole scene under a darkness source.
function scene(tokens, { darkness = 0, wall = false, lights = [], darknessSource = false } = {}) {
  const sources = lights.map((l) => ({ x: l.x, y: l.y, data: { bright: l.bright, dim: l.dim } }));
  globalThis.canvas = {
    ready: true, scene: { id: "scene", tokens: { contents: tokens } },
    grid: { measurePath: ([a, b]) => ({ distance: Math.hypot(b.x - a.x, b.y - a.y) / 100 * 5 }) },
    effects: {
      getDarknessLevel: () => darkness,
      testInsideLight: (p, { condition } = {}) => sources.some((s) => Math.hypot(s.x - p.x, s.y - p.y) <= s.data.dim && (!condition || condition(s))),
      testInsideDarkness: () => darknessSource
    }
  };
  CONFIG.Canvas.polygonBackends.sight.testCollision = () => wall;
}
const enemy = (id, opts = {}) => tokenDoc(id, { flags: { encounter: { id: "g", radius: 30 } }, at: { x: 400, y: 0 }, ...opts });
const player = (id, opts = {}) => tokenDoc(id, { type: "character", playerOwner: true, ...opts });
const hiding = (id, value, opts = {}) => player(id, { flags: { stealth: { value, hidden: true } }, ...opts });
let started = [];
const deps = () => ({ start: async (s, g) => started.push([s, g]) });
function reset() { started = []; calls.flags = []; calls.chat = []; game.user.isGM = true; game.combat = null; game.users = [{ id: "p1", active: true, isGM: false }]; game.users.activeGM = { isSelf: true }; }

test("an enemy in radius with line of sight spots an unhidden player and starts the encounter", async () => {
  reset(); scene([enemy("g1"), player("pc")]);
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
  assert.equal(calls.chat.length, 1);
});

test("an unhidden player is seen even in darkness: only Hide benefits from obscurity", async () => {
  reset(); scene([enemy("g1"), player("pc")], { darkness: 0.9 });
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("hidden in a clear area: spotted on sight whatever the Stealth value", async () => {
  reset(); scene([enemy("g1", { passive: 1 })]);
  await onMoveToken(hiding("pc", 30), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("hidden in darkness: invisible to enemies without darkvision, even with line of sight", async () => {
  reset(); scene([enemy("g1", { passive: 20 })], { darkness: 0.6 });
  await onMoveToken(hiding("pc", 1), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("hidden in darkness: an enemy with darkvision in range treats it as dim light, passive Perception above Stealth spots", async () => {
  reset(); scene([enemy("g2", { passive: 12, darkvision: 10 }), enemy("g1", { passive: 12, darkvision: 60 })], { darkness: 0.6 });
  await onMoveToken(hiding("pc", 11), {}, {}, null, deps()); // g2's 10 ft is out of range at 20 ft; g1 spots
  assert.deepEqual(started, [["scene", "g"]]);
  assert.match(calls.chat[0].content, /g1/);
  started = [];
  await onMoveToken(hiding("pc", 12), {}, {}, null, deps()); // a tie keeps the hider hidden
  assert.deepEqual(started, []);
});

test("hidden in a torch's dim ring on a dark scene: lightly obscured, Stealth vs passive Perception", async () => {
  reset(); const torch = { x: 0, y: 300, bright: 100, dim: 400 }; // the player at 15 ft: dim only
  scene([enemy("g1", { passive: 12 })], { darkness: 0.6, lights: [torch] });
  await onMoveToken(hiding("pc", 12), {}, {}, null, deps());
  assert.deepEqual(started, []);
  await onMoveToken(hiding("pc", 11), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("hidden in a torch's bright area on a dark scene: clear, spotted on sight", async () => {
  reset(); scene([enemy("g1", { passive: 1 })], { darkness: 0.6, lights: [{ x: 50, y: 0, bright: 100, dim: 400 }] });
  await onMoveToken(hiding("pc", 30), {}, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("a darkness source makes a lit scene magical darkness for a hidden player: darkvision does not help", async () => {
  reset(); scene([enemy("g1", { passive: 20 }), enemy("g2", { passive: 20, darkvision: 60 })], { darkness: 0, darknessSource: true });
  await onMoveToken(hiding("pc", 1), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("light is measured at the move's destination, with the token's elevation", async () => {
  reset(); let seen; scene([enemy("g1", { passive: 1 })], { darkness: 0.6 });
  canvas.effects.testInsideLight = (p) => { seen = p; return false; };
  const pc = hiding("pc", 30); pc.elevation = 5;
  await onMoveToken(pc, { destination: { x: 100, y: 0 } }, {}, null, deps());
  assert.deepEqual(seen, { x: 100, y: 0, elevation: 5 });
});

test("detection measures from the move's destination, not the position the hook still shows", async () => {
  reset(); const pc = player("pc"); // sits at x=0, 20 ft from the goblin; the move takes it out of the radius
  scene([enemy("g1"), pc]);
  await onMoveToken(pc, { destination: { x: 1500, y: 0 } }, {}, null, deps());
  assert.deepEqual(started, []);
  const far = player("pc2", { at: { x: 1500, y: 0 } }); // the move brings it into sight
  await onMoveToken(far, { destination: { x: 100, y: 0 } }, {}, null, deps());
  assert.deepEqual(started, [["scene", "g"]]);
});

test("outside the radius, behind a wall, defeated or hidden enemies: nothing happens", async () => {
  reset(); const pc = player("pc");
  scene([enemy("far", { at: { x: 700, y: 0 } }), enemy("dead", { hp: 0 }), enemy("ghost", { hidden: true })]);
  await onMoveToken(pc, {}, {}, null, deps());
  scene([enemy("g1")], { wall: true });
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("non-GM client, running combat, or NPC mover: ignored", async () => {
  reset(); scene([enemy("g1"), player("pc")]);
  game.users.activeGM = { isSelf: false }; await onMoveToken(player("pc"), {}, {}, null, deps());
  game.users.activeGM = { isSelf: true }; game.combat = { started: true }; await onMoveToken(player("pc"), {}, {}, null, deps());
  game.combat = null; await onMoveToken(tokenDoc("npc"), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

// ---- Starting combat and triggers ----
function fakeCombat() {
  const combat = {
    combatants: [], init: [], npc: 0, started: 0,
    createEmbeddedDocuments: async (name, data) => { data.forEach((d, i) => combat.combatants.push({ id: `c${i}`, ...d })); return combat.combatants; },
    rollInitiative: async (ids) => combat.init.push(ids),
    rollNPC: async () => combat.npc++,
    startCombat: async () => combat.started++
  };
  return combat;
}
function world(tokens, { existing = [] } = {}) {
  game.scenes = new Map([["scene", { id: "scene", tokens: { contents: tokens } }]]);
  game.combats = existing;
  const combat = fakeCombat();
  globalThis.Combat = { create: async (d) => { combat.data = d; return combat; } };
  return combat;
}

test("startEncounter builds the combat from the group and the player characters, PCs roll on their clients, NPCs on the GM, reveals and starts", async () => {
  reset();
  const pc1 = player("pc1", { flags: { stealth: { value: 15, hidden: true, checked: [] } } });
  const pc2 = player("pc2"); pc2.testUserPermission = () => false; // owner offline
  const combat = world([enemy("g1"), enemy("g2"), pc1, pc2, tokenDoc("villager")]);
  const asked = [];
  calls.status = [];
  const out = await startEncounter("scene", "g", { askInit: async (u, cb, c) => { asked.push([u, cb, c]); combat.combatants.find((x) => x.id === c).initiative = 12; return 12; } });
  assert.equal(out, combat);
  assert.deepEqual(combat.data, { scene: "scene", active: true });
  assert.deepEqual(combat.combatants.map((c) => c.tokenId), ["g1", "g2", "pc1", "pc2"]);
  assert.deepEqual(combat.combatants.map((c) => [c.sceneId, c.actorId]), [["scene", "act-g1"], ["scene", "act-g2"], ["scene", "act-pc1"], ["scene", "act-pc2"]]);
  assert.deepEqual(asked, [["p1", combat.id, "c2"]]);
  assert.deepEqual(combat.init, [["c3"]]);
  assert.equal(combat.npc, 1);
  assert.equal(combat.started, 1);
  assert.equal(pc1.getFlag("bg3-flow", "stealth"), undefined);
  assert.deepEqual(calls.status, [["pc1", "hiding", false]]);
});

test("startEncounter is a no-op when a combat exists on the scene, while one is starting, or without live enemies", async () => {
  reset();
  world([enemy("g1"), player("pc")], { existing: [{ scene: { id: "scene" }, started: true }] });
  assert.equal(await startEncounter("scene", "g"), null);
  const combat = world([enemy("g1"), player("pc")]);
  let release;
  const first = startEncounter("scene", "g", { askInit: () => new Promise((r) => { release = r; }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await startEncounter("scene", "g"), null);
  release(9); assert.equal(await first, combat);
  world([enemy("dead", { hp: 0 }), enemy("ghost", { hidden: true }), player("pc")]);
  assert.equal(await startEncounter("scene", "g"), null);
});

test("a move made while an encounter is starting is ignored: no second spotted line", async () => {
  reset(); const combat = world([enemy("g1"), player("pc")]); scene([enemy("g1"), player("pc")]);
  let release;
  const first = startEncounter("scene", "g", { askInit: () => new Promise((r) => { release = r; }) });
  await new Promise((r) => setTimeout(r, 0));
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, []);
  assert.deepEqual(calls.chat, []);
  release(9); assert.equal(await first, combat);
});

test("two moves in the same tick post one spotted line and start one combat", async () => {
  reset(); const combat = world([enemy("g1"), player("pc")]); scene([enemy("g1"), player("pc")]);
  const start = (s, g) => startEncounter(s, g, { askInit: async () => 9 });
  await Promise.all([onMoveToken(player("pc"), {}, {}, null, { start }), onMoveToken(player("pc2"), {}, {}, null, { start })]);
  assert.equal(calls.chat.length, 1);
  assert.equal(combat.started, 1);
});

test("applyDamage on an encounter enemy outside combat asks the GM to start that group", async () => {
  reset(); const told = [];
  const e = enemy("g1"); e.actor.token = e;
  await onApplyDamage(e.actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  await onApplyDamage(e.actor, 0, {}, { tell: async (s, g) => told.push([s, g]) });
  game.combat = { started: true };
  await onApplyDamage(e.actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  game.combat = null;
  await onApplyDamage(player("pc").actor, 5, {}, { tell: async (s, g) => told.push([s, g]) });
  assert.deepEqual(told, [["scene", "g"]]);
});

test("RollComplete by an encounter enemy with hits, or hitting one, starts; with no hits does nothing", async () => {
  reset(); const told = [];
  const tell = async (s, g) => told.push([s, g]);
  const e = enemy("g1"), pc = player("pc");
  await onRollComplete({ token: { document: e }, hitTargets: new Set([{ document: pc }]) }, { tell });
  await onRollComplete({ token: { document: pc }, hitTargets: new Set([{ document: e }]) }, { tell });
  await onRollComplete({ token: { document: e }, hitTargets: new Set() }, { tell });
  await onRollComplete({ token: { document: pc }, hitTargets: new Set([{ document: tokenDoc("villager") }]) }, { tell });
  assert.deepEqual(told, [["scene", "g"], ["scene", "g"]]);
});

test("registerEncounters hooks the events it needs", () => {
  const names = [];
  globalThis.Hooks.on = (n) => names.push(n);
  calls.render = [];
  registerEncounters();
  assert.deepEqual(calls.render, [{ reset: true }]); // the controls rendered before the hook existed
  for (const h of ["getSceneControlButtons", "renderTokenHUD", "moveToken", "dnd5e.postUseActivity", "dnd5e.applyDamage", "midi-qol.RollComplete", "combatStart", "canvasReady"]) assert.ok(names.includes(h), h);
  globalThis.Hooks.on = () => {};
});

test("a player whose client could not roll (null or error) is rolled by the GM, and the combat still starts", async () => {
  reset();
  const pc1 = player("pc1"), pc2 = player("pc2");
  const combat = world([enemy("g1"), pc1, pc2]);
  let n = 0;
  const out = await startEncounter("scene", "g", { askInit: async () => { n++; if (n === 1) return null; throw new Error("socket timeout"); } });
  assert.equal(out, combat);
  assert.deepEqual(combat.init, [["c1"], ["c2"]]);
  assert.equal(combat.started, 1);
});

test("the combat is deleted when starting it fails after creation, so the scene is not blocked", async () => {
  reset();
  const combat = world([enemy("g1"), player("pc")]);
  combat.rollNPC = async () => { throw new Error("boom"); };
  combat.delete = async () => { combat.deleted = true; };
  await assert.rejects(() => startEncounter("scene", "g", { askInit: async () => 10 }));
  assert.equal(combat.deleted, true);
});

test("only the lead GM detects and starts; an unstarted leftover combat does not block", async () => {
  reset(); game.users.activeGM = { isSelf: false };
  scene([enemy("g1"), player("pc")]);
  await onMoveToken(player("pc"), {}, {}, null, deps());
  assert.deepEqual(started, []);
  world([enemy("g1"), player("pc")]);
  assert.equal(await startEncounter("scene", "g"), null);
  reset();
  const combat = world([enemy("g1"), player("pc")], { existing: [{ scene: { id: "scene" }, started: false }] });
  assert.equal(await startEncounter("scene", "g", { askInit: async () => 10 }), combat);
});

test("a move on a scene the GM is not viewing is ignored", async () => {
  reset(); scene([enemy("g1")]);
  const pc = player("pc"); pc.parent = { id: "other" };
  await onMoveToken(pc, {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("a player-owned familiar (not a character) neither triggers detection nor joins the combat", async () => {
  reset(); scene([enemy("g1"), player("pc")]);
  await onMoveToken(tokenDoc("owl", { type: "npc", playerOwner: true }), {}, {}, null, deps());
  assert.deepEqual(started, []);
});

test("RollComplete copes with TokenDocuments in hitTargets", async () => {
  reset(); const told = [];
  await onRollComplete({ token: { document: player("pc") }, hitTargets: new Set([enemy("g1")]) }, { tell: async (s, g) => told.push([s, g]) });
  assert.deepEqual(told, [["scene", "g"]]);
});
