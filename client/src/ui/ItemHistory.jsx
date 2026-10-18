import { money, quantityLabel } from "./format.js";

export default function ItemHistory({ plan, selectedId, onSelect }) {
  if (!plan) {
    return (
      <aside className="item-history" aria-label="Item history">
        <p className="item-history-kicker">History</p>
        <p className="quiet">Items to buy will show up here, like a chat.</p>
      </aside>
    );
  }

  return (
    <aside className="item-history" aria-label="Item history">
      <p className="item-history-kicker">History</p>
      <ol className="item-thread">
        <li className="hist-msg is-prompt">
          <p className="hist-who">You</p>
          <p>{plan.prompt}</p>
        </li>
        {plan.items.map((item) => {
          const qty = quantityLabel(item);
          const price = item.synthesis?.totalPrice;
          const bought = item.purchased;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`hist-msg ${bought ? "is-bought" : "is-open"} ${item.id === selectedId ? "is-active" : ""}`}
                aria-pressed={item.id === selectedId}
                onClick={() => onSelect(item.id === selectedId ? null : item.id)}
              >
                <p className="hist-who">{bought ? "Purchased" : "To buy"}</p>
                <p className="hist-name">{item.name}</p>
                <p className="hist-meta">
                  {item.reason}
                  {qty ? ` · ${qty}` : ""}
                  {price != null ? ` · ${money(price, item.synthesis?.currency)}` : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
