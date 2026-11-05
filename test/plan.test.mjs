// Piece 4: autopilot planner, pure functions on invented boards.
import { test } from "node:test";
import assert from "node:assert/strict";

const { averageOf, hitChance, failChance, expectedValue, parseMultiattack, pickTarget, planTurn } = await import("../scripts/ai/plan.js");

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

const sq = (x, cost, distance, occupied = false) => ({ x, y: 0, elevation: 0, cost, distance, occupied });
function board({ budget = 30, intelligence = 10, enemies, activities, multiattack = null, paths = {}, reserved = new Set() }) {
  return { me: { id: "m", name: "Goblin", intelligence, hp: 7, maxHp: 7, x: 0, y: 0, elevation: 0, budget }, enemies, activities, multiattack, paths, reserved, threshold: 6 };
}
const scimitar = { id: "sc", uuid: "A.sc", name: "Scimitar", kind: "attack", slot: "action", range: 5, bonus: 4, damage: 5 };
const bow = { id: "bw", uuid: "A.bw", name: "Shortbow", kind: "attack", slot: "action", range: 80, bonus: 4, damage: 5 };
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
  assert.deepEqual(p.move, { x: 400, y: 0, elevation: 0 });
  assert.deepEqual(p.actions, [{ activityId: "sc", targetId: "rogue" }]);
  assert.equal(p.reason, "Scimitar vs rogue (expected 2.5); also: Shortbow 2.0");
});

test("planTurn: Multiattack sums the named attacks, repeats the best when unnamed", () => {
  const bite = { ...scimitar, id: "bi", name: "Bite", damage: 3 }, spear = { ...scimitar, id: "sp", name: "Spear", damage: 4 };
  const b = board({ enemies: [pc("rogue", 5)], activities: [bite, spear], multiattack: "The gnoll makes two attacks: one with its bite and one with its spear." });
  assert.deepEqual(planTurn(b).actions, [{ activityId: "bi", targetId: "rogue" }, { activityId: "sp", targetId: "rogue" }]);
  const two = board({ enemies: [pc("rogue", 5)], activities: [bite, spear], multiattack: "The veteran makes two attacks." });
  assert.deepEqual(planTurn(two).actions, [{ activityId: "sp", targetId: "rogue" }, { activityId: "sp", targetId: "rogue" }]);
});

test("planTurn: nothing in range walks the budget toward the nearest visible enemy, nobody visible stays", () => {
  const b = board({ budget: 10, enemies: [pc("rogue", 40), pc("wiz", 60)], activities: [scimitar], paths: { rogue: [sq(100, 5, 35), sq(200, 10, 30), sq(300, 15, 25)], wiz: [sq(100, 5, 55)] } });
  const p = planTurn(b);
  assert.deepEqual([p.move, p.actions, p.reason], [{ x: 200, y: 0, elevation: 0 }, [], "approach rogue"]);
  const none = planTurn(board({ enemies: [pc("rogue", 40, { visible: false })], activities: [scimitar], paths: {} }));
  assert.deepEqual([none.move, none.actions, none.reason], [null, [], "no visible enemy"]);
  const stuck = planTurn(board({ budget: 0, enemies: [pc("rogue", 40)], activities: [scimitar], paths: { rogue: [sq(100, 5, 35)] } }));
  assert.deepEqual([stuck.move, stuck.actions], [null, []]);
});

test("planTurn: a reserved best square sends the second monster to the next square of its path", () => {
  const b = board({ enemies: [pc("rogue", 15)], activities: [scimitar], paths: { rogue: [sq(100, 5, 10), sq(200, 10, 5), sq(250, 15, 5)] }, reserved: new Set(["200,0"]) });
  assert.deepEqual(planTurn(b).move, { x: 250, y: 0, elevation: 0 });
});
