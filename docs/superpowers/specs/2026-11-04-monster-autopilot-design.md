# BG3 Flow piece 4: monster autopilot (design spec)

Date: 2026-11-04. Status: approved in conversation, pending written review.
Parent spec: `2026-11-02-bg3-flow-design.md` (pieces 1 to 3, server-tested at v0.5.1).

## Goal

In combat, every combatant that no player owns plays its own turn like a Baldur's Gate 3 enemy:
it moves, picks the ability with the best expected result against the targets it can see, uses it
through Midi QOL, and the turn passes. The GM watches, can pause before each attack, and can
take any monster back by hand. Plutonium-imported stat blocks work as imported: nothing to
configure per monster.

## Environment

Same as the parent spec (Foundry v14, dnd5e 6.0.x, Midi QOL 14.6) plus **Gambit's Premades 3.x**
with its *Opportunity Attack* automation enabled: it prompts the player when a monster leaves
their reach and already accounts for Sentinel, War Caster, Polearm Master, Mobile and Disengage.
The autopilot never implements opportunity attacks itself.

All module code runs on the GM's client (the lead GM, `game.users.activeGM?.isSelf`), like the
rest of the module. The planning cost is tens of activities times a few targets and squares;
Foundry's pathfinding also runs on the client. No server work.

## Decisions taken with the user

