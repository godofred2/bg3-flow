// Piece 4: autopilot planner, pure functions on invented boards.
import { test } from "node:test";
import assert from "node:assert/strict";

const { averageOf, hitChance, failChance, expectedValue, parseMultiattack } = await import("../scripts/ai/plan.js");

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
