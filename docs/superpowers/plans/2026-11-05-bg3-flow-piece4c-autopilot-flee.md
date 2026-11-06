# BG3 Flow piece 4c: autopilot flight, escape regions, opportunity-attack estimate, Sentinel and Tunnel Fighter. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A badly hurt monster flees (Dash toward an "escape" Region, or away from everyone) and vanishes from the fight on reaching the region; a clever monster weighs the opportunity attacks a move would draw (reach, spent reactions, Sentinel stops, Tunnel Fighter extra attacks) before it moves; and a PC with the Tunnel Fighter stance gets its reaction prompt at the triggers Gambit's Premades does not cover.

**Architecture:** Same three files as 4a and 4b plus one socket handler. `plan.js` gains the flee rule and flee plan, the opportunity-attack cost of a square and the Tunnel Fighter path split, all pure. `board.js` adds the flee inputs (settings, roster, speed, escape and away paths), per-square distances to every enemy, and per enemy the opportunity-attack data (best melee attack, reach, reaction, Tunnel Fighter). `run.js` sets the Dash flag for a flight, moves in segments around Tunnel Fighter triggers, prompts the PC's owner through socketlib (`prompts.js`, like `promptInitiative`), and marks an escaped monster defeated and hidden. New settings `fleeEnabled`, `fleeThreshold`, `escapeRegionName`.

**Tech Stack:** As 4b plus Foundry 14 `RegionDocument` (`name`, `bounds: Rectangle`, `testPoint({ x, y, elevation }): boolean`, `canvas.scene.regions`), piece 2's Dash flag (`combatant.setFlag("bg3-flow", "dash", true)` doubles the budget in `rules.speedLimit` and piece 2 clears it at the group's next turn), `combatant.update({ defeated: true })`, `MidiQOL.hasUsedReaction(actor): boolean`, `actor.appliedEffects` (active effects in force), `MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids, ignoreUserTargets: true, proceedChecks: { checkAoO: false } } }, { configure: false })` on a player's client (`workflow.hitTargets`), `DialogV2.wait({ render: (ev, dialog) => ... })` for the 30 s close, `socket.executeAsUser(name, userId, ...args)`.

**Spec:** docs/superpowers/specs/2026-11-04-monster-autopilot-design.md, sub-piece **4c** (flee and morale, escape regions, opportunity-attack damage estimate before leaving reach, Sentinel and Tunnel Fighter rules: estimate and the Tunnel Fighter prompt).

## Global Constraints

- As the 4a and 4b plans: Foundry 14, dnd5e 6.0.x, Midi >= 14.6, Gambit's Premades for opportunity attacks, ES modules, CRLF, `safe` wrappers, lead GM only, Midi for every roll, pure decisions in `plan.js`, TDD with `node --test`, commits with the user's identity and the Claude trailer, strings under `BG3FLOW.Autopilot.*` and `BG3FLOW.Settings.*` in `lang/en.json` and `lang/es.json`.
- Settings (world, from the spec): `fleeEnabled` Boolean default `true`; `fleeThreshold` Number default `25` (percent of max hp); `escapeRegionName` String default `"escape"` (case-insensitive substring of a Region's name).
- Feats by name, case-insensitive and trimmed: an item named `Sentinel`; an active effect named `Tunnel Fighter` on the PC (the stance).
- Release at the end: `module.json` 0.8.0.

## Rulings (plan-level, spec silent or ambiguous)

- **Escaped monsters stay in the combat as defeated** (`combatant.update({ defeated: true })`, token `hidden: true`, one public chat line), not deleted: the "alone from the start" rule reads the roster, and the GM can bring one back with two clicks. The spec's "removed from the combat" becomes this; the docs task records it as an amendment. Cost if wrong: a greyed row in the tracker instead of none.
- **"Alone from the start"** = no other combatant of the monster's disposition in `combat.combatants`, defeated ones included. A boss whose minions all died is still not alone (they are in the roster). Cost: a lone wanderer who joined a fight late is treated as a boss and never flees.
- **"Losing"** (intelligent flee) = standing enemies (the board's `enemies`, which already excludes downed ones, visible or not) outnumber standing allies (`allies` with `hp > 0`, the monster included).
- **Flee budget** = `me.budget + me.speed` when the Dash flag is not already set (Dash doubles the turn's movement), else `me.budget`. The runner sets the Dash flag before a flee move so piece 2's budget (and the GM lock, when on) allow it; piece 2 clears the flag at the group's next turn. No Dash item is used (Plutonium monsters have none); the whispered reason says "Dash".
- **Escape path**: the board path-finds (`findMovementPath`, as `pathTo`) to the three region squares nearest in a straight line, keeps the cheapest route, and marks every square of it inside the region (`testPoint` at the square's centre, the monster's elevation). The planner stops at the first square inside the region within the flee budget (entering it is enough), else at the last reachable square of the route. Regions are matched by name only; shape and elevation come from `testPoint`.
- **No region**: the board path-finds toward the point `me + unit(me − centroid of visible enemies) × flee budget` clamped to the scene rect (and, when that gives no path, toward each of the 8 compass points at the same distance, nearest to that direction first); every square of the route carries `distances` to each enemy; the planner picks, within the flee budget, the square whose nearest enemy is farthest. Nothing reachable: no move, reason "flee: nowhere to go", and the normal action plan follows (a cornered creature fights).
- **Flight and actions**: a fleeing monster's action is the Dash (no action activities); its bonus action is still planned (a bonus-action heal on itself is sensible). A dead or escaped member plays no bonus action.
- **Opportunity-attack cost** applies to intelligent monsters only (user decision: dumb ones ignore it), to every candidate square `pickTarget` evaluates (path squares, retreat squares, area firing squares), and never to the flee move or the approach fallback. For each visible standing enemy with a melee attack (`enemy.oa`), walking the route square by square from the monster's start: leaving its reach costs one attack when its reaction is free (then counts as spent for the rest of this route) or always with Tunnel Fighter; with Tunnel Fighter each square entered inside its reach while the previous one was already inside costs one more attack. Each attack = `oa.damage` (hit chance against the monster's AC times average damage). Sentinel: each attack that could stop the monster multiplies the option's value by `(1 − oa.hit)` (a miss leaves the move intact); the damage is still counted in full ("each trigger as if the earlier ones missed"). Net value = `value × stopFree − damage`; options with net ≤ 0 are dropped like any other. The reason shows the cost: `Shortbow vs Rogue (expected 1.2; opportunity attacks 2.1)`.
- **Multiattack from a square**: the first attack's pick carries the net value; follow-ups from the same square add their gross value (the move is paid once). The Sentinel factor is applied to the first attack only (ponytail comment).
- **Tunnel Fighter triggers the autopilot handles itself**: for each visible standing enemy with `tunnelFighter`: (a) entering a square inside its reach when the previous square was already inside (more than 5 ft inside reach), (b) leaving its reach when `oa.reaction` is false (spent). Leaving reach with a free reaction stays Gambit's (it prompts and spends the reaction; the stance's "no reaction" is lost there, checked on the server as the spec says). The move is split into segments ending at each trigger square; after each segment the PC's owner is asked; the next segment starts after the answer.
- **The Tunnel Fighter prompt** runs on the owner's client (socket `tunnelFighter(userId, actorUuid, activityUuid, targetUuid)`): DialogV2 "Fighter: attack Goblin with Tunnel Fighter?" with **Attack** (uses `oa.activityUuid`, the PC's best melee attack, through `MidiQOL.completeActivityUse` with `targetUuids: [monster]`, `ignoreUserTargets`, `proceedChecks.checkAoO: false` so Midi neither demands nor spends the reaction, `configure: false`) and **Pass**; 30 s then it closes (Pass). Returns `{ hit }`. The GM sees piece 3's `awaitOrGm` dialog ("Roll for them"): the fallback runs the same use on the GM client. No active owner: the GM fallback runs at once. After a hit by a PC who also has Sentinel, or when the monster dropped to 0 hp, the remaining segments are dropped.
- **Dash flag and segments**: segments are separate `move()` calls, each awaited with `arrive` and tagged `bg3Autopilot`; piece 2's movement history keeps the budget straight across them.
- **Approach keeps walking speed**: the spec's "Dash toward the nearest visible enemy" when nothing scores stays as 4a shipped it (walk the budget); a Dash there needs paths cut at the doubled budget for every enemy and is deferred (noted in the amendment).

