# BG3 Flow, Feature 1 (skeleton + full automation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `bg3-flow` module skeleton with the Midi automation preset button, the friend-or-foe target prompt, and the docs that let the user set up ongoing-area spells and let another Claude test it on the server.

**Architecture:** Plain ES modules loaded by Foundry, no build step. Pure decision logic lives in `scripts/rules.js` (no Foundry globals) and is tested with `node --test`. Foundry-facing code (`main.js`, `automation.js`) only wires hooks, settings and dialogs around those pure functions and is verified manually on the server via `docs/SERVER-TESTING.md`.

**Tech Stack:** Foundry VTT v14 API, dnd5e 6.0.x, Midi QOL 14.6.x, libWrapper, socketlib, Node 24 (`node --test`), git.

**Spec:** `docs/superpowers/specs/2026-11-02-bg3-flow-design.md`

## Global Constraints

- Module id `bg3-flow`. Foundry compatibility minimum `14`, verified `14`.
- Dependencies in `module.json` relationships: dnd5e `>=6.0 <7`, midi-qol `>=14.6`, lib-wrapper, socketlib.
- Startup gate: if dnd5e < 6.0, Midi < 14.6, libWrapper or socketlib missing: one `ui.notifications.warn` and register nothing.
- Every hook body wrapped in try/catch, logs with prefix `[bg3-flow]`, never rethrows.
- All settings world scope. Feature toggles `enableAutomation`, `enableTurns`, `enableEncounters` default true.
- Languages: `lang/en.json` and `lang/es.json`; every user-visible string goes through `game.i18n.localize`.
- No new runtime dependencies. No bundler.

## Review Focus

1. Preset applied when Midi's `ConfigSettings` already has unknown extra keys: those keys must survive untouched (Task 2 test `applyPreset keeps unknown keys`).
2. Friend-or-foe prompt when the caster token is hostile (an NPC casting Spirit Guardians): "friends" must be hostile tokens, "foes" friendly ones (Task 3 test `splitTargets hostile caster`).
3. Prompt when every target is a friend and the user picks "Enemies only": workflow must continue with zero targets, not throw (Task 3 test `applyChoice enemies with no foes`).
4. Caster with no token (sheet cast with no scene token): prompt must be skipped, not crash (Task 3 test `shouldPrompt no caster token`).
5. Region created by the cast has no Midi behaviour (plain dnd5e area): disposition write must be skipped silently (Task 3 test `regionFilterUpdate no behaviour`).

---

### Task 1: Module skeleton, settings and version gate

**Files:**
- Create: `module.json`, `scripts/main.js`, `scripts/rules.js`, `lang/en.json`, `lang/es.json`, `test/rules.test.mjs`, `package.json`
- Modify: `.gitignore` (add `*.zip`)

**Interfaces:**
- Produces: `rules.js` export `depsOk({dnd5e, midi, libWrapper, socketlib}) -> {ok: boolean, missing: string[]}` where `dnd5e`/`midi` are version strings or null, the others booleans. `main.js` export `MODULE_ID = "bg3-flow"` and `log(...args)` (console.log with prefix). `main.js` export `safe(fn)` that returns a wrapped function catching and logging errors.

- [ ] **Step 1: Write the failing tests in `test/rules.test.mjs`**

```js
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
```

- [ ] **Step 2: Run tests, expect failure**

Run: `node --test test/` Expected: FAIL, cannot find `../scripts/rules.js`.

- [ ] **Step 3: Create `package.json` with `{"type":"module","scripts":{"test":"node --test test/"}}` and `scripts/rules.js` with `depsOk`**

