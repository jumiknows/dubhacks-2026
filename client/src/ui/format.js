export function money(amount, currency = "USD") {
  if (typeof amount !== "number") return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
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
