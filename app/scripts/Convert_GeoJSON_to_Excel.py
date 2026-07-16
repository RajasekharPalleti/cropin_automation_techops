"""
Converts a GeoJSON file to an Excel (.xlsx) file by extracting all keys from feature properties
and geometry into separate columns.

Inputs:
GeoJSON (.geojson or .json) file containing a FeatureCollection.
"""
import json
import os
import time
import pandas as pd

# -------------------------------------------------
# Author: Rajasekhar Palleti
# Main processing function
# -------------------------------------------------
def run(input_excel, output_excel, config, log_callback=None):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    token = config.get("token")
    if token:
        log("🔑 Token received for authentication.")

    args_delay = config.get("delay_time", 1)
    try:
        delay_time = float(args_delay)
    except:
        delay_time = 1.0

    log(f"📘 Loading input file: {input_excel}")
    
    df = None
    
    # Check if the file is geojson/json
    is_json = False
    if input_excel.lower().endswith(('.json', '.geojson')):
        is_json = True
    else:
        # Try loading as JSON first anyway
        try:
            with open(input_excel, 'r', encoding='utf-8') as f:
                json.loads(f.read(100))
            is_json = True
        except:
            is_json = False

    if is_json:
        log("📄 Parsing input file as GeoJSON...")
        try:
            with open(input_excel, 'r', encoding='utf-8') as f:
                geojson_data = json.load(f)
            
            # Helper to recursively collect features
            def extract_features(data):
                if isinstance(data, dict):
                    if "features" in data and isinstance(data["features"], list):
                        return data["features"]
                    if data.get("type") == "Feature":
                        return [data]
                    for val in data.values():
                        res = extract_features(val)
                        if res is not None and len(res) > 0:
                            return res
                elif isinstance(data, list):
                    if len(data) > 0 and all(isinstance(item, dict) and item.get("type") == "Feature" for item in data[:5]):
                        return data
                    for item in data:
                        res = extract_features(item)
                        if res is not None and len(res) > 0:
                            return res
                return []

            features = extract_features(geojson_data)
            if not features:
                log("⚠️ No features found in the GeoJSON file.")
                features = []
                
            rows = []
            for feature in features:
                row_data = {}
                
                # Extract top-level feature keys except properties and geometry
                for k, v in feature.items():
                    if k not in ("properties", "geometry"):
                        if isinstance(v, (dict, list)):
                            row_data[f"feature_{k}"] = json.dumps(v)
                        else:
                            row_data[f"feature_{k}"] = v
                
                # Extract properties keys
                properties = feature.get("properties", {}) or {}
                for k, v in properties.items():
                    if isinstance(v, (dict, list)):
                        row_data[k] = json.dumps(v)
                    else:
                        row_data[k] = v
                
                # Extract geometry
                geometry = feature.get("geometry", {}) or {}
                row_data["geometry_type"] = geometry.get("type")
                coords = geometry.get("coordinates")
                if coords is not None:
                    row_data["geometry_coordinates"] = json.dumps(coords)
                else:
                    row_data["geometry_coordinates"] = None
                    
                rows.append(row_data)
                
            df = pd.DataFrame(rows)
            log(f"✅ Successfully converted GeoJSON to DataFrame with {len(df)} rows and {len(df.columns)} columns.")
        except Exception as e:
            log(f"❌ Error parsing GeoJSON file: {e}")
            return
    else:
        log("📊 Loading input file as Excel...")
        try:
            df = pd.read_excel(input_excel)
        except Exception as e:
            log(f"❌ Error reading Excel file: {e}")
            return

    # Ensure output columns exist and are explicitly cast to string to avoid TypeError
    if "Status" not in df.columns:
        df["Status"] = ""
    df["Status"] = df["Status"].fillna("").astype(str)

    if "Response" not in df.columns:
        df["Response"] = ""
    df["Response"] = df["Response"].fillna("").astype(str)

    total_rows = len(df)
    processed_count = 0
    log(f"🔄 Starting processing {total_rows} rows...")

    for index, row in df.iterrows():
        try:
            pending_rows = total_rows - processed_count
            log(f"🔄 Processing row {index+1}/{total_rows} | Processed: {processed_count} | Pending: {pending_rows}")
            
            df.at[index, "Status"] = "Success"
            df.at[index, "Response"] = "Extracted"
            
            # Use small sleep to respect delay configuration without being too slow
            time.sleep(delay_time / 10.0)
        except Exception as e:
            df.at[index, "Status"] = f"Error: {str(e)}"
            log(f"❌ Error processing row {index+1}: {e}")
        finally:
            processed_count += 1

    # Save output
    try:
        df.to_excel(output_excel, index=False)
        log(f"\n📁 Excel file saved successfully: {output_excel}")
    except Exception as e:
        log(f"❌ Error saving output Excel: {e}")
