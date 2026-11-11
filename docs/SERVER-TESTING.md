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

## 4b. Action economy (piece 6, v0.11.0; run on v0.11.0: Y3, Y5, Y8 pass, Y1 no icons (Foundry 14.369 ships PIXI 7.4.3), Y2/Y4/Y6 let extra swings through as "possible off-hand"; both fixed in v0.11.1; v0.11.1 run: all pass except the icons drawn under the tokens (zIndex) and non-attacks paid late; v0.11.2: icon layer zIndex 300, non-attacks paid at the card, "no bonus action" text for a light weapon; rerun Y1 and Y5)

Setup: the Fighter (Player1) level 5 with *Extra Attack* and *Action Surge*, a Longsword and a Dagger (light); the Cleric (Player1) with Sacred Flame, Healing Word (bonus) and Cure Wounds; a 2v2 against the goblins, PCs' shared turn. Setting *Action economy* on *Players stopped, GM warned*.

- [ ] Y1. Icons: on the PCs' turn, above the Fighter and the Cleric a filled green dot and a filled orange triangle (Player1 and GM alike), drawn over the token art and over Monks' turn marker, also for a token standing right below another; none above the goblins. They follow a moving token.
- [ ] Y2. Fighter: Longsword, Longsword: both roll; the dot goes hollow after the second (right after the attack roll, before the damage). A third Longsword: "Fighter has no action left this turn", no card, no roll, no target picker circle (the refusal comes first), and the combatant flag `bg3-flow.economy` stays `{attacks 2, action false, bonus false, extra 0}` (never a negative `extra`). A new turn, Fighter attacks once, then uses a potion (action): refused.
- [ ] Y3. Off-hand: new turn, Longsword once, then Dagger with attack mode *Offhand* in the roll dialog (or the sheet's two-weapon setup): it rolls and the triangle goes hollow, the dot stays filled; one more Longsword still rolls (the second attack of the action).
- [ ] Y4. Action Surge: new turn, Longsword, Longsword, Action Surge (its card), Longsword, Longsword: all four roll; a fifth is refused.
- [ ] Y5. Cleric: Sacred Flame, then Cure Wounds: refused ("no action left"), also when Cure Wounds is started 1-2 s after Sacred Flame's card while its dice still roll (the action is paid at the card); Healing Word (bonus) rolls; a second Healing Word refused. Reaction: Shield on the goblins' turn when hit: offered and usable as before (never counted).
- [ ] Y6. GM: the GM uses a goblin's Scimitar four times by hand on the goblins' turn (autopilot off for it): the first rolls, the second rolls as the off-hand swing (a Scimitar is light: the triangle goes hollow), the third rolls with the warning "Goblin 1 has no action left this turn (GM: going ahead)" and so does the fourth; the flag stays `{attacks 1, bonus true, extra 0}`. With the autopilot on, the goblins' turn plays with no warning.
- [ ] Y7. Setting *Icons only*: Y2's third Longsword rolls, the icons still go hollow. *Off*: no icons, nothing refused. Back to *Players stopped*.
- [ ] Y8. Opportunity attack: on the goblins' turn a goblin leaves the Fighter's reach, Gambit's prompt, the Fighter swings: it rolls and the Fighter's icons on its next turn are both filled.

## 5. Reactions

Setup: give the Cleric the spell **Shield** (reaction) and the Rogue the feature **Uncanny Dodge** from Midi's sample items compendium if present (else SRD, and set the Midi use condition `reaction === "isDamaged"` on its activity). Both owned by Player1.

- [ ] R1. GM attacks the Cleric with Goblin 1 and hits. Expected: Player1 gets a Midi reaction prompt showing the attack roll with Shield as an option; choosing it adds +5 AC and may turn the hit into a miss. Not answering for 30 s ends the prompt with no reaction.
- [ ] R2. GM attacks the Rogue with Goblin 2 and hits. Expected: Player1 gets a prompt offering Uncanny Dodge on damage; choosing it halves the damage applied.
- [ ] R3. Player1 tries Shield twice in the same round. Expected: Midi warns the reaction is already used (enforce reactions).
- [ ] R4. On the goblins' shared turn, with Goblin 1 as Foundry's current combatant, the GM attacks with Goblin 2 twice in a row. Expected: no "Reaction Used, proceed anyway?" dialog and no "Reaction used" effect on Goblin 2; both attacks are plain attacks. Then, on the Cleric and Rogue's turn, attack with Goblin 1: Midi treats it as an opportunity attack as before.

## 5b. Target picker (v0.10.0; K1-K6 green on v0.11.0; K7 added in v0.11.1)

Setup: the Cleric (Player1) with Sacred Flame (60 ft, one creature, save) and Cure Wounds (touch, one creature, heal); the Fighter with a Longsword; Goblin 1 at 40 ft from the Cleric, Goblin 2 at 90 ft; the Rogue adjacent to the Cleric and wounded. Nothing targeted (clear with T if needed).

- [ ] K1. Player1 uses Sacred Flame with nothing targeted. Expected: no card yet; an orange circle of 60 ft round the Cleric and the notice "Sacred Flame: click a target within 60 ft (1 needed)"; clicking Goblin 2 (90 ft) warns it is out of range and keeps waiting; clicking Goblin 1 targets it, the circle and notice vanish, Midi's save card for Goblin 1 appears, damage applied. Report the console `[bg3-flow] target picker: Goblin 1` line.
- [ ] K2. Cure Wounds with nothing targeted: a 5 ft circle (touch); clicking the Rogue heals it; clicking a goblin 40 ft away is refused.
- [ ] K3. Esc (and, in a second try, a right click) while the circle is up: the use is cancelled, no card, no slot spent, the circle and notice gone.
- [ ] K4. Target Goblin 1 with T first, then Sacred Flame: no circle, no notice, the card at once (as before the picker).
- [ ] K5. The Fighter's Longsword with nothing targeted: a 5 ft circle; clicking an adjacent goblin attacks it; a goblin 10 ft away is refused.
- [ ] K6. Unaffected flows: Fireball (template, no circle), Shield as a reaction (no circle), the autopilot's goblins on their turn (no circle on the GM), Gambit's opportunity attack prompt (no circle). With the setting off, K1 behaves as before the picker (Midi's "no target" handling).
- [ ] K7. Yourself (v0.11.1): the Cleric uses Cure Wounds with nothing targeted and clicks its own token: healed; a Potion of Healing the same way: drunk. The Fighter's Longsword with nothing targeted and a click on the Fighter itself: ignored, still waiting (an attack never targets its wielder).

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

- [ ] B1. Wyrmling at (8,4), Rogue at (4,4), **Fighter right behind the Rogue at (3,4)** (a token one row off sits on the cone's edge ray and Foundry leaves it out), Cleric away at (1,4). On its turn: it walks to (6,4) or (5,4) (both squares catch the two), and breathes **with no dialog**: the cone starts at the edge of its own space, so the Wyrmling gets no save card of its own; a cone template appears from the Wyrmling toward the Rogue, two Midi save cards (Rogue and Fighter), damage applied, and the template is gone once the cards are posted. If Midi ever stalls, the autopilot gives the use up after 180 s (60 s before v0.9.6), removes the template and whispers the error; whisper **Red Dragon Wyrmling: Fire Breath vs Rogue (expected ...); also: Bite ...** (the aim is whichever it names); the console line shows `Fire Breath[save r15 ... cone15 recharge]`. Report who was hit and whether anyone standing just outside the 15 ft was included or excluded.
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

### 7d. Lair actions, legendary monsters by hand, Enlarge house rule (piece 5, v0.9.0; all green by v0.9.1; L1, L2, L10 timing and L11 new in v0.9.2, green; L10 variant green on v0.9.3)

Setup on the goblin scene, legacy rules world (dnd5e setting *Rules version: Legacy*). Goblin 1 gets a lair on its sheet (**Lair initiative 20** in the sheet's resources) and two feats: *Acid Pool* (activation Lair, save DEX DC 15, half on save, 2d8, range left at the sheet's default *Self* with no area, or *Any*: both mean anywhere in the lair) and *Grasping Roots* (activation Lair, utility, no damage, no save). Order Cleric 20, Rogue 18, Goblin 1 15, Goblin 2 12.
- [ ] L1. Start the combat. The Cleric sits at initiative 20 and the lair loses ties, so the PCs' shared turn plays first; when the turn passes to the goblins: the whisper `lair: Acid Pool vs <nearest PC> (expected ...); not scored: Grasping Roots`, the Acid Pool save card from Midi on that PC, no token moves. Report the console line (`lair` on the board line, `Acid Pool[save lair rInfinity ...]`, each enemy's `threat`).
- [ ] L2. Round 2, on the step from the PCs to the goblins: `lair: nothing to score; last round: Acid Pool; by hand: Grasping Roots`, no card. Round 3, same step: Acid Pool again.
- [ ] L3. Goblin 1's autopilot off (robot button): its turn waits for the GM, the lair still acts at the top of the round.
- [ ] L4. Goblin 2 with **Legendary Actions** 3 on its sheet: its robot button shows off by default and the goblins' turn is not auto-passed; click the button: it plays from its next turn on (a click mid-turn does not play the current one); click again: off.
- [ ] L5. Goblin 1 at 0 hp or marked defeated: no lair action, no whisper. Setting **Lair actions** off: nothing at the top of the round.
- [ ] L6. Previous turn across a round boundary (back from round 2 to round 1): nothing fires.
- [ ] L7. Pause before each monster action on: the pause dialog opens for the lair action; Skip skips it (whisper already sent); Take over also only skips it: Goblin 1's robot button stays as it was and the next round's lair plays again.
- [ ] L8. Modern rules world (dnd5e setting *Rules version: Modern*), Goblin 1 keeping its 2014 statblock: with the lair flag on and *Inside lair* unchecked: no lair action and no whisper; checked: as L1 (the world's rules decide, as on the NPC sheet, not the statblock's own).
- [ ] L10. Busy autopilot: Goblin 2 (autopilot on, Shortbow) last in the order, the Rogue with a Midi reaction (Uncanny Dodge or Shield) to prompt; when Goblin 2's shot leaves the Rogue's reaction dialog open, the GM presses next turn into the new round. Expected: nothing fires while the dialog is open; once the Rogue answers (or the dialog times out), the PCs' turn carries on and the lair fires at its place (the step to the goblins); nothing is dropped and nothing plays twice. Variant (v0.9.3): press next turn several times while the dialog is open (past the goblins, into the next round, on to its goblins); once it resolves, the round you landed in gets its one lair and the goblins play once; the rounds stepped past get none.
- [ ] L11. Lair timing: set the Cleric's initiative to 19 (everyone below 20). Expected: the lair fires at the top of the round, before the Cleric's turn. Then Cleric 20 and Rogue 21 (both at 20 or more, sharing the turn): the lair fires after their shared turn, before the goblins. Then Goblin 1 at 21 (first in the order): the lair fires after Goblin 1's turn, before the PCs.
- [ ] L9. Threat and conditions: give *Grasping Roots* a save (DEX DC 15, no damage) and an active effect with the Restrained status; the Fighter (Longsword, Extra Attack if the sheet has it) 60 ft from Goblin 1, the Cleric and the Rogue together 30 ft away. Top of the round with Acid Pool used last round: whisper `lair: Grasping Roots vs <the PC with the highest threat> (denies ...)`, Midi's save card on that PC; report the console line (each enemy's `threat`: a Cleric with Fireball outranks a Fighter with Extra Attack, that is expected). Then remove the Restrained effect from Grasping Roots (save only, no status): same aim, same number (restrained and "no status" are both half a turn).
- [ ] H1. Enlarge house rule: cast *Enlarge/Reduce* (Enlarge) on the Fighter (Strength 16, Longsword), or apply the dnd5e *Enlarged* effect to it: the effect on the Fighter shows, instead of its 1d4 weapon damage bonuses, two **Rules** changes of type Bonus on key `damage` (`@abilities.str.mod` and `1d4`, each with a condition); the Str check/save advantage changes stay. A Longsword hit rolls `1d8 + 3 + 3` with no d4. Report the effect's changes as the sheet shows them and the damage formula of the card; if the card still shows a d4, also report the prepared actor's `system.rolls.damage.mwak`.
- [ ] H2. Enlarge on the Rogue (Dagger, Dexterity): the damage card keeps `1d4` from Enlarge and no Strength modifier. A thrown Handaxe by the enlarged Fighter: Strength twice, no d4.
- [ ] H3. Setting **Enlarge: Strength twice** off, Enlarge cast again: the effect keeps its single `1d4` change and the card shows the d4.

### 7e. Compatibility run: Plutonium Addon: Automation + Chris's Premades stack (run on v0.9.3; X11, X12 new in v0.9.4; X13, X14 new in v0.9.5 and green: round closed)

Result of the v0.9.5 run: X13 and X14 pass (throw with no dialog, quantity down, turn passes; the stopped goblin ends on the square it was leaving, no Rogue prompt, re-plans `Scimitar vs Fighter`). Gambit's own *Sentinel - Movement* effect (speed 0) stays on the monster until removed: Gambit's behaviour.

Result of the v0.9.4 run (X11, X12, X6 recheck): X6 recheck pass. X11 pass: the Ogre throws its javelin at 30 ft (roll `attackMode` thrown, quantity down by one, Greatclub when adjacent), but Midi forced dnd5e's Attack Roll dialog on the GM for every throw (Midi does that on thrown weapons unless the activity's *force roll dialog* is "never") and the autopilot waited on it: v0.9.5 sets "never" on the activity clone it uses. X12 partial: the Sentinel stop itself worked (Gambit's hit, the goblin stopped on the square it was leaving, Gambit's *Sentinel - Movement* effect), but the snap back to the grid afterwards was a walk: Gambit's region opened a false opportunity attack prompt for the Rogue, and with the token still between squares the board floored its square to the one next to the Rogue and attacked out of reach (Midi: "target is 10 away"). v0.9.5: the snap is a displace move (a teleport action: Gambit's regions ignore teleports and the movement veto lets it through) and the board reads a token's square from the centre of its top-left cell. Not ours: Midi counts a move-only wall as total cover. Known: a Large token routed to a boxed-in target (every neighbour taken) walks, gets blocked and ends between squares; it re-plans from there (the throw).

