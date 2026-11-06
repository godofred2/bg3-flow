# BG3 Flow piece 5: lair actions on the autopilot (legendary monsters stay in the DM's hands). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the top of every round the module takes, for every monster that is in its lair, the lair action that hurts the party most (scored like any other activity, aimed anywhere in the lair, never the same one two rounds in a row): damage by expected damage, conditions by the damage they deny, aimed at the most dangerous PCs. It whispers the GM what it did and which lair actions it left for the GM's hands. Monsters with legendary actions are off the autopilot by default (the DM plays them by hand); their lair still acts. Plus one table house rule, outside the autopilot: an enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength attacks.

**Architecture:** Three existing files and one new one. `board.js` lets activities with activation `lair` into the snapshot (unlimited range unless the sheet gives one), adds `me.lair` (in its lair), `me.lairLast` (the lair action used last round), `me.lairNames` (every lair action on the sheet, for the whisper), per enemy a `threat` (its best damage and healing per turn against the monster) and per activity a `denial` (the share of a turn its condition takes away, from the statuses of its effects). `plan.js` scores the `lair` slot from where the monster stands, valuing a condition-only save as `threat × fail chance × denial` through a `deny` kind of `expectedValue`, so the existing target and area picking aims it at the most dangerous PCs. `run.js` factors the "act from here" closure out of `runTurn`, adds `runLair` on a round change (before the first group plays, under the same `running` guard), remembers the action used in a combatant flag, and makes `isAuto` false by default for a monster with legendary actions. `houserules.js` rewrites an Enlarge effect's 1d4 damage bonus into a conditional Strength bonus when the effect is created (dnd5e 6's rule conditions do the rest at roll time). Two new world settings, `lairActions` and `enlargeStrength`. No legendary-action code at all.

**Tech Stack:** As 4c plus dnd5e 6.0.6 facts verified in the source at tag `release-6.0.6`: activation type `lair` (no consumption, no uses: `module/config.mjs` ~1077); an activity's applied effects `activity.effects[].effect` (ActiveEffect, core `statuses: Set<string>`); damage rolls carry `rollData.roll.ability` (`"str"`, `"dex"`, ...: `module/data/activity/attack-data.mjs` `getRollData`, used by `getDamageConfig`) and every effect change (`effect.system.changes[]`: `key`, `value`, `type: "add"`, `phase`, `conditions`) may carry `conditions`, a JSON string of dnd5e's `Filter` (`[{ "k": "roll.ability", "v": "str", "o": "exact" }]` = AND of checks; `{ "o": "NOT", "v": { "k": ..., "v": ... } }` negates; `module/filter.mjs`, `module/data/fields/filters-field.mjs`, `module/documents/applied-rules.mjs` `filterWith`); the SRD *Enlarged* effect adds `1d4` through `system.rolls.damage.mwak.bonus` and `...rwak.bonus` (2024 pack) or the legacy keys `system.bonuses.mwak.damage` / `...rwak.damage` (2014 pack and most third-party automations), which dnd5e maps onto the new ones (`module/data/actor/templates/common.mjs` `#BONUS_FIELD_PATHS`); Foundry `preCreateActiveEffect(effect, data, options, userId)` runs on the creating client, where `effect.updateSource({...})` is allowed; `actor.system.resources.lair = { value: boolean, initiative: number|null, inside: boolean }` (the NPC sheet shows the lair block under modern rules when `lair.value`, under legacy rules when `lair.initiative`; `lair.inside` is the 2024 "inside its lair" switch, `module/applications/actor/npc-sheet.mjs` ~290); `actor.system.resources.legact.max` (legendary actions per turn, 0 when none); rules version per actor `actor.system.source?.rules` (`"2014"` / `"2024"`) else `game.settings.get("dnd5e", "rulesVersion")` (`"legacy"` / `"modern"`). dnd5e 6 creates no lair combatant and no initiative-20 turn: the module fires lair actions itself. Foundry's `combatTurnChange(combat, prior, current)` carries the rounds.

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, "Piece 5 (later): legendary and lair actions". The user narrowed it (2026-11-06): no legendary actions on the autopilot, lair actions automated "as well as possible for the biggest impact on the fight". Every rule below is a plan-level ruling written into the spec as an amendment in Task 4.

