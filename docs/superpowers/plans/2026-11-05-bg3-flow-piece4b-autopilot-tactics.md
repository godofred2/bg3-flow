# BG3 Flow piece 4b: autopilot tactics (areas, heals, bonus actions, recharge, positioning). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monsters on autopilot use area attacks where they cover the most enemies (and the fewest allies), heal wounded allies or themselves when that is worth more than attacking, spend their bonus action, get their recharge abilities back at the start of their turn, step out of melee before shooting when they are clever, and stop where a Sentinel hit catches them.

**Architecture:** Same three files as 4a. `plan.js` gains pure area coverage geometry, heal targeting over allies, a bonus-action pass and retreat squares for ranged attackers. `board.js` adds allies, token centres, grid units, area and heal data per activity, paths to wounded allies and the retreat squares. `run.js` passes every covered target to Midi without placing a template, runs a bonus phase after the action, rolls recharge at the start of the turn and stops a monster hit by a Sentinel reaction while it moves.

**Tech Stack:** As 4a plus dnd5e 6.0.6 `activity.target.template.{type,size,width}`, `target.affects.type`, heal activities (`activity.healing`, `getDamageConfig()` returns the healing roll), `activity.uses.recovery[].period === "recharge"` with `uses.spent`, `item.system.uses.rollRecharge()` / `activity.uses.rollRecharge()` (bound by dnd5e, no-op when nothing is spent), world setting `dnd5e.autoRecharge` ("no" by default), usage config `create.measuredTemplate` (dnd5e activity mixin line 451), `MidiQOL.completeActivityUse(activity, { create: { measuredTemplate: false }, midiOptions: { targetUuids, ignoreUserTargets: true } })`, Foundry `TokenDocument#stopMovement() -> boolean`, hook `midi-qol.RollComplete(workflow)` with `workflow.actor`, `workflow.hitTargets` (Set of Token).

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, sub-piece **4b** (areas, heals, bonus actions, recharge, smart positioning, waiting for Gambit's opportunity attack, Sentinel stop). Waiting for Gambit's opportunity attack is already covered by 4a's arrival wait (server test A7 passed): no task.

## Global Constraints

- As the 4a plan: Foundry 14, dnd5e 6.0.x, Midi >= 14.6, ES modules, CRLF, `safe` wrappers, lead GM only, Midi for every roll, pure decisions in `plan.js`, TDD with `node --test`, commits with the user's identity and the Claude trailer, strings under `BG3FLOW.Autopilot.*`.
- Distances in scene units (feet), grid squares via `canvas.dimensions.size` (px) and `canvas.dimensions.distance` (ft per square).

## Rulings (plan-level, spec silent or ambiguous)

- **Area coverage is pure geometry on token centres**, not Foundry templates: sphere/cylinder/circle/radius = Euclidean distance from the aim centre ≤ size (plus half the creature's extra width); cube/square = Chebyshev ≤ size / 2; cone = from the monster's centre toward the aim, distance ≤ size and angle ≤ 26.57° (half of dnd5e's 53.13°); line = projection within (0, size] and perpendicular distance ≤ width / 2 (width 5 when unset). Cost if wrong: an edge creature counted in or out of a blast that Midi would judge differently; the server run checks a Fireball on two goblins.
- **Areas are used without placing a template**: Midi gets `create.measuredTemplate: false` and the covered tokens as `targetUuids`. Ongoing self-emanations (Spirit Guardians: `affects.type === "self"` with a template) stay out: those are Midi regions, not single uses. Cost: an instantaneous area leaves no template on the map (nothing to clean up).
- **Friendly fire counts**: an area's value is the sum of expected damage over covered enemies minus the sum over covered allies (and the monster itself); an option with value ≤ 0 is dropped. Allies are the same-disposition combatants, the monster included.
- **Aim points** are the visible enemies' centres (one option per enemy per area activity). No midpoints between enemies. Cost: a blast that could catch three in a row at a midpoint catches two.
- **Heals** target allies (the monster included) with `hp < maxHp`, scored as `min(healing, missing hp)`; a heal with `affects.type === "self"` targets only the monster. Heals with touch range use the path squares to that ally like an attack uses the enemy's. Multi-target counts (`affects.count` 6 for Mass Healing Word) are ignored: one target.
- **Bonus action**: after the action phase of a monster, one more plan with `slot: "bonus"` from where it stands (budget 0): best bonus activity with value > 0, executed the same way. Bonus-action heals (Healing Word) thus compete only with other bonus actions, as the spec says.
- **Recharge**: when `game.settings.get("dnd5e", "autoRecharge") === "no"` (dnd5e's default) the autopilot rolls recharge for every spent item or activity with a `recharge` recovery period of its monsters at the start of their turn (`uses.rollRecharge()`; dnd5e posts the roll card). When the setting is on, dnd5e rolls at the same moment on the designated GM and the autopilot does not: the README tells the GM to leave the setting at "no" so the roll always happens before the plan. Cost if wrong (setting on): a race where the plan reads the uses before dnd5e's roll lands.
- **Retreat squares** for a clever ranged attacker: the free neighbours of the monster's square whose footprint is at least two squares (10 ft) from every visible enemy, cost = one step (grid distance), route = that one square. A ranged activity evaluated from a retreat square has no disadvantage; from the current square next to an enemy it has (4a rule). The planner picks whichever is worth more. Opportunity-attack estimates arrive in 4c.
- **Sentinel stop**: while the group moves, a `midi-qol.RollComplete` whose actor owns an item named "Sentinel" (case-insensitive) and whose `hitTargets` include a moving member calls that member's `token.stopMovement()`; the rest of its route is dropped. Detected on the GM client, which sees every Midi workflow complete.
- **Action-phase targets**: a use carries `targetIds` (one for single targets, many for areas); before the use, dead or vanished targets are dropped and a single-target use with nobody left is re-picked as in 4a.

## Review Focus

1. A Fireball whose best aim point also covers the caster or an ally: the value subtracts them, and when nobody but allies is in the blast the option is dropped. Pinned in Task 1.
2. A monster with full hit points and a self-only heal (Regeneration-like `affects.type: "self"`): the heal scores 0 and is never used. Pinned in Task 2.
3. A cone with range "self" and no enemy within its length: the monster walks until the aim enemy is within the cone length, then breathes. Pinned in Task 1 (range = size) and Task 3 (board puts `range = size` for self-area activities).
4. Recharge roll when dnd5e's setting is "silent" or "yes": the autopilot must not roll (no double chance). Pinned in Task 4.
5. A Sentinel hit on a monster that was not moving (it stood and shot): nothing happens, no error. Pinned in Task 4.

## File structure

- Modify `scripts/ai/plan.js`: `coverage`, area options, heal options, `planTurn(board, { slot })`, retreat evaluation.
- Modify `scripts/ai/board.js`: `activityInfo` fields `area`, `affects`, `recharge`; `snapshot` fields `allies`, `grid`, centres, paths to wounded allies, `retreats`.
- Modify `scripts/ai/run.js`: `useActivity(info, targetUuids)`, bonus phase, `rollRecharge(combatant)`, Sentinel hook, `brief`.
- Modify `lang/en.json`, `lang/es.json` (pause reason with several targets), `README.md`, `docs/SERVER-TESTING.md` (section 7, B-steps), `module.json` (0.7.0).
- Tests: the three existing test files.

---

### Task 1: Area coverage and area options

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes the 4a board plus (produced by Task 3, defined here): `board.grid = { px, ft }`; every creature (`me`, `enemies[]`, `allies[]`) carries `cx, cy` (centre in px) and `w` (width in squares); activities carry `area: { shape, size, width } | null` (`shape` one of `sphere`, `cylinder`, `circle`, `radius`, `cube`, `square`, `cone`, `line`; `size` and `width` in ft) and `affects` (`"self"`, `"ally"`, `"enemy"`, `"creature"`, `""`).
- Produces:
  - `coverage({ area, origin, aim, creatures, grid }) -> creature[]`: `origin` and `aim` are `{ cx, cy }`; the creatures whose centre lies in the shape (rules in the Rulings). For centred shapes the origin is ignored.
  - `pickTarget(board, activity, from)` unchanged for single targets; for an activity with `area`, the pick is `{ enemy (the aim), square, value, targets: creature[] }` where `value = Σ expectedValue over covered enemies − Σ over covered allies and me`, picks with `value <= 0` dropped, origin = the firing square's centre (or me) and `range` the same reach rule as attacks. Tie-breaks as 4a on the aim enemy.
  - `planTurn` options carry `actions: [{ activityId, targetIds: string[] }]` (one id for single targets). Single-target `targetId` is replaced by `targetIds` everywhere (4a tests updated).

- [ ] **Step 1: Write the failing tests**

```js
const { coverage } = await import("../scripts/ai/plan.js");
const grid = { px: 100, ft: 5 };
const c = (id, x, y, w = 1) => ({ id, cx: x, cy: y, w });
test("coverage: sphere by distance, cube by Chebyshev, cone by angle and length, line by width and length", () => {
  const all = [c("a", 450, 50), c("b", 650, 50), c("c", 450, 450), c("d", 1050, 50), c("e", 1050, 350)];
  const ids = (r) => r.map((x) => x.id);
  assert.deepEqual(ids(coverage({ area: { shape: "sphere", size: 20 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b", "c"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cube", size: 10 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a"]);
  assert.deepEqual(ids(coverage({ area: { shape: "cone", size: 30 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b"]);
  assert.deepEqual(ids(coverage({ area: { shape: "line", size: 60, width: 5 }, origin: c("m", 50, 50), aim: { cx: 450, cy: 50 }, creatures: all, grid })), ["a", "b", "d"]);
});
test("an area aims at the enemy that covers the most, friendly fire subtracts, allies-only blasts are dropped", () => {
  const fireball = { id: "fb", uuid: "A.fb", name: "Fireball", kind: "save", slot: "action", range: 150, dc: 13, saveAbility: "dex", onSave: "half", damage: 28, area: { shape: "sphere", size: 20 }, affects: "creature" };
  const e = (id, x, y, hp = 10) => ({ ...pc(id, 30, { hp }), cx: x, cy: y, w: 1 });
  const b = { ...board({ enemies: [e("r1", 450, 50), e("r2", 650, 50), e("r3", 1450, 50)], activities: [fireball] }), allies: [], grid, me: { ...board({ enemies: [], activities: [] }).me, cx: 50, cy: 50, w: 1 } };
  const p = planTurn(b);
  assert.deepEqual(p.actions, [{ activityId: "fb", targetIds: ["r1", "r2"] }]);
  assert.equal(p.move, null);
  const g = (id, x) => ({ id, name: id, cx: x, cy: 50, w: 1, ac: 15, saves: { dex: 1 }, hp: 7, maxHp: 7 });
  b.allies = [g("g2", 550)]; // a goblin between r1 and r2
  assert.ok(pickTarget(b, fireball).value < pickTarget({ ...b, allies: [] }, fireball).value); // worth less with the ally inside
  b.enemies = [b.enemies[0]]; b.allies = [g("g2", 550), g("g3", 350)]; // one enemy, two allies in every blast that reaches it
  assert.equal(pickTarget(b, fireball), null);
});
```
Replace `targetId: "x"` by `targetIds: ["x"]` in every 4a assertion of `test/plan.test.mjs` and `test/run.test.mjs` (`attackPlan` fixture included).

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/c/Foundry vtt module" && timeout 120 node --test test/plan.test.mjs > "$SCRATCH/t.txt" 2>&1; grep "^ℹ pass\|^ℹ fail" "$SCRATCH/t.txt"`
Expected: FAIL, `coverage` is not a function and the `targetIds` assertions.

- [ ] **Step 3: Implement `coverage`, area picks and `targetIds` in `scripts/ai/plan.js`**

`planTurn`'s single-target and Multiattack options emit `targetIds: [enemy.id]`; the "also" list and reason are unchanged (the aim enemy's name for areas).

- [ ] **Step 4: Run the whole suite**

Expected: all pass (run tests updated for `targetIds`).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs test/run.test.mjs
git commit -m "feat(autopilot): area coverage and area options with friendly fire"
```

---

### Task 2: Heals, bonus actions, retreat squares

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Task 3 produces): `board.allies[]` with `{ id, uuid, name, cx, cy, w, hp, maxHp, ac, saves, distance, elevation }` (the monster included, `id === me.id`); `board.paths[allyId]` for wounded allies (same square shape as enemy paths); `board.retreats: [{ x, y, elevation, cost, waypoints, distances: { [enemyId]: ft } }]`.
- Produces:
  - `pickTarget` for `kind === "heal"`: candidates are allies with `hp < maxHp` (only `me` when `affects === "self"`), value `min(healing, maxHp - hp)`, in range or from a path square as for attacks; ties: the most wounded (lowest `hp / maxHp`), then nearest.
  - `planTurn(board, { slot = "action" } = {})`: options from activities of that slot only; Multiattack and approach only for `"action"`; for `"bonus"` with nothing worth it: `{ move: null, actions: [], reason: "no bonus action" }`.
  - Retreats: when `board.me.intelligence >= board.threshold`, a ranged attack whose best pick from the current square is at disadvantage (an enemy within 5 ft of me) is also evaluated from each retreat square: distance to the target from `retreats[k].distances[enemyId]`, no disadvantage when every enemy is ≥ 10 ft; the better value wins and its `square` is the retreat square (`cost <= budget`).

- [ ] **Step 1: Write the failing tests**

```js
test("heals: the most wounded ally in range, self-only heals only the monster, full hp scores nothing", () => {
  const cure = { id: "cw", uuid: "A.cw", name: "Cure Wounds", kind: "heal", slot: "action", range: 5, healing: 9, affects: "creature" };
  const ally = (id, hp, distance = 5) => ({ id, uuid: `T.${id}`, name: id, cx: 0, cy: 0, w: 1, hp, maxHp: 20, ac: 15, saves: {}, distance, elevation: 0 });
  const b = { ...board({ enemies: [pc("rogue", 5, { ac: 30 })], activities: [scimitar, cure] }), allies: [ally("g2", 4), ally("g3", 15), ally("m", 7)], grid: { px: 100, ft: 5 } };
  b.me = { ...b.me, hp: 7, maxHp: 7, cx: 0, cy: 0, w: 1 };
  const p = planTurn(b);
  assert.deepEqual(p.actions, [{ activityId: "cw", targetIds: ["g2"] }]); // 9 healed beats 0.25 * 5 on AC 30
  assert.equal(pickTarget(b, { ...cure, affects: "self" }), null); // the monster is at full hp
  b.me.hp = 1; b.allies.find((a) => a.id === "m").hp = 1;
  assert.equal(pickTarget(b, { ...cure, affects: "self" }).enemy.id, "m");
});
test("planTurn with slot bonus picks the best bonus activity from where it stands, or nothing", () => {
  const word = { id: "hw", uuid: "A.hw", name: "Healing Word", kind: "heal", slot: "bonus", range: 60, healing: 4.5, affects: "creature" };
  const b = { ...board({ budget: 0, enemies: [pc("rogue", 5)], activities: [scimitar, word] }), allies: [{ id: "g2", uuid: "T.g2", name: "g2", cx: 0, cy: 0, w: 1, hp: 2, maxHp: 7, ac: 15, saves: {}, distance: 30, elevation: 0 }], grid: { px: 100, ft: 5 } };
  assert.deepEqual(planTurn(b, { slot: "bonus" }).actions, [{ activityId: "hw", targetIds: ["g2"] }]);
  assert.deepEqual(planTurn(b).actions, [{ activityId: "sc", targetIds: ["rogue"] }]);
  b.allies[0].hp = 7;
  assert.deepEqual(planTurn(b, { slot: "bonus" }), { move: null, actions: [], reason: "no bonus action" });
});
test("a clever archer next to an enemy steps back to a free square 10 ft away before shooting; a dumb one shoots at disadvantage", () => {
  const retreat = { x: 0, y: 100, elevation: 0, cost: 5, waypoints: [{ x: 0, y: 100, elevation: 0 }], distances: { rogue: 10 } };
  const smart = { ...board({ intelligence: 10, enemies: [pc("rogue", 5)], activities: [bow] }), retreats: [retreat] };
  const p = planTurn(smart);
  assert.deepEqual([at(p.move), p.actions, p.reason], [{ x: 0, y: 100, elevation: 0 }, [{ activityId: "bw", targetIds: ["rogue"] }], "Shortbow vs rogue (expected 2.5)"]);
  const dumb = planTurn({ ...smart, me: { ...smart.me, intelligence: 3 } });
  assert.deepEqual([dumb.move, dumb.reason], [null, "Shortbow vs rogue (expected 1.3)"]);
  assert.equal(planTurn({ ...smart, retreats: [] }).move, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL on heals (no `allies` handling), the `slot` option and the retreat test.

- [ ] **Step 3: Implement in `scripts/ai/plan.js`**

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): heals, bonus actions, retreat squares for clever archers"
```

---

### Task 3: Board fields for 4b

**Files:**
- Modify: `scripts/ai/board.js`
- Test: `test/board.test.mjs`

**Interfaces:**
- Produces, in `activityInfo`: `kind` now includes `"heal"`; `area` from `target.template` (`{ shape: template.type, size: Number(template.size) || 0, width: Number(template.width) || 5 }`, null when no type); `affects: target.affects.type ?? ""`; `recharge: boolean` (item or activity has a recovery with `period === "recharge"`); `range` for an activity with `area` and `range.units === "self"` = `area.size`; `healing` for heals from `getDamageConfig()` as 4a's damage. Filters: `affects === "self"` is allowed only for heals; `affects === "self"` with an area stays out; everything else as 4a.
- Produces, in `snapshot`: `grid: { px: canvas.dimensions.size, ft: canvas.dimensions.distance }`; `cx, cy` (token centre) and `w` on `me`, every enemy and every ally; `allies`: same-disposition live combatants on the scene (the monster first, `id === me.id`), with `distance` by footprint reach; `paths[allyId]` for allies with `hp < maxHp` (other than me) via `pathTo`; `retreats`: for each of the 8 neighbours of the monster's top-left offset: inside the scene, footprint free of every other token, every visible enemy's footprint at Chebyshev ≥ 2 from the footprint; `cost = measurePath([centre, newCentre]).distance`, `distances[enemyId] = reachFt(newFootprint, enemyFoot)`.

- [ ] **Step 1: Write the failing tests**

```js
test("activityInfo: Fireball sphere, breath cone from self, Cure Wounds heal, Healing Word bonus, recharge flag, self emanation out", () => {
  const fb = activityInfo(act({ name: "Fireball", type: "save", save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["8d6", {}]], range: { value: 150, units: "ft" }, template: "sphere", size: 20 }));
  assert.deepEqual([fb.area, fb.range, fb.affects], [{ shape: "sphere", size: 20, width: 5 }, 150, "creature"]);
  const breath = activityInfo(act({ name: "Fire Breath", type: "save", save: { dc: 13, ability: "dex", onSave: "half" }, parts: [["7d6", {}]], range: { value: null, units: "self" }, template: "cone", size: 30, affects: "", recharge: true, uses: { max: 1, value: 1 } }));
  assert.deepEqual([breath.area.shape, breath.range, breath.recharge], ["cone", 30, true]);
  assert.equal(activityInfo(act({ name: "Fire Breath", type: "save", template: "cone", size: 30, recharge: true, uses: { max: 1, value: 0 } })), null); // spent: rolled back at the turn start
  const cure = activityInfo(act({ name: "Cure Wounds", type: "heal", parts: [["1d8 + 3", {}]], range: { value: null, units: "touch" } }));
  assert.deepEqual([cure.kind, cure.healing, cure.range, cure.affects], ["heal", 7.5, 5, "creature"]);
  assert.equal(activityInfo(act({ name: "Healing Word", type: "heal", activation: "bonus", parts: [["1d4 + 3", {}]], range: { value: 60, units: "ft" } })).slot, "bonus");
  assert.equal(activityInfo(act({ name: "Second Wind", type: "heal", activation: "bonus", parts: [["1d10", {}]], affects: "self" })).affects, "self");
  assert.equal(activityInfo(act({ name: "Spirit Guardians", type: "save", template: "radius", size: 15, affects: "self" })), null);
});
test("snapshot: grid, centres, allies with paths to the wounded ones, retreat squares away from enemies", async () => {
  // Row 1 (the stub's wall sits below y 300): goblin at (300,100) speed 30; goblin2 (ally, hp 3/7) at (600,100); rogue at (400,100) adjacent on the right; wizard at (0,100) far left.
  const goblin = token("goblin", { x: 300, y: 100, disposition: -1 }), goblin2 = token("goblin2", { x: 600, y: 100, disposition: -1, hp: 3, maxHp: 7 });
  const rogue = token("rogue", { x: 400, y: 100, disposition: 1 }), wizard = token("wizard", { x: 0, y: 100, disposition: 1 });
  canvas.scene.tokens.contents = [goblin, goblin2, rogue, wizard];
  const b = await snapshot({ combatants: [goblin, goblin2, rogue, wizard].map((t) => combatantOf(t)) }, combatantOf(goblin));
  assert.deepEqual(b.grid, { px: 100, ft: 5 });
  assert.deepEqual([b.me.cx, b.me.cy, b.me.w], [350, 150, 1]);
  assert.deepEqual(b.allies.map((a) => [a.id, a.hp, a.maxHp, a.distance]), [["goblin", 7, 7, 0], ["goblin2", 3, 7, 15]]);
  assert.deepEqual(b.paths.goblin2.map((s) => [s.x, s.occupied]), [[400, true], [500, false]]); // through the rogue's square (occupied), one free square short of the ally
  // retreats: neighbours of (1,3) that keep 10 ft from the rogue at (1,4) and 10 ft from the wizard: column 2 only
  assert.deepEqual(b.retreats.map((r) => [r.x, r.y, r.cost, r.distances.rogue]).sort(), [[200, 0, 5, 10], [200, 100, 5, 10], [200, 200, 5, 10]]);
});
```
Extend `act()` with `size`, `recharge` (adds `uses.recovery: [{ period: "recharge" }]`) and `template`; extend `token()` with `hp` for allies (already there).

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement in `scripts/ai/board.js`** (update `brief`-relevant fields; `brief` itself lives in run.js and is extended in Task 4)

- [ ] **Step 4: Run the whole suite**

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js test/board.test.mjs
git commit -m "feat(autopilot): board knows areas, heals, allies, recharge and retreat squares"
```

---

### Task 4: Execution: targets, bonus phase, recharge, Sentinel stop

**Files:**
- Modify: `scripts/ai/run.js`, `lang/en.json`, `lang/es.json`
- Test: `test/run.test.mjs`

**Interfaces:**
- Produces:
  - `useActivity(info, targetUuids: string[])`: `MidiQOL.completeActivityUse(activity, { create: { measuredTemplate: false }, midiOptions: { targetUuids, ignoreUserTargets: true } })`.
  - `rollRecharge(combatant) -> Promise<void>`: when `game.settings.get("dnd5e", "autoRecharge") === "no"`, for every item of the actor with `system.uses.recovery` containing `period === "recharge"` and `system.uses.spent > 0` call `item.system.uses.rollRecharge()`, and for every activity with its own recharge recovery and `uses.spent > 0` call `activity.uses.rollRecharge()`; otherwise do nothing. Called for every member before the first snapshot.
  - `sentinelWatch(members) -> () => void`: registers `Hooks.on("midi-qol.RollComplete", fn)` and returns the unregister function; `fn` stops `member.token.stopMovement()` for every member whose token is in `workflow.hitTargets` (match by `token.id` or `token.document?.id`) when `workflow.actor?.items` has an item named "sentinel" (case-insensitive). Registered right before the moves, unregistered after arrival.
  - Action phase: targets come from `a.targetIds` mapped to `board.enemies` / `board.allies` by id; dead or invisible enemies dropped; empty list on a single-target use → re-pick as 4a (enemy for attacks, ally for heals); the pause reason lists the target names joined by ", ". After the actions, `plan(board0, { slot: "bonus" })` on a fresh snapshot with budget 0 and its actions run the same way.
- Lang: `Autopilot.Decision` reused for the bonus whisper (the reason starts with the activity name, as before).

- [ ] **Step 1: Write the failing tests**

```js
test("an area use sends every covered target to Midi with no template", async () => { /* deps.use records (info, uuids); plan actions [{ activityId: "fb", targetIds: ["rogue", "wiz"] }] → uses[0][1] deepEqual ["T.rogue", "T.wiz"] */ });
test("useActivity passes create.measuredTemplate false and the uuids", async () => { /* globalThis.MidiQOL = { completeActivityUse: (a, cfg) => calls.midi.push(cfg) }; globalThis.fromUuidSync = () => ({}); assert cfg.create.measuredTemplate === false and cfg.midiOptions.targetUuids */ });
test("the bonus phase runs after the action from a fresh snapshot", async () => { /* deps.plan returns attackPlan for slot action and a Healing Word plan for slot bonus; order ends [..., "use T.rogue", "use T.g2"]; whisper count 2 for that monster */ });
test("rollRecharge rolls spent recharge items and activities only when dnd5e's autoRecharge is no", async () => { /* settings["dnd5e.autoRecharge"] = "no" → rolled ["Breath"]; "silent" → [] */ });
test("a Sentinel hit on a moving member stops its movement; a hit by someone without Sentinel or on a standing member does nothing", async () => { /* capture the hook fn from Hooks.on, call it with workflows; assert token.stopped counts */ });
```
Write every body in full.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement in `scripts/ai/run.js`; extend `brief` with allies (`name[hp/max]`) and area shapes (`Fireball[save r150 sphere20 ...]`)**

- [ ] **Step 4: Run the whole suite**

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/run.js test/run.test.mjs lang/en.json lang/es.json
git commit -m "feat(autopilot): area targets, bonus phase, recharge rolls, Sentinel stop"
```

---

### Task 5: Docs and release 0.7.0

**Files:**
- Modify: `README.md`, `docs/SERVER-TESTING.md`, `module.json`

- [ ] **Step 1: README** "Monster autopilot" section: areas (aim, friendly fire, no template), heals (allies and self, Healing Word as bonus), bonus actions, recharge (leave dnd5e's *NPC auto recharge* at "no"), clever archers step back, Sentinel stop; "not counted yet" list shrinks to: fleeing, resistances and vulnerabilities, advantage or disadvantage beyond the adjacent-shot rule, legendary and lair actions, ammunition, thrown weapons at range, difficult terrain cost, gridless scenes, multi-target counts.
- [ ] **Step 2: SERVER-TESTING section 7** B-steps on the goblin scene plus a Plutonium-imported **Priest** (Cure Wounds, Spirit Guardians, Mace), a **Red Dragon Wyrmling** (Fire Breath cone 15 ft recharge 5-6, Bite), and the Rogue plus the Fighter (with a Sentinel item on the Fighter):
  - B1. Wyrmling 20 ft from the Rogue and Fighter standing side by side: it moves until both are within 15 ft in front of it and breathes (Midi save cards for both, no template on the map); whisper names Fire Breath with two targets; console line shows `cone15`.
  - B2. Same, Fire Breath spent (uses 0), dnd5e's auto recharge "no": at its turn start a recharge card is posted; on 5-6 it breathes, else it bites.
  - B3. Priest with a goblin ally at 3 hp next to it and the Rogue 30 ft away: it casts Cure Wounds on the goblin (whisper names Cure Wounds vs Goblin), then nothing else; next turn with the goblin healed: it attacks.
  - B4. Priest at 2 hp, nobody else wounded: Cure Wounds on itself.
  - B5. Goblin with the Shortbow adjacent to the Rogue, Intelligence raised to 10: it steps one square back (not adjacent) and shoots; Intelligence 5: it swings the scimitar.
  - B6. Goblin adjacent to the Fighter (Sentinel item on the Fighter's sheet, Gambit on): the goblin tries to walk away, Gambit prompts, the Fighter hits: the goblin stays where it was stopped and acts from there (scimitar on the Fighter if adjacent, else nothing).
  - B7. Priest with Healing Word (bonus) and Mace: adjacent to the Rogue with the goblin ally at 3 hp: Mace attack first, then Healing Word on the goblin as the bonus action.
- [ ] **Step 3: `module.json` version `0.7.0`, run the suite and `bash tools/release.sh`**
- [ ] **Step 4: Commit, tag, push**

```bash
git add -A && git commit -m "feat: autopilot tactics (piece 4b), v0.7.0" && git tag v0.7.0 && git push -q origin main v0.7.0
```
Then the user creates the release and, after verification, the web session runs section 7 B1-B7.
