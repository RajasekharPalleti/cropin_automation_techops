# Author: Rajasekhar Palleti
# Purpose: Update Area Audit for Croppable Areas
# Supports geoInfo in BOTH formats:

"""
Audits area data and updates Croppable Areas (CA).

Inputs:
Excel file with CA_id, CA_Name, area_Audit_DTO, Latitude, Longitude, and audited_count.
Supports geoInfo in BOTH formats:
1) Full GeoJSON FeatureCollection as type = featureCollection
2) Raw coordinates list [[lng, lat], ...]
3) Default cropAudited = true
4) Pass Area Unit in UI as company preffered unit.
"""

import json
import requests
import pandas as pd
import time
import re
import math

# ============================================================
# GEOINFO NORMALIZATION
# ============================================================
def _normalize_coords(data):
    """
    Recursively normalizes coordinates in a GeoJSON-like list structure.
    Converts strings to floats and strips whitespace.
    """
    if isinstance(data, list):
        # Check if it's a coordinate pair [lng, lat]
        if len(data) == 2 and not isinstance(data[0], (list, dict)):
            try:
                # Strip spaces and convert to float
                return [float(str(data[0]).strip()), float(str(data[1]).strip())]
            except (ValueError, TypeError):
                return data
        # Otherwise recurse
        return [_normalize_coords(item) for item in data]
    return data

def normalize_geo_info(area_Audit_DTO):
    """
    Accepts either:
    1) Full GeoJSON FeatureCollection
    2) Raw coordinates list [[lng, lat], ...]
    3) Stringified lists with regex fallback

    Returns:
        Valid GeoJSON FeatureCollection with MultiPolygon
    """
    if pd.isna(area_Audit_DTO) or area_Audit_DTO == "":
        raise ValueError("Empty GeoInfo")
        
    area_Audit_DTO = str(area_Audit_DTO).strip()

    try:
        geo = json.loads(area_Audit_DTO.replace("'", '"'))
    except json.JSONDecodeError:
        # Fallback for weird strings: extract pairs of numbers
        numbers = re.findall(r'-?\d+\.\d+|-?\d+', area_Audit_DTO)
        if len(numbers) >= 6 and len(numbers) % 2 == 0:
            coords = []
            for i in range(0, len(numbers), 2):
                coords.append([float(numbers[i]), float(numbers[i+1])])
            geo = coords
        else:
            raise ValueError("Invalid JSON and could not parse raw coordinates")

    # Case 1: Already valid FeatureCollection
    if isinstance(geo, dict) and geo.get("type") == "FeatureCollection":
        if "features" in geo:
            for feature in geo.get("features", []):
                geom = feature.get("geometry")
                if geom and "coordinates" in geom:
                    geom["coordinates"] = _normalize_coords(geom["coordinates"])
        return geo

    # Case 2: Raw coordinates list (e.g. [[77.5, 12.9], ...])
    if isinstance(geo, list):
        normalized_geo = _normalize_coords(geo)
        
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [[normalized_geo]]
                    }
                }
            ]
        }

    raise ValueError("Unsupported geoInfo format use [[long, lat], [...]])")


def extract_polygons(coords):
    """
    Returns a list of polygons, where each polygon is a list of [lon, lat] points.
    """
    if not isinstance(coords, list) or not coords:
        return []
    
    if len(coords) == 2 and not isinstance(coords[0], (list, dict)):
        return [coords]
        
    if isinstance(coords[0], list) and len(coords[0]) == 2 and not isinstance(coords[0][0], (list, dict)):
        return [coords]
        
    polygons = []
    for item in coords:
        polygons.extend(extract_polygons(item))
    return polygons

def _spherical_polygon_area_sqm(poly):
    """
    Calculates polygon area using the same spherical excess formula as
    Google Maps (google.maps.geometry.spherical.computeArea).
    Uses Earth radius = 6378137 m (WGS84 equatorial radius).
    coords: list of [lon, lat] in degrees.
    """
    EARTH_RADIUS = 6378137.0  # metres — same constant Google Maps uses
    n = len(poly)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        lon1 = math.radians(poly[i][0])
        lat1 = math.radians(poly[i][1])
        lon2 = math.radians(poly[j][0])
        lat2 = math.radians(poly[j][1])
        area += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(area) * EARTH_RADIUS * EARTH_RADIUS / 2.0

