import { test } from "node:test";
import assert from "node:assert/strict";
import { depsOk } from "../scripts/rules.js";

test("depsOk accepts supported versions", () => {
  assert.deepEqual(depsOk({ dnd5e: "6.0.6", midi: "14.6.5", libWrapper: true, socketlib: true }), { ok: true, missing: [] });
});
test("depsOk rejects old versions and missing libs", () => {
  assert.deepEqual(depsOk({ dnd5e: "5.3.3", midi: "14.0.10", libWrapper: false, socketlib: true }),
    { ok: false, missing: ["dnd5e >= 6.0", "midi-qol >= 14.6", "lib-wrapper"] });
});
test("depsOk treats null version as missing", () => {
  assert.equal(depsOk({ dnd5e: null, midi: "14.6.5", libWrapper: true, socketlib: true }).ok, false);
});

import { MIDI_PRESET, mergePreset } from "../scripts/rules.js";
test("MIDI_PRESET has the spec values", () => {
  assert.equal(MIDI_PRESET.autoRollAttack, true);
  assert.equal(MIDI_PRESET.gmAutoAttack, true);
  assert.equal(MIDI_PRESET.autoRollDamage, "onHit");
  assert.equal(MIDI_PRESET.gmAutoDamage, "onHit");
  assert.deepEqual(MIDI_PRESET.autoFastForward, ["attack", "damage", "check", "save", "skill", "tool"]);
  assert.deepEqual(MIDI_PRESET.gmAutoFastForward, ["attack", "damage", "check", "save", "skill", "tool"]);
  assert.equal(MIDI_PRESET.autoCheckHit, "all");
  assert.equal(MIDI_PRESET.autoCheckSaves, "allShow");
  assert.equal(MIDI_PRESET.autoApplyDamage, "yes");
  assert.equal(MIDI_PRESET.playerRollSaves, "nonePublic");
  assert.equal(MIDI_PRESET.rollNPCSaves, "auto");
  assert.equal(MIDI_PRESET.autoTarget, "wallsBlock");
  assert.equal(MIDI_PRESET.hideRollDetails, undefined); // removed in Midi 14.6
  assert.equal(MIDI_PRESET.gmAttackDisplay, "full");
  assert.equal(MIDI_PRESET.gmDamageDisplay, "full");
  assert.equal(MIDI_PRESET.gmAttackDsn, "show");
  assert.equal(MIDI_PRESET.gmDamageDsn, "show");
  // Reactions: Midi's own "Turn on Reaction processing" keys (Shield, Uncanny Dodge, Counterspell via premades).
  assert.equal(MIDI_PRESET.doReactions, "all");
  assert.equal(MIDI_PRESET.gmDoReactions, "all");
  assert.equal(MIDI_PRESET.reactionTimeout, 30);
  assert.equal(MIDI_PRESET.showReactionAttackRoll, "all");
  assert.equal(MIDI_PRESET.enforceReactions, "all");
  assert.equal(MIDI_PRESET.recordAOO, "all");
});
test("applyPreset keeps unknown keys", () => {
  const merged = mergePreset({ weird: 1, autoTarget: "none" }, MIDI_PRESET);
  assert.equal(merged.weird, 1);
  assert.equal(merged.autoTarget, "wallsBlock");
});

import { shouldPrompt, splitTargets, applyChoice, dispositionFilterFor } from "../scripts/rules.js";
const pc = { id: "a", name: "Cleric", disposition: 1 }, ally = { id: "b", name: "Rogue", disposition: 1 };
const gob = { id: "c", name: "Goblin", disposition: -1 };
test("shouldPrompt needs the choice flag and a template", () => {
  assert.equal(shouldPrompt({ choice: true, templateType: "radius" }), true);
  assert.equal(shouldPrompt({ choice: false, templateType: "radius" }), false);
  assert.equal(shouldPrompt({ choice: true, templateType: "" }), false);
});
test("splitTargets hostile caster", () => {
  const r = splitTargets(-1, [pc, gob]);
  assert.deepEqual(r.friends, [gob]); assert.deepEqual(r.foes, [pc]);
});
test("splitTargets never treats the caster as an ally", () => {
  const r = splitTargets(1, [pc, ally, gob], "a");
  assert.deepEqual(r.friends, [ally]); assert.deepEqual(r.foes, [pc, gob]);
});
test("applyChoice variants", () => {
  const friends = [ally], foes = [gob];
  assert.deepEqual(applyChoice({ choice: "enemies", friends, foes }), [gob]);
  assert.deepEqual(applyChoice({ choice: "everyone", friends, foes }), [gob, ally]);
});
test("applyChoice enemies with no foes", () => {
  assert.deepEqual(applyChoice({ choice: "enemies", friends: [ally], foes: [] }), []);
});
test("dispositionFilterFor maps to Midi numeric filter", () => {
  assert.equal(dispositionFilterFor("enemies"), -1);
  assert.equal(dispositionFilterFor("everyone"), 0);
  assert.equal(dispositionFilterFor(undefined), null);
});

import { presetUnknownKeys } from "../scripts/rules.js";
test("mergePreset skips keys Midi does not know", () => {
  const merged = mergePreset({ autoTarget: "none" }, { autoTarget: "wallsBlock", bogus: 1 });
  assert.deepEqual(merged, { autoTarget: "wallsBlock" });
});
test("presetUnknownKeys lists keys missing from current", () => {
  assert.deepEqual(presetUnknownKeys({ autoTarget: "none" }, { autoTarget: "wallsBlock", bogus: 1 }), ["bogus"]);
});

