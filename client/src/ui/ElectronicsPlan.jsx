import { useEffect, useState } from "react";
import { DEVICES, nextReplacement } from "./electronicsData.js";
import SnapStage from "./SnapStage.jsx";

const STATUS_LABEL = {
  Good: "Good",
  Watch: "Watch",
  Replace: "Replace soon",
};

export default function ElectronicsPlan({ bindBack, onBack }) {
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!selectedId || !bindBack) return undefined;
    return bindBack(() => setSelectedId(null));
  }, [selectedId, bindBack]);

  return (
    <section className="devices" aria-label="Electronics">
      <SnapStage
        items={DEVICES}
        getId={(device) => device.id}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onBack={onBack}
        renderCard={(device, { selected, onChoose }) => (
          <DeviceCard device={device} selected={selected} onChoose={onChoose} />
        )}
        renderDetail={(device) => <DeviceDetails device={device} />}
      />
    </section>
  );
}

function DeviceCard({ device, selected, onChoose }) {
  const next = nextReplacement(device);
  return (
    <article className={selected ? "device is-on" : "device"}>
      <button type="button" className="device-hit" aria-pressed={selected} onClick={onChoose}>
        <p className="device-kind">{device.kind}</p>
        <p className="device-name">{device.name}</p>
        <p className="device-meta">
          <span className={`device-status is-${device.status.toLowerCase()}`}>
            {STATUS_LABEL[device.status]}
          </span>
          <span>
            {next.part} · {formatWhen(next.when)}
          </span>
        </p>
      </button>
    </article>
  );
}

function DeviceDetails({ device }) {
  return (
    <aside className="device-panel is-inline" aria-label="Device details">
      <h3>Device details</h3>
      <p className="device-panel-kicker">{device.kind}</p>
      <p className="device-panel-name">{device.name}</p>
      <p className={`device-status is-${device.status.toLowerCase()}`}>{STATUS_LABEL[device.status]}</p>
      <p className="device-note">{device.summary}</p>

      <h4>Product</h4>
      <dl className="device-facts">
        <div>
          <dt>Serial</dt>
          <dd>{device.serial}</dd>
        </div>
        <div>
          <dt>Purchased</dt>
          <dd>{formatWhen(device.purchased)}</dd>
        </div>
        <div>
          <dt>Warranty</dt>
          <dd>{device.warranty}</dd>
        </div>
      </dl>

      <h4>Specs</h4>
      <dl className="device-facts">
        {device.specs.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <h4>When to replace</h4>
      <ul className="replace-list">
        {device.replacements.map((item) => (
          <li key={item.part}>
            <p className="replace-part">
              {item.part}
              <span>{formatWhen(item.when)}</span>
            </p>
            <p className="device-note">{item.note}</p>
          </li>
        ))}
      </ul>

      <a className="modal-link" href={device.url} target="_blank" rel="noreferrer">
        Support page
      </a>
    </aside>
  );
}

function formatWhen(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