Result of the v0.9.3 run: X0, X1, X3, X5, X6, X9 pass; X2, X4, X7, X8 partial; no double prompt anywhere. Not ours: Plutonium's plain Enlarge/Reduce applies both effects from one save and has no size change (our rule pair still lands: 1d8 + 3 + 3); its plain Uncanny Dodge prompts on hit and halves nothing (use Midi's sample item); CPR's Spirit Guardians spares allies by its own CAT macros, so our friend-or-foe prompt does not appear (its region behaviour is disabled; the outcome is right); CAT's Troubleshooter asks to change Midi, DAE, dnd5e and Argon settings on every load (left untouched). Ours, fixed in v0.9.4: the addon's split "Javelin (Ranged)" (a thrown melee weapon: dnd5e keeps it melee with reach 5) is now also a ranged option at the weapon's thrown range (X11); the initiative roll no longer passes the deprecated `messageOptions.rollMode` (X6 warning).

Goal: see whether bg3-flow keeps working with the automation stack that Plutonium Addon: Automation brings in, and where it overlaps with Gambit's Premades. Test world only (bg3-flow-test), every module the table uses left active. Manifests verified for Foundry 14.369 / dnd5e 6.0.6:
- DAE 14.6.6 (the dnd5e 6 build): https://github.com/tposney/dae/releases/download/latest-dnd6/module.json
- Coven's Automation Toolkit (CAT) 0.1.7: https://github.com/chrisk123999/covens-automation-toolkit/releases/download/0.1.7/module.json
- Cauldron of Plentiful Resources (CPR, Chris's Premades) 2.1.7, prerelease: https://github.com/chrisk123999/chris-premades/releases/download/2.1.7/module.json
- Plutonium Addon: Automation 0.9.1: https://github.com/TheGiddyLimit/plutonium-addon-automation/releases/latest/download/module.json
(Times Up is not required by any of them.)
- [ ] X0. Install in that order, enable all four, reload GM and Player1. Report the full active module list with versions, every console error or warning at load (both clients), the bg3-flow `on` lines, and any setup dialog CPR or the addon opens (answer "no" to anything that would change Midi settings, and say what it asked).
- [ ] X1. Import with Plutonium, addon active: Enlarge/Reduce, Shield, Spirit Guardians, Counterspell (spells); Sentinel (feat); Uncanny Dodge (rogue class feature); a Goblin and an Ogre (monsters). For each, report whether it came with CPR automation (flags `chris-premades` on the item, effects, activities) or plain.
- [ ] X2. Enlarge from the imported spell on the Fighter: the Enlarged effect carries our two Rules changes (`damage`, Bonus) and the size change; Longsword card `1d8 + 3 + 3`. Reduce on the Rogue: the `-1d4` change is left alone, size shrinks. Report the effect's changes as the sheet shows them.
- [ ] X3. Reactions with both Gambit's and CPR active: Shield when the Fighter is hit, Uncanny Dodge when the Rogue is damaged, Counterspell when Goblin 1 casts (give it a spell). Expected to look for: exactly one prompt per trigger. Report every double prompt and which module each prompt came from.
- [ ] X4. Spirit Guardians (the imported CPR version) on the Cleric with an ally inside: does the friend-or-foe prompt (**Enemies only / Everyone**) appear, and is the ally spared when you pick Enemies only? Report whether the spell uses a Midi region behaviour or CPR's own mechanism (the activity's Midi section).
- [ ] X5. Turn flow regression: a 2v2 combat; shared turn line, movement lock off-turn, movement budget message, blue circles, turn markers on both PCs. Anything different from before.
- [ ] X6. Encounters regression: mark the goblins, walk the Rogue into range unhidden; spotted line, initiative prompt on Player1, combat starts.
- [ ] X7. Autopilot with the CPR-imported Goblin and Ogre on the autopilot: both act on their turn (move, attack, whisper); any Midi refusal or error whisper; the console lines.
- [ ] X8. Sentinel (the imported CPR feat) on the Fighter plus Gambit's opportunity attack: a goblin walking out of reach; how many prompts, which module, does the goblin stop on a hit (our Sentinel stop), any double attack.
- [ ] X9. Lair L1 with the stack active (Goblin 1's lair as in 7d): whisper, card, timing unchanged.
- [ ] X10. Player1 side through all of it: prompts, cards, console. Then disable the four modules again (or keep them, your call in the report) and say what the world looks like after.
- [ ] X11. Thrown weapons (v0.9.4): the imported Ogre (autopilot on) 30 ft from the Rogue with no path to melee (a wall or two tokens between them), the Greatclub out of reach. Expected: the brief lists `Javelin (Ranged)[attack r5 ...]` and `Javelin (Ranged) (thrown)[attack r30 ... ranged]`; the whisper picks the thrown one; Midi's card is a javelin attack from 30 ft with no "out of range" refusal, the attack mode shown as thrown (the card or the roll's `attackMode`), the quantity of javelins down by one. Then the Ogre adjacent to the Rogue: Greatclub, not the throw. Report the item's data as well: `system.type.value`, `system.properties`, `system.range`, the activity's `attack.type.value` and Midi's `attackMode` field.
- [ ] X12. Sentinel stop, again (v0.9.5: after the stop no prompt for the Rogue, no Midi refusal, the goblin re-plans from the square it stopped on: `Goblin: Scimitar vs Fighter (expected ...)` when adjacent to the Fighter, or `approach Rogue` with nothing in reach; report the second whisper and the squares): the goblin must have a walk of 3+ squares planned (start it adjacent to the Fighter with the Rogue 20 ft behind the Fighter); AC 5 on the goblin. Expected: Gambit's opportunity attack hits, the goblin stops on the square it was leaving from (not the one it was stepping to) and its turn ends there (the brief's move cut short; it may still shoot from where it stands).
- [ ] X13. Thrown weapon without a dialog (v0.9.5): X11's run 3 again (Ogre speed 0, 30 ft from the Rogue). Expected: no Attack Roll dialog on the GM, the throw resolves by itself (card, `attackMode` thrown, quantity down by one), the turn passes.
- [ ] X14. A reaction that stops a monster between squares: X12's final setup (goblin with 30 temp hp, AC 25 then 5 on Gambit's prompt). Expected after the stop: no "Rogue has a reaction available" line and no prompt on Player1; a position trace ending on a whole square; the goblin's second whisper from that square and its attack (or no attack) consistent with Midi's range (no "Midi refused the use").
Report: pass/fail per step, the list of conflicts found (double prompts, broken prompts, errors), and your recommendation: keep the stack, keep only some of it (which), or drop it.