| Topic | Decision |
|---|---|
| GM role | Spectator by default: monsters move and act with no pauses. Setting `pauseBeforeAttack` (off) asks the GM before each use. Per-combatant switch to take a monster by hand. |
| Who is driven | Every combatant whose actor has no player owner (hostile and friendly NPCs alike). Switch per combatant in the combat tracker, default from `enableAutopilot`. |
| Brain | Expected-value scoring: for each available activity and each visible target, probability times average damage (or healing, counted as damage avoided), summed over the creatures an area covers. Highest wins. Heal and flee are not separate ladders: healing competes in the score; fleeing is a fixed rule on top. |
| Tie-break | Intelligence >= `intelligenceThreshold` (6): the target with the fewest hit points. Below: the nearest target. Second tie-break always nearest. |
| Resources | Spend everything: best available ability every turn, highest spell slot first. Recharge abilities are rolled at the start of the monster's turn (dnd5e recharge rules) and used as soon as they are back. |
| Multiattack | Parse the trait text ("makes two attacks: one with its bite and one with its spear"): count and attack names, used in order. Unparseable names: repeat the best attack *count* times. No count: a single attack. |
| Flee | Fixed rule, setting `fleeEnabled` (on), threshold `fleeThreshold` (25 % of max HP). Unintelligent: flee below the threshold even with allies up. Intelligent: flee below the threshold only when losing (more enemies standing than allies). A creature alone from the start of the combat (boss) never flees. |
| Escape routes | A Region whose name contains `escapeRegionName` ("escape", case-insensitive). A fleeing monster Dashes toward the nearest reachable one; on entering it the monster has escaped: removed from the combat, token hidden, chat line. No region: the reachable square farthest from all enemies. |
| Positioning | Stop at the first square of the path that puts the chosen ability in range. Intelligent creatures add two rules: a ranged attacker adjacent to an enemy steps out of melee reach first (4b), and only if what it gains beats the expected opportunity-attack damage (4c); areas aim at the enemy square covering the most enemies. |
| Group turns | With the shared turn of piece 2, movement of the whole group is planned at once (each monster sees its allies' reserved destinations as occupied) and animated together; actions then run one monster at a time. |
| Pacing | No fixed delay. The next action starts when Midi completes the use and Dice So Nice finishes animating its messages; movements wait for the token to arrive. |
| End of turn | Setting `autoNextTurn` (on): when every active combatant was on autopilot, pass the turn. Any manual member: finish the automatic ones and wait for the GM. |
| Feats by name (4c) | Two player feats the party has get name-based rules. **Sentinel**: Gambit rolls the opportunity attack; the autopilot stops a monster hit by a reaction from a Sentinel PC, and the 4c estimate knows Disengage does not avoid it and that a hit ends the monster's movement. **Tunnel Fighter** (UA fighting style, stance active = an active effect named "Tunnel Fighter" on the PC): opportunity attacks cost no reaction and any move of more than 5 ft inside the PC's reach draws a reaction attack. Gambit does not know this feat, so the autopilot prompts the player itself at the triggers Gambit would not. Both on the same PC: no reaction needed, Disengage useless, first hit stops the monster. |
| Legendary and lair actions | Out of scope: piece 5. |
| Sight | A monster only targets what the piece 3 rules let it see (`spotsBg3`: line of sight, light, darkvision, hidden Stealth vs passive Perception). |
| Transparency | One chat line whispered to the GM per monster and turn: decision, expected value, discarded alternatives. Players see only the move and Midi's cards. |

## Sub-pieces (each one a release and a server run)

- **4a core**: tracker switch, board snapshot, scoring of single-target attack and save activities,
  Multiattack from text, move and stop in range, approach when nothing scores, GM chat line,
  pause before attack, auto next turn.
- **4b**: areas, heals, bonus actions, recharge, smart positioning (ranged steps out, areas aim at
  clusters), waiting for Gambit's opportunity attack, Sentinel stop.
- **4c**: flee and morale, escape regions, opportunity-attack damage estimate before leaving reach,
  Sentinel and Tunnel Fighter rules (estimate and the Tunnel Fighter prompt).
- Piece 5 (later): legendary and lair actions.

## Architecture

New files, same conventions as the rest of the module (ES modules, every hook body wrapped in
`safe()`, world settings in `main.js`, strings in `lang/*.json`):

```
scripts/ai/board.js   Foundry-bound, read only: builds the board snapshot (tokens, activities, paths, sight)
scripts/ai/plan.js    pure functions, no Foundry globals: scoring, target and square choice, Multiattack, flee
scripts/ai/run.js     executes a plan: moves tokens, uses activities through Midi, waits, pauses, passes the turn; hooks
test/board.test.mjs   Foundry stubs (as test/encounters.test.mjs)
test/plan.test.mjs    invented boards
test/run.test.mjs     stubs for the sequencing
```

Settings (world): `enableAutopilot` (on), `pauseBeforeAttack` (off), `autoNextTurn` (on),
`intelligenceThreshold` (6), `fleeEnabled` (on), `fleeThreshold` (25), `escapeRegionName`
("escape").

## Board snapshot (`board.js`)

**Per combatant token:** id, side (disposition), position and elevation, hp and max hp, AC, saving
throw bonuses, Intelligence score, speeds, defeated, and the set of enemies it sees (`spotsBg3`
from piece 3, with the same light and wall inputs as `encounters.js`). For the acting monster:
the path to every enemy (Foundry pathfinding, cut at the movement budget) with the cost per
square, and the reserved destinations of its group.

**Per activity of the acting monster**, walking every item as Plutonium imports them (dnd5e 6
activities): kind (attack, save, heal, damage, utility), action slot (action, bonus, reaction;
legendary ignored), reach or range, area shape and size, attack bonus or save DC and ability,
half damage on a successful save, average damage (dice average plus flat, including the weapon's
base damage for attack activities), average healing, and availability: remaining uses, pending
recharge, a free spell slot of the needed level, ammunition. Unavailable activities are not in the
snapshot. A utility with no damage or healing (Nimble Escape) does not score; Multiattack is
detected by name and its description text is handed to the planner.

**Not in the snapshot:** target resistances and vulnerabilities, conditions (advantage or
disadvantage never enter the probability, except the fixed adjacent-archer rule), the players'
opportunity attacks (4c adds, per enemy, its best melee attack's expected damage against the
monster, its reach, whether its reaction is spent (Midi's `hasUsedReaction`), and the flags
`sentinel` (item named Sentinel) and `tunnelFighter` (active effect named Tunnel Fighter)).

**Probabilities:** hit = (21 + bonus - AC) / 20; save failed = (DC - 1 - save bonus) / 20; both
clamped to [0.05, 0.95]. Expected damage = probability times average damage (plus half the
average on a successful save when the activity says so), summed over every creature inside an
area. Expected healing = average healing capped at the target's missing hit points.

## Planner (`plan.js`)

Input: the snapshot plus the turn state (movement left, action and bonus action spent or not,
reserved destinations). Output:
`{ move: [squares], action: { activityId, targets }, bonus: { activityId, targets }, reason }`,
any part absent.

1. Flee (4c): if the rule fires, the plan is movement only (Dash toward the escape region or the
   farthest square) and stops.
2. For every available action activity and every visible target: the square it is used from (the
   first square of the path to the target that is in range; areas aim at an enemy's square and
   count everyone covered; heals aim at allies). Not reachable this turn: score 0. Score as above.
3. Multiattack: when present and its named attacks are available, it scores as the sum of those
   attacks, each against the best target in range from the same square, and competes as one more
   option.
4. Tie-break by Intelligence as decided. Second tie-break: nearest.
5. Smart positioning (4b, intelligent only): a ranged attacker adjacent to an enemy leaves melee
   reach first when it has the movement; in 4c only when the gain beats the opportunity-attack
   estimate. The estimate (4c) counts, for every enemy along the path, the trigger points its
   feats allow: leaving its reach costs one attack when its reaction is free, or always with
   Tunnel Fighter; with Tunnel Fighter every square of the path inside its reach beyond the first
   is one more attack. Each attack is that enemy's expected melee damage. With Sentinel a hit
   ends the movement, so the plan also loses whatever the move was going to gain beyond that
   point, weighted by the hit probability (a miss leaves the movement intact, so the stop is never counted in full). Simplification: successive trigger points are each counted as if the earlier ones missed. An intelligent monster adjacent to a Sentinel plus
   Tunnel Fighter PC therefore stays and fights unless the gain is large.
6. Bonus action: the best available bonus-action activity, scored the same way from the final
   square.
7. Nothing scores: Dash toward the nearest visible enemy. Nobody visible: stay, and the reason
   says so.

Group: movement of every member is planned in initiative order, each seeing the earlier members'
destinations as occupied. Actions are re-planned one by one with the real final positions.
Re-planning: after every executed action the rest of the turn is planned again (a dead target is
replaced).

## Execution (`run.js`)

**Trigger:** `combatTurnChange` on the lead GM, after piece 2 has reset the group's movement.
Active combatants = `activeIds(combat)` (piece 2) whose actor has no player owner, not defeated,
autopilot not switched off.

**Movement phase:** plan every member's movement, execute all moves at once with Foundry 14's
token movement API, tagging the operation as the autopilot's so the piece 2 lock and budget treat
it as a normal on-turn move. Each move is awaited until the token reaches its destination or the
move is cut, with a 45 s cap (30 s reaction timeout plus margin): Gambit's opportunity attack
holds the move while the player answers. A reaction hit from an actor with a *Sentinel* item
stops that monster where it is.

**Tunnel Fighter prompt (4c):** the path is split at the trigger points Gambit does not cover: a
move of more than 5 ft inside the reach of a PC whose Tunnel Fighter stance is active, or leaving
that reach when the PC's reaction is already spent. At each one the monster stops and the PC's
owner gets the module's roll-or-type style prompt ("Fighter: attack Goblin with Tunnel Fighter?"
with **Attack** and **Pass**, 30 s, GM takeover button as in piece 3). **Attack** uses the PC's
best melee attack activity against the monster on the owner's client through Midi (socketlib,
like `promptInitiative`); the autopilot awaits its `RollComplete`, applies the Sentinel stop on a
hit, and continues the path. Whether Gambit also prompts at the plain leaving-reach trigger when
the reaction is free is checked on the server; if it does, that trigger stays Gambit's.

