// Piece 4: autopilot planner, pure functions on invented boards.
import { test } from "node:test";
import assert from "node:assert/strict";

const { averageOf, hitChance, failChance, expectedValue, parseMultiattack, pickTarget, planTurn, shouldFlee, planFlee, oaCost, splitAtTunnelFighter } = await import("../scripts/ai/plan.js");

test("averageOf: dice average plus flat, unknown tokens count as 0", () => {
  assert.equal(averageOf("2d6 + 3"), 10);
  assert.equal(averageOf("1d8"), 4.5);
  assert.equal(averageOf("1d6 + 1d4 - 1"), 5);
  assert.equal(averageOf("3"), 3);
  assert.equal(averageOf(""), 0);
  assert.equal(averageOf("1d8 + @mod"), 4.5);
});

test("hitChance and failChance are clamped to 5 % and 95 %", () => {
  assert.equal(hitChance({ bonus: 4, ac: 15 }), 0.5);
  assert.equal(hitChance({ bonus: 20, ac: 10 }), 0.95);
  assert.equal(hitChance({ bonus: -5, ac: 25 }), 0.05);
  assert.equal(failChance({ dc: 13, bonus: 1 }), 0.55);
  assert.equal(failChance({ dc: 30, bonus: 0 }), 0.95);
});

test("expectedValue: attack, save with half, save with none, plain damage, heal capped at missing hp", () => {
  const t = { ac: 15, saves: { dex: 1 }, hp: 4, maxHp: 10 };
  assert.equal(expectedValue({ kind: "attack", bonus: 4, damage: 6 }, t), 3);
  assert.equal(expectedValue({ kind: "save", dc: 13, saveAbility: "dex", onSave: "half", damage: 10 }, t), 0.55 * 10 + 0.45 * 5);
  assert.equal(expectedValue({ kind: "save", dc: 13, saveAbility: "dex", onSave: "none", damage: 10 }, t), 5.5);
  assert.equal(expectedValue({ kind: "damage", damage: 7 }, t), 7);
  assert.equal(expectedValue({ kind: "heal", healing: 9 }, t), 6);
});

test("parseMultiattack reads SRD texts", () => {
  const gnoll = "The gnoll makes two attacks: one with its bite and one with its spear.";
  assert.deepEqual(parseMultiattack(gnoll, ["Bite", "Spear", "Longbow"]), { count: 2, names: ["bite", "spear"] });
  const dragon = "The dragon makes three attacks: one with its bite and two with its claws.";
  assert.deepEqual(parseMultiattack(dragon, ["Bite", "Claw", "Tail"]), { count: 3, names: ["bite", "claw", "claw"] });
  assert.deepEqual(parseMultiattack("The veteran makes two longsword attacks.", ["Longsword", "Shortsword"]), { count: 2, names: [] });
  assert.deepEqual(parseMultiattack("The orc makes 2 attacks with its greataxe.", ["Greataxe"]), { count: 2, names: [] });
  assert.deepEqual(parseMultiattack("Nothing useful here.", ["Bite"]), { count: 1, names: [] });
});

const sq = (x, cost, distance, occupied = false) => ({ x, y: 0, elevation: 0, cost, distance, occupied, waypoints: [{ x, y: 0, elevation: 0 }] });
const at = (m) => m && { x: m.x, y: m.y, elevation: m.elevation };
function board({ budget = 30, intelligence = 10, enemies, activities, multiattack = null, paths = {}, reserved = new Set() }) {
  return { me: { id: "m", name: "Goblin", intelligence, hp: 7, maxHp: 7, x: 0, y: 0, elevation: 0, budget }, enemies, activities, multiattack, paths, reserved, threshold: 6 };
}
const scimitar = { id: "sc", uuid: "A.sc", name: "Scimitar", kind: "attack", slot: "action", range: 5, bonus: 4, damage: 5 };
const bow = { id: "bw", uuid: "A.bw", name: "Shortbow", kind: "attack", slot: "action", range: 80, bonus: 4, damage: 5, ranged: true };
const pc = (id, distance, { hp = 10, ac = 15, visible = true } = {}) => ({ id, uuid: `T.${id}`, name: id, x: distance * 20, y: 0, elevation: 0, hp, maxHp: 20, ac, saves: {}, distance, visible });