Compare versions numerically on the first two components (`"14.6.5"` → `[14, 6]`). Missing-list order: dnd5e, midi-qol, lib-wrapper, socketlib.

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test` Expected: 3 passing.

- [ ] **Step 5: Create `module.json`**

Fields: `id`, `title` "BG3 Flow", `description`, `version` "0.1.0", `authors` [{name: "Emilio Nava"}], `compatibility` {minimum "14", verified "14"}, `esmodules` ["scripts/main.js"], `languages` en and es, `relationships.systems` [dnd5e `>=6.0 <7`], `relationships.requires` [midi-qol `>=14.6`, lib-wrapper, socketlib], `manifest` and `download` URLs pointing at `https://github.com/<owner>/bg3-flow/releases/latest/download/module.json` and `.../module.zip` (owner filled in Task 5).

- [ ] **Step 6: Create `scripts/main.js`**

On `init`: register the three feature booleans, `lockGmMovement` (false), `defaultEncounterRadius` (Number, 60), `obscuredDarkness` (Number, 0.5). On `ready`: build the `depsOk` input from `game.system.version`, `game.modules.get("midi-qol")?.version`, `game.modules.get("lib-wrapper")?.active`, `game.modules.get("socketlib")?.active`; if not ok, `ui.notifications.warn(localize("BG3FLOW.DepsMissing") + missing.join(", "))` and return. Otherwise call `registerAutomation()` from `./automation.js` when `enableAutomation` is on (file arrives in Task 2; import it now and export an empty function placeholder there so the module loads).

- [ ] **Step 7: Create `lang/en.json` and `lang/es.json`**

Keys: `BG3FLOW.DepsMissing`, setting names and hints for the six settings, `BG3FLOW.Preset.Menu`, `BG3FLOW.Preset.Title`, `BG3FLOW.Preset.Confirm`, `BG3FLOW.Preset.Done`, `BG3FLOW.Targets.Title`, `BG3FLOW.Targets.Hint`, `BG3FLOW.Targets.EnemiesOnly`, `BG3FLOW.Targets.Everyone`, `BG3FLOW.Targets.OnlyChecked`. Spanish text written by the implementer.

- [ ] **Step 8: Commit**

```bash
git add module.json package.json scripts lang test .gitignore
git commit -m "feat: module skeleton with settings and dependency gate"
```

### Task 2: Automation preset button

**Files:**
- Create: `scripts/automation.js`
- Modify: `scripts/rules.js`, `test/rules.test.mjs`, `scripts/main.js` (registerMenu)

**Interfaces:**
- Consumes: `log`, `safe`, `MODULE_ID` from `main.js`.
- Produces: `rules.js` export `MIDI_PRESET` (frozen object, exact values below) and `mergePreset(current, preset) -> object` (shallow copy of `current` overridden by `preset`). `automation.js` export `registerAutomation()` and `applyPreset()`.

- [ ] **Step 1: Write failing tests**

```js
import { MIDI_PRESET, mergePreset } from "../scripts/rules.js";
test("MIDI_PRESET has the spec values", () => {
  assert.equal(MIDI_PRESET.autoRollAttack, true);
  assert.equal(MIDI_PRESET.gmAutoAttack, true);
  assert.equal(MIDI_PRESET.autoRollDamage, "onHit");
  assert.equal(MIDI_PRESET.gmAutoDamage, "onHit");
  assert.deepEqual(MIDI_PRESET.autoFastForward, ["attack","damage","check","save","skill","tool"]);
  assert.deepEqual(MIDI_PRESET.gmAutoFastForward, ["attack","damage","check","save","skill","tool"]);
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
```

- [ ] **Step 2: Run tests, expect failure** (`npm test`, missing exports)

- [ ] **Step 3: Add `MIDI_PRESET` and `mergePreset` to `rules.js`**

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Implement `applyPreset()` in `automation.js`**

Read `game.settings.get("midi-qol","ConfigSettings")`, write `mergePreset(current, MIDI_PRESET)` back. Then `game.settings.set("midi-qol","TargetConfirmation", {enabled:false})` only if that setting is registered (check `game.settings.settings.has("midi-qol.TargetConfirmation")`; if its stored value is not an object with `enabled`, log and skip). Then `game.settings.set("dnd5e","initiativeGroupCombatants", false)` if registered. Finish with `ui.notifications.info(localize("BG3FLOW.Preset.Done"))`.

