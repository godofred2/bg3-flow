# BG3 Flow, Feature 2 (turn flow, movement, reactions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consecutive same-side combatants share one turn, tokens cannot move off-turn and have a speed budget on-turn (Dash doubles it) with a reachable circle on the map, and Midi's reaction prompts (Shield, Uncanny Dodge, Counterspell with premades) are switched on by the preset.

**Architecture:** Pure decisions in `scripts/rules.js` (grouping, turn jump, speed limit, budget check) tested with `node --test`. `scripts/turns.js` wires Foundry hooks (`combatTurn`, `combatTurnChange`, `preMoveToken`, `moveToken`, `controlToken`, `dnd5e.postUseActivity`) around them. Groups are computed from `combat.turns` on every call, never persisted (ruling below). Reactions are a preset change only: Midi already prompts.

**Tech Stack:** Foundry VTT v14 API (token movement operations, combat turn hooks), dnd5e 6.0.x (`system.attributes.movement.speeds`), Midi QOL 14.6.x reaction settings, Node `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-02-bg3-flow-design.md` (Feature 2 plus amendment for reactions)

## Global Constraints

- Same as feature 1 plan: module id `bg3-flow`, hooks wrapped in `safe()`, strings through `game.i18n.localize`, world-scope settings, no new dependencies, no bundler.
- Movement cost and spent movement come from Foundry's measured paths (`movement.passed.cost + movement.pending.cost`, `movement.history.cost`), never from our own distance maths.
- Speed limit follows dnd5e's ruler rule: `speeds[action]`, with walk fallback when `CONFIG.DND5E.movementTypes[action]?.walkFallback` or the action is unknown to dnd5e; teleport actions (`CONFIG.Token.movement.actions[action]?.teleport`) are free.
- Never auto-roll for absent players: reaction prompts use Midi's 30 s timeout and simply expire.

## Rulings (deviations from the spec, with cost if wrong)

1. **No `CombatantGroup` documents.** Groups are derived from `combat.turns` each time. Cost if wrong: the combat tracker shows no visual grouping; instead a chat message at group start names the members.
2. **No combatant context-menu Dash toggle** (hook name unverified in v14). Dash is detected by item name (setting `dashNames`, comma list) and exposed as `game.modules.get("bg3-flow").api.toggleDash(combatant)` for a macro. Cost if wrong: GM needs a macro or the Dash item on NPCs.
3. **Reactions** are Midi's own system: the preset copies Midi's "Turn on Reaction processing" keys. Counterspell needs Gambit's Premades (documented). Cost if wrong: nothing to undo, keys are plain settings.

## Review Focus

1. Combat with a single combatant or no groups: `jumpTurn` must return null and Foundry's own next turn must proceed (test `jumpTurn no group`).
2. Group at the end of the order: forward jump must wrap to turn 0 of the next round (test `jumpTurn wraps round`).
3. Token with no actor or zero speed in combat: movement must be allowed, not vetoed by a 0 budget (test `speedLimit no speeds`, `canMove zero limit allows`).
4. Mid-group manual turn set by the GM: `combatTurnChange` must not clear histories or post the message unless the new combatant is the group's first member (test `isGroupStart`).
5. Movement outside combat and teleport actions: always allowed (turns.js guard, verified on server T1, T8).

---

### Task 1: Pure rules for grouping, turn jump, speed and budget

**Files:**
- Modify: `scripts/rules.js`, `test/rules.test.mjs`

**Interfaces:**
- Produces:
  - `groupBySide(turns: {id, side}[]) -> {side, ids: string[]}[]` runs of length >= 2 only, no wrap across the round boundary.
  - `groupOf(groups, id) -> {side, ids} | null`
  - `jumpTurn({turns, groups, turn, direction}) -> {turn, roundDelta} | null` forward: index after the current group's last member (roundDelta 1 and turn 0 when past the end); backward: index of the first member of the group containing `turn - 1` (or `turn - 1` itself); null when the current combatant is not in a group (forward) or `turn - 1` is not in a group (backward).
  - `isGroupStart(groups, turns, turn) -> boolean` true when `turns[turn]` is the first id of its group.
  - `speedLimit({speeds, action, walkFallback, dash}) -> number` dnd5e rule, times 2 when dash; 0 when no speeds.
  - `canMove({spent, cost, limit}) -> {ok, reason}` reason `"budget"` when `limit > 0 && spent + cost > limit + 1e-6`; `ok` true when limit is 0.

- [ ] Step 1: write failing tests (groupBySide runs, groupBySide no wrap, jumpTurn forward inside group, jumpTurn wraps round, jumpTurn backward, jumpTurn no group, isGroupStart, speedLimit walk fallback, speedLimit no speeds, speedLimit dash, canMove ok/budget/zero limit allows)
- [ ] Step 2: `npm test`, expect import failures
- [ ] Step 3: implement in `rules.js`
- [ ] Step 4: `npm test`, expect pass
- [ ] Step 5: commit `feat: turn grouping and movement budget rules`

### Task 2: turns.js hooks, settings, API

**Files:**
- Create: `scripts/turns.js`
- Modify: `scripts/main.js` (setting `dashNames` string default `"Dash, Carrera, Correr"`, register turns when `enableTurns`, expose api), `lang/en.json`, `lang/es.json`, `test/turns.test.mjs` (stubbed globals for `onCombatTurn`, `onPreMoveToken`, `onCombatTurnChange`)

**Interfaces:**
- Produces `turns.js` exports: `onCombatTurn(combat, updateData, updateOptions)`, `onCombatTurnChange(combat, prior, current)`, `onPreMoveToken(doc, movement)`, `onPostUseActivity(activity)`, `toggleDash(combatant)`, `registerTurns()`, `drawReach()` (no-op outside canvas).
- Dash flag: `combatant.flags["bg3-flow"].dash` boolean.
- Combatant lookup: `combatantFor(doc) = game.combat?.started ? game.combat.combatants.find(c => c.tokenId === doc.id && c.sceneId === doc.parent?.id) : null`.

- [ ] Step 1: failing tests: combatTurn forward sets updateData.turn past the group; preMoveToken vetoes off-turn token for a player, allows GM when lockGmMovement off, vetoes over budget with the warning key, allows teleport action; combatTurnChange at group start clears histories of members and posts one chat message, not at mid-group.
- [ ] Step 2: run, expect failure
- [ ] Step 3: implement `turns.js`, settings and strings
- [ ] Step 4: run, expect pass
- [ ] Step 5: commit `feat: shared turns, movement lock and budget, reach circle`

### Task 3: Reactions in the preset, docs, test script, release

**Files:**
- Modify: `scripts/rules.js` (`MIDI_PRESET` adds `doReactions: "all", gmDoReactions: "all", reactionTimeout: 30, showReactionAttackRoll: "all", enforceReactions: "all", recordAOO: "all"`), `test/rules.test.mjs`, `README.md` (feature 2 section, reactions section), `docs/SERVER-TESTING.md` (section 4 turns T1 to T10, section 5 reactions R1 to R3), spec amendment, `module.json` version `0.3.0`, `lang/*.json` preset confirm text mentions reactions.

- [ ] Step 1: failing test for the new preset keys
- [ ] Step 2: implement, docs
- [ ] Step 3: `npm test` green, commit `feat: reaction prompts in the preset, feature 2 docs`, tag `v0.3.0`
