# BG3 Flow feature 3: encounters and stealth. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preset enemy groups with a detection radius; players move freely until an enemy spots them (passive Perception against Stealth when hidden or in darkness, Perception roll on line of sight) or damage is traded, then combat starts with everyone involved and initiative rolled on each player's own client.

**Architecture:** `encounters.js` owns marking (scene-control button, token flag, GM-only dashed circle), Hide (token HUD button, roll-or-type dialog, dnd5e `hiding` status), detection on `moveToken` (GM client, outside combat) and `startEncounter` (GM, via socketlib from whichever client sees the trigger). `prompts.js` owns the cross-client dialogs (player rolls Stealth or initiative on their own client so 3D dice show) with a GM "Roll for them" fallback. `rules.js` gets the pure decisions. Feature 2 then groups the sides of the new combat as before.

**Tech Stack:** Foundry v14 (`getSceneControlButtons` record API, `renderTokenHUD` with HTMLElement, `canvas.effects.getDarknessLevel`, `CONFIG.Canvas.polygonBackends.sight.testCollision`, `canvas.grid.measurePath`, DialogV2), dnd5e 6 (`rollSkill`, `system.skills.prc.passive`, status `hiding`, hook `dnd5e.applyDamage`), Midi 14.6 (`midi-qol.RollComplete`), socketlib, `node --test` with stubbed globals.

**Spec:** docs/superpowers/specs/2026-11-02-bg3-flow-design.md, section "Feature 3" and "Prompts". Settings `enableEncounters`, `defaultEncounterRadius`, `obscuredDarkness` already exist in `scripts/main.js`.

## Global Constraints

- Foundry 14, dnd5e 6.0.x (module.json maximum `6.0.999`), Midi QOL >= 14.6, lib-wrapper, socketlib. No build step, plain ES modules, CRLF line endings like the rest of the repo.
- Every hook body wrapped in `safe` / `safeSync` from `scripts/main.js`; log prefix `[bg3-flow]`.
- Never auto-roll for an absent player: a prompt goes to an active owner, otherwise the GM rolls. All rolls public (`rollMode: "publicroll"`).
- Reuse Midi/dnd5e for every roll (`actor.rollSkill`, `combat.rollInitiative`), never a hand-built formula.
- Pure decisions in `scripts/rules.js` with Node tests; Foundry-facing code in `encounters.js` / `prompts.js` with stubbed-global tests in `test/*.test.mjs`. TDD per step. Commits with `-c user.name="Emilio Nava" -c user.email="emilionava1999@gmail.com"`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Strings in `lang/en.json` and `lang/es.json` under `BG3FLOW.Encounter.*`, `BG3FLOW.Hide.*`, `BG3FLOW.Prompt.*`.

## Rulings (plan-level, spec silent or ambiguous)

