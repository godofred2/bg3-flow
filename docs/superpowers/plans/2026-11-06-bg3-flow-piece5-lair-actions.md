# BG3 Flow piece 5: lair actions on the autopilot (legendary monsters stay in the DM's hands). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the top of every round the module takes, for every monster that is in its lair, the lair action that hurts the party most (scored like any other activity, aimed anywhere in the lair, never the same one two rounds in a row), and whispers the GM what it did and which lair actions it left for the GM's hands. Monsters with legendary actions are off the autopilot by default (the DM plays them by hand); their lair still acts.

**Architecture:** Three existing files. `board.js` lets activities with activation `lair` into the snapshot (unlimited range unless the sheet gives one), and adds `me.lair` (in its lair), `me.lairLast` (the lair action used last round) and `me.lairNames` (every lair action on the sheet, for the whisper). `plan.js` scores the `lair` slot from where the monster stands. `run.js` factors the "act from here" closure out of `runTurn`, adds `runLair` on a round change (before the first group plays, under the same `running` guard), remembers the action used in a combatant flag, and makes `isAuto` false by default for a monster with legendary actions. One new world setting, `lairActions`. No legendary-action code at all.

**Tech Stack:** As 4c plus dnd5e 6.0.6 facts verified in the source at tag `release-6.0.6`: activation type `lair` (no consumption, no uses: `module/config.mjs` ~1077); `actor.system.resources.lair = { value: boolean, initiative: number|null, inside: boolean }` (the NPC sheet shows the lair block under modern rules when `lair.value`, under legacy rules when `lair.initiative`; `lair.inside` is the 2024 "inside its lair" switch, `module/applications/actor/npc-sheet.mjs` ~290); `actor.system.resources.legact.max` (legendary actions per turn, 0 when none); rules version per actor `actor.system.source?.rules` (`"2014"` / `"2024"`) else `game.settings.get("dnd5e", "rulesVersion")` (`"legacy"` / `"modern"`). dnd5e 6 creates no lair combatant and no initiative-20 turn: the module fires lair actions itself. Foundry's `combatTurnChange(combat, prior, current)` carries the rounds.

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, "Piece 5 (later): legendary and lair actions". The user narrowed it (2026-11-06): no legendary actions on the autopilot, lair actions automated "as well as possible for the biggest impact on the fight". Every rule below is a plan-level ruling written into the spec as an amendment in Task 4.

## Global Constraints

- As the 4a-4c plans: Foundry 14, dnd5e 6.0.x, Midi >= 14.6, ES modules, CRLF, `safe` wrappers, lead GM only, Midi for every roll, pure decisions in `plan.js`, TDD with `node --test`, commits with the user's identity and the Claude trailer, strings under `BG3FLOW.Settings.*` in `lang/en.json` and `lang/es.json` (whisper reasons stay plain English like `flee: ...` and `approach ...`).
- Setting (world): `lairActions` Boolean default `true`.
- Release at the end: `module.json` 0.9.0.

## Rulings (plan-level: the spec is silent on all of it)

