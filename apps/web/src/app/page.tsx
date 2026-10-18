import { buildPlaceContext } from "@emberready/domain";
import { Workspace } from "../components/workspace";
import { currentReplay, loadPlaces, sourceFromSnapshot } from "../lib/server/catalog";

export const dynamic = "force-dynamic";

export default function Page() {
  const places = loadPlaces();
  const snapshot = currentReplay();
  if (!snapshot || places.length === 0) {
    return (
      <main className="empty-state">
        <h1>EmberReady</h1>
        <p>The replay snapshot is unavailable. Live NASA access is separate and needs FIRMS_MAP_KEY.</p>
      </main>
    );
  }
  const place = places[0];
  const initialContext = buildPlaceContext({
    place,
    snapshotId: snapshot.manifest.snapshotId,
    mode: "replay",
    asOf: snapshot.manifest.scope.asOf,
    observations: snapshot.observations,
    source: sourceFromSnapshot(snapshot),
  });
  return (
    <>
      <header>
        <div className="brand">EmberReady</div>
        <div className="edition">Washington observation replay</div>
      </header>
      <main>
        <div className="intro">
          <h1>What was observed near this community?</h1>
          <p>Thermal detections from a retrieved NASA FIRMS file. Counts, distances, and the attention band come from the selected cutoff. This is not a fire probability or an evacuation instruction.</p>
        </div>
        <Workspace
          demo={{
            places,
            snapshotId: snapshot.manifest.snapshotId,
            asOf: snapshot.manifest.scope.asOf,
            windowStart: snapshot.manifest.scope.windowStart,
            fetchedAt: snapshot.manifest.source.fetchedAt,
            observations: snapshot.observations,
            initialContext,
          }}
        />
      </main>
    </>
  );
}
