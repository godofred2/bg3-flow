# BG3 Flow: server test script

For a Claude session (or a person) with access to the Foundry server: file system, Foundry's browser UI, or both. Work through the checks in order, record pass or fail for each, and report back using the template at the end. Don't fix anything in the module during the run; just report.

## 0. Install

Pick one:

- **Manifest**: Foundry setup screen, Add-on Modules, Install Module, paste
  `https://github.com/godofred2/bg3-flow/releases/latest/download/module.json`, Install.
- **Zip**: unzip `module.zip` so that `Data/modules/bg3-flow/module.json` exists, then restart Foundry or reload the setup page.

Confirm versions on the setup screen: Foundry 14.x, dnd5e 6.0.x, Midi QOL 14.6 or newer. If Midi is older, update it first (Update All) and note the version before and after. Midi 14.6 needs DAE 14.6 or newer; if DAE is on 14.0.x, reinstall it from `https://github.com/tposney/dae/releases/download/latest-dnd6/module.json`, since the old manifest never offers the update.

## 1. Scratch world

1. Create a world named `bg3-flow-test`, system dnd5e.
2. Launch it, log in as GM, open Manage Modules, enable: BG3 Flow, Midi QOL, libWrapper, socketlib, Dice So Nice, DAE, Automated Animations, JB2A, Sequencer. Save, let the world reload.
3. Create a second user `Player1` with a player role (Configure Players) so player-side behaviour can be tested from a second browser tab or window logged in as that user.

## 2. Test scene

1. Scene `Arena`, 20x20 squares, grid 5 ft, no walls. Set Global Illumination on so vision doesn't get in the way.
2. Actors (from the dnd5e SRD compendiums where possible):
   - `Cleric` (character, level 5) with the spells **Spirit Guardians** and **Fireball** imported from Midi's sample items compendium if present, else from the SRD spells. Owner: Player1.
   - `Rogue` (character). Owner: Player1.
   - `Goblin` x2 (npc, from SRD monsters). Disposition hostile.
   - `Villager` (npc, any commoner). Disposition friendly.
3. Place one token for each on the scene. Put the two goblins and the villager adjacent to each other, the cleric 20 ft away, the rogue next to the cleric.
4. On the cleric's Spirit Guardians, open the activity that places the area and confirm it has the Midi Region behaviour (Token Enters + Turn Start, Use Activity, Attach to caster). If it doesn't, follow README section "Ongoing areas with Midi 14" step by step and note that the sample item lacked it.
5. On that same activity, Targeting section: tick **Override Target**, then **Allow choosing targets**. Leave the target type blank.

## 3. Checks

Record pass or fail for each line. "Console" means the browser developer console (F12). Any line starting with `[bg3-flow]` is ours.

### 3.1 Load

- [ ] C1. World loads with no warning notification from BG3 Flow. Console shows `[bg3-flow] ready`.
- [ ] C2. Configure Settings, BG3 Flow shows six settings (three feature toggles, Lock GM movement, Default encounter radius, Obscured darkness threshold) and the button **Apply BG3 automation preset**.

### 3.2 Preset

- [ ] C3. Press the preset button, confirm. A notification "BG3 automation preset applied." appears.
- [ ] C4. Open Midi QOL, Workflow Settings and read back: Auto roll attack on (player and GM tabs); Auto roll damage "Damage Roll Needed" (both tabs); Auto fast forward has all six boxes (attack, damage, check, save, skill, tool) ticked on both tabs; Auto check hits "Check, all see result"; Auto check saves "Result + Rolls"; Auto apply damage "Yes"; Player saves "None (public roll)"; NPC saves "Auto"; Template auto target "Walls Block"; GM attack display and GM damage display "Full", GM 3D dice for attack and damage "Show". Note any setting whose value differs.
- [ ] C5. dnd5e system settings: "Group combatants by initiative" (or similarly named initiative grouping option) is off.

### 3.3 Attacks resolve with no prompts