## Review Focus

1. Flee with `fleeEnabled` off, or at exactly the threshold (25 % of 8 = 2 hp: 2 hp does not flee, 1 does): the rule reads `hp / maxHp * 100 < threshold`. Pinned in Task 1.
2. An escape region the monster cannot reach this turn (40 ft away, speed 30, Dash 60: reachable; 70 ft: not): it walks the whole flee budget along the route and is not marked escaped; next turn it continues. Pinned in Task 1 (planner) and Task 5 (runner checks `testPoint`, not the plan's intent).
3. An enemy whose reaction is spent and who has neither feat: leaving its reach costs nothing; an enemy without a melee attack (a wizard with a crossbow only) has `oa: null` and never costs. Pinned in Task 2 and Task 4.
4. A monster that starts outside every reach and ends adjacent (an approach): no opportunity attack; a path that crosses a Fighter's reach on the way to the Rogue costs one leaving attack. Pinned in Task 2.
5. The Tunnel Fighter prompt when the owner closes the dialog, when 30 s pass, when the player is offline (GM fallback), and when the move was already cut by a Sentinel stop (no prompt for squares never entered). Pinned in Task 5.

## File structure

- Modify `scripts/ai/plan.js`: `shouldFlee`, `planFlee`, `oaCost`, `splitAtTunnelFighter`, `pickTarget` net values, `planTurn` step 1.
- Modify `scripts/ai/board.js`: `creature()` gains `oa`, `tunnelFighter`; squares gain `distances`; `snapshot` gains `me.alone`, `me.speed`, `me.dash`, `flee`, `escape`, `away`.
- Modify `scripts/ai/run.js`: flee execution (Dash flag, escape mark), segmented moves with the Tunnel Fighter prompt, bonus phase for escaped members.
- Modify `scripts/prompts.js`: socket handler `tunnelFighter`, `promptTunnelFighter`, `tunnelFighterAttack`.
- Modify `scripts/main.js` (three settings), `lang/en.json`, `lang/es.json`, `README.md`, `docs/SERVER-TESTING.md` (section 7c, C-steps), spec amendment, `module.json` (0.8.0).
- Tests: `test/plan.test.mjs`, `test/board.test.mjs`, `test/run.test.mjs`, `test/prompts.test.mjs`.

Test command for every task: `cd "/c/Foundry vtt module" && timeout 120 node --test test/*.test.mjs > "$SCRATCH/t.txt" 2>&1; grep "^ℹ pass\|^ℹ fail\|^not ok" "$SCRATCH/t.txt"` (168 pass before Task 1).

---

### Task 1: Flee rule and flee plan

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Task 4 produces): `board.flee = { enabled: boolean, threshold: number }`; `board.me.alone: boolean`, `board.me.speed: number` (walk limit in ft), `board.me.dash: boolean` (flag already set); `board.escape = { uuid, name, squares: square[] } | null` where a square is `{ x, y, elevation, cost, waypoints, inside: boolean, distances: { [enemyId]: ft } }` in route order; `board.away: square[]` (route order, same shape, `inside` absent); `board.allies[].hp`.
- Produces:
  - `shouldFlee(board) -> boolean`: false when `!flee.enabled`, `me.alone`, `me.hp <= 0`, or `me.hp / me.maxHp * 100 >= flee.threshold`; true when `me.intelligence < board.threshold`; else true only when `enemies.length > allies.filter(a => a.hp > 0).length`.
  - `planFlee(board) -> { move, actions: [], reason, dash: true, escape: string | null }`: budget `b = me.dash ? me.budget : me.budget + me.speed`; with `board.escape`, the first square with `inside && cost <= b` (then `escape = board.escape.uuid`), else the last square with `cost <= b` (`escape: null`); squares `occupied` or in `board.reserved` are skipped for the final square. Reason `flee: Dash toward <name> (hp 1/7)`. Without a region: among `board.away` squares with `cost <= b`, the one maximising `min(Object.values(distances))`, reason `flee: Dash away from enemies (hp 1/7)`. Nothing: `{ move: null, actions: [], reason: "flee: nowhere to go", dash: false, escape: null }`.
  - `planTurn(board)` (slot `"action"` only): when `shouldFlee(board)` the result is `planFlee(board)` unless its `move` is null, in which case the normal plan follows. `slot: "bonus"` never flees.

- [ ] **Step 1: Write the failing tests**

