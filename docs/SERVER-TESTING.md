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

## 5. Reactions

Setup: give the Cleric the spell **Shield** (reaction) and the Rogue the feature **Uncanny Dodge** from Midi's sample items compendium if present (else SRD, and set the Midi use condition `reaction === "isDamaged"` on its activity). Both owned by Player1.

- [ ] R1. GM attacks the Cleric with Goblin 1 and hits. Expected: Player1 gets a Midi reaction prompt showing the attack roll with Shield as an option; choosing it adds +5 AC and may turn the hit into a miss. Not answering for 30 s ends the prompt with no reaction.
- [ ] R2. GM attacks the Rogue with Goblin 2 and hits. Expected: Player1 gets a prompt offering Uncanny Dodge on damage; choosing it halves the damage applied.
- [ ] R3. Player1 tries Shield twice in the same round. Expected: Midi warns the reaction is already used (enforce reactions).
- [ ] R4. On the goblins' shared turn, with Goblin 1 as Foundry's current combatant, the GM attacks with Goblin 2 twice in a row. Expected: no "Reaction Used, proceed anyway?" dialog and no "Reaction used" effect on Goblin 2; both attacks are plain attacks. Then, on the Cleric and Rogue's turn, attack with Goblin 1: Midi treats it as an opportunity attack as before.

## 6. Encounters and stealth (feature 3)

Setup: no combat. Turn **Encounters and stealth** on. Scene darkness 0 with a dark region on one side (or set scene darkness to 0.7 for the dark steps and back to 0 afterwards). Draw a wall between a corridor and the goblin room. Player1 owns the Rogue and the Cleric is also a player character. Villager stays unmarked. Place Goblin 1 and Goblin 2 in the room, the Rogue in the corridor 60 ft away.

- [ ] E1. GM selects both goblins, presses **Mark as encounter** (skull icon in the token controls), accepts radius 30. Expected (right after a reload, without re-rendering anything): both tokens get `flags.bg3-flow.encounter` with the same id and radius 30; the GM sees a red circle around each; Player1 sees no circle. Console: `[bg3-flow] encounters on` and the encounter line.
- [ ] E2. Player1 walks the Rogue to 40 ft from the nearest goblin, in light, no wall between. Expected: nothing (GM console: no spotted line, no combat).
- [ ] E3. Player1 walks to 25 ft with the wall between the Rogue and both goblins. Expected: nothing; GM console shows `Rogue unseen by group ...`.
- [ ] E4. Player1 steps into line of sight at 25 ft, in light. Expected, on that very move (not the next one): chat **Goblin 1 spotted Rogue!**, a combat is created with Cleric, Rogue, Goblin 1, Goblin 2 (not the Villager); Player1 sees their own initiative roll with 3D dice for the Rogue; the GM sees "Waiting for initiative from Cleric" with **Roll for them** if the Cleric's owner is offline, otherwise that player rolls; goblins roll on the GM; then **Shared turn** from feature 2. Report the initiative order.
- [ ] E5. End the combat. Move the Rogue back behind the wall. Player1 opens the Rogue's HUD, presses the eye-slash **Hide** button, chooses **Roll Stealth**. Expected: a public Stealth card, the *Hiding* status icon on the token, `flags.bg3-flow.stealth = {value, hidden: true, checked: []}`.
- [ ] E6. Hidden Rogue walks into line of sight at 25 ft in light. Expected: each goblin whose passive Perception is below the Stealth value rolls Perception publicly; if every roll is below the value nothing happens and `checked` now holds the group id; otherwise combat starts. Report passives, rolls and Stealth value.
- [ ] E7. If combat started in E6, end it and hide again using **Use this value** with 25. Make two more moves in sight. Expected: Perception rolls each move, no passive prompt, no combat (the rolls cannot reach 25 unless a goblin has +5 or more).
- [ ] E8. Still hidden, Player1 attacks Goblin 1 with the Rogue (shortbow or dagger). Expected: *Hiding* cleared, and on a hit the combat starts (chat: no spotted line, started by damage). On a miss, nothing: attack again until a hit.
- [ ] E9. End the combat. Log Player1 out. Set scene darkness 0.7. GM moves the Rogue within 25 ft of the goblins behind the wall (no line of sight). Expected: the GM gets the Stealth roll-or-type dialog for the Rogue (no owner online). Choose Roll. Then log Player1 in, GM clears the Rogue's `stealth` flag, GM moves the Rogue 5 ft. Expected: Player1 gets the Stealth prompt; GM sees "Waiting for Stealth from Rogue" with **Roll for them**. Press it: the GM gets the roll-or-type dialog and its answer is used; Player1's prompt closes by itself. Set darkness back to 0.
- [ ] E10. Turn **Encounters and stealth** off, reload both windows. Expected: no skull button, no Hide button in the HUD, the Rogue walks up to the goblins in sight with nothing happening. Turn it back on.

## 7. Report template

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
Console lines containing [bg3-flow]:
<paste>
Other console errors during the run:
<paste>
Anything surprising:
<free text>
```
