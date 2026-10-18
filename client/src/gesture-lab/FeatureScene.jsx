import { useLayoutEffect, useRef } from 'react';
import { details, products } from './data';

export function FeatureScene({ feature, ids, expanded, clicks, drops, cancelled, selected, setClicks }) {
  const catalog = useRef(null);
  useLayoutEffect(() => {
    if (catalog.current) catalog.current.scrollTop = feature === 'scroll-down' ? 360 : 0;
  }, [feature]);
  if (['expand', 'collapse', 'compare'].includes(feature)) return <div className="lab-workspace" data-scene={feature}>
    {products.filter(p => ids.includes(p.id)).map(p => {
      const open = expanded.includes(p.id);
      return <article key={p.id} className="lab-object" style={{ '--object-color': p.color }}
        data-gesture-object={p.id} data-gesture-group={p.id} data-gesture-kind={open ? 'group' : 'original'} data-expanded={open}>
        <div className="lab-object-heading"><span className="lab-object-icon">{open ? '⊞' : '◈'}</span><div><p>{p.id === 'alpine' ? 'PRIMARY OBJECT' : 'COMPARISON OBJECT'} / {open ? 'GROUP OF 4' : 'ORIGINAL'}</p><h2>{p.name}</h2></div><span className="lab-price">${p.price}</span></div>
        {open ? <div className="lab-components">{details(p).map(d => <div key={d.id} className="lab-component"
          data-gesture-object={`${p.id}:${d.id}`} data-gesture-group={p.id} data-gesture-kind="component"><span>{d.name}</span><strong>{d.value}</strong><small>{d.note}</small></div>)}</div>
          : <div className="lab-original"><div className="lab-bag" aria-hidden="true"><i /><i /><i /><i /><i /></div><div><h3>{p.tagline}</h3><p>{p.weight} g · {p.comfort} °C · {p.volume} L</p><span className="lab-grip-hint">L ← pinch here · pinch here → R</span></div></div>}
        <footer>{open ? `4 components stay grouped under ${p.name}. Pinch left and right components and bring them toward the middle to restore.` : 'Pinch this original with both hands and pull apart.'}</footer>
      </article>;
    })}
    {!ids.length && <div className="lab-empty">No primary object. Use “Spawn primary object” or “Load test scene”.</div>}
  </div>;
  if (feature === 'point') return <div className="lab-test-stage lab-point-scene"><div data-point-target data-gesture-id="lab-point"><span>Hold pointer here</span></div><p>Target radius: 32 px · continuous hold: 1 second</p></div>;
  if (feature === 'click' || feature === 'fist') return <div className="lab-test-stage lab-click-scene"><button data-gesture-id="lab-click" onClick={() => setClicks(n => n + 1)}>Select item</button><output data-click-count={clicks}>{clicks} activations</output></div>;
  if (['drag', 'parallel', 'recovery'].includes(feature)) return <div className="lab-test-stage lab-drag-scene">
    {(feature === 'drag' ? ['left'] : ['left', 'right']).map((id, i) => <div key={id} className="lab-drag-tile" data-gesture-id={`lab-drag-${id}`} data-gesture-draggable
      data-dropped={!!drops[`lab-drag-${id}`]} data-cancelled={!!cancelled[`lab-drag-${id}`]} style={{ left: `${8 + i * 24}%`, top: `${18 + i * 27}%` }}>
      {i ? 'Second tile / right hand' : 'Primary tile'}<small>{drops[`lab-drag-${id}`] ? 'Dropped in tray' : cancelled[`lab-drag-${id}`] ? 'Cancelled safely' : 'Pinch, hold and move'}</small>
    </div>)}
    <div className="lab-drop-tray" data-drop-zone="lab-tray">Drop tray <small>{Object.values(drops).filter(Boolean).length} items received</small></div>
  </div>;
  if (feature.startsWith('scroll')) return <div className="lab-test-stage lab-scroll-scene"><div ref={catalog} data-gesture-scroll data-testid="test-catalogue" className="lab-catalogue">
    {Array.from({ length: 18 }, (_, i) => <article key={i}><b>Catalogue item {i + 1}</b><span>Test clothing · ${40 + i * 5}</span></article>)}
  </div><p>Only this catalogue should move. The test controls and page should stay in place.</p></div>;
  return <div className="lab-test-stage lab-navigation-scene" data-navigation-surface data-product-id="lab-card" data-gesture-id="lab-card">
    {ids.includes('alpine') ? <article data-testid="navigation-primary"><p>PRIMARY OBJECT</p><h2>Alpine 500</h2><p>{selected ? 'Revealed by left swipe' : 'Swipe right to throw this card away'}</p></article>
      : <p>{feature === 'reveal' ? 'Swipe right → left to spawn the primary object here.' : feature === 'idle' ? 'Open-hand movement only. No object or action should appear.' : 'Primary object dismissed.'}</p>}
  </div>;
}
