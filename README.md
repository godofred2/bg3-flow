# BG3 Flow

Makes D&D 5e combat in Foundry VTT play like Baldur's Gate 3. Three features, each with its own on/off setting:

1. **Full automation** (shipped): a one-click Midi QOL preset for zero-prompt attacks, damage and saves with public dice, plus a friend-or-foe prompt for areas that let you choose targets.
2. **BG3 turn flow** (planned): consecutive allies share one turn, movement is locked off-turn and budgeted on-turn, reachable range drawn on the map.
3. **Encounters and stealth** (planned): preset enemy groups that start combat when they spot or hurt a player, with Stealth versus Perception.

## Requirements

| Package | Version |
|---|---|
| Foundry VTT | 14 |
| dnd5e system | 6.0.x |
| Midi QOL | 14.6 or newer |
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
| Auto apply damage | Yes, no damage card confirmation | HP changes immediately |
| Player saves | Auto roll, public | players' saves roll by themselves |
| NPC saves | Auto | GM's monsters save by themselves |
| Template auto target | Walls Block | everyone inside the area is targeted, walls respected |
| Hide roll details | none | nothing hidden |

It also turns off Midi's target confirmation and dnd5e's own initiative grouping. Every value can be changed afterwards in Midi's settings. Dice So Nice keeps animating every roll because the rolls stay public.

## Friend-or-foe prompt

When you cast an area spell whose activity has **Allow choosing targets** on (the checkbox in the activity's Targeting section, next to the area settings) and at least one ally stands inside, a dialog appears for the caster:

- **Enemies only**: allies are removed from the targets.
- **Everyone**: nothing removed.
- **Only checked**: tick the allies you still want to hit.

Spells without that checkbox, such as Fireball, hit everyone inside with no prompt. If the cast created a Midi region (an ongoing area), the choice is written onto the region's disposition filter so later rounds respect it.

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

Details and the other options: Midi's README, section "Region Behaviour (AoE)": https://github.com/tposney/midi-qol#readme

## Settings

- **Full automation**, **BG3 turn flow**, **Encounters and stealth**: feature toggles.
- **Lock GM movement too**, **Default encounter radius**, **Obscured darkness threshold**: used by features 2 and 3.

## Development

```
npm test        # pure rules, no Foundry needed
```

Design spec: `docs/superpowers/specs/2026-11-02-bg3-flow-design.md`. Server test script: `docs/SERVER-TESTING.md`.
