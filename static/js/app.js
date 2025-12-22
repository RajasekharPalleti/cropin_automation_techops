document.addEventListener('DOMContentLoaded', () => {
    const configToggle = document.getElementById('config-toggle');
    const configContent = document.getElementById('config-content');
    const scriptSelect = document.getElementById('script-select');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');
    const statusArea = document.getElementById('status-area');
    const generateTemplateBtn = document.getElementById('generate-template-btn');

    // Toggle Config
    configToggle.addEventListener('click', () => {
        configContent.classList.toggle('open');
    });

    // Password Toggle
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.querySelector('.eye-icon');

    eyeIcon.addEventListener('click', () => {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.textContent = '🙈'; // Monkey covering eyes (hidden) or just a slash eye
        } else {
            passwordInput.type = 'password';
            eyeIcon.textContent = '👁️';
        }
    });

    // Custom Dropdown Elements
    const customDropdown = document.getElementById('custom-dropdown');
    const dropdownSelected = document.getElementById('dropdown-selected');
    const selectedText = document.getElementById('selected-text');
    const dropdownMenu = document.getElementById('dropdown-menu');
    const searchInput = document.getElementById('dropdown-search-input');
    const dropdownList = document.getElementById('dropdown-list');

    let scriptsData = [];

    // Populate Scripts
    fetch('/api/scripts')
        .then(response => response.json())
        .then(data => {
            scriptsData = data.scripts; // Now objects {name: "...", url: "..."}
            populateDropdown(scriptsData);
        });

    function populateDropdown(scripts) {
        // Clear existing
        dropdownList.innerHTML = '';
        scriptSelect.innerHTML = '<option value="" disabled selected>Select a script...</option>';

        scripts.forEach(scriptObj => {
            const scriptName = scriptObj.name;

            // Populate hidden select for compatibility
            const option = document.createElement('option');
            option.value = scriptName;
            option.textContent = scriptName;
            scriptSelect.appendChild(option);

            // Populate custom list
            const li = document.createElement('li');
            li.textContent = scriptName;
            li.dataset.value = scriptName;
            li.addEventListener('click', () => {
                selectScript(scriptName);
            });
            dropdownList.appendChild(li);
        });
    }

    function selectScript(value) {
        selectedText.textContent = value;
        scriptSelect.value = value;

        // Reset state
        currentUploadedFilename = null;
        statusArea.innerHTML = '';
        consoleBox.style.display = 'none';

        // Auto-update API URL & Label & Extended Config based on selection
        const selectedScript = scriptsData.find(s => s.name === value);

        // UI Toggle for Direct Run vs Upload
        const stepOne = document.querySelector('.step-one');
        const dropZone = document.getElementById('drop-zone');
        const uploadLabel = document.querySelector('.step-two label'); // "Upload filled Excel"
        const runContainer = document.getElementById('run-container');

        if (selectedScript) {
            if (selectedScript.url) document.getElementById('put-api-url').value = selectedScript.url;
            if (selectedScript.label) {
                const label = document.querySelector('label[for="put-api-url"]');
                if (label) label.textContent = selectedScript.label;
            }

            // Populate Extended Config
            const extendedConfigDiv = document.getElementById('extended-config');

            if (selectedScript.name === 'Add_Users.py') {
                extendedConfigDiv.style.display = 'block';
                // Only show API Key field, hide others if possible or just show all
                // For simplicity, showing all but we only care about x-api-key
                document.getElementById('dataset').closest('.input-group').style.display = 'none';
                document.getElementById('load-type').closest('.input-group').style.display = 'none';
                document.getElementById('x-api-key').closest('.input-group').style.display = 'block';

                // Update label for x-api-key to say Google API Key
                document.querySelector('label[for="x-api-key"]').textContent = "Google API Key";

            } else if (selectedScript.name === 'GetDiscrollsData.py') {
                extendedConfigDiv.style.display = 'block';
                document.getElementById('dataset').closest('.input-group').style.display = 'block';
                document.getElementById('load-type').closest('.input-group').style.display = 'block';
                document.getElementById('x-api-key').closest('.input-group').style.display = 'block';
                document.querySelector('label[for="x-api-key"]').textContent = "X-API-KEY";
            } else {
                extendedConfigDiv.style.display = 'none';
            }

            // Toggle PR Config (shared for PR enablement scripts)
            const prConfig = document.getElementById('pr-weather-config');
            if (prConfig) {
                if (selectedScript.name === 'PR_Enablement.py' || selectedScript.name === 'PR_and_Weather_Enablement.py') {
                    prConfig.style.display = 'block';
                } else {
                    prConfig.style.display = 'none';
                }
            }

            // Toggle Asset Attribute Config
            const assetConfig = document.getElementById('asset-attr-config');
            if (assetConfig) {
                if (selectedScript.name === 'Update_Asset_add_Attribute.py' || selectedScript.name === 'Update_Farmer_Addtl_Atrribute.py') {
                    assetConfig.style.display = 'block';
                } else {
                    assetConfig.style.display = 'none';
                }
            }

            // Toggle Address Config
            const addrConfig = document.getElementById('address-config');
            if (addrConfig) {
                if (selectedScript.name === 'Update_Farmer_Address.py') {
                    addrConfig.style.display = 'block';
                } else {
                    addrConfig.style.display = 'none';
                }
            }

            // Toggle Area Audit Config
            const areaConfig = document.getElementById('area-audit-config');
            if (areaConfig) {
                if (selectedScript.name === 'Area_Audit_To_CA.py') {
                    areaConfig.style.display = 'block';
                } else {
                    areaConfig.style.display = 'none';
                }
            }

            // Logic for Attribute Count Dropdown
            const attrCountSelect = document.getElementById('attr-count-select');
            if (attrCountSelect) {
                attrCountSelect.addEventListener('change', function () {
                    const count = parseInt(this.value);
                    document.getElementById('group-key-1').style.display = 'block'; // Always show 1
                    document.getElementById('group-key-2').style.display = count >= 2 ? 'block' : 'none';
                    document.getElementById('group-key-3').style.display = count >= 3 ? 'block' : 'none';
                    document.getElementById('group-key-4').style.display = count >= 4 ? 'block' : 'none';
                });
            }

            // Logic for Address Count Dropdown
            const addrCountSelect = document.getElementById('addr-count-select');
            if (addrCountSelect) {
                addrCountSelect.addEventListener('change', function () {
                    const count = parseInt(this.value);
                    document.getElementById('group-addr-1').style.display = 'block'; // Always show 1
                    document.getElementById('group-addr-2').style.display = count >= 2 ? 'block' : 'none';
                    document.getElementById('group-addr-3').style.display = count >= 3 ? 'block' : 'none';
                    document.getElementById('group-addr-4').style.display = count >= 4 ? 'block' : 'none';
                });
            }

            if (selectedScript.requires_input === false) {
                // Direct Run Mode
                stepOne.style.display = 'none';
                dropZone.style.display = 'none';
                uploadLabel.style.display = 'none';
                runContainer.style.display = 'block';
                statusArea.innerHTML = '<div style="color: blue;">Ready to run (No input file required).</div>';
            } else {
                // Default Upload Mode
                stepOne.style.display = 'block';
                dropZone.style.display = 'flex'; // Restore flex
                uploadLabel.style.display = 'block';
                runContainer.style.display = 'none'; // Hide until upload
            }
        }

        // Trigger change event manually for listeners
        const event = new Event('change');
        scriptSelect.dispatchEvent(event);

        closeDropdown();
    }

    // Toggle Dropdown
    dropdownSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
        dropdownSelected.classList.toggle('active');
        if (dropdownMenu.classList.contains('show')) {
            searchInput.focus();
        }
    });

    // Search Filter
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        // Filter by name
        const filtered = scriptsData.filter(s => s.name.toLowerCase().includes(term));

        dropdownList.innerHTML = '';
        if (filtered.length > 0) {
            filtered.forEach(scriptObj => {
                const scriptName = scriptObj.name;
                const li = document.createElement('li');
                li.textContent = scriptName;
                li.dataset.value = scriptName;
                li.addEventListener('click', () => {
                    selectScript(scriptName);
                });
                dropdownList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.className = 'no-results';
            li.textContent = 'No scripts found';
            dropdownList.appendChild(li);
        }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!customDropdown.contains(e.target)) {
            closeDropdown();
        }
        if (!envDropdown.contains(e.target)) {
            closeEnvDropdown();
        }
    });

    function closeDropdown() {
        dropdownMenu.classList.remove('show');
        dropdownSelected.classList.remove('active');
    }

    // Auto-open Config on Script Selection (Existing logic listens to scriptSelect change)
    scriptSelect.addEventListener('change', () => {
        configContent.classList.add('open');
    });

    // --- Environment Custom Dropdown Logic ---
    const envDropdown = document.getElementById('env-dropdown');
    const envSelected = document.getElementById('env-selected');
    const envSelectedText = document.getElementById('env-selected-text');
    const envMenu = document.getElementById('env-menu');
    const envList = document.getElementById('env-list');
    const envNativeSelect = document.getElementById('environment');

    // Toggle Env Dropdown
    envSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        envMenu.classList.toggle('show');
        envSelected.classList.toggle('active');
        // Close other dropdown if open
        closeDropdown();
    });

    function closeEnvDropdown() {
        envMenu.classList.remove('show');
        envSelected.classList.remove('active');
    }

    // Handle Env Selection
    const envItems = envList.querySelectorAll('li');
    envItems.forEach(item => {
        item.addEventListener('click', () => {
            const value = item.getAttribute('data-value');
            const text = item.textContent;

            // UI Update
            envSelectedText.textContent = text;

            // Sync with hidden select
            envNativeSelect.value = value;

            closeEnvDropdown();
        });
    });

    // Handle Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        console.log('File input changed:', e.target.files);
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    let currentUploadedFilename = null;
    const runContainer = document.getElementById('run-container');
    const runBtn = document.getElementById('run-script-btn');
    const consoleBox = document.getElementById('console-box');
    const consoleContent = document.getElementById('console-content');

    // Generate specific client ID
    const clientId = 'client_' + Math.random().toString(36).substr(2, 9);

    function handleFile(file) {
        console.log('Handling file:', file);
        if (!scriptSelect.value) {
            console.warn('No script selected!');
            alert('Please select a script first.');
            return;
        }

        // 1. Upload File immediately
        const formData = new FormData();
        formData.append('file', file);

        statusArea.innerHTML = '<div style="color: blue;">Uploading ' + file.name + '...</div>';

        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                currentUploadedFilename = data.filename; // actually we need the one returned by server if modified
                // The server returns "filename" (original) and "server_path" (input_...)
                // Our execute endpoint expects just the original filename part if it reconstructs "input_" 
                // OR we passed "filename" back.
                // Server: return {"filename": file.filename, "server_path": input_filename}
                // Execute: input_filename = f"input_{input_filename}" in main.py? 
                // looking at main.py: input_path = os.path.join(UPLOAD_DIR, f"input_{input_filename}")
                // So we should pass content of file.filename

                statusArea.innerHTML = '<div style="color: green;">Uploaded: ' + file.name + '</div>';
                runContainer.style.display = 'block';
            })
            .catch(err => {
                statusArea.innerHTML = '<div style="color: red;">Upload Failed: ' + err.message + '</div>';
            });
    }

    runBtn.addEventListener('click', () => {
        // Check requirement
        const selectedScriptName = scriptSelect.value;
        const selectedScript = scriptsData.find(s => s.name === selectedScriptName);

        // Only require file if script requires input
        if (selectedScript && selectedScript.requires_input !== false) {
            if (!currentUploadedFilename) {
                alert("No file uploaded");
                return;
            }
        }

        // Show console
        consoleBox.style.display = 'block';
        consoleContent.innerHTML = ''; // Clear previous
        const connLine = document.createElement('div');
        connLine.className = 'console-line';
        connLine.textContent = '> Connecting to console...';
        consoleContent.appendChild(connLine);
        runBtn.disabled = true;

        // 2. Connect WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;
        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            const logLine = document.createElement('div');
            logLine.className = 'console-line';
            logLine.textContent = '> ' + event.data;
            consoleContent.appendChild(logLine);
            consoleContent.scrollTop = consoleContent.scrollHeight; // Auto-scroll
        };

        ws.onopen = () => {
            // 3. Execute Script
            const startLine = document.createElement('div');
            startLine.className = 'console-line';
            startLine.textContent = '> Connected. Starting execution...';
            consoleContent.appendChild(startLine);

            const postApiUrl = document.getElementById('put-api-url').value;
            const useFarmerId = document.getElementById('use-farmer-id').value;

            // Asset Attribute Configs
            const attrCount = parseInt(document.getElementById('attr-count-select').value) || 1;
            let attrKeys = [];

            // Check script name for Logic
            const scriptNameForConfig = scriptSelect.value;

            if (scriptNameForConfig === 'Update_Farmer_Address.py') {
                // Read Address Keys
                const addrCount = parseInt(document.getElementById('addr-count-select').value) || 1;

                // Clear any previous (e.g. from accidental double push)
                attrKeys = [];

                const k1 = document.getElementById('address-key-1').value;
                if (k1) attrKeys.push(k1);

                if (addrCount >= 2) {
                    const k2 = document.getElementById('address-key-2').value;
                    if (k2) attrKeys.push(k2);
                }
                if (addrCount >= 3) {
                    const k3 = document.getElementById('address-key-3').value;
                    if (k3) attrKeys.push(k3);
                }
                if (addrCount >= 4) {
                    const k4 = document.getElementById('address-key-4').value;
                    if (k4) attrKeys.push(k4);
                }

            } else {
                // Default Attribute Keys
                attrKeys.push(document.getElementById('attr-key-1').value);
                if (attrCount >= 2) attrKeys.push(document.getElementById('attr-key-2').value);
                if (attrCount >= 3) attrKeys.push(document.getElementById('attr-key-3').value);
                if (attrCount >= 4) attrKeys.push(document.getElementById('attr-key-4').value);
            }

            // Area Audit Unit & Crop Audited Check
            const areaUnit = document.getElementById('area-unit-select') ? document.getElementById('area-unit-select').value : "Hectare";
            const forceCropAuditedVal = document.getElementById('force-crop-audited') ? document.getElementById('force-crop-audited').value : "none";

            const config = {
                username: document.getElementById('username').value,
                password: document.getElementById('password').value,
                environment: document.getElementById('environment').value,
                tenant_code: document.getElementById('tenant-code').value,
                post_api_url: postApiUrl,
                use_farmer_id: useFarmerId,
                attr_keys: attrKeys,
                unit: areaUnit,
                force_crop_audited: forceCropAuditedVal
            };

            const formData = new FormData();
            formData.append('script_name', scriptSelect.value);
            // Send filename if exists, otherwise empty
            if (currentUploadedFilename) {
                formData.append('input_filename', currentUploadedFilename);
            }
            formData.append('config', JSON.stringify(config));
            formData.append('client_id', clientId);

            fetch('/api/execute', {
                method: 'POST',
                body: formData
            })
                .then(response => {
                    if (response.ok) {
                        // Extract filename from Content-Disposition header if possible
                        const disposition = response.headers.get('Content-Disposition');
                        let filename = 'Result.xlsx';
                        if (disposition && disposition.indexOf('attachment') !== -1) {
                            var filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                            var matches = filenameRegex.exec(disposition);
                            if (matches != null && matches[1]) {
                                filename = matches[1].replace(/['"]/g, '');
                            }
                        } else {
                            // Fallback logic
                            if (currentUploadedFilename) {
                                filename = 'Result_' + currentUploadedFilename;
                            } else {
                                // Direct run fallback
                                filename = 'Result_' + scriptSelect.value.replace('.py', '.json');
                                // Note: We default to .json for direct run here as per request, 
                                // but ideally backend sends header.
                            }
                        }
                        return response.blob().then(blob => ({ blob, filename }));
                    }
                    return response.json().then(err => { throw new Error(err.detail || 'Execution Failed'); });
                })
                .then(({ blob, filename }) => {
                    const finishLine = document.createElement('div');
                    finishLine.className = 'console-line';
                    finishLine.style.color = '#00ff00'; // Bright green for success
                    finishLine.textContent = '> Execution Finished. Downloading ' + filename + '...';
                    consoleContent.appendChild(finishLine);
                    consoleContent.scrollTop = consoleContent.scrollHeight;

                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();

                    statusArea.innerHTML = '<div style="color: green;">Success! Check downloads.</div>';
                    runBtn.disabled = false;
                    ws.close();
                })
                .catch(error => {
                    const errLine = document.createElement('div');
                    errLine.className = 'console-line';
                    errLine.style.color = '#ff4444'; // Red for error
                    errLine.textContent = '> ERROR: ' + error.message;
                    consoleContent.appendChild(errLine);
                    consoleContent.scrollTop = consoleContent.scrollHeight;

                    statusArea.innerHTML = '<div style="color: red;">Execution Failed</div>';
                    runBtn.disabled = false;
                    ws.close();
                });
        };

        ws.onerror = (e) => {
            const errLine = document.createElement('div');
            errLine.className = 'console-line';
            errLine.style.color = '#ff4444';
            errLine.textContent = '> WebSocket Error.';
            consoleContent.appendChild(errLine);
        };
    });

    // Generate Template Logic (Mock)
    generateTemplateBtn.addEventListener('click', () => {
        if (!scriptSelect.value) {
            alert('Please select a script first.');
            return;
        }
        const scriptName = scriptSelect.value;
        statusArea.innerHTML = '<div style="color: blue;">Generating template...</div>';

        fetch('/api/template/' + scriptName)
            .then(response => {
                if (response.ok) {
                    return response.blob();
                }
                return response.json().then(err => { throw new Error(err.detail || 'Error generating template'); });
            })
            .then(blob => {
                statusArea.innerHTML = '';
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'Template_' + scriptName.replace('.py', '.xlsx');
                document.body.appendChild(a);
                a.click();
                a.remove();
                document.getElementById('template-info-box').textContent = "Template downloaded successfully";
            })
            .catch(error => {
                statusArea.innerHTML = '<div style="color: red;">Template Error: ' + error.message + '</div>';
                alert('Template Error: ' + error.message);
            });
    });
});
