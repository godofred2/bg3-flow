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
