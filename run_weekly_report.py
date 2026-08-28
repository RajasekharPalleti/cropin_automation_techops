import os
import json
import sys
from app.standalone import Weekly_Report

def main():
    # Ensure outputs directory exists
    os.makedirs("outputs", exist_ok=True)
    output_path = os.path.join("outputs", "Weekly_Report_Output.xlsx")
    
    # Load configuration
    config_path = os.path.join("json_config", "weekly_report_config.json")
    if not os.path.exists(config_path):
        print(f"Error: {config_path} not found.")
        sys.exit(1)
        
    with open(config_path, "r") as f:
        config = json.load(f)
        
    # Callback to print logs to GitHub Actions console
    def log_callback(msg):
        print(msg)
        
    print("Starting Weekly Report via GitHub Actions...")
    
    try:
        # Run the report and trigger the email send action
        Weekly_Report.run(None, output_path, config, log_callback=log_callback, action="send")
        print("Weekly Report executed successfully.")
    except Exception as e:
        print(f"Error executing report: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
