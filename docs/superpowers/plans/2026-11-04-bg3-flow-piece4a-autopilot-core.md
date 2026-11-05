# BG3 Flow piece 4a: monster autopilot core. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the GM client, every combatant with no player owner plays its turn alone: it walks toward the enemy it can see that gives the best expected damage, stops as soon as its best single-target attack or save activity is in range, uses it through Midi (several uses for a Multiattack), the GM gets a whispered line with the decision, and the turn passes when the whole active group was automatic.

**Architecture:** `scripts/ai/plan.js` is pure (expected value, Multiattack parsing, the turn plan from a board snapshot). `scripts/ai/board.js` reads Foundry into that snapshot (combatants, activities as Plutonium imports them, Foundry paths cut at the movement budget, sight through piece 3's `spotsBg3`). `scripts/ai/run.js` executes: group moves together, actions one by one through `MidiQOL.completeActivityUse`, optional pause dialog, tracker switch, auto next turn. Settings and wiring in `main.js`.

**Tech Stack:** Foundry v14 (`TokenDocument#move(waypoints, options) -> Promise<boolean>`, `Token#findMovementPath(waypoints, options) -> {promise}`, `canvas.grid.getDirectPath`, `canvas.grid.measurePath`, `renderCombatTracker` with an HTMLElement, DialogV2), dnd5e 6.0.6 activities (`activity.activation.type`, `activity.labels.toHit`, `activity.save.dc.value`, `activity.save.ability` Set, `activity.damage.onSave`, `activity.getDamageConfig().rolls[].parts/data`, `activity.healing`, `activity.range`, `item.system.range.reach/value`, `activity.uses.value`, `item.system.uses.value`, `activity.requiresSpellSlot`, `item.system.level`, `actor.system.spells.spellN.value`), Midi QOL 14.6 (`MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids, ignoreUserTargets: true } }) -> Promise<Workflow>`), `node --test` with stubbed globals.

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, sub-piece **4a** only (areas, heals, bonus actions, recharge, smart positioning, flee: later plans).

## Global Constraints

- Foundry 14, dnd5e 6.0.x, Midi QOL >= 14.6, lib-wrapper, socketlib. Plain ES modules, CRLF line endings, no build step.
- Every hook body wrapped in `safe` / `safeSync` from `scripts/main.js`; log prefix `[bg3-flow]`.
- Only the lead GM acts: `game.users.activeGM?.isSelf`.
- Rolls, damage and consumption go through Midi and dnd5e (`MidiQOL.completeActivityUse`), never a hand-built roll.
- Pure decisions in `scripts/ai/plan.js` (no Foundry globals) with Node tests; Foundry-facing code in `board.js` / `run.js` with stubbed-global tests. TDD per step. Commits with `-c user.name="Emilio Nava" -c user.email="emilionava1999@gmail.com"`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Strings in `lang/en.json` and `lang/es.json` under `BG3FLOW.Autopilot.*` and `BG3FLOW.Settings.*`.
- Distances in scene grid units, assumed feet (same simplification as piece 3).

## Rulings (plan-level, spec silent or ambiguous)

- **Plan shape**: `{ move, actions, reason }` where `actions` is a list of uses (one for a plain attack, several for a Multiattack). The spec's `action` / `bonus` keys become entries of this list; `bonus` arrives in 4b. Cost if wrong: a rename.
- **Movement history**: piece 2 clears the group's movement history in its own `combatTurnChange` handler without awaiting; the autopilot clears its monsters' history itself before planning (idempotent). Cost if wrong: a monster plans with last turn's budget.
- **Approach**: when nothing is in range this turn, the monster walks the full budget along the path to the nearest visible enemy, no Dash (Dash comes with flee in 4c). Cost if wrong: slow approach on big maps.
- **Paths**: Foundry's `findMovementPath` from the monster's position to the enemy's centre, expanded into grid squares with `canvas.grid.getDirectPath`; cumulative cost from `canvas.grid.measurePath` over the square centres. Squares occupied by any other token are never a destination. Elevation is carried through, never reasoned about.
- **Availability**: an activity is skipped when `activity.canUse` is false, when the item or the activity has a uses maximum and `value` is 0, or when it requires a spell slot and the actor has none of that level (`actor.system.spells[`spell${item.system.level}`].value`, pact slots ignored). Ammunition is not checked: a use dnd5e refuses is an error, which leaves the monster to the GM.
- **Targets**: `activity.target.affects.type === "self"` and area templates (`target.template.type` set) are skipped in 4a; "creature", "enemy", "" and the rest count as single target.
- **Expected damage** uses `activity.getDamageConfig()` rolls: parts joined with ` + `, roll data replaced with `Roll.replaceFormulaData`, then the pure average (dice at (faces + 1) / 2, flat added). Resistances ignored (spec).
- **Pacing**: `completeActivityUse` resolves when Midi finishes the workflow, which already waits for Dice So Nice when Midi's own setting says so. No extra wait in 4a; the server run decides whether `game.dice3d.waitFor3DAnimationByMessageID` is needed.
- **Closing the pause dialog** counts as Skip.
- **Turn change by the GM mid-run**: compared on `combat.id`, `round` and `turn` before every step; the run stops silently and does not pass the turn.
- **Tracker switch**: a `fa-robot` button appended to each NPC row's `.combatant-controls` on `renderCombatTracker`; toggles the combatant flag `bg3-flow.autopilot` (`false` = off; absent = on). Row selector `li.combatant[data-combatant-id]`. Cost if wrong (v14 markup differs): the button lands on the row itself via the fallback `li` append, still clickable.

## Review Focus

1. A monster whose every attack is out of reach and whose budget is 0 (speed 0, grappled): no move, no action, reason says so, turn still passes. Pinned in Task 3 (`planTurn` "nothing reachable" test) and Task 5 (turn passes with an empty plan).
2. An enemy at 0 HP or with a hidden token must not be a target or a path destination. Pinned in Task 4 (`snapshot` filters) and Task 3 (`pickTarget` ignores `hp <= 0`).
3. The target dies halfway through a Multiattack: the next use goes to another visible enemy or is dropped. Pinned in Task 5 (`runTurn` re-picks before each use).
4. `completeActivityUse` throws or returns `undefined` (Midi refused the use): the monster is left to the GM with a whispered error, the rest of the group continues, the turn does not pass. Pinned in Task 5.
5. Two monsters whose best square is the same: the second one takes the next square of its path. Pinned in Task 3 (reserved destinations).

## File structure

- Create `scripts/ai/plan.js`: `averageOf`, `hitChance`, `failChance`, `expectedValue`, `parseMultiattack`, `pickTarget`, `planTurn`.
- Create `scripts/ai/board.js`: `snapshot(combat, combatant, reserved)`, `activityInfo(activity)` (exported for tests).
- Create `scripts/ai/run.js`: `isAuto`, `runTurn`, `onCombatTurnChange`, `onRenderCombatTracker`, `pauseDialog`, `registerAutopilot`.
- Modify `scripts/main.js`: four settings, `registerAutopilot()` under `enableAutopilot`, `runTurn` in `api`.
- Modify `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7), `module.json` (0.6.0).
- Tests: `test/plan.test.mjs`, `test/board.test.mjs`, `test/run.test.mjs`.

---

### Task 1: Expected value maths

**Files:**
- Create: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs`

**Interfaces:**
- Produces:
  - `averageOf(formula: string) -> number`: `"2d6 + 3"` is 10, `"1d8"` is 4.5, `"3"` is 3, `""` or garbage is 0. Accepts `NdM`, `+`, `-`, integers, spaces; ignores anything else (`"1d8 + @mod"` with a leftover ref counts the ref as 0).
  - `hitChance({ bonus, ac }) -> number`: `(21 + bonus - ac) / 20` clamped to `[0.05, 0.95]`.
  - `failChance({ dc, bonus }) -> number`: `(dc - 1 - bonus) / 20` clamped to `[0.05, 0.95]`.
  - `expectedValue(activity, target) -> number` where `activity = { kind: "attack"|"save"|"damage"|"heal", bonus?, dc?, saveAbility?, onSave?: "half"|"none"|"full", damage: number, healing: number }` and `target = { ac, saves: { str, dex, con, int, wis, cha }, hp, maxHp }`. Attack: `hitChance * damage`. Save: `fail * damage + (onSave === "half" ? (1 - fail) * damage / 2 : onSave === "full" ? (1 - fail) * damage : 0)`. Damage (no roll): `damage`. Heal: `min(healing, maxHp - hp)`.

- [ ] **Step 1: Write the failing tests**

```js
// test/plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
const { averageOf, hitChance, failChance, expectedValue } = await import("../scripts/ai/plan.js");

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/c/Foundry vtt module" && timeout 120 node --test test/plan.test.mjs > "$SCRATCH/t.txt" 2>&1; tail -5 "$SCRATCH/t.txt"`
Expected: FAIL, cannot find module `scripts/ai/plan.js`.

- [ ] **Step 3: Implement the four functions in `scripts/ai/plan.js`**

File header comment: "Piece 4: monster autopilot planner. Pure functions, no Foundry globals." `averageOf` tokenises with one regex over `[+-]?\s*(\d+)d(\d+)|[+-]?\s*\d+`.

- [ ] **Step 4: Run to verify it passes**

Same command. Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): expected value maths"
```

---

### Task 2: Multiattack from the trait text

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Produces: `parseMultiattack(text: string, names: string[]) -> { count: number, names: string[] }`. `text` is the trait description with HTML stripped by the caller; `names` are the monster's attack activity names (lower-cased by the function). Count: first `makes (one|two|three|four|five|\d+) ... attacks?` (word or digit), 1 when absent. Names: every `(one|two|three|four|N) with its <name>` whose `<name>` matches a known name (case-insensitive, the known name contained in the phrase or the phrase's last word contained in the known name), repeated by its own count, in text order. Names that match nothing are dropped. Result `names` is empty when nothing matched.

- [ ] **Step 1: Write the failing tests**

```js
const { parseMultiattack } = await import("../scripts/ai/plan.js");
test("parseMultiattack reads SRD texts", () => {
  const gnoll = "The gnoll makes two attacks: one with its bite and one with its spear.";
  assert.deepEqual(parseMultiattack(gnoll, ["Bite", "Spear", "Longbow"]), { count: 2, names: ["bite", "spear"] });
  const dragon = "The dragon makes three attacks: one with its bite and two with its claws.";
  assert.deepEqual(parseMultiattack(dragon, ["Bite", "Claw", "Tail"]), { count: 3, names: ["bite", "claw", "claw"] });
  assert.deepEqual(parseMultiattack("The veteran makes two longsword attacks.", ["Longsword", "Shortsword"]), { count: 2, names: [] });
  assert.deepEqual(parseMultiattack("The orc makes 2 attacks with its greataxe.", ["Greataxe"]), { count: 2, names: [] });
  assert.deepEqual(parseMultiattack("Nothing useful here.", ["Bite"]), { count: 1, names: [] });
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `parseMultiattack` is not a function.

- [ ] **Step 3: Implement `parseMultiattack` in `scripts/ai/plan.js`**

Word-to-number map `{ one: 1, two: 2, three: 3, four: 4, five: 5 }`; two regexes as described.

- [ ] **Step 4: Run to verify it passes**

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): Multiattack parsed from the trait text"
```

---

### Task 3: The turn plan

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `expectedValue`, Task 2 `parseMultiattack`.
- Consumes (produced by Task 4, defined here): the **board**:
  ```js
  {
    me: { id, name, intelligence, hp, maxHp, x, y, elevation, budget },   // budget: ft left this turn
    enemies: [{ id, uuid, name, x, y, elevation, hp, maxHp, ac, saves, distance, visible }],  // distance: ft from me
    activities: [{ id, uuid, name, kind, slot, range, bonus, dc, saveAbility, onSave, damage, healing }],  // slot "action"|"bonus"; range in ft
    multiattack: string | null,   // trait text, HTML stripped
    paths: { [enemyId]: [{ x, y, elevation, cost, distance, occupied }] },  // squares after the start, cost: cumulative ft, distance: ft to that enemy from the square
    reserved: Set<string>,   // "x,y" of destinations group mates already took
    threshold: number        // intelligenceThreshold setting
  }
  ```
- Produces:
  - `pickTarget(board, activity, from = null) -> { enemy, square, value } | null`: best visible enemy with `hp > 0` for one activity. Without `from`: in range from where the monster stands (`enemy.distance <= range`) or from the first square of that enemy's path with `distance <= range`, `cost <= budget`, not `occupied`, not reserved; `square` is `null` when no move is needed. With `from` (a square object, used after the group moved): only enemies within range of `from`, no move. Ties on `value` (within 1e-9): Intelligence `>= threshold` picks the lowest `hp`, otherwise the smallest `distance`; then smallest `distance` again.
  - `planTurn(board) -> { move: { x, y, elevation } | null, actions: [{ activityId, targetId }], reason: string }`. Options: every `slot === "action"` activity through `pickTarget`; plus, when `multiattack` is set and `parseMultiattack` yields `names` that all exist among the activities, one option whose value is the sum of each named attack's `expectedValue` against the best target reachable from the same square (the square of the first named attack's pick), and whose `actions` lists them in order; when `names` is empty and `count > 1`, the best attack repeated `count` times. Highest value wins; the plan's `move` is the winning square (or null). Nothing scores: `move` is the last path square of the nearest visible enemy with `cost <= budget` that is neither occupied nor reserved (null when there is none or nobody is visible), `actions` empty. `reason` is a plain-text line: `"<activity> vs <enemy> (expected <value to 1 decimal>)"`, `"approach <enemy>"`, or `"no visible enemy"`; alternatives appended after `"; also: "` as `"<activity> <value>"` for the other scored options, best first, at most three.

- [ ] **Step 1: Write the failing tests**

```js
const { pickTarget, planTurn } = await import("../scripts/ai/plan.js");
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
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `pickTarget` is not a function.

- [ ] **Step 3: Implement `pickTarget` and `planTurn` in `scripts/ai/plan.js`**

Value formatting with `toFixed(1)`. The Multiattack option's square: `pickTarget` for the first named attack; the other attacks use `pickTarget(board, attack, square ?? me)`.

- [ ] **Step 4: Run to verify it passes**

Expected: all plan tests pass (11).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): turn plan from a board snapshot"
```

---

### Task 4: Board snapshot from Foundry

**Files:**
- Create: `scripts/ai/board.js`
- Test: `test/board.test.mjs`

**Interfaces:**
- Consumes: `obscurity`, `spotsBg3` from `scripts/rules.js`; `speedLimit` from `scripts/rules.js`; `MODULE_ID` from `scripts/main.js`. Sight inputs copied from `scripts/encounters.js` (`lightAt`, `hasLineOfSight`, `distanceFt`): move those three helpers and `globalLight` into a new export block at the end of `scripts/encounters.js` (`export { hasLineOfSight, lightAt, distanceFt }`) rather than duplicating them.
- Produces:
  - `activityInfo(activity) -> { id, uuid, name, kind, slot, range, bonus, dc, saveAbility, onSave, damage, healing } | null`: `null` when not usable in 4a (not `attack`/`save`/`damage`/`heal`; activation type not `action` or `bonus`; `target.affects.type === "self"`; `target.template.type` set; `canUse === false`; item or activity `uses.max` set and `value` 0; `requiresSpellSlot` and no slot of `item.system.level`). `range`: when `item.type === "weapon"` and `!activity.range.override`, `item.system.range.reach ?? item.system.range.value ?? 5`; else `activity.range.units === "touch"` gives 5, `"self"` gives 0, otherwise `activity.range.value ?? 5`. `bonus`: `parseInt(activity.labels.toHit)` or 0. `dc`: `activity.save.dc.value`; `saveAbility`: `activity.save.ability.first()`; `onSave`: `activity.damage.onSave`. `damage`: sum over `activity.getDamageConfig().rolls` of `averageOf(Roll.replaceFormulaData(parts.join(" + "), data))`; `healing` the same for a heal activity (`getDamageConfig` on a heal activity returns its healing rolls).
  - `snapshot(combat, combatant, reserved = new Set()) -> board` (shape in Task 3; `async`, because `findMovementPath(...).promise` is awaited). `me.budget = speedLimit(...) - movementHistory cost` (limit from `CONFIG.DND5E.movementTypes` and the combatant's dash flag, as `turns.js#limitFor`; a limit of 0 means unknown speed: budget 0). Enemy fields: `ac` from `actor.system.attributes.ac.value`, `saves[k]` from `actor.system.abilities[k].save.value ?? abilities[k].save ?? 0`, `hp` / `maxHp` from `attributes.hp`; `me.intelligence` from `abilities.int.value`, the monster's passive Perception from `skills.prc.passive` and darkvision from `attributes.senses.ranges.darkvision`. Enemies: combatants of the opposite disposition sign (`token.disposition * me.disposition < 0`; neutral tokens are nobody's enemy) with a token on `canvas.scene`, not `hidden`, `isDefeated` false; `visible` from `spotsBg3` with the enemy's light, line of sight, the monster's passive Perception and darkvision, the enemy's `bg3-flow.stealth` flag. `paths` only for visible enemies with `hp > 0`: `findMovementPath([{x, y, elevation}, { x: enemy.x, y: enemy.y, elevation }])`, expanded with `canvas.grid.getDirectPath(waypoints)` to offsets, centres via `canvas.grid.getCenterPoint(offset)`, start square dropped, `cost` from `canvas.grid.measurePath([start, ...centres]).waypoints[k].distance`, `distance` from `canvas.grid.measurePath([centre, enemyCentre]).distance`, `occupied` when another token's centre lies in that square (`canvas.grid.getOffset` equality). A path whose last square is the enemy's own square drops it. `multiattack`: description text of the first item whose name is `Multiattack` (case-insensitive), HTML stripped (`foundry.utils.stripHTML` if present, else a regex).

