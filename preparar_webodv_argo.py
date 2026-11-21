#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PREPARADOR WEBODV / ARGO ATLÁNTICO

Convierte un NetCDF de webODV de perfiles Argo en datos ligeros para
Atlantic Ocean Data Explorer.

Características:
- Lee el NetCDF por bloques de perfiles: nunca carga los 6+ GB completos.
- Procesa año a año para limitar la RAM.
- Usa Temperature_adjusted_, Practical_Salinity_adjusted_ y Pressure_adjusted_.
- Agrupa en 5° x 5° y en 5 intervalos de profundidad.
- Genera archivos JSON por región y por celda para carga progresiva.
- Calcula promedio, mediana, desviación estándar, N de observaciones y perfiles.
- La mediana es una mediana ponderada de estadísticas de perfil; es una
  aproximación robusta y evita guardar miles de millones de observaciones.
- La profundidad se clasifica por presión (dbar), aproximación habitual
  para estos intervalos amplios. No se convierte cada muestra con GSW,
  lo que reduce muchísimo el tiempo y la RAM.
"""

from __future__ import annotations
import argparse, json, math, os, sys, time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from netCDF4 import Dataset, num2date
except ImportError:
    print("\nERROR: falta netCDF4.")
    print("Instala las dependencias con:")
    print("    python -m pip install numpy pandas netCDF4")
    sys.exit(1)


DEPTHS = [
    (0, 200, "0–200 m"),
    (200, 500, "200–500 m"),
    (500, 1000, "500–1000 m"),
    (1000, 1500, "1000–1500 m"),
    (1500, 2000, "1500–2000 m"),
]

TEMPERATURE_LIMITS = (-3.0, 40.0)
SALINITY_LIMITS = (0.0, 45.0)

REGIONS = {
    "all": None,
    "polar-n": (60, 70),
    "subpolar-n": (45, 60),
    "subtropical-n": (30, 45),
    "tropical": (-10, 30),
    "subtropical-s": (-30, -10),
    "subpolar-s": (-45, -30),
    "polar-s": (-60, -45),
}


def as_float_array(values):
    # Preserve missing-data masks before converting to ordinary floats.
    return np.ma.asarray(values, dtype=np.float64).filled(np.nan)


def within_limits(values, limits):
    values = as_float_array(values)
    valid = np.isfinite(values) & (values >= limits[0]) & (values <= limits[1])
    return np.where(valid, values, np.nan)


def safe_json(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_json(v) for v in obj]
    return obj


def weighted_median(values, weights):
    v = np.asarray(values, dtype=float)
    w = np.asarray(weights, dtype=float)
    ok = np.isfinite(v) & np.isfinite(w) & (w > 0)
    if not np.any(ok):
        return np.nan
    v, w = v[ok], w[ok]
    order = np.argsort(v)
    v, w = v[order], w[order]
    return float(v[np.searchsorted(np.cumsum(w), w.sum() / 2.0, side="left")])


def profile_stats(values, mask):
    """Estadísticos por perfil para una franja de profundidad."""
    a = np.ma.array(values, mask=~mask)
    n = np.ma.count(a, axis=1).astype(np.int32)
    mean = np.ma.mean(a, axis=1).filled(np.nan)
    median = np.ma.median(a, axis=1).filled(np.nan)
    std = np.ma.std(a, axis=1, ddof=1).filled(np.nan)
    std = np.where(n < 2, np.nan, std)
    return n, mean, median, std


def aggregate_profiles(df, group_cols):
    """Combina estadísticas de perfiles sin expandir todas las muestras."""
    if df.empty:
        return df

    g = df.groupby(group_cols, sort=False, observed=True)

    base = g.agg(
        n_observations=("n_observations", "sum"),
        n_profiles=("n_profiles", "sum"),
        temp_sum=("temp_sum", "sum"),
        temp_sum2=("temp_sum2", "sum"),
        sal_sum=("sal_sum", "sum"),
        sal_sum2=("sal_sum2", "sum"),
    ).reset_index()

    temp_med = (
        g.apply(
            lambda x: weighted_median(x["temperature_median"], x["n_observations"]),
            include_groups=False,
        )
        .rename("temperature_median")
        .reset_index()
    )
    sal_med = (
        g.apply(
            lambda x: weighted_median(x["salinity_median"], x["n_observations"]),
            include_groups=False,
        )
        .rename("salinity_median")
        .reset_index()
    )

    out = base.merge(temp_med, on=group_cols, how="left")
    out = out.merge(sal_med, on=group_cols, how="left")

    n = out["n_observations"].to_numpy(dtype=float)
    tm = np.divide(out["temp_sum"], n, out=np.full_like(n, np.nan), where=n > 0)
    sm = np.divide(out["sal_sum"], n, out=np.full_like(n, np.nan), where=n > 0)

    tv = np.divide(out["temp_sum2"], n, out=np.full_like(n, np.nan), where=n > 0) - tm**2
    sv = np.divide(out["sal_sum2"], n, out=np.full_like(n, np.nan), where=n > 0) - sm**2

    out["temperature_mean"] = tm
    out["salinity_mean"] = sm
    out["temperature_std"] = np.sqrt(np.maximum(tv, 0))
    out["salinity_std"] = np.sqrt(np.maximum(sv, 0))
    out["temperature_q25"] = np.nan
    out["temperature_q75"] = np.nan
    out["salinity_q25"] = np.nan
    out["salinity_q75"] = np.nan

    out = out.rename(columns={"date": "date"})
    if "lat_center" not in out.columns:
        out["lat_center"] = 0.0
    if "lon_center" not in out.columns:
        out["lon_center"] = 0.0
    keep = [
        "date", "year", "month", "day",
        "lat_center", "lon_center", "depth_range",
        "temperature_mean", "temperature_median", "temperature_std",
        "temperature_q25", "temperature_q75",
        "salinity_mean", "salinity_median", "salinity_std",
        "salinity_q25", "salinity_q75",
        "n_observations", "n_profiles",
    ]
    return out[keep]


def make_profile_rows(temp, sal, pres, dates, lat, lon):
    """Genera hasta 5 filas por perfil, una por intervalo de profundidad."""
    rows = []
    n_profiles = len(dates)

    pres = as_float_array(pres)
    temp = within_limits(temp, TEMPERATURE_LIMITS)
    sal = within_limits(sal, SALINITY_LIMITS)
    lat = as_float_array(lat)
    lon = as_float_array(lon)
    valid_geo = (
        np.isfinite(lat) & (lat >= -90) & (lat <= 90) &
        np.isfinite(lon) & (lon >= -180) & (lon <= 180)
    )

    for pmin, pmax, label in DEPTHS:
        pmask = np.isfinite(pres) & (pres >= pmin) & (pres < pmax)
        common = pmask & np.isfinite(temp) & np.isfinite(sal) & valid_geo[:, None]

        nt, tm, tmed, tsd = profile_stats(temp, common)
        ns, sm, smed, ssd = profile_stats(sal, common)

        n = np.minimum(nt, ns)
        valid = n > 0
        if not np.any(valid):
            continue

        latc = (np.floor((lat + 90) / 5) * 5 - 90 + 2.5)
        lonc = (np.floor((lon + 180) / 5) * 5 - 180 + 2.5)

        dd = np.asarray([d.strftime("%Y-%m-%d") for d in dates])
        yy = np.asarray([d.year for d in dates], dtype=np.int16)
        mm = np.asarray([d.month for d in dates], dtype=np.int8)
        day = np.asarray([d.day for d in dates], dtype=np.int8)

        idx = np.where(valid)[0]
        df = pd.DataFrame({
            "date": dd[idx],
            "year": yy[idx],
            "month": mm[idx],
            "day": day[idx],
            "lat_center": latc[idx],
            "lon_center": lonc[idx],
            "depth_range": label,
            "n_observations": n[idx].astype(np.int32),
            "n_profiles": np.ones(len(idx), dtype=np.int32),
            "temperature_median": tmed[idx],
            "salinity_median": smed[idx],
            "temp_sum": tm[idx] * n[idx],
            "temp_sum2": n[idx] * (np.where(np.isfinite(tsd[idx]), tsd[idx] ** 2, 0) + tm[idx] ** 2),
            "sal_sum": sm[idx] * n[idx],
            "sal_sum2": n[idx] * (np.where(np.isfinite(ssd[idx]), ssd[idx] ** 2, 0) + sm[idx] ** 2),
        })
        rows.append(df)

    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True)


def region_mask(df, region):
    if region == "all":
        return np.ones(len(df), dtype=bool)
    lo, hi = REGIONS[region]
    lat = df["lat_center"].to_numpy()
    return (lat >= lo) & (lat < hi)


def write_json(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(safe_json(records), f, ensure_ascii=False, separators=(",", ":"),
                  allow_nan=False)


def main():
    ap = argparse.ArgumentParser(description="Prepara un NetCDF webODV Argo para Atlantic Ocean Data Explorer.")
    ap.add_argument("nc_file")
    ap.add_argument("--out", default=None, help="Carpeta de salida.")
    ap.add_argument("--chunk-stations", type=int, default=256,
                    help="Perfiles por bloque. 128 = muy conservador; 256 = recomendado.")
    args = ap.parse_args()

    nc_path = Path(args.nc_file)
    if not nc_path.exists():
        raise SystemExit(f"No existe el archivo: {nc_path}")

    out = Path(args.out) if args.out else nc_path.with_name(nc_path.stem + "_APP_DATA")
    out.mkdir(parents=True, exist_ok=True)
    (out / "regions").mkdir(exist_ok=True)
    (out / "cells").mkdir(exist_ok=True)

    t0 = time.time()
    print("=" * 72)
    print("PREPARADOR WEBODV → ATLANTIC OCEAN DATA EXPLORER")
    print("=" * 72)
    print(f"Archivo : {nc_path}")
    print(f"Salida  : {out}")
    print(f"Bloque : {args.chunk_stations} perfiles")
    print("RAM    : lectura por bloques; no se carga el NetCDF completo.")
    print()

    with Dataset(nc_path, "r") as ds:
        names = set(ds.variables)
        required = ["latitude", "longitude", "date_time",
                    "Pressure_adjusted_", "Temperature_adjusted_",
                    "Practical_Salinity_adjusted_"]
        missing = [x for x in required if x not in names]
        if missing:
            raise SystemExit("Faltan variables necesarias: " + ", ".join(missing))

        nstations = len(ds.dimensions["N_STATIONS"])
        date_var = ds.variables["date_time"]

        print("Leyendo calendario de perfiles...")
        date_num = np.asarray(date_var[:])
        dates_all = np.asarray(
            num2date(
                date_num,
                units=date_var.units,
                calendar=getattr(date_var, "calendar", "standard"),
                only_use_cftime_datetimes=False,
                only_use_python_datetimes=True,
            ),
            dtype=object,
        )
        years_all = np.asarray([d.year for d in dates_all], dtype=np.int16)
        years = sorted(np.unique(years_all).tolist())

        print(f"Perfiles : {nstations:,}")
        print(f"Años     : {years[0]}–{years[-1]}")
        print()

        temp_var = ds.variables["Temperature_adjusted_"]
        sal_var = ds.variables["Practical_Salinity_adjusted_"]
        pres_var = ds.variables["Pressure_adjusted_"]
        lat_var = ds.variables["latitude"]
        lon_var = ds.variables["longitude"]
        all_lat = as_float_array(lat_var[:])
        all_lon = as_float_array(lon_var[:])
        valid_geo = (
            np.isfinite(all_lat) & (all_lat >= -90) & (all_lat <= 90) &
            np.isfinite(all_lon) & (all_lon >= -180) & (all_lon <= 180)
        )
        if not np.any(valid_geo):
            raise SystemExit("No hay coordenadas geográficas válidas en el archivo.")
        valid_lat = all_lat[valid_geo]
        valid_lon = all_lon[valid_geo]

        global_tmin, global_tmax = np.inf, -np.inf
        global_smin, global_smax = np.inf, -np.inf
        map_counts = defaultdict(int)

        region_year_rows = defaultdict(list)
        cell_year_rows = defaultdict(list)

        for yi, year in enumerate(years, 1):
            idx_year = np.where(years_all == year)[0]
            print(f"\n[{yi}/{len(years)}] AÑO {year} · {len(idx_year):,} perfiles")

            year_parts = []
            nblocks = math.ceil(len(idx_year) / args.chunk_stations)
            year_start = time.time()

            for bi, start in enumerate(range(0, len(idx_year), args.chunk_stations), 1):
                ids = idx_year[start:start + args.chunk_stations]

                # La mayoría de colecciones ODV están ordenadas temporalmente.
                # Si no lo están, netCDF4 admite indexado 1D igualmente.
                lat = as_float_array(lat_var[ids])
                lon = as_float_array(lon_var[ids])
                pres = as_float_array(pres_var[ids])
                temp = within_limits(temp_var[ids], TEMPERATURE_LIMITS)
                sal = within_limits(sal_var[ids], SALINITY_LIMITS)
                dates = dates_all[ids]

                valid_t = temp[np.isfinite(temp)]
                valid_s = sal[np.isfinite(sal)]
                if valid_t.size:
                    global_tmin = min(global_tmin, float(valid_t.min()))
                    global_tmax = max(global_tmax, float(valid_t.max()))
                if valid_s.size:
                    global_smin = min(global_smin, float(valid_s.min()))
                    global_smax = max(global_smax, float(valid_s.max()))

                prof = make_profile_rows(temp, sal, pres, dates, lat, lon)
                del pres, temp, sal, lat, lon

                if not prof.empty:
                    grouped = aggregate_profiles(
                        prof,
                        ["date", "year", "month", "day",
                         "lat_center", "lon_center", "depth_range"],
                    )
                    year_parts.append(grouped)

                    for (la, lo), gg in grouped.groupby(["lat_center", "lon_center"], observed=True):
                        map_counts[f"{la:g}|{lo:g}"] += int(gg["n_profiles"].sum())

                elapsed = time.time() - year_start
                rate = elapsed / bi
                eta = max(0, (nblocks - bi) * rate)
                pct = 100 * bi / nblocks
                print(
                    f"\r    bloque {bi:>4}/{nblocks} · {pct:5.1f}% · "
                    f"ETA año: {eta/60:5.1f} min",
                    end="", flush=True
                )

            print()

            if not year_parts:
                continue

            year_df = pd.concat(year_parts, ignore_index=True)
            # Reagregamos porque un mismo día/celda/profundidad puede aparecer
            # en varios bloques de lectura.
            year_df = aggregate_profiles(
                year_df.assign(
                    temp_sum=year_df.temperature_mean * year_df.n_observations,
                    temp_sum2=year_df.n_observations * (
                        year_df.temperature_std.fillna(0) ** 2 +
                        year_df.temperature_mean ** 2
                    ),
                    sal_sum=year_df.salinity_mean * year_df.n_observations,
                    sal_sum2=year_df.n_observations * (
                        year_df.salinity_std.fillna(0) ** 2 +
                        year_df.salinity_mean ** 2
                    ),
                ),
                ["date", "year", "month", "day",
                 "lat_center", "lon_center", "depth_range"],
            )

            # Guardar por año y por celda: la aplicación sólo cargará lo necesario.
            for (la, lo), cell_df in year_df.groupby(["lat_center", "lon_center"], observed=True):
                safe = f"{float(la):g}_{float(lo):g}".replace("-", "m").replace(".", "p")
                cell_year_rows[(safe, year)] = cell_df.to_dict("records")

            for region in REGIONS:
                rmask = region_mask(year_df, region)
                rdf = year_df.loc[rmask].copy()
                if rdf.empty:
                    region_year_rows[(region, year)] = []
                    continue

                rdf = aggregate_profiles(
                    rdf.assign(
                        temp_sum=rdf.temperature_mean * rdf.n_observations,
                        temp_sum2=rdf.n_observations * (
                            rdf.temperature_std.fillna(0) ** 2 +
                            rdf.temperature_mean ** 2
                        ),
                        sal_sum=rdf.salinity_mean * rdf.n_observations,
                        sal_sum2=rdf.n_observations * (
                            rdf.salinity_std.fillna(0) ** 2 +
                            rdf.salinity_mean ** 2
                        ),
                    ),
                    ["date", "year", "month", "day", "depth_range"],
                )
                # Una región no necesita coordenadas para la matriz.
                rdf["lat_center"] = 0
                rdf["lon_center"] = 0
                region_year_rows[(region, year)] = rdf.to_dict("records")

            del year_parts, year_df

    print("\nEscribiendo archivos JSON...")
    regions_manifest = {}
    for region in REGIONS:
        files = []
        for year in years:
            rows = region_year_rows.get((region, year), [])
            if not rows:
                continue
            path = out / "regions" / region / f"{year}.json"
            write_json(path, rows)
            files.append(str(path.relative_to(out)).replace(os.sep, "/"))
        regions_manifest[region] = files

    cells_manifest = {}
    for (safe, year), rows in cell_year_rows.items():
        path = out / "cells" / safe / f"{year}.json"
        write_json(path, rows)
        # Recover the public key from first row.
        if rows:
            r = rows[0]
            public_key = f"{float(r['lat_center']):g}|{float(r['lon_center']):g}"
            cells_manifest.setdefault(public_key, []).append(
                str(path.relative_to(out)).replace(os.sep, "/")
            )

    manifest = {
        "version": 2,
        "source_label": "webODV · Argo Atlantic Profiles",
        "source_software": "Web Ocean Data View 5.8.6.4",
        "feature_type": "profile",
        "years": years,
        "bounds": {
            "lat_min": float(np.min(valid_lat)),
            "lat_max": float(np.max(valid_lat)),
            "lon_min": float(np.min(valid_lon)),
            "lon_max": float(np.max(valid_lon)),
        },
        "depth_ranges": [
            {"min": a, "max": b, "label": label} for a, b, label in DEPTHS
        ],
        "temperature": {
            "min": float(global_tmin),
            "max": float(global_tmax),
        },
        "salinity": {
            "min": float(global_smin),
            "max": float(global_smax),
        },
        "regions": regions_manifest,
        "cells": cells_manifest,
        "map_counts": dict(map_counts),
        "notes": {
            "depth_method": "Pressure in dbar classified into depth ranges; no per-sample GSW conversion.",
            "median_method": "Weighted median of profile-level medians; designed to keep RAM bounded.",
        },
    }
    write_json(out / "manifest.json", manifest)

    elapsed = time.time() - t0
    print("\n" + "=" * 72)
    print("PROCESO TERMINADO")
    print("=" * 72)
    print(f"Tiempo total : {elapsed/3600:.2f} h")
    print(f"Años         : {years[0]}–{years[-1]}")
    print(f"Salida       : {out}")
    print("\nCopia el contenido de esta carpeta dentro de data/ de la aplicación.")
    print("No copies el NetCDF a GitHub Pages.")
    print()


if __name__ == "__main__":
    main()