test("pickTarget from where it stands, or from the first path square in range within budget", () => {
  const b = board({ enemies: [pc("rogue", 25)], activities: [scimitar, bow], paths: { rogue: [sq(100, 5, 20), sq(200, 10, 15), sq(300, 15, 10), sq(400, 20, 5)] } });
  assert.deepEqual(pickTarget(b, bow).square, null);
  assert.deepEqual(pickTarget(b, scimitar).square, sq(400, 20, 5));
  assert.equal(pickTarget({ ...b, me: { ...b.me, budget: 15 } }, scimitar), null);
});

test("pickTarget skips occupied and reserved squares, dead and unseen enemies", () => {
  const b = board({ enemies: [pc("a", 10, { hp: 0 }), pc("b", 10, { visible: false }), pc("c", 10)], activities: [scimitar],
    paths: { c: [sq(100, 5, 5, true), sq(150, 10, 5)] }, reserved: new Set(["150,0"]) });
  assert.equal(pickTarget(b, scimitar), null);
  b.reserved.clear();
  assert.equal(pickTarget(b, scimitar).enemy.id, "c");
});

test("ties: intelligent picks the most wounded, dumb picks the nearest", () => {
  const enemies = [pc("far-hurt", 20, { hp: 3 }), pc("near", 10)];
  const paths = { "far-hurt": [sq(100, 5, 15), sq(200, 10, 10), sq(300, 15, 5)], near: [sq(100, 5, 5)] };
  assert.equal(pickTarget(board({ intelligence: 10, enemies, activities: [scimitar], paths }), scimitar).enemy.id, "far-hurt");
  assert.equal(pickTarget(board({ intelligence: 3, enemies, activities: [scimitar], paths }), scimitar).enemy.id, "near");
});

test("planTurn: best expected value wins, reason lists the alternatives", () => {
  const b = board({ enemies: [pc("rogue", 25)], activities: [scimitar, { ...bow, damage: 4 }], paths: { rogue: [sq(100, 5, 20), sq(200, 10, 15), sq(300, 15, 10), sq(400, 20, 5)] } });
  const p = planTurn(b);
  assert.deepEqual(at(p.move), { x: 400, y: 0, elevation: 0 });
  assert.deepEqual(p.move.waypoints, [{ x: 400, y: 0, elevation: 0 }]); // the square's own route
  assert.deepEqual(p.actions, [{ activityId: "sc", targetIds: ["rogue"], aimId: "rogue" }]);
  assert.equal(p.reason, "Scimitar vs rogue (expected 2.5); also: Shortbow 2.0");
});

test("planTurn: Multiattack sums the named attacks, repeats the best when unnamed", () => {
  const bite = { ...scimitar, id: "bi", name: "Bite", damage: 3 }, spear = { ...scimitar, id: "sp", name: "Spear", damage: 4 };
  const b = board({ enemies: [pc("rogue", 5)], activities: [bite, spear], multiattack: "The gnoll makes two attacks: one with its bite and one with its spear." });
  assert.deepEqual(planTurn(b).actions, [{ activityId: "bi", targetIds: ["rogue"], aimId: "rogue" }, { activityId: "sp", targetIds: ["rogue"], aimId: "rogue" }]);
  const two = board({ enemies: [pc("rogue", 5)], activities: [bite, spear], multiattack: "The veteran makes two attacks." });
  assert.deepEqual(planTurn(two).actions, [{ activityId: "sp", targetIds: ["rogue"], aimId: "rogue" }, { activityId: "sp", targetIds: ["rogue"], aimId: "rogue" }]);
});

test("planTurn: nothing in range walks the budget toward the nearest visible enemy, nobody visible stays", () => {
  const b = board({ budget: 10, enemies: [pc("rogue", 40), pc("wiz", 60)], activities: [scimitar], paths: { rogue: [sq(100, 5, 35), sq(200, 10, 30), sq(300, 15, 25)], wiz: [sq(100, 5, 55)] } });
  const p = planTurn(b);
  assert.deepEqual([at(p.move), p.actions, p.reason], [{ x: 200, y: 0, elevation: 0 }, [], "approach rogue"]);
  const none = planTurn(board({ enemies: [pc("rogue", 40, { visible: false })], activities: [scimitar], paths: {} }));
  assert.deepEqual([none.move, none.actions, none.reason], [null, [], "no visible enemy"]);
  const stuck = planTurn(board({ budget: 0, enemies: [pc("rogue", 40)], activities: [scimitar], paths: { rogue: [sq(100, 5, 35)] } }));
  assert.deepEqual([stuck.move, stuck.actions], [null, []]);
});