```js
const { shouldFlee, planFlee } = await import("../scripts/ai/plan.js");
const fleeBoard = (over = {}) => ({ ...board({ enemies: [pc("rogue", 30), pc("fighter", 40)], activities: [scimitar] }), flee: { enabled: true, threshold: 25 }, allies: [{ id: "m", hp: 1, maxHp: 8 }], escape: null, away: [], ...over, me: { ...board({ enemies: [], activities: [] }).me, hp: 1, maxHp: 8, intelligence: 10, speed: 30, dash: false, alone: false, ...over.me } });
test("shouldFlee: below the threshold, dumb always, clever only when losing, never alone or when disabled", () => {
  assert.equal(shouldFlee(fleeBoard()), true); // 1/8 = 12.5 %, two enemies vs one ally
  assert.equal(shouldFlee(fleeBoard({ me: { hp: 2 } })), false); // exactly 25 % stays
  assert.equal(shouldFlee(fleeBoard({ flee: { enabled: false, threshold: 25 } })), false);
  assert.equal(shouldFlee(fleeBoard({ me: { alone: true } })), false);
  assert.equal(shouldFlee(fleeBoard({ allies: [{ id: "m", hp: 1, maxHp: 8 }, { id: "g2", hp: 5, maxHp: 7 }, { id: "g3", hp: 0, maxHp: 7 }] })), false); // 2 standing vs 2: not losing
  assert.equal(shouldFlee(fleeBoard({ me: { intelligence: 3 }, allies: [{ id: "m", hp: 1, maxHp: 8 }, { id: "g2", hp: 5, maxHp: 7 }, { id: "g3", hp: 5, maxHp: 7 }] })), true); // dumb: flees even when winning
});
const esc = (x, cost, inside, dr = 30) => ({ x, y: 0, elevation: 0, cost, waypoints: [{ x, y: 0, elevation: 0 }], inside, distances: { rogue: dr, fighter: dr + 10 } });
test("planFlee: Dash toward the escape region, stop on entering it or at the budget's end; away from everyone without one", () => {
  const region = { uuid: "Scene.s.Region.r1", name: "Escape north", squares: [esc(100, 5, false), esc(200, 10, false), esc(300, 15, true), esc(400, 20, true)] };
  let p = planFlee(fleeBoard({ escape: region }));
  assert.deepEqual([at(p.move), p.actions, p.reason, p.dash, p.escape], [{ x: 300, y: 0, elevation: 0 }, [], "flee: Dash toward Escape north (hp 1/8)", true, "Scene.s.Region.r1"]);
  p = planFlee(fleeBoard({ escape: { ...region, squares: [esc(100, 30, false), esc(200, 55, false), esc(300, 70, true)] } }));
  assert.deepEqual([at(p.move), p.escape], [{ x: 200, y: 0, elevation: 0 }, null]); // 60 ft of Dash: short of the region, keeps going
  p = planFlee(fleeBoard({ escape: { ...region, squares: [esc(100, 30, false), esc(200, 55, false), esc(300, 70, true)] }, me: { dash: true, budget: 30 } }));
  assert.deepEqual(at(p.move), { x: 100, y: 0, elevation: 0 }); // already dashing: the budget is what is left
  p = planFlee(fleeBoard({ away: [esc(100, 5, undefined, 35), esc(200, 10, undefined, 45), esc(300, 15, undefined, 40), esc(400, 65, undefined, 90)] }));
  assert.deepEqual([at(p.move), p.reason, p.escape], [{ x: 200, y: 0, elevation: 0 }, "flee: Dash away from enemies (hp 1/8)", null]);
  assert.deepEqual(planFlee(fleeBoard()), { move: null, actions: [], reason: "flee: nowhere to go", dash: false, escape: null });
});
test("planTurn flees before anything else, fights when cornered, and the bonus slot never flees", () => {
  const b = fleeBoard({ enemies: [pc("rogue", 5), pc("fighter", 40)], away: [esc(100, 5, undefined, 10)] });
  assert.equal(planTurn(b).reason, "flee: Dash away from enemies (hp 1/8)");
  assert.ok(planTurn({ ...b, away: [] }).reason.startsWith("Scimitar vs rogue"));
  assert.equal(planTurn(b, { slot: "bonus" }).reason, "no bonus action");
});
```

- [ ] **Step 2: Run to verify it fails**

Run the test command. Expected: FAIL, `shouldFlee` is not a function.

- [ ] **Step 3: Implement `shouldFlee`, `planFlee` and the `planTurn` step 1 in `scripts/ai/plan.js`**

