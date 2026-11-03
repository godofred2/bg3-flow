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

Details and the other options: Midi's README, section "Region Behaviour (AoE)": https://github.com/tposney/midi-qol#readme

## Settings

- **Full automation**, **BG3 turn flow**, **Encounters and stealth**: feature toggles.
- **Lock GM movement too**, **Default encounter radius**, **Obscured darkness threshold**: used by features 2 and 3.

## Development

```
npm test        # pure rules, no Foundry needed
```

Design spec: `docs/superpowers/specs/2026-11-02-bg3-flow-design.md`. Server test script: `docs/SERVER-TESTING.md`.
