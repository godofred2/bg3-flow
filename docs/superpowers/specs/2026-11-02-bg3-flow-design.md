# BG3 Flow: design spec

Date: 2026-11-02. Status: approved in conversation, pending written review.

## Goal

A Foundry VTT module that makes D&D 5e combat and exploration play like Baldur's Gate 3:
spells and attacks resolve with no confirmation clicks, ongoing areas keep hurting, consecutive
allies share one turn, movement is locked off-turn and budgeted on-turn, and preset enemy groups
pull the party into combat when they spot or hurt someone.

## Environment (fixed)

- Foundry VTT v14 (build 364), running in Docker on a remote server owned by a friend. No local install.
- System dnd5e 6.0.x (the only line that supports v14). **To confirm on the server.**
- Midi QOL 14.x. User has 14.0.10; must update to 14.6.x (Region behaviours were fixed through 14.6.3).
- Also active: DAE, Automated Animations, JB2A, Sequencer, Dice So Nice, Argon Combat HUD,
  Monk's Combat Marker, DFreds Convenient Effects, socketlib, libWrapper.

## Decisions taken with the user

| Topic | Decision |
|---|---|
| Damage engine | Reuse Midi QOL. Module configures it, never re-implements rolls or damage. |
| Turn grouping | BG3 style: consecutive combatants on the same side share one turn, regardless of initiative value. |
| Movement | Lock off-turn, plus a speed budget on-turn, reachable circle drawn on the map. |
| Exploration | Free movement. Damage to or from an encounter enemy starts combat. |
| Encounters | Preset enemy groups with a detection radius. Passive Perception vs Stealth when obscured or hidden; active Perception roll on line of sight. Hide action exists. |
| Absent players | Never auto-roll for them. GM sees a waiting notice with a manual-roll button. |
| Dice | Everything public: 3D dice and chat cards for all rolls, NPC saves included. |
| Monster autopilot | Deferred to a later piece 4. Design must not block it. |
| Build order | Feature 1, then 2, then 3. |

## Architecture

One module `bg3-flow`, plain ES modules, no build step.

```
bg3-flow/
  module.json              id bg3-flow, deps dnd5e >=6.0 <7, midi-qol >=14.6, lib-wrapper, socketlib
  scripts/main.js          registers settings, version gate, loads features by setting
  scripts/automation.js    feature 1: preset + friend-or-foe prompt
  scripts/turns.js         feature 2: grouping, shared turn, movement lock/budget, range circle
  scripts/encounters.js    feature 3: encounter marking, hide, detection, combat start
  scripts/rules.js         pure functions (no Foundry globals): grouping, budget maths, obscurement
  scripts/prompts.js       cross-client dialogs via socketlib (roll-or-type, initiative request)
  lang/en.json, lang/es.json
  test/rules.test.mjs      Node self-check for rules.js (node --test)
  docs/SERVER-TESTING.md   step-by-step manual test script for a Claude session with server access
  README.md                install, preset, spell setup guide (Spirit Guardians, Moonbeam, Cloud of Daggers)
```

Settings (world scope): `enableAutomation`, `enableTurns`, `enableEncounters` (booleans, default on),
`lockGmMovement` (default off), `defaultEncounterRadius` (default 60 ft), `obscuredDarkness` (darkness
level at or above which a point counts as obscured, default 0.5). Plus a GM-only button
"Apply BG3 automation preset".

Startup gate in `main.js`: if dnd5e < 6.0 or Midi < 14.6 or libWrapper/socketlib missing, show one
warning notification and return without registering any feature.

Every hook body is wrapped in try/catch that logs `[bg3-flow]` and never rethrows.

## Feature 1: full automation (`automation.js`)

### Preset button

Writes `game.settings.set("midi-qol","ConfigSettings", {...current, ...})` with:

| key | value | meaning |
|---|---|---|
| autoRollAttack, gmAutoAttack | true | attack rolls happen on use |
| autoRollDamage, gmAutoDamage | "onHit" | damage rolls when needed |
| autoFastForward, gmAutoFastForward | ["attack","damage","check","save","skill","tool"] | no roll dialogs |
| autoCheckHit | "all" | hits computed, shown to all |
| autoCheckSaves | "allShow" | saves computed, result and rolls shown |
| autoApplyDamage | "yes" | apply, no confirmation card |
| playerRollSaves | "nonePublic" | PC saves rolled automatically, public |
| rollNPCSaves | "auto" | NPC saves rolled automatically |
| autoTarget | "wallsBlock" | templates target every token inside, walls respected |
| hideRollDetails | "none" | nothing hidden |

Also sets `midi-qol.TargetConfirmation` off and dnd5e `initiativeGroupCombatants` false
(so dnd5e's own grouping doesn't fight feature 2). Exact key names are verified against the
installed Midi at implementation time; unknown keys are skipped with a console warning.

### Friend-or-foe prompt

