"""
Creates Farmers, Assets, and Croppable Areas (CA) in a single dynamic payload.

Inputs:
Excel file with the following columns:
- projectId (mandatory)
- varietyId (mandatory)
- sowingDate (mandatory)
- mobileNumber (mandatory)
- countryCode (mandatory)
- countryIsoCode (mandatory)
- declaredAreaUnit (mandatory)
- country (mandatory)
- formattedAddress (mandatory)
- latitude (mandatory)
- longitude (mandatory)
- firstName (mandatory)
- farmerCode (mandatory)
- assignedTo (mandatory)
- declaredAreaCount (mandatory)
- assetName (mandatory)
- userIds (optional)
- placeId (optional)
- locality (optional)
- administrativeAreaLevel2 (optional)
- administrativeAreaLevel1 (optional)
- soilTypeId (optional)
- irrigationTypeId (optional)
"""
import json
import requests
import pandas as pd
import time
import concurrent.futures
import threading

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
    if not token:
        log("❌ No token provided in configuration.")
        return

    args_delay = config.get("delay_time", 1)
    try:
        delay_time = float(args_delay)
    except:
        delay_time = 1.0

    worker_count = config.get("worker_count", 2)
    try:
        max_workers = int(worker_count)
    except:
        max_workers = 2

    api_url = config.get("base_api_url")
    if not api_url:
        api_url = "https://cloud.cropin.in/services/farm/api/composite/dashboard"
        log(f"Using default API URL: {api_url}")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    log(f"📘 Loading Excel file: {input_excel}")
    try:
        df = pd.read_excel(input_excel)
    except Exception as e:
        log(f"❌ Error reading Excel file: {e}")
        return

    # Ensure output columns exist and are explicitly cast to string to avoid TypeError
    for col in ["Status", "Response", "croppableAreaId", "farmerId", "assetId"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str)

    # Validate required columns
    required_cols = [
        "projectId", "varietyId", "sowingDate", "mobileNumber", "countryCode",
        "countryIsoCode", "declaredAreaUnit", "country", "formattedAddress",
        "latitude", "longitude", "firstName", "farmerCode", "assignedTo",
        "declaredAreaCount", "assetName"
    ]
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        log(f"❌ Missing required columns: {', '.join(missing_cols)}")
        return

    def clean_str(val, default=""):
        if pd.isna(val) or str(val).strip() == "":
            return default
        return str(val).strip()

    def clean_int(val, default=""):
        if pd.isna(val) or str(val).strip() == "":
            return default
        try:
            return int(float(val))
        except:
            return default

    def clean_float(val, default=""):
        if pd.isna(val) or str(val).strip() == "":
            return default
        try:
            return float(val)
        except:
            return default

    def clean_date(val, default=""):
        if pd.isna(val) or str(val).strip() == "":
            return default
        try:
            dt = pd.to_datetime(val)
            return dt.strftime("%Y-%m-%dT00:00:00.000+0000")
        except:
            return str(val).strip()

    total_rows = len(df)
    processed_count = 0
    log(f"🔄 Starting processing {total_rows} rows using {max_workers} worker threads...")

    # Thread-safe logging locks
    log_lock = threading.Lock()
    processed_lock = threading.Lock()

    def thread_safe_log(msg):
        with log_lock:
            log(msg)

    def process_row(index, row):
        nonlocal processed_count
        status_msg = "Skipped"
        try:
            # Basic validation check for mandatory fields
            for col in required_cols:
                if pd.isna(row[col]) or str(row[col]).strip() == "":
                    thread_safe_log(f"⚠️ Row {index+1} skipped due to missing mandatory column '{col}'")
                    return index, f"Skipped: Missing mandatory column {col}", "", "", "", ""

            # Parse userIds
            user_ids_val = row.get("userIds")
            user_ids = ""
            if not pd.isna(user_ids_val) and str(user_ids_val).strip() != "":
                if isinstance(user_ids_val, (int, float)):
                    user_ids = [int(user_ids_val)]
                else:
                    user_ids = [int(x.strip()) for x in str(user_ids_val).split(",") if x.strip().isdigit()]

            # Parse assignedTo
            assigned_to_val = row["assignedTo"]
            assigned_to = []
            if isinstance(assigned_to_val, (int, float)):
                assigned_to = [int(assigned_to_val)]
            else:
                assigned_to = [int(x.strip()) for x in str(assigned_to_val).split(",") if x.strip().isdigit()]

            # Format countryCode
            country_code = clean_str(row["countryCode"])
            if country_code.endswith(".0"):
                country_code = country_code[:-2]
            if country_code and not country_code.startswith("+"):
                country_code = "+" + country_code

            # Build address sub-object
            address_obj = {
                "country": clean_str(row["country"]),
                "placeId": clean_str(row.get("placeId"), default=""),
                "latitude": clean_float(row["latitude"]),
                "longitude": clean_float(row["longitude"]),
                "formattedAddress": clean_str(row["formattedAddress"]),
                "locality": clean_str(row.get("locality"), default=""),
                "administrativeAreaLevel2": clean_str(row.get("administrativeAreaLevel2"), default=""),
                "administrativeAreaLevel1": clean_str(row.get("administrativeAreaLevel1"), default="")
            }

            # Build soilType and irrigationType
            soil_type_id = clean_int(row.get("soilTypeId"), default="")
            soil_type = {"id": soil_type_id}

            irrigation_type_id = clean_int(row.get("irrigationTypeId"), default="")
            irrigation_type = {"id": irrigation_type_id}

            # Parse declared area with minimum guard of 0.1
            declared_area_val = clean_float(row["declaredAreaCount"])
            declared_area_count = 0.1 if (not isinstance(declared_area_val, float) or declared_area_val < 0.1) else declared_area_val

            # Construct the payload
            payload = {
                "projectId": clean_int(row["projectId"]),
                "varietyId": clean_int(row["varietyId"]),
                "sowingDate": clean_date(row["sowingDate"]),
                "userIds": user_ids if user_ids != "" else None,
                "data": {},
                "farmer": {
                    "data": {
                        "mobileNumber": clean_str(row["mobileNumber"]),
                        "countryCode": country_code,
                        "countryIsoCode": clean_str(row["countryIsoCode"])
                    },
                    "images": {},
                    "status": "DISABLE",
                    "declaredArea": {
                        "enableConversion": "true",
                        "unit": clean_str(row["declaredAreaUnit"])
                    },
                    "address": address_obj,
                    "firstName": clean_str(row["firstName"]),
                    "farmerCode": clean_str(row["farmerCode"]),
                    "assignedTo": assigned_to
                },
                "asset": {
                    "address": address_obj,
                    "companyStatus": "ACTIVE",
                    "data": {},
                    "images": {},
                    "declaredArea": {
                        "enableConversion": "true",
                        "unit": clean_str(row["declaredAreaUnit"]),
                        "count": declared_area_count
                    },
                    "auditedArea": {
                        "enableConversion": "true",
                        "unit": clean_str(row["declaredAreaUnit"])
                    },
                    "name": clean_str(row["assetName"]),
                    "soilType": soil_type,
                    "irrigationType": irrigation_type
                }
            }

            # Send the request
            # thread_safe_log(f"📤 Sending POST request to: {api_url}")
            response = requests.post(api_url, headers=headers, json=payload)
            
            if response.status_code in (200, 201):
                status_msg = "Success"
                croppable_area_id = ""
                farmer_id = ""
                asset_id = ""
                try:
                    res_json = response.json()
                    if isinstance(res_json, dict):
                        ca_obj = res_json.get("croppableArea")
                        if isinstance(ca_obj, dict):
                            croppable_area_id = str(ca_obj.get("id", ""))
                        farmer_obj = res_json.get("farmer")
                        if isinstance(farmer_obj, dict):
                            farmer_id = str(farmer_obj.get("id", ""))
                        asset_obj = res_json.get("asset")
                        if isinstance(asset_obj, dict):
                            asset_id = str(asset_obj.get("id", ""))
                except Exception:
                    pass
                return index, "Success", response.text, croppable_area_id, farmer_id, asset_id
            else:
                status_msg = f"Failed ({response.status_code})"
                return index, f"Failed ({response.status_code})", response.text, "", "", ""

        except requests.exceptions.RequestException as e:
            status_msg = "Failed: Connection Error"
            return index, "Failed: Connection Error", str(e), "", "", ""
        except Exception as e:
            status_msg = f"Error: {str(e)}"
            return index, f"Error: {str(e)}", "", "", "", ""
        finally:
            with processed_lock:
                processed_count += 1
                pending_rows = total_rows - processed_count
                if "Success" in status_msg:
                    log_icon = "✅"
                elif "Skipped" in status_msg:
                    log_icon = "⚠️"
                else:
                    log_icon = "❌"
                farmer_name = clean_str(row.get("firstName")) or f"Row {index+1}"
                thread_safe_log(f"{log_icon} {status_msg} ({processed_count}/{total_rows}) | Pending: {pending_rows} | Farmer: {farmer_name}")
            time.sleep(delay_time)

    # Use ThreadPoolExecutor to run tasks concurrently
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_row, index, row): index for index, row in df.iterrows()}
        
        for future in concurrent.futures.as_completed(futures):
            processed_index, status, response, croppable_area_id, farmer_id, asset_id = future.result()
            df.at[processed_index, "Status"] = status
            df.at[processed_index, "Response"] = response
            df.at[processed_index, "croppableAreaId"] = croppable_area_id
            df.at[processed_index, "farmerId"] = farmer_id
            df.at[processed_index, "assetId"] = asset_id

    # Save output
    try:
        df.to_excel(output_excel, index=False)
        log(f"\n📁 Output Excel file updated successfully: {output_excel}")
    except Exception as e:
        log(f"❌ Error saving output Excel: {e}")
