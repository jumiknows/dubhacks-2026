# Camping widget

The tabs across the top are the widgets. Camping should follow the groceries widget: boxes for each plan, a list inside a box, and item details with a link, a price, and alternatives. Alternatives stay empty until the backend returns other listings.

The point of the tab is to put the facts for this trip in one place, so the list matches the trip instead of a generic packing checklist.

## Boxes

A box is one trip or one kit.

- Weekend car camp
- One-night backpack
- Group site
- Day hike that still needs food and water

Show the name, dates if known, item count, and estimated cost. Opening the box shows the gear and food list.

## What to show on the plan

Only facts that change what to pack, what to buy, or when it has to arrive.

- Dates, nights, and group size. Quantities come from these.
- Place: campground or trailhead, drive time, reservation or permit status.
- Weather for those dates: high, low, rain, wind. Use it to flag a warmer bag, a rain fly, or an extra layer.
- Water: filter, carry, or a spigot on site.
- Rules that change the list: fire ban, bear canister, stove only.
- Owned gear versus still to buy. Checked items drop out of the buy total.
- Ready-by date from shipping, so late gear is obvious before departure.
- A short note per dinner that links to the groceries widget instead of copying recipes.

If a fact does not change the list, the cost, or the timing, leave it out.

## Item details

Same popup as groceries:

- Price
- Link to the listing
- Find alternatives — waiting on the backend. `server/services/fetchBot.js` has to return more than one listing before this list can render.

Once that exists, weight, packed size, and shared versus per person are the extra fields worth showing for camping.

## Making it convenient

- Seed the prompt from the box ("Two nights, car camping, four people, rain likely") and let the plan generator fill the list.
- Remember owned gear across trips so the next weekend does not ask for another stove.
- Sort what is left to buy by store, then by anything that would ship after departure.
- When the forecast or a fire ban changes, mark only the items to add or drop.
- One trip total: gear still to buy, plus food. Food can stay a link into Groceries.

## Waiting on the backend

Live weather, campground rules, and alternative products are not in the widget yet. Render whatever the plan payload already includes, and leave the alternatives list empty until the fetch service provides it.
