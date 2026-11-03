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

## 4. Report template

```
Foundry: 14.xxx   dnd5e: 6.0.x   Midi QOL: 14.x.x (before: 14.x.x)
C1 pass/fail - note
C2 ...
...
C16 ...
Console lines containing [bg3-flow]:
<paste>
Other console errors during the run:
<paste>
Anything surprising:
<free text>
```