Trigger: Midi hook `midi-qol.targetingComplete` (workflow is live and mutable).
Condition: `workflow.activity.target.affects.choice === true` and at least one target token
whose disposition equals the caster token's disposition.
Action: on the casting user's client, open a dialog with three buttons:
- **Enemies only**: remove same-disposition tokens from `workflow.targets` and from the user's targets.
- **Everyone**: keep.
- **Pick**: keep the dialog open with a checkbox per target; untick to remove.
After the choice, if `workflow.template` is a Region with a `midi-qol.regionActivity` behaviour,
update its `dispositionFilter` to match the choice so later rounds respect it.
Spells without the choice flag (Fireball) never prompt.

### Ongoing areas

No code. Midi 14's `midi-qol.regionActivity` behaviour (triggers: token enters, turn start;
attach to caster; once per turn per creature; disposition filter) already does it.
Deliverable: README section walking through setting it up on Spirit Guardians, Moonbeam and
Cloud of Daggers, and the Midi update instruction.

## Feature 2: BG3 turn flow (`turns.js`)

### Grouping

Pure function in `rules.js`: `groupBySide(turns) -> Array<{side, combatantIds[]}>` where `side` is
the token disposition and only runs of length >= 2 become groups.
On the GM client, on `combatStart`, `createCombatant`, `deleteCombatant`, and `updateCombatant`
with an initiative change: delete the module's groups (flagged `bg3-flow.auto`) and recreate
them via `combat.createEmbeddedDocuments("CombatantGroup", ...)` then assign `combatant.group`.
Group initiative = highest member initiative. Updates pass `{combatTurn: combat.turn}` so the
turn pointer doesn't move.

### Shared turn

Active set = members of `combat.combatant.group`, or the combatant alone.
Hook `combatTurn(combat, updateData)` (initiating client, mutable): if moving forward and the
target combatant shares the current group, set `updateData.turn` to the index of the first
combatant after the group (wrapping to next round if needed). Backward mirrors to the first
member of the previous group. Foundry delivers skipped turn events with `skipped: true`.
Accepted quirk: a skipped member standing in an ongoing area takes its turn-start damage at the
end of the group turn.
On `combatTurnChange` (GM client) when the new combatant is a group's first member:
`group.clearMovementHistories()` and clear the Dash flag on every member.

### Movement lock and budget

Hook `preMoveToken(doc, movement)` (initiating client, return false to veto):
1. No active combat on this scene, or token not in it: allow.
2. Movement action is `teleport`: allow.
3. Mover is GM and `lockGmMovement` is off: allow.
4. Combatant not in active set: veto, notify "Not your turn".
5. Budget check: `spent = doc.movementHistory cost total`, `cost = this move's cost`
   (from `movement`), `limit = actor.system.attributes.movement[action] * (dashFlag ? 2 : 1)`.
   If `spent + cost > limit`: veto, notify "Not enough movement: X of Y ft used".
   Pure function: `canMove({spent, cost, limit}) -> {ok, reason}` in `rules.js`.
   Cost comes from Foundry's measured path so difficult-terrain regions count automatically.

Dash flag (`flags.bg3-flow.dash` on the combatant): set by `dnd5e.postUseActivity` when the
item name matches the localized "Dash", or by a GM toggle in the combatant context menu.

### Reachable circle

When a user controls one of their tokens and that token is in the active set, draw a
semi-transparent circle of radius `limit - spent` around the token in a PIXI container on
`canvas.interface`; redraw on `moveToken` and on turn change; remove on release.
Deliberate simplification: a plain circle, not a wall-aware reach fill. The dnd5e drag ruler
colouring (green/yellow/red vs speed) remains the exact indicator.

### Known interaction

Argon Combat HUD and Monk's Combat Marker only know the single current combatant. Other active
members will see Argon say "not your turn" although they may act. Possible follow-up: libWrapper
patch of Argon's turn check. Not in scope now.

## Feature 3: encounters and stealth (`encounters.js`)

### Marking

Token-controls button "Mark as encounter" (GM). With tokens selected, dialog asks radius
(default from setting). Writes `flags.bg3-flow.encounter = {id, radius}` on each. Pressing it on
a marked token clears the flag. GM-only dashed circle drawn around marked tokens.

### Hide

Token HUD button for owned tokens. Opens the roll-or-type dialog ("Roll Stealth" rolls
`actor.rollSkill({skill:"ste"})` normally; or a number input). Stores
`flags.bg3-flow.stealth = {value, hidden: true}` and shows an eye-slash marker.
Cleared on: combat start, `dnd5e.postUseActivity` by that actor with an attack or save activity,
or pressing Hide again.

### Detection (GM client, on `moveToken` of a player-owned token, outside combat)

For every encounter group on the scene with an enemy within `radius` of the player token:
1. `obscured = stealth.hidden || darknessAt(playerCenter) >= obscuredDarkness`
   (`canvas.effects.getDarknessLevel`). Pure decision in `rules.js`: `isObscured({hidden, darkness, threshold})`.
2. Passive check, once per (player, group) until the player hides again: if obscured, get the
   player's Stealth value (existing flag or roll-or-type prompt). Each enemy's
   `actor.system.skills.prc.passive >= stealth` spots. Not obscured: no passive check.