- **Line of sight** = enemy within the encounter radius and no sight-blocking wall between token centres. The token's `sight.range` is ignored (GMs rarely configure monster vision; the radius is the knob the spec gives). Cost if wrong: an enemy with a deliberately short vision range spots further than intended.
- **Hidden marker** = dnd5e's own `hiding` status (`actor.toggleStatusEffect("hiding")`), not a custom icon.
- **Passive check memory** lives in the stealth flag itself: `flags.bg3-flow.stealth = {value, hidden, checked: [groupId...]}`. Hide rewrites the flag, which is the spec's "until the player hides again" reset without GM-side memory.
- **Who starts combat**: triggers may fire on a player client (Midi `RollComplete` for a player's attack); they call `socket.executeAsGM("startEncounter", sceneId, groupId)`. The GM handler ignores a second call while one is running or when `game.combat` already exists on that scene.
- **Darkness prompt**: a player whose token enters darkness (not hidden) is asked for Stealth once per group, as the spec says. The value is stored with `hidden: false`, so the eye-slash marker does not appear.
- **Perception rolls**: one `rollSkill({skill: "prc"})` per enemy with line of sight per player move, public. Several goblins mean several cards; accepted (BG3 does the same per turn).
- **Initiative** on the player's client with `actor.rollInitiative({createCombatants: false, initiativeOptions: {messageMode: "publicroll"}})` (no dialog: BG3 rolls for you, dice are shown). Absent owner or GM fallback: `combat.rollInitiative([id])` on the GM.

## Review Focus

1. A player-owned token moving while a Stealth prompt is still open for it (fast double move): detection must not open a second prompt. Pinned in Task 4 (`busy` guard test).
2. An encounter enemy that is already defeated (HP 0) or whose token is hidden (`token.hidden`) must not detect or be added to combat. Pinned in Task 4 and Task 5.
3. `startEncounter` while a combat already exists on the scene (damage trigger right after detection trigger): one combat, no duplicate combatants. Pinned in Task 5.
4. A PC with no active owner at combat start: GM rolls, no hang. Pinned in Task 2 (`awaitOrGm`) and Task 5.
5. Encounters toggle off (`enableEncounters` false): no scene-control button, no HUD button, no hooks. Pinned in Task 5 (`registerEncounters` only called when the setting is on; the test checks `Hooks.on` is not called by import).

## File structure

- Modify `scripts/rules.js`: pure functions `isObscured`, `passiveSpots`, `activeSpots`, `encounterGroups`, `withinRadius`.
- Create `scripts/prompts.js`: `registerSockets(socket)`, `rollOrType({actor, skill})` (local dialog), `promptSkill(userId, {tokenUuid, skill})`, `promptInitiative(userId, combatantId)`, `awaitOrGm(promise, {title, label}, fallback)`.
- Create `scripts/encounters.js`: marking, hide, detection, startEncounter, triggers, `registerEncounters()`.
- Modify `scripts/main.js`: call `registerSockets(socket)` in the `socketlib.ready` handler; `registerEncounters()` when `enableEncounters`; expose `startEncounter` and `markEncounter` in `api`.
- Modify `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7), `module.json` (0.4.0).
- Tests: `test/rules.test.mjs` (append), `test/prompts.test.mjs`, `test/encounters.test.mjs`.

---

### Task 1: Pure rules for detection

**Files:**
- Modify: `scripts/rules.js` (append after `canMove`)
- Test: `test/rules.test.mjs` (append)

**Interfaces:**
- Produces:
  - `isObscured({ hidden, darkness, threshold }) -> boolean` : `!!hidden || darkness >= threshold`
  - `passiveSpots({ obscured, passive, stealth }) -> boolean` : `obscured && passive >= stealth`
  - `activeSpots({ obscured, los, perception, stealth }) -> boolean` : `los && (!obscured || perception >= stealth)`
  - `encounterGroups(tokens) -> Map<groupId, token[]>` where each token has `flags["bg3-flow"]?.encounter?.id`; tokens without the flag are skipped.
  - `withinRadius(distance, radius) -> boolean` : `distance <= radius`

- [ ] **Step 1: Write the failing tests**

```js
import { isObscured, passiveSpots, activeSpots, encounterGroups, withinRadius } from "../scripts/rules.js";
test("isObscured: hidden or dark enough", () => {
  assert.equal(isObscured({ hidden: true, darkness: 0, threshold: 0.5 }), true);
  assert.equal(isObscured({ hidden: false, darkness: 0.5, threshold: 0.5 }), true);
  assert.equal(isObscured({ hidden: false, darkness: 0.49, threshold: 0.5 }), false);
});
test("passiveSpots only when obscured and passive meets stealth", () => {
  assert.equal(passiveSpots({ obscured: true, passive: 12, stealth: 12 }), true);
  assert.equal(passiveSpots({ obscured: true, passive: 11, stealth: 12 }), false);
  assert.equal(passiveSpots({ obscured: false, passive: 20, stealth: 1 }), false);
});
test("activeSpots: line of sight spots unless obscured, then perception vs stealth", () => {
  assert.equal(activeSpots({ obscured: false, los: true }), true);
  assert.equal(activeSpots({ obscured: false, los: false }), false);
  assert.equal(activeSpots({ obscured: true, los: true, perception: 15, stealth: 15 }), true);
  assert.equal(activeSpots({ obscured: true, los: true, perception: 14, stealth: 15 }), false);
});
test("encounterGroups groups marked tokens by id and skips unmarked", () => {
  const f = (id) => ({ flags: { "bg3-flow": { encounter: { id, radius: 60 } } } });
  const g = encounterGroups([{ ...f("a"), name: "g1" }, { ...f("a"), name: "g2" }, { ...f("b"), name: "w" }, { name: "pc", flags: {} }]);
  assert.deepEqual([...g.keys()], ["a", "b"]);
  assert.deepEqual(g.get("a").map((t) => t.name), ["g1", "g2"]);
});
test("withinRadius is inclusive", () => {
  assert.equal(withinRadius(60, 60), true);
  assert.equal(withinRadius(60.1, 60), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/rules.test.mjs`
Expected: FAIL, "does not provide an export named 'isObscured'".

- [ ] **Step 3: Implement the five functions in `scripts/rules.js`**

One-liners each, exported, with a one-line JSDoc. `encounterGroups` reads `t.flags?.["bg3-flow"]?.encounter?.id`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass (46 + 5).

- [ ] **Step 5: Commit**

```bash
git add scripts/rules.js test/rules.test.mjs
git commit -m "feat: detection rules (obscurement, passive and active spotting, encounter groups)"
```

---

### Task 2: Cross-client prompts (`prompts.js`)

**Files:**
- Create: `scripts/prompts.js`
- Modify: `scripts/main.js` (socketlib.ready handler calls `registerSockets(socket)`)
- Test: `test/prompts.test.mjs`

**Interfaces:**
- Consumes: `socket` (socketlib module socket) from `main.js`; `L` pattern from `turns.js`.
- Produces:
  - `rollOrType({ actor, skill }) -> Promise<number|null>`: DialogV2 with a number input (`name="value"`) and buttons `roll` (default; `actor.rollSkill({ skill, rollMode: "publicroll" })` → `rolls?.[0]?.total ?? null`) and `use` (the typed number, `null` if empty). Close → `null`.
  - `registerSockets(socket)`: registers `"promptSkill"` → `async ({ tokenUuid, skill }) => rollOrType({ actor: fromUuidSync(tokenUuid)?.actor, skill })`, `"promptInitiative"` → `async (combatantId) => { const c = game.combat?.combatants.get(combatantId); await c?.actor?.rollInitiative({ createCombatants: false, initiativeOptions: { messageMode: "publicroll" } }); return c?.initiative ?? null; }`, and `"startEncounter"` → `(sceneId, groupId) => startEncounter(sceneId, groupId)` imported from `encounters.js` (circular import is fine: used only at call time).
  - `promptSkill(userId, args) -> Promise<number|null>` = `socket.executeAsUser("promptSkill", userId, args)`; `promptInitiative(userId, combatantId)` likewise.
  - `awaitOrGm(promise, { title, label }, fallback) -> Promise<any>`: renders a non-modal DialogV2 on the GM (`new DialogV2({ window: { title }, content: "", buttons: [{ action: "gm", label, callback: () => fallback() }] })`, `.render({ force: true })`); resolves with whichever finishes first (the player's promise or the fallback's result); closes the dialog afterwards. Closing the dialog with X keeps waiting.
  - `activeOwner(doc) -> User|null`: first `game.users` entry with `active && !isGM && doc.testUserPermission(u, "OWNER")`.

- [ ] **Step 1: Write the failing tests** (`test/prompts.test.mjs`, stub `globalThis.foundry.applications.api.DialogV2` as a class recording `render`/`close` and exposing the buttons so the test can invoke a callback; stub `game.users`)

```js
test("awaitOrGm resolves with the player's answer and closes the waiting dialog", async () => {
  const p = Promise.resolve(17);
  const v = await awaitOrGm(p, { title: "t", label: "Roll for them" }, async () => 3);
  assert.equal(v, 17);
  assert.equal(dialogs.at(-1).closed, true);
});
test("awaitOrGm resolves with the GM fallback when the button is pressed first", async () => {
  const never = new Promise(() => {});
  const pending = awaitOrGm(never, { title: "t", label: "Roll for them" }, async () => 3);
  await dialogs.at(-1).press("gm");
  assert.equal(await pending, 3);
});
test("activeOwner picks an active non-GM owner, else null", () => {
  game.users = [{ id: "gm", active: true, isGM: true }, { id: "p1", active: false, isGM: false }, { id: "p2", active: true, isGM: false }];
  const doc = { testUserPermission: (u) => u.id !== "gm" };
  assert.equal(activeOwner(doc)?.id, "p2");
  game.users[2].active = false;
  assert.equal(activeOwner(doc), null);
});
test("rollOrType: roll button returns the skill roll total, use button the typed value", async () => {
  const actor = { rollSkill: async () => [{ total: 14 }] };
  DialogStub.next = "roll"; assert.equal(await rollOrType({ actor, skill: "ste" }), 14);
  DialogStub.next = "use"; DialogStub.typed = "9"; assert.equal(await rollOrType({ actor, skill: "ste" }), 9);
});
test("registerSockets registers the three handlers", () => {
  const names = []; registerSockets({ register: (n) => names.push(n) });
  assert.deepEqual(names.sort(), ["promptInitiative", "promptSkill", "startEncounter"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/prompts.test.mjs`
Expected: FAIL, cannot find module `../scripts/prompts.js`.

- [ ] **Step 3: Implement `scripts/prompts.js`** with the signatures above. `rollOrType` uses `DialogV2.wait({ window: { title: L("Hide.Title") }, content: <label + input type=number name=value>, buttons: [{ action: "roll", label: L("Hide.Roll"), default: true, callback: async () => total }, { action: "use", label: L("Hide.Use"), callback: (ev, button) => Number(button.form.elements.value.value) || null }], rejectClose: false })`. In `scripts/main.js` change the `socketlib.ready` handler to `socket = socketlib.registerModule(MODULE_ID); registerSockets(socket);`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/prompts.js scripts/main.js test/prompts.test.mjs
git commit -m "feat: cross-client prompts with GM fallback"
```

---

### Task 3: Marking and Hide (`encounters.js` part A)

**Files:**
- Create: `scripts/encounters.js`
- Modify: `lang/en.json`, `lang/es.json`
- Test: `test/encounters.test.mjs`

**Interfaces:**
- Consumes: `rollOrType` (Task 2), `encounterGroups` (Task 1), `MODULE_ID`, `safe`, `log` from `main.js`.
- Produces:
  - `markEncounter(tokenDocs, radius) -> Promise<void>`: if every token already has the flag → `unsetFlag` on each; else `setFlag(MODULE_ID, "encounter", { id: foundry.utils.randomID(), radius })` on each (one shared id per call).
  - `onSceneControls(controls)`: adds `controls.tokens.tools.bg3Encounter = { name: "bg3Encounter", title: "BG3FLOW.Encounter.Mark", icon: "fa-solid fa-skull-crossbones", order: 100, button: true, visible: game.user.isGM, onChange: () => askAndMark() }` where `askAndMark` reads `canvas.tokens.controlled.map(t => t.document)`, warns `Encounter.NoTokens` if empty, prompts the radius with `DialogV2.prompt` (number input, default `game.settings.get(MODULE_ID, "defaultEncounterRadius")`) and calls `markEncounter`.
  - `hideToken(tokenDoc) -> Promise<void>`: if flag `stealth` exists → `unsetFlag` + `toggleStatusEffect("hiding", { active: false })`; else `value = await rollOrType({ actor: tokenDoc.actor, skill: "ste" })`; if `value === null` return; `setFlag(MODULE_ID, "stealth", { value, hidden: true, checked: [] })` + `toggleStatusEffect("hiding", { active: true })`.
  - `revealToken(tokenDoc)`: `unsetFlag("stealth")` if present and `toggleStatusEffect("hiding", { active: false })`.
  - `onRenderTokenHUD(app, html)`: `html` is an HTMLElement (fallback `html[0]`); if `app.object.document.isOwner`, append to `.col.left` a `<button type="button" class="control-icon" data-tooltip="BG3FLOW.Hide.Button"><i class="fa-solid fa-eye-slash"></i></button>` whose click calls `hideToken(app.object.document)`.
  - `onPostUseActivityReveal(activity)`: if the activity has an attack or save (`activity.type` in `["attack", "save"]`) and its actor has a token with a stealth flag → `revealToken` on each `activity.actor.getActiveTokens(false, true)`.
  - `drawEncounters()`: GM only; one PIXI.Graphics on `canvas.interface` with a dashed-looking circle (plain stroke, alpha 0.6, colour 0xff5555; "dashed" is approximated by `lineStyle`/`stroke` with `alpha`, no dash plugin) of `radius` around each marked token on the current scene. Same destroy guard as `drawReach`.

- [ ] **Step 1: Write the failing tests** (`test/encounters.test.mjs`, stubs in the style of `test/turns.test.mjs`; a `tokenDoc(id, { flags, actor })` helper with `getFlag/setFlag/unsetFlag` recording into `calls.flags` and `actor.toggleStatusEffect` recording into `calls.status`)

```js
test("markEncounter sets one shared id and the radius on every token, toggles off when all are marked", async () => { ... assert both flags share `id`, radius 45; second call → unsetFlag twice });
test("onSceneControls adds a GM-only button tool under tokens", () => { const controls = { tokens: { tools: {} } }; game.user.isGM = true; onSceneControls(controls); assert.equal(controls.tokens.tools.bg3Encounter.button, true); assert.equal(controls.tokens.tools.bg3Encounter.visible, true); });
test("hideToken stores the Stealth value and turns the hiding status on; again clears it", async () => { prompts.rollOrType = async () => 13; ... assert flag {value:13, hidden:true, checked:[]} and status [["hiding", true]]; second call → unset + ["hiding", false] });
test("hideToken does nothing when the dialog is closed", async () => { rollOrType → null; no flags, no status });
test("an attack activity reveals the actor's hidden tokens", async () => { ... onPostUseActivityReveal({ type: "attack", actor }) → unsetFlag("stealth") + hiding off; { type: "utility" } → nothing });
test("renderTokenHUD adds the Hide button only for owned tokens", () => { use a minimal fake element with querySelector/append; isOwner false → no button });
```

For `rollOrType` injection: `encounters.js` imports `* as prompts from "./prompts.js"` and calls `prompts.rollOrType(...)`; the test replaces the property on the imported namespace through a setter exported for tests? No: simpler, `hideToken(tokenDoc, roll = prompts.rollOrType)` takes the function as an optional second parameter; tests pass a stub. Same pattern for anything else that needs a stub.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/encounters.test.mjs`
Expected: FAIL, cannot find module `../scripts/encounters.js`.

- [ ] **Step 3: Implement part A in `scripts/encounters.js`** plus lang keys: `Encounter.Mark` ("Mark as encounter" / "Marcar como encuentro"), `Encounter.Radius` ("Detection radius (ft)" / "Radio de detección (pies)"), `Encounter.NoTokens` ("Select the enemy tokens first" / "Selecciona antes las fichas enemigas"), `Hide.Button` ("Hide" / "Esconderse"), `Hide.Title` ("Stealth" / "Sigilo"), `Hide.Roll` ("Roll Stealth" / "Tirar Sigilo"), `Hide.Use` ("Use this value" / "Usar este valor"), `Hide.Value` ("Or type a value" / "O escribe un valor").

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/encounters.js lang test/encounters.test.mjs
git commit -m "feat: encounter marking and Hide"
```

---

### Task 4: Detection on movement (`encounters.js` part B)

**Files:**
- Modify: `scripts/encounters.js`
- Test: `test/encounters.test.mjs` (append)

**Interfaces:**
- Consumes: `isObscured`, `passiveSpots`, `activeSpots`, `encounterGroups`, `withinRadius` (Task 1); `promptSkill`, `activeOwner`, `awaitOrGm` (Task 2); `startEncounter(sceneId, groupId)` (Task 5; part B calls it through an injectable parameter so Task 4's tests stub it).
- Produces:
  - `distanceFt(a, b)`: `canvas.grid.measurePath([a, b]).distance`.
  - `hasLineOfSight(a, b)`: `!CONFIG.Canvas.polygonBackends.sight.testCollision(a, b, { type: "sight", mode: "any" })`.
  - `stealthFor(tokenDoc) -> Promise<number|null>`: existing flag value, else prompt the active owner (`promptSkill(user.id, { tokenUuid: tokenDoc.uuid, skill: "ste" })`) wrapped in `awaitOrGm(..., { title: L("Prompt.Waiting", { name, skill }), label: L("Prompt.RollForThem") }, () => rollOrType({ actor, skill: "ste" }) on the GM)`; no active owner → GM `rollOrType` directly. Stores `{ value, hidden: false, checked: [] }` when none existed. `null` (GM closed the dialog) → treated as not obscured for this move, nothing stored.
  - `onMoveToken(tokenDoc, movement, operation, user, deps = { start: startEncounter, roll: rollOrType })`: GM client only (`game.user.isGM`), returns early when `game.combat?.started`, when the token's actor is not a player character (`tokenDoc.actor?.hasPlayerOwner` false) or when `busy.has(tokenDoc.id)`. Otherwise, with `busy` held: `center = tokenDoc.getCenterPoint()`, `darkness = canvas.effects.getDarknessLevel(center)`, `hidden = !!flag?.hidden`, `obscured = isObscured(...)`. For each group from `encounterGroups(canvas.scene.tokens.contents)` whose live enemies (not `hidden`, actor hp > 0) include one within `radius` of `center`: if `obscured` and `groupId` not in `flag.checked`: `stealth = await stealthFor(tokenDoc)`, push groupId into `checked` (setFlag), spotted if any enemy in range `passiveSpots({ obscured, passive: enemy.actor.system.skills.prc.passive, stealth })`. Then for each enemy in range with `hasLineOfSight`: if `!obscured` spotted; else `perception = (await enemy.actor.rollSkill({ skill: "prc", rollMode: "publicroll" }))?.[0]?.total ?? 0`, spotted if `activeSpots({ obscured, los: true, perception, stealth })`. First spotted group → `await deps.start(canvas.scene.id, groupId)` and stop. Log one line per decision.
  - `busy: Set<string>` module-level.

- [ ] **Step 1: Write the failing tests** (stub `canvas` with `grid.measurePath` returning `{ distance }` from a lookup table, `effects.getDarknessLevel`, `scene.tokens.contents`, and `CONFIG.Canvas.polygonBackends.sight.testCollision`)

```js
test("an enemy in radius with line of sight spots an unobscured player and starts the encounter", async () => { ... assert started deep-equals [["scene", "g"]] });
test("hidden player: passive Perception below Stealth and failed Perception roll keep the encounter closed", async () => { stealth flag {value: 15, hidden: true, checked: []}; enemy passive 12, rollSkill → [{ total: 10 }]; started [] ; flag.checked now ["g"] });
test("hidden player: passive Perception meets Stealth → started", async () => { passive 15 → started });
test("passive check runs once per group: second move with checked ['g'] does not re-roll", async () => { ... rollSkill count for passive path 0, only active rolls });
test("dark square asks the active owner for Stealth and stores it with hidden:false", async () => { darkness 0.6, no flag; promptSkill stub → 11; assert setFlag {value:11, hidden:false, checked:["g"]} });
test("outside radius, no wall-free line of sight, or defeated enemy: nothing happens", async () => { three sub-cases → started [] });
test("busy token (prompt still open) is skipped", async () => { set busy, move → no prompt, no start });
test("non-GM client, combat running, or NPC mover: ignored", async () => { ... });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/encounters.test.mjs`
Expected: FAIL, `onMoveToken` is not exported.

- [ ] **Step 3: Implement part B** as specified. Lang keys: `Prompt.Waiting` ("Waiting for {skill} from {name}" / "Esperando {skill} de {name}"), `Prompt.RollForThem` ("Roll for them" / "Tirar por ellos"), `Encounter.Spotted` ("{enemy} spotted {name}!" / "¡{enemy} ha visto a {name}!") posted as a ChatMessage before starting combat.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/encounters.js lang test/encounters.test.mjs
git commit -m "feat: encounter detection on movement"
```

---

### Task 5: Starting combat, damage triggers, wiring, docs (`encounters.js` part C)

**Files:**
- Modify: `scripts/encounters.js`, `scripts/main.js`, `module.json` (0.4.0), `README.md`, `docs/SERVER-TESTING.md`, `lang/*.json`
- Test: `test/encounters.test.mjs` (append)

**Interfaces:**
- Consumes: `promptInitiative`, `activeOwner`, `awaitOrGm` (Task 2); `revealToken` (Task 3).
- Produces:
  - `startEncounter(sceneId, groupId) -> Promise<Combat|null>` (GM): returns `null` if not GM, if `starting` is set, or if `game.combats.find(c => c.scene?.id === sceneId)` exists. Sets `starting = true` in a try/finally. `scene = game.scenes.get(sceneId)`; enemies = tokens with `encounter.id === groupId`, not `hidden`, actor hp > 0; pcs = tokens whose `actor?.type === "character" && actor.hasPlayerOwner`. `combat = await Combat.create({ scene: sceneId, active: true })`; `createEmbeddedDocuments("Combatant", [...].map(t => ({ tokenId: t.id, sceneId, actorId: t.actorId })))`. For each PC combatant: `user = activeOwner(t)`; if user → `await awaitOrGm(promptInitiative(user.id, c.id), { title: L("Prompt.Waiting", { name, skill: L("Prompt.Initiative") }), label: L("Prompt.RollForThem") }, () => combat.rollInitiative([c.id]))`; else `combat.rollInitiative([c.id])`. Then `await combat.rollNPC()`, `revealToken` on every PC token with a stealth flag, `await combat.startCombat()`. Returns the combat.
  - `onApplyDamage(actor, amount)`: `amount > 0`, no started combat, actor's token on the canvas (`actor.token ?? actor.getActiveTokens(true, true)[0]`) has an encounter flag → `socket.executeAsGM("startEncounter", canvas.scene.id, flag.id)`.
  - `onRollComplete(workflow)`: no started combat; `tokens = [workflow.token?.document, ...[...workflow.hitTargets].map(t => t.document)]`; first with an encounter flag and `workflow.hitTargets.size > 0` → `socket.executeAsGM("startEncounter", ...)`.
  - `registerEncounters()`: `Hooks.on("getSceneControlButtons", safeSync(onSceneControls))`, `Hooks.on("renderTokenHUD", safeSync(onRenderTokenHUD))`, `Hooks.on("moveToken", safe(onMoveToken))`, `Hooks.on("dnd5e.postUseActivity", safe(onPostUseActivityReveal))`, `Hooks.on("dnd5e.applyDamage", safe(onApplyDamage))`, `Hooks.on("midi-qol.RollComplete", safe(onRollComplete))`, `Hooks.on("combatStart", safe(() => reveal all PC tokens on the scene))`, redraw `drawEncounters` on `canvasReady`, `updateToken`, `createToken`, `deleteToken`; `log("encounters on")`.
  - `main.js`: `if (game.settings.get(MODULE_ID, "enableEncounters")) registerEncounters();` and `api = { toggleDash, startEncounter, markEncounter }`.

- [ ] **Step 1: Write the failing tests** (stub `Combat.create` returning a fake with `createEmbeddedDocuments`, `rollInitiative`, `rollNPC`, `startCombat`, `combatants` collection; stub `game.combats`, `game.scenes`, `socket.executeAsGM` recorder)

```js
test("startEncounter builds a combat from the group and the player characters, rolls PCs on their clients, NPCs on the GM, reveals and starts", async () => { ... assert combatant data, promptInitiative called for p1's combatant, rollInitiative for the ownerless PC, rollNPC once, startCombat once, stealth flags unset });
test("startEncounter is a no-op when a combat exists on the scene or while one is starting", async () => { ... });
test("startEncounter skips hidden and defeated enemies", async () => { ... });
test("applyDamage on an encounter enemy outside combat asks the GM to start that group", async () => { assert gmCalls deep-equals [["startEncounter", "scene", "g"]] });
test("RollComplete by an encounter enemy with hits, or hitting one, starts; with no hits does nothing", async () => { ... });
test("registerEncounters hooks the seven events", () => { capture Hooks.on names; assert includes getSceneControlButtons, renderTokenHUD, moveToken, dnd5e.postUseActivity, dnd5e.applyDamage, midi-qol.RollComplete, combatStart });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/encounters.test.mjs`
Expected: FAIL, `startEncounter` is not exported.

- [ ] **Step 3: Implement part C**, wire `main.js`, bump `module.json` to `0.4.0`, lang key `Prompt.Initiative` ("initiative" / "iniciativa").

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Docs.** README: section "Encounters and stealth" (marking button, radius, Hide button and dnd5e hiding status, what triggers combat, prompts and the GM "Roll for them" fallback, simplifications: no darkvision, sight range ignored, no surprise round). SERVER-TESTING.md: section "7. Encounters (feature 3)" with setup (two goblins marked as one group radius 30 ft, a dark region or scene darkness 0.7 on one side, walls between a corridor and the goblin room, Player1 owns the Rogue) and steps E1–E10:
  - E1 mark two goblins → both get the flag with the same id, GM sees the circles, Player1 does not.
  - E2 Rogue walks to 40 ft from the goblins in light → nothing.
  - E3 Rogue walks to 25 ft with a wall between → nothing (no line of sight).
  - E4 Rogue steps into line of sight in light → chat "Goblin 1 spotted Rogue!", combat created with Cleric, Rogue, Goblin 1, Goblin 2 (not the Villager), Player1 sees their own initiative roll with 3D dice, "Shared turn" message follows.
  - E5 end combat; Rogue presses Hide, picks "Roll Stealth" → public Stealth card, hiding status icon on the token, flag with value.
  - E6 hidden Rogue walks within 25 ft with line of sight → each goblin rolls Perception publicly; if both roll under the Stealth value nothing happens, else combat starts. Report the numbers.
  - E7 Rogue (hidden, value forced to 25 by "Use this value") stays undetected through two moves; the GM sees no second passive prompt.
  - E8 Rogue attacks a goblin while hidden → hiding status cleared and combat starts on the hit (Midi RollComplete).
  - E9 With Player1 logged out, GM moves the Rogue into darkness → GM gets the "Waiting for Stealth" dialog? No: with no active owner the GM gets the roll-or-type dialog directly. Then log Player1 in, repeat in a fresh spot → Player1 gets the prompt, GM sees "Waiting for Stealth from Rogue" with "Roll for them"; press it → GM dialog, player prompt stays open but its answer is ignored.
  - E10 Turn off BG3 encounters, reload → no Mark button, no Hide button, free movement near goblins.
  Report template gains E1–E10.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: encounter start, damage triggers, docs and test script for feature 3"
```

---

## Self-review notes

- Spec coverage: Marking (T3), Hide (T3), Detection steps 1–3 (T1, T4), Damage trigger (T5), Starting combat (T5), Prompts (T2), Testing/docs (T5). Rulings above cover the gaps (sight range, marker, memory, who starts).
- Type consistency: `startEncounter(sceneId, groupId)` everywhere; `rollOrType({ actor, skill })`; stealth flag `{ value, hidden, checked }`; encounter flag `{ id, radius }`.
- Review Focus items each name their pinning task.
