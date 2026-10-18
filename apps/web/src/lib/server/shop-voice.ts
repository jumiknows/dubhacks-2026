/** Grok Voice as OrbiCart's shopping companion. Tools run in the page; see components/orbicart. */

export function shopInstructions(today: string): string {
  return [
    "You are OrbiCart, a friendly camping shopping companion. Today is " + today + ".",
    "Learn where the user is camping, when, how many people, their budget and what gear they already own. Ask for whatever is missing, one short question at a time. If they say 'this weekend' use the coming Saturday and 1 night.",
    "As soon as you know the destination, call plan_trip. Call it again whenever any detail changes, including a new destination. Then call find_products.",
    "plan_trip returns the kit and the NASA evidence behind each item. When you explain an item, cite the evidence it returned, for example 'NASA POWER shows rain on 59% of these days'. When the destination changes, say what changed in the kit and why.",
    "find_products returns real products from outdoor stores and a budget plan. Recommend only those products and prices. If the budget cannot cover everything, say what it covers and suggest renting or borrowing the rest.",
    "If the user already owns an item or does not want it, call mark_owned. If they pick a product, call select_product. Use set_map_layer when they ask to see rain, snow, satellite imagery or fires.",
    "Never invent prices, products, weather or fire information. Checkout is not connected yet: say the Trust Receipt and payment come next.",
    "Keep each spoken reply to two or three short sentences. The screen shows the details.",
  ].join(" ");
}

export const shopTools = [
  {
    type: "function", name: "plan_trip",
    description: "Build or update the trip profile and camping kit from NASA environmental evidence. Call with the destination at minimum.",
    parameters: {
      type: "object", additionalProperties: false, required: ["destination"],
      properties: {
        destination: { type: "string", description: "Town, park or area, e.g. 'Seattle, WA' or 'Moab, UT'" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        nights: { type: "integer", minimum: 0, maximum: 14 },
        people: { type: "integer", minimum: 1, maximum: 12 },
        budget: { type: "number", description: "Total budget in US dollars" },
        owned: { type: "array", items: { type: "string" }, description: "Gear the user already owns" },
      },
    },
  },
  {
    type: "function", name: "find_products",
    description: "Fetch real products for the current kit from connected outdoor stores, ranked for each item, with a plan for what the budget covers.",
    parameters: { type: "object", additionalProperties: false, properties: { item_id: { type: "string", description: "Optional: only this kit item" } } },
  },
  {
    type: "function", name: "select_product",
    description: "Put a product in the cart for a kit item.",
    parameters: { type: "object", additionalProperties: false, required: ["item_id", "product_id"], properties: { item_id: { type: "string" }, product_id: { type: "string" } } },
  },
  {
    type: "function", name: "mark_owned",
    description: "The user already owns this kit item or does not want it. Removes it from the kit.",
    parameters: { type: "object", additionalProperties: false, required: ["item_id"], properties: { item_id: { type: "string" } } },
  },
  {
    type: "function", name: "set_map_layer",
    description: "Show or hide a map layer.",
    parameters: { type: "object", additionalProperties: false, required: ["layer", "visible"], properties: { layer: { type: "string", enum: ["precipitation", "snow", "true_color", "fires"] }, visible: { type: "boolean" } } },
  },
];