### 7f. Stack configuration: bg3-flow first, Plutonium imports work as they come (run on v0.9.5; P9-P11 new in v0.9.6; P12 new in v0.9.7; P9, P10, P12 green on v0.9.7: round closed, the recipe below is the one for Eldemar)

Result of the v0.9.7 run: P9, P10, P12 pass (the detour leaves the row and comes back next to the Rogue; all four regions present 1.15 s after the turn; CPR spells arrive with `system.prepared` 1, the NPC and the setting off untouched); the `getEffect()` line is gone. Harness note: a GM teleporting a monster next to a PC starts an encounter (the check runs after the move settles), delete that combat before a run.

Result of the v0.9.6 run: P11 pass (72 s reaction chain inside the cap). P9 partial: the wait worked, but with the Rogue on the Fighter's row Foundry's route went through the Fighter's square, the move was refused at once and the goblin attacked the Fighter instead (v0.9.7: a route through an enemy's space is replaced by a breadth-first detour around enemies' squares and move walls, P12); and once the wait ended between two of Gambit's regions (they come ~250 ms apart; v0.9.7: two unchanged polls, or every combatant's region). P10 fail: dnd5e 6 spells carry `system.method` and `system.prepared` 0/1/2, not `preparation` (v0.9.7: fixed, the system's spellcasting config says which methods prepare). Also fixed: dnd5e's `getEffect()` deprecation logged on every autopilot turn. Noted: the world comes up paused after launch and the autopilot plays regardless (the GM unpauses; players cannot move while paused, so an encounter cannot start from them).

