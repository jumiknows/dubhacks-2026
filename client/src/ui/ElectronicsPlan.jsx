import { useState } from "react";
import { useGestureEvents } from "conjure-gestures";
import { takeSwipe } from "./swipeGate.js";
import { ADVISORIES, DEVICES, TRENDS, nextReplacement } from "./electronicsData.js";

const STATUS_LABEL = {
  Good: "Good",
  Watch: "Watch",
  Replace: "Replace soon",
};

export default function ElectronicsPlan({ onBack }) {
  const [index, setIndex] = useState(0);
  const device = DEVICES[index];
  const selectedId = device?.id ?? null;

  useGestureEvents("scroll", (event) => {
    const board = document.querySelector(".fleet");
    if (!board || board.closest("[inert], [aria-hidden='true']")) return;
    if (!takeSwipe()) return;
    const direction = (event.delta_y ?? 0) > 0 ? 1 : -1;
    setIndex((current) => Math.min(DEVICES.length - 1, Math.max(0, current + direction)));
  });

  useGestureEvents("dismiss", () => {
    const board = document.querySelector(".fleet");
    if (!board || board.closest("[inert], [aria-hidden='true']")) return;
    if (!takeSwipe()) return;
    onBack?.();
  });

  if (!device) return null;
  const trend = TRENDS[device.id] || [];
  const updates = ADVISORIES.filter((item) => item.deviceId === device.id);

  return (
    <section className="fleet" data-gesture-scroll data-gesture-step aria-label="Electronics health">
      <header className="fleet-head">
        <h2>Device health</h2>
        <p>Swipe up or down to move through the fleet. Grab and release a row to focus it.</p>
      </header>
      <div className="fleet-grid">
        <table className="health-table">
          <caption>Fleet</caption>
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Battery</th>
              <th>Next</th>
            </tr>
          </thead>
          <tbody>
            {DEVICES.map((item, row) => {
              const battery = item.specs.find(([label]) => label === "Battery");
              const next = nextReplacement(item);
              return (
                <tr
                  key={item.id}
                  className={item.id === selectedId ? "is-picked" : undefined}
                  data-product-id={item.id}
                >
                  <td>
                    <button type="button" className="fleet-pick" onClick={() => setIndex(row)}>
                      {item.name}
                    </button>
                  </td>
                  <td className={`device-status is-${item.status.toLowerCase()}`}>{STATUS_LABEL[item.status]}</td>
                  <td>{battery ? battery[1] : "—"}</td>
                  <td>{formatWhen(next.when)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="fleet-detail">
          <h3>{device.name}</h3>
          <p className="device-note">{device.summary}</p>
          <TrendChart points={trend} />
          <table className="advisory-table">
            <caption>Safety updates</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Advisory</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {updates.length === 0 ? (
                <tr>
                  <td colSpan="4">No open advisories.</td>
                </tr>
              ) : (
                updates.map((item) => (
                  <tr key={item.id}>
                    <td>{formatWhen(item.when)}</td>
                    <td>{item.title}</td>
                    <td>{item.severity}</td>
                    <td>{item.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TrendChart({ points }) {
  if (points.length < 2) return null;
  const width = 360;
  const height = 140;
  const min = 70;
  const max = 100;
  const coords = points.map((point, index) => {
    const x = 28 + (index / (points.length - 1)) * (width - 40);
    const y = 16 + (1 - (point.capacity - min) / (max - min)) * (height - 36);
    return { x, y, ...point };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <figure className="trend">
      <figcaption>Battery capacity, last six months</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Battery capacity trend">
        <polyline points={line} fill="none" stroke="#8ee0b2" strokeWidth="2.5" />
        {coords.map((point) => (
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r="3" fill="#d7fff4" />
            <text x={point.x} y={height - 6} textAnchor="middle" fill="#9aa8b5" fontSize="10">
              {point.month}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function formatWhen(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