test("planTurn: a reserved best square sends the second monster to the next square of its path", () => {
  const b = board({ enemies: [pc("rogue", 15)], activities: [scimitar], paths: { rogue: [sq(100, 5, 10), sq(200, 10, 5), sq(250, 15, 5)] }, reserved: new Set(["200,0"]) });
  assert.deepEqual(at(planTurn(b).move), { x: 250, y: 0, elevation: 0 });
});

test("planTurn: the move carries the path's waypoints up to the chosen square", () => {
  const path = [sq(100, 5, 20), sq(200, 10, 15), sq(300, 15, 10), sq(400, 20, 5)].map((s, k, all) => ({ ...s, waypoints: all.slice(0, k + 1).map(at) }));
  const b = board({ enemies: [pc("rogue", 25)], activities: [scimitar], paths: { rogue: path } });
  assert.deepEqual(planTurn(b).move.waypoints, [{ x: 100, y: 0, elevation: 0 }, { x: 200, y: 0, elevation: 0 }, { x: 300, y: 0, elevation: 0 }, { x: 400, y: 0, elevation: 0 }]);
  assert.deepEqual(planTurn(board({ budget: 10, enemies: [pc("rogue", 25)], activities: [scimitar], paths: { rogue: path } })).move.waypoints, [{ x: 100, y: 0, elevation: 0 }, { x: 200, y: 0, elevation: 0 }]);
});

test("expectedValue: disadvantage squares the hit chance", () => {
  const t = { ac: 15, saves: {}, hp: 10, maxHp: 10 };
  assert.equal(expectedValue({ kind: "attack", bonus: 4, damage: 6 }, t, { disadvantage: true }), 1.5);
});

test("a ranged attack next to its target has disadvantage: the scimitar wins when adjacent, the bow from afar", () => {
  const near = board({ enemies: [pc("rogue", 5)], activities: [scimitar, bow] });
  assert.equal(planTurn(near).reason, "Scimitar vs rogue (expected 2.5); also: Shortbow 1.3");
  const far = board({ budget: 0, enemies: [pc("rogue", 25)], activities: [scimitar, bow] });
  assert.equal(planTurn(far).reason, "Shortbow vs rogue (expected 2.5)");
  const walkIn = board({ enemies: [pc("rogue", 25)], activities: [bow], paths: { rogue: [sq(400, 20, 5)] } });
  assert.equal(pickTarget(walkIn, bow).square, null); // shoots from here rather than walking into melee
});