- [ ] C6. As GM, select Goblin 1, target the Rogue, use the goblin's Scimitar. Expected: no dialog opens, attack and damage dice animate in 3D, chat shows the attack card with hit or miss, and on a hit the Rogue's HP drops immediately.
- [ ] C7. As Player1 (second window), select the Rogue, target Goblin 1, use Rapier. Same expectations as C6 from the player side.

### 3.4 Fireball: no prompt, hits everyone

- [ ] C8. As Player1 with the Cleric, cast Fireball and place the template over the two goblins and the villager. Expected: no friend-or-foe dialog (Fireball has no "Allow choosing targets"), all three are targeted automatically, three Dex saves roll (goblins by GM side, villager by GM side), damage applies to all three including the friendly villager.

### 3.5 Spirit Guardians: prompt before placement, ongoing damage

The Midi sample Spirit Guardians uses entry + **turn end** triggers, so ongoing damage lands at the end of a turn, not the start.

- [ ] C9. Move the Cleric so the goblins and the villager are within 15 ft. As Player1, cast Spirit Guardians. Expected: the dialog **Who does it affect?** appears immediately, before dnd5e's slot dialog and before any area is placed, with buttons Enemies only and Everyone. Midi's own Target Confirmation dialog must NOT appear.
- [ ] C10. Press **Enemies only**, then go through the slot dialog. Expected: console logs `[bg3-flow] friend-or-foe: enemies, region filter -1`; a region attached to the Cleric exists; both goblins took radiant damage on creation (entry), the villager took none and rolled no save.
- [ ] C11. As GM, start a combat with everyone, roll initiative. Advance turns until a goblin's turn ends while it stands inside the area. Expected: Wis save and radiant damage automatically, no prompts, dice visible.
- [ ] C12. End of the Villager's turn inside the area: no save and no damage.
- [ ] C12b. In the console run `canvas.scene.regions.contents.at(-1).behaviors.find(b => b.type === "midi-qol.regionActivity").system.dispositionFilter` and expect `-1`.
- [ ] C13. Move Goblin 2 out of the area and back in during its own turn. Expected: on re-entry, it takes damage at most once that turn.
- [ ] C14. End concentration, repeat C9 but press **Everyone**. Expected: on creation the villager also saves and takes damage, and the C12b value reads `0`.
- [ ] C14b. End of the Villager's next turn inside the area: it saves and takes damage this time. This proves later rounds respect the choice.
- [ ] C14c. End concentration, cast again as GM (select the Cleric token first) and press **Enemies only**. Expected: same dialog, same log line, C12b reads `-1`, no errors in either console.

### 3.6 Dice visibility

- [ ] C15. Throughout C6 to C14, every attack, damage and save roll shows 3D dice (Dice So Nice) and a chat card visible to both the GM and Player1 windows. Note any roll that was hidden or missing.

### 3.7 Disable toggle

- [ ] C16. Turn off **Full automation** in BG3 Flow settings, reload, repeat C9. Expected: no BG3 dialog; Midi's own Target Confirmation appears instead (because the checkbox is ticked) and the villager is damaged on creation only if the Midi behaviour filter on the item says so.

## 4. Turn flow (feature 2)

Setup: combat with Cleric, Rogue (Player1), Goblin 1, Goblin 2, Villager. Set initiatives by hand so the order is Cleric 20, Rogue 18, Goblin 1 15, Goblin 2 12, Villager 5. Give the Rogue a feature item named exactly `Dash` (any activity, e.g. utility, no template). Keep the Player1 window open.