3. Active check, once per enemy per player move: enemy has line of sight to the player
   (distance <= enemy sight range and no sight-blocking wall between centres, via
   `CONFIG.Canvas.polygonBackends.sight.testCollision(a, b, {type:"sight", mode:"any"})`).
   If the player is not obscured: spotted. Else enemy rolls Perception
   (`actor.rollSkill({skill:"prc"})`, public) against the player's Stealth value; meets or beats: spotted.
Simplification: no darkvision or lighting rules in line of sight; sight range and walls only. *Superseded by the 2026-11-03 amendment (BG3 sight rules) at the end of this document.*

### Damage trigger

Hook `dnd5e.applyDamage(actor, amount)`: outside combat, if the actor's token is an encounter
enemy, start combat for that group. Hook `midi-qol.RollComplete`: outside combat, if
`workflow.token` is an encounter enemy and it has hit targets, start combat.

### Starting combat

`startEncounter(groupId)`: create Combat on the scene; add every token with that encounter id
plus every token whose actor is a player character (type `character` with a player owner);
request initiative from each player via `prompts.js` (their client rolls so 3D dice show), GM
rolls NPCs; begin combat. Feature 2 then groups the sides. Stealth flags cleared. No surprise round.

### Prompts (`prompts.js`)

socketlib functions `promptSkill(userId, {skill, label})` and `promptInitiative(userId)`.
The owning player's client opens the dialog; result returned to the GM. No timeout: while
waiting, the GM sees a persistent notice "Waiting for Stealth from Name" with a
"Roll for them" button that resolves the wait with a GM-side roll.

## Testing

- `test/rules.test.mjs`: Node tests for `groupBySide`, `canMove`, `isObscured`. Runs locally
  with `node --test`.
- `docs/SERVER-TESTING.md`: manual script for a Claude session with server access. Per feature:
  setup (scratch world, scene with 2 PCs, 2 goblins, a cleric with Spirit Guardians), numbered
  steps, expected result per step, and what to report. Written with each feature.

## Deployment

Git repository on GitHub. Release = zip plus `module.json` with `manifest` and `download` URLs.
Friend installs once from the manifest URL; later versions update from Foundry's module list.
All settings are world scope, configured from the GM account.

## Out of scope (for now)

- Monster autopilot (piece 4): nearest-enemy pathing with Foundry's `findMovementPath` plus a
  Midi attack, per-combatant toggle, pause before attacking. Nothing in this spec blocks it.
- Wall-aware reach fill, darkvision in detection, surprise rounds, Argon/Monk's patches.


## Amendment 2026-11-02 (after first server run, v0.2.0)

Midi 14 creates the ongoing-area region, with its own disposition filter, before `midi-qol.targetingComplete` fires, and its entry triggers damage everyone inside at once. Asking after placement was therefore too late, and Midi forces its own confirmation dialog whenever "Allow choosing targets" is ticked. The prompt now runs in `midi-qol.preTargetingV2`, before the area is placed: two buttons (Enemies only, Everyone; the checkbox list is dropped because nobody is inside yet), Midi's confirmation is silenced for that use, and the choice is written into the per-use activity clone's `regionBehavior.dispositionFilter`, which Midi copies onto the region. No GM relay is needed, so the socket handler was removed.

## Amendment 2026-11-02 (feature 2 and reactions, v0.3.0)

- Reactions (Shield, Uncanny Dodge, Counterspell) are Midi QOL's reaction system; the preset switches it on with Midi's own quick-setup keys (30 s timeout, enforce once per round). Counterspell needs Gambit's Premades.
- Feature 2 rulings: groups are derived from `combat.turns` on every call instead of `CombatantGroup` documents (a chat line announces the shared turn); Dash is detected by item name (setting `dashNames`) plus an API `toggleDash` instead of a context-menu entry.

## Amendment 2026-11-03 (BG3 sight rules, v0.5.0)

Detection follows Baldur's Gate 3 instead of the passive-plus-active-roll scheme above (user ruling: "handle dim light like BG3"):

- Light at the player's destination square, via `canvas.effects.testInsideLight` / `testInsideDarkness` and the scene darkness level: **clear** (scene below the threshold, or inside a light's bright radius), **lightly obscured** (inside a light's dim radius only), **heavily obscured** (unlit on a dark scene, or inside a darkness source).
- Line of sight through walls is required for every level, including the passive check.
- A player who is not hiding is seen on sight. A hiding one: clear = spotted instantly; lightly obscured = spotted by an enemy whose passive Perception is strictly above the Stealth value; heavily obscured = not seen.
- Darkvision (`actor.system.attributes.senses.darkvision`, feet) within range lowers the level one step for that enemy.
- No Perception rolls and no Stealth prompt on movement any more: Stealth comes only from the Hide action, so the `promptSkill`/`closePrompt` sockets, the per-group `checked` list and the move queue are gone. `awaitOrGm` remains for initiative.
- Feature 2's turn-change handler now gates on the lead GM like feature 3 (no duplicate shared-turn chat with two GMs).
