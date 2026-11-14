## [1.1.0] - 2026-11-14

### Added

#### Ammunition containers

- Ammunition containers hold only their ammunition. A quiver holds up to 20 arrows, a crossbow bolt case up to 20 crossbow bolts. A Quiver of Ehlonna has three compartments, usable at the same time: 60 arrows, bolts or similar ammunition, 18 javelins or similar, and 6 long weapons such as bows, spears or quarterstaffs. Its contents weigh nothing.
- Arrows and crossbow bolts go only into a quiver, a crossbow bolt case or a Quiver of Ehlonna, not into a backpack or any other container. Auto-stow puts them into a matching container with room.
- Ammunition containers are worn on the body and cannot be stowed in a backpack or another container. They can never be overfilled, so they never tear, not even with "Overfill with tear risk". Ordinary containers holding ammunition can still tear.
- New world compendium "Pack & Ledger Containers" with a needle case, sling bullet pouch, ammunition pouch, dart case, javelin quiver and throwing knife sheath. Each accepts only its designated ammunition. Its capacity sets the maximum quantity. Using them is up to the GM.
- New setting in the Containers tab: "Ammunition containers hold only their ammunition".

#### Distributing coins

- "Distribute equally among the group" for coins in an item pile: the coins are shared out equally among the group's player characters, denomination by denomination; what cannot be shared out equally goes to the character who shares them out. A preview shows who gets what first. Each share is written to the coin log.
- When coins are shared out, the other players are told in a chat message what they received.

#### Group fund

- New group fund for shared purposes such as "General", "Boat" or "Reserve". Reserved coins stay in each character’s purse. The group inventory shows the total for each purpose and each character’s contribution; the character sheet shows the reserved share of the coin balance.
- Characters can reserve their own coins for the group fund, release them or distribute them equally among the group. Only the GM can distribute other characters’ coins. Players receive their shares in a chat message; deposits and withdrawals appear in the coin log.
- Spending reserved coins displays a warning listing the affected purposes. This applies to coin fields, dnd5e’s currency tools, invoices, trades and dropping coins. Exchanging denominations preserves the reserved value and does not trigger a warning.
- Group members can rename purposes and remove empty ones. Only the GM can remove a purpose with reserved coins.
- New "Group fund" setting in the *Coins* tab: disabled, a separate button on coin piles, or automatic reservation of all coins taken from piles for "General". No warnings appear while the group fund is disabled.

#### Waterskins

- Waterskins hold only water, and no more than their capacity. They are never overfilled and never tear. Auto-stow puts water into a waterskin first.
- The GM can refill a single waterskin with "Refill" in its context menu. "Refill waterskins" in the group inventory now also fills waterskins that are containers (dnd5e 2024) with pints of water.

#### Shared container rules

- No coins go into waterskins and ammunition containers, neither in an item pile nor in the inventory.
- Waterskin and ammunition container rules apply regardless of the "Enforce container capacity" setting. With it switched off, ordinary containers take anything, while waterskins and ammunition containers keep their rules.

#### Food and water

- Food and water are recognized by the dnd5e 6.1 properties "Nutritious" and "Hydrating". With older dnd5e versions, the subtype "food", "water" or "both" counts instead.

#### Compendiums and languages

- The containers in the compendium follow the GM's language. Containers imported from it use the importing user’s language. Manually edited names and descriptions are preserved.
- The module’s compendiums are grouped in the "Pack & Ledger" compendium folder.

### Changed

#### Item piles

- A player opens an item pile only when their character stands within reach of it ("Pile reach (squares)" setting). When the character moves out of reach, the pile's window closes. The GM opens any pile.

#### Containers and overfilling

- With "Overfill with tear risk", storing something in a full container first asks for confirmation and warns that the container may tear.
- Messages about overfilled and torn containers no longer give percentages or the risk of tearing, for either players or the GM. These details remain in the log.

#### Rests

- "Add a source" in the long rest window adds an empty line. The source has to be chosen; until then the line contributes no supplies.

#### Compatibility

- Verified with dnd5e 6.1.0.

### Fixed

- CSV exports of the logs show names starting with "=", "+", "@" or "-" as text, so a spreadsheet does not run them as formulas.

## [1.0.0] - 2026-11-09

First release. See the README for a feature overview.