- [ ] T1. Before starting combat (or with no combat), Player1 moves the Rogue freely. Expected: allowed, no warning.
- [ ] T2. GM starts combat (Begin Combat). Expected: chat shows **Shared turn: Cleric, Rogue** and the GM console shows no error. The tracker's current combatant is the Cleric.
- [ ] T3. Player1 moves the Rogue 20 ft although the Cleric is the current combatant. Expected: allowed (shared turn). A blue circle is drawn around the Rogue when selected; after the move it is smaller and centred on the Rogue's new position without reselecting.
- [ ] T4. Player1 drags the Rogue another 15 ft (total 35 ft of a 30 ft speed). Expected: refused with "Not enough movement: 20 of 30 ft already used", shown once on the Player1 client. A 10 ft move is still allowed.
- [ ] T5. Player1 uses the `Dash` item on the Rogue, then moves 25 ft more. Expected: allowed (budget now 60 ft). Then move 10 ft more: refused.
- [ ] T6. Player1 tries to move Goblin 1 (grant Player1 ownership of Goblin 1 for this check). Expected: refused with "Not your turn".
- [ ] T7. GM presses next turn once. Expected: the tracker jumps straight to Goblin 1 (the Rogue's turn is skipped) and chat shows **Shared turn: Goblin 1, Goblin 2**. Goblin 1 and Goblin 2 can both be moved by the GM.
- [ ] T8. Still on the goblins' turn, GM moves the Cleric 10 ft. Expected: allowed (GM exempt). Turn on **Lock GM movement too**, retry: refused with "Not your turn". Use the token HUD movement action "Blink" or "Displace" (teleport) on the Cleric: allowed. Turn the setting back off.
- [ ] T9. GM presses next turn. Expected: Villager (no group). Next turn again: round 2, **Shared turn: Cleric, Rogue** again, the Rogue's Dash is gone (a 35 ft move is refused again) and its movement budget is fresh (a 30 ft move is allowed).
- [ ] T10. GM presses previous turn from the Villager. Expected: pointer lands on Goblin 1 (first of the previous group), not Goblin 2.
- [ ] T11. Turn off **BG3 turn flow**, reload both windows, press next turn from the Cleric. Expected: pointer goes to the Rogue (Foundry default) and Player1 can move any owned token at any time. Turn it back on.
- [ ] T13 (v0.8.1; the defeated sub-step fixed in v0.8.3). Core setting *Turn Marker* enabled (Combat Tracker settings). Shared turn of Cleric and Rogue: both tokens show the animated turn marker under them (the same image, both spinning), the GM and Player1 alike. Next turn to the goblins: the marker leaves both PCs and appears under Goblin 1 and Goblin 2. Mark Goblin 2 defeated: its marker goes. Previous turn back to the PCs: markers move back. Disable the marker on the Rogue's token (token config, Turn Marker mode "Disabled"): only the Cleric shows it. Report any marker left behind or any console error mentioning turnMarker.
- [ ] T12 (v0.7.1). Shared turn of Cleric and Rogue with nothing selected. Expected: Player1 sees a blue circle around both tokens (the Cleric's too, if in sight), the GM as well. On the goblins' turn with Goblin 2 hidden (GM-hidden) or behind the wall out of the Rogue's sight: Player1 sees no circle for it, the GM sees circles for both goblins. Moving any active token redraws its circle.

## 5. Reactions

Setup: give the Cleric the spell **Shield** (reaction) and the Rogue the feature **Uncanny Dodge** from Midi's sample items compendium if present (else SRD, and set the Midi use condition `reaction === "isDamaged"` on its activity). Both owned by Player1.

- [ ] R1. GM attacks the Cleric with Goblin 1 and hits. Expected: Player1 gets a Midi reaction prompt showing the attack roll with Shield as an option; choosing it adds +5 AC and may turn the hit into a miss. Not answering for 30 s ends the prompt with no reaction.
- [ ] R2. GM attacks the Rogue with Goblin 2 and hits. Expected: Player1 gets a prompt offering Uncanny Dodge on damage; choosing it halves the damage applied.
- [ ] R3. Player1 tries Shield twice in the same round. Expected: Midi warns the reaction is already used (enforce reactions).
- [ ] R4. On the goblins' shared turn, with Goblin 1 as Foundry's current combatant, the GM attacks with Goblin 2 twice in a row. Expected: no "Reaction Used, proceed anyway?" dialog and no "Reaction used" effect on Goblin 2; both attacks are plain attacks. Then, on the Cleric and Rogue's turn, attack with Goblin 1: Midi treats it as an opportunity attack as before.

## 6. Encounters and stealth (feature 3)

Setup: no combat. Turn **Encounters and stealth** on. Scene darkness 0 with a dark region on one side (or set scene darkness to 0.7 for the dark steps and back to 0 afterwards). Draw a wall between a corridor and the goblin room. Player1 owns the Rogue and the Cleric is also a player character. Villager stays unmarked. Place Goblin 1 and Goblin 2 in the room, the Rogue in the corridor 60 ft away. SRD goblins have darkvision 60 ft (actor sheet, Senses): E9 needs it set to 0 on both and restored afterwards.

- [ ] E1. GM selects both goblins, presses **Mark as encounter** (skull icon in the token controls), accepts radius 30. Expected (right after a reload, without re-rendering anything): both tokens get `flags.bg3-flow.encounter` with the same id and radius 30; the GM sees a red circle around each; Player1 sees no circle. Console: `[bg3-flow] encounters on` and the encounter line.
- [ ] E2. Player1 walks the Rogue to 40 ft from the nearest goblin, in light, no wall between. Expected: nothing (GM console: no spotted line, no combat).
- [ ] E3. Player1 walks to 25 ft with the wall between the Rogue and both goblins. Expected: nothing; GM console shows `Rogue unseen by group ...`.
- [ ] E4. Player1 steps into line of sight at 25 ft, in light. Expected, on that very move (not the next one): chat **Goblin 1 spotted Rogue!**, a combat is created with Cleric, Rogue, Goblin 1, Goblin 2 (not the Villager); Player1 sees their own initiative roll with 3D dice for the Rogue; the GM sees "Waiting for initiative from Cleric" with **Roll for them** if the Cleric's owner is offline, otherwise that player rolls; goblins roll on the GM; then **Shared turn** from feature 2. Report the initiative order.
- [ ] E5. End the combat. Move the Rogue back behind the wall. Player1 opens the Rogue's HUD, presses the eye-slash **Hide** button, chooses **Roll Stealth**. Expected: a public Stealth card, the *Hiding* status icon on the token, `flags.bg3-flow.stealth = {value, hidden: true}`.
- [ ] E6. Hidden Rogue walks into line of sight at 25 ft in light (clear area). Expected: spotted on that move whatever the Stealth value (BG3: hiding in the open is caught on sight), combat starts. No Perception rolls, no prompts.
- [ ] E7. End the combat. Set scene darkness 0.7, no lights near the goblins. Move the unhidden Rogue into sight at 25 ft. Expected: spotted (not hiding = seen even in the dark); end that combat. Hide with **Use this value** 25 and move in sight at 25 ft. Expected: `Rogue unseen` (the goblins' darkvision turns the darkness into dim light: passive 9 does not beat 25). Hide again with value 5, move once. Expected: spotted, combat starts. End it (starting a combat reveals everyone), move the Rogue behind the wall and hide again with value 25. Keep darkness 0.7 for E8 and E9.
- [ ] E8. Still hidden, behind the wall, Player1 attacks Goblin 1 with the Rogue (shortbow). Expected: Midi refuses the attack (total cover) and the Rogue stays hidden (status and flag untouched). Then step into sight (unseen at 25 in the dark with Stealth 25) and attack again. Expected: *Hiding* cleared, and on a hit the combat starts (chat: no spotted line, started by damage). On a miss, nothing: attack again until a hit.
- [ ] E9. Light per square. End the combat. Set both goblins' darkvision to 0. Place an ambient light in the room (bright 10 ft, dim 30 ft) within sight of the goblins. Hide the Rogue with value 25. Walk it into the dim ring in sight at 25 ft from the goblins. Expected: `Rogue unseen` (lightly obscured, passive 9 does not beat 25). Step into the bright circle. Expected: spotted at once. End the combat, hide with value 5, step into the dim ring. Expected: spotted (passive 9 beats 5). End the combat. Hide with value 25 and stand in sight outside any light. Expected: unseen (heavily obscured, no darkvision). Remove the light. Global Illumination: turn it on with *bright* unticked and darkness range 0 to 1, darkness still 0.7, goblins still without darkvision. Hide 25 and stand in sight outside any light. Expected: unseen (dim everywhere, passive 9 does not beat 25). Hide 5, move once. Expected: spotted. End the combat, tick *bright*, hide 25, move once. Expected: spotted on sight. Restore Global Illumination as it was, darkvision 60 on both goblins, darkness back to 0.
- [ ] E10. Turn **Encounters and stealth** off, reload both windows. Expected: no skull button, no Hide button in the HUD, the Rogue walks up to the goblins in sight with nothing happening. Turn it back on.

## 7. Monster autopilot (piece 4a, v0.6.0, A-steps green on v0.6.3; piece 4b, v0.7.0, B-steps green on v0.7.4; self-targeting fixed in v0.7.5; piece 4c, v0.8.0, F-steps)

Every autopilot turn prints one `[bg3-flow] <monster> hp ... budget ...; activities: ...; enemies: ...` console line on the GM (before the move; `pathN` is the number of squares found toward that enemy): copy it into the report for every failing step. Setup: **Monster autopilot** on, **Pause before each monster action** off, **Pass the turn automatically** on. Gambit's Premades installed with its *Opportunity Attack* automation enabled and the world reloaded afterwards (Gambit reads the setting on load). Goblin scene, darkness 0, no lights, no walls between the Rogue and the goblins unless a step says so. Both goblins unmarked as encounter (or marked: it does not matter once a combat exists). Start each combat by hand (GM: toggle combat on the tokens, roll all initiative) and note the order. Console on load: `[bg3-flow] autopilot on`.

- [ ] A1. Combat with the Rogue and both goblins, the goblins 30 ft from the Rogue in sight, side by side, consecutive in initiative. GM passes to the goblins' shared turn. Expected: both goblins walk at the same time and stop adjacent to the Rogue on different squares (the second one takes a free square next to the first one's); then one Scimitar attack each (Midi attack and damage cards, 3D dice), two GM whispers like **Goblin 1: Scimitar vs Rogue (expected 2.5); also: Shortbow 2.0**, and the turn passes to the next combatant by itself.
- [ ] A2. New combat, one goblin 60 ft from the Rogue in sight, with the Shortbow removed from its sheet (a goblin with a bow shoots from 60 ft). On its turn: it walks 30 ft toward the Rogue along the path and stops; whisper **approach Rogue**; the turn passes. Put the bow back.
- [ ] A3. One goblin 50 ft from the Rogue in sight (bow range 80). Expected: it does not move, the whisper names Shortbow, one ranged attack.
- [ ] A4. Tracker: the robot button shows on the goblin rows, not on the Rogue's. Click it on Goblin 2 (it greys out). On the goblins' shared turn Goblin 1 acts, Goblin 2 does nothing and the turn does not pass; pass it by hand. Click the button again: back on.
- [ ] A5. **Pause before each monster action** on. On a goblin's turn, after it moves, a dialog **Goblin 1: autopilot** with Execute, Skip, Take over. Skip: no attack, turn passes. Next turn, Take over: no attack, the button greys out, the turn does not pass. Turn the setting off again.
- [ ] A6. Rogue hidden behind the wall in the dark (Hide 25, darkness 0.7, as in E7). On the goblin's turn: whisper **no visible enemy**, no move, turn passes. Darkness back to 0, reveal.
- [ ] A7. Goblin adjacent to the Fighter (a player character with a melee weapon), Rogue 30 ft away in sight and easier to hit (lower AC) or more wounded. On the goblin's turn it walks away toward the Rogue: Gambit prompts the Fighter's opportunity attack; the goblin waits for the answer, then continues and attacks. Report whether the opportunity attack resolved before the goblin's attack.
- [ ] A11. Goblin 1 adjacent to the Rogue with both weapons. Expected: whisper **Goblin 1: Scimitar vs Rogue (expected ...); also: Shortbow ...** with the bow's value lower (disadvantage next to the target), and a Scimitar attack.

### 7b. Tactics (piece 4b, v0.7.0)

Setup: as section 7 (autopilot on, pause off, pass the turn on, Gambit's Opportunity Attack on and reloaded). dnd5e world setting *NPC auto recharge* left at "no". Import with Plutonium (or the dnd5e monsters compendium): a **Priest** (Cure Wounds, Spirit Guardians, Mace), a **Red Dragon Wyrmling** (Fire Breath: 15 ft cone, recharge 5-6; Bite). Player characters: the Rogue, the Fighter, and give the Fighter a feat item named **Sentinel** (text only is enough; Gambit reads the name). For B7 add a Healing Word spell to the Priest's sheet (prepared, a level 1 slot available). Every autopilot turn prints one `[bg3-flow] <monster> ...` console line; copy it for every failing step. Set initiatives by hand so the player characters act before the monsters.

- [ ] B1. Wyrmling at (8,4), Rogue at (4,4), **Fighter right behind the Rogue at (3,4)** (a token one row off sits on the cone's edge ray and Foundry leaves it out), Cleric away at (1,4). On its turn: it walks to (6,4) or (5,4) (both squares catch the two), and breathes **with no dialog**: the cone starts at the edge of its own space, so the Wyrmling gets no save card of its own; a cone template appears from the Wyrmling toward the Rogue, two Midi save cards (Rogue and Fighter), damage applied, and the template is gone once the cards are posted. If Midi ever stalls, the autopilot gives the use up after 60 s, removes the template and whispers the error; whisper **Red Dragon Wyrmling: Fire Breath vs Rogue (expected ...); also: Bite ...** (the aim is whichever it names); the console line shows `Fire Breath[save r15 ... cone15 recharge]`. Report who was hit and whether anyone standing just outside the 15 ft was included or excluded.
- [ ] B2. Same scene, Fire Breath spent (set its uses to 0 on the sheet). On the Wyrmling's turn start a recharge roll card appears (d6). On a 5 or 6 it breathes as in B1; otherwise it closes in and bites. Report the roll and what it did.
- [ ] B3. Priest (trimmed) with Goblin 1 adjacent to it at 3 hp (edit the goblin's hp), Goblin 1's autopilot **off** so it stays put, the Rogue 30 ft away in sight. On the Priest's turn: it casts Cure Wounds on Goblin 1 (Midi healing card, goblin hp rises); whisper **Priest: Cure Wounds vs Goblin 1 (expected 4.0); also: Mace ...**; pass the turn by hand (the switched-off goblin shares it). Next round with the goblin healed: it walks to the Rogue and attacks with the Mace. Variant with Goblin 1's autopilot on: the goblin walks off to the Rogue in the same movement phase; the Priest then walks after it (or to the Rogue) and heals or attacks from where it arrives, and the whisper says what it did: nothing stays put while whispering "approach".
- [ ] B4. Priest at 2 hp, nobody else wounded, the Rogue 30 ft away. Expected: Cure Wounds on itself (whisper names Priest as the target), hp rises.
- [ ] B5. (superseded by B9 on v0.7.1)
- [ ] B6. Goblin 1 adjacent to the Fighter (Sentinel item on the Fighter's sheet), the Rogue 30 ft away. On the goblin's turn it starts walking toward the Rogue: Gambit prompts the Fighter's opportunity attack; answer Yes and hit. Expected: the goblin stops where it was caught (its route is cut), is snapped onto the square under its centre (grid-aligned position), and acts from there: Shortbow on the Rogue in sight (Sentinel takes its movement, not its action), or Scimitar on the Fighter if still adjacent; whisper accordingly. Report the goblin's final square (must be a whole square) and the console errors, if any. If the opportunity attack misses, the goblin finishes its walk as in A7.
- [ ] B7. Priest (trimmed to Mace, Spirit Guardians, Cure Wounds, Healing Word) adjacent to the Rogue, Goblin 1 at 6 hp (of 7) within 60 ft. Expected: Mace attack on the Rogue first (whisper **Mace vs Rogue (expected 1.8)**: 1 missing hit point is worth less than the Mace), then a second whisper **Healing Word vs Goblin 1 (expected 1.0)** and the healing card as the bonus action, no dialogs; then the turn passes.
- [ ] B8. Goblin 2 standing between the Wyrmling and the Rogue. Expected: the Wyrmling looks for a firing square whose cone catches the Rogue without the goblin (it did on v0.7.0: it walked round to the Rogue's side and whispered Fire Breath vs Rogue with the Rogue alone); if no such square exists within its movement it breathes on both (both get a save card: friendly fire is real) or bites, whichever is worth more. Report the whisper, the console line and who got save cards.
- [ ] B9. Goblin 1 adjacent to the Rogue with both weapons, Intelligence 10, a free square behind it: it steps back one square and shoots (whisper **Shortbow vs Rogue (expected 3.3); also: Scimitar 3.3**). Intelligence 5: no move, Scimitar.
- [ ] B10. Sentinel with temporary hit points: as B6 with 15 temporary hit points on the goblin. Expected: the hit burns temporary hit points and the goblin still stops where it was caught, snapped to a square, and shoots from there.

### 7c. Flight, escape regions, opportunity-attack estimate, Tunnel Fighter (piece 4c, v0.8.0; F2-F5, F8, F10-F12 green on v0.8.0; all green by v0.8.3)

Setup: as 7b. Settings **Monsters flee** on, **Flee threshold** 25, **Escape region name** "escape". Draw a Region (scene controls, Regions layer) named **Escape** where each step says. The console line now shows `hp x/y budget ... speed ... [alone]; escape <region> (n squares)|none, away n` and, per enemy, `oa{r5 dmg3.3 hit0.50 reaction tf} sentinel` (`oa-` for no melee attack): copy it for every failing step. Edit hit points on the goblin's sheet to set it up. The Fighter has the **Sentinel** feat item from 7b; for F8 to F10 add an active effect named **Tunnel Fighter** on the Fighter (sheet, Effects tab, any effect, that exact name, enabled).

- [ ] F1. Region **Escape** 30 ft behind Goblin 1 (speed 30), the goblin at 1 hp (of 7) with 20 temporary hp, Intelligence 10, the Rogue adjacent to it, both PCs standing, **Goblin 2 in the combat but marked defeated** (a lone monster is a boss and never flees; a standing Goblin 2 makes it 2 against 2, which is not losing). On its turn: the whisper **flee: Dash toward Escape (hp 1/7)** comes first, the goblin Dashes into the region (Gambit prompts the Rogue's opportunity attack on the way: answer Yes and miss), the tracker row shows it defeated, the token is hidden, chat shows **Goblin 1 has escaped.**, and the turn passes. Report the console line (`escape Escape (n squares)`).
- [ ] F2. Same with the region 70 ft away. Expected: the goblin walks 60 ft along the route and stops, still in the fight, whisper **flee: Dash toward Escape (hp 1/7)**; it fights nothing. Next round it enters the region and escapes.
- [ ] F3. No escape region, goblin at 1 hp, the party 10 ft away. Expected: it Dashes to a square as far from the party as its 60 ft allow; whisper **flee: Dash away from enemies (hp 1/7)**. Report where it ended and the console `away n`.
- [ ] F4. Goblin 1 at 1 hp, Intelligence 10, Goblin 2 and a third goblin standing, against the Rogue and the Fighter (2 vs 3: not losing). Expected: no flight, it attacks as usual. Set Intelligence 5: it flees (whisper **flee: ...**). Restore Intelligence; turn **Monsters flee** off: no flight at 1 hp with Intelligence 5. Turn it back on.
- [ ] F5. An Ogre alone on the monsters' side (no other hostile combatant in the tracker) at 5 hp. Expected: it never flees (console line shows `alone`), it attacks.
- [ ] F6. Opportunity-attack estimate: Goblin 1 (Intelligence 10, Scimitar and Shortbow, full hp, AC 15) adjacent to the Fighter (Longsword, reaction free), the Rogue 35 ft away in sight. Expected: no move and the whisper **Shortbow vs Rogue (expected 2.0); also: Scimitar 1.6** (shooting next to the Fighter is at disadvantage: 0.6 squared x 5.5; stepping back would be worth 3.3 minus the Fighter's 4.1 of opportunity attack, so it stays). Variant: set Goblin 1's AC to 25 on its sheet. Expected: it steps back one square (10 ft from the Fighter) and the whisper reads **Shortbow vs Rogue (expected 2.8; opportunity attacks 0.4); also: Scimitar 2.8** (the Fighter now hits it on a 19-20 only; 3.3 less the 5 % Sentinel stop and the 0.4 toll; the Scimitar line is its best option, a 30 ft walk to the Rogue, not the adjacent Fighter). Restore AC 15. Report the console line (the Fighter's `oa{...}`).
- [ ] F7. As F6 (AC 15) with the Fighter's reaction spent (`MidiQOL.setReactionUsed(actor)` in the console). Expected: the goblin steps back one square and shoots, whisper **Shortbow vs Rogue (expected 3.3); also: Scimitar 3.3** (the Scimitar walked to the Rogue ties; the step back from melee wins the tie), no "opportunity attacks" (console `oa{... }` without `reaction`).
- [ ] F8. Tunnel Fighter, reaction spent: the active effect on the Fighter, its reaction spent as in F7, Goblin 1 adjacent to the Fighter with Intelligence 5 and **no Shortbow** (it walks regardless of the toll), the Rogue 10 ft past the Fighter so that a route round the Fighter stays within 30 ft. Expected: the goblin walks two squares inside the Fighter's reach (the first 5 ft are free), stops, and the Fighter's player sees **Fighter: attack Goblin 1 with Tunnel Fighter?** (Attack / Pass) while the GM sees a **Waiting for Fighter's Tunnel Fighter reaction** dialog with **Roll for them**. Attack: a Longsword attack card on the goblin, no reaction prompt from Midi. On a miss the goblin walks on (and the next trigger prompts again); on a hit, since the Fighter has Sentinel, the goblin stops where it is and acts from there. Report the prompt texts and whether Gambit also prompted anywhere.
- [ ] F9. Tunnel Fighter with the reaction free: same positions, the Rogue placed so the route leaves the reach. Expected: no prompt on the first square inside the Fighter's reach, the module's prompt on the second, Gambit's prompt on leaving (and Gambit spends the reaction). Report which prompt fired at which square.
- [ ] F10. F8 again, leave the Tunnel Fighter prompt unanswered. Expected: after 30 s it closes by itself (Pass) and the goblin walks on. Also press **Roll for them** on another trigger: the GM's client rolls the attack.
- [ ] F11. Two goblins (Intelligence 5, autopilot on, consecutive in initiative) both adjacent to the Tunnel Fighter Fighter (reaction spent), the Rogue 15 ft past the Fighter. Expected: both walk at once, but the Fighter's player gets the prompts one after the other (never two dialogs at once), one attack card per answered prompt.
- [ ] F12. Large fleer: an Ogre at 5 hp (of 59) with a Goblin ally standing, Intelligence 5, an **Escape** region two squares wide 30 ft away. Expected: it Dashes into the region and escapes (defeated, hidden, chat line); if it stops on the region's edge without escaping, report the console line and where its centre ended.
- [ ] A8. Turn **Monster autopilot** off, reload. Expected: no robot buttons, goblins do nothing on their turn.
- [ ] A9. Previous turn: with the autopilot on, after the goblins acted, the GM presses **previous turn** back onto their turn. Expected: nothing replays. Next turn from there: the Rogue's turn, nothing from the goblins.
- [ ] A10. Large monster (an Ogre from the SRD, 2x2) at (10,4), Rogue at (4,4) with the Fighter beside it at (5,4). Expected: the Ogre walks to a 2x2 spot touching the Rogue (diagonal counts) without overlapping anyone, whispers **Ogre: Greatclub vs Rogue (expected ...)** and attacks. Variant: Rogue at (16,4), Goblin 1 at (14,4) in between, Ogre at (10,4). Expected: the Ogre reaches a free 2x2 spot touching the Rogue (above or below the goblin) and attacks; report its exact path if it stays put.

## 8. Report template

```
Foundry: 14.xxx   dnd5e: 6.0.x   Midi QOL: 14.x.x (before: 14.x.x)
C1 pass/fail - note
C2 ...
...
C16 ...
T1 ...
...
T11 ...
R1 ...
R2 ...
R3 ...
R4 ...
E1 ...
...
E10 ...
A1 ...
...
A11 ...
B1 ...
...
B10 ...
F1 ...
...
F12 ...
Console lines containing [bg3-flow]:
<paste>
Other console errors during the run:
<paste>
Anything surprising:
<free text>
```