- **Legendary monsters are the DM's.** `isAuto(c)` is false when the actor has legendary actions (`resources.legact.max > 0`) unless the combatant flag `autopilot` is explicitly `true`; the tracker's robot button sets the flag to `!isAuto(c)` (explicit `true` or `false`) so the GM can still hand such a monster to the autopilot with one click. A group with such a monster is not auto-passed (it has a manual member, as today). Nothing legendary is ever played by the module. Cost if wrong: one click on the robot button.
- **When the lair acts.** Once per round at the top of the round: `combatTurnChange` stepping forward into a new round (`current.round > prior.round`, round 1 included since Foundry fires it on combat start), before the new turn's monsters play, under the same `running` guard. RAW's "initiative count 20, losing ties" becomes "before everyone" (ponytail comment). "Previous turn" never fires it.
- **Whose lair.** Every combatant of the combat with a token on the current scene, not player-owned, not defeated, hp > 0, in its lair (`lairOf(actor)`): modern rules for the actor (`source.rules === "2024"`, or no `source.rules` and the dnd5e setting is `modern`): `lair.value && lair.inside`; legacy: `lair.initiative > 0 || lair.value`. The autopilot flag is **not** consulted: the DM plays the dragon by hand, the module plays the lair. The setting `lairActions` off disables it all.
- **Which lair action.** From where the monster stands (budget 0: no move), among its `lair` activities except the one used last round (`me.lairLast`, RAW "can't use the same effect two rounds in a row"; a round with no lair action lifts it): the best `pickTarget` value (areas aim at the enemy cluster covering the most, as today). A lair activity with no range on its sheet reaches anywhere (`range: Infinity`: the lair is the origin); a sheet range is honoured; a `self` area keeps today's rule (`area.size` around the monster). Nothing scoring (only utility or zero-damage lair actions: fog, roots, darkness): nothing is used.
- **The GM always hears the lair** at the top of the round, one whisper per lair monster: `lair: Acid Pool vs Rogue (expected 9.0); not scored: Grasping Roots` or `lair: nothing to score; by hand: Grasping Roots, Fog Cloud` (the lair actions the module cannot value, by item name, so the GM runs one by hand at initiative 20 if they want). `pickTarget` is the only scorer: conditions and terrain effects are not valued (spec: not in the score).
- **Out of scope** (README "not counted"): legendary actions (by design), legendary resistance (dnd5e's own prompt), mythic actions, lair actions that only impose conditions or shape the terrain (whispered as "by hand"), initiative-20 tie rules, regional effects.

## Review Focus

1. A lair monster whose only damaging lair action was used last round: it is skipped this round, the whisper says `nothing to score; by hand: ...`, and next round it is available again (Task 2 planner on `lairLast`, Task 3 runner clears the flag on a silent round).
2. A legendary monster (legact max 3) with no `autopilot` flag: not played on its turn, its group waits for the GM; with the flag `true`: played; its lair acts either way (Task 3).
3. A round change fired by the autopilot's own `nextTurn()` (goblins last in the order): the lair phase runs once, before the PCs' turn, and the `running` guard never blocks the next monsters' turn (Task 3).
4. A monster not in its lair (modern `inside` unchecked; legacy without initiative and `value` false): no snapshot, no whisper (Task 1 `lairOf`, Task 3 pre-filter on the actor before any snapshot).
5. A player-owned actor with a lair on its sheet (a druid's grove): never (Task 3 `hasPlayerOwner` filter).

## File structure

- Modify `scripts/ai/board.js`: `activityInfo` (`SLOTS` += `lair`, lair range), `snapshot` (`me.lair`, `me.lairLast`, `me.lairNames`), `export lairOf(actor)`.
- Modify `scripts/ai/plan.js`: `planTurn` slot `lair`.
- Modify `scripts/ai/run.js`: `isAuto`, the robot button, `actWith(ctx)` (the former `act` closure), `runLair`, `onCombatTurnChange`, `brief`.
- Modify `scripts/main.js` (one setting), `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7d, L-steps), spec amendment, `module.json` (0.9.0).
- Tests: `test/board.test.mjs`, `test/plan.test.mjs`, `test/run.test.mjs`.

Test command for every task: `cd "/c/Foundry vtt module" && timeout 120 node --test test/*.test.mjs > "$SCRATCH/t.txt" 2>&1; grep "pass \|fail \|^not ok" "$SCRATCH/t.txt"` (194 pass before Task 1; the summary lines read `ℹ pass N` / `ℹ fail N`).

---

### Task 1: Board inputs: lair activities, in its lair, last lair action, lair names

**Files:**
- Modify: `scripts/ai/board.js`
- Test: `test/board.test.mjs` (extend the `token` fixture, append tests)

**Interfaces:**
- Produces:
  - `activityInfo(activity)` accepts `activation.type === "lair"` (besides `action`, `bonus`; `legendary`, `mythic`, `reaction` stay out): `slot: "lair"`; its `range` is `Infinity` when the activity has no range value and its units are not `"self"` (`activity.range?.value == null && activity.range?.units !== "self"`), else as today (a `self` area gives `area.size`; an explicit value is kept). Everything else as today.
  - `export function lairOf(actor) -> boolean`: rules = `actor?.system?.source?.rules ?? (game.settings.get("dnd5e", "rulesVersion") === "modern" ? "2024" : "2014")`; `lair = actor?.system?.resources?.lair ?? {}`; `"2024"`: `!!(lair.value && lair.inside)`; else `lair.initiative > 0 || !!lair.value`.
  - `snapshot(...)` gains `me.lair: boolean` (`lairOf(actor)`), `me.lairLast: string | null` (`combatant.getFlag("bg3-flow", "lairLast") ?? null`), `me.lairNames: string[]` (names of the actor's items that have at least one activity with `activation.type === "lair"`, sheet order).

- [ ] **Step 1: Write the failing tests**

Extend the `token` fixture with `lair = null` and `rules = null` parameters: `doc.actor.system.resources = { lair: lair ?? { value: false, initiative: null, inside: false } }` and `doc.actor.system.source = rules ? { rules } : {}`. Let `combatantOf(doc, defeated = false, flags = {})` store `flags` under `"bg3-flow"` and answer `getFlag(m, k)` from them. The `settings` map used by `game.settings.get` in this file must answer `game.settings.get("dnd5e", "rulesVersion")`: `get: (m, k) => m === "dnd5e" ? settings.dnd5eRulesVersion : settings[k]`, default `"legacy"`. The `act` fixture already builds `range` from its `range` parameter.

```js
test("activityInfo: a lair activation is kept and reaches anywhere unless the sheet gives it a range; legendary, mythic and reactions stay out", () => {
  n = 0;
  const pool = act({ name: "Acid Pool", type: "save", activation: "lair", save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["2d8", {}]] });
  assert.deepEqual([activityInfo(pool).slot, activityInfo(pool).range, activityInfo(pool).damage], ["lair", Infinity, 9]);
  const tremor = act({ name: "Tremor", type: "save", activation: "lair", save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["2d6", {}]], range: { value: null, units: "self" }, template: "sphere", size: 60 });
  assert.deepEqual([activityInfo(tremor).range, activityInfo(tremor).area], [60, { shape: "sphere", size: 60, width: 5 }]); // a self area: as today
  const ranged = act({ name: "Rockfall", type: "save", activation: "lair", save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["3d6", {}]], range: { value: 120, units: "ft" } });
  assert.equal(activityInfo(ranged).range, 120);
  for (const type of ["legendary", "mythic", "reaction"]) assert.equal(activityInfo(act({ type: "attack", activation: type })), null, type);
});
test("snapshot: in its lair under legacy or modern rules, the lair action used last round, and every lair action's name", async () => {
  const rogue = token("rogue", { x: 400, disposition: 1 });
  const bare = token("goblin", { x: 0, disposition: -1 });
  canvas.scene.tokens.contents = [bare, rogue];
  let b = await snapshot({ combatants: [combatantOf(bare), combatantOf(rogue)] }, combatantOf(bare));
  assert.deepEqual([b.me.lair, b.me.lairLast, b.me.lairNames], [false, null, []]);
  n = 0;
  const pool = act({ name: "Acid Pool", type: "save", activation: "lair", save: { dc: 15, ability: "dex", onSave: "half" }, parts: [["2d8", {}]] });
  const roots = act({ name: "Grasping Roots", type: "utility", activation: "lair" });
  const dragon = token("dragon", { x: 0, disposition: -1, lair: { value: true, initiative: 20, inside: false }, items: [pool.item, roots.item] });
  pool.item.system.activities = [pool]; roots.item.system.activities = [roots];
  canvas.scene.tokens.contents = [dragon, rogue];
  settings.dnd5eRulesVersion = "legacy";
  b = await snapshot({ combatants: [combatantOf(dragon), combatantOf(rogue)] }, combatantOf(dragon, false, { lairLast: "A.a1" }));
  assert.deepEqual([b.me.lair, b.me.lairLast, b.me.lairNames, b.activities.map((a) => [a.name, a.slot])], [true, "A.a1", ["Acid Pool", "Grasping Roots"], [["Acid Pool", "lair"]]]); // legacy: initiative 20 means lair actions; the utility is a name only
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

Check how the `token` fixture takes `items` (the parameter exists: `oaOf` tests use it) and that `act(...).item.system.activities` is iterable the way `snapshot` walks it (`for (const a of item.system?.activities ?? [])`): the fixture's `activities: { size }` object is not iterable, hence the two assignments above. If `act()` for a `utility` type needs a parameter the fixture lacks, add it.

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL on `activityInfo(pool).slot` (null: `lair` is not in `SLOTS`) and on `b.me.lair` (undefined).

- [ ] **Step 3: Implement in `scripts/ai/board.js`**

`SLOTS = new Set(["action", "bonus", "lair"])`; in `activityInfo` the range rule for the lair slot; `lairOf` exported; in `snapshot`: `me.lair`, `me.lairLast`, `me.lairNames` (`[...(actor?.items ?? [])].filter((i) => [...(i.system?.activities ?? [])].some((a) => a.activation?.type === "lair")).map((i) => i.name)`). Update the `activityInfo` comment.

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js test/board.test.mjs
git commit -m "feat(autopilot): lair activities in the snapshot (unlimited range), in-its-lair flag, last lair action, lair names"
```

---

### Task 2: Planner: the lair slot

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Task 1): activities with `slot: "lair"`, `board.me.lairLast`, `board.me.lairNames`.
- Produces: `planTurn(board, { slot: "lair" })`:
  - candidates = activities with `slot === "lair"` and `uuid !== me.lairLast`, each scored with `pickTarget(board, a)` as the action slot does (the runner passes a budget-0 board: no move); ranked by value with the existing tie rank;
  - reason `lair: <name> vs <aim> (expected <value>)`, then `; also: <name> <value>, ...` as the action slot does when other options scored, then `; not scored: <names>` listing `me.lairNames` with no scoring option (an option "belongs" to a name when `option.name === name || option.name.startsWith(name + " (")`), including the one skipped as `lairLast`;
  - nothing scoring: `{ move: null, actions: [], reason: "lair: nothing to score; by hand: <lairNames joined by ", ">" }`, or `"lair: nothing to score"` when `lairNames` is empty;
  - the lair slot never flees and never uses Multiattack (both gated on `slot === "action"`); the bonus slot's `no bonus action` text is unchanged.

- [ ] **Step 1: Write the failing tests**

```js
const pool = { id: "ap", uuid: "A.ap", name: "Acid Pool", kind: "save", slot: "lair", range: Infinity, dc: 15, saveAbility: "dex", onSave: "half", damage: 9, affects: "creature" };
const rumble = { id: "rm", uuid: "A.rm", name: "Lair Rumble", kind: "save", slot: "lair", range: 60, dc: 12, saveAbility: "con", onSave: "half", damage: 7, affects: "creature" };
const lairBoard = (over = {}) => { const b = board({ budget: 0, enemies: [pc("rogue", 100, { ac: 13 }), pc("fighter", 30, { ac: 19 })], activities: [scimitar, pool, rumble], ...over }); b.me = { ...b.me, lair: true, lairLast: null, lairNames: ["Acid Pool", "Lair Rumble", "Grasping Roots"], ...over.me }; return b; };
test("lair slot: the best lair action from where it stands, anywhere in the lair, never the one used last round; the whisper names what was left for the GM", () => {
  let p = planTurn(lairBoard(), { slot: "lair" });
  // Acid Pool vs rogue at 100 ft (range Infinity): fail (15-1)/20 = 0.7 -> 0.7 x 9 + 0.3 x 4.5 = 7.65; vs fighter the same, the nearer one on a tie would be the fighter: the rogue has the same hp, so the fighter (30 ft) wins the tie
  assert.deepEqual([p.move, p.actions, p.reason], [null, [{ activityId: "ap", targetIds: ["fighter"], aimId: "fighter" }], "lair: Acid Pool vs fighter (expected 7.7); also: Lair Rumble 5.4; not scored: Grasping Roots"]);
  // Lair Rumble vs fighter at 30 ft (range 60): fail (12-1)/20 = 0.55 -> 0.55 x 7 + 0.45 x 3.5 = 5.425
  p = planTurn(lairBoard({ me: { lairLast: "A.ap" } }), { slot: "lair" });
  assert.equal(p.reason, "lair: Lair Rumble vs fighter (expected 5.4); not scored: Acid Pool, Grasping Roots"); // used last round: skipped, and told
  p = planTurn(lairBoard({ activities: [scimitar, pool], me: { lairLast: "A.ap", lairNames: ["Acid Pool", "Grasping Roots"] } }), { slot: "lair" });
  assert.deepEqual(p, { move: null, actions: [], reason: "lair: nothing to score; by hand: Acid Pool, Grasping Roots" });
  assert.deepEqual(planTurn(lairBoard({ activities: [scimitar], me: { lairNames: [] } }), { slot: "lair" }), { move: null, actions: [], reason: "lair: nothing to score" });
  assert.equal(planTurn(lairBoard(), { slot: "action" }).reason.startsWith("Scimitar vs"), true); // the action slot never sees the lair ones
  assert.equal(planTurn(lairBoard(), { slot: "bonus" }).reason, "no bonus action");
});
```

If the tie between the rogue and the fighter resolves the other way in `pickTarget` (same value, same hp: the nearer wins), or `expectedValue` rounds differently, correct the expected target and numbers to what the scorer yields and note the arithmetic in the comment (the planner is the reference; the test pins the slot's wording, the `lairLast` skip and the `not scored` / `by hand` lists).

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: the lair slot result has reason `no bonus action` (today every non-action slot ends there).

- [ ] **Step 3: Implement in `scripts/ai/plan.js`**

In `planTurn`: for `slot === "lair"` filter out `me.lairLast`; build the reason with the `lair: ` prefix and the `not scored` suffix; the empty result per slot (`no bonus action` / `lair: nothing to score...`).

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): lair slot in the planner (best lair action, not the last round's, GM told what is left by hand)"
```

---

### Task 3: Execution: the lair phase at the top of the round, legendary monsters off by default

**Files:**
- Modify: `scripts/ai/run.js`, `scripts/main.js`, `lang/en.json`, `lang/es.json`
- Test: `test/run.test.mjs` (append)

**Interfaces:**
- Consumes (Tasks 1-2): `lairOf(actor)` from `board.js`, `planTurn(board, { slot: "lair" })`, `board.me.lair`.
- Produces (`run.js`):
  - `isAuto(c)`: `flag === true` → true; `flag === false` → false; otherwise `!c.actor?.hasPlayerOwner && !((c.actor?.system?.resources?.legact?.max ?? 0) > 0)`. The robot button's click: `c.setFlag(MODULE_ID, "autopilot", !isAuto(c))`.
  - `actWith({ combat, reserved, stale, snap, pick, use, pause })` returns the former `act(c, board, p, said)` closure unchanged in behaviour (`true` done, `false` the GM took over, `null` stale); `runTurn` builds it with its own deps and keeps its `clean` bookkeeping outside.
  - `export async function runLair(combat, deps)`: when `game.settings.get(MODULE_ID, "lairActions") === false` return; for each `c` of `combat.turns` in order with `c.token` on the current scene, `!c.actor?.hasPlayerOwner`, `!c.isDefeated`, `(c.actor?.system?.attributes?.hp?.value ?? 0) > 0`, `lairOf(c.actor)` (all read from the actor before any snapshot): `board = await snap(combat, c, new Set())`; `still = { ...board, me: { ...board.me, budget: 0 } }`; `p = plan(still, { slot: "lair" })`; no actions: `whisper(Autopilot.Decision with p.reason)` and `c.unsetFlag(MODULE_ID, "lairLast")` if set; else `r = await act(c, still, p)` (whispers the reason, runs the use): `null` returns from the phase, `false` continues with the next monster, `true` sets `lairLast` to `p.actions[0].activityId` (the activity uuid). Errors per monster go through the same `failed()` whisper as `runTurn`. Stale = `game.combat` changed id, round or turn since the phase began. `deps` takes the same keys as `runTurn` (`snap`, `plan`, `pick`, `use`, `pause`).
  - `onCombatTurnChange(combat, prior, current, deps)`: after the existing lead-GM, started, `running` and direction checks: when `r1 > r0`: `running = true; try { await runLair(combat, deps); } finally { running = false; }`; then `await runTurn(combat, deps)` as today.
  - `brief(board)` adds ` lair` after `alone` when `me.lair` (and ` lair-last` when `me.lairLast`), and ` lair` in an activity's slot bracket (where `bonus` is shown today); lair names are not repeated there (the whisper carries them).
  - `main.js`: `reg("lairActions", Boolean, true)`; `lang`: `Settings.lairActions.{name, hint}` (en: "Lair actions" / "At the top of every round, a monster in its lair takes the lair action that hurts the party most; the GM is told which lair actions were left for their hands. Monsters with legendary actions are off the autopilot unless switched on."; es: "Acciones de guarida" / "Al inicio de cada ronda, un monstruo en su guarida usa la acción de guarida que más daño hace al grupo; el DM recibe aviso de las que quedan en sus manos. Los monstruos con acciones legendarias quedan fuera del piloto salvo que se activen.").

- [ ] **Step 1: Write the failing tests**

In `test/run.test.mjs` (import `runLair`; the `settings` map gains `lairActions: true`, reset in `reset()`; `game.settings.get("dnd5e", "rulesVersion")` keeps returning `undefined`, which `lairOf` reads as legacy rules; the `combatant` fixture's actor is a plain object, so a test may set `c.actor.system`):

```js
const lairPlan = { move: null, actions: [{ activityId: "A.ap", targetIds: ["rogue"], aimId: "rogue" }], reason: "lair: Acid Pool vs rogue (expected 7.7); not scored: Grasping Roots" };
const lairNone = { move: null, actions: [], reason: "lair: nothing to score; by hand: Acid Pool, Grasping Roots" };
const ap = { id: "A.ap", uuid: "A.ap", name: "Acid Pool", kind: "save", slot: "lair", range: Infinity, dc: 15, saveAbility: "dex", onSave: "half", damage: 9, affects: "creature" };
// A sheet with a legacy lair (initiative 20) and, optionally, legendary actions; hp as given.
const sheet = (c, { lair = true, legact = 0, hp = 7 } = {}) => { c.actor.system = { attributes: { hp: { value: hp, max: 7 } }, resources: { lair: { value: lair, initiative: lair ? 20 : null, inside: false }, legact: { max: legact, spent: 0, value: legact } } }; return c; };
function lairDeps() {
  const d = deps({ plans: {} });
  d.snap = async (combat, c) => ({ ...boardFor(c, [enemy("rogue")]), activities: [sc, ap], me: { ...boardFor(c, []).me, lair: true, lairLast: c.getFlag("bg3-flow", "lairLast") ?? null, lairNames: ["Acid Pool", "Grasping Roots"] } });
  d.plan = (board, opts) => opts?.slot === "lair" ? (board.me.lairLast === "A.ap" ? lairNone : lairPlan) : emptyPlan;
  return d;
}
test("isAuto: a monster with legendary actions is the DM's unless the flag says true; the robot button sets the flag to the opposite of isAuto", () => {
  const g = sheet(combatant("g"), { legact: 3 });
  assert.equal(isAuto(g), false);
  g.flags["bg3-flow"].autopilot = true;
  assert.equal(isAuto(g), true);
  assert.equal(isAuto(sheet(combatant("plain"))), true);
});
test("runLair: at the top of the round every monster in its lair takes its best lair action from where it stands, remembers it, skips it next round and tells the GM; no flag, no uses, no movement", async () => {
  reset();
  const g1 = sheet(combatant("g1", { auto: false })), g2 = sheet(combatant("g2"), { lair: false }), pc = combatant("pc", { disposition: 1, playerOwner: true });
  const combat = makeCombat([pc, g1, g2], 0);
  let snaps = 0; const d = lairDeps(); const snap = d.snap; d.snap = async (...a) => { snaps++; return snap(...a); };
  await runLair(combat, d);
  assert.deepEqual([uses, moves, snaps, g1.flags["bg3-flow"].lairLast], [[["A.ap", "T.rogue"]], [], 1, "A.ap"]); // g1 (autopilot off!) acted; g2 has no lair: not even a snapshot
  assert.deepEqual(calls.chat.map((m) => [m.whisper, m.content.includes("lair: Acid Pool")]), [[["gm"], true]]);
  reset();
  await runLair(combat, lairDeps()); // next round: Acid Pool was last round's
  assert.deepEqual([uses, calls.chat.map((m) => m.content.includes("by hand: Acid Pool, Grasping Roots")), g1.flags["bg3-flow"].lairLast], [[], [true], undefined]);
  reset();
  await runLair(combat, lairDeps()); // the round after: available again
  assert.equal(uses.length, 1);
  reset();
  sheet(g1, { hp: 0 });
  await runLair(combat, lairDeps());
  assert.deepEqual([uses, calls.chat], [[], []]); // dead dragon, quiet lair
  sheet(g1);
  reset(); settings.lairActions = false;
  await runLair(combat, lairDeps());
  assert.deepEqual([uses, calls.chat], [[], []]);
  reset();
  const druid = sheet(combatant("druid", { disposition: 1, playerOwner: true }));
  await runLair(makeCombat([druid], 0), lairDeps());
  assert.deepEqual(uses, []); // a player's lair is the player's
});
test("onCombatTurnChange runs the lair phase on a new round before the new turn, never on a turn step or backwards, under one running guard", async () => {
  reset();
  const g1 = sheet(combatant("g1")), pc1 = combatant("pc1", { disposition: 1, playerOwner: true });
  const seen = [];
  const d = lairDeps(); const plan = d.plan; d.plan = (b, o) => { seen.push(o?.slot ?? "action"); return plan(b, o); };
  const c1 = makeCombat([pc1, g1], 1);
  await onCombatTurnChange(c1, { round: 1, turn: 0 }, { round: 1, turn: 1 }, d); // a turn step inside the round: no lair, g1's turn plays
  assert.deepEqual([seen.includes("lair"), uses.length, c1.nextTurns], [false, 0, 1]);
  seen.length = 0; reset();
  const c2 = makeCombat([pc1, g1], 0);
  await onCombatTurnChange(c2, { round: 1, turn: 1 }, { round: 2, turn: 0 }, d); // new round: the lair acts, then the PCs' turn (not auto)
  assert.deepEqual([seen[0], uses.map((u) => u[0]), calls.chat[0].content.includes("lair:")], ["lair", ["A.ap"], true]);
  reset();
  await onCombatTurnChange(makeCombat([pc1, g1], 1), { round: 2, turn: 0 }, { round: 1, turn: 1 }, lairDeps()); // backwards: nothing
  assert.deepEqual([uses, calls.chat], [[], []]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: `isAuto` of the legendary goblin is `true`; `runLair` is not a function.

- [ ] **Step 3: Implement**

`run.js`: `isAuto` and the button first (run the suite: green); extract `act` into `actWith(ctx)` (suite still green, no behaviour change); then `runLair`, the `onCombatTurnChange` phase, `brief`. `main.js` setting and both lang files.

- [ ] **Step 4: Run the whole suite**

Expected: all pass, including the existing `onCombatTurnChange` test (`snaps` stays 3: its stub actor has no lair, so the round-1 lair phase makes no snapshot) and the existing `isAuto` test (its stubs have no `system`).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/run.js scripts/main.js lang/en.json lang/es.json test/run.test.mjs
git commit -m "feat(autopilot): lair actions at the top of the round (best one, not twice in a row, GM told the rest); legendary monsters off the autopilot by default"
```

---

### Task 4: Docs, spec amendment and release 0.9.0

**Files:**
- Modify: `README.md`, `docs/SERVER-TESTING.md`, `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (append an amendment), `module.json`

- [ ] **Step 1: README**

In "Monster autopilot (piece 4)" a paragraph **Lair actions (piece 5).**: at the top of every round, a monster in its lair (2024 rules: *Inside lair* on the sheet; 2014: lair initiative set) takes the lair action that scores most (damage and save activities with activation *Lair*, aimed anywhere in the lair, areas at the biggest cluster), never the same one two rounds in a row; the GM whisper (`lair: Acid Pool vs Rogue (expected 9.0); not scored: Grasping Roots` / `lair: nothing to score; by hand: ...`) names what the module cannot value so the GM runs it by hand at initiative 20; the lair acts whether or not the monster is on the autopilot. **Legendary monsters**: a monster with legendary actions is off the autopilot by default (the robot button turns it on); the module never takes legendary actions. The setting in the settings list; under "not counted": legendary actions and resistances, mythic actions, lair actions that only impose conditions or shape the terrain, initiative-20 ties, regional effects.

- [ ] **Step 2: SERVER-TESTING section 7d (piece 5, v0.9.0)**

Setup on the goblin scene, Goblin 1 given a lair on its sheet (legacy rules world: **Lair initiative 20** in the sheet's resources) and two feats: *Acid Pool* (activation Lair, save DEX DC 15, half on save, 2d8, no range) and *Grasping Roots* (activation Lair, utility, no damage). Order Cleric 20, Rogue 18, Goblin 1 15, Goblin 2 12.
- L1. Start the combat: before the Cleric's turn, the whisper `lair: Acid Pool vs <nearest PC> (expected ...); not scored: Grasping Roots`, the Acid Pool save card from Midi on that PC, no token moves. Report the console line (`lair` on the board line, `Acid Pool[save lair rInfinity ...]`).
- L2. Round 2 top (next turn past Goblin 2): `lair: nothing to score; by hand: Acid Pool, Grasping Roots` (Acid Pool was last round's), no card. Round 3 top: Acid Pool again.
- L3. Goblin 1's autopilot off (robot button): its turn waits for the GM, the lair still acts at the top of the round.
- L4. Goblin 2 with **Legendary Actions** 3 on its sheet: its robot button shows off by default and the goblins' turn is not auto-passed; click the button: it plays; click again: off.
- L5. Goblin 1 at 0 hp or marked defeated: no lair action, no whisper. Setting **Lair actions** off: nothing at the top of the round.
- L6. Previous turn across a round boundary (back from round 2 to round 1): nothing fires.
- L7. Pause before each monster action on: the pause dialog opens for the lair action; Skip skips it (whisper already sent), Take over is honoured.
- L8. Modern rules world (dnd5e setting *Rules version: Modern*) with *Inside lair* unchecked on the sheet: no lair action and no whisper; checked: as L1.

Report template: add the L lines.

- [ ] **Step 3: Spec amendment**

Append `## Amendment 2026-11-06 (piece 5, v0.9.0: lair actions; legendary monsters stay the DM's)` with the Rulings section of this plan condensed: user decision (no legendary actions on the autopilot, legendary monsters off by default, the robot button overrides), the lair phase at the top of the round for every monster in its lair regardless of the flag, the best lair action from where it stands with unlimited range unless the sheet says otherwise, not twice in a row, the whisper with the by-hand list, the setting, the out-of-scope list.

- [ ] **Step 4: `module.json` version 0.9.0; run the whole suite; commit; tag; push; build**

```bash
git add README.md docs/SERVER-TESTING.md docs/superpowers/specs/2026-11-04-monster-autopilot-design.md module.json
git commit -F "$SCRATCH/msg.txt"
git tag v0.9.0 && git push -q origin main v0.9.0 && bash tools/release.sh
```
Write the commit message to a file first and never chain a heredoc commit with `&&` on one line (the v0.8.3 tag mishap). Then hand the user the one-line `gh release create v0.9.0 ...` command; the web-session text comes after the release is verified (memory rule).