def calculate_area_and_center_multi(coords_list):
    """
    Calculates area (sqm, acres, hectares) and centroid using the same
    spherical formula as Google Maps — results will match Google Maps values.
    Supports arbitrarily nested coordinate lists (Polygon / MultiPolygon).
    """
    polygons = extract_polygons(coords_list)
    total_area_sqm = 0.0
    all_points = []

    for poly in polygons:
        if len(poly) < 3:
            continue
        all_points.extend(poly)
        total_area_sqm += _spherical_polygon_area_sqm(poly)

    if not all_points:
        return 0, 0, 0, 0, 0

    center_lon = sum(c[0] for c in all_points) / len(all_points)
    center_lat = sum(c[1] for c in all_points) / len(all_points)

    area_hectares = total_area_sqm / 10000.0
    area_acres    = total_area_sqm / 4046.8564224

    return total_area_sqm, area_acres, area_hectares, center_lat, center_lon


# ============================================================
# MAIN RUN FUNCTION
# ============================================================
def run(input_excel_file, output_excel_file, config, log_callback=None):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    # ---------------- CONFIGURATION ----------------
    token = config.get("token")
    if not token:
        log("❌ Token missing. Exiting.")
        return

    # Use configured URL or default
    api_url = config.get("base_api_url")
    if not api_url:
        api_url = "https://cloud.cropin.in/services/farm/api/croppable-areas"
        log(f"Using default API URL: {api_url}")
    else:
        log(f"Using configured API URL: {api_url}")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "channel": "mobile"
    }

    delay_time = float(config.get("delay_time", 0.5))  # seconds, configurable via UI

    # --- Area Unit Resolution ---
    # Default to UI manual unit
    final_unit_val = config.get("unit", "Hectare")
    fetch_unit_from_script = config.get("fetch_unit_from_script", "yes")

    if fetch_unit_from_script == "yes":
        company_id = str(config.get("fetch_company_id", "")).strip()
        if not company_id:
            company_id = "1251"  # Fallback as per user request
            
        try:
            from urllib.parse import urlparse
            parsed = urlparse(api_url)
            host = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else "https://cloud.cropin.in"
            company_url = f"{host}/services/farm/api/companies/{company_id}"
            
            log(f"🔍 Fetching company preferred unit from: {company_url}")
            resp = requests.get(company_url, headers=headers, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                company_unit = data.get("data", {}).get("preferences", {}).get("areaUnits", "")
                if company_unit:
                    unit_map = {'ACRE': 'Acre', 'HECTARE': 'Hectare', 'SQUARE_METER': 'sqm', 'SQUARE METER': 'sqm'}
                    final_unit_val = unit_map.get(company_unit.upper(), company_unit)
                    log(f"✅ Successfully fetched company unit: {final_unit_val}")
                else:
                    log("⚠️ No 'areaUnits' found in company preferences. Falling back to manual Area Unit.")
            else:
                log(f"⚠️ Failed to fetch company details (Status {resp.status_code}). Falling back to manual Area Unit.")
        except Exception as e:
            log(f"⚠️ Error fetching company unit: {e}. Falling back to manual Area Unit.")
    else:
        log(f"ℹ️ Using manual Area Unit: {final_unit_val}")

    # Make it available in config so process_chunk can read it
    config["resolved_unit_val"] = final_unit_val

    log(f"⏳ Waiting for 10 seconds before starting processing with unit: {final_unit_val}...")
    import time
    time.sleep(10)

    log(f"📘 Loading Excel file: {input_excel_file}")
    try:
        df = pd.read_excel(input_excel_file)
    except Exception as e:
        log(f"❌ Error reading Excel file: {e}")
        return

    # Ensure output columns exist with correct dtypes
    for col in ["Status", "CA_Response"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str)

    for col in ["Latitude", "Longitude", "audited_count", "area in square meters", "area in acres", "area in hectares"]:
        if col not in df.columns:
            df[col] = None  # object dtype — accepts both float and empty

    # Replace NaNs with empty string for safety in text fields, but be careful with numbers
    # df = df.fillna("") # Optional, may mess up numeric checks if not careful, sticking to per-row checks

    total_rows = len(df)
    processed_count = 0
    import threading
    from concurrent.futures import ThreadPoolExecutor
    processed_lock = threading.Lock()
    
    MAX_WORKERS = int(config.get("worker_count", 1))
    log(f"\n[INFO] Starting to process {total_rows} rows with {MAX_WORKERS} workers")

    # Split DataFrame into chunks
    chunk_size = (total_rows + MAX_WORKERS - 1) // MAX_WORKERS if MAX_WORKERS > 0 else total_rows
    chunks = [df.iloc[i:i + chunk_size].copy() for i in range(0, total_rows, chunk_size)]
    actual_workers = min(len(chunks), MAX_WORKERS) if MAX_WORKERS > 0 else 1

    def process_chunk(df_chunk, thread_id):
        nonlocal processed_count
        results = []

        for index, row in df_chunk.iterrows():
            try:
                if "CA_id" in row: CA_id = row["CA_id"]
                else: CA_id = row.iloc[0] if len(row) > 0 else ""

                if "CA_Name" in row: CA_Name = row["CA_Name"]
                else: CA_Name = row.iloc[1] if len(row) > 1 else ""

                if "area_Audit_DTO" in row: area_Audit_DTO = row["area_Audit_DTO"]
                elif "Coordinates" in row: area_Audit_DTO = row["Coordinates"]
                else: area_Audit_DTO = row.iloc[2] if len(row) > 2 else ""
                
                # Latitude, Longitude, audited_count are optional — auto-calculated from Coordinates
                Latitude = row.get("Latitude", "") if "Latitude" in row.index else ""
                Longitude = row.get("Longitude", "") if "Longitude" in row.index else ""
                audited_count = row.get("audited_count", 0) if "audited_count" in row.index else 0

                sqm = ""
                acres = ""
                hectares = ""
                
                if pd.isna(CA_id) or pd.isna(area_Audit_DTO) or str(CA_id).strip() == "":
                    results.append((index, "Skipped: Missing Data", "", Latitude, Longitude, audited_count, sqm, acres, hectares))
                    continue

                # Read resolved unit from config before any try block
                unit_val = config.get("resolved_unit_val", "Hectare")

                try:
                    geo_info_str = str(area_Audit_DTO) if not isinstance(area_Audit_DTO, (dict, list)) else json.dumps(area_Audit_DTO)
                    geo_info = normalize_geo_info(geo_info_str)

                    # Perform Area & Center Point calculation based on geo_info
                    coords_to_calc = geo_info["features"][0]["geometry"]["coordinates"]
                    sqm_val, acres_val, hectares_val, center_lat, center_lon = calculate_area_and_center_multi(coords_to_calc)

                    sqm = sqm_val
                    acres = acres_val
                    hectares = hectares_val

                    if center_lat != 0 and center_lon != 0:
                        Latitude = center_lat
                        Longitude = center_lon

                    if acres > 0 or hectares > 0 or sqm > 0:
                        unit_lower = unit_val.lower().replace(" ", "").replace("_", "")
                        if unit_lower in ["acre", "acres"]:
                            audited_count = acres
                        elif unit_lower in ["hectare", "hectares"]:
                            audited_count = hectares
                        elif unit_lower in ["squaremeter", "squaremeters", "sqm", "sqmeter", "m2"]:
                            audited_count = sqm
                        else:
                            audited_count = sqm  # fallback
                except Exception as e:
                    results.append((index, f"Invalid GeoInfo/Calculation: {e}", "", Latitude, Longitude, audited_count, sqm, acres, hectares))
                    continue

                with processed_lock:
                    pending_rows = total_rows - processed_count

                log(f"[Thread {thread_id}] 🔄 Processing CA_ID: {CA_id} ({CA_Name}) | Row {index + 1}/{total_rows} | Processed: {processed_count} | Pending: {pending_rows}")

                get_endpoint = f"{api_url}/{CA_id}"
                get_response = requests.get(get_endpoint, headers=headers)

                if get_response.status_code != 200:
                    results.append((index, f"GET Failed: {get_response.status_code}", get_response.text[:30000], Latitude, Longitude, audited_count, sqm, acres, hectares))
                    log(f"[Thread {thread_id}] ❌ GET Failed for {CA_Name}")
                    continue
                
                log(f"[Thread {thread_id}] ✅ Fetched CA data for {CA_Name}")
                CA_data = get_response.json()

                try:
                    audit_count_val = float(audited_count)
                except:
                    audit_count_val = 0.0

                log(f"[Thread {thread_id}] 📐 Sending to API → count: {audit_count_val} | unit: {unit_val} | lat: {Latitude} | lon: {Longitude}")

                areaAudit = {
                    "id": None,
                    "geoInfo": geo_info,
                    "latitude": Latitude if Latitude != "" else None,
                    "longitude": Longitude if Longitude != "" else None,
                    "altitude": None
                }

                auditedArea = {
                    "count": audit_count_val,
                    "unit": unit_val
                }

                CA_data["areaAudit"] = areaAudit
                CA_data["auditedArea"] = auditedArea
                CA_data["latitude"] = None
                CA_data["longitude"] = None
                
                force_crop_audited = config.get("force_crop_audited", "true")
                
                if force_crop_audited == "true":
                    CA_data["cropAudited"] = True
                elif force_crop_audited == "false":
                    CA_data["cropAudited"] = False

                put_endpoint = f"{api_url}/area-audit"
                put_payload = json.dumps(CA_data)
                log(f"[Thread {thread_id}] 📦 auditedArea in payload: {CA_data.get('auditedArea')} | areaAudit lat/lon: {CA_data['areaAudit']['latitude']}, {CA_data['areaAudit']['longitude']}")
                
                put_response = requests.put(
                    put_endpoint,
                    headers=headers,
                    data=put_payload
                )

                if put_response.status_code != 200:
                    results.append((index, f"PUT Failed: {put_response.status_code}", put_response.text[:30000], Latitude, Longitude, audited_count, sqm, acres, hectares))
                    log(f"[Thread {thread_id}] ❌ PUT Failed: {put_response.status_code}")
                    continue

                results.append((index, "Success", put_response.text[:30000], Latitude, Longitude, audited_count, sqm, acres, hectares))
                log(f"[Thread {thread_id}] ✅ Updated area audit for {CA_Name}")

            except requests.exceptions.RequestException as e:
                results.append((index, f"Request Failed: {e}", str(e), Latitude, Longitude, audited_count, sqm, acres, hectares))
                log(f"[Thread {thread_id}] ❌ Request Exception: {e}")
            except Exception as e:
                results.append((index, f"Error: {e}", "", Latitude, Longitude, audited_count, sqm, acres, hectares))
                log(f"[Thread {thread_id}] ❌ Error: {e}")

            with processed_lock:
                processed_count += 1
            time.sleep(delay_time)

        return results

    with ThreadPoolExecutor(max_workers=actual_workers) as executor:
        futures = [
            executor.submit(process_chunk, chunk, thread_id + 1)
            for thread_id, chunk in enumerate(chunks)
        ]
        chunk_results = []
        for future in futures:
            chunk_results.extend(future.result())

    log("💾 Aggregating results...")
    for idx, status, response, lat, lon, aud_count, sqm, acres, hect in chunk_results:
        if idx in df.index:
            df.at[idx, "Status"] = status
            df.at[idx, "CA_Response"] = str(response)
            df.at[idx, "Latitude"] = lat
            df.at[idx, "Longitude"] = lon
            df.at[idx, "audited_count"] = aud_count
            df.at[idx, "area in square meters"] = sqm
            df.at[idx, "area in acres"] = acres
            df.at[idx, "area in hectares"] = hect

    # Save output
    log(f"\n💾 Saving output to: {output_excel_file}")
    try:
        df.to_excel(output_excel_file, index=False)
        log(f"🎯 Done. Output saved.")
    except Exception as e:
        log(f"❌ Error saving file: {e}")
