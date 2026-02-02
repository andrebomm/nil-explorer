import json
import csv
import glob
import os

DATA_DIR = "data"
TABLE_CSV = os.path.join(DATA_DIR, "table.csv")
OUT_GEOJSON = os.path.join(DATA_DIR, "nil.geojson")

# 1) leggi tabella -> mapping id_nil -> info
table = {}
with open(TABLE_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        k = int(row["id_nil"])
        table[k] = {
            "nil_id": k,
            "nil_name": row.get("nil_name", "").strip(),
            "lisa_class": row.get("lisa_state_f", "").strip(),
            "hmm_state": row.get("hmm_state", "").strip(),
        }

# 2) unisci tutti i geojson
features = []
crs = None

for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.geojson"))):
    # evita di reincludere il file di output se esiste
    if os.path.basename(path) == os.path.basename(OUT_GEOJSON):
        continue

    with open(path, "r", encoding="utf-8") as f:
        gj = json.load(f)

    if crs is None and "crs" in gj:
        crs = gj["crs"]

    if gj.get("type") != "FeatureCollection" or not gj.get("features"):
        continue

    # nel tuo caso è 1 feature per file
    feat = gj["features"][0]
    props = feat.get("properties") or {}

    # prende ID e Nome dal geojson (come AFFORI.geojson)
    id_nil = props.get("ID_NIL", None)
    nil_from_shape = props.get("NIL", "")

    # join tabella su ID_NIL
    if isinstance(id_nil, (int, float)):
        id_nil_int = int(id_nil)
    else:
        id_nil_int = None

    info = table.get(id_nil_int)

    # scrivi proprietà standard per la webapp
    props["nil_id"] = id_nil_int if id_nil_int is not None else ""
    props["nil_name"] = (info["nil_name"] if info else nil_from_shape) or nil_from_shape
    props["lisa_class"] = info["lisa_class"] if info else ""
    props["hmm_state"] = info["hmm_state"] if info else ""

    feat["properties"] = props
    features.append(feat)

out = {
    "type": "FeatureCollection",
    "features": features
}
if crs is not None:
    out["crs"] = crs

with open(OUT_GEOJSON, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

print(f"OK: creato {OUT_GEOJSON} con {len(features)} NIL")