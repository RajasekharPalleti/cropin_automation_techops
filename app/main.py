from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import shutil
import os
import importlib.util
from typing import List, Dict
import json
from app.core.auth import get_access_token
from openpyxl import load_workbook
from openpyxl.worksheet.datavalidation import DataValidation
import pandas as pd
import asyncio

from contextlib import asynccontextmanager

# ... existing imports ...

SCRIPTS_DIR = "app/scripts"
UPLOAD_DIR = "uploads"
OUTPUT_DIR = "outputs"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Clean up temporary directories
    print("Execute Clean up temporary directories...")
    dirs_to_clean = [UPLOAD_DIR, OUTPUT_DIR]
    for d in dirs_to_clean:
        if os.path.exists(d):
            for filename in os.listdir(d):
                file_path = os.path.join(d, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception as e:
                    print(f"Failed to delete {file_path}. Reason: {e}")
    yield

app = FastAPI(lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")



# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_log(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id)

@app.get("/")
async def read_root():
    return FileResponse("static/index.html")

@app.get("/api/scripts")
async def list_scripts():
    scripts = []
    # Define default Configs (URL + Label + Input Requirement)
    default_configs = {
        "AddTagsWithNewAPI.py": {
            "url": "https://cloud.cropin.in/services/master/api/tags",
            "label": "Post Api Url",
            "requires_input": True
        },
        "UpdateFarmerName.py": {
            "url": "https://cloud.cropin.in/services/farm/api/farmers",
            "label": "Base Api Url",
            "requires_input": True
        },
        "PR_Enablement.py": {
            "url": "https://cloud.cropin.in/services/farm/api/croppable-areas",
            "label": "Base Api Url",
            "requires_input": True
        },
        "PR_and_Weather_Enablement.py": {
            "url": "https://cloud.cropin.in/services/farm/api/croppable-areas",
            "label": "Base Api Url",
            "requires_input": True
        },
        "RefreshPlans.py": {
            "url": "https://cloud.cropin.in/services/farm/api/croppable-areas",
            "label": "Base Api Url (Fixed in Script)",
            "requires_input": True
        },
        "Update_Asset_add_Attribute.py": {
            "url": "https://cloud.cropin.in/services/farm/api/assets",
            "label": "Base Api Url",
            "requires_input": True
        },
        "Update_Farmer_Addtl_Atrribute.py": {
            "url": "https://cloud.cropin.in/services/farm/api/farmers",
            "label": "Base Api Url",
            "requires_input": True
        }
    }
    
    for filename in os.listdir(SCRIPTS_DIR):
        if filename.endswith(".py") and filename != "__init__.py":
            config = default_configs.get(filename, {
                "url": "https://cloud.cropin.in/services/master/api", 
                "label": "Api Url",
                "requires_input": True
            })
            scripts.append({
                "name": filename, 
                "url": config["url"],
                "label": config["label"],
                "requires_input": config.get("requires_input", True)
            })
    
    # Sort scripts alphabetically by name
    scripts.sort(key=lambda x: x['name'])
            
    return {"scripts": scripts}

@app.get("/api/template/{script_name}")
async def get_template(script_name: str):
    # Construct expected template filename
    # e.g. AddTagsWithNewAPI.py -> AddTagsWithNewAPI.xlsx
    template_filename = script_name.replace('.py', '.xlsx')
    template_path = os.path.join("sample_templates", template_filename)

    if os.path.exists(template_path):
        return FileResponse(template_path, filename=template_filename, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    else:
        # Fallback or error if template doesn't exist
        raise HTTPException(status_code=404, detail=f"Template not found for {script_name}. Please add {template_filename} to sample_templates folder.")

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    # Save uploaded file
    input_filename = f"input_{file.filename}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"filename": file.filename, "server_path": input_filename}

@app.post("/api/execute")
async def execute_script(
    script_name: str = Form(...),
    input_filename: str = Form(None), # Optional now
    config: str = Form(...),
    client_id: str = Form(...) # To send logs to the right client
):
    script_path = os.path.join(SCRIPTS_DIR, script_name)
    if not os.path.exists(script_path):
        raise HTTPException(status_code=404, detail="Script not found")

    input_path = None
    output_filename = f"{script_name.replace('.py', '')}_Output.xlsx"
    
    if input_filename:
        input_path = os.path.join(UPLOAD_DIR, f"input_{input_filename}")
        if not os.path.exists(input_path):
            raise HTTPException(status_code=404, detail="Input file not found")
        
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    try:
        config_dict = json.loads(config)
        
        # AUTH LOGIC
        username = config_dict.get("username")
        password = config_dict.get("password")
        environment = config_dict.get("environment")
        tenant_code = config_dict.get("tenant_code")
        
        # Log Auth Start
        await manager.send_log(f"Authenticating user: {username}...", client_id)

        if username and password and tenant_code:
            try:
                token = get_access_token(tenant_code, username, password, environment)
                if token:
                    config_dict["token"] = token
                    await manager.send_log("Authentication successful.", client_id)
                else:
                    raise Exception("Authentication failed: No token returned.")
            except Exception as auth_err:
                 await manager.send_log(f"Auth Error: {str(auth_err)}", client_id)
                 raise HTTPException(status_code=401, detail=f"Authentication failed: {str(auth_err)}")
        
        # Capture loop for threadsafe logging
        loop = asyncio.get_running_loop()

        # Define Log Callback
        def log_callback(message):
            # We need to run the async send_log from sync context
            try:
               asyncio.run_coroutine_threadsafe(manager.send_log(message, client_id), loop)
            except Exception as e:
               print(f"Log Error: {e}")
        # Load script module dynamically
        spec = importlib.util.spec_from_file_location("module.name", script_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        if hasattr(module, "run"):
            await manager.send_log(f"Starting execution of {script_name}...", client_id)
            
            # Wrapper to inject callback if supported
            def run_wrapper():
                # Check signature of run arguments
                import inspect
                sig = inspect.signature(module.run)
                if 'log_callback' in sig.parameters:
                     module.run(input_path, output_path, config_dict, log_callback=log_callback)
                else:
                     module.run(input_path, output_path, config_dict)

            await asyncio.to_thread(run_wrapper)
            
            await manager.send_log("Script execution finished.", client_id)
            return FileResponse(output_path, filename=output_filename, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        else:
            raise HTTPException(status_code=400, detail="Script does not have a 'run' function")

    except Exception as e:
        import traceback
        traceback.print_exc()
        await manager.send_log(f"Error: {str(e)}", client_id)
        raise HTTPException(status_code=500, detail=str(e))