- [ ] **Step 6: Implement `registerAutomation()` and the menu**

In `main.js` `init`, `game.settings.registerMenu(MODULE_ID, "preset", { name, label, icon: "fas fa-bolt", restricted: true, type: PresetMenu })` where `PresetMenu` (in `automation.js`) extends `foundry.applications.api.ApplicationV2`; its `render()` override calls `foundry.applications.api.DialogV2.confirm({ window: {title}, content: localize("BG3FLOW.Preset.Confirm"), yes: {callback: applyPreset} })` and returns `this` without rendering anything. `registerAutomation()` registers the Task 3 hook.

- [ ] **Step 7: Commit**

```bash
git add scripts/rules.js scripts/automation.js scripts/main.js test/rules.test.mjs
git commit -m "feat: Midi automation preset button"
```

### Task 3: Friend-or-foe target prompt

**Files:**
- Modify: `scripts/rules.js`, `scripts/automation.js`, `test/rules.test.mjs`

**Interfaces:**
- Produces in `rules.js`:
  - `shouldPrompt({choice, casterDisposition, targets}) -> boolean` where `targets` is `Array<{id, name, disposition}>`; true only when `choice === true`, `casterDisposition` is a number, and at least one target has `disposition === casterDisposition`.
  - `splitTargets(casterDisposition, targets) -> {friends: Target[], foes: Target[]}`.
  - `applyChoice({choice, friends, foes, checkedIds}) -> Target[]` where `choice` is `"enemies" | "everyone" | "checked"`; returns the targets to keep.
  - `dispositionFilterFor(choice, choices) -> string|null`: maps `"enemies"` to the entry of `choices` (array of strings) that case-insensitively contains `"enem"` or `"notally"`/`"not ally"`, `"everyone"` to the one containing `"all"`, anything else null; null if no match.

- [ ] **Step 1: Write failing tests**

```js
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
test("dispositionFilterFor maps to Midi choices", () => {
  const choices = ["all", "ally", "notAlly", "enemy"];
  assert.equal(dispositionFilterFor("enemies", choices), "notAlly");
  assert.equal(dispositionFilterFor("everyone", choices), "all");
  assert.equal(dispositionFilterFor("checked", choices), null);
});
test("regionFilterUpdate no behaviour", () => {
  assert.equal(dispositionFilterFor("enemies", []), null);
});
```

- [ ] **Step 2: Run tests, expect failure**

- [ ] **Step 3: Implement the four functions in `rules.js`**

`dispositionFilterFor` prefers an entry containing `"notally"` over `"enem"` when both exist, because "not ally" is what the user asked for (neutrals still get hit).

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Wire the Midi hook in `automation.js`**

`Hooks.on("midi-qol.targetingComplete", safe(onTargetingComplete))`. In `onTargetingComplete(workflow)`:
1. Build `targets` from `workflow.targets` (Token set) as `{id: token.id, name: token.name, disposition: token.document.disposition}`; `casterDisposition = workflow.token?.document?.disposition ?? null`; `choice = workflow.activity?.target?.affects?.choice === true`.
2. If `!shouldPrompt(...)` return.
3. Open `DialogV2.wait` with content: hint text plus one checked checkbox per friend (`name="keep" value=id`), buttons `enemies`, `everyone`, `checked` (labels from lang), `rejectClose: false`; default on close is `"everyone"`.
4. `keep = applyChoice(...)`; for every token in `workflow.targets` not in `keep`: `workflow.targets.delete(token)` and `token.setTarget(false, {user: game.user, releaseOthers: false})`.
5. `updateRegionFilter(workflow.template, choice)`: if `workflow.template` is a RegionDocument, find a behaviour with `type === "midi-qol.regionActivity"`; read `choices` from `behaviour.schema.fields.dispositionFilter?.choices` (object keys or array); `filter = dispositionFilterFor(choice, choices)`; if non-null, `behaviour.update({"system.dispositionFilter": filter})`. Any missing piece: return silently.

