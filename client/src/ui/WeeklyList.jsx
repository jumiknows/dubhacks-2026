import { useEffect, useRef, useState } from "react";
import { money } from "./format.js";
import SnapStage from "./SnapStage.jsx";
import { NUTRIENTS, WEEK, scaleNutrition, sumNutrition, sumPrices } from "./weeklyData.js";

export default function WeeklyList({ bindBack, onBack }) {
  const [openMealId, setOpenMealId] = useState(null);
  const [popup, setPopup] = useState(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!openMealId || !bindBack) return undefined;
    return bindBack(() => setOpenMealId(null));
  }, [openMealId, bindBack]);

  useEffect(() => {
    if (!popup || !bindBack) return undefined;
    return bindBack(() => setPopup(null));
  }, [popup, bindBack]);

  useEffect(() => {
    if (!popup) {
      openerRef.current?.focus?.();
      return undefined;
    }
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [popup]);

  function openItem(meal, item, opener) {
    openerRef.current = opener;
    setOpenMealId(meal.id);
    setPopup({ meal, item });
  }

  return (
    <section className="week" aria-label="Weekly list">
      <SnapStage
        items={WEEK}
        getId={(meal) => meal.id}
        selectedId={openMealId}
        onSelect={setOpenMealId}
        onBack={onBack}
        onBeforeBack={() => {
          if (!popup) return false;
          setPopup(null);
          return true;
        }}
        renderCard={(meal, { selected, onChoose }) => (
          <MealCard meal={meal} selected={selected} onChoose={onChoose} />
        )}
        renderDetail={(meal) => <MealDetail meal={meal} onOpenItem={openItem} />}
      />
      {popup ? (
        <ItemDialog
          meal={popup.meal}
          item={popup.item}
          closeRef={closeRef}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </section>
  );
}

function MealCard({ meal, selected, onChoose }) {
  const total = sumPrices(meal.items);
  return (
    <article className={selected ? "meal is-open" : "meal"}>
      <button
        type="button"
        className="meal-hit transition duration-200 ease-snap active:scale-[0.98]"
        aria-pressed={selected}
        onClick={onChoose}
      >
        <p className="meal-day">{meal.day}</p>
        <p className="meal-name">
          {meal.name} ({meal.servings}x)
        </p>
        <p className="meal-meta">
          <span>{meal.items.length} items</span>
          <span>{money(total)}</span>
        </p>
      </button>
    </article>
  );
}

function MealDetail({ meal, onOpenItem }) {
  return (
    <>
      <p className="modal-kicker">{meal.day}</p>
      <h3 className="detail-title">{meal.name}</h3>
      <ul className="item-list">
        {meal.items.map((item, index) => (
          <li key={item.id} className="animate-stretch-in" style={{ animationDelay: `${index * 35}ms` }}>
            <ItemButton meal={meal} item={item} onOpen={onOpenItem} />
          </li>
        ))}
      </ul>
      <Nutrition meal={meal} />
    </>
  );
}

function ItemButton({ meal, item, onOpen }) {
  return (
    <button
      type="button"
      className="item-row transition duration-200 ease-snap active:scale-[0.98]"
      onClick={(event) => onOpen(meal, item, event.currentTarget)}
    >
      <span className="item-name">{item.name}</span>
      <span className="item-qty">{item.quantity}</span>
      <span className="item-price">{money(item.price)}</span>
    </button>
  );
}

function Nutrition({ meal }) {
  const total = sumNutrition(meal.items);
  const shown = scaleNutrition(total, meal.servings);

  return (
    <aside className="nutrition is-inline" aria-label="Nutrition details">
      <h3>Nutrition</h3>
      <p className="nutrition-basis">Per serving</p>
      <dl>
        {NUTRIENTS.map(([label, key, unit]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{formatFact(shown[key], unit)}</dd>
          </div>
        ))}
      </dl>
      <p className="nutrition-total">
        Recipe total {Math.round(total.calories).toLocaleString("en-US")} kcal
      </p>
    </aside>
  );
}

function formatFact(value, unit) {
  const shown = Math.round(value).toLocaleString("en-US");
  return unit ? `${shown} ${unit}` : shown;
}

function ItemDialog({ meal, item, closeRef, onClose }) {
  const [showAlternatives, setShowAlternatives] = useState(false);

  return (
    <div
      className="modal-back animate-fade"
      onClick={onClose}
      onPointerDown={(event) => {
        event.currentTarget.dataset.x = String(event.clientX);
      }}
      onPointerUp={(event) => {
        const start = Number(event.currentTarget.dataset.x);
        if (event.clientX - start > 64) onClose();
      }}
    >
      <div
        className="modal animate-bloom"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="modal-kicker">
          {meal.day} · {meal.name}
        </p>
        <h3 id="item-dialog-title">{item.name}</h3>
        <p className="modal-store">{item.quantity}</p>
        <p className="modal-price">{money(item.price)}</p>
        {item.url ? (
          <a className="modal-link" href={item.url} target="_blank" rel="noreferrer">
            View at {item.store}
          </a>
        ) : (
          <p className="modal-store">{item.store}</p>
        )}
        <button
          type="button"
          className="alt-toggle transition duration-200 ease-snap active:scale-[0.98]"
          aria-expanded={showAlternatives}
          onClick={() => setShowAlternatives((open) => !open)}
        >
          Find alternatives
        </button>
        {showAlternatives ? (
          <p className="alt-todo animate-stretch-in">
            TODO: alternatives for {item.name} come from the backend. The fetch service needs to return other listings before this list can be filled in.
          </p>
        ) : null}
        <button ref={closeRef} type="button" className="modal-close transition duration-200 ease-snap active:scale-[0.98]" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
