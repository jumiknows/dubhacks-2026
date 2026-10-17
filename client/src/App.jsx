import { useEffect, useState } from "react";

export default function App() {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");

  useEffect(() => {
    fetch("/api/items")
      .then((res) => res.json())
      .then(setItems)
      .catch((err) => console.error("Failed to load items", err));
  }, []);

  async function addItem(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const item = await res.json();
    setItems((prev) => [...prev, item]);
    setText("");
  }

  return (
    <main className="container">
      <h1>DubHacks 2026</h1>
      <p>Edit <code>client/src/App.jsx</code> to get started.</p>

      <form onSubmit={addItem}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an item…"
        />
        <button type="submit">Add</button>
      </form>

      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </main>
  );
}
