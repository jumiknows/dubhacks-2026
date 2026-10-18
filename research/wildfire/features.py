"""Feature engineering with an explicit availability rule: a feature for target day D uses data dated D-1 or earlier.

The builder keeps compact running totals (cumulative sums over days) instead of a full
cell x day x feature cube, so any set of (day, cell) rows can be computed on demand.

Feature groups
- season: day-of-year cycle, weekend, Independence Day window (human ignitions peak around 4 July)
- terrain: SRTMGL3 mean elevation, relief and slope per cell (static)
- thermal: FIRMS VIIRS nominal/high-confidence vegetation-fire detections in the cell and its
  3x3 / 5x5 neighbourhoods over 1, 3, 7 and 30 days, fire radiative power, days since last detection
- weather: NASA POWER (MERRA-2 reanalysis) on D-1: heat, humidity, vapour-pressure deficit, wind,
  rain totals, dry-spell length, topsoil wetness
- history: the cell's own and neighbourhood discovery rate in training years (leave-one-year-out
  inside training, so a row never sees its own label)
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import RAW, experiment
from .days import EPOCH, day_date, day_index, n_days
from .grid import TO_LONLAT, Grid

GROUPS = {
    "season": ["doy_sin", "doy_cos", "weekend", "july4_window"],
    "terrain": ["elev_mean", "elev_relief", "slope_mean", "lat", "lon"],
    "thermal": [
        "det_1d", "det_3d", "det_7d", "det_30d", "det3x3_3d", "det3x3_7d", "det5x5_7d",
        "frp_7d", "days_since_det",
    ],
    "weather": [
        "tmax", "tmin", "rh", "vpd", "wind_max", "precip_1d", "precip_7d", "precip_30d",
        "dry_days", "soil_wet", "tmax_7d",
    ],
    "history": ["hist_rate", "hist_rate3x3"],
}
ALL_FEATURES = [name for names in GROUPS.values() for name in names]

AVAILABILITY = {
    "season": "Calendar only, known in advance.",
    "terrain": "Static SRTMGL3 (2000 acquisition), available before every target day.",
    "thermal": "FIRMS acquisitions converted to Pacific dates, summed through D-1. The yearly archive mixes near-real-time and later standard-processing rows, so values can differ slightly from what was visible at the time.",
    "weather": "NASA POWER daily values for D-1 from MERRA-2 reanalysis, typically published days later. Not available in real time: retrospective only.",
    "history": "FPA FOD discovery rates from training years only, leave-one-year-out within training.",
}


def _cumsum_days(daily: np.ndarray) -> np.ndarray:
    """cs[k] = sum of daily[0..k-1]; a window of w days ending D-1 is cs[D] - cs[D-w]."""
    out = np.zeros((daily.shape[0] + 1,) + daily.shape[1:], dtype=np.float64 if daily.dtype.kind == "f" else np.int32)
    np.cumsum(daily, axis=0, out=out[1:])
    return out


def _box_sum(raster: np.ndarray, radius: int) -> np.ndarray:
    """Sum over a (2r+1)^2 neighbourhood on the last two axes, zero outside the raster."""
    padded = np.pad(raster, [(0, 0), (radius, radius), (radius, radius)])
    out = np.zeros_like(raster)
    size = 2 * radius + 1
    for dx in range(size):
        for dy in range(size):
            out += padded[:, dx:dx + raster.shape[1], dy:dy + raster.shape[2]]
    return out


@dataclass
class FeatureBuilder:
    grid: Grid
    det_cs: np.ndarray = field(init=False)
    det3_cs: np.ndarray = field(init=False)
    det5_cs: np.ndarray = field(init=False)
    frp_cs: np.ndarray = field(init=False)
    last_det: np.ndarray = field(init=False)
    terrain: pd.DataFrame = field(init=False)
    weather: dict = field(init=False)
    cell_point: np.ndarray = field(init=False)
    firms_stats: dict = field(init=False)

    days: int = 0

    @classmethod
    def build(cls, grid: Grid, firms: pd.DataFrame | None = None, power: dict | None = None,
              terrain: pd.DataFrame | None = None, days: int | None = None):
        """days: length of the day axis (defaults to the study years; scoring later dates passes more)."""
        builder = cls(grid)
        builder.days = days or n_days()
        builder._thermal(load_firms(grid) if firms is None else firms)
        builder.terrain = load_terrain(grid) if terrain is None else terrain
        builder._weather(load_power() if power is None else power)
        return builder

    # --- thermal ------------------------------------------------------------------
    def _thermal(self, firms: pd.DataFrame) -> None:
        g, days = self.grid, self.days
        firms = firms[(firms["day"] >= 0) & (firms["day"] < days)]
        raster = np.zeros((days, g.nx, g.ny), dtype=np.int32)
        frp = np.zeros((days, len(g.cells)), dtype=np.float32)
        cells = g.cells
        day = firms["day"].to_numpy(dtype=np.int64)
        cell = firms["cell_idx"].to_numpy(dtype=np.int64)
        np.add.at(raster, (day, cells["ix"].to_numpy()[cell], cells["iy"].to_numpy()[cell]), 1)
        np.add.at(frp, (day, cell), firms["frp"].fillna(0).to_numpy(np.float32))
        ix, iy = cells["ix"].to_numpy(), cells["iy"].to_numpy()
        self.det_cs = _cumsum_days(raster[:, ix, iy])
        self.det3_cs = _cumsum_days(_box_sum(raster, 1)[:, ix, iy])
        self.det5_cs = _cumsum_days(_box_sum(raster, 2)[:, ix, iy])
        self.frp_cs = _cumsum_days(frp)
        # last_det[d] = most recent day < d with a detection in the cell (-1 if none)
        has = raster[:, ix, iy] > 0
        last = np.full(len(cells), -1, dtype=np.int32)
        self.last_det = np.empty((days, len(cells)), dtype=np.int32)
        for d in range(days):
            self.last_det[d] = last
            last = np.where(has[d], d, last)
        self.firms_stats = {"detections_in_grid": int(len(firms))}

    # --- weather ------------------------------------------------------------------
    def _weather(self, power: dict) -> None:
        points = power["points"]  # list of (lat, lon)
        lat = np.array([p[0] for p in points])
        lon = np.array([p[1] for p in points])
        cells = self.grid.cells
        distance = (cells["lat"].to_numpy()[:, None] - lat[None]) ** 2 + ((cells["lon"].to_numpy()[:, None] - lon[None]) * np.cos(np.radians(47))) ** 2
        self.cell_point = distance.argmin(axis=1)
        values = power["values"]  # name -> [n_days, n_points]
        precip = np.nan_to_num(values["PRECTOTCORR"], nan=0.0)
        dry = np.zeros_like(precip)
        run = np.zeros(precip.shape[1])
        for d in range(precip.shape[0]):
            run = np.where(precip[d] >= 1.0, 0, run + 1)
            dry[d] = np.minimum(run, 90)
        tmax, rh = values["T2M_MAX"], values["RH2M"]
        es = 0.6108 * np.exp(17.27 * tmax / (tmax + 237.3))
        self.weather = {
            "tmax": tmax, "tmin": values["T2M_MIN"], "rh": rh, "vpd": es * (1 - np.clip(rh, 0, 100) / 100),
            "wind_max": values["WS10M_MAX"], "precip": precip, "soil_wet": values["GWETTOP"], "dry_days": dry,
            "precip_cs": _cumsum_days(precip), "tmax_cs": _cumsum_days(np.nan_to_num(tmax)),
        }

    # --- assemble -----------------------------------------------------------------
    def frame(self, day: np.ndarray, cell: np.ndarray, history: np.ndarray | None = None) -> pd.DataFrame:
        """Feature rows for (day, cell) pairs. Every value uses data dated before `day`."""
        day = np.asarray(day, dtype=np.int64)
        cell = np.asarray(cell, dtype=np.int64)
        if day.min() < 31:
            raise ValueError("Target days need 30 days of history after the epoch")
        out: dict[str, np.ndarray] = {}

        dates = pd.to_datetime([day_date(d) for d in np.unique(day)])
        lookup = dict(zip(np.unique(day), range(len(dates))))
        position = np.array([lookup[d] for d in day])
        doy = dates.dayofyear.to_numpy()[position]
        out["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
        out["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
        out["weekend"] = (dates.dayofweek.to_numpy()[position] >= 5).astype(np.float32)
        month, dom = dates.month.to_numpy()[position], dates.day.to_numpy()[position]
        out["july4_window"] = ((month == 7) & (dom >= 1) & (dom <= 7)).astype(np.float32)

        terrain = self.terrain.to_numpy() if isinstance(self.terrain, pd.DataFrame) else self.terrain
        for i, name in enumerate(["elev_mean", "elev_relief", "slope_mean"]):
            out[name] = terrain[cell, i]
        out["lat"] = self.grid.cells["lat"].to_numpy()[cell]
        out["lon"] = self.grid.cells["lon"].to_numpy()[cell]

        def window(cs: np.ndarray, w: int) -> np.ndarray:
            return cs[day, cell] - cs[day - w, cell]

        out["det_1d"] = window(self.det_cs, 1)
        out["det_3d"] = window(self.det_cs, 3)
        out["det_7d"] = window(self.det_cs, 7)
        out["det_30d"] = window(self.det_cs, 30)
        out["det3x3_3d"] = window(self.det3_cs, 3)
        out["det3x3_7d"] = window(self.det3_cs, 7)
        out["det5x5_7d"] = window(self.det5_cs, 7)
        out["frp_7d"] = window(self.frp_cs, 7)
        last = self.last_det[day, cell]
        out["days_since_det"] = np.where(last < 0, 400, np.minimum(day - last, 400))

        point = self.cell_point[cell]
        prior = day - 1
        w = self.weather
        for name in ["tmax", "tmin", "rh", "vpd", "wind_max", "soil_wet", "dry_days"]:
            out[name] = w[name][prior, point]
        out["precip_1d"] = w["precip"][prior, point]
        out["precip_7d"] = w["precip_cs"][day, point] - w["precip_cs"][day - 7, point]
        out["precip_30d"] = w["precip_cs"][day, point] - w["precip_cs"][day - 30, point]
        out["tmax_7d"] = (w["tmax_cs"][day, point] - w["tmax_cs"][day - 7, point]) / 7

        if history is not None:
            out["hist_rate"] = history[0]
            out["hist_rate3x3"] = history[1]
        frame = pd.DataFrame({k: np.asarray(v, dtype=np.float32) for k, v in out.items()})
        return frame


def history_rates(grid: Grid, positive: np.ndarray, train_years: list[int], day: np.ndarray, cell: np.ndarray, year_of_row: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Discovery rate per cell-day in training years. Training rows use the other training years only."""
    from .days import year_days

    per_year = {}
    for year in train_years:
        idx = year_days([year])
        per_year[year] = (positive[idx].sum(axis=0), len(idx))
    total = sum(v[0] for v in per_year.values())
    total_days = sum(v[1] for v in per_year.values())

    ix, iy = grid.cells["ix"].to_numpy(), grid.cells["iy"].to_numpy()

    def smooth(counts: np.ndarray) -> np.ndarray:
        raster = np.zeros((1, grid.nx, grid.ny))
        raster[0, ix, iy] = counts
        return _box_sum(raster, 1)[0, ix, iy]

    rate = np.empty(len(day))
    rate3 = np.empty(len(day))
    years = np.unique(year_of_row)
    for year in years:
        rows = year_of_row == year
        if year in per_year:
            counts = total - per_year[year][0]
            days = total_days - per_year[year][1]
        else:
            counts, days = total, total_days
        rate[rows] = counts[cell[rows]] / days * 1000
        rate3[rows] = smooth(counts)[cell[rows]] / days * 1000
    return rate, rate3


