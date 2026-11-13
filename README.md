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

**Target picker.** Every single-target spell or attack (Sacred Flame, Cure Wounds, a sword) picks its targets when used: an orange circle shows its range from the edge of your space, a notice says how many targets it takes, and you click the creatures you want (a target out of range is refused with its distance). Targets left marked from the last use are dropped as the circle appears, so a heal followed by an attack never goes to the ally again (v0.12.0; before, marked targets skipped the picker; the pick also replaces the snapshot of the targets Midi takes at the start of the use, `workflowOptions.preSelectedTargetUuids`, which `setupTargets` prefers to the marks on screen). For a spell with several targets, Enter confirms fewer (Scorching Ray, all rays at one goblin). A spell cast at a higher level that buys more targets (Hold Person, Bane) asks for the extra ones once the slot is chosen, the first targets kept: the data's scaled count, or the "one additional creature" text (the SRD, Midi sample and 2024 items all carry a plain count, so the text is the usual path); at least the level's own targets, whatever Enter declined before (v0.13.0, at `midi-qol.targetingComplete`: the card is up and the slot spent, so Esc there keeps the targets you have). Then the dice roll and the effect lands on them, as in BG3. Esc or a right click cancels the use before anything is spent. Areas keep their template; self spells, reactions and anything used off the creature's turn with its targets already set (the autopilot, Gambit's opportunity attacks and reaction prompts) are untouched. Setting *Target picker*.

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
- **Ending the shared turn.** A player's End turn (the tracker's button, or the chequered-flag button in the token HUD that every member of the shared turn gets) ends only their own part: they are told who is still to act, and the group's turn moves on when every connected player of the group has ended (the lead GM's client advances the pointer) or when the GM presses next. NPC allies, absent players and the dead are not waited for. Setting *Shared turn ends when every player is done* (v0.14.0).
- **Reach circle.** A blue circle around every token that may act now shows how far it can still go, selected or not: each player sees the circles of the active tokens their vision shows them (a hidden or unseen enemy gives nothing away), the GM sees them all. It is a plain circle, not a wall-aware fill; the dnd5e ruler colours stay the exact indicator.
- **Turn marker on the whole group.** Foundry's own turn marker (core setting *Turn Marker*, under the token) normally sits on the one current combatant; during a shared turn every member of the group shows it, with the same image and animation, and it leaves them all when the turn passes. A token whose own turn marker is disabled, or the core setting off, shows none; neither does a defeated member (the tracker's defeat, or the dead status).

Midi records an attack made off-turn as an opportunity attack and spends the attacker's reaction. During a shared turn the module tells Midi that every member of the acting group is on turn, so their attacks are normal attacks.

Argon Combat HUD and Monk's Combat Marker only know Foundry's single current combatant, so they will say "not your turn" to other members of the group. Ignore them; the module decides.

## Action economy (piece 6)

Like BG3: above every token of the acting group, a **green dot** is its action and an **orange triangle** its bonus action, filled while available and hollow grey once spent (seen by whoever sees the token, like the reach circle). The rules behind them:

- One action and one bonus action per turn of the group; movement is piece 2's budget and the reaction is Midi's (the preset enforces it).
- **Extra Attack** (a feature named *Extra Attack*, *Ataque extra* or *Ataque adicional*): two weapon attacks inside the action, three with 11 fighter levels, four with 20. Once the creature has attacked, its action is the Attack action: no spell or other action-type use on top. Any other action-type use spends the whole action.
- An attack rolled in dnd5e's **off-hand** mode spends the bonus action instead of an attack of the action. A light weapon (one that offers the off-hand mode) swung once the action's attacks are done is taken as that off-hand swing whatever mode was picked: it costs the bonus action. A weapon without the mode (a Longsword) is refused.
- **Action Surge** (*Acción impetuosa*) grants one extra action this turn, attacks counting from zero again.
- Free: reactions, legendary and lair actions, anything with no activation or a special one.
- A **player** whose action or bonus action is spent gets "X has no action left this turn" and the use is dropped before anything is spent (Midi's `preTargetingV2`, before the target picker). The **GM** is only warned and goes ahead (the state stays spent, it never goes negative). A non-attack use is paid as soon as its card is up (`dnd5e.postUseActivity`), an attack as soon as its attack roll is in (`AttackRollComplete`): a second use started while the first still rolls is refused. Monsters on the autopilot are never checked (the planner spends one action and one bonus action by itself). Uses off the creature's turn (a reaction, an opportunity attack) are never counted. The **Hide** button costs the action, or the bonus action with Cunning Action (as in BG3): refused or warned the same way, before the Stealth dialog; free out of combat and off turn (v0.14.0).
- Everything resets when the group's turn starts and when combat starts.

Setting **Action economy**: *Players stopped, GM warned* (default), *Icons only*, *Off*. Not covered: the bonus-action-spell rule, Ready, Haste's extra action.

## Encounters and stealth

With **Encounters and stealth** on, exploration is free movement until an enemy group notices the party or blood is drawn, like BG3.

- **Marking.** Select the enemy tokens and press **Mark as encounter** in the token controls (GM only). A dialog asks the detection radius (default from settings). Every selected token gets the same group id; the GM sees a red circle of that radius around each. Press the button again with the same tokens selected to clear the mark.
- **Hide.** Owned tokens get an eye-slash button in the token HUD. In combat, on the creature's turn, it costs the action (the bonus action with Cunning Action) through the action economy. It opens a dialog: **Roll Stealth** rolls the skill publicly, or type a value. The token gets dnd5e's *Hiding* status and keeps the value until combat starts, the actor completes an attack or save through Midi (hit or miss; a use Midi refuses, such as total cover, keeps you hidden), or Hide is pressed again. The Hiding effect carries Midi's attack-advantage flag (`flags.midi-qol.advantage.attack.all`, added when Hide is pressed; Midi 14.6.8's own hidden-advantage rule only reads token vision, which monsters rarely have), so the attack rolls with advantage and a Sneak Attack automation that asks for advantage fires on it (v0.13.1).
- **Detection** runs on the GM client whenever a player-owned token moves outside combat, with BG3's sight rules. For every group with a live enemy inside its radius that has line of sight (no sight-blocking wall between the two tokens):
  1. A player who is not hiding is seen on sight, light or dark. Only **Hide** benefits from obscurity.
  2. The light at the player's square sets the obscurity: **clear** when the scene darkness is below **Obscured darkness threshold**, the square is inside a light's bright radius, or the scene's Global Illumination is active with *bright* ticked; **lightly obscured** inside a light's dim radius only, or under Global Illumination without *bright*; **heavily obscured** when unlit on a dark scene or inside a darkness source (magical darkness, which darkvision does not pierce).
  3. A hiding player in the clear is spotted instantly. Lightly obscured: spotted by any enemy whose passive Perception beats the Stealth value (meeting it stays hidden). Heavily obscured: not seen by sight at all.
  4. An enemy with darkvision (its sheet's senses) within its range sees one step better: dim light counts as clear and darkness as dim light.
- **Damage** to an encounter enemy outside combat, or an enemy hitting someone, starts its group's combat too.
- **Starting combat.** One combat with the group's live enemies and every player character on the scene. Each player rolls their own initiative on their client (3D dice show); the GM can take over with **Roll for them**, and rolls for anyone offline. NPCs roll on the GM. Stealth is cleared and the BG3 turn flow takes over.

Simplifications: no Perception rolls (passive only, like BG3), the token's own vision range is ignored, no surprise round. A chat line says who spotted whom.

## Monster autopilot (piece 4)

With **Monster autopilot** on, every combatant whose actor has no player owner plays its own turn on the GM client, like a BG3 enemy:

1. At the start of its turn it rolls recharge (5-6) for its spent recharge abilities (Breath Weapon). Leave dnd5e's *NPC auto recharge* world setting at "no", its default: the autopilot rolls it itself so the roll always lands before the plan.
2. The whole shared-turn group plans its movement at once (nobody takes a square a group mate already took) and moves together. Moving monsters trigger opportunity attacks through **Gambit's Premades** (enable its *Opportunity Attack* automation, then reload: Gambit reads that setting when the world loads); the monster waits for the sprite to arrive, so a reaction hold is respected. A hit from a reaction by someone with a *Sentinel* item stops the monster where it was caught.
3. Each monster, in initiative order, looks at the enemies it can see (the same sight rules as detection: walls, light, darkvision, hidden Stealth against its passive Perception) and scores every activity on its sheet by expected value:
   - attacks and saves: hit chance (or save failure) times average damage; a ranged attack with any visible enemy within 5 ft of the shooter counts its disadvantage (hit chance squared), whoever the target is, so a goblin next to you swings its scimitar instead of shooting;
   - areas (Fireball, a breath cone, a lightning line): aimed at each visible enemy in turn from every square in range, everyone covered counts, allies and the monster itself count against, and an area that only catches allies is never used. Coverage is geometry on token centres (sphere and cylinder by distance, cube by square distance, cone 53° and line by its width, both starting at the edge of the monster's space and measured in a straight line like the template Foundry draws, so the monster never stands in its own breath) and the use goes through Midi with every covered creature as a target, allies included (friendly fire is real); the autopilot places the template itself where it aimed and hands it to Midi the way dnd5e's own placement does (Midi targets and resolves the saves from it, with no dialog), removing it afterwards when the effect is instantaneous; a use Midi never finishes is given up after 180 s (a chain of player reactions can take over a minute); enemies the monster cannot see are neither counted nor hit; self emanations (Spirit Guardians), walls and templates on attacks (Spiritual Weapon) stay manual;
   - heals (Cure Wounds, a potion in the sheet): aimed at the most wounded ally in range, the monster included, worth the hit points actually recovered; self-only heals heal the monster. Allies are the same-side combatants: a token outside the combat is nobody's ally.
   The best option wins; a *Multiattack* trait is read from its text ("one with its bite and one with its spear") and runs as a sequence. Ties go to the most wounded target when the monster's Intelligence reaches the **Intelligence threshold**, to the nearest one otherwise.
4. It stops on the first square of its path where the chosen ability is in range (a Large creature from its edge, diagonals count as 5 ft), uses it through Midi (cards, dice, damage as usual), then spends its bonus action the same way (Healing Word on a wounded ally, an off-hand attack). A clever ranged attacker standing next to an enemy steps back to a free square 10 ft from everyone and shoots when that is worth at least as much as swinging; a dumb one swings. A thrown melee weapon (a javelin, Plutonium's split "Javelin (Ranged)" included) is both a melee option at its reach and a ranged option at its thrown range, used in dnd5e's thrown attack mode. No configuration dialog ever opens for an automatic use (spell level and slot are dnd5e's defaults). Nothing in range this turn: it walks its full movement toward the nearest visible enemy. A route Foundry draws through an enemy's space is replaced by a detour around it (a creature's space cannot be walked through, so the move would be refused; allies are walked through).
5. When every active monster was automatic, the turn passes by itself.

**Command and charms (v0.15.0).** A monster under Command (Gambit's 2014 automation stores the spoken word on its effect; the word is kept if the effect expires at the start of its own turn, before the autopilot reads it; an effect the DM removes by hand on someone else's turn ends the Command, v0.16.2) obeys instead of planning: *drop* and *halt* take no action, *grovel* falls prone, *approach* walks toward the caster, *flee* Dashes away; English or Spanish words; the table sees "X obeys the command", and an unknown word is whispered to the GM and played as usual (dropping the weapon itself is narrated, not applied to the sheet). A monster that is charmed or dominated (the Charmed status, or an effect named Dominate/Charm, English or Spanish) is never the module's: it is left out of the autopilot with a whisper, the turn is not passed, and the GM plays it. A **dominated player character** (an effect named Dominate.../Dominar...; the Charmed status alone does not count) is the DM's: its owner's moves and uses are refused with "X is dominated: the DM plays it", the DM's go through (v0.16.0).

**Confusion (v0.16.0).** A creature under an effect named Confusion/Confusión/Madness/Locura gets the spell's d10 rolled by the GM's client at the start of its turn, monster or player character, once per round, said to the table: 1 it moves its full speed in a random direction (d8) and takes no action (the module walks it, player characters included; the destination is kept inside the scene and on the grid, and a token a wall stops short is put back on its square, v0.16.2); 2-6 nothing; 7-8 a melee attack on a creature drawn at random within its reach, ally or enemy (nothing without one); 9-10 as usual. A monster on the autopilot obeys the roll; a player character's owner is refused moves on 1-8, every use on 1-6 and anything but a melee attack on 7-8 (v0.16.1), and on 7-8 the table is told whom to hit. A charmed or dominated monster alone in its group is whispered too (v0.16.1).

**Flight (4c).** With **Monsters flee** on, a monster below the **Flee threshold** (25 % of its maximum hit points) runs instead of acting: an unintelligent one always, an intelligent one only when the standing enemies outnumber its standing allies; a creature alone from the start of the combat (a boss) never flees. It Dashes (piece 2's Dash flag, so its movement doubles for the turn) toward the nearest reachable **escape region**: draw a Region on the scene and put *escape* (the **Escape region name** setting) in its name. A fleeing monster that steps into it leaves the fight: marked defeated in the tracker and its token hidden, with a public chat line; the GM can bring it back by un-defeating and un-hiding it. Without a region it runs to the reachable square farthest from everyone, trying the straight-away line and then every compass direction, so a scene edge or a wall in the first does not cap the run (v0.16.2); on a tie for the nearest enemy (every square along an edge) it takes the square farthest from everyone, then the longer run (v0.16.3). Short of the region this turn, it keeps running next turn; cornered with nowhere to go, it fights. It still spends its bonus action (a Healing Word on itself).

**Opportunity attacks before moving (4c).** A clever monster (Intelligence at or above the threshold) weighs every square it considers moving to against the opportunity attacks the route draws: leaving a player character's reach costs that character's best melee attack (hit chance against the monster's AC times average damage) when their reaction is free (Midi tracks it); a *Sentinel* wielder's hit would also stop the monster, so the gain is scaled by the miss chance; a character with the *Tunnel Fighter* stance active (an active effect named "Tunnel Fighter") costs one attack per extra square moved inside their reach and one on leaving, reaction or not. The whisper shows the toll: "Shortbow vs Rogue (expected 1.2; opportunity attacks 2.1)". An unintelligent monster never looks; the flight never looks either.

**Tunnel Fighter prompt (4c).** Gambit's Premades prompts the opportunity attack when a monster leaves a reach with a free reaction. The triggers Gambit does not know, the module prompts itself: a monster moving a second square inside the reach of a character whose Tunnel Fighter stance is active, or leaving that reach when their reaction is already spent. The monster stops there, the character's owner sees "Fighter: attack Goblin with Tunnel Fighter?" with **Attack** and **Pass** (30 s, then Pass; the GM sees a "Roll for them" button meanwhile, as for initiative). Attack rolls the character's best melee attack on their own client through Midi, with no reaction check; a hit from a character who also has Sentinel ends the monster's move. Then the monster walks on.

The GM gets a whispered line per monster and per bonus action ("Goblin: Scimitar vs Rogue (expected 2.5); also: Shortbow 2.0"), posted before the monster moves and with the full decision (the opportunity-attack toll and the alternatives); a second line follows only when the re-plan from the new square changes the action. The console gets a `[bg3-flow]` line per monster with what the planner saw (activities with range, bonus, damage or healing, area shape; enemies with distance, visibility and path length; allies with hit points; retreat squares): read it first when a monster does something odd. A monster at 0 hit points does nothing more. The robot button on each NPC row of the combat tracker switches that monster's autopilot off (or back on) for the combat. **Pause before each monster action** opens a dialog before every use: Execute, Skip, or Take over (switches that monster off and stops).

When no route reaches the enemy's own square (a Large monster, an ally in the only corridor), routes to the free squares touching the enemy are tried and the shortest wins. A use Midi refuses or an error leaves that monster to the GM with a whispered note; the others continue.

**Lair actions (piece 5).** On initiative count 20, losing ties (before the first group whose leader rolled below 20; a shared turn led by a 20 or more acts whole before the lair; at the top of the round when nobody is below 20), a monster in its lair takes the lair action that scores most: damage and save activities with activation *Lair*, aimed anywhere in the lair (a lair action whose range is the sheet's default *Self* with no area, or has no value, reaches everything), areas at the biggest cluster, never the same action two rounds in a row. "In its lair" follows the world's rules version like the NPC sheet does: *Inside lair* checked under the modern rules, a lair initiative (or the lair flag) under the legacy rules. A turn change that arrives while a monster's use is still waiting on Midi is not dropped: once that use resolves, the lair and the new turn play. Several presses while busy count as one change from the first to the last: the round you land in keeps its lair, the rounds stepped past are not replayed. A lair action that only imposes a condition is worth the damage it denies: each character's threat (its best damage per turn against the monster, doubled by *Extra Attack*, plus its best heal) times the chance it fails the save times the share of a turn the condition costs (paralysed or stunned: all of it; restrained, blinded, frightened, poisoned, prone: half; grappled, deafened: a tenth; no status on the effect: half), so the roots go for the fighter and the fog for the cluster that hurts most; the whisper says `denies`. The GM hears the lair every round: `lair: Acid Pool vs Rogue (expected 9.0); not scored: Grasping Roots`, or `lair: nothing to score; last round: Acid Pool; by hand: Grasping Roots, Fog Cloud` (`last round` is the action the no-repeat rule skipped; `not scored` / `by hand` are the lair actions the module cannot value, pure utility: run one by hand at initiative 20 if you like). In the pause dialog, *Take over* only skips the lair action; the monster's own autopilot is untouched. The lair acts whether or not the monster is on the autopilot. **Legendary monsters** are the DM's: a monster with legendary actions is off the autopilot by default (the robot button turns it on); the module never takes legendary actions.

Not counted yet: resistances and vulnerabilities, opportunity attacks from enemies the monster cannot see, difficult terrain on the escape route, a Dash when merely approaching, advantage or disadvantage beyond the adjacent-shot rule, legendary actions and resistances, mythic actions, lair actions with no save (pure utility), threat beyond the sheet's activities (resistances, flurries, control without a save), initiative-20 ties, regional effects, ammunition, thrown weapons at range (a javelin counts as melee), multi-target counts (Mass Healing Word heals one), difficult terrain cost, gridless scenes.

## House rules

- **Enlarge: Strength twice.** An enlarged character adds its Strength modifier a second time instead of the 1d4 on Strength attacks; other attacks keep the 1d4. When an effect whose name contains "Enlarge" (or "Agrandar") is created with a `1d4` damage bonus (the standard melee or thrown weapon bonus key, old or new form), the module replaces those bonuses with two *Rules* changes (type Bonus, key `damage`): `@abilities.str.mod` when the damage roll is a Strength weapon attack and `1d4` for any other weapon attack. dnd5e evaluates these at each damage roll, on every client and through Midi (an ordinary attribute bonus cannot do this: its conditions are checked when the sheet is prepared, with no roll in sight). An Enlarge effect already on an actor before the module was installed, one edited by hand, or one that carries its 1d4 some other way (a macro, a Midi flag) is left alone: edit it on the sheet if you want the rule there.
- **Ask the spell level.** Midi set to consume resources by itself (the table's recipe in docs/SERVER-TESTING.md, so a reaction spell such as Shield skips the cast dialog) casts every spell at its base level. A leveled spell cast with a higher slot still available (a pact slot counts) gets dnd5e's usage dialog back at `dnd5e.preUseActivity`, where the slot is chosen. Cantrips, reactions, scrolls (fixed level), uses that asked for no dialog (the autopilot, a prompt) and casters without a higher slot are left to Midi.
- **New spells arrive prepared.** A spell of the prepared kind added to a character is marked prepared when it is created (Chris's Premades automations, applied at import by Coven's Automation Toolkit, leave imported spells unprepared, so Midi never offered the Fighter's Shield; dnd5e's own drop onto a character resets it too). Methods that do not prepare (innate, at will; the system's spellcasting config decides, pact magic prepares under the 2024 rules), spells already prepared or always prepared, and NPCs are untouched.
- **First turn of a fresh combat.** With Gambit's Premades opportunity attacks on, the autopilot waits for its reaction regions to appear (they are created at combat start, one combatant at a time, at most 3 s) before the first monster moves, so a monster acting first still draws the fighter's opportunity attack.

## Light spells (v0.17.0)

With **Light spells light the token** on, a cast through Midi changes the token's own light, no Active Token Effects module needed (CPR and the Plutonium addon automate none of these): **Light** (bright 20 / dim 40), **Continual Flame** (20 / 40, torch flicker) and **Daylight** (60 / 120) light the token picked by the target picker within the spell's range (Esc lights nothing); **Produce Flame** (10 / 20) lights the caster; **Faerie Fire** (dim 10, blue) lights every creature that failed the save. The token's previous light is kept in a flag and comes back when the spell ends: Light and Produce Flame end when the same caster casts them again (one instance each), Produce Flame also when thrown (the attack activity), a concentration spell (Faerie Fire) when the caster's concentration effect goes, and any of them with the **lightbulb** button in the token HUD (owner or GM). Durations are not tracked: an hour of Light is the table's call. A player lighting a token it does not own goes through the GM (socketlib). The lit square counts as bright light for the stealth rules above.

## Settings

- **Full automation**, **BG3 turn flow**, **Encounters and stealth**: feature toggles. **Target picker**: feature 1. **Action economy**: piece 6.
- **Lock GM movement too**, **Dash item names**: feature 2.
- **Default encounter radius**, **Obscured darkness threshold**: feature 3.
- **Monster autopilot**, **Pause before each monster action**, **Pass the turn automatically**, **Intelligence threshold**: piece 4.
- **Monsters flee**, **Flee threshold**, **Escape region name**: piece 4c.
- **Lair actions**: piece 5. **Enlarge: Strength twice**, **New spells arrive prepared**, **Ask the spell level**: house rules. **Light spells light the token**: light spells (v0.17.0).

## Development

```
npm test        # pure rules, no Foundry needed
```

Design specs: `docs/superpowers/specs/2026-11-02-bg3-flow-design.md` (pieces 1 to 3) and `docs/superpowers/specs/2026-11-04-monster-autopilot-design.md` (piece 4). Server test script: `docs/SERVER-TESTING.md`.