The hook must await the dialog before returning so Midi waits; confirm at implementation that Midi awaits `targetingComplete` by reading `src/module/workflow.ts` in the Midi repo (branch `dnd6`). If it does not, switch to `midi-qol.prePreambleComplete`, which is awaited (per Midi README "workflow state hooks").

- [ ] **Step 6: Commit**

```bash
git add scripts/rules.js scripts/automation.js test/rules.test.mjs
git commit -m "feat: friend-or-foe target prompt for choice-enabled areas"
```

### Task 4: README spell setup guide and server test script

**Files:**
- Create: `README.md`, `docs/SERVER-TESTING.md`

- [ ] **Step 1: Write `README.md`**

Sections: what the module does (three features, feature 1 shipped), requirements with exact versions, install via manifest URL, "Apply BG3 automation preset" walkthrough, friend-or-foe prompt behaviour, and "Ongoing areas with Midi 14" guide: for Spirit Guardians, Moonbeam, Cloud of Daggers, how to open the activity's Midi tab, enable the Region behaviour with triggers Token Enters + Turn Start, action Use Activity, attach region to caster (Spirit Guardians, Moonbeam) or stationary (Cloud of Daggers), disposition filter default, "Allow choosing targets" flag on the activity's target so the prompt appears. Written against the Midi README section "Region Behaviour (AoE)"; link it.

- [ ] **Step 2: Write `docs/SERVER-TESTING.md`**

Audience: a Claude session with access to the Foundry server (file system or browser). Contents: (1) install steps, zip or manifest; (2) create scratch world "bg3-flow-test", dnd5e, enable required modules, confirm versions; (3) test scene: 2 PCs (one cleric with Spirit Guardians, one rogue), 2 goblins hostile, 1 friendly NPC; (4) numbered checks with expected result each: module loads without warning; preset button changes Midi settings (list the values to read back from Midi's settings screen); a goblin attack from the GM resolves with no dialogs and applies damage; Fireball centred on goblins and the friendly NPC hits all with no prompt; Spirit Guardians cast with "Allow choosing targets" on shows the prompt, "Enemies only" leaves the friendly NPC untouched; next round a goblin starting inside takes damage automatically; Dice So Nice shows dice for each roll; (5) what to report: pass/fail per check, console errors with `[bg3-flow]`, Midi and dnd5e versions.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/SERVER-TESTING.md
git commit -m "docs: README with spell setup guide and server test script"
```

### Task 5: GitHub repository and first release

**Files:**
- Create: `tools/release.sh` (helper, not shipped in the zip)
- Modify: `module.json` (fill in owner)

- [ ] **Step 1: Create the GitHub repository**

The GitHub CLI is not installed. Either install it (`winget install GitHub.cli`, then `gh auth login`) or create the repo `bg3-flow` by hand on github.com and add it as `origin`. Record the owner name and put it into the `manifest`/`download` URLs in `module.json`.

- [ ] **Step 2: Write `tools/release.sh`**

Zips `module.json scripts lang README.md` into `module.zip` with `git archive --format=zip -o module.zip HEAD module.json scripts lang README.md`. Prints the next steps: tag, push, create release with `module.zip` and `module.json` attached.

- [ ] **Step 3: Verify the zip**

Run: `bash tools/release.sh && unzip -l module.zip` Expected: lists `module.json`, `scripts/main.js`, `scripts/rules.js`, `scripts/automation.js`, both lang files, no `test/` or `docs/`.

- [ ] **Step 4: Commit**

```bash
git add module.json tools/release.sh
git commit -m "chore: release tooling and manifest URLs"
```

- [ ] **Step 5: Tag and release v0.1.0**

```bash
git tag v0.1.0 && git push origin main --tags
```
Then create the release on GitHub with `module.zip` and `module.json` attached. Hand the manifest URL to the user for the server install.
