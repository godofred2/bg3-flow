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
  assert.equal(MIDI_PRESET.hideRollDetails, "none");
});
test("applyPreset keeps unknown keys", () => {
  const merged = mergePreset({ weird: 1, autoTarget: "none" }, MIDI_PRESET);
  assert.equal(merged.weird, 1);
  assert.equal(merged.autoTarget, "wallsBlock");
});

import { shouldPrompt, splitTargets, applyChoice, dispositionFilterFor } from "../scripts/rules.js";
const pc = { id: "a", name: "Cleric", disposition: 1 }, ally = { id: "b", name: "Rogue", disposition: 1 };
const gob = { id: "c", name: "Goblin", disposition: -1 };
test("shouldPrompt only with choice flag and a friend", () => {
  assert.equal(shouldPrompt({ choice: true, casterDisposition: 1, targets: [ally, gob] }), true);
  assert.equal(shouldPrompt({ choice: false, casterDisposition: 1, targets: [ally, gob] }), false);
  assert.equal(shouldPrompt({ choice: true, casterDisposition: 1, targets: [gob] }), false);
});
test("shouldPrompt no caster token", () => {
  assert.equal(shouldPrompt({ choice: true, casterDisposition: null, targets: [ally] }), false);
});
test("splitTargets hostile caster", () => {
  const r = splitTargets(-1, [pc, gob]);
  assert.deepEqual(r.friends, [gob]); assert.deepEqual(r.foes, [pc]);
});
test("applyChoice variants", () => {
  const friends = [ally], foes = [gob];
  assert.deepEqual(applyChoice({ choice: "enemies", friends, foes }), [gob]);
  assert.deepEqual(applyChoice({ choice: "everyone", friends, foes }), [gob, ally]);
  assert.deepEqual(applyChoice({ choice: "checked", friends, foes, checkedIds: [] }), [gob]);
  assert.deepEqual(applyChoice({ choice: "checked", friends, foes, checkedIds: ["b"] }), [gob, ally]);
});
test("applyChoice enemies with no foes", () => {
  assert.deepEqual(applyChoice({ choice: "enemies", friends: [ally], foes: [] }), []);
});
test("dispositionFilterFor maps to Midi numeric filter", () => {
  assert.equal(dispositionFilterFor("enemies"), -1);
  assert.equal(dispositionFilterFor("everyone"), 0);
  assert.equal(dispositionFilterFor("checked"), null);
});

import { presetUnknownKeys } from "../scripts/rules.js";
test("mergePreset skips keys Midi does not know", () => {
  const merged = mergePreset({ autoTarget: "none" }, { autoTarget: "wallsBlock", bogus: 1 });
  assert.deepEqual(merged, { autoTarget: "wallsBlock" });
});
test("presetUnknownKeys lists keys missing from current", () => {
  assert.deepEqual(presetUnknownKeys({ autoTarget: "none" }, { autoTarget: "wallsBlock", bogus: 1 }), ["bogus"]);
});
