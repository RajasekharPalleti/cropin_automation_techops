"""
Deletes places in Cropin one by one based on Place IDs.

Inputs:
Excel file with a 'Place ID' column.
"""
import time
import requests
import pandas as pd

def run(input_excel_file, output_excel_file, config, log_callback=None):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    # 1. Configuration & Auth
    api_url = config.get("base_api_url", "https://cloud.cropin.in/services/farm/api/place")
    token = config.get("token")
    delay_time = float(config.get("delay_time", 1.0))

    if not token:
        log("❌ Error: Authorization token missing.")
        return

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # 2. Read Input Excel
    log(f"Reading input file: {input_excel_file}")
    try:
        df = pd.read_excel(input_excel_file)
    except Exception as e:
        log(f"❌ Failed to read Excel: {e}")
        return

    # 3. Validation & Setup
    if "Place ID" not in df.columns:
        log("❌ Error: Missing required column 'Place ID' in Excel file.")
        return

    # Add output columns and ensure string type
    for col in ["Status", "Response"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str)

    total_rows = len(df)
    processed_count = 0
    log(f"Starting place deletion for {total_rows} rows...")

    session = requests.Session()

    def clean_val(val):
        if pd.isna(val):
            return ""
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        return str(val).strip()

    # 4. Process Rows
    for index, row in df.iterrows():
        place_id = clean_val(row.get("Place ID"))
        pending_rows = total_rows - processed_count

        log(f"📍 Executing Row {index + 1} of {total_rows}: Deleting Place ID '{place_id}' | Processed: {processed_count} | Pending: {pending_rows}")

        if not place_id:
            df.at[index, "Status"] = "Skipped"
            df.at[index, "Response"] = "Empty Place ID"
            log(f"   ⏭️ Skipped: Empty Place ID")
            processed_count += 1
            continue

        try:
            delete_url = f"{api_url.rstrip('/')}/{place_id}"
            resp = session.delete(delete_url, headers=headers, timeout=30)
            
            if resp.status_code in (200, 204):
                df.at[index, "Status"] = "Success"
                df.at[index, "Response"] = f"Code: {resp.status_code}"
                log(f"   ✅ Successfully deleted place ID: {place_id}")
            else:
                err_text = resp.text[:200]
                df.at[index, "Status"] = "Failed"
                df.at[index, "Response"] = f"HTTP {resp.status_code}: {err_text}"
                log(f"   ❌ Failed ({resp.status_code}) → {err_text}")
                
        except Exception as e:
            df.at[index, "Status"] = "Failed"
            df.at[index, "Response"] = str(e)
            log(f"   ❌ Error: {str(e)}")

        processed_count += 1
        time.sleep(delay_time)

    # 5. Save Output
    try:
        df.to_excel(output_excel_file, index=False)
        log(f"✅ Output saved to: {output_excel_file}")
    except Exception as e:
        log(f"❌ Error saving output: {e}")
