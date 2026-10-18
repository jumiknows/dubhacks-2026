export function money(amount, currency = "USD") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  if (!currency) return `${amount.toFixed(2)} (currency unknown)`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} (currency unknown)`; }
}

export function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function quantityLabel(item) {
  if (item.unit) return `${item.quantity} ${item.unit}`;
  if (item.quantity > 1) return `× ${item.quantity}`;
  return "";
}
