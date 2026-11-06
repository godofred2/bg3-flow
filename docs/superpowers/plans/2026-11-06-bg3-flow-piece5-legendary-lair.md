# BG3 Flow piece 5: legendary and lair actions on the autopilot. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autopilot monster with legendary actions uses them at the end of every other group's turn (as many as that group had standing members, while its uses last), and a monster in its lair takes one lair action at the top of every round; both pick the best-scoring activity from where the monster stands, through the same scorer, pause dialog and GM whisper as its ordinary actions.

**Architecture:** Three existing files. `board.js` lets activities with activation `legendary` (with their use cost) and `lair` into the snapshot and adds `me.legendary` (uses left and max) and `me.lair` (in its lair). `plan.js` scores the two new slots from where the monster stands (value per legendary use, cost no more than the uses left). `run.js` factors the "act from here" closure out of `runTurn` and adds two phases driven by the existing turn-change hook: `runLegendary` (after the turn of a group the monster is not in) and `runLair` (on a round change, before the first group plays). dnd5e itself spends the legendary uses when an activity is used and refills them; the autopilot only reads them. One new world setting, `legendaryActions`.

**Tech Stack:** As 4c plus dnd5e 6.0.6 facts verified in the source at tag `release-6.0.6`: activation types `legendary` (config `consume: { property: "resources.legact" }`, `scalar: true`: `activation.value` is the use cost; on use dnd5e consumes `activation.value ?? 1` from `resources.legact` by itself and refuses when short, `module/documents/activity/mixin.mjs` ~566) and `lair` (no consumption); `actor.system.resources.legact = { max, spent, value }` (`value = max - spent`, `spent` reset to 0 by dnd5e at the end of the monster's own turn and at encounter start, `module/data/actor/npc.mjs` ~559); `resources.lair = { value: boolean, initiative: number, inside: boolean }` (the NPC sheet shows the lair block when modern rules and `lair.value`, or legacy rules and `lair.initiative`; `lair.inside` is the 2024 "inside its lair" switch); rules version per actor `actor.system.source?.rules` (`"2014"` / `"2024"`) else `game.settings.get("dnd5e", "rulesVersion")` (`"legacy"` / `"modern"`). dnd5e 6 creates no lair combatant and no lair turn: the module fires lair actions itself. Foundry's `combatTurnChange(combat, prior, current)` where `prior.turn` indexes `combat.turns`.

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, "Piece 5 (later): legendary and lair actions" (the spec lists it and says nothing else: every rule below is a plan-level ruling, written into the spec as an amendment in Task 4).

## Global Constraints

- As the 4a-4c plans: Foundry 14, dnd5e 6.0.x, Midi >= 14.6, ES modules, CRLF, `safe` wrappers, lead GM only, Midi for every roll, pure decisions in `plan.js`, TDD with `node --test`, commits with the user's identity and the Claude trailer, strings under `BG3FLOW.Settings.*` in `lang/en.json` and `lang/es.json` (whisper reasons stay plain English like `flee: ...` and `approach ...`).
- Setting (world): `legendaryActions` Boolean default `true` (covers both legendary and lair actions).
- Release at the end: `module.json` 0.9.0.

## Rulings (plan-level: the spec is silent on all of it)

- **When legendary actions fire.** RAW: after another creature's turn, one legendary action per such turn. With piece 2's shared turns, the end of a group's turn is the end of every member's turn at once: at `combatTurnChange` stepping forward, each autopilot monster that is **not** in the group that just ended may take up to **K** legendary actions, K = standing (not defeated) members of that group (with `enableTurns` off, K = 1 and the group is the prior combatant alone). They run before the new turn's monsters play (`runLegendary` then `runTurn` in the same hook). Cost if wrong: a dragon facing three PCs gets three legendary actions in a row at the end of their shared turn instead of one after each PC, the same total.
- **Its own group** is excluded (its turn just ended; dnd5e refills its uses there). "Previous turn" never fires anything (the existing direction rule).
- **Which legendary action.** From where it stands (budget 0: no move, no retreat step, no walk), the affordable legendary activity (`cost <= me.legendary.value`) with the best **value per use** (`pickTarget` value divided by `cost`), ties by value; nothing scoring means nothing is done and nothing is whispered (a "no legendary action" whisper after every PC turn is noise). The loop re-snapshots before each action, so hit points and the uses dnd5e just spent are fresh; it is capped at K whatever the uses say (if a sheet's own consumption target did not consume, the cap still ends it).
- **Utility legendary actions** (Detect, Move, a Wing Attack built as pure utility) never score (`activityInfo` keeps only attack, save, damage and heal), so they are never used. A Wing Attack imported as a save with damage is used like any area or save. Cost if wrong: a dragon that never repositions with its legendary Move.
- **Lair actions** fire once per round at the top of the round (`combatTurnChange` with `current.round > prior.round`, round 1 included, since Foundry fires it on combat start). Order on a round change: legendary (end of the last turn of the old round), then lair (initiative 20 of the new round), then the new turn's monsters. RAW's "initiative count 20, losing ties" is approximated by "before everyone" (ponytail comment). One lair action per monster in its lair; the best-scoring `lair` activity from where it stands; nothing scoring means silence. Lair activities that are pure effects (fog, grasping roots as utility) are not played: the GM runs them by hand, as before.
- **In its lair** (`me.lair`): modern rules for the actor (`source.rules === "2024"`, or no `source.rules` and the dnd5e setting is `modern`): `lair.value && lair.inside`; legacy: `lair.initiative > 0 || lair.value`. A monster with lair activities on its sheet but not in its lair takes none. (dnd5e already adds the 2024 "+1 legendary use in its lair" to `legact.max`; nothing to do.)
- **Who plays them**: autopilot members (`isAuto`, token on the current scene, not defeated, hp > 0), in initiative order, lead GM client. The pause-before-attack dialog, the GM whisper (`<b>Dragon</b>: legendary: Tail Attack vs Rogue (expected 4.5; 2 uses left)`), the stale check and the error whisper are the same code as the ordinary actions (`act`).
- **Out of scope** (ledgered, README "not counted"): legendary resistance (dnd5e has its own prompt on the save card), mythic actions, legendary actions that move the monster, lair actions with initiative other than 20, regional effects.

## Review Focus

1. A legendary monster whose own group's turn just ended: no legendary action (Task 3 pins it); the next other group's turn end gives K again.
2. Uses short of the cost (Wing Attack costs 2 with 1 left): not offered; all uses spent: silence, no error whisper (Task 2 planner, Task 3 runner with a snapshot whose `legact.value` drops to 0 after the first use).
3. A legendary monster at 0 hp, defeated, or with the autopilot off, or the setting off: nothing fires (Task 3).
4. Round change: lair fires once, at the new round only, never on a turn step inside the round; a monster not in its lair (modern `inside` false; legacy without `initiative`) never fires (Task 1 `me.lair`, Task 3).
5. `combatTurnChange` fired by the autopilot's own `nextTurn()`: the legendary phase of other groups' monsters runs for the group that just ended, and `running` never deadlocks the next group's turn (Task 3: the phases run under the same `running` guard before `runTurn`).

## File structure

- Modify `scripts/ai/board.js`: `activityInfo` (`SLOTS` += `legendary`, `lair`; `cost`), `snapshot` (`me.legendary`, `me.lair`), `lairOf(actor)`.
- Modify `scripts/ai/plan.js`: `planTurn` slots `legendary` and `lair`.
- Modify `scripts/ai/run.js`: `actWith(ctx)` (the former `act` closure), `runLegendary`, `runLair`, `onCombatTurnChange`, `brief`.
- Modify `scripts/turns.js`: `memberIds(combat, combatantId)` exported; `activeIds` uses it.
- Modify `scripts/main.js` (one setting), `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7d, L-steps), spec amendment, `module.json` (0.9.0).
- Tests: `test/board.test.mjs`, `test/plan.test.mjs`, `test/run.test.mjs`, `test/turns.test.mjs`.

Test command for every task: `cd "/c/Foundry vtt module" && timeout 120 node --test test/*.test.mjs > "$SCRATCH/t.txt" 2>&1; grep "pass \|fail \|^not ok" "$SCRATCH/t.txt"` (194 pass before Task 1; the summary lines read `ℹ pass N` / `ℹ fail N`).

---

### Task 1: Board inputs: legendary and lair activities, uses, in its lair

**Files:**
- Modify: `scripts/ai/board.js`
- Test: `test/board.test.mjs` (extend the `act` fixture, append tests)

**Interfaces:**
- Produces:
  - `activityInfo(activity)` accepts `activation.type` `"legendary"` and `"lair"` (besides `action`, `bonus`); the result's `slot` is that type and, for `legendary` only, `cost: Number(activity.activation.value) || 1` (other slots: no `cost` key). Everything else as today (kinds, areas, spent uses, spell slots).
  - `snapshot(...)` gains `me.legendary = { value: number, max: number }` from `actor.system.resources.legact` (`{ value: 0, max: 0 }` when absent) and `me.lair: boolean` from `lairOf(actor)`.
  - `export function lairOf(actor) -> boolean` (Task 3 filters on it before any snapshot; tested here through `snapshot`): rules = `actor.system.source?.rules ?? (game.settings.get("dnd5e", "rulesVersion") === "modern" ? "2024" : "2014")`; `"2024"`: `!!(lair.value && lair.inside)`; else `lair.initiative > 0 || !!lair.value`; `lair` = `actor.system.resources?.lair ?? {}`.

- [ ] **Step 1: Write the failing tests**

Extend the `act` fixture: add a `cost` parameter (`cost = null`) and build `activation: { type: activation, value: cost }`. Extend the `token` fixture: add `legact = null` and `lair = null` parameters written into `doc.actor.system.resources = { legact: legact ?? { max: 0, spent: 0, value: 0 }, lair: lair ?? { value: false, initiative: null, inside: false } }`, and `rules = null` written into `doc.actor.system.source = rules ? { rules } : {}`. The `settings` map used by `game.settings.get` in this file must answer `game.settings.get("dnd5e", "rulesVersion")`: add a `dnd5eRulesVersion` key read when the module id is `"dnd5e"` (`get: (m, k) => m === "dnd5e" ? settings.dnd5eRulesVersion : settings[k]`), default `"legacy"`.

```js
test("activityInfo: legendary and lair activations are kept with the legendary use cost; mythic and reactions are not", () => {
  n = 0;
  const tail = act({ name: "Tail Attack", type: "attack", activation: "legendary", toHit: "+7", parts: [["1d8 + 4", {}]], item: { type: "feat" } });
  assert.deepEqual([activityInfo(tail).slot, activityInfo(tail).cost, activityInfo(tail).damage], ["legendary", 1, 8.5]);
  const wing = act({ name: "Wing Attack", type: "save", activation: "legendary", cost: 2, save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["2d6 + 4", {}]], range: { value: 10, units: "ft" } });
  assert.deepEqual([activityInfo(wing).slot, activityInfo(wing).cost], ["legendary", 2]);
  const rumble = act({ name: "Lair Rumble", type: "save", activation: "lair", save: { dc: 12, ability: "con", onSave: "half" }, parts: [["1d6", {}]], range: { value: 60, units: "ft" } });
  assert.deepEqual([activityInfo(rumble).slot, "cost" in activityInfo(rumble)], ["lair", false]);
  assert.equal(activityInfo(act({ type: "attack", activation: "mythic" })), null);
  assert.equal(activityInfo(act({ type: "attack", activation: "reaction" })), null);
  assert.equal("cost" in activityInfo(act({ type: "attack" })), false);
});
test("snapshot: legendary uses left and max, and whether the monster is in its lair under modern or legacy rules", async () => {
  const rogue = token("rogue", { x: 400, disposition: 1 });
  const bare = token("goblin", { x: 0, disposition: -1 });
  canvas.scene.tokens.contents = [bare, rogue];
  let b = await snapshot({ combatants: [combatantOf(bare), combatantOf(rogue)] }, combatantOf(bare));
  assert.deepEqual([b.me.legendary, b.me.lair], [{ value: 0, max: 0 }, false]);
  const dragon = token("dragon", { x: 0, disposition: -1, legact: { max: 3, spent: 1, value: 2 }, lair: { value: true, initiative: 20, inside: false } });
  canvas.scene.tokens.contents = [dragon, rogue];
  settings.dnd5eRulesVersion = "legacy";
  b = await snapshot({ combatants: [combatantOf(dragon), combatantOf(rogue)] }, combatantOf(dragon));
  assert.deepEqual([b.me.legendary, b.me.lair], [{ value: 2, max: 3 }, true]); // legacy: initiative 20 means lair actions
  settings.dnd5eRulesVersion = "modern";
  b = await snapshot({ combatants: [combatantOf(dragon), combatantOf(rogue)] }, combatantOf(dragon));
  assert.equal(b.me.lair, false); // modern: not inside its lair
  const inside = token("dragon2", { x: 0, disposition: -1, lair: { value: true, initiative: null, inside: true }, rules: "2024" });
  canvas.scene.tokens.contents = [inside, rogue];
  settings.dnd5eRulesVersion = "legacy"; // the actor's own rules version wins
  b = await snapshot({ combatants: [combatantOf(inside), combatantOf(rogue)] }, combatantOf(inside));
  assert.equal(b.me.lair, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL on `activityInfo(tail).slot` (null result: `legendary` is not in `SLOTS`) and on `b.me.legendary` (undefined).

- [ ] **Step 3: Implement in `scripts/ai/board.js`**

`SLOTS = new Set(["action", "bonus", "legendary", "lair"])`; in `activityInfo` spread `...(activity.activation.type === "legendary" ? { cost: Number(activity.activation.value) || 1 } : {})` into the result; `lairOf(actor)` as the Interfaces block; `me` gains `legendary: { value: legact.value ?? 0, max: legact.max ?? 0 }` (`legact = actor?.system?.resources?.legact ?? {}`) and `lair: lairOf(actor)`. Update the existing `activityInfo` comment ("legendary" is no longer ignored).

- [ ] **Step 4: Run the whole suite**

Expected: all pass (the existing deep-equal of the scimitar result still has no `cost` key).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js test/board.test.mjs
git commit -m "feat(autopilot): legendary and lair activities in the snapshot, uses left and in-its-lair flag"
```

---

### Task 2: Planner: the legendary and lair slots

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Task 1): activities with `slot: "legendary"` and `cost`, `slot: "lair"`; `board.me.legendary.value`.
- Produces: `planTurn(board, { slot: "legendary" })` and `planTurn(board, { slot: "lair" })`:
  - candidates = activities of that slot, for `legendary` only those with `cost <= board.me.legendary.value`; each scored with `pickTarget(board, a)` as the action slot does (the runner passes a budget-0 board, so no move is possible; the result's `move` is whatever `pickTarget` returns, null on such a board);
  - legendary ranking: `value / cost` descending, ties by `value` descending, then the existing tie rank; the reason is `legendary: <name> vs <target> (expected <value>; <left> uses left)` with `left = me.legendary.value - cost` and `uses` singular when 1 (`1 use left`), `0 uses left`; the existing `; also: ...` list follows when there are other options (their raw values); no `opportunity attacks` text appears (budget 0: no toll);
  - lair ranking: by value, reason `lair: <name> vs <target> (expected <value>)` plus the `also` list;
  - nothing scoring: `{ move: null, actions: [], reason: "no legendary action" }` / `"no lair action"`;
  - these slots never flee and never use Multiattack (both already gated on `slot === "action"`).

- [ ] **Step 1: Write the failing tests**

```js
const tail = { id: "tl", uuid: "A.tl", name: "Tail Attack", kind: "attack", slot: "legendary", cost: 1, range: 10, bonus: 7, damage: 8.5 };
const wing = { id: "wg", uuid: "A.wg", name: "Wing Attack", kind: "save", slot: "legendary", cost: 2, range: 10, dc: 15, saveAbility: "dex", onSave: "half", damage: 11, affects: "creature" };
const rumble = { id: "rm", uuid: "A.rm", name: "Lair Rumble", kind: "save", slot: "lair", range: 60, dc: 12, saveAbility: "con", onSave: "half", damage: 3.5, affects: "creature" };
const legBoard = (value, over = {}) => { const b = board({ budget: 0, enemies: [pc("rogue", 5, { ac: 13 }), pc("fighter", 30, { ac: 19 })], activities: [scimitar, tail, wing, rumble], ...over }); b.me.legendary = { value, max: 3 }; return b; };
test("legendary slot: the affordable legendary activity with the best value per use, from where it stands, uses left in the reason", () => {
  let p = planTurn(legBoard(3), { slot: "legendary" });
  // Tail vs rogue: hit (21+7-13)/20 = 0.75 x 8.5 = 6.4 per use; Wing vs rogue: fail (15-1-0)/20 = 0.7 -> 0.7 x 11 + 0.3 x 5.5 = 9.35 for 2 uses = 4.7 per use
  assert.deepEqual([p.move, p.actions, p.reason], [null, [{ activityId: "tl", targetIds: ["rogue"], aimId: "rogue" }], "legendary: Tail Attack vs rogue (expected 6.4; 2 uses left); also: Wing Attack 9.3"]);
  p = planTurn(legBoard(1), { slot: "legendary" });
  assert.deepEqual([p.actions[0].activityId, p.reason], ["tl", "legendary: Tail Attack vs rogue (expected 6.4; 0 uses left)"]); // Wing Attack costs 2: not offered
  p = planTurn(legBoard(2, { activities: [wing, rumble] }), { slot: "legendary" });
  assert.equal(p.reason, "legendary: Wing Attack vs rogue (expected 9.3; 0 uses left)");
  assert.deepEqual(planTurn(legBoard(0), { slot: "legendary" }), { move: null, actions: [], reason: "no legendary action" });
  assert.deepEqual(planTurn(legBoard(3, { activities: [scimitar] }), { slot: "legendary" }), { move: null, actions: [], reason: "no legendary action" }); // the Scimitar is an action, not legendary
  assert.equal(planTurn(legBoard(3), { slot: "action" }).reason.startsWith("Scimitar vs rogue"), true); // the action slot never sees the legendary ones
});
test("lair slot: the best lair activity, one reason, nothing else", () => {
  const p = planTurn(legBoard(3), { slot: "lair" });
  // Rumble vs rogue: fail (12-1-0)/20 = 0.55 -> 0.55 x 3.5 + 0.45 x 1.75 = 2.7
  assert.deepEqual([p.move, p.actions, p.reason], [null, [{ activityId: "rm", targetIds: ["rogue"], aimId: "rogue" }], "lair: Lair Rumble vs rogue (expected 2.7)"]);
  assert.deepEqual(planTurn(legBoard(3, { activities: [tail] }), { slot: "lair" }), { move: null, actions: [], reason: "no lair action" });
});
```

If `pc()` in the fixtures gives the rogue a `saves.dex` or `saves.con` bonus other than 0, or `expectedValue` rounds differently, correct the expected numbers to what the scorer yields and note the arithmetic in the test comment (the planner is the reference; the test pins ranking and wording).

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: the legendary slot result has reason `no bonus action` (today every non-action slot ends there).

- [ ] **Step 3: Implement in `scripts/ai/plan.js`**

In `planTurn`: filter `actions` by cost for the legendary slot; after `options` are built and sorted, for `slot === "legendary"` sort by `value / cost` (keep a `cost` on each option: the activity's), ties by value then the existing rank; build the reason with the slot prefix and the uses text; for `"lair"` the prefix only. Replace the final `if (slot !== "action") return { ... "no bonus action" }` with a per-slot text (`no bonus action`, `no legendary action`, `no lair action`).

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): legendary slot (value per use, cost within the uses left) and lair slot in the planner"
```

---

### Task 3: Execution: the legendary phase after another group's turn, the lair phase at the top of the round

**Files:**
- Modify: `scripts/ai/run.js`, `scripts/turns.js`, `scripts/main.js`, `lang/en.json`, `lang/es.json`
- Test: `test/run.test.mjs`, `test/turns.test.mjs` (append)

**Interfaces:**
- Consumes (Tasks 1-2): `board.me.legendary`, `board.me.lair`, `planTurn(board, { slot })` for `legendary` and `lair`.
- Produces:
  - `turns.js`: `export function memberIds(combat, combatantId) -> Set<string>`: the ids of `combatantId`'s group (`groupOf(groupBySide(turnsOf(combat)), id)`, or just the id when it is in no group) without the defeated ones; `activeIds(combat)` = `memberIds(combat, combat.combatant.id)` or an empty set without a current combatant (same results as today).
  - `run.js`:
    - `actWith({ combat, reserved, stale, snap, pick, use, pause, whisper })` returns the former `act(c, board, p, said)` closure unchanged in behaviour (`true` done, `false` the GM took over, `null` stale); `runTurn` builds it with its own deps and keeps its `clean` bookkeeping outside.
    - `export async function runLegendary(combat, endedIds: Set<string>, deps)`: when `game.settings.get(MODULE_ID, "legendaryActions") === false` return; `K` = `endedIds.size`; for each `c` of `combat.turns` in order with `!c.isDefeated && isAuto(c) && c.token on the current scene && !endedIds.has(c.id) && (c.actor?.system?.resources?.legact?.value ?? 0) > 0` (the actor is read before any snapshot: a goblin without legendary actions costs no pathfinding at every PC turn end): up to K times: `board = await snap(combat, c, new Set())`; stop this monster when `board.me.hp <= 0` or `board.me.legendary.value <= 0`; `p = plan({ ...board, me: { ...board.me, budget: 0 } }, { slot: "legendary" })`; no actions: stop this monster silently; else `r = await act(c, still, p)` (whispers the reason, runs the use): `null` returns from the whole phase, `false` stops this monster. Errors per monster go through the same `failed()` whisper as `runTurn`. Stale = `game.combat` changed id, round or turn since the phase began.
    - `export async function runLair(combat, deps)`: same gate; for each autopilot member as above (no group exclusion, no uses check) with `lairOf(c.actor)` true (checked before the snapshot, `lairOf` imported from `board.js`), once: plan `{ slot: "lair" }` on the budget-0 board; actions: `act`; none: silence.
    - `onCombatTurnChange(combat, prior, current, deps)`: after the existing lead-GM, started, `running` and direction checks: `ended` = `prior.turn` is a number and `combat.turns[prior.turn]` exists ? (`game.settings.get(MODULE_ID, "enableTurns") === false` ? `new Set([that.id])` : `memberIds(combat, that.id)`) : empty; then `running = true; try { if (ended.size) await runLegendary(combat, ended, deps); if (r1 > r0) await runLair(combat, deps); } finally { running = false; }` and then `await runTurn(combat, deps)` as today. `runLegendary` and `runLair` take `deps` with the same keys as `runTurn` (`snap`, `plan`, `pick`, `use`, `pause`).
    - `brief(board)` adds ` legendary ${value}/${max}` when `max > 0`, ` lair` when `me.lair`, and per activity ` legendary x${cost}` / ` lair` in the slot bracket (where `bonus` is shown today).
  - `main.js`: `reg("legendaryActions", Boolean, true)`; `lang`: `Settings.legendaryActions.{name, hint}` in both files (en: "Legendary and lair actions" / "Autopilot monsters use their legendary actions after every other group's turn and one lair action at the top of each round."; es: "Acciones legendarias y de guarida" / "Los monstruos en piloto automático usan sus acciones legendarias tras el turno de cada otro grupo y una acción de guarida al inicio de cada ronda.").

- [ ] **Step 1: Write the failing tests**

In `test/turns.test.mjs` (import `memberIds` next to `activeIds`):

```js
test("memberIds: a combatant's group without the defeated, or itself alone", () => {
  const dead = combatant("dead", -1, { defeated: true });
  const cb = combat([cleric, rogue, g1, dead, g2], 0);
  assert.deepEqual([...memberIds(cb, "g1")].sort(), ["g1", "g2"]); // asked about a group that is not the current one
  assert.deepEqual([...memberIds(cb, "cleric")].sort(), ["cleric", "rogue"]);
  assert.deepEqual([...memberIds(cb, "dead")].sort(), ["g1", "g2"]);
});
```

In `test/run.test.mjs` (import `runLegendary`, `runLair`; the `settings` map gains `legendaryActions: true`, reset in `reset()`; `game.settings.get` with module `"dnd5e"` may keep returning `undefined`, which `lairOf` reads as legacy rules):

```js
const tailPlan = (left) => ({ move: null, actions: [{ activityId: "tl", targetIds: ["rogue"], aimId: "rogue" }], reason: `legendary: Tail Attack vs rogue (expected 6.4; ${left} uses left)` });
const noLeg = { move: null, actions: [], reason: "no legendary action" };
const tl = { id: "tl", uuid: "A.tl", name: "Tail Attack", kind: "attack", slot: "legendary", cost: 1, range: 10, bonus: 7, damage: 8.5 };
// The sheet the phases read before any snapshot: legendary uses left and a legacy lair (initiative 20).
const legendary = (c, value, lair = true) => { c.actor.system = { resources: { legact: { value, max: 3 }, lair: { value: lair, initiative: lair ? 20 : null, inside: false } } }; return c; };
function legDeps(max, { hp = 7 } = {}) { // the stub spends one use per act like dnd5e does
  let left = max;
  const d = deps({ plans: {} });
  d.snap = async (combat, c) => ({ ...boardFor(c, [enemy("rogue")]), activities: [sc, tl], me: { ...boardFor(c, []).me, hp, legendary: { value: left, max }, lair: !!c.actor.system?.resources?.lair?.initiative } });
  d.plan = (board, opts) => opts?.slot === "legendary" ? (board.me.legendary.value > 0 ? tailPlan(board.me.legendary.value - 1) : noLeg) : opts?.slot === "lair" ? { move: null, actions: [{ activityId: "tl", targetIds: ["rogue"], aimId: "rogue" }], reason: "lair: Tail Attack vs rogue (expected 6.4)" } : emptyPlan;
  d.use = async (a, uuids) => { uses.push([a.id, String(uuids)]); left--; return {}; };
  return d;
}
test("runLegendary: after another group's turn a legendary monster acts once per standing member of that group, while its uses last, from where it stands, and never for its own group", async () => {
  reset();
  const g1 = legendary(combatant("g1"), 2), pc1 = combatant("pc1", { disposition: 1, playerOwner: true }), pc2 = combatant("pc2", { disposition: 1, playerOwner: true }), pc3 = combatant("pc3", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc1, pc2, pc3, g1], 3);
  await runLegendary(combat, new Set(["pc1", "pc2", "pc3"]), legDeps(2));
  assert.deepEqual(uses, [["tl", "T.rogue"], ["tl", "T.rogue"]]); // three turns ended, two uses left: two actions
  assert.deepEqual(calls.chat.map((m) => m.content.includes("1 uses left") || m.content.includes("0 uses left")), [true, true]);
  assert.deepEqual(moves, []); // no movement in a legendary phase
  reset(); legendary(g1, 3);
  await runLegendary(combat, new Set(["pc1"]), legDeps(3));
  assert.equal(uses.length, 1); // one turn ended: one action
  reset();
  await runLegendary(combat, new Set(["g1"]), legDeps(3));
  assert.deepEqual([uses, calls.chat], [[], []]); // its own group: nothing, silently
  reset(); legendary(g1, 0);
  await runLegendary(combat, new Set(["pc1"]), legDeps(0));
  assert.deepEqual([uses, calls.chat], [[], []]); // no uses: silence, no error, no snapshot
  reset(); legendary(g1, 3);
  await runLegendary(combat, new Set(["pc1"]), legDeps(3, { hp: 0 }));
  assert.deepEqual(uses, []); // down: nothing
  reset(); settings.legendaryActions = false;
  await runLegendary(combat, new Set(["pc1"]), legDeps(3));
  assert.deepEqual(uses, []);
});
test("runLair: one lair action per monster in its lair, none for the others, no snapshot for a monster without a lair", async () => {
  reset();
  const g1 = legendary(combatant("g1"), 0), g2 = combatant("g2"), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc, g1, g2], 0);
  const d = legDeps(0);
  let snaps = 0; const snap = d.snap; d.snap = async (...a) => { snaps++; return snap(...a); };
  await runLair(combat, d);
  assert.deepEqual([uses.length, calls.chat.length, calls.chat[0].content.includes("lair: Tail Attack"), snaps], [1, 1, true, 1]);
});
test("onCombatTurnChange runs the legendary phase for the ended group, the lair phase on a new round, then the new turn, under one running guard", async () => {
  reset();
  const g1 = legendary(combatant("g1"), 3), pc1 = combatant("pc1", { disposition: 1, playerOwner: true }), pc2 = combatant("pc2", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc1, pc2, g1], 2);
  const seen = [];
  const d = legDeps(3);
  const plan = d.plan; d.plan = (b, o) => { seen.push(o?.slot ?? "action"); return plan(b, o); };
  await onCombatTurnChange(combat, { round: 1, turn: 1 }, { round: 1, turn: 2 }, d); // the PCs' turn (pc1 + pc2) ended, same round
  assert.deepEqual(seen.filter((s) => s !== "bonus"), ["legendary", "legendary", "action", "action"]); // two PC turns ended -> two legendary actions, then g1's own turn (runTurn plans the action slot before and after the move)
  assert.equal(combat.nextTurns, 1);
  reset();
  const c2 = makeCombat([pc1, pc2, g1], 0);
  await onCombatTurnChange(c2, { round: 1, turn: 2 }, { round: 2, turn: 0 }, legDeps(3)); // g1's turn ended, new round: no legendary (own group), one lair action, then the PCs' turn (not auto)
  assert.deepEqual(uses.map((u) => u[0]), ["tl"]);
  assert.ok(calls.chat[0].content.includes("lair:"));
  reset();
  await onCombatTurnChange(makeCombat([pc1, pc2, g1], 1), { round: 1, turn: 2 }, { round: 1, turn: 1 }, legDeps(3)); // backwards: nothing
  assert.deepEqual([uses, calls.chat], [[], []]);
});
```

The `onCombatTurnChange` test with `turn: 2` as the new current (g1's own turn): the legendary phase (K = 2 for pc1 + pc2) runs for g1 because the ended group is the PCs' and g1 is not in it; then g1's turn.

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: `memberIds` and `runLegendary` are not functions.

- [ ] **Step 3: Implement**

`turns.js`: `memberIds` and `activeIds` as the Interfaces block. `run.js`: extract `act` into `actWith(ctx)` first (run the suite: still green, no behaviour change), then `runLegendary`, `runLair`, the `onCombatTurnChange` phases, `brief`. `main.js` setting and both lang files.

- [ ] **Step 4: Run the whole suite**

Expected: all pass, including the existing `onCombatTurnChange` test (`snaps` stays 3: the legendary phase makes no snapshot when the ended set is empty, as with `prior.turn: null`, and the lair phase of that round change makes none because the stub's actor has no lair).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/run.js scripts/turns.js scripts/main.js lang/en.json lang/es.json test/run.test.mjs test/turns.test.mjs
git commit -m "feat(autopilot): legendary actions after another group's turn, lair actions at the top of the round"
```

---

### Task 4: Docs, spec amendment and release 0.9.0

**Files:**
- Modify: `README.md`, `docs/SERVER-TESTING.md`, `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (append an amendment), `module.json`

- [ ] **Step 1: README**

In "Monster autopilot (piece 4)" a paragraph **Legendary and lair actions (piece 5).**: when they fire (end of every other group's turn, as many as that group had standing members, while the uses last; the monster's own turn refills them through dnd5e), what is picked (best value per use from where it stands, no movement), the lair action at the top of each round for a monster in its lair (modern: *Inside lair* on the sheet; legacy: lair initiative set), the whisper (`legendary: Tail Attack vs Rogue (expected 6.4; 2 uses left)`, `lair: ...`), silence when nothing scores; the setting in the settings list; under "not counted": legendary resistance (dnd5e's own prompt), mythic actions, legendary actions that move the monster, lair actions that are pure effects (the GM runs them), initiative-20 tie rules.

- [ ] **Step 2: SERVER-TESTING section 7d (piece 5, v0.9.0)**

Setup on the goblin scene, with Goblin 1 made legendary on its sheet (Plutonium's monsters with legendary actions are fine too, but the goblin keeps the numbers small): **Legendary Actions** max 3 on the sheet's resources; two new feats on Goblin 1: *Tail Attack* (activation Legendary, cost 1, attack +4, melee reach 5, damage 1d6+2) and *Wing Attack* (activation Legendary, cost 2, save DEX DC 12, half on save, 2d6, range 10 ft); the lair: legacy rules, **Lair initiative 20** on the sheet, one feat *Lair Rumble* (activation Lair, save CON DC 12, half on save, 1d6, range 60 ft). Order Cleric 20, Rogue 18, Goblin 1 15, Goblin 2 12; Goblin 2's autopilot off.
- L1. End the PCs' shared turn (next turn from the Rogue): before the goblins play, Goblin 1 uses two legendary actions (two PC turns ended) against the nearest PC: whispers `legendary: Tail Attack vs Rogue (expected ...; 2 uses left)` then `(...; 1 uses left)` (or Wing Attack when the Cleric and Rogue stand together; report which), Midi cards, legendary uses on the sheet drop to 1, then the goblins' turn plays as usual. Report the console lines (`legendary 3/3` on the board line, `Tail Attack[attack legendary x1 ...]`).
- L2. Next turn from the goblins to the PCs: nothing legendary (its own group), the uses refill to 3 on the sheet (dnd5e). Top of round 2: `lair: Lair Rumble vs ...` whisper and card before the Cleric's turn starts.
- L3. Goblin 1 with 1 use left (spend two by hand first): the PCs' turn end gives one Tail Attack, never a Wing Attack; with 0 left: silence, no error.
- L4. Goblin 1 at 0 hp or marked defeated: no legendary, no lair action. Setting **Legendary and lair actions** off: nothing, the ordinary turn unchanged.
- L5. Previous turn (back to the PCs): nothing fires.
- L6. Pause before each monster action on: the pause dialog opens for the legendary action too; Skip skips it, Take over switches the goblin off and the phase ends.
- L7. Modern rules world (dnd5e setting *Rules version: Modern*) with *Inside lair* unchecked on the sheet: no lair action; checked: one at the top of the round.

Report template: add the L lines.

- [ ] **Step 3: Spec amendment**

Append `## Amendment 2026-11-06 (piece 5, v0.9.0: legendary and lair actions)` with the Rulings section of this plan condensed: timing (group turn end, K = standing members, own group excluded), ranking (value per use within the uses left, no movement), dnd5e spends and refills the uses, lair at the top of the round for a monster in its lair (modern `inside`, legacy initiative), silence when nothing scores, the setting, the out-of-scope list.

- [ ] **Step 4: `module.json` version 0.9.0; run the whole suite; commit; tag; push; build**

```bash
git add README.md docs/SERVER-TESTING.md docs/superpowers/specs/2026-11-04-monster-autopilot-design.md module.json
git commit -m "docs(autopilot): piece 5 (legendary and lair actions), v0.9.0"
git tag v0.9.0 && git push -q origin main v0.9.0 && bash tools/release.sh
```
Never chain the commit with a heredoc and `&&` on one line (the v0.8.3 tag mishap): write the message to a file and `commit -F`. Then hand the user the one-line `gh release create v0.9.0 ...` command; the web-session text comes after the release is verified (memory rule).