Result of the v0.9.5 run: P0, P2, P7 pass; P1, P4, P5, P6 partial; P3 fail. The recipe is in the run's report (summarised at the end of this section). Ours, fixed in v0.9.6: a chain of player reactions (Gambit's Counterspell 15 s, Shield 30 s, Hellish Rebuke 15 s) passed the autopilot's 60 s cap on a use and stopped the Priest's turn: the cap is 180 s now; Gambit's opportunity attack regions are created asynchronously at combat start, so a monster with the first turn walked past the Fighter with no prompt: the autopilot now waits for them (at most 3 s) before the first move of a fresh combat; CPR-automated spells added from the sidebar stayed unprepared: a new house rule marks a prepared-kind spell prepared when it is created on a character (setting *New spells arrive prepared*). Not ours and accepted: CAT has no per-item exclusion, so CPR or Gambit's own the emanations (Spirit Guardians, Moonbeam, Cloud of Daggers...): CPR's spare allies on their own, without our prompt, same outcome; Plutonium's plain Enlarge/Reduce lets a willing target save (apply CPR through CAT's Item Medkit); plain Uncanny Dodge does nothing (Midi's sample item); Gambit's Counterspell prompts on cantrips too; missing animation packs (JB2A, jaamod, animated-spell-effects-cartoon) give red Sequencer errors on Fireball, Hellish Rebuke and Spiritual Weapon.

