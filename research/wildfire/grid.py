"""10 km equal-area grid over Washington (EPSG:5070), clipped to the state boundary."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as reproject

from .config import RAW, experiment

TO_ALBERS = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
TO_LONLAT = Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True)


@dataclass
class Grid:
    cells: pd.DataFrame  # cell_idx, cell_id, ix, iy, x, y, lon, lat
    size: int
    ix0: int
    iy0: int
    nx: int
    ny: int
    lookup: np.ndarray  # raster (nx, ny) of cell_idx, -1 outside the state

    def locate(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """cell_idx for each point, -1 when it falls outside the gridded state."""
        x, y = TO_ALBERS.transform(np.asarray(lon, float), np.asarray(lat, float))
        ix = np.floor(np.asarray(x) / self.size).astype(int) - self.ix0
        iy = np.floor(np.asarray(y) / self.size).astype(int) - self.iy0
        inside = (ix >= 0) & (ix < self.nx) & (iy >= 0) & (iy < self.ny)
        out = np.full(ix.shape, -1)
        out[inside] = self.lookup[ix[inside], iy[inside]]
        return out


def state_polygon(code: str = "WA"):
    reader = shapefile.Reader(str(RAW / "census" / "cb_2023_us_state_500k.zip"))
    for record, geometry in zip(reader.records(), reader.shapes()):
        if record["STUSPS"] == code:
            return shape(geometry.__geo_interface__)
    raise ValueError(f"State {code} not found in the Census boundary file")


def build_grid() -> Grid:
    size = experiment()["grid"]["cell_m"]
    polygon = reproject(lambda x, y, z=None: TO_ALBERS.transform(x, y), state_polygon())
    minx, miny, maxx, maxy = polygon.bounds
    ix0, iy0 = int(np.floor(minx / size)), int(np.floor(miny / size))
    nx, ny = int(np.ceil(maxx / size)) - ix0, int(np.ceil(maxy / size)) - iy0
    ixs, iys = np.meshgrid(np.arange(nx), np.arange(ny), indexing="ij")
    cx = (ixs + ix0 + 0.5) * size
    cy = (iys + iy0 + 0.5) * size
    keep = shapely.contains_xy(polygon, cx, cy)
    lookup = np.full((nx, ny), -1)
    lookup[keep] = np.arange(keep.sum())
    lon, lat = TO_LONLAT.transform(cx[keep], cy[keep])
    cells = pd.DataFrame({
        "cell_idx": np.arange(keep.sum()),
        "cell_id": [f"wa10k_{i + ix0}_{j + iy0}" for i, j in zip(ixs[keep], iys[keep])],
        "ix": ixs[keep], "iy": iys[keep], "x": cx[keep], "y": cy[keep], "lon": lon, "lat": lat,
    })
    return Grid(cells=cells, size=size, ix0=ix0, iy0=iy0, nx=nx, ny=ny, lookup=lookup)