const { coverage } = await import("../scripts/ai/plan.js");
const grid = { px: 100, ft: 5 };
const c = (id, x, y, w = 1) => ({ id, cx: x, cy: y, w });
test("coverage: sphere by distance, cube by Chebyshev, cone by angle and length, line by width and length", () => {
  const all = [c("a", 450, 50), c("b", 650, 50), c("c", 450, 450), c("d", 1050, 50), c("e", 1050, 350)];
  const ids = (r) => r.map((x) => x.id);
  assert.deepEqual(ids(coverage({ area: { shape: "sphere", size: 20 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b", "c"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cube", size: 10 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 30 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b"]);
  // cone and line lengths are straight-line distance, as Foundry draws the template Midi targets from: the Fighter behind the Rogue at 20 ft is outside, one square closer he is in at 15
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 15 }, origin: c("m", 150, 50), aim: { cx: 450, cy: 50 }, creatures: [c("rogue", 450, 50), c("fighter", 550, 50)], grid })), ["rogue"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 15 }, origin: c("m", 250, 50), aim: { cx: 450, cy: 50 }, creatures: [c("rogue", 450, 50), c("fighter", 550, 50)], grid })), ["rogue", "fighter"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 15 }, origin: c("m", 50, 50), aim: { cx: 350, cy: 350 }, creatures: [c("diag", 350, 350)], grid })), []); // 3 squares diagonally: 21 ft on the map
  // a centre on or past the cone's edge ray is outside, as Foundry's template leaves it
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 15 }, origin: c("m", 650, 450), aim: { cx: 450, cy: 450 }, creatures: [c("rogue", 450, 450), c("edge", 450, 550)], grid })), ["rogue"]);
  // cones and lines start at the edge of the caster's space, half a square toward the aim: the caster is never in its own breath, and a Large caster's cone starts a full square out
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 15 }, origin: c("m", 150, 50), aim: { cx: 450, cy: 50 }, creatures: [c("m", 150, 50), c("rogue", 450, 50)], grid })), ["rogue"]);
  assert.deepEqual(ids(coverage({ area: { shape: "line", size: 15 }, origin: c("big", 200, 100, 2), aim: { cx: 600, cy: 100 }, creatures: [c("big", 200, 100, 2), c("near", 350, 100), c("far", 550, 100)], grid })), ["near", "far"]); // from x 300: near at 2.5 ft, far at 12.5 (17.5 from the centre)
  assert.deepEqual(ids(coverage({ area: { shape: "line", size: 60, width: 5 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b", "d"]);
});

test("an area aims at the enemy that covers the most, friendly fire subtracts, allies-only blasts are dropped", () => {
  const fireball = { id: "fb", uuid: "A.fb", name: "Fireball", kind: "save", slot: "action", range: 150, dc: 13, saveAbility: "dex", onSave: "half", damage: 28, area: { shape: "sphere", size: 20 }, affects: "creature" };
  const e = (id, x, y, hp = 10) => ({ ...pc(id, 30, { hp }), cx: x, cy: y, w: 1 });
  const b = { ...board({ enemies: [e("r1", 450, 50), e("r2", 650, 50), e("r3", 1450, 50)], activities: [fireball] }), allies: [], grid };
  b.me = { ...b.me, cx: 50, cy: 50, w: 1 };
  const p = planTurn(b);
  assert.deepEqual(p.actions, [{ activityId: "fb", targetIds: ["r1", "r2"], aimId: "r1" }]); // the aim travels with the use: the template is placed on it
  assert.equal(p.move, null);
  const g = (id, x) => ({ id, name: id, cx: x, cy: 50, w: 1, ac: 15, saves: { dex: 1 }, hp: 7, maxHp: 7 });
  b.allies = [g("g2", 550)]; // a goblin between r1 and r2
  assert.ok(pickTarget(b, fireball).value < pickTarget({ ...b, allies: [] }, fireball).value); // worth less with the ally inside
  assert.deepEqual(pickTarget(b, fireball).targets.map((t) => t.id), ["r1", "r2", "g2"]); // and the goblin is sent to Midi too: friendly fire is real
  b.enemies = [b.enemies[0]]; b.allies = [g("g2", 550), g("g3", 350)]; // one enemy, two allies in every blast that reaches it
  assert.equal(pickTarget(b, fireball), null);
});

test("heals: the most wounded ally in range, self-only heals only the monster, full hp scores nothing", () => {
  const cure = { id: "cw", uuid: "A.cw", name: "Cure Wounds", kind: "heal", slot: "action", range: 5, healing: 9, affects: "creature" };
  const ally = (id, hp, distance = 5) => ({ id, uuid: `T.${id}`, name: id, cx: 0, cy: 0, w: 1, hp, maxHp: 20, ac: 15, saves: {}, distance, elevation: 0 });
  const b = { ...board({ enemies: [pc("rogue", 5, { ac: 30 })], activities: [scimitar, cure] }), allies: [ally("g2", 4), ally("g3", 15), ally("m", 7)], grid: { px: 100, ft: 5 } };
  b.me = { ...b.me, hp: 7, maxHp: 7, cx: 0, cy: 0, w: 1 };
  const p = planTurn(b);
  assert.deepEqual(p.actions, [{ activityId: "cw", targetIds: ["g2"], aimId: "g2" }]); // 9 healed beats 0.25 * 5 on AC 30
  assert.equal(pickTarget(b, { ...cure, affects: "self" }), null); // the monster is at full hp
  b.me.hp = 1; b.allies.find((a) => a.id === "m").hp = 1;
  assert.equal(pickTarget(b, { ...cure, affects: "self" }).enemy.id, "m");
});

test("planTurn with slot bonus picks the best bonus activity from where it stands, or nothing", () => {
  const word = { id: "hw", uuid: "A.hw", name: "Healing Word", kind: "heal", slot: "bonus", range: 60, healing: 4.5, affects: "creature" };
  const b = { ...board({ budget: 0, enemies: [pc("rogue", 5)], activities: [scimitar, word] }), allies: [{ id: "g2", uuid: "T.g2", name: "g2", cx: 0, cy: 0, w: 1, hp: 2, maxHp: 7, ac: 15, saves: {}, distance: 30, elevation: 0 }], grid: { px: 100, ft: 5 } };
  assert.deepEqual(planTurn(b, { slot: "bonus" }).actions, [{ activityId: "hw", targetIds: ["g2"], aimId: "g2" }]);
  assert.deepEqual(planTurn(b).actions, [{ activityId: "sc", targetIds: ["rogue"], aimId: "rogue" }]);
  b.allies[0].hp = 7;
  assert.deepEqual(planTurn(b, { slot: "bonus" }), { move: null, actions: [], reason: "no bonus action" });
});

test("a clever archer next to an enemy steps back to a free square 10 ft away before shooting; a dumb one shoots at disadvantage", () => {
  const retreat = { x: 0, y: 100, elevation: 0, cost: 5, waypoints: [{ x: 0, y: 100, elevation: 0 }], distances: { rogue: 10 } };
  const smart = { ...board({ intelligence: 10, enemies: [pc("rogue", 5)], activities: [bow] }), retreats: [retreat] };
  const p = planTurn(smart);
  assert.deepEqual([at(p.move), p.actions, p.reason], [{ x: 0, y: 100, elevation: 0 }, [{ activityId: "bw", targetIds: ["rogue"], aimId: "rogue" }], "Shortbow vs rogue (expected 2.5)"]);
  const dumb = planTurn({ ...smart, me: { ...smart.me, intelligence: 3 } });
  assert.deepEqual([dumb.move, dumb.reason], [null, "Shortbow vs rogue (expected 1.3)"]);
  assert.equal(planTurn({ ...smart, retreats: [] }).move, null);
});

test("a breath weapon walks to the square whose cone covers the most, the caster counts itself from the firing square, the reason names the aim", () => {
  const breath = { id: "br", uuid: "A.br", name: "Fire Breath", kind: "save", slot: "action", range: 15, dc: 13, saveAbility: "dex", onSave: "half", damage: 24, area: { shape: "cone", size: 15 }, affects: "" };
  const e = (id, x, y, hp = 10) => ({ ...pc(id, 0, { hp }), cx: x, cy: y, w: 1, distance: Math.max(Math.abs(x - 50), Math.abs(y - 50)) / 20 });
  const path = (xs) => xs.map((x, k) => ({ x: x - 50, y: 0, elevation: 0, cost: 5 * (k + 1), distance: (450 - x) / 20, occupied: false, waypoints: [{ x: x - 50, y: 0, elevation: 0 }] }));
  // B1: Wyrmling at the left, Rogue 4 squares ahead on the row, Fighter right behind the Rogue. From the first square in range only the Rogue is in the cone; one square closer both are.
  const b = { ...board({ enemies: [e("rogue", 450, 50), e("fighter", 550, 50)], activities: [breath] }), allies: [], grid: { px: 100, ft: 5 }, paths: { rogue: path([150, 250, 350]), fighter: path([150, 250, 350]) } };
  b.me = { ...b.me, cx: 50, cy: 50, w: 1 };
  const p = planTurn(b);
  assert.deepEqual(p.actions[0].targetIds.sort(), ["fighter", "rogue"]);
  assert.deepEqual(at(p.move), { x: 200, y: 0, elevation: 0 }); // one square closer than the first in range: the cone catches both from there
  assert.ok(p.reason.startsWith("Fire Breath vs rogue"));
  // a self-centred burst next to the aim: the caster inside its own blast at the firing square counts against it (and is a target)
  const burst = { ...breath, name: "Thunder Burst", area: { shape: "sphere", size: 10 }, range: 10 };
  const one = { ...b, enemies: [e("rogue", 450, 50)], activities: [burst], allies: [{ ...b.me, id: "m", name: "Goblin", ac: 15, saves: { dex: 10 }, hp: 7, maxHp: 7 }] }; // a nimble caster: its own blast still costs less than it deals
  const pick = pickTarget(one, burst);
  assert.ok(pick.targets.some((t) => t.id === "m"));
});

test("a Multiattack from a retreat square counts its follow-up shots", () => {
  const retreat = { x: 0, y: 100, elevation: 0, cost: 5, waypoints: [{ x: 0, y: 100, elevation: 0 }], distances: { rogue: 10 } };
  const b = { ...board({ intelligence: 10, enemies: [pc("rogue", 5)], activities: [bow], multiattack: "The scout makes two attacks." }), retreats: [retreat] };
  const p = planTurn(b);
  assert.deepEqual(at(p.move), { x: 0, y: 100, elevation: 0 });
  assert.equal(p.actions.length, 2);
  assert.ok(p.reason.startsWith("Multiattack vs rogue (expected 5.0)"));
});

test("a clever archer with a scimitar too steps back on a tie: ranged attackers keep their distance", () => {
  const retreat = { x: 0, y: 100, elevation: 0, cost: 5, waypoints: [{ x: 0, y: 100, elevation: 0 }], distances: { rogue: 10 } };
  const b = { ...board({ intelligence: 10, enemies: [pc("rogue", 5)], activities: [scimitar, bow] }), retreats: [retreat] };
  const p = planTurn(b);
  assert.deepEqual([at(p.move), p.actions[0].activityId], [{ x: 0, y: 100, elevation: 0 }, "bw"]);
  assert.equal(p.reason, "Shortbow vs rogue (expected 2.5); also: Scimitar 2.5");
});

const fleeBoard = (over = {}) => ({ ...board({ enemies: [pc("rogue", 30), pc("fighter", 40)], activities: [scimitar] }), flee: { enabled: true, threshold: 25 }, allies: [{ id: "m", hp: 1, maxHp: 8 }], escape: null, away: [], ...over, me: { ...board({ enemies: [], activities: [] }).me, hp: 1, maxHp: 8, intelligence: 10, speed: 30, dash: false, alone: false, ...over.me } });
test("shouldFlee: below the threshold, dumb always, clever only when losing, never alone or when disabled", () => {
  assert.equal(shouldFlee(fleeBoard()), true); // 1/8 = 12.5 %, two enemies vs one ally
  assert.equal(shouldFlee(fleeBoard({ me: { hp: 2 } })), false); // exactly 25 % stays
  assert.equal(shouldFlee(fleeBoard({ flee: { enabled: false, threshold: 25 } })), false);
  assert.equal(shouldFlee(fleeBoard({ me: { alone: true } })), false);
  assert.equal(shouldFlee(fleeBoard({ allies: [{ id: "m", hp: 1, maxHp: 8 }, { id: "g2", hp: 5, maxHp: 7 }, { id: "g3", hp: 0, maxHp: 7 }] })), false); // 2 standing vs 2: not losing
  assert.equal(shouldFlee(fleeBoard({ me: { intelligence: 3 }, allies: [{ id: "m", hp: 1, maxHp: 8 }, { id: "g2", hp: 5, maxHp: 7 }, { id: "g3", hp: 5, maxHp: 7 }] })), true); // dumb: flees even when winning
});
const esc = (x, cost, inside, dr = 30) => ({ x, y: 0, elevation: 0, cost, waypoints: [{ x, y: 0, elevation: 0 }], inside, distances: { rogue: dr, fighter: dr + 10 } });
test("planFlee: Dash toward the escape region, stop on entering it or at the budget's end; away from everyone without one", () => {
  const region = { uuid: "Scene.s.Region.r1", name: "Escape north", squares: [esc(100, 5, false), esc(200, 10, false), esc(300, 15, true), esc(400, 20, true)] };
  let p = planFlee(fleeBoard({ escape: region }));
  assert.deepEqual([at(p.move), p.actions, p.reason, p.dash, p.escape], [{ x: 300, y: 0, elevation: 0 }, [], "flee: Dash toward Escape north (hp 1/8)", true, "Scene.s.Region.r1"]);
  p = planFlee(fleeBoard({ escape: { ...region, squares: [esc(100, 30, false), esc(200, 55, false), esc(300, 70, true)] } }));
  assert.deepEqual([at(p.move), p.escape], [{ x: 200, y: 0, elevation: 0 }, null]); // 60 ft of Dash: short of the region, keeps going
  p = planFlee(fleeBoard({ escape: { ...region, squares: [esc(100, 30, false), esc(200, 55, false), esc(300, 70, true)] }, me: { dash: true, budget: 30 } }));
  assert.deepEqual(at(p.move), { x: 100, y: 0, elevation: 0 }); // already dashing: the budget is what is left
  p = planFlee(fleeBoard({ away: [esc(100, 5, undefined, 35), esc(200, 10, undefined, 45), esc(300, 15, undefined, 40), esc(400, 65, undefined, 90)] }));
  assert.deepEqual([at(p.move), p.reason, p.escape], [{ x: 200, y: 0, elevation: 0 }, "flee: Dash away from enemies (hp 1/8)", null]);
  assert.deepEqual(planFlee(fleeBoard()), { move: null, actions: [], reason: "flee: nowhere to go", dash: false, escape: null });
});
test("planTurn flees before anything else, fights when cornered, and the bonus slot never flees", () => {
  const b = fleeBoard({ enemies: [pc("rogue", 5), pc("fighter", 40)], away: [esc(100, 5, undefined, 10)] });
  assert.equal(planTurn(b).reason, "flee: Dash away from enemies (hp 1/8)");
  assert.ok(planTurn({ ...b, away: [] }).reason.startsWith("Scimitar vs rogue"));
  assert.equal(planTurn(b, { slot: "bonus" }).reason, "no bonus action");
});

const oa = (over = {}) => ({ damage: 3, hit: 0.5, reach: 5, reaction: true, tunnelFighter: false, activityUuid: "A.ls", ...over });
const rsq = (x, y, cost, distances, route = []) => ({ x, y, elevation: 0, cost, distance: distances.rogue ?? 99, occupied: false, waypoints: [...route.map((r) => ({ x: r[0], y: r[1], elevation: 0 })), { x, y, elevation: 0 }], distances });
test("oaCost: leaving a free reach costs one attack, a spent reaction none, Tunnel Fighter every extra square inside and the leaving, Sentinel scales the stop chance", () => {
  // fighter adjacent at the start (distance 5); route: (100,0) still adjacent, (200,0) out of reach
  const fighter = { ...pc("fighter", 5), oa: oa() };
  const route = [rsq(100, 0, 5, { fighter: 5 }), rsq(200, 0, 10, { fighter: 10 }, [[100, 0]])];
  const b = { ...board({ enemies: [fighter], activities: [bow], paths: { fighter: route } }), retreats: [] };
  assert.deepEqual(oaCost(b, route[1]), { damage: 3, stopFree: 1 });
  assert.deepEqual(oaCost(b, route[0]), { damage: 0, stopFree: 1 }); // still inside reach: nothing
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ reaction: false }) }] }, route[1]), { damage: 0, stopFree: 1 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ tunnelFighter: true, reaction: false }) }] }, route[1]), { damage: 6, stopFree: 1 }); // one for the second square inside, one for leaving
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ tunnelFighter: true }), sentinel: true }] }, route[1]), { damage: 6, stopFree: 0.25 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: null }] }, route[1]), { damage: 0, stopFree: 1 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, visible: false }] }, route[1]), { damage: 0, stopFree: 1 });
});
test("a clever archer steps back only when the shot gains more than the opportunity attack costs; a path through a Fighter's reach pays on the way to the Rogue", () => {
  // Fighter (AC 30, Longsword worth 1.0 expected vs me) and Rogue both adjacent; the retreat square is 10 ft from both; bow 2.5 from there, 1.25 at disadvantage from here, scimitar 2.5 vs the Rogue
  const fighter = { ...pc("fighter", 5, { ac: 30 }), oa: oa({ damage: 1 }) };
  const retreat = rsq(0, 100, 5, { fighter: 10, rogue: 10 });
  const b = { ...board({ enemies: [fighter, pc("rogue", 5)], activities: [bow, scimitar] }), retreats: [retreat] };
  let p = planTurn(b);
  assert.deepEqual([p.move, p.reason], [null, "Scimitar vs rogue (expected 2.5); also: Shortbow 1.5"]); // 2.5 - 1.0 from the retreat loses to the scimitar here
  p = planTurn({ ...b, activities: [bow, { ...scimitar, damage: 2 }] });
  assert.deepEqual([at(p.move), p.reason], [{ x: 0, y: 100, elevation: 0 }, "Shortbow vs rogue (expected 1.5; opportunity attacks 1.0); also: Scimitar 1.0"]); // now the step back pays
  p = planTurn({ ...b, activities: [bow, { ...scimitar, damage: 2 }], enemies: [{ ...fighter, oa: oa({ damage: 6 }) }, pc("rogue", 5)] });
  assert.deepEqual([p.move, p.reason], [null, "Shortbow vs rogue (expected 1.3); also: Scimitar 1.0"]); // 2.5 - 6 < 0: it shoots at disadvantage from where it stands
  assert.equal(planTurn({ ...b, me: { ...b.me, intelligence: 3 } }).move, null); // dumb: no estimate, no retreat (4b rule)
  // approach: rogue 15 ft away behind the fighter's reach; the first square in range (10 ft from the fighter) costs the leaving attack
  const rogue = pc("rogue", 15);
  const path = [rsq(100, 0, 5, { fighter: 5, rogue: 10 }), rsq(200, 0, 10, { fighter: 10, rogue: 5 }, [[100, 0]])];
  p = planTurn({ ...board({ enemies: [{ ...fighter, oa: oa({ damage: 2 }) }, rogue], activities: [scimitar], paths: { rogue: path } }), retreats: [] });
  assert.deepEqual([at(p.move), p.reason], [{ x: 200, y: 0, elevation: 0 }, "Scimitar vs rogue (expected 0.5; opportunity attacks 2.0)"]); // 2.5 - 2.0 still beats 0.25 on the Fighter's AC 30
});

