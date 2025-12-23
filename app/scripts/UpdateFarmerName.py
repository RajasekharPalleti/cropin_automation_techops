"""
Updates farmer names based on Farmer IDs.

Inputs:
Excel file with Farmer ID and New Name columns.
"""
import requests
import pandas as pd

import time

def run(input_excel_file, output_excel_file, config, log_callback=None):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    # Configuration
    bearer_token = config.get('token')
    base_api_url = config.get('post_api_url') 
    # User input might have trailing slash or not, let's handle it carefully if needed.
    # Assuming user provides: https://cloud.cropin.in/services/master/api/tags or similar BASE
    # User's example: https://cloud.cropin.in/services/farm/api/farmers/{farmer_id}
    # The configured URL in UI might be the LIST endpoint or just base. 
    # Let's assume the UI input IS the PUT endpoint (collection) as per previous scripts.
    
    # Construct URLs based on the provided base URL from UI
    # If UI gives: https://cloud.cropin.in/services/farm/api/farmers
    # GET: https://cloud.cropin.in/services/farm/api/farmers/{id}
    # PUT: https://cloud.cropin.in/services/farm/api/farmers
    
    PUT_API_URL = base_api_url
    GET_API_URL = base_api_url + "/{farmer_id}"
    
    wait_time = 0.4
    
    headers = {
        'Authorization': f'Bearer {bearer_token}',
        'Content-Type': 'application/json',
    }

    def get_farmer_details(farmer_id):
        url = GET_API_URL.format(farmer_id=farmer_id)
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                return response.json()
            else:
                log(f"Failed to fetch details for Farmer ID: {farmer_id}. Status Code: {response.status_code}")
                return None
        except Exception as e:
            log(f"Exception during GET: {e}")
            return None

    def update_farmer_details(farmer_id, updated_data):
        url = PUT_API_URL 
        try:
            response = requests.put(url, headers=headers, json=updated_data)
            # Return tuple (success, response_text)
            if response.status_code in [200, 204]:
                log(f"Successfully updated Farmer ID: {farmer_id}")
                return True, response.text
            else:
                log(f"Failed to update Farmer ID: {farmer_id}. Status Code: {response.status_code} | Resp: {response.text}")
                return False, response.text
        except Exception as e:
            log(f"Exception during PUT: {e}")
            return False, str(e)

    log("Reading Excel file...")
    try:
        data = pd.read_excel(input_excel_file)
        if 'farmer_id' not in data.columns or 'first_name' not in data.columns:
            log("Error: Excel must contain 'farmer_id' and 'first_name' columns.")
            return

        if 'status' not in data.columns:
            data['status'] = ''
        if 'response' not in data.columns:
            data['response'] = ''
            
    except Exception as e:
        log(f"Error reading Excel file: {e}")
        return

    # Iterate
    # limit = min(iterations, len(data))
    for i in range(len(data)):
        farmer_id = str(data.at[i, 'farmer_id']) # Ensure string
        new_first_name = data.at[i, 'first_name']

        log(f"Iteration {i + 1}: Processing Farmer ID: {farmer_id}")

        # Step 1: Get
        farmer_details = get_farmer_details(farmer_id)
        
        if not farmer_details:
            data.at[i, 'status'] = 'GET Failed'
            continue

        # Step 2: Check & Modify
        current_first_name = farmer_details.get('firstName', '')
        if pd.isna(new_first_name): new_first_name = ""
        
        if current_first_name != new_first_name:
            farmer_details['firstName'] = new_first_name
            # Step 3: PUT
            success, resp_text = update_farmer_details(farmer_id, farmer_details)
            data.at[i, 'status'] = 'Updated' if success else 'PUT Failed'
            data.at[i, 'response'] = resp_text
        else:
            log(f"No update needed for Farmer ID: {farmer_id}")
            data.at[i, 'status'] = 'No Update Needed'
            data.at[i, 'response'] = 'N/A' 
        
        time.sleep(wait_time)

        time.sleep(wait_time)

    log("Saving updated Excel file...")
    data.to_excel(output_excel_file, index=False)
    log("Processing completed!")
