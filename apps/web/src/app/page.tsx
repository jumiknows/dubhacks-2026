import { buildPlaceContext } from "@emberready/domain";
import { Workspace } from "../components/workspace";
import { currentReplay, loadPlaces, loadRegion, sourceFromSnapshot } from "../lib/server/catalog";

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
    <Workspace
      demo={{
        places,
        bbox: loadRegion().bbox,
        snapshotId: snapshot.manifest.snapshotId,
        asOf: snapshot.manifest.scope.asOf,
        windowStart: snapshot.manifest.scope.windowStart,
        fetchedAt: snapshot.manifest.source.fetchedAt,
        observations: snapshot.observations,
        initialContext,
      }}
    />
  );
}