# --- loaders -----------------------------------------------------------------------

def load_firms(grid: Grid, paths=None, days: int | None = None) -> pd.DataFrame:
    """Vegetation-fire detections (type 0, nominal/high confidence) mapped to cells and Pacific dates."""
    frames = []
    west, south, east, north = experiment()["geography"]["bbox"]
    for path in paths if paths is not None else sorted((RAW / "firms").glob("viirs-snpp_*_United_States.csv")):
        frame = pd.read_csv(path, usecols=lambda c: c in {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp", "type"})
        frame = frame[frame["longitude"].between(west, east) & frame["latitude"].between(south, north)]
        frames.append(frame)
    if not frames:
        return pd.DataFrame({"day": pd.Series(dtype=int), "cell_idx": pd.Series(dtype=int), "frp": pd.Series(dtype=float)})
    firms = pd.concat(frames, ignore_index=True)
    if "type" in firms:
        firms = firms[firms["type"] == 0]
    firms = firms[firms["confidence"].astype(str).str.lower().isin(["n", "h", "nominal", "high"])]
    stamp = pd.to_datetime(firms["acq_date"] + " " + firms["acq_time"].astype(str).str.zfill(4), format="%Y-%m-%d %H%M", utc=True)
    local = stamp.dt.tz_convert("America/Los_Angeles").dt.date
    firms = firms.assign(day=[day_index(d) for d in local])
    firms["cell_idx"] = grid.locate(firms["longitude"].to_numpy(), firms["latitude"].to_numpy())
    firms = firms[(firms["cell_idx"] >= 0) & (firms["day"] >= 0) & (firms["day"] < (days or n_days()))]
    return firms.reset_index(drop=True)


def load_power(folder=None, days: int | None = None) -> dict:
    """NASA POWER point files → {points, values[name] = [n_days, n_points]} aligned to the day axis.
    Days the source has not published yet stay NaN until a later day fills them."""
    days = days or n_days()
    files = sorted((folder or RAW / "power").glob("*.csv"))
    points, columns = [], {}
    for index, path in enumerate(files):
        lat, lon = (float(v) for v in path.stem.split("_")[:2])
        points.append((lat, lon))
        frame = pd.read_csv(path)
        frame = frame.replace(-999.0, np.nan)
        dates = pd.to_datetime(frame["YEAR"].astype(str) + frame["DOY"].astype(str).str.zfill(3), format="%Y%j")
        rows = np.array([(d.date() - EPOCH).days for d in dates])
        keep = (rows >= 0) & (rows < days)
        for name in [c for c in frame.columns if c not in {"YEAR", "DOY", "LAT", "LON"}]:
            columns.setdefault(name, np.full((days, len(files)), np.nan, dtype=np.float32))
            columns[name][rows[keep], index] = frame[name].to_numpy()[keep]
    for name, values in columns.items():
        # Fill rare interior gaps from the previous day (never from a later one). Days after the
        # last published value stay NaN, so scoring can tell that weather is not available yet.
        frame = pd.DataFrame(values).ffill(limit_area="inside")
        columns[name] = frame.to_numpy(np.float32)
    return {"points": points, "values": columns}


def load_terrain(grid: Grid) -> pd.DataFrame:
    """Mean elevation (m), relief (std, m) and mean slope (degrees) per cell from SRTMGL3 tiles."""
    tiles = {}
    for path in (RAW / "srtm").glob("*.hgt.zip"):
        with zipfile.ZipFile(path) as archive:
            name = next(n for n in archive.namelist() if n.endswith(".hgt"))
            data = np.frombuffer(archive.read(name), dtype=">i2").reshape(1201, 1201).astype(np.float32)
        data[data == -32768] = np.nan
        lat0, lon0 = int(path.name[1:3]), -int(path.name[4:7])
        tiles[(lat0, lon0)] = data

    # Sample an 8 x 8 lattice inside each cell.
    offsets = (np.arange(8) + 0.5) / 8 - 0.5
    ox, oy = np.meshgrid(offsets, offsets)
    cells = grid.cells
    xs = cells["x"].to_numpy()[:, None] + ox.ravel()[None] * grid.size
    ys = cells["y"].to_numpy()[:, None] + oy.ravel()[None] * grid.size
    lon, lat = TO_LONLAT.transform(xs, ys)
    elev = np.full(lon.shape, np.nan, dtype=np.float32)
    slope = np.full(lon.shape, np.nan, dtype=np.float32)
    for (lat0, lon0), data in tiles.items():
        inside = (lat >= lat0) & (lat < lat0 + 1) & (lon >= lon0) & (lon < lon0 + 1)
        if not inside.any():
            continue
        row = np.clip(((lat0 + 1 - lat[inside]) * 1200).round().astype(int), 1, 1199)
        col = np.clip(((lon[inside] - lon0) * 1200).round().astype(int), 1, 1199)
        elev[inside] = data[row, col]
        dy = 92.6
        dx = 92.6 * np.cos(np.radians(lat[inside]))
        gz_y = (data[row - 1, col] - data[row + 1, col]) / (2 * dy)
        gz_x = (data[row, col + 1] - data[row, col - 1]) / (2 * dx)
        slope[inside] = np.degrees(np.arctan(np.hypot(gz_x, gz_y)))
    with np.errstate(all="ignore"):
        frame = pd.DataFrame({
            "elev_mean": np.nanmean(elev, axis=1),
            "elev_relief": np.nanstd(elev, axis=1),
            "slope_mean": np.nanmean(slope, axis=1),
        })
    return frame.fillna(frame.median())
