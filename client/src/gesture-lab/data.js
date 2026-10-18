// Deliberately fictional products; values are local demo data, not purchase advice.
export const products = [
  { id: 'alpine', name: 'Alpine 500', tagline: 'Carry less. Sleep warmer.', price: 260, weight: 850, comfort: -5, volume: 7, insulation: 'Down', color: '#80dbca' },
  { id: 'camp', name: 'Camp 300', tagline: 'A comfortable first camp.', price: 120, weight: 1650, comfort: 2, volume: 14, insulation: 'Synthetic', color: '#efc281' },
];
export const details = p => [
  { id: 'warmth', name: 'Warmth', value: `${p.comfort} °C`, note: 'Demo comfort temperature' },
  { id: 'carry', name: 'Carry', value: `${p.weight} g`, note: `${p.volume} L packed volume` },
  { id: 'price', name: 'Price', value: `$${p.price}`, note: 'Demo price in USD' },
  { id: 'fill', name: 'Insulation', value: p.insulation, note: 'Material, not a performance rating' },
];
export const criteria = [
  { key: 'price', label: 'Price', unit: 'USD', format: v => `$${v}` },
  { key: 'weight', label: 'Weight', unit: 'g', format: v => `${v} g` },
  { key: 'comfort', label: 'Comfort temperature', unit: '°C', format: v => `${v} °C` },
  { key: 'volume', label: 'Packed volume', unit: 'L', format: v => `${v} L` },
];