- [ ] **Step 1: Write the failing tests**

Stub globals as in `test/encounters.test.mjs` (copy its header), plus `canvas.grid` with `getDirectPath`, `getCenterPoint`, `getOffset`, `measurePath` over a 100 px / 5 ft square grid, `canvas.scene.tokens.contents`, `canvas.effects` as there, and `globalThis.Roll = { replaceFormulaData: (f, d) => f.replace(/@(\w+)/g, (_, k) => d[k] ?? 0) }`. Build a fake activity factory `act({ type, activation, range, item, toHit, parts, save, uses })`.

```js
test("activityInfo: a goblin's scimitar and shortbow as Plutonium imports them", () => {
  const scimitar = act({ type: "attack", activation: "action", toHit: "+4", parts: [["1d6 + @mod", { mod: 2 }]], item: { type: "weapon", range: { reach: 5, value: null } } });
  assert.deepEqual(activityInfo(scimitar), { id: "a1", uuid: "A.a1", name: "Scimitar", kind: "attack", slot: "action", range: 5, bonus: 4, dc: undefined, saveAbility: undefined, onSave: undefined, damage: 5.5, healing: 0 });
  const bow = act({ type: "attack", activation: "action", toHit: "+4", parts: [["1d6 + 2", {}]], item: { type: "weapon", range: { reach: null, value: 80, long: 320 } } });
  assert.equal(activityInfo(bow).range, 80);
});
test("activityInfo: save activity, spell slot check, uses, self targets, areas, utility", () => {
  assert.equal(activityInfo(act({ type: "save", activation: "action", save: { dc: 13, ability: "dex", onSave: "half" }, parts: [["2d6", {}]], range: { value: 60, units: "ft" } })).dc, 13);
  assert.equal(activityInfo(act({ type: "attack", activation: "action", spell: { level: 1, slots: 0 } })), null);
  assert.equal(activityInfo(act({ type: "attack", activation: "action", spell: { level: 1, slots: 1 } })).kind, "attack");
  assert.equal(activityInfo(act({ type: "attack", activation: "action", uses: { max: 1, value: 0 } })), null);
  assert.equal(activityInfo(act({ type: "heal", activation: "bonus", affects: "self" })), null);
  assert.equal(activityInfo(act({ type: "save", activation: "action", template: "cone" })), null);
  assert.equal(activityInfo(act({ type: "utility", activation: "action" })), null);
  assert.equal(activityInfo(act({ type: "attack", activation: "legendary" })), null);
});
test("snapshot: enemies, visibility through walls and darkness, paths cut at the budget, occupied squares, Multiattack text", async () => {
  // goblin at (50,50) speed 30 with 10 ft spent; rogue at (450,50) visible; wizard behind a wall; dead fighter; a friendly goblin standing on the path at (250,50)
  const b = await snapshot(combat, goblinCombatant);
  assert.deepEqual(b.enemies.map((e) => [e.id, e.visible]), [["rogue", true], ["wizard", false]]);
  assert.equal(b.me.budget, 20);
  assert.deepEqual(b.paths.rogue.map((s) => [s.x, s.cost, s.distance, s.occupied]), [[150, 5, 15, false], [250, 10, 10, true], [350, 15, 5, false]]);
  assert.equal(b.multiattack, "The goblin makes two attacks: one with its scimitar and one with its shortbow.");
  assert.deepEqual(b.activities.map((a) => a.name), ["Scimitar", "Shortbow"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `timeout 120 node --test test/board.test.mjs`. Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `scripts/ai/board.js`; export the three sight helpers from `scripts/encounters.js`**

- [ ] **Step 4: Run the whole suite**

Run: `timeout 120 node --test test/*.test.mjs > "$SCRATCH/t.txt" 2>&1; tail -8 "$SCRATCH/t.txt"`. Expected: all pass (95 + 14).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js scripts/encounters.js test/board.test.mjs
git commit -m "feat(autopilot): board snapshot from Foundry"
```

---

### Task 5: Execution, pause, tracker switch

**Files:**
- Create: `scripts/ai/run.js`
- Test: `test/run.test.mjs`
- Modify: `lang/en.json`, `lang/es.json` (keys used here)

**Interfaces:**
- Consumes: `snapshot` (Task 4), `planTurn`, `pickTarget` (Task 3), `activeIds` from `scripts/turns.js`, `safe`, `MODULE_ID`, `log` from `scripts/main.js`.
- Produces:
  - `isAuto(combatant) -> boolean`: `combatant.getFlag(MODULE_ID, "autopilot") !== false && !combatant.actor?.hasPlayerOwner`.
  - `runTurn(combat, deps = {}) -> Promise<void>` with `deps = { snap = snapshot, plan = planTurn, pick = pickTarget, use = useActivity, pause = pauseDialog }`. Members: `activeIds(combat)` mapped to combatants, filtered `isAuto`, `!isDefeated`, token on `canvas.scene`. Steps in order: clear each member's movement history; movement phase (one `snap` per member with the shared `reserved` set, `plan`, reserve `"x,y"` of `move`, then `Promise.all` of `token.move({ ...move, action: "walk" }, { autoRotate: true, showRuler: false, bg3Autopilot: true })`); action phase per member in order: `snap` + `plan` again (no move used from it), whisper `reason` to the GM (`ChatMessage.create({ content, whisper: [game.user.id] })`), then for each action: stale check, `pick(board, activity, meSquare)` when the planned target is dead or no longer visible (fresh `snap`), pause (`"execute"`, `"skip"`, `"manual"`: set flag `autopilot` false and stop this member), `await use(activity, targetUuid)`; a thrown error or `undefined` result whispers `Autopilot.Error` and stops this member (`manual = true`). End: when no member went manual, no error happened, not stale and `autoNextTurn`, `await combat.nextTurn()`.
  - `useActivity(info, targetUuid)`: resolves the live activity with `fromUuidSync(info.uuid)`, then `MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids: [targetUuid], ignoreUserTargets: true } })`.
  - `pauseDialog({ name, reason }) -> Promise<"execute"|"skip"|"manual">`: `DialogV2.wait` with three buttons, `rejectClose: false`, `null` becomes `"skip"`.
  - `onCombatTurnChange(combat)`: lead GM, `combat.started`, no run in progress, then `runTurn`.
  - `onRenderCombatTracker(app, html)`: for each `li.combatant[data-combatant-id]` whose combatant is not player-owned, append the robot button to `.combatant-controls` (fallback: the `li`), class `active` when `isAuto`, click toggles the flag and stops propagation.
  - `registerAutopilot()`: `Hooks.on("combatTurnChange", ...)`, `Hooks.on("renderCombatTracker", ...)`, `ui.combat?.render()`, `log("autopilot on")`.
- Lang keys (en / es): `Autopilot.Toggle` "Autopilot" / "Piloto automático"; `Autopilot.Pause.Title` "{name}: autopilot" / "{name}: piloto automático"; `Autopilot.Pause.Execute` "Execute" / "Ejecutar"; `Autopilot.Pause.Skip` "Skip" / "Saltar"; `Autopilot.Pause.Manual` "Take over" / "Llevar a mano"; `Autopilot.Decision` "<b>{name}</b>: {reason}" (same in es); `Autopilot.Error` "Autopilot stopped for <b>{name}</b>: {error}" / "Piloto detenido para <b>{name}</b>: {error}".

- [ ] **Step 1: Write the failing tests**

Stubs: `Hooks`, `ui` (`combat.render`), `ChatMessage.create` collecting `{ content, whisper }`, `game` with `users.activeGM.isSelf`, `settings` (`pauseBeforeAttack`, `autoNextTurn`), `i18n`, `canvas.scene.id`, `MidiQOL` absent (use `deps.use`). A `combatant(id, { disposition, auto, defeated, playerOwner })` factory with `token.move` recording `(waypoints, options)` and `clearMovementHistory`, and a `combat` with `turns`, `combatants`, `combatant`, `turn`, `round`, `started`, `nextTurn()` counting. `deps.snap` returns canned boards, `deps.plan` canned plans.

```js
test("runTurn: moves the whole group first, then uses actions one by one, whispers the reason, passes the turn", async () => {
  // two goblins on a shared turn, plans: g1 moves to (400,0) and attacks; g2 only approaches
  await runTurn(combat, deps);
  assert.deepEqual(order, ["move g1", "move g2", "use g1 sc T.rogue"]);
  assert.deepEqual(calls.chat.map((m) => m.whisper), [["gm"], ["gm"]]);
  assert.equal(combat.nextTurns, 1);
});
test("runTurn: a manual group mate is skipped and the turn is not passed", async () => { ... assert.equal(combat.nextTurns, 0); });
test("runTurn: pause skip drops the action, take over switches the monster off and keeps the turn", async () => {
  // pauseBeforeAttack true; pause answers "skip" then "manual"
  assert.deepEqual(uses, []);
  assert.equal(g1.flags["bg3-flow"].autopilot, false);
  assert.equal(combat.nextTurns, 0);
});
test("runTurn: the target died during a Multiattack: the next use is re-picked, none left drops it", async () => { ... });
test("runTurn: a use that throws whispers the error, the next monster still acts, the turn is not passed", async () => { ... });
test("runTurn: the GM changed the turn mid-run: no more uses, no next turn", async () => { ... });
test("runTurn: an empty plan (budget 0, nothing in range) still passes the turn", async () => { ... });
test("onCombatTurnChange runs only on the lead GM with a started combat", async () => { ... });
test("onRenderCombatTracker appends an active robot button to NPC rows only, click toggles the flag", async () => {
  // fake DOM: li elements with querySelector/append and a click dispatcher
});
test("registerAutopilot hooks combatTurnChange and renderCombatTracker and re-renders the tracker", () => { ... });
```

Write every test body in full (assertions on `order`, `uses`, `calls.chat`, `combat.nextTurns`, flags) before Step 2.

- [ ] **Step 2: Run to verify it fails**

Run: `timeout 120 node --test test/run.test.mjs`. Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `scripts/ai/run.js` and the lang keys**

`stale()` closes over `{ id: combat.id, round: combat.round, turn: combat.turn }` captured at the start and compares with `game.combat`. One module-level `running` flag.

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/run.js test/run.test.mjs lang/en.json lang/es.json
git commit -m "feat(autopilot): group moves, actions through Midi, pause, tracker switch"
```

---

### Task 6: Wiring, docs, release 0.6.0

**Files:**
- Modify: `scripts/main.js`, `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md`, `module.json`
- Test: `test/main.test.mjs` is not a file; the wiring is checked by the existing import in `test/turns.test.mjs` style: add to `test/run.test.mjs` a test that `registerAutopilot` is exported and the settings keys exist in both lang files (read the JSON files with `fs`).

- [ ] **Step 1: Write the failing test**

```js
test("lang files carry every Autopilot and settings key the module uses", () => {
  const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url))).BG3FLOW;
  const es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url))).BG3FLOW;
  for (const k of ["enableAutopilot", "pauseBeforeAttack", "autoNextTurn", "intelligenceThreshold"]) { assert.ok(en.Settings[k]?.Name && en.Settings[k]?.Hint, k); assert.ok(es.Settings[k]?.Name && es.Settings[k]?.Hint, k); }
  for (const k of ["Toggle", "Decision", "Error"]) { assert.ok(en.Autopilot[k], k); assert.ok(es.Autopilot[k], k); }
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL on `Settings.enableAutopilot`.

- [ ] **Step 3: Wire it**

`scripts/main.js`: `reg("enableAutopilot", Boolean, true)`, `reg("pauseBeforeAttack", Boolean, false)`, `reg("autoNextTurn", Boolean, true)`, `reg("intelligenceThreshold", Number, 6)`; in `ready`, after `registerEncounters`: `if (game.settings.get(MODULE_ID, "enableAutopilot")) registerAutopilot();` and `runTurn` added to `api`. Lang hints: enableAutopilot "Monsters play their own turns: move, attack, pass." / es; pauseBeforeAttack "Ask the GM before each monster action." / es; autoNextTurn "Pass the turn when every active monster was automatic." / es; intelligenceThreshold "Intelligence at or above which a monster finishes the most wounded target instead of the nearest." / es. `module.json` version `0.6.0`.

`README.md`: section "Monster autopilot (piece 4a)": what happens on a monster's turn in five lines, the four settings, the tracker robot button, the GM whisper, the Gambit's Premades *Opportunity Attack* requirement (monster moves trigger it), and the "not counted yet" list (areas, heals, bonus actions, recharge, flee, resistances, conditions, legendary actions).

`docs/SERVER-TESTING.md` section 7 "Autopilot (v0.6.0)", on the goblin scene with Gambit's Opportunity Attack on, darkness 0, lights off:
- A1. Start a combat with the Rogue and two goblins 30 ft away in sight; GM passes to the goblins' shared turn. Expected: both goblins walk together and stop adjacent to the Rogue (different squares), then one scimitar attack each with Midi cards, two GM whispers "Goblin N: Scimitar vs Rogue (expected ...)", and the turn passes to the Rogue by itself.
- A2. Same with one goblin 60 ft away: it walks 30 ft and stops; whisper "approach Rogue"; the turn passes.
- A3. One goblin at 50 ft with the Rogue in sight: whisper names Shortbow and it does not move (bow range 80).
- A4. Tracker: the robot button shows on goblin rows only; click it on Goblin 2 (greyed): on their turn Goblin 1 acts, Goblin 2 does nothing, the turn does not pass; pass it by hand.
- A5. `pauseBeforeAttack` on: before each attack a dialog with Execute / Skip / Take over; Skip drops the attack, Take over greys the button and stops.
- A6. Rogue hidden behind the wall (Hide 25, darkness 0.7 as in E7): the goblin's whisper is "no visible enemy" and it stays.
- A7. A goblin adjacent to the Fighter walks away toward the Rogue: Gambit prompts the Fighter's opportunity attack; the goblin waits and continues (or stops if the GM ends the turn).

- [ ] **Step 4: Run the whole suite and the release build**

Run: `timeout 120 node --test test/*.test.mjs` then `bash tools/release.sh`. Expected: all pass; `module.zip` built.

- [ ] **Step 5: Commit, tag, push**

```bash
git add -A
git commit -m "feat: monster autopilot core (piece 4a), v0.6.0"
git tag v0.6.0 && git push -q origin main v0.6.0
```
Then the user runs `gh release create v0.6.0 module.zip module.json -t v0.6.0 -n "..."` and the web session runs section 7.
