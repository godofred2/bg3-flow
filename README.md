# BG3 Flow

Makes D&D 5e combat in Foundry VTT play like Baldur's Gate 3. Three features, each with its own on/off setting:

1. **Full automation** (shipped): a one-click Midi QOL preset for zero-prompt attacks, damage and saves with public dice, plus a friend-or-foe prompt for areas that let you choose targets.
2. **BG3 turn flow** (shipped): consecutive allies share one turn, movement is locked off-turn and budgeted on-turn, reachable range drawn on the map.
3. **Encounters and stealth** (planned): preset enemy groups that start combat when they spot or hurt a player, with Stealth versus Perception.

## Requirements

| Package | Version |
|---|---|
| Foundry VTT | 14 |
| dnd5e system | 6.0.x |
| Midi QOL | 14.6 or newer |
| DAE | 14.6 or newer (Midi 14.6 needs it; install from the `latest-dnd6` manifest: https://github.com/tposney/dae/releases/download/latest-dnd6/module.json, the old `latest-v14` manifest stays at 14.0.x and reports itself up to date) |
| libWrapper | any |
| socketlib | any |

The module disables itself with a warning if any of these is missing or too old. Check Midi's version first: the Region behaviours that make ongoing areas work were fixed through Midi 14.6.3.

## Install

Foundry: **Add-on Modules, Install Module**, paste the manifest URL and install:

```
https://github.com/godofred2/bg3-flow/releases/latest/download/module.json
```

Or download `module.zip` from the latest release and unzip it into `Data/modules/bg3-flow/`.

## Apply the BG3 automation preset

1. As GM, open **Configure Settings, BG3 Flow**.
2. Press **Apply BG3 automation preset** and confirm.

What it writes into Midi QOL:

| Midi setting | Value | Effect |
|---|---|---|
| Auto roll attack (player and GM) | on | attack rolls happen on use |
| Auto roll damage (player and GM) | Damage Roll Needed | damage rolls when the attack hits or the spell needs it |
| Auto fast forward (player and GM) | attack, damage, check, save, skill, tool | no roll dialogs at all |
| Auto check hits | Check, all see result | hit or miss computed and shown |
| Auto check saves | Result + Rolls | saves computed, everyone sees the dice |
| Auto apply damage | Yes | HP changes immediately |
| Player saves | None (public roll) | players' saves roll by themselves, dice shown |
| NPC saves | Auto | GM's monsters save by themselves |
| Template auto target | Walls Block | everyone inside the area is targeted, walls respected |
| GM attack and damage display, GM 3D dice | Full, Show | nothing hidden from players |
| Reactions (player and GM) | On, 30 s timeout, enforce once per round, record opportunity attacks | reaction prompts, see below |
| Auto-apply item effects | Apply and remove | Shield's +5 AC and Uncanny Dodge's half damage apply themselves |

It also turns off Midi's target confirmation and dnd5e's own initiative grouping. Every value can be changed afterwards in Midi's settings. Dice So Nice keeps animating every roll because the rolls stay public.

## Friend-or-foe prompt

For area spells that let the caster spare allies (Spirit Guardians is the classic one), the caster is asked **before the area is placed**:

- **Enemies only** (default, also what you get by closing the dialog): allies are never hit, at cast time or in later rounds.
- **Everyone**: nothing spared.

The answer is written into the Midi region behaviour created by that cast (its disposition filter), so the region's own entry and turn triggers respect it from the first second. The cast's own targets are filtered the same way. Midi's own target confirmation dialog is skipped for these spells.

**Setup, once per spell:** open the activity that places the area, Targeting section, tick **Override Target**, then tick **Allow choosing targets**. Leave the target type blank. Spells without that checkbox, such as Fireball, hit everyone inside with no prompt.

## Ongoing areas with Midi 14

Spirit Guardians, Moonbeam, Cloud of Daggers and similar spells damage whoever starts a turn inside or walks in. Midi 14 does this with a **Region behaviour** on the spell's activity. Nothing in this module replaces it; you only need the spells set up.

**Fastest path:** import the spell from Midi's sample items compendium (Compendium Packs, Midi QOL sample items). Spirit Guardians and Moonbeam there already carry the region behaviour. Replace the copy on the character sheet with the imported one.

**By hand**, on the activity that places the area:

1. Open the activity, go to the Midi QOL section and enable **Region Behaviour**.
2. Add two rules: trigger **Token Enters**, action **Use Activity**, pick the damage or save activity; and trigger **Turn Start**, same action.
3. Turn on **Once Per Turn**.
4. **Entry On Activation**: on if the cast itself does nothing to creatures already inside; off if the casting activity already rolls their save.
5. **Attach Region To**: caster, for Spirit Guardians and Moonbeam. Leave unattached for Cloud of Daggers.
6. **Disposition Filter**: Enemies for Spirit Guardians (the friend-or-foe prompt can change it per cast). All for Cloud of Daggers and Moonbeam.
7. Tick **Allow choosing targets** in the activity's Targeting section if the spell text lets you exclude creatures, so the prompt shows.

Midi runs the region's damage on the caster owner's client. If that player closes or hides their browser tab, ongoing damage waits until the tab is visible again. This is Midi's design, not something the module changes.

Details and the other options: Midi's README, section "Region Behaviour (AoE)": https://github.com/tposney/midi-qol#readme

## Reactions (Shield, Uncanny Dodge, Counterspell)

Midi QOL already asks a player whether to use a reaction; the preset only switches it on. When a creature with a reaction-type activity is hit (Shield), damaged (Uncanny Dodge, with the Midi condition `reaction === "isDamaged"` on the activity) or attacked, the owner gets a prompt with the attack roll visible, like BG3. No answer within 30 seconds means no reaction, so absent players never get rolled for. Counterspell reacts to someone else's spell, which Midi calls a "3rd party reaction": install the free module **Gambit's Premades** and use its Counterspell. Items from Midi's sample compendium already carry the right conditions.

## BG3 turn flow

With **BG3 turn flow** on:

- **Shared turns.** Consecutive combatants on the same side (same token disposition) act together, whatever their initiative numbers. Pressing next turn from the first member jumps past the whole group; a chat line **Shared turn: Cleric, Rogue** announces who may act. Going back lands on the first member of the previous group.
- **Movement lock.** During combat a player can only move tokens whose combatant is in the acting group. Others get "Not your turn". The GM is exempt unless **Lock GM movement too** is on. Teleport-style moves (blink, displace) are never checked.
- **Movement budget.** Each move is measured by Foundry (difficult terrain counts) and compared with the token's speed for the chosen movement action, walk as a floor like the dnd5e ruler. Over the limit: "Not enough movement: 20 of 30 ft already used" and the move is refused. Budgets reset when the group's turn starts.
- **Dash.** Using an item whose name is in **Dash item names** (default `Dash, Carrera, Correr`) doubles the budget until the group's next turn. For a monster without that item, a macro can call `game.modules.get("bg3-flow").api.toggleDash(combatant)`.
- **Reach circle.** A blue circle around a controlled token that may act shows how far it can still go. It is a plain circle, not a wall-aware fill; the dnd5e ruler colours stay the exact indicator.

Midi records an attack made off-turn as an opportunity attack and spends the attacker's reaction. During a shared turn the module tells Midi that every member of the acting group is on turn, so their attacks are normal attacks.

Argon Combat HUD and Monk's Combat Marker only know Foundry's single current combatant, so they will say "not your turn" to other members of the group. Ignore them; the module decides.

## Encounters and stealth

With **Encounters and stealth** on, exploration is free movement until an enemy group notices the party or blood is drawn, like BG3.

- **Marking.** Select the enemy tokens and press **Mark as encounter** in the token controls (GM only). A dialog asks the detection radius (default from settings). Every selected token gets the same group id; the GM sees a red circle of that radius around each. Press the button again with the same tokens selected to clear the mark.
- **Hide.** Owned tokens get an eye-slash button in the token HUD. It opens a dialog: **Roll Stealth** rolls the skill publicly, or type a value. The token gets dnd5e's *Hiding* status and keeps the value until combat starts, the actor completes an attack or save through Midi (hit or miss; a use Midi refuses, such as total cover, keeps you hidden), or Hide is pressed again.
- **Detection** runs on the GM client whenever a player-owned token moves outside combat, with BG3's sight rules. For every group with a live enemy inside its radius that has line of sight (no sight-blocking wall between the two tokens):
  1. A player who is not hiding is seen on sight, light or dark. Only **Hide** benefits from obscurity.
  2. The light at the player's square sets the obscurity: **clear** when the scene darkness is below **Obscured darkness threshold**, the square is inside a light's bright radius, or the scene's Global Illumination is active with *bright* ticked; **lightly obscured** inside a light's dim radius only, or under Global Illumination without *bright*; **heavily obscured** when unlit on a dark scene or inside a darkness source (magical darkness, which darkvision does not pierce).
  3. A hiding player in the clear is spotted instantly. Lightly obscured: spotted by any enemy whose passive Perception beats the Stealth value (meeting it stays hidden). Heavily obscured: not seen by sight at all.
  4. An enemy with darkvision (its sheet's senses) within its range sees one step better: dim light counts as clear and darkness as dim light.
- **Damage** to an encounter enemy outside combat, or an enemy hitting someone, starts its group's combat too.
- **Starting combat.** One combat with the group's live enemies and every player character on the scene. Each player rolls their own initiative on their client (3D dice show); the GM can take over with **Roll for them**, and rolls for anyone offline. NPCs roll on the GM. Stealth is cleared and the BG3 turn flow takes over.

Simplifications: no Perception rolls (passive only, like BG3), the token's own vision range is ignored, no surprise round. A chat line says who spotted whom.

## Monster autopilot (piece 4a)

With **Monster autopilot** on, every combatant whose actor has no player owner plays its own turn on the GM client, like a BG3 enemy:

1. The whole shared-turn group plans its movement at once (nobody takes a square a group mate already took) and moves together.
2. Each monster, in initiative order, looks at the enemies it can see (the same sight rules as detection: walls, light, darkvision, hidden Stealth against its passive Perception) and scores every single-target attack or save activity on its sheet by expected damage: hit chance (or save failure) times average damage. A ranged attack within 5 ft of its target counts its 5e disadvantage (hit chance squared), so a goblin next to you swings its scimitar instead of shooting. The best option wins; a *Multiattack* trait is read from its text ("one with its bite and one with its spear") and runs as a sequence. Ties go to the most wounded target when the monster's Intelligence reaches the **Intelligence threshold**, to the nearest one otherwise.
3. It stops on the first square of its path where the chosen ability is in range, uses it through Midi (cards, dice, damage as usual), and the next one acts. Nothing in range this turn: it walks its full movement toward the nearest visible enemy.
4. When every active monster was automatic, the turn passes by itself.

The GM gets a whispered line per monster ("Goblin: Scimitar vs Rogue (expected 2.5); also: Shortbow 2.0"), and the console gets a `[bg3-flow]` line per monster with what the planner saw (activities, enemies, distances, path lengths): read it first when a monster does something odd. A monster at 0 hit points does nothing more. The robot button on each NPC row of the combat tracker switches that monster's autopilot off (or back on) for the combat. **Pause before each monster action** opens a dialog before every use: Execute, Skip, or Take over (switches that monster off and stops).

Moving monsters trigger opportunity attacks through **Gambit's Premades** (enable its *Opportunity Attack* automation, then reload: Gambit reads that setting when the world loads): the monster's move waits for the sprite to arrive, so a reaction hold is respected. Reach and range are counted in squares between the two creatures' footprints (a diagonal neighbour is 5 ft, a Large creature reaches from its edge). A use Midi refuses or an error leaves that monster to the GM with a whispered note; the others continue.

When no route reaches the enemy's own square (a Large monster, an ally in the only corridor), routes to the free squares touching the enemy are tried and the shortest wins.

Not counted yet: areas, heals, bonus actions, recharge abilities, fleeing, resistances and vulnerabilities, advantage or disadvantage beyond the adjacent-shot rule, legendary and lair actions, ammunition, thrown weapons at range (a javelin counts as melee), difficult terrain cost, gridless scenes.

## Settings

- **Full automation**, **BG3 turn flow**, **Encounters and stealth**: feature toggles.
- **Lock GM movement too**, **Dash item names**: feature 2.
- **Default encounter radius**, **Obscured darkness threshold**: feature 3.
- **Monster autopilot**, **Pause before each monster action**, **Pass the turn automatically**, **Intelligence threshold**: piece 4.

## Development

```
npm test        # pure rules, no Foundry needed
```

Design specs: `docs/superpowers/specs/2026-11-02-bg3-flow-design.md` (pieces 1 to 3) and `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (piece 4). Server test script: `docs/SERVER-TESTING.md`.