## Global Constraints

- As the 4a-4c plans: Foundry 14, dnd5e 6.0.x, Midi >= 14.6, ES modules, CRLF, `safe` wrappers, lead GM only, Midi for every roll, pure decisions in `plan.js`, TDD with `node --test`, commits with the user's identity and the Claude trailer, strings under `BG3FLOW.Settings.*` in `lang/en.json` and `lang/es.json` (whisper reasons stay plain English like `flee: ...` and `approach ...`).
- Settings (world): `lairActions` Boolean default `true`; `enlargeStrength` Boolean default `true`.
- Release at the end: `module.json` 0.9.0.

## Rulings (plan-level: the spec is silent on all of it)

- **Legendary monsters are the DM's.** `isAuto(c)` is false when the actor has legendary actions (`resources.legact.max > 0`) unless the combatant flag `autopilot` is explicitly `true`; the tracker's robot button sets the flag to `!isAuto(c)` (explicit `true` or `false`) so the GM can still hand such a monster to the autopilot with one click. A group with such a monster is not auto-passed (it has a manual member, as today). Nothing legendary is ever played by the module. Cost if wrong: one click on the robot button.
- **When the lair acts.** Once per round at the top of the round: `combatTurnChange` stepping forward into a new round (`current.round > prior.round`, round 1 included since Foundry fires it on combat start), before the new turn's monsters play, under the same `running` guard. RAW's "initiative count 20, losing ties" becomes "before everyone" (ponytail comment). "Previous turn" never fires it.
- **Whose lair.** Every combatant of the combat with a token on the current scene, not player-owned, not defeated, hp > 0, in its lair (`lairOf(actor)`): modern rules for the actor (`source.rules === "2024"`, or no `source.rules` and the dnd5e setting is `modern`): `lair.value && lair.inside`; legacy: `lair.initiative > 0 || lair.value`. The autopilot flag is **not** consulted: the DM plays the dragon by hand, the module plays the lair. The setting `lairActions` off disables it all.
- **Which lair action.** From where the monster stands (budget 0: no move), among its `lair` activities except the one used last round (`me.lairLast`, RAW "can't use the same effect two rounds in a row"; a round with no lair action lifts it): the best `pickTarget` value (areas aim at the enemy cluster covering the most, as today). A lair activity with no range on its sheet reaches anywhere (`range: Infinity`: the lair is the origin); a sheet range is honoured; a `self` area keeps today's rule (`area.size` around the monster). Nothing scoring (only utility or zero-damage lair actions: fog, roots, darkness): nothing is used.
- **How dangerous each PC is** (`enemy.threat`, user request, lair only): the damage it deals per turn against this monster, the best of its action-slot activities as `activityInfo` sees them (attack: hit chance against the monster's AC × average damage; save: the monster's fail chance × damage; an area counts as one target), times 2 when the actor has an item named *Extra Attack*, plus the best healing of any slot (a healer's turn is worth its heal). Spell slots and uses are honoured by `activityInfo`; cantrip scaling is whatever the sheet's damage formula gives; resistances, monk flurries and control spells without a save are not counted. Cost if wrong: a lair action aimed at the second most dangerous PC.
- **Condition lair actions are valued by the damage they deny**: a `save` activity with no damage scores `threat × fail chance × denial` per target (areas sum over the covered), where `denial` is the share of a turn the condition takes away, from the statuses of the activity's effects: `paralyzed`, `stunned`, `incapacitated`, `unconscious`, `petrified` = 1; `restrained`, `blinded`, `frightened`, `poisoned`, `prone` = 0.5; `grappled`, `deafened` = 0.1 (the highest when several); an activity with a save, no damage and no status (Plutonium often imports the text only) gets 0.5. A pure utility (no save) is still "by hand". This `deny` scoring exists only in the lair slot: the action and bonus slots keep scoring such activities 0 (spec: conditions are not in the score). The whisper says `lair: Grasping Roots vs Fighter (denies 4.9)`. Cost if wrong: a condition cast on a cluster of weak PCs instead of a damaging action on one.
- **The GM always hears the lair** at the top of the round, one whisper per lair monster: `lair: Acid Pool vs Rogue (expected 9.0); also: Grasping Roots 4.9; not scored: Fog Cloud` or `lair: nothing to score; by hand: Grasping Roots, Fog Cloud` (the lair actions the module cannot value, by item name, so the GM runs one by hand at initiative 20 if they want).
- **Enlarge house rule** (user request, outside the autopilot): an enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength attacks; other attacks keep the 1d4. Implemented as data, at the moment the effect appears: `preCreateActiveEffect` on an effect whose name contains `enlarge` or `agrand` (case-insensitive) with a change `system.bonuses.mwak.damage` / `system.rolls.damage.mwak.bonus` (or the `rwak` pair, for thrown weapons) whose value is `1d4` (optional `+`, spaces) rewrites that change into two: `@abilities.str.mod` with the condition `[{ "k": "roll.ability", "v": "str", "o": "exact" }]` and `1d4` with `[{ "o": "NOT", "v": { "k": "roll.ability", "v": "str", "o": "exact" } }]`, keys in the new form. dnd5e applies the right one at each damage roll on every client, Midi included. An effect edited after creation, or one carrying its 1d4 some other way (a macro, a Midi flag), is left alone and noted in the README. Setting `enlargeStrength`. Cost if wrong: an effect the GM edits by hand once.
- **Out of scope** (README "not counted"): legendary actions (by design), legendary resistance (dnd5e's own prompt), mythic actions, lair actions that are pure utility (no save: whispered as "by hand"), initiative-20 tie rules, regional effects, threat in the ordinary turn's targeting (user decision: lair only).

## Review Focus

1. A lair monster whose only damaging lair action was used last round: it is skipped this round, the whisper says `nothing to score; by hand: ...`, and next round it is available again (Task 2 planner on `lairLast`, Task 4 runner clears the flag on a silent round).
2. A legendary monster (legact max 3) with no `autopilot` flag: not played on its turn, its group waits for the GM; with the flag `true`: played; its lair acts either way (Task 4).
3. A round change fired by the autopilot's own `nextTurn()` (goblins last in the order): the lair phase runs once, before the PCs' turn, and the `running` guard never blocks the next monsters' turn (Task 4).
4. A monster not in its lair (modern `inside` unchecked; legacy without initiative and `value` false): no snapshot, no whisper (Task 1 `lairOf`, Task 4 pre-filter on the actor before any snapshot).
5. A player-owned actor with a lair on its sheet (a druid's grove): never (Task 4 `hasPlayerOwner` filter).
6. A condition lair action against a party with one dangerous PC far away and two weak ones together: the single-target save goes to the dangerous one, the area to wherever `threat` adds up most; a PC with no activities (`threat` 0) is never the aim of a condition (Task 3).
7. An effect with a 1d4 bonus that is not Enlarge (*Favored Foe*, a magic item), or an Enlarge effect whose bonus is `1d6` or already conditional: untouched (Task 5).

## File structure

- Modify `scripts/ai/board.js`: `activityInfo` (`SLOTS` += `lair`, lair range, `denial`), `snapshot` (`me.lair`, `me.lairLast`, `me.lairNames`, `enemy.threat`), `export lairOf(actor)`, `threatOf(actor, me)`.
- Modify `scripts/ai/plan.js`: `expectedValue` kind `deny`, `planTurn` slot `lair`.
- Modify `scripts/ai/run.js`: `isAuto`, the robot button, `actWith(ctx)` (the former `act` closure), `runLair`, `onCombatTurnChange`, `brief`.
- Create `scripts/houserules.js`: `enlargeChanges(name, changes)`, `registerHouseRules()`.
- Modify `scripts/main.js` (two settings, `registerHouseRules` on `ready`), `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7d, L-steps and E-steps), spec amendment, `module.json` (0.9.0).
- Tests: `test/board.test.mjs`, `test/plan.test.mjs`, `test/run.test.mjs`, `test/houserules.test.mjs` (new).

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
  assert.equal(planTurn(lairBoard(), { slot: "action" }).reason, "approach fighter"); // the action slot never sees the lair ones (budget 0, nobody in Scimitar reach: approach)
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

### Task 3: How dangerous each PC is, and conditions valued by the damage they deny (lair only)

**Files:**
- Modify: `scripts/ai/board.js`, `scripts/ai/plan.js`
- Test: `test/board.test.mjs`, `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Tasks 1-2): the lair slot, `lairBoard` fixture, `pool` fixture.
- Produces:
  - `board.js`: `activityInfo` gains `denial: number` when the activity's effects carry a known status (`activity.effects[].effect.statuses`): the highest of `DENIAL = { paralyzed: 1, stunned: 1, incapacitated: 1, unconscious: 1, petrified: 1, restrained: 0.5, blinded: 0.5, frightened: 0.5, poisoned: 0.5, prone: 0.5, grappled: 0.1, deafened: 0.1 }`; no key otherwise. `threatOf(actor, me) -> number` (module-private, tested through `snapshot`): over every activity of the actor's items with a non-null `activityInfo`: `damage = max(expectedValue(info, me))` over `slot === "action"` activities of kind attack, save or damage (`me` gives `ac` and `saves`), `× 2` when the actor has an item named `Extra Attack` (case-insensitive, trimmed); `heal = max(info.healing)` over any slot; returns `damage + heal`. `snapshot` gives every enemy `threat: threatOf(t.actor, me)`.
  - `plan.js`: `expectedValue` kind `"deny"`: `failChance({ dc: activity.dc ?? 10, bonus: target.saves?.[activity.saveAbility] ?? 0 }) * (activity.denial ?? 0.5) * (target.threat ?? 0)`. In `planTurn` for `slot === "lair"` only, a candidate of kind `save` with no damage (`!(a.damage > 0)`) is scored as `{ ...a, kind: "deny" }`; the winner's reason reads `(denies X)` instead of `(expected X)` when its kind is `deny`; the `also` list is unchanged (names and values). The action and bonus slots do not use `deny` (such activities keep scoring 0 there, as today).

- [ ] **Step 1: Write the failing tests**

Extend the `act` fixture with `effects = []` written into the activity as `effects` (an array of `{ effect: { statuses: Set } }`). In `test/board.test.mjs`:

```js
test("activityInfo: the share of a turn a condition denies, from the statuses of the activity's effects", () => {
  n = 0;
  const eff = (...statuses) => ({ effect: { statuses: new Set(statuses) } });
  assert.equal(activityInfo(act({ type: "save", activation: "lair", save: { dc: 15, ability: "dex" }, effects: [eff("restrained")] })).denial, 0.5);
  assert.equal(activityInfo(act({ type: "save", activation: "lair", save: { dc: 15, ability: "wis" }, effects: [eff("frightened"), eff("paralyzed")] })).denial, 1);
  assert.equal(activityInfo(act({ type: "save", activation: "lair", save: { dc: 15, ability: "str" }, effects: [eff("grappled")] })).denial, 0.1);
  assert.equal("denial" in activityInfo(act({ type: "save", activation: "lair", save: { dc: 15, ability: "dex" } })), false); // no effect: the planner's default applies
  assert.equal("denial" in activityInfo(act({ type: "attack" })), false);
});
test("snapshot: each enemy's threat is its best damage per turn against the monster (Extra Attack doubles it) plus its best heal", async () => {
  n = 0;
  const longsword = act({ name: "Longsword", type: "attack", toHit: "+5", parts: [["1d8 + 3", {}]], item: { type: "weapon", range: { reach: 5 } } });
  const extra = { name: "Extra Attack", type: "feat", system: { activities: [] } };
  longsword.item.system.activities = [longsword];
  const fighter = token("fighter", { x: 100, disposition: 1, items: [longsword.item, extra] });
  const cure = act({ name: "Cure Wounds", type: "heal", parts: [["1d8 + 3", {}]], spell: { level: 1, slots: 2 } });
  const bolt = act({ name: "Guiding Bolt", type: "attack", toHit: "+5", parts: [["4d6", {}]], spell: { level: 1, slots: 2 }, attackType: "ranged" });
  cure.item.system.activities = [cure]; bolt.item.system.activities = [bolt];
  const cleric = token("cleric", { x: 200, disposition: 1, items: [cure.item, bolt.item] });
  const goblin = token("goblin", { x: 0, disposition: -1, ac: 15 });
  canvas.scene.tokens.contents = [goblin, fighter, cleric];
  const b = await snapshot({ combatants: [goblin, fighter, cleric].map((t) => combatantOf(t)) }, combatantOf(goblin));
  // Longsword vs AC 15: (21+5-15)/20 = 0.55 x 7.5 = 4.125, x2 for Extra Attack = 8.25; Guiding Bolt 0.55 x 14 = 7.7 + Cure Wounds 7.5 = 15.2
  assert.deepEqual(b.enemies.map((e) => [e.id, Number(e.threat.toFixed(2))]), [["fighter", 8.25], ["cleric", 15.2]]);
});
```

In `test/plan.test.mjs`:

```js
const roots = { id: "gr", uuid: "A.gr", name: "Grasping Roots", kind: "save", slot: "lair", range: Infinity, dc: 15, saveAbility: "dex", damage: 0, affects: "creature", denial: 0.5 };
const threat = (p, t) => ({ ...p, threat: t });
test("lair slot: a condition is worth the damage it denies, aimed at the most dangerous PC; half a turn when the sheet names no status; never in the action slot", () => {
  const b = lairBoard({ activities: [scimitar, roots], enemies: [threat(pc("rogue", 100, { ac: 13 }), 12), threat(pc("fighter", 30, { ac: 19 }), 14), threat(pc("wizard", 60), 0)], me: { lairNames: ["Grasping Roots"] } });
  let p = planTurn(b, { slot: "lair" });
  // fighter: fail (15-1-0)/20 = 0.7 x 0.5 x 14 = 4.9; rogue 0.7 x 0.5 x 12 = 4.2; wizard 0
  assert.deepEqual([p.actions, p.reason], [[{ activityId: "gr", targetIds: ["fighter"], aimId: "fighter" }], "lair: Grasping Roots vs fighter (denies 4.9)"]);
  p = planTurn(lairBoard({ activities: [scimitar, { ...roots, denial: undefined }], enemies: [threat(pc("rogue", 100, { ac: 13 }), 12)], me: { lairNames: ["Grasping Roots"] } }), { slot: "lair" });
  assert.equal(p.reason, "lair: Grasping Roots vs rogue (denies 4.2)"); // no status on the sheet: half a turn
  p = planTurn(lairBoard({ activities: [pool, roots], enemies: [threat(pc("rogue", 100, { ac: 13 }), 20)], me: { lairNames: ["Acid Pool", "Grasping Roots"] } }), { slot: "lair" });
  assert.equal(p.reason, "lair: Acid Pool vs rogue (expected 7.7); also: Grasping Roots 7.0"); // 0.7 x 0.5 x 20 = 7.0 loses to 7.65
  assert.equal(planTurn(b, { slot: "action" }).reason, "approach fighter"); // the action slot never values a condition
});
```

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: `denial` undefined on the restrained save; `e.threat` undefined; the lair plan with `roots` only is `nothing to score`.

- [ ] **Step 3: Implement**

`board.js`: `DENIAL`, the `denial` key in `activityInfo`, `threatOf` (import `expectedValue` from `plan.js` next to `averageOf`, `hitChance`), `threat` on each enemy in `snapshot`. `plan.js`: the `deny` case of `expectedValue`, the candidate mapping and the `denies` wording in the lair branch of `planTurn`. `brief` (run.js) adds ` threat${e.threat.toFixed(1)}` to each enemy bracket (Task 4 touches `brief` too; do it here).

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js scripts/ai/plan.js scripts/ai/run.js test/board.test.mjs test/plan.test.mjs
git commit -m "feat(autopilot): each PC's threat; lair conditions valued by the damage they deny, aimed at the most dangerous PC"
```

---

### Task 4: Execution: the lair phase at the top of the round, legendary monsters off by default

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

### Task 5: Enlarge house rule: the Strength modifier twice instead of the 1d4 on Strength attacks

**Files:**
- Create: `scripts/houserules.js`
- Modify: `scripts/main.js`, `lang/en.json`, `lang/es.json`
- Test: `test/houserules.test.mjs` (new; set up the globals the way `test/prompts.test.mjs` does before importing, since `houserules.js` imports `main.js`)

**Interfaces:**
- Produces:
  - `export function enlargeChanges(name, changes) -> object[] | null` (pure): `null` unless `/enlarge|agrand/i.test(name)` and at least one change whose `key` is one of `system.bonuses.mwak.damage`, `system.rolls.damage.mwak.bonus`, `system.bonuses.rwak.damage`, `system.rolls.damage.rwak.bonus`, whose `value` matches `/^\+?\s*1d4\s*$/` and whose `conditions` is empty (`undefined`, `""`, `"{}"` or `"[]"`). The result is a new array in the same order where each such change becomes two, both with the key in its new form (`system.rolls.damage.<mwak|rwak>.bonus`), `_id` dropped, every other field kept: `{ ..., value: "@abilities.str.mod", conditions: JSON.stringify([{ k: "roll.ability", v: "str", o: "exact" }]) }` then `{ ..., value: "1d4", conditions: JSON.stringify([{ o: "NOT", v: { k: "roll.ability", v: "str", o: "exact" } }]) }`; other changes are copied as they are.
  - `export function registerHouseRules()`: `Hooks.on("preCreateActiveEffect", safeSync((effect) => { if (game.settings.get(MODULE_ID, "enlargeStrength") === false) return; const src = effect.toObject(); const changes = enlargeChanges(src.name, src.system?.changes ?? []); if (changes) effect.updateSource({ "system.changes": changes }); }))`. (`toObject()` gives the source form: `conditions` as a string, not dnd5e's `Filter` instance.)
  - `main.js`: `reg("enlargeStrength", Boolean, true)`; `registerHouseRules()` on `ready`, independent of `enableAutopilot`; the console line `[bg3-flow] house rules on`. `lang`: `Settings.enlargeStrength.{name, hint}` (en: "Enlarge: Strength twice" / "An enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength attacks (other attacks keep the 1d4). Applied to the Enlarge effect when it is created."; es: "Agrandar: Fuerza dos veces" / "Un personaje agrandado suma su bonificador de Fuerza una segunda vez en lugar del 1d4 en ataques de Fuerza (los demás ataques conservan el 1d4). Se aplica al efecto de Agrandar al crearse.").

- [ ] **Step 1: Write the failing tests**

```js
const { enlargeChanges, registerHouseRules } = await import("../scripts/houserules.js");
const str = JSON.stringify([{ k: "roll.ability", v: "str", o: "exact" }]), notStr = JSON.stringify([{ o: "NOT", v: { k: "roll.ability", v: "str", o: "exact" } }]);
test("enlargeChanges: the Enlarge 1d4 becomes the Strength modifier on Strength attacks and stays 1d4 on the rest, legacy or new keys, melee and thrown", () => {
  const legacy = [{ _id: "a", key: "system.bonuses.mwak.damage", value: "+1d4", type: "add", phase: "initial", conditions: "{}" }, { key: "system.bonuses.rwak.damage", value: "1d4", type: "add" }, { key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }];
  assert.deepEqual(enlargeChanges("Enlarged", legacy), [
    { key: "system.rolls.damage.mwak.bonus", value: "@abilities.str.mod", type: "add", phase: "initial", conditions: str },
    { key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add", phase: "initial", conditions: notStr },
    { key: "system.rolls.damage.rwak.bonus", value: "@abilities.str.mod", type: "add", conditions: str },
    { key: "system.rolls.damage.rwak.bonus", value: "1d4", type: "add", conditions: notStr },
    { key: "system.abilities.str.check.roll.mode", value: "1", type: "add" }
  ]);
  assert.equal(enlargeChanges("Agrandar/Reducir: Agrandado", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add" }]).length, 2);
  assert.equal(enlargeChanges("Favored Foe", [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }]), null); // not Enlarge
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.bonuses.mwak.damage", value: "1d6", type: "add" }]), null); // not the 1d4
  assert.equal(enlargeChanges("Enlarged", [{ key: "system.rolls.damage.mwak.bonus", value: "1d4", type: "add", conditions: str }]), null); // already conditional: someone's hand
  assert.equal(enlargeChanges("Enlarged", []), null);
});
test("registerHouseRules rewrites an Enlarge effect as it is created, unless the setting is off", () => {
  const hooks = {}; const on = Hooks.on; Hooks.on = (n, fn) => { hooks[n] = fn; };
  try { registerHouseRules(); } finally { Hooks.on = on; }
  const updates = [];
  const effect = { toObject: () => ({ name: "Enlarged", system: { changes: [{ key: "system.bonuses.mwak.damage", value: "1d4", type: "add" }] } }), updateSource: (u) => updates.push(u) };
  settings.enlargeStrength = true;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.deepEqual(updates[0]["system.changes"].map((c) => c.value), ["@abilities.str.mod", "1d4"]);
  settings.enlargeStrength = false;
  hooks.preCreateActiveEffect(effect, {}, {}, "u1");
  assert.equal(updates.length, 1);
});
```

(`settings` is the map behind `game.settings.get` in the test's globals.)

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL: cannot find module `../scripts/houserules.js`.

- [ ] **Step 3: Implement `scripts/houserules.js`, the setting, the registration and the strings**

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/houserules.js scripts/main.js lang/en.json lang/es.json test/houserules.test.mjs
git commit -m "feat(houserules): an enlarged character adds Strength twice instead of the 1d4 on Strength attacks (Enlarge effect rewritten on creation)"
```

---

### Task 6: Docs, spec amendment and release 0.9.0

**Files:**
- Modify: `README.md`, `docs/SERVER-TESTING.md`, `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (append an amendment), `module.json`

- [ ] **Step 1: README**

In "Monster autopilot (piece 4)" a paragraph **Lair actions (piece 5).**: at the top of every round, a monster in its lair (2024 rules: *Inside lair* on the sheet; 2014: lair initiative set) takes the lair action that scores most (damage and save activities with activation *Lair*, aimed anywhere in the lair, areas at the biggest cluster), never the same one two rounds in a row; the GM whisper (`lair: Acid Pool vs Rogue (expected 9.0); not scored: Grasping Roots` / `lair: nothing to score; by hand: ...`) names what the module cannot value so the GM runs it by hand at initiative 20; the lair acts whether or not the monster is on the autopilot. A lair action that only imposes a condition is worth the damage it denies: each PC's threat (its best damage per turn against the monster, doubled by *Extra Attack*, plus its best heal) times the chance it fails the save times the share of a turn the condition costs (paralysed or stunned: all of it; restrained, blinded, frightened, poisoned, prone: half; grappled, deafened: a tenth; no status on the effect: half), so the roots go for the fighter and the fog for the cluster that hurts most; the whisper says `denies`. **Legendary monsters**: a monster with legendary actions is off the autopilot by default (the robot button turns it on); the module never takes legendary actions. A new section **House rules** with **Enlarge: Strength twice** (what it does, that it rewrites the Enlarge effect's 1d4 bonus into two conditional bonuses when the effect is created, so an effect already on an actor or edited by hand is left alone, and that any module that applies Enlarge through a Foundry effect with the standard damage-bonus key is covered). The two settings in the settings list; under "not counted": legendary actions and resistances, mythic actions, lair actions with no save (pure utility), threat beyond the sheet's activities (resistances, flurries, control without a save), initiative-20 ties, regional effects.

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
- L9. Threat and conditions: give *Grasping Roots* a save (DEX DC 15, no damage) and an active effect with the Restrained status; the Fighter (Longsword, Extra Attack if the sheet has it) 60 ft from Goblin 1, the Cleric and the Rogue together 30 ft away. Top of the round with Acid Pool used last round: whisper `lair: Grasping Roots vs Fighter (denies ...)`, Midi's save card on the Fighter; report the console line (each enemy's `threat`) and compare: the Fighter's threat should be the highest. Then remove the Restrained effect from Grasping Roots (save only, no status): the whisper still aims it at the Fighter with a lower number (half a turn by default).
- E1. Enlarge house rule: cast *Enlarge/Reduce* (Enlarge) on the Fighter (Strength 16, Longsword): the Enlarged effect on the Fighter shows two damage-bonus changes (`@abilities.str.mod` and `1d4`, each with a condition) instead of one `1d4`; a Longsword hit rolls `1d8 + 3 + 3` with no d4. Report the effect's changes as the sheet shows them and the damage formula of the card.
- E2. Enlarge on the Rogue (Dagger, Dexterity): the damage card keeps `1d4` from Enlarge and no Strength modifier. A thrown Handaxe by the enlarged Fighter: Strength twice, no d4.
- E3. Setting **Enlarge: Strength twice** off, Enlarge cast again: the effect keeps its single `1d4` change and the card shows the d4.

Report template: add the L and E lines.

- [ ] **Step 3: Spec amendment**

Append `## Amendment 2026-11-06 (piece 5, v0.9.0: lair actions; legendary monsters stay the DM's; Enlarge house rule)` with the Rulings section of this plan condensed: user decision (no legendary actions on the autopilot, legendary monsters off by default, the robot button overrides), the lair phase at the top of the round for every monster in its lair regardless of the flag, the best lair action from where it stands with unlimited range unless the sheet says otherwise, not twice in a row, each PC's threat and the denial value of conditions (lair slot only, user decision), the whisper with the by-hand list, the Enlarge house rule as effect data (outside the autopilot, in `houserules.js`), the two settings, the out-of-scope list.

- [ ] **Step 4: `module.json` version 0.9.0; run the whole suite; commit; tag; push; build**

```bash
git add README.md docs/SERVER-TESTING.md docs/superpowers/specs/2026-11-04-monster-autopilot-design.md module.json
git commit -F "$SCRATCH/msg.txt"
git tag v0.9.0 && git push -q origin main v0.9.0 && bash tools/release.sh
```
Write the commit message to a file first and never chain a heredoc commit with `&&` on one line (the v0.8.3 tag mishap). Then hand the user the one-line `gh release create v0.9.0 ...` command; the web-session text comes after the release is verified (memory rule).
