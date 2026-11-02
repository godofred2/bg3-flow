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