// ---- Feature 2: grouping, turn jump, speed, budget ----
import { groupBySide, groupOf, jumpTurn, isGroupStart, speedLimit, canMove } from "../scripts/rules.js";
const T = (id, side) => ({ id, side });
const order = [T("c", 1), T("r", 1), T("g1", -1), T("g2", -1), T("v", 0), T("x", 1)];
test("groupBySide: runs of 2+ on the same side", () => {
  assert.deepEqual(groupBySide(order), [{ side: 1, ids: ["c", "r"] }, { side: -1, ids: ["g1", "g2"] }]);
});
test("groupBySide: no wrap across the round boundary", () => {
  assert.deepEqual(groupBySide([T("a", 1), T("g", -1), T("b", 1)]), []);
});
test("groupOf finds the group or null", () => {
  const groups = groupBySide(order);
  assert.deepEqual(groupOf(groups, "r"), { side: 1, ids: ["c", "r"] });
  assert.equal(groupOf(groups, "v"), null);
});
test("jumpTurn forward skips the rest of the group", () => {
  const groups = groupBySide(order);
  assert.deepEqual(jumpTurn({ turns: order, groups, turn: 0, direction: 1 }), { turn: 2, roundDelta: 0 });
  assert.deepEqual(jumpTurn({ turns: order, groups, turn: 2, direction: 1 }), { turn: 4, roundDelta: 0 });
});
test("jumpTurn wraps round when the group ends the order", () => {
  const t = [T("g1", -1), T("c", 1), T("r", 1)];
  assert.deepEqual(jumpTurn({ turns: t, groups: groupBySide(t), turn: 1, direction: 1 }), { turn: 0, roundDelta: 1 });
});
test("jumpTurn backward lands on the previous group's first member", () => {
  const groups = groupBySide(order);
  assert.deepEqual(jumpTurn({ turns: order, groups, turn: 4, direction: -1 }), { turn: 2, roundDelta: 0 });
  assert.deepEqual(jumpTurn({ turns: order, groups, turn: 2, direction: -1 }), { turn: 0, roundDelta: 0 });
});
test("jumpTurn no group: null", () => {
  const groups = groupBySide(order);
  assert.equal(jumpTurn({ turns: order, groups, turn: 4, direction: 1 }), null);
  assert.equal(jumpTurn({ turns: order, groups, turn: 5, direction: -1 }), null);
  assert.equal(jumpTurn({ turns: [T("a", 1)], groups: [], turn: 0, direction: 1 }), null);
});
test("isGroupStart only for the first member", () => {
  const groups = groupBySide(order);
  assert.equal(isGroupStart(groups, order, 0), true);
  assert.equal(isGroupStart(groups, order, 1), false);
  assert.equal(isGroupStart(groups, order, 4), false);
});
test("speedLimit: action speed with walk fallback, dash doubles", () => {
  const speeds = { walk: 30, fly: 0, swim: 20 };
  assert.equal(speedLimit({ speeds, action: "walk", walkFallback: false, dash: false }), 30);
  assert.equal(speedLimit({ speeds, action: "swim", walkFallback: true, dash: false }), 30);
  assert.equal(speedLimit({ speeds, action: "swim", walkFallback: false, dash: false }), 20);
  assert.equal(speedLimit({ speeds, action: "walk", walkFallback: false, dash: true }), 60);
});
test("speedLimit: no speeds gives 0", () => {
  assert.equal(speedLimit({ speeds: null, action: "walk", walkFallback: true, dash: false }), 0);
});
test("canMove: ok within budget, budget reason when over, zero limit allows", () => {
  assert.deepEqual(canMove({ spent: 10, cost: 20, limit: 30 }), { ok: true, reason: null });
  assert.deepEqual(canMove({ spent: 10, cost: 25, limit: 30 }), { ok: false, reason: "budget" });
  assert.deepEqual(canMove({ spent: 50, cost: 5, limit: 0 }), { ok: true, reason: null });
});

test("jumpTurn skips defeated combatants when skipDefeated, forward and backward", () => {
  const t = [T("g1", -1), T("g2", -1), { id: "c", side: 1, defeated: true }, T("r", 1), T("v", 0)];
  const groups = groupBySide(t);
  assert.deepEqual(jumpTurn({ turns: t, groups, turn: 1, direction: 1, skipDefeated: true }), { turn: 3, roundDelta: 0 });
  assert.deepEqual(jumpTurn({ turns: t, groups, turn: 1, direction: 1, skipDefeated: false }), { turn: 2, roundDelta: 0 });
  assert.deepEqual(jumpTurn({ turns: t, groups, turn: 4, direction: -1, skipDefeated: true }), { turn: 3, roundDelta: 0 });
});
test("jumpTurn wrap lands on the first live combatant of the next round", () => {
  const t = [{ id: "g1", side: -1, defeated: true }, T("g2", -1), T("c", 1), T("r", 1)];
  assert.deepEqual(jumpTurn({ turns: t, groups: groupBySide(t), turn: 2, direction: 1, skipDefeated: true }), { turn: 1, roundDelta: 1 });
});
test("isGroupStart uses the first live member when skipDefeated", () => {
  const t = [{ id: "c", side: 1, defeated: true }, T("r", 1), T("g1", -1)];
  const groups = groupBySide(t);
  assert.equal(isGroupStart(groups, t, 1, true), true);
  assert.equal(isGroupStart(groups, t, 1, false), false);
  assert.equal(isGroupStart(groups, t, 0, false), true);
});