test("splitAtTunnelFighter cuts the route after each square that draws a Tunnel Fighter attack Gambit would not prompt", () => {
  const tf = { ...pc("fighter", 5), oa: oa({ tunnelFighter: true, reaction: false }) };
  const route = [rsq(100, 0, 5, { fighter: 5 }), rsq(200, 0, 10, { fighter: 5 }, [[100, 0]]), rsq(300, 0, 15, { fighter: 10 }, [[100, 0], [200, 0]]), rsq(400, 0, 20, { fighter: 15 }, [[100, 0], [200, 0], [300, 0]])];
  const b = { ...board({ enemies: [tf], activities: [bow], paths: { fighter: route } }), retreats: [] };
  const move = { x: 400, y: 0, elevation: 0, waypoints: route[3].waypoints };
  assert.deepEqual(splitAtTunnelFighter(b, move), [
    { waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // second square inside reach (the start was the first)
    { waypoints: [{ x: 200, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // third
    { waypoints: [{ x: 300, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // leaving with the reaction spent
    { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }
  ]);
  const free = { ...b, enemies: [{ ...tf, oa: oa({ tunnelFighter: true, reaction: true }) }] };
  assert.deepEqual(splitAtTunnelFighter(free, move).map((s) => s.trigger), [{ enemyId: "fighter" }, { enemyId: "fighter" }, null]); // leaving with a free reaction is Gambit's
  assert.deepEqual(splitAtTunnelFighter({ ...b, enemies: [{ ...tf, oa: oa() }] }, move), [{ waypoints: move.waypoints, trigger: null }]);
});

test("a tie between acting from here and walking first stays put; only a step out of melee breaks a tie toward moving", () => {
  const bite = { ...scimitar, id: "bite", name: "Bite" }, claw = { ...scimitar, id: "claw", name: "Claw", range: 10 };
  const p = planTurn(board({ enemies: [pc("rogue", 10)], activities: [bite, claw], paths: { rogue: [sq(100, 5, 5)] } }));
  assert.deepEqual([p.move, p.reason], [null, "Claw vs rogue (expected 2.5); also: Bite 2.5"]);
});