**Action phase:** monster by monster in initiative order: re-plan, set the targets on the GM
client, use the activity through Midi with those targets, await its `midi-qol.RollComplete`, wait
for Dice So Nice (`game.dice3d.waitFor3DAnimationByMessageID`), then the bonus action the same
way. Multiattack is several uses in a row.

**Pause:** with `pauseBeforeAttack`, before each use a DialogV2 for the GM:
"Goblin: Scimitar vs Rogue (expected 4.2)" with **Execute**, **Skip** (this action) and
**Take over** (switches that monster's autopilot off for the rest of the combat and stops there).

**End of turn:** every active member was on autopilot and `autoNextTurn` on: `combat.nextTurn()`.
Otherwise the autopilot finishes its monsters and waits for the GM.

**Safety:** one run at a time. The run checks `combat.turn` before every step and stops silently
if the GM moved the turn by hand. Any error is logged, whispered to the GM, and leaves that monster
to the GM; the other monsters continue.

**Controls:** one icon per NPC combatant in the combat tracker toggling flag
`bg3-flow.autopilot` on the combatant (default from `enableAutopilot`). The whispered decision line.

## Testing

- `test/plan.test.mjs`: clamped hit and fail probabilities; attack expected damage; save with half
  damage; an area on two targets beating a single-target attack; healing as damage avoided;
  Multiattack from three SRD texts (gnoll, dragon, "makes two attacks") and the repeat fallback;
  Intelligence tie-break; stop at the first square in range; adjacent archer steps out only when
  intelligent; flee by type and toward the escape region; group with reserved destinations;
  "nobody visible"; opportunity-attack estimate: reaction spent means no attack, Tunnel Fighter
  counts the extra squares inside reach, Sentinel discounts the gain beyond the hit.
- `test/board.test.mjs` with Foundry stubs: a Plutonium goblin's activities (scimitar, shortbow),
  a caster with slots, a spent breath weapon absent from the snapshot, sight filtering a hidden PC.
- `test/run.test.mjs` with stubs: moves before actions, the pause's three buttons, abort when the
  turn changes, next turn only when everyone was on autopilot; the path split at Tunnel Fighter
  triggers, the prompt's Attack and Pass, the Sentinel stop on a hit.
- `docs/SERVER-TESTING.md` section 7 per sub-piece on the existing goblin scene: a goblin that
  closes and attacks, an archer that stays at range, a group of two moving together, the pause,
  the tracker icon, an opportunity attack through Gambit, and in 4c a flight to an "Escape" region
  plus a monster walking past the Sentinel and Tunnel Fighter PC with the stance active.
- README: what the autopilot does in one screen, the settings, how to mark an escape route,
  enabling Opportunity Attack in Gambit's Premades, and the list of what is not counted.

## Out of scope

Legendary and lair actions (piece 5); resistances and vulnerabilities in the score; advantage and
disadvantage in the probability; attack-then-retreat; summons cast by the autopilot itself;
feats that exist only as text (whatever Gambit, Chris's Premades, Midi or DAE automate as
activities or effects applies on its own, because the autopilot uses the sheet's activities and
Midi does the rest).

## Amendment 2026-11-05 (v0.6.0 server run, fixed in v0.6.1)

- dnd5e gives every item's default activity the same id (`dnd5eactivity000`) and Midi names it "Midi Attack": activities are identified by uuid and named after their item (plus the activity name when the item has several).
- `TokenDocument#move` resolves when the server applied the move, before the sprite arrives and before a Gambit reaction hold ends: the autopilot waits for the sprite to reach the document position (45 s cap) before acting or passing the turn.
- Reach and range are the fewest squares between the two creatures' footprints times the grid distance (5/5/5): `measurePath` snaps a Large token's centre (a grid vertex) to a whole square and put a diagonal neighbour at 7.5 ft.
- Observed, not changed: Midi's reaction prompts (Uncanny Dodge) hold the autopilot like any other use; the autopilot fires on combat start when a monster has the first turn; starting a combat reveals hidden tokens (piece 3 rule).

## Amendment 2026-11-05 (v0.6.1 server run, fixed in v0.6.2)

- `Token#x` is the document's x: arrival is awaited on `Token#movementAnimationPromise` (poll, 45 s cap), not on positions.
- A monster at 0 hit points (an opportunity attack on the way) plays nothing more.
- A ranged attack within 5 ft of its target counts its disadvantage (hit chance squared), which also settles the Scimitar/Shortbow tie next to the target.
- One `[bg3-flow]` console line per monster turn with the board the planner saw (activities, enemies, distances, path lengths): the Ogre's "approach" with a touching square could not be explained from the compendium data, so the next run reports that line.

## Amendment 2026-11-05 (v0.6.2 server run, fixed in v0.6.3)

- Foundry's pathfinder returns only the start when the goal cannot be reached, and the enemy's own square is never a reachable goal for a Large mover (nor for anyone when an ally fills the only corridor): the board then path-finds to every free square touching the enemy and keeps the shortest route. The Ogre's `path0` came from this.
- Thrown weapons keep counting as melee (the Javelin shows reach 5); deferred.

## Amendment 2026-11-05 (v0.7.0 server run, fixed in v0.7.1)

- Automatic uses pass `dialog.configure = false` to Midi (dnd5e's configuration dialog for slots and item uses never opens).
- An area use places its own template where the planner aimed it (cone or line from the caster toward the aim, anything else centred on the aim; cubes from the corner the way dnd5e draws them) and hands its uuid to Midi as `workflowOptions.templateUuid`: Midi then resolves targets and saves from the template instead of waiting for a placement that never comes. Instantaneous areas have their template removed afterwards.
- Templates on attack activities (Spiritual Weapon) are placements, not blasts: those activities are not used.
- A clever archer steps back on a tie between shooting from 10 ft and swinging adjacent (archers keep their distance).
- Sentinel stop also watches temporary hit points.
- Reach circles (piece 2) show for every active token the user can see; the GM sees them all.

## Amendment 2026-11-05 (v0.7.1 server run, fixed in v0.7.2)

- dnd5e 6's `TemplatePlacement.fromActivity` is an interactive preview (and `AbilityTemplate.fromActivity` is deprecated): the autopilot builds the template data itself (shape from `CONFIG.DND5E.areaTargetTypes`, size, direction, cone angle, ray width, dnd5e origin flags) and creates the document directly.
- A monster that stayed put during the group's movement phase keeps its budget and may still walk when it acts (its touch-heal target may have walked off with the group).
- A token a reaction left between squares is snapped to the square under its centre after the move.
- The public shared-turn line leaves GM-hidden tokens out.
- Deferred: a one-square step out of reach finishes before Gambit's prompt opens, so the archer may shoot before the opportunity attack resolves; no GM-side signal of a pending player prompt exists.

## Amendment 2026-11-05 (v0.7.2 server run, fixed in v0.7.3)

- Midi clears the template list right after reading `workflowOptions.templateUuid`, so a pre-placed template left the workflow waiting. The template document is now handed over as `activity.templates` (what dnd5e's own "Place Measured Template" produces): Midi's `processPlacedTemplates` links it, auto-targets from it and resumes.
- A use Midi never finishes is given up after 60 s (template removed, error whispered, monster left to the GM) so one stall never blocks the session.
- Cone and line lengths are straight-line distance again, matching the Foundry template Midi targets from; the planner evaluates every firing square, so a near miss moves it one square closer instead of counting a creature the template would not.

## Amendment 2026-11-05 (v0.7.3 server run, fixed in v0.7.4)

- Midi runs a use on a clone of the item's activity (`item.clone({}, { keepId: true })`) and reads `templates` on that clone; dnd5e announces it through `dnd5e.preUseActivity`. The autopilot attaches the placed template document there, for the length of the use only.
- A centre exactly on the cone's 26.57 degree edge ray is outside, as Foundry's template leaves it: the planner uses a hair less than the half angle.

## Amendment 2026-11-05 (v0.7.4 server run: 4b green; v0.7.5)

- B1 and B8 resolved on the server (template linked, save cards, damage, template removed). The caster had been inside its own cone (the template started at its centre): cones and lines now start at the edge of the caster's space, half its width toward the aim, in the planner and in the placed template alike.
- Sub-piece 4b closed at v0.7.5.

## Amendment 2026-11-05 (sub-piece 4c, v0.8.0)

- An escaped monster is marked defeated and its token hidden (one public chat line), not removed from the combat: the "alone from the start" rule reads the roster (defeated included), and the GM can bring it back.
- The flee budget is piece 2's Dash flag (movement doubled for the turn); no Dash item is used. The bonus action is still planned while fleeing. Nowhere to go: the normal plan follows (a cornered creature fights).
- The opportunity-attack cost applies to every candidate square an intelligent monster evaluates (path, retreat and area firing squares) and shows in the whisper ("; opportunity attacks 2.1"); dumb monsters and the flee move ignore it. Sentinel scales the option's value by the miss chance per trigger; the damage of every trigger is counted in full.
- Tunnel Fighter triggers the autopilot prompts itself: a second (and later) square inside the stance's reach, and leaving it with the reaction already spent. Leaving with a free reaction stays Gambit's (to be confirmed on the server: F9). The prompt's Midi use passes `proceedChecks.checkAoO: false`, so Midi neither demands nor spends the reaction.
- Settings `fleeEnabled` (on), `fleeThreshold` (25), `escapeRegionName` ("escape") as designed. Deferred: a Dash when merely approaching (paths are cut at the walking budget).

## Amendment 2026-11-05 (v0.8.0 server run: 4c mostly green; v0.8.2)

- F2-F5, F8, F10-F12 green on v0.8.0 (flight, escape regions, Large fleer, Tunnel Fighter prompt, GM fallback, 30 s close, one prompt at a time).
- A ranged attack is at disadvantage when any visible standing enemy is within 5 ft of the shooter, not only its target (the goblin next to the Fighter shooting the Rogue): this is what makes the clever archer step away from a bystander once the step pays.
- Tunnel Fighter: the first square walked inside the stance's reach is free (5 ft); every further square inside it is a trigger, whether the monster started inside or entered.
- The flee decision is whispered before the move, not after.
- F1 as written could not pass by the spec's own rules (a lone monster never flees; two standing goblins against two PCs is not losing): the step now keeps Goblin 2 in the combat as defeated.

## Amendment 2026-11-06 (v0.8.2 server run; v0.8.3)

- F1, F9 green; F6/F7 moved right but the whisper was the re-plan's (from the new square, budget 0: no toll, no alternatives) and came after the step. Now every plan's decision is whispered before it runs, and the re-plan from the new square is whispered only when it changes the action (activity or targets).
- T13: a defeated member of the shared turn kept Foundry's turn marker. `activeIds` now leaves defeated combatants out (tracker defeat or the dead status), so the marker, the reach circle and the Midi opportunity-attack exemption all drop them; the markers and circles also refresh on createActiveEffect/deleteActiveEffect (Midi's dead status at 0 hp touches no combatant).

## Amendment 2026-11-06 (v0.8.3 server run: 4c green)

- F6 (AC 25), F7 and the T13 defeated sub-step green. The guide's whisper numbers were wrong, not the planner: a Sentinel stop (5 % at AC 25) discounts the retreat shot (3.3 x 0.95 - 0.4 = 2.8), and the "also:" line names each activity's best option (the Scimitar's is the 30 ft walk to the Rogue, 3.3, not the adjacent Fighter, 1.6). Piece 4c is closed.

## Amendment 2026-11-06 (piece 5, v0.9.0: lair actions; legendary monsters stay the DM's; Enlarge house rule)

- User decision: no legendary actions on the autopilot. A monster with legendary actions (`resources.legact.max > 0`) is off the autopilot unless its combatant flag says `true` (the tracker's robot button sets the flag to the opposite of the current state); its group is not auto-passed. The module never takes legendary actions.
- Lair actions, automated for the biggest impact: at the top of every round (round 1 included, before the first turn plays, under the autopilot's `running` guard; RAW "initiative 20, losing ties" becomes "before everyone"), every combatant with a token on the scene that is not player-owned, not defeated, above 0 hp and in its lair takes one lair action, whether or not it is on the autopilot. "In its lair": 2024 rules for the actor (`source.rules`, else the world's) need `lair.value && lair.inside`; 2014 rules a lair initiative (or the flag).
- The lair action: from where the monster stands (no move), the best-scoring `lair` activity except the one used last round (combatant flag `lairLast`, cleared by a round with no lair action). A lair activity with no range on its sheet reaches anywhere (`Infinity`); a sheet range is honoured; a `self` area keeps `area.size`. A condition-only save is scored as `threat × fail chance × denial` (kind `deny`, lair slot only): `threat` is the target's best action against the monster (Extra Attack doubles it) plus its best heal; `denial` the share of a turn the condition takes, from the statuses of the activity's effects (paralyzed, stunned, incapacitated, unconscious, petrified 1; restrained, blinded, frightened, poisoned, prone 0.5; grappled, deafened 0.1; none on the sheet 0.5). Pure utility (no save) is not scored. Threat does not touch the ordinary turn's targeting (user decision).
- The GM hears the lair every round: `lair: <name> vs <aim> (expected|denies X); also: ...; not scored: <lair actions with no score>` or `lair: nothing to score; by hand: <names>`. Setting `lairActions` (on).
- Enlarge house rule (user request, outside the autopilot, `scripts/houserules.js`): on `preCreateActiveEffect`, an effect named like Enlarge/Agrandar with a `1d4` weapon damage bonus (melee or thrown, legacy or new key, no conditions) gets that change rewritten into `@abilities.str.mod` with the condition `roll.ability == str` and `1d4` with the negated condition; dnd5e 6's rule conditions apply the right one at roll time. Effects already present or edited by hand are left alone. Setting `enlargeStrength` (on).
- Out of scope: legendary actions and resistances, mythic actions, lair actions with no save, threat beyond the sheet's activities, initiative-20 ties, regional effects.

## Amendment 2026-11-06 (v0.9.0 server run; v0.9.1)

- L1, L2, L5, L6, L7 green; L3, L4 green with notes; L8 and H1/H2 failed; L9 partial (model right, guide wrong).
- Lair range: the activity sheet offers no blank range; the default *Self* with no area now also means "anywhere in the lair".
- "In its lair" follows the world's rules version, as the NPC sheet does (a 2014 statblock in a modern world uses the *Inside lair* switch).
- A `combatTurnChange` that arrives while a run is busy (a use waiting on a Midi dialog) is kept and replayed when the run ends (its lair on a round change, then the new turn's monsters); before, it was dropped silently.
- Enlarge: dnd5e 6 checks an attribute change's conditions at data preparation, with no roll in sight, so the conditional bonuses never saw the Strength attack. The rewrite now produces one rule pair (`type: "dnd5e.bonus"`, `key: "damage"`, collected at every damage roll and filtered with that roll's data: weapon classification and ability), replacing every 1d4 weapon damage bonus of the effect.
- Threat model confirmed on the server (Cleric with Fireball 27.5, Fighter with Extra Attack 14.8, Rogue 3.3): the condition goes to the Cleric, which is the point.
