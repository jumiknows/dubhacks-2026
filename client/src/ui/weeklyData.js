/** Example week. Nutrition figures are made up. */

const SEARCH = {
  "Trader Joe's": (query) => `https://www.traderjoes.com/home/search?q=${encodeURIComponent(query)}`,
  Safeway: (query) => `https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(query)}`,
  "H Mart": (query) => `https://www.hmart.com/catalogsearch/result/?q=${encodeURIComponent(query)}`,
  Costco: (query) => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(query)}`,
  Target: (query) => `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`,
};

function fact(calories, protein, carbs, fat, fiber, sugar, sodium) {
  return { calories, protein, carbs, fat, fiber, sugar, sodium };
}

function item(id, name, quantity, price, store, nutrition) {
  const search = SEARCH[store];
  return {
    id,
    name,
    quantity,
    price,
    store,
    url: search ? search(name) : null,
    nutrition,
  };
}

export const NUTRIENTS = [
  ["Calories", "calories", "kcal"],
  ["Protein", "protein", "g"],
  ["Carbs", "carbs", "g"],
  ["Fat", "fat", "g"],
  ["Fiber", "fiber", "g"],
  ["Sugar", "sugar", "g"],
  ["Sodium", "sodium", "mg"],
];

export const WEEK = [
  {
    id: "mon-penne",
    day: "Monday",
    name: "Penne Pasta",
    servings: 4,
    items: [
      item("penne", "Penne", "1 lb", 1.29, "Trader Joe's", fact(1480, 52, 296, 6, 12, 8, 20)),
      item("tomatoes", "Crushed tomatoes", "28 oz", 1.49, "Trader Joe's", fact(140, 6, 28, 1, 8, 18, 640)),
      item("garlic", "Garlic", "1 head", 0.5, "Trader Joe's", fact(20, 1, 4, 0, 0, 0, 2)),
      item("onion", "Yellow onion", "1", 0.79, "Trader Joe's", fact(40, 1, 10, 0, 2, 4, 3)),
      item("parmesan", "Parmesan", "4 oz", 2.99, "Trader Joe's", fact(440, 32, 4, 28, 0, 0, 720)),
      item("basil", "Fresh basil", "1 bunch", 1.28, "Trader Joe's", fact(8, 1, 1, 0, 1, 0, 1)),
    ],
  },
  {
    id: "tue-banh",
    day: "Tuesday",
    name: "Banh Mi",
    servings: 2,
    items: [
      item("baguette", "Baguette", "1", 1.5, "Safeway", fact(680, 22, 136, 4, 4, 6, 980)),
      item("pork", "Pork shoulder", "1 lb", 4.8, "H Mart", fact(720, 72, 0, 48, 0, 0, 280)),
      item("cucumber", "Cucumber", "1", 0.79, "H Mart", fact(16, 1, 4, 0, 1, 2, 2)),
      item("cilantro", "Cilantro", "1 bunch", 0.89, "H Mart", fact(4, 0, 1, 0, 1, 0, 4)),
      item("jalapeno", "Jalapeño", "2", 0.49, "H Mart", fact(8, 0, 2, 0, 0, 1, 0)),
      item("mayo", "Mayonnaise", "8 oz", 2.29, "Safeway", fact(180, 0, 1, 20, 0, 0, 160)),
      item("carrots", "Carrots", "1 lb", 1.58, "H Mart", fact(50, 1, 12, 0, 3, 6, 40)),
    ],
  },
  {
    id: "wed-stir",
    day: "Wednesday",
    name: "Chicken Stir Fry",
    servings: 3,
    items: [
      item("chicken", "Chicken breast", "1 lb", 4.99, "Costco", fact(540, 100, 0, 12, 0, 0, 220)),
      item("broccoli", "Broccoli", "1 crown", 1.79, "Costco", fact(55, 4, 11, 0, 4, 2, 30)),
      item("pepper", "Bell pepper", "2", 1.29, "Safeway", fact(40, 1, 9, 0, 2, 5, 4)),
      item("soy", "Soy sauce", "10 oz", 2.49, "Safeway", fact(30, 3, 3, 0, 0, 1, 1100)),
      item("rice", "Jasmine rice", "2 cups", 2.19, "Costco", fact(480, 10, 106, 1, 2, 0, 5)),
      item("ginger", "Ginger", "1 knob", 0.89, "Safeway", fact(10, 0, 2, 0, 0, 0, 1)),
      item("sesame", "Sesame oil", "5 oz", 3.29, "Costco", fact(120, 0, 0, 14, 0, 0, 0)),
    ],
  },
  {
    id: "thu-oats",
    day: "Thursday",
    name: "Overnight Oats",
    servings: 5,
    items: [
      item("oats", "Rolled oats", "18 oz", 2.49, "Target", fact(700, 24, 120, 12, 16, 2, 5)),
      item("milk", "Milk", "1 gal", 3.19, "Target", fact(150, 8, 12, 8, 0, 12, 105)),
      item("bananas", "Bananas", "1 lb", 0.56, "Target", fact(100, 1, 27, 0, 3, 14, 1)),
      item("berries", "Blueberries", "6 oz", 3.49, "Target", fact(50, 1, 12, 0, 2, 8, 1)),
      item("honey", "Honey", "12 oz", 4.29, "Target", fact(180, 0, 48, 0, 0, 46, 2)),
      item("chia", "Chia seeds", "8 oz", 3.29, "Target", fact(140, 5, 12, 9, 10, 0, 5)),
    ],
  },
  {
    id: "fri-tacos",
    day: "Friday",
    name: "Black Bean Tacos",
    servings: 4,
    items: [
      item("tortillas", "Corn tortillas", "12 ct", 1.89, "Safeway", fact(360, 10, 72, 6, 8, 2, 280)),
      item("beans", "Black beans", "15 oz", 0.99, "Safeway", fact(180, 12, 32, 1, 10, 1, 420)),
      item("cheddar", "Cheddar", "8 oz", 2.79, "Safeway", fact(320, 20, 2, 26, 0, 0, 520)),
      item("romaine", "Romaine", "1 head", 1.49, "Safeway", fact(20, 1, 4, 0, 2, 2, 10)),
      item("salsa", "Salsa", "16 oz", 2.29, "Safeway", fact(70, 2, 14, 0, 3, 8, 640)),
      item("lime", "Lime", "2", 0.5, "Safeway", fact(10, 0, 4, 0, 1, 1, 1)),
      item("avocado", "Avocado", "2", 1.5, "Safeway", fact(240, 3, 12, 22, 10, 1, 10)),
    ],
  },
  {
    id: "sat-salmon",
    day: "Saturday",
    name: "Salmon Bowls",
    servings: 2,
    items: [
      item("salmon", "Salmon fillets", "12 oz", 9.99, "Costco", fact(530, 50, 0, 36, 0, 0, 160)),
      item("sushi-rice", "Sushi rice", "1 lb", 2.49, "H Mart", fact(320, 6, 70, 1, 1, 0, 2)),
      item("edamame", "Edamame", "12 oz", 1.79, "Costco", fact(140, 14, 12, 6, 6, 3, 40)),
      item("avocado", "Avocado", "1", 1.5, "Costco", fact(160, 2, 8, 15, 7, 1, 7)),
      item("nori", "Nori", "1 pack", 2.49, "H Mart", fact(10, 1, 1, 0, 1, 0, 20)),
      item("scallion", "Green onion", "1 bunch", 0.99, "H Mart", fact(8, 0, 2, 0, 1, 1, 4)),
      item("cucumber", "Cucumber", "1", 1.79, "Costco", fact(16, 1, 4, 0, 1, 2, 2)),
    ],
  },
  {
    id: "sun-eggs",
    day: "Sunday",
    name: "Veggie Omelette",
    servings: 2,
    items: [
      item("eggs", "Eggs", "1 dozen", 2.84, "Safeway", fact(420, 36, 2, 28, 0, 2, 420)),
      item("spinach", "Spinach", "5 oz", 1.99, "Safeway", fact(20, 2, 3, 0, 2, 0, 60)),
      item("mushrooms", "Mushrooms", "8 oz", 2.29, "Safeway", fact(40, 4, 6, 0, 2, 3, 8)),
      item("cheddar", "Cheddar", "6 oz", 2.5, "Safeway", fact(280, 16, 2, 22, 0, 0, 460)),
      item("butter", "Butter", "8 oz", 3.49, "Safeway", fact(400, 0, 0, 44, 0, 0, 8)),
      item("tomatoes", "Cherry tomatoes", "1 pint", 2.99, "Safeway", fact(30, 1, 6, 0, 2, 4, 8)),
      item("bread", "Sourdough", "1 loaf", 1.47, "Safeway", fact(180, 6, 34, 2, 2, 1, 320)),
    ],
  },
];

export function sumPrices(items) {
  const cents = items.reduce((sum, item) => sum + Math.round(item.price * 100), 0);
  return cents / 100;
}

export function sumNutrition(items) {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
  for (const entry of items) {
    for (const key of Object.keys(total)) total[key] += entry.nutrition[key];
  }
  return total;
}

export function scaleNutrition(total, parts) {
  const scaled = {};
  for (const key of Object.keys(total)) scaled[key] = Math.round(total[key] / parts);
  return scaled;
}
