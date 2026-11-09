# Pack & Ledger: Inventory, Coins & Character Log

[![stable](https://img.shields.io/github/v/release/Flashiiio/Pack-and-Ledger.svg?label=stable&display_name=tag&sort=date&cacheSeconds=3600)](https://github.com/Flashiiio/Pack-and-Ledger/releases/latest) ![downloads](https://img.shields.io/github/downloads/Flashiiio/Pack-and-Ledger/pack-and-ledger.zip?label=downloads&displayAssetName=false) ![license](https://img.shields.io/github/license/Flashiiio/Pack-and-Ledger?label=license)

🇩🇪 [Deutsche Version](README.de.md)

Pack & Ledger extends inventory management for D&D 5e in Foundry VTT: it enforces container capacity limits and adds trading and shared supplies. The module also logs coin movements, character changes and its own activities.

- **Inventory:** The module enforces containers' existing capacity limits when stowing items. It also limits the number of items carried directly on the body.
- **Item piles and trading:** Items can be dropped onto the map, picked up within reach and traded between characters.
- **Provisions and rests:** The group keeps track of food and water and shares them out at group rests called by the GM.
- **Logs:** Coin movements, character changes and module activities are recorded.

Many features can be enabled and configured individually in the module settings. The following sections describe their behavior when enabled.

## 🎒 Containers

- When stowing items, Pack & Ledger checks the weight and item count limits configured on the container. Increases to the quantity or weight of items already inside are checked too. A limit of 0 means unlimited capacity.
- Nested containers and their contents count toward capacity. The module also checks the limits of parent containers. The "weightless contents" property is respected when calculating weight.
- By default, the module prevents overfilling. Optionally, overfilling can be allowed with a configurable risk: exceeding capacity may tear the container. This requires the character to have a token on a scene and a GM to be logged in. The items inside are then scattered around the token as item piles.
- Torn containers cannot hold additional items. Use *Repair container* in the item's context menu to make them usable again.

## 🧍 Body slots

Physical items outside containers occupy body slots according to their category. Weapons, shields, armor, clothing, tools, backpacks, jugs and small items (called "trinkets" in the module) each have their own configurable limits. These rules apply to player characters by default and can also be extended to non-player characters (NPCs).

- Weapons count individually, even within a stack: five longswords occupy five weapon slots. Daggers are the exception: two daggers share one slot.
- In the other categories, a stack occupies one slot. Trinkets also have a configurable weight limit per item.
- Items without a suitable slot must be stowed in a container unless they are marked as "free". When a newly added item has no permitted body slot, the module can automatically stow it in a container with enough room. New containers themselves are excluded from this automatic stowing.

The module detects an item's category from its type and name. The name patterns for clothing, jugs, trinkets and items that need no slot can be changed and tested directly in the settings. The GM can also assign a category manually or mark an item as "free" (no slot required) or "always stow".

Optionally, a configurable share of the body weight entered on the character sheet can be added to the carried weight.

## 💰 Item piles

- Physical items such as equipment and consumables can be dragged onto the map. They form a new item pile or are added to an existing one. Players can only move items from inventories they own or piles within reach.
- Characters within the configured reach can pick up individual items, whole stacks or the entire contents, as far as the inventory rules allow. The GM is exempt from the reach check.
- Coins can also be dropped and picked up. They can be placed into or taken out of containers while those containers are in a pile.
- Empty piles are deleted automatically by default. Chests with a configured lock remain even when empty. Automatically generated pile names do not include quantities.

**Hidden piles** can be discovered within the configured search range with a sufficiently high Perception check. By default, passive Perception is also checked when a player-owned token moves. A discovered pile becomes visible to everyone. When the GM moves a pile, players do not see its movement ruler.

**Locked chests** can be opened with a matching key in the inventory or a successful thieves' tools check. The GM sets the matching key's name and the difficulty class. A Mystery Key has a 5% chance of success and is consumed on success. Each character can try it once per lock; locking the chest again resets these attempts.

**In the pile window**, the GM can:

- rename the pile, for example to "Suspicious sack";
- hide or lock the pile and set its coin balance;
- mark items as unidentified so players only see their unidentified name and description.

A button in the token controls also lets the GM place a coin pile anywhere on the map.

Potions and scrolls that the GM drags onto the map from the Items sidebar or a compendium are placed as unidentified by default. Existing unidentified names and descriptions are preserved; if they are missing, the module supplies names such as "Unknown potion" or "Unknown scroll". The actual name remains visible to the GM in the pile window. Items dropped from character inventories retain their existing identification status.

## 🤝 Trading

The *Trade* button below the player list lets two characters exchange items and coins. Trading with NPCs is also supported; the GM handles NPCs without a player.

Both sides assemble their offers in a shared window and see changes immediately. Every offer change resets both acceptances. Once both sides accept, the module checks the offers and transfers the items and coins. If the recipient does not have enough room, the trade is rolled back. The completed trade appears in chat.

By default, the participating tokens must be within trading range. The range is configurable. When the GM trades on behalf of both sides, this check is skipped.

## 🍞 Group inventory

The group inventory brings together the supplies of player characters and accompanying stores in a window available to everyone. Items remain in their respective inventories. The window opens from the token controls. The standard character sheet also has a tile next to the containers.

- **Overview:** Calculates how many full days food and water will last based on the configured daily requirements. It also shows counts of other supplies, such as torches or lamp oil. To track another kind of item, the GM drags a matching item onto *Track an item*.
- **Characters:** Shows how much food, water and other tracked supplies each character carries.
- **Stores:** Shows the contents of actors the GM has marked as stores in their sheet header, such as a wagon. A switch in the group inventory determines whether a store accompanies the group. Stores left behind do not count toward available supplies; players cannot change, deposit or withdraw anything in them. The GM can still edit them.

Items are sorted by category: water, food, potions, poisons, scrolls, trinkets, ammunition, weapons and other items.

The module recognizes food and water as consumables of type "food" with the matching subtype "food", "water" or "both". For consumables and loot items, it also checks the name patterns in the settings.

For items with charges, the module counts the remaining charges across the entire stack; otherwise, it counts quantity. For example, five full waterskins with four pints each provide 20 pints of water. Food is consumed in half rations: if a character eats only half a ration, the module remembers the partly eaten ration and deducts it only once the second half has been eaten. The group inventory then shows the supply as, for example, 2.5 rations. When individual waterskins in a stack are emptied, the module separates the empty ones from those still containing water. Empty waterskins remain in the inventory. The GM can refill them using *Refill waterskins* in the group inventory overview. This applies to characters and stores with the group; refilled stacks are merged again.

**Magic sources** also count toward the calculation of remaining supply days. When allocating supplies during a rest, the following applies with the default daily requirements:

- An *Alchemy Jug* provides either half a ration each for up to five people per day or a full day's water each for up to 16 people per day.
- A *Tankard of Plenty* provides a day's water for up to two people per day. Its holder is served first.

Daily use resets at dawn according to Foundry's world time. Calling a long rest with the *New day* option also makes magic sources available again. The supply forecast assumes that Alchemy Jugs provide whichever food or water is needed each day.

## 🏕️ Rests

The GM calls a rest for the group using the *Rest* button below the player list and chooses:

- whether it is a short or long rest and which characters participate;
- which characters are away from the group entirely. Absent characters do not join the rest, and their supplies and magic items are unavailable for that rest;
- whether the rest counts as a new day and whether world time advances by the rest's duration;
- whether temporary hit points are removed and which characters have changes to their hit point maximum reset;
- whether an external food or water source is available, such as an inn or a river. How much it provides is configured in the module settings;
- whether Alchemy Jugs provide food, water or automatically whichever supply is expected to run out sooner that day (only if a character or store with the group carries an Alchemy Jug).

Players cannot change these options. By default, only the GM can start rests; this restriction can be disabled. Hit points, hit dice, spell slots and other recovery are still calculated by the dnd5e game system. A short rest opens its rest dialog.

**At a called long rest with food or water requirements**, the participating players allocate supplies in a shared window:

1. By default, the players decide who gets which food and water. If they need help, the GM can use *Propose a sharing* to request a proposal from the module. A setting allows the module to propose an allocation from the start. The proposal considers external sources, supported magic sources, accompanying stores and the supplies of player characters present with the group, including characters who are not resting themselves.
2. Anyone participating can add sources and change sources and quantities. After each change, everyone must agree again.
3. The rest begins once all participating players have agreed. The GM can also start it without everyone's agreement or cancel it. If no players are involved, the GM starts the rest.
4. The allocated supplies are consumed and the characters carry out their rests. If enabled, world time advances by the rest's duration once for the entire group.

**Exhaustion from hunger and thirst** is taken into account at long rests and can be disabled separately. The module credits food and water already consumed that day. Daily requirements, the saving throw DC and the limit for days without food are configurable. With the default settings:

- **Less than half the daily water requirement:** The character gains one level of exhaustion, or two levels if already exhausted.
- **At least half, but less than the full water requirement:** A Constitution saving throw against difficulty class (DC) 15 determines whether the character gains this exhaustion.
- **Food:** Eating some food, but no more than half a ration, adds half a day without food. Eating nothing adds a whole day. The limit is three days plus the Constitution modifier, treating the modifier as at least +1. Exceeding that total gives the character one level of exhaustion. Eating more than half a ration resets the days-without-food counter.
- **Recovery:** With too little water or no more than half a ration, exhaustion is not reduced during that rest.

Water is counted in pints. By default, a waterskin with four pints covers a character's daily requirement. The rest system can be disabled in the *Provisions* settings tab.

## 🪙 Coins and invoices

The **coin log** records manual coin changes and coin movements through item piles, trades and invoices. It stores the time, responsible user, amount and balances before and after the change, where available for the operation.

Automatic monitoring of manual changes applies to actors in the Actors sidebar owned by at least one player. The separate data of unlinked tokens is not automatically monitored. Changes made by the GM can be excluded from this monitoring.

- Many changes in a short time can be flagged as suspicious.
- After a player changes coins, the GM can add a reason.
- The coin log window shows saved changes and invoice events as a table for one day or all days. It provides filters, search and a detail view. Entries can be deleted; the displayed list can be downloaded as CSV or copied to the clipboard as JSON.

If a balance in the **character sheet's coin fields** is insufficient for a particular denomination, the module can use other coins and calculate change. Automatic conversion must be enabled, and the character must have enough coins in total.

For example, a character has two gold pieces and no silver pieces. Entering `-5` in the silver field deducts five silver pieces, leaving one gold piece and five silver pieces. The GM can allow change to include platinum and electrum.

The GM sends **invoices** from the token controls or an actor sheet's header to player-owned actors. Up to five simultaneous drafts per GM are supported. Prices can be entered as, for example, `5 gp 2 sp` or `3 gold 4 silver`; templates can be managed by category. Sending requires a player with owner permissions to be logged in and a sufficient coin balance to pay.

The receiving player can pay or decline the invoice. When paying, the module checks the current coin balance again, calculates change and posts a private chat receipt for the actor's owners and the GM.

## 🧾 Character tracker

The character tracker logs changes to player characters' stored data with their values before and after the change. This includes hit points, spell slots, resources, inventory, item uses and concentration. Changes in quick succession are grouped together. By default, all player-owned characters are tracked, including unlinked tokens; tracking can optionally be limited to characters assigned to players.

Changes made by the GM and confidential fields such as the biography are excluded by default. Both options are configurable. Coin changes appear in the separate coin log.

**Spells:** When the module detects a spent spell slot from a dnd5e usage card, it adds the spell cast to the log. For example, below "Spell slots level 3: 3 → 2", it shows "cast: Fireball (level 3)". If it detects a use that requires a spell slot without one being spent, a warning appears. Manually changed spell slots cannot be associated with a spell this way. Hovering over a spell link shows a preview; clicking opens the spell.

**Snapshots** are saved states of a character. The GM opens the snapshot window using *Character snapshot* in the character sheet header and saves a snapshot there. *Save all characters* in the log window creates snapshots of all tracked characters. Existing snapshots are replaced.

The snapshot window compares the saved state with the current one. The GM can restore individual differences or all displayed differences to the saved state. This includes restoring deleted items or removing newly added ones. The character's coin balance and fields excluded from comparison in the settings are not restored.

## 📜 Log

The module stores its logs in the world compendium **Pack & Ledger Logs**, which only the GM can open. These include activities such as picking up and stowing items, torn containers, trades, discoveries, opened chests and meals. Character changes and the module's warnings and errors are recorded there too.

New log entries are stored by the logged-in GM. Activities and character changes require *Write the log* to be enabled; coin monitoring has its own switch.

- **Log tab:** A dedicated sidebar tab shows the GM up to 300 entries from the last 24 hours as cards. The view updates automatically and can be filtered by activities, coins and characters. Spell warnings are also visible; technical warnings and errors appear in the log window. A dot indicates new entries.
- **Log window:** Shows activities, character changes and technical messages for one day or all days. It provides search and filters by message type, user and character. Individual entries or whole days can be deleted. Loaded entries can be downloaded as a text file; the currently filtered entries can be exported as CSV. Coin movements appear in their own coin log.
- **Retention:** Older entries can be deleted automatically after a configurable number of days.

## ⚙️ Settings

The GM manages all module settings in a single window with tabs organized by topic. Players have no separate module settings. Notifications can be limited to important messages.

## 🌍 Languages

English and German.

## 📋 Requirements

- Foundry VTT **v14.370**
- **dnd5e 6.0.6**

## 🧩 Compatible modules

- **Blind Skill Rolls** (hidden NPC names stay hidden in trades)

## 📦 Installation

Manifest URL:

`https://github.com/Flashiiio/Pack-and-Ledger/releases/latest/download/module.json`


## 💁 Support

Issues and feedback:

`https://github.com/Flashiiio/Pack-and-Ledger/issues`

Discord:

`https://discord.gg/upVqdYqg4p`