Goal (user request): with DAE, CAT, CPR and Plutonium Addon: Automation installed, anything imported with Plutonium must work at the table exactly as bg3-flow configures it, with nothing to touch afterwards; where a third-party automation and bg3-flow overlap, bg3-flow's flow wins. Test world only; the outcome is a recipe (every setting touched, with its value) to repeat on Eldemar.

What "bg3-flow first" means concretely: the Midi preset bg3-flow applies from its settings menu is the reference (auto roll and apply everything, item effects applyRemove, reactions prompted, no target confirmation); CAT's Troubleshooter must not change Midi's damage or effect settings, and when it did, the preset is re-applied from the menu. Spells with an area that bg3-flow handles itself (the friend-or-foe prompt and Midi's region damage: Spirit Guardians, Moonbeam, Cloud of Daggers and other emanations) keep their plain Midi form, not CPR's. Gambit's Premades stays the owner of Opportunity Attack, Counterspell and Sentinel.

- [ ] P0. Baseline: record Midi's `ConfigSettings` keys `autoApplyDamage`, `autoCEEffects`, `addDamageButtons`, `autoItemEffects` and the reaction keys. Then re-apply the bg3-flow preset from its settings menu (Configure Settings, BG3 Flow, the preset button) and record them again: that is the reference state.
- [ ] P1. CAT Troubleshooter: apply only the fixes that do not touch Midi: dnd5e *Allow Transformation* true, DAE *Special Duration Expiry Action* and *Effect Expiry Action* delete. Do NOT apply the Midi ones (apply Convenient Effects, auto apply damage, damage buttons) nor the Argon target picker one; report whether the Troubleshooter keeps whispering and whether a setting exists to silence it.
- [ ] P2. Automation sources (CPR's "Set Up Automation Sources" / CAT settings): order Gambit's Premades, then CPR, then the addon's own data. Report the exact UI path and the resulting list.
- [ ] P3. Exclusions for the spells bg3-flow handles: find CAT's mechanism to keep an item plain (a per-item automation source "none", an exclusion list, or a CatKit choice) and set it for Spirit Guardians, Moonbeam, Cloud of Daggers (and any emanation CPR would take over). Import Spirit Guardians plain, cast it with an ally inside: the Enemies only / Everyone prompt appears, the ally is spared, Midi's region damages the enemy. If the plain import has no Midi region behaviour, compare with the dnd5e SRD compendium version and report what is missing.
- [ ] P4. Plutonium: set the "Import via Plutonium?" prompt to never ask (import directly) and find the option that marks imported spells prepared (or report that none exists); keep *split melee/ranged attacks* on. Add Shield from the sidebar to the Fighter: no dialog, prepared, Midi offers it on the next hit.
- [ ] P5. Representative import, each item then used once at the table: Shield, Absorb Elements, Hellish Rebuke, Counterspell, Spiritual Weapon, Bless, Healing Word, Fireball, Enlarge/Reduce, Misty Step, Uncanny Dodge, Sentinel, Second Wind, Cunning Action. For each: the source CAT applied, whether it worked with the bg3-flow flow (one prompt, no configuration dialog, card and effect), or whether it needs a swap (Midi's sample item or the dnd5e compendium version). Enlarge/Reduce with CPR first: it must ask Enlarge or Reduce, the Enlarged effect must carry our two Rules changes, Longsword 1d8 + 3 + 3. Misty Step: no opportunity attack from Gambit's.
- [ ] P6. Monsters: import Goblin, Ogre and Priest (MM'14), autopilot on, a 3v3: they act with no change (move, attack, the Ogre throws when out of reach, the Priest casts), no refusal, no dialog.
- [ ] P7. Regression with the stack configured: encounter start from the Rogue walking in, shared turn line and markers, one lair round (Goblin 1's lair as in 7d L1), one Sentinel stop (as X14). All as before.
- [ ] P8. The recipe: list every setting changed in P1-P4 with module, menu path and value, plus the per-item exclusions and the items that needed a swap in P5. Leave bg3-flow-test configured this way.
- [ ] P9. First turn of a fresh combat (v0.9.6): the imported Goblin (autopilot on) wins initiative in a combat started by the encounter (the Rogue walks in), the Fighter with Gambit's Sentinel adjacent to the goblin's path, the Rogue 20 ft behind. Expected: a short pause (under 3 s) before the goblin moves, then Gambit's opportunity attack prompt for the Fighter as in X14. Report the console times of the shared turn line and the first move.
- [ ] P10. Prepared on creation (v0.9.6; fixed for dnd5e 6 data in v0.9.7): drag the CPR-automated Shield and Bless from the sidebar onto the Fighter and the Cleric: both arrive with `system.prepared` 1 and no hand edit; Midi offers Shield on the next hit. A spell dropped on the Priest (NPC): dnd5e's own 1, untouched by us. Setting off, Bless again: 0. (dnd5e rewrites always-prepared and pact copies on a drop onto a Cleric, so those cannot be tested that way.)
- [ ] P12. Detour round an enemy (v0.9.7): P9's layout with the Rogue on the Fighter's row (goblin (11,15), Fighter (10,15), Rogue (6,15)). Expected: the goblin's route leaves the row and comes back next to the Rogue instead of through the Fighter's square; it walks (Gambit's prompt for the Fighter as it leaves its reach), no refused move, and the whisper names the Rogue. Report the route squares from the console or the trace.
- [ ] P11. Reaction chain within the cap (v0.9.6): the Priest casts Guiding Bolt at the Fighter with the Cleric's Counterspell (Gambit's) and the Fighter's Shield both offered and answered late (10 s each): the use completes, no "Midi did not finish the use" whisper, the turn passes.
Report: pass/fail per step, the recipe, and what could not be made to work as-is.

Recipe from the v0.9.5 run (bg3-flow-test is configured this way): bg3-flow preset applied; Midi `consumeResource` and `gmConsumeResource` "both" (otherwise reaction spells open a cast-level dialog); CAT *Hide Troubleshooter Warnings* true and sources Gambit's 5, CPR 10, Midi QOL 20; dnd5e *Allow Transformation* and *Allow Summoning* true; DAE both expiry actions delete; core permission *Create New Tokens* for Player and Trusted (Spiritual Weapon); Gambit's Opportunity Attack, Counterspell and Sentinel on (reload after changing); Plutonium `import.dragDropMode` 2, `importSpell.prepareSpellItems` 1, `importSpell.prepareActorSpells` 1, split melee/ranged on; the addon's CPR integration on. Per item after import: Enlarge/Reduce gets CPR through CAT's Item Medkit; Uncanny Dodge is Midi's sample item; Spiritual Weapon answers its style questions once.

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
L1 ...
...
L11 ...
H1 ...
H2 ...
H3 ...
Y1 ...
...
Y8 ...
K1 ...
...
K7 ...
X0 ...
...
X14 ...
P0 ...
...
P12 ...
Console lines containing [bg3-flow]:
<paste>
Other console errors during the run:
<paste>
Anything surprising:
<free text>
```