`planFlee` reuses `moveTo(square)`. Boards without `flee` (4a and 4b tests) must not flee: `shouldFlee` returns false when `board.flee` is undefined.

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): flee rule and flee plan (escape region or away from everyone)"
```

---

### Task 2: Opportunity-attack cost of a move

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes (Task 4 produces): every square of `board.paths[*]`, `board.retreats` carries `distances: { [enemyId]: ft }` (footprint distance from that square to each enemy); every enemy carries `oa: { damage, hit, reach, reaction: boolean (free), tunnelFighter: boolean, activityUuid } | null` and `sentinel`.
- Produces:
  - `routeOf(board, square) -> square[]`: the squares of `square.waypoints` in order, looked up by `"x,y"` among all squares of `board.paths`, `board.retreats`, `board.escape?.squares`, `board.away`; the square itself last. Unknown waypoints are skipped.
  - `oaCost(board, square) -> { damage: number, stopFree: number }`: the Rulings' walk over `routeOf`, starting from `enemy.distance` (the monster's start). Enemies with `oa === null`, `!visible`, `hp <= 0` cost nothing. `stopFree` starts at 1 and is multiplied by `(1 − oa.hit)` per attack of a `sentinel` enemy.
  - `pickTarget`: when `board.me.intelligence >= board.threshold` every candidate square's value becomes `value * stopFree − damage` and the pick carries `oa: damage` (0 when the monster stays). A net value ≤ 0 is no pick. `distanceFrom` reads `from.distances[enemy.id]` when present (every square now has it).
  - `planTurn` reason: `... (expected 1.2; opportunity attacks 2.1)` when the winning option's `oa > 0`.

- [ ] **Step 1: Write the failing tests**

```js
const { oaCost } = await import("../scripts/ai/plan.js");
const oa = (over = {}) => ({ damage: 3, hit: 0.5, reach: 5, reaction: true, tunnelFighter: false, activityUuid: "A.ls", ...over });
const rsq = (x, y, cost, distances, route = []) => ({ x, y, elevation: 0, cost, distance: distances.rogue ?? 99, occupied: false, waypoints: [...route.map((r) => ({ x: r[0], y: r[1], elevation: 0 })), { x, y, elevation: 0 }], distances });
test("oaCost: leaving a free reach costs one attack, a spent reaction none, Tunnel Fighter every extra square inside and the leaving, Sentinel scales the stop chance", () => {
  // fighter adjacent at the start (distance 5); route: (100,0) still adjacent, (200,0) out of reach
  const fighter = { ...pc("fighter", 5), oa: oa() };
  const route = [rsq(100, 0, 5, { fighter: 5 }), rsq(200, 0, 10, { fighter: 10 }, [[100, 0]])];
  const b = { ...board({ enemies: [fighter], activities: [bow], paths: { fighter: route } }), retreats: [] };
  assert.deepEqual(oaCost(b, route[1]), { damage: 3, stopFree: 1 });
  assert.deepEqual(oaCost(b, route[0]), { damage: 0, stopFree: 1 }); // still inside reach: nothing
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ reaction: false }) }] }, route[1]), { damage: 0, stopFree: 1 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ tunnelFighter: true, reaction: false }) }] }, route[1]), { damage: 6, stopFree: 1 }); // one for the second square inside, one for leaving
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: oa({ tunnelFighter: true }), sentinel: true }] }, route[1]), { damage: 6, stopFree: 0.25 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, oa: null }] }, route[1]), { damage: 0, stopFree: 1 });
  assert.deepEqual(oaCost({ ...b, enemies: [{ ...fighter, visible: false }] }, route[1]), { damage: 0, stopFree: 1 });
});
test("a clever archer steps back only when the shot gains more than the opportunity attack costs; a path through a Fighter's reach pays on the way to the Rogue", () => {
  // Fighter (AC 30, Longsword worth 1.0 expected vs me) and Rogue both adjacent; the retreat square is 10 ft from both; bow 2.5 from there, 1.25 at disadvantage from here, scimitar 2.5 vs the Rogue
  const fighter = { ...pc("fighter", 5, { ac: 30 }), oa: oa({ damage: 1 }) };
  const retreat = rsq(0, 100, 5, { fighter: 10, rogue: 10 });
  const b = { ...board({ enemies: [fighter, pc("rogue", 5)], activities: [bow, scimitar] }), retreats: [retreat] };
  let p = planTurn(b);
  assert.deepEqual([p.move, p.reason], [null, "Scimitar vs rogue (expected 2.5); also: Shortbow 1.5"]); // 2.5 − 1.0 from the retreat loses to the scimitar here
  p = planTurn({ ...b, activities: [bow, { ...scimitar, damage: 2 }] });
  assert.deepEqual([at(p.move), p.reason], [{ x: 0, y: 100, elevation: 0 }, "Shortbow vs rogue (expected 1.5; opportunity attacks 1.0); also: Scimitar 1.0"]); // now the step back pays
  p = planTurn({ ...b, activities: [bow, { ...scimitar, damage: 2 }], enemies: [{ ...fighter, oa: oa({ damage: 6 }) }, pc("rogue", 5)] });
  assert.deepEqual([p.move, p.reason], [null, "Shortbow vs rogue (expected 1.3); also: Scimitar 1.0"]); // 2.5 − 6 < 0: it shoots at disadvantage from where it stands
  assert.equal(planTurn({ ...b, me: { ...b.me, intelligence: 3 } }).move, null); // dumb: no estimate, no retreat (4b rule)
  // approach: rogue 15 ft away behind the fighter's reach; the first square in range (10 ft from the fighter) costs the leaving attack
  const rogue = pc("rogue", 15);
  const path = [rsq(100, 0, 5, { fighter: 5, rogue: 10 }), rsq(200, 0, 10, { fighter: 10, rogue: 5 }, [[100, 0]])];
  p = planTurn({ ...board({ enemies: [{ ...fighter, oa: oa({ damage: 2 }) }, rogue], activities: [scimitar], paths: { rogue: path } }), retreats: [] });
  assert.deepEqual([at(p.move), p.reason], [{ x: 200, y: 0, elevation: 0 }, "Scimitar vs rogue (expected 0.5; opportunity attacks 2.0)"]); // 2.5 − 2.0 still beats 0.25 on the Fighter's AC 30
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `oaCost` is not a function.

- [ ] **Step 3: Implement `routeOf`, `oaCost` and the net values in `scripts/ai/plan.js`**

Build the `"x,y"` lookup once per `pickTarget` call (ponytail: a few dozen squares). The reason's `also` list shows net values.

- [ ] **Step 4: Run the whole suite**

Expected: all pass (4b tests have no `oa` on their enemies: cost 0, values unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): opportunity-attack cost of a move (reach, reactions, Sentinel, Tunnel Fighter) for clever monsters"
```

---

### Task 3: Tunnel Fighter path split

**Files:**
- Modify: `scripts/ai/plan.js`
- Test: `test/plan.test.mjs` (append)

**Interfaces:**
- Consumes: Task 2's `routeOf`, `enemy.oa.tunnelFighter`, `enemy.oa.reach`, `enemy.oa.reaction`.
- Produces: `splitAtTunnelFighter(board, move) -> [{ waypoints: [{x,y,elevation}...], trigger: { enemyId } | null }]`: the move's route cut after every trigger square (Rulings: second and later squares inside a Tunnel Fighter's reach; leaving its reach when the reaction is spent). The last segment has `trigger: null` unless the route ends on a trigger square. A move whose squares are unknown to the board (no `distances`) or with no Tunnel Fighter enemy returns one segment with the move's own waypoints and `trigger: null`.

- [ ] **Step 1: Write the failing tests**

```js
const { splitAtTunnelFighter } = await import("../scripts/ai/plan.js");
test("splitAtTunnelFighter cuts the route after each square that draws a Tunnel Fighter attack Gambit would not prompt", () => {
  const tf = { ...pc("fighter", 5), oa: oa({ tunnelFighter: true, reaction: false }) };
  const route = [rsq(100, 0, 5, { fighter: 5 }), rsq(200, 0, 10, { fighter: 5 }, [[100, 0]]), rsq(300, 0, 15, { fighter: 10 }, [[100, 0], [200, 0]]), rsq(400, 0, 20, { fighter: 15 }, [[100, 0], [200, 0], [300, 0]])];
  const b = { ...board({ enemies: [tf], activities: [bow], paths: { fighter: route } }), retreats: [] };
  const move = { x: 400, y: 0, elevation: 0, waypoints: route[3].waypoints };
  assert.deepEqual(splitAtTunnelFighter(b, move), [
    { waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // second square inside reach (the start was the first)
    { waypoints: [{ x: 200, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // third
    { waypoints: [{ x: 300, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, // leaving with the reaction spent
    { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }
  ]);
  const free = { ...b, enemies: [{ ...tf, oa: oa({ tunnelFighter: true, reaction: true }) }] };
  assert.deepEqual(splitAtTunnelFighter(free, move).map((s) => s.trigger), [{ enemyId: "fighter" }, { enemyId: "fighter" }, null]); // leaving with a free reaction is Gambit's
  assert.deepEqual(splitAtTunnelFighter({ ...b, enemies: [{ ...tf, oa: oa() }] }, move), [{ waypoints: move.waypoints, trigger: null }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `splitAtTunnelFighter` is not a function.

- [ ] **Step 3: Implement `splitAtTunnelFighter` in `scripts/ai/plan.js`**

Share the per-enemy walk with `oaCost` (one helper yielding `{ square, enemy, kind: "leave" | "inside" }` events; `oaCost` sums, the split cuts on the events Gambit does not cover).

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/plan.js test/plan.test.mjs
git commit -m "feat(autopilot): split a move at the Tunnel Fighter triggers the autopilot prompts itself"
```

---

### Task 4: Board inputs for flight and opportunity attacks

**Files:**
- Modify: `scripts/ai/board.js`
- Modify: `scripts/main.js` (register `fleeEnabled`, `fleeThreshold`, `escapeRegionName` after `intelligenceThreshold`), `lang/en.json`, `lang/es.json` (`Settings.fleeEnabled`, `Settings.fleeThreshold`, `Settings.escapeRegionName`, each `Name` and `Hint`)
- Test: `test/board.test.mjs` (append), `test/run.test.mjs` (the lang-key test gains the three settings keys)

**Interfaces:**
- Produces (consumed by Tasks 1 to 3 and 5):
  - every square from `pathTo`, the retreats, `escape.squares` and `away` carries `distances: { [enemyId]: ft }` (`reachFt` from the square's footprint to each enemy's footprint);
  - `creature()` adds `oa` for enemies: from the enemy actor's items through `activityInfo`, keeping `kind === "attack" && !ranged` (`activityInfo` is called with the enemy's activity; its `slot` filter stays); `reach` = the max `range` of those; `damage` = max over them of `hitChance({ bonus, ac: my AC }) * damage`, `hit` its hit chance, `activityUuid` its uuid; `reaction` = `!(MidiQOL?.hasUsedReaction?.(actor) ?? false)`; `tunnelFighter` = an effect in `actor.appliedEffects ?? actor.effects` with `!disabled` named "tunnel fighter" (trimmed, lower-cased). `oa: null` with no melee attack. The monster's own `creature()` does not need `oa` (left as computed; harmless).
  - `snapshot` adds: `me.speed` (`speedLimit` with `dash: false`), `me.dash` (the flag), `me.alone` (Rulings), `flee: { enabled, threshold }` from the settings, `escape` (Rulings: nearest region whose `name` includes `escapeRegionName` case-insensitively; `squares` with `inside`; `null` without regions or without a path), `away` (Rulings; `[]` with no visible enemies). Escape and away paths use the flee budget (`budget + speed`, or `budget` when dashing) as `pathTo`'s cut.
- Test stub additions in `test/board.test.mjs`: `canvas.scene.regions = { contents: [...] }` with region stubs `{ uuid, name, bounds: { x, y, width, height }, testPoint: ({ x, y }) => inside the bounds }`; `globalThis.MidiQOL = { hasUsedReaction: (actor) => !!actor.reactionUsed }`; `token()` gains `effects` and `reactionUsed` options.

- [ ] **Step 1: Write the failing tests**

```js
test("snapshot: enemies carry their opportunity-attack data (best melee attack vs my AC, reach, reaction, Tunnel Fighter), a crossbow-only wizard none", async () => {
  const ls = act({ type: "attack", toHit: "+5", parts: [["1d8 + 3", {}]], item: { type: "weapon", range: { reach: 5 } }, name: "Longsword" });
  const pike = act({ type: "attack", toHit: "+5", parts: [["1d10 + 3", {}]], item: { type: "weapon", range: { reach: 10 } }, name: "Pike" });
  const xbow = act({ type: "attack", toHit: "+5", parts: [["1d8", {}]], item: { type: "weapon", range: { value: 80 } }, name: "Crossbow", attackType: "ranged" });
  const weapon = (a) => ({ name: a.item.name, type: "weapon", system: { activities: [a], range: a.item.system.range } });
  const goblin = token("goblin", { x: 300, y: 100, disposition: -1, ac: 15 });
  const fighter = token("fighter", { x: 400, y: 100, disposition: 1, items: [weapon(ls), weapon(pike), { name: "Sentinel", type: "feat", system: { activities: [] } }], effects: [{ name: "Tunnel Fighter", disabled: false }], reactionUsed: true });
  const wizard = token("wizard", { x: 0, y: 100, disposition: 1, items: [weapon(xbow)], effects: [{ name: "Tunnel Fighter", disabled: true }] });
  canvas.scene.tokens.contents = [goblin, fighter, wizard];
  const b = await snapshot({ combatants: [goblin, fighter, wizard].map((t) => combatantOf(t)) }, combatantOf(goblin));
  const f = b.enemies.find((e) => e.id === "fighter"), w = b.enemies.find((e) => e.id === "wizard");
  assert.deepEqual([f.oa.reach, f.oa.hit, f.oa.damage, f.oa.reaction, f.oa.tunnelFighter, f.oa.activityUuid, f.sentinel, f.actorUuid], [10, 0.55, 0.55 * 8.5, false, true, pike.uuid, true, "Actor.fighter"]);
  assert.deepEqual([w.oa, w.tunnelFighter], [null, false]);
  assert.deepEqual(b.paths.wizard[0].distances, { fighter: 10, wizard: 10 }); // every square knows every enemy (the adjacent fighter's path is empty: nothing to walk)
});
test("snapshot: flee inputs: settings, speed, dash flag, alone from the roster, escape path into the nearest 'escape' region, away path without one", async () => {
  settings.fleeEnabled = true; settings.fleeThreshold = 25; settings.escapeRegionName = "escape";
  const goblin = token("goblin", { x: 300, y: 100, disposition: -1, speed: 30 }), rogue = token("rogue", { x: 500, y: 100, disposition: 1 });
  canvas.scene.tokens.contents = [goblin, rogue];
  const region = (uuid, name, x) => ({ uuid, name, bounds: { x, y: 0, width: 200, height: 300 }, testPoint: (p) => p.x >= x && p.x < x + 200 && p.y < 300 });
  canvas.scene.regions = { contents: [region("Scene.s.Region.far", "Escape west", 0), region("Scene.s.Region.near", "ESCAPE hatch", 900), region("Scene.s.Region.no", "Lava", 700)] };
  let b = await snapshot({ combatants: [goblin, rogue].map((t) => combatantOf(t)) }, combatantOf(goblin));
  assert.deepEqual([b.flee, b.me.speed, b.me.dash, b.me.alone], [{ enabled: true, threshold: 25 }, 30, false, true]);
  assert.deepEqual([b.escape.uuid, b.escape.name], ["Scene.s.Region.far", "Escape west"]); // 15 ft away beats 30 ft, name matched case-insensitively, Lava ignored
  assert.deepEqual(b.escape.squares.map((s) => [s.x, s.cost, s.inside]), [[200, 5, false], [100, 10, true]]); // route to the nearest region square (1,1); the stub's path is the straight line
  assert.deepEqual(b.escape.squares[0].distances, { rogue: 15 });
  canvas.scene.regions = { contents: [] };
  const goblin2 = token("goblin2", { x: 600, y: 100, disposition: -1, hp: 0 });
  canvas.scene.tokens.contents = [goblin, rogue, goblin2];
  b = await snapshot({ combatants: [combatantOf(goblin), combatantOf(rogue), combatantOf(goblin2, true)] }, combatantOf(goblin));
  assert.deepEqual([b.escape, b.me.alone], [null, false]); // a defeated ally in the roster: not alone
  assert.deepEqual(b.away.map((s) => s.x), [200, 100, 0]); // straight away from the rogue, cut at the flee budget (60 ft) and the scene edge
  assert.deepEqual(b.away[2].distances, { rogue: 25 });
  delete canvas.scene.regions;
});
```
The stub's `findMovementPath` returns the straight line; `pathTo` toward a point (not an enemy token) needs a goal `{ x, y, elevation }`: extract the goal-only part of `pathTo` into `pathToPoint(me, goal, taken, budget, enemies)` and keep `pathTo` for enemies (footprint-aware). The away point is clamped so the token's footprint stays inside `sceneRect`. `creature()` also adds `actorUuid: t.actor?.uuid` (the token stub's actor gets `uuid: \`Actor.${id}\``). Add `fleeEnabled`, `fleeThreshold`, `escapeRegionName` to the `settings` object of `test/board.test.mjs` and to the lang-key test's list in `test/run.test.mjs`.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `f.oa` undefined, `b.flee` undefined, lang keys missing.

- [ ] **Step 3: Implement in `scripts/ai/board.js`, register the settings in `scripts/main.js`, add the six lang strings**

English: `fleeEnabled` "Monsters flee" / "A monster below the flee threshold runs for an escape region (Dash) or away from everyone: unintelligent ones always, intelligent ones only when outnumbered. A creature alone from the start never flees."; `fleeThreshold` "Flee threshold (% of max hp)" / "Below this share of its maximum hit points a monster flees."; `escapeRegionName` "Escape region name" / "Regions whose name contains this word are escape routes: a fleeing monster that enters one leaves the fight." Spanish equivalents.

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/board.js scripts/main.js lang/en.json lang/es.json test/board.test.mjs test/run.test.mjs
git commit -m "feat(autopilot): board carries flee inputs, escape and away paths, per-square distances and each enemy's opportunity attack"
```

---

### Task 5: Execution: Dash and escape, segmented moves with the Tunnel Fighter prompt

**Files:**
- Modify: `scripts/ai/run.js`, `scripts/prompts.js`, `lang/en.json`, `lang/es.json`
- Test: `test/run.test.mjs` (append), `test/prompts.test.mjs` (append)

**Interfaces:**
- Consumes: Task 1's plan fields `dash`, `escape`; Task 3's `splitAtTunnelFighter(board, move)`; `enemy.oa.activityUuid`, `enemy.uuid`, `enemy.sentinel`; `prompts.js` `activeOwner`, `awaitOrGm`, `registerSockets`.
- Produces in `scripts/prompts.js`:
  - socket handler `"tunnelFighter"(actorUuid, activityUuid, targetUuid) -> { hit: boolean }` registered in `registerSockets`: `DialogV2.wait` titled `L("Autopilot.TunnelFighter.Title", { name, target })` with buttons `attack` (`L("Autopilot.TunnelFighter.Attack")`, default) and `pass`, `rejectClose: false`, `render: (ev, dialog) => setTimeout(() => dialog.close(), 30000)`; `attack` runs `tunnelFighterAttack(activityUuid, targetUuid)`; anything else `{ hit: false }`.
  - `tunnelFighterAttack(activityUuid, targetUuid) -> Promise<{ hit }>`: `MidiQOL.completeActivityUse(fromUuidSync(activityUuid), { midiOptions: { targetUuids: [targetUuid], ignoreUserTargets: true, proceedChecks: { checkAoO: false } } }, { configure: false })`; `hit = (workflow?.hitTargets?.size ?? 0) > 0`.
  - `promptTunnelFighter(userId, actorUuid, activityUuid, targetUuid)` = `socket.executeAsUser("tunnelFighter", userId, ...)`.
- Produces in `scripts/ai/run.js`:
  - `runTurn` deps gain `split = splitAtTunnelFighter`, `ask = promptTunnelFighter`, `gmAttack = tunnelFighterAttack`, `owner = activeOwner`, `wait = awaitOrGm`.
  - Movement phase, per mover: `if (p.dash && !c.getFlag(MODULE_ID, "dash")) await c.setFlag(MODULE_ID, "dash", true)` before the move; the move runs segment by segment (`split(boards[c.id], p.move)`): `move(walk(segment))`, `arrive`, then for a `trigger` the PC token `enemy = boards[c.id].enemies.find(e => e.id === trigger.enemyId)`, `const u = owner(fromUuidSync(enemy.uuid))`; `hit = u ? (await wait(ask(u.id, enemy.actorUuid, enemy.oa.activityUuid, c.token.uuid), { title: L("Autopilot.TunnelFighter.Waiting", { name: enemy.name }), label: L("Prompt.RollForThem") }, () => gmAttack(enemy.oa.activityUuid, c.token.uuid))).hit : (await gmAttack(...)).hit`; stop the remaining segments when `hit && enemy.sentinel` or the monster's hp ≤ 0 (`c.actor.system.attributes.hp.value`). Errors in a prompt are logged and the move goes on. `enemies[]` need `actorUuid` (board: `t.actor?.uuid`, add in Task 4's `creature()` or here with a one-line board change and test).
  - After the movement phase: for each mover with `p.escape`, when `fromUuidSync(p.escape)?.testPoint?.({ ...c.token.getCenterPoint(), elevation: c.token.elevation ?? 0 })` is true: `await c.update({ defeated: true })`, `await c.token.update({ hidden: true })`, public `ChatMessage.create({ content: L("Autopilot.Escaped", { name }) })`, whisper the decision line, and the member is skipped in the action phase (no bonus action either).
  - The action phase treats a flee plan like any plan: its `actions` are empty, the reason is whispered; `plan(still)` returns the flee reason because `shouldFlee` still holds (budget 0 gives `move: null`, then the normal plan follows: a cornered monster attacks from where it stands). To keep the whisper honest the runner whispers the movement-phase reason when the plan fled (`first.dash`), and runs `act` only for the still-plan's actions.
- Lang keys: `Autopilot.Escaped` "<b>{name}</b> has escaped." / "<b>{name}</b> ha escapado."; `Autopilot.TunnelFighter.Title` "{name}: attack {target} with Tunnel Fighter?"; `.Attack` "Attack"; `.Pass` "Pass"; `.Waiting` "Waiting for {name}'s Tunnel Fighter reaction".

- [ ] **Step 1: Write the failing tests (`test/run.test.mjs`)**

```js
test("a flee plan sets the Dash flag before the move, whispers the flee reason, and a monster that reached the escape region is marked defeated and hidden with a public line", async () => {
  reset();
  const g1 = combatant("g1"), updates = [];
  g1.update = async (u) => updates.push(["combatant", u]); g1.token.update = async (u) => updates.push(["token", u]); g1.token.getCenterPoint = () => ({ x: 450, y: 50 }); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 1 } } };
  globalThis.fromUuidSync = (uuid) => uuid === "Scene.s.Region.r1" ? { testPoint: (p) => p.x > 400 } : null;
  const fleePlan = { move: { x: 400, y: 0, elevation: 0, waypoints: [{ x: 400, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash toward Escape (hp 1/7)", dash: true, escape: "Scene.s.Region.r1" };
  const combat = makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]);
  await runTurn(combat, deps({ plans: { g1: fleePlan } }));
  assert.equal(g1.flags["bg3-flow"].dash, true);
  assert.deepEqual(order, ["clear g1", "move g1"]);
  assert.deepEqual(updates, [["combatant", { defeated: true }], ["token", { hidden: true }]]);
  assert.deepEqual(calls.chat.map((m) => [m.whisper ?? "public", m.content.includes("Escaped") || m.content.includes("flee")]), [[["gm"], true], ["public", true]]);
  assert.equal(combat.nextTurns, 1);
});
test("a flight that falls short of the region is not an escape: the monster stays in the fight and still gets its bonus action", async () => {
  reset();
  const g1 = combatant("g1"), updates = [];
  g1.update = async (u) => updates.push(u); g1.token.getCenterPoint = () => ({ x: 250, y: 50 });
  globalThis.fromUuidSync = (uuid) => ({ testPoint: (p) => p.x > 400 });
  const fleePlan = { move: { x: 200, y: 0, elevation: 0, waypoints: [{ x: 200, y: 0, elevation: 0 }] }, actions: [], reason: "flee: Dash toward Escape (hp 1/7)", dash: true, escape: "Scene.s.Region.r1" };
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), deps({ plans: { g1: fleePlan }, bonus: { g1: { move: null, actions: [{ activityId: "hw", targetIds: ["g1"] }], reason: "Healing Word vs g1" } }, allies: () => [{ id: "g1", uuid: "T.g1", name: "g1", hp: 1, maxHp: 7 }] }));
  assert.deepEqual(updates, []);
  assert.deepEqual(order, ["clear g1", "move g1", "use T.g1"]);
});
test("a move split at Tunnel Fighter triggers runs segment by segment, prompts the PC's owner after each, continues on a miss and stops after a Sentinel hit", async () => {
  reset();
  const g1 = combatant("g1"); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 7 } } };
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: true, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const asks = [], hits = [false, true];
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 200, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => ({ id: "p1" }); d.wait = (p) => p;
  d.ask = async (userId, actorUuid, activityUuid, targetUuid) => { asks.push([userId, actorUuid, activityUuid, targetUuid]); return { hit: hits[asks.length - 1] }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(asks, [["p1", "Actor.f", "A.ls", "T.g1"], ["p1", "Actor.f", "A.ls", "T.g1"]]);
  assert.deepEqual(moves.map((m) => m[1].at(-1).x), [100, 200]); // the third segment never runs: the Sentinel hit stopped it
  assert.deepEqual(order.filter((o) => o.startsWith("use")), ["use T.fighter"]); // it still acts from where it stands
});
test("a Tunnel Fighter trigger with no connected owner goes straight to the GM's roll; a hit by a PC without Sentinel does not stop the move", async () => {
  reset();
  const g1 = combatant("g1"); g1.token.uuid = "T.g1"; g1.actor.system = { attributes: { hp: { value: 7 } } };
  const fighter = { ...enemy("fighter"), uuid: "T.fighter", actorUuid: "Actor.f", sentinel: false, oa: { activityUuid: "A.ls", reach: 5, damage: 3, hit: 0.5, reaction: false, tunnelFighter: true } };
  const gmRolls = [];
  const d = deps({ plans: { g1: attackPlan() }, enemies: () => [fighter] });
  d.split = () => [{ waypoints: [{ x: 100, y: 0, elevation: 0 }], trigger: { enemyId: "fighter" } }, { waypoints: [{ x: 400, y: 0, elevation: 0 }], trigger: null }];
  d.owner = () => null; d.ask = async () => { throw new Error("no owner"); }; d.gmAttack = async (a, t) => { gmRolls.push([a, t]); return { hit: true }; };
  globalThis.fromUuidSync = () => ({});
  await runTurn(makeCombat([g1, combatant("pc", { disposition: 1, playerOwner: true })]), d);
  assert.deepEqual(gmRolls, [["A.ls", "T.g1"]]);
  assert.deepEqual(moves.map((m) => m[1].at(-1).x), [100, 400]);
});
```
And in `test/prompts.test.mjs`:
```js
test("the tunnelFighter socket handler attacks through Midi with the monster as the only target and no reaction check, passes on Pass, close or after 30 s", async () => {
  const uses = [];
  globalThis.MidiQOL = { completeActivityUse: async (a, cfg, dialog) => { uses.push([a.uuid, cfg.midiOptions, dialog]); return { hitTargets: new Set([{}]) }; } };
  globalThis.fromUuidSync = (uuid) => uuid === "A.ls" ? { uuid, name: "Longsword", actor: { name: "Fighter" } } : uuid === "T.g1" ? { name: "Goblin" } : null;
  const handlers = {};
  registerSockets({ register: (n, fn) => { handlers[n] = fn; } }, { startEncounter() {} });
  DialogStub.next = "attack";
  assert.deepEqual(await handlers.tunnelFighter("Actor.f", "A.ls", "T.g1"), { hit: true });
  assert.deepEqual(uses, [["A.ls", { targetUuids: ["T.g1"], ignoreUserTargets: true, proceedChecks: { checkAoO: false } }, { configure: false }]]);
  assert.ok(dialogs.at(-1).config.window.title.includes("Fighter") && dialogs.at(-1).config.window.title.includes("Goblin"));
  DialogStub.next = "pass";
  assert.deepEqual(await handlers.tunnelFighter("Actor.f", "A.ls", "T.g1"), { hit: false });
  assert.equal(uses.length, 1);
});
```
`DialogStub.wait` already calls `config.render`. The 30 s timer must not keep the test process alive: the handler keeps the timer id from `render` in a local and clears it once `wait` resolves (`let timer; const r = await DialogV2.wait({ ..., render: (ev, dialog) => { timer = setTimeout(() => dialog.close(), 30000); } }); clearTimeout(timer);`). The existing `registerSockets` test lists the handlers: add `tunnelFighter`. The lang-key test in `test/run.test.mjs` adds `Escaped` to the Autopilot keys. `brief` adds, per enemy, `oa{r10 dmg4.7 hit0.55 reaction tf}` (or `oa-`) and `sentinel`, and `me` adds `alone`, `speed`, the escape region's name or `no escape`.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `handlers.tunnelFighter` undefined, Dash flag not set, `updates` empty, `asks` empty.

- [ ] **Step 3: Implement in `scripts/prompts.js` and `scripts/ai/run.js`, add the lang strings (en and es)**

`run.js` imports `splitAtTunnelFighter` from `./plan.js` and `promptTunnelFighter, tunnelFighterAttack, activeOwner, awaitOrGm` from `../prompts.js`. `moveAll` becomes `Promise.all(list.map(moveOne))` where `moveOne` does the Dash flag, the segments and the prompts; `sentinelWatch` keeps watching the whole phase as before.

- [ ] **Step 4: Run the whole suite**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ai/run.js scripts/prompts.js lang/en.json lang/es.json test/run.test.mjs test/prompts.test.mjs
git commit -m "feat(autopilot): flight with Dash and escape regions, Tunnel Fighter prompts between move segments"
```

---

### Task 6: Docs, spec amendment and release 0.8.0

**Files:**
- Modify: `README.md`, `docs/SERVER-TESTING.md`, `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (append an amendment), `module.json`

- [ ] **Step 1: README**

In "Monster autopilot (piece 4)": a flee paragraph (threshold, type rule, boss rule, Dash, escape regions: "draw a Region on the scene and put *escape* in its name; a fleeing monster that steps into it leaves the fight: marked defeated and its token hidden"), the opportunity-attack estimate for clever monsters (reach, spent reactions, Sentinel stop chance, Tunnel Fighter extra attacks; the whisper shows the cost), the Tunnel Fighter prompt (stance = an active effect named "Tunnel Fighter" on the PC; Attack / Pass, 30 s, GM "Roll for them"), the three new settings in the settings list, and under "not counted": the flee move ignores opportunity attacks; a hidden enemy's opportunity attack; the escape path ignores difficult terrain.

- [ ] **Step 2: SERVER-TESTING section 7c (piece 4c, v0.8.0)**

C-steps on the goblin scene, each with the expected whisper and what to report:
- C1. Region named "Escape" 30 ft behind Goblin 1 (speed 30), goblin at 1 hp (of 7), Rogue adjacent, Intelligence 10, two PCs up: on its turn it Dashes into the region (Gambit prompts the Rogue's opportunity attack on the way; answer Yes, miss) and vanishes: tracker row defeated, token hidden, public line "Goblin 1 has escaped.", whisper "flee: Dash toward Escape (hp 1/7)", turn passes.
- C2. Same with the region 70 ft away: the goblin walks 60 ft and stops, still in the fight; next round it enters and escapes.
- C3. No escape region, goblin at 1 hp: it Dashes to the reachable square farthest from the party; whisper "flee: Dash away from enemies".
- C4. Goblin at 1 hp with Intelligence 10 and two goblin allies up against two PCs: no flight (not losing); Intelligence 5: flees. **Monsters flee** off: never flees.
- C5. Lone Ogre (no allies in the tracker) at 10 % hp: never flees.
- C6. Opportunity-attack estimate: Goblin 1 (Intelligence 10, Scimitar and Shortbow) adjacent to the Fighter (Longsword, reaction free), the Rogue 30 ft away: whisper shows "Scimitar vs Fighter (expected ...)" or "Shortbow vs Rogue (expected ...; opportunity attacks ...)" with the lower of the two chosen; report both numbers and the console line (the enemies' `oa` data is in it: add `oa` to `brief`).
- C7. Fighter's reaction spent (use it on the Fighter's turn through Midi, or set it with the Midi API): the goblin steps back and shoots with no cost shown.
- C8. Tunnel Fighter: an active effect named "Tunnel Fighter" on the Fighter (sheet, Effects tab), the Fighter's reaction spent, Goblin 1 adjacent and Intelligence 5 (so it walks regardless) with the Rogue 15 ft past the Fighter: the goblin walks one square (still adjacent), the Fighter's player gets "Fighter: attack Goblin 1 with Tunnel Fighter?"; Attack rolls a Longsword attack with no reaction prompt from Midi; after the roll the goblin walks on (miss) or, since the Fighter has Sentinel, stops where it is (hit). Report the prompt text, the GM's "Roll for them" dialog, and whether Gambit also prompted.
- C9. Tunnel Fighter with the reaction free: leaving the reach is Gambit's prompt; moving a second square inside the reach is the module's. Report which fired where.
- C10. Tunnel Fighter prompt left unanswered 30 s: it closes, the goblin walks on.

- [ ] **Step 3: Spec amendment**

Append `## Amendment 2026-11-05 (sub-piece 4c, v0.8.0)` listing: escaped monsters are marked defeated and hidden (not removed); "alone" from the roster, defeated included; the flee budget as Dash via piece 2's flag; the opportunity-attack cost applies to every candidate square of clever monsters and shows in the whisper; Tunnel Fighter triggers the autopilot prompts itself (the leaving-with-free-reaction trigger stays Gambit's pending the server check); the prompt's Midi call skips Midi's reaction check.

- [ ] **Step 4: `module.json` version 0.8.0; run the whole suite; commit; tag; push; release**

```bash
git add README.md docs/SERVER-TESTING.md docs/superpowers/specs/2026-11-04-monster-autopilot-design.md module.json
git commit -m "docs(autopilot): piece 4c (flight, escape regions, opportunity-attack estimate, Tunnel Fighter), v0.8.0"
git tag v0.8.0 && git push -q origin main v0.8.0 && bash tools/release.sh
```
Then hand the user the one-line `gh release create v0.8.0 ...` command; the web-session text comes after the release is verified (memory rule).
