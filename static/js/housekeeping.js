// ── Keys for local storage ──
const LS_TOKEN     = 'hk_token';
const LS_ENV       = 'hk_env';
const LS_TENANT    = 'hk_tenant';
const LS_USERNAME  = 'hk_username';
const LS_APP_HOST  = 'hk_app_host';
const LS_WEB_HOST  = 'hk_web_host';

// ── Global State ──
let token = localStorage.getItem(LS_TOKEN);
let env = localStorage.getItem(LS_ENV);
let tenant = localStorage.getItem(LS_TENANT);
let username = localStorage.getItem(LS_USERNAME);
let appHostUrl = localStorage.getItem(LS_APP_HOST);
let webHostUrl = localStorage.getItem(LS_WEB_HOST);

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        showScreen('screen-ops');
        document.getElementById('session-info-text').innerHTML = `Logged in as <b>${username}</b> (${env} - ${tenant})`;
        document.getElementById('session-banner').style.display = 'flex';
        document.getElementById('logout-btn').style.display = 'flex';
        fetchDeviceToken();
    } else {
        showScreen('screen-login');
        document.getElementById('session-banner').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
    }
});

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function handle401() {
    doLogout();
    alert("Session expired. Please log in again.");
}

function doLogout() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ENV);
    localStorage.removeItem(LS_TENANT);
    localStorage.removeItem(LS_USERNAME);
    localStorage.removeItem(LS_APP_HOST);
    localStorage.removeItem(LS_WEB_HOST);
    window.location.reload();
}

// ── SSO Auth and Dynamic Config ──
async function doLogin() {
    const envVal = document.getElementById('env').value;
    const tenantVal = document.getElementById('tenant').value.trim();
    const userVal = document.getElementById('username').value.trim();
    const passVal = document.getElementById('password').value;

    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    if (!tenantVal || !userVal || !passVal) {
        errorEl.textContent = 'Please fill in all fields.';
        errorEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons spinner">autorenew</span> Authenticating...';

    // Determine SSO URL based on env
    let ssoUrl = 'https://v2sso-gcp.cropin.co.in'; // QA
    if (envVal === 'UAT') ssoUrl = 'https://v2sso-uat-gcp.cropin.co.in';
    else if (envVal === 'PROD') ssoUrl = 'https://sso.sg.cropin.in';

    const tokenUrl = `${ssoUrl}/auth/realms/${tenantVal}/protocol/openid-connect/token`;

    try {
        const body = new URLSearchParams();
        body.append('username', userVal);
        body.append('password', passVal);
        body.append('grant_type', 'password');
        body.append('client_id', 'resource_server');
        body.append('client_secret', 'resource_server');
        body.append('scope', 'openid');

        const res = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!res.ok) {
            let msg = 'Authentication failed.';
            try { const errObj = await res.json(); msg = errObj.error_description || msg; } catch (e) {}
            throw new Error(msg);
        }

        const data = await res.json();
        const accessToken = data.access_token;
        if (!accessToken) throw new Error('No access token received.');

        btn.innerHTML = '<span class="material-icons spinner">autorenew</span> Resolving config...';

        // Dynamic API Config (appHost and webHost)
        let resolvedAppHost = 'https://au-v2.cropin.co.in';
        let resolvedWebHost = 'https://au-v2.cropin.co.in';

        if (envVal === 'PROD') {
            resolvedAppHost = 'https://cloud.cropin.in';
            resolvedWebHost = 'https://cloud.cropin.in';
        } else {
            const intlBase = envVal === 'UAT' ? 'https://intl-v2uat.cropin.co.in' : 'https://intl-v2.cropin.co.in';
            try {
                const configRes = await fetch(`${intlBase}/${tenantVal}`);
                if (configRes.ok) {
                    const configData = await configRes.json();
                    if (configData.appHost) resolvedAppHost = configData.appHost;
                    if (configData.webHost) resolvedWebHost = configData.webHost;
                } else {
                    console.warn("Intl config fetch failed. Using fallback defaults.");
                }
            } catch (err) {
                console.warn("Intl config fetch error:", err);
            }
        }

        // Save session
        localStorage.setItem(LS_TOKEN, accessToken);
        localStorage.setItem(LS_ENV, envVal);
        localStorage.setItem(LS_TENANT, tenantVal);
        localStorage.setItem(LS_USERNAME, userVal);
        localStorage.setItem(LS_APP_HOST, resolvedAppHost);
        localStorage.setItem(LS_WEB_HOST, resolvedWebHost);

        window.location.reload();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Authenticate';
    }
}

// ── API: User Info (Get Device Token) ──
async function fetchDeviceToken() {
    const inputEl = document.getElementById('pn-token');
    if (!appHostUrl || !token) return;

    try {
        const url = `${appHostUrl}/services/user/api/users/user-info`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401) {
            handle401();
            return;
        }
        if (!res.ok) throw new Error('Failed to fetch user-info');
        
        const data = await res.json();
        
        // Grab deviceToken (or fallback to empty)
        let tokenVal = '';
        if (data && data.deviceToken) {
            tokenVal = data.deviceToken;
        } else if (data && data.devices && data.devices.length > 0) {
            // some versions of this API return a devices array
            tokenVal = data.devices[0].deviceToken || '';
        }

        if (tokenVal) {
            inputEl.value = tokenVal;
        } else {
            inputEl.placeholder = 'No device token found. Please enter manually.';
        }
    } catch (err) {
        console.error("Error loading user info:", err);
        inputEl.placeholder = 'Error loading device token';
    }
}

// ── UI Actions ──
function appendTimestamp(inputId) {
    const el = document.getElementById(inputId);
    if (el) {
        let val = el.value.trim();
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[now.getMonth()];
        const year = now.getFullYear();
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        const ts = `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
        
        // Check if the value already ends with a timestamp (e.g., " 31-Aug-2026 13:22:15")
        const regex = /\s\d{2}-[a-zA-Z]{3}-\d{4} \d{2}:\d{2}:\d{2}$/;
        if (regex.test(val)) {
            val = val.replace(regex, ''); // Remove the old one
        }
        
        el.value = val ? `${val} ${ts}` : `${ts}`;
    }
}

// ── API: Send Push Notification ──
async function sendPush(prefix) {
    const statusEl = document.getElementById(`status-${prefix}`);
    statusEl.innerHTML = '';

    const pushToken   = document.getElementById('pn-token').value.trim();
    const appPlatform = document.getElementById(`${prefix}-appPlatform`).value.trim();
    const triggerType = document.getElementById(`${prefix}-triggerType`).value.trim();
    let triggerId     = document.getElementById(`${prefix}-triggerId`).value.trim();
    const title       = document.getElementById(`${prefix}-title`).value.trim();
    const bodyText    = document.getElementById(`${prefix}-body`).value.trim();
    const image       = document.getElementById(`${prefix}-image`) ? document.getElementById(`${prefix}-image`).value.trim() : "";

    if (!pushToken || !appPlatform || !title || !bodyText) {
        statusEl.innerHTML = `<div class="error-msg">Please fill in all required fields, including the Global FCM Token.</div>`;
        return;
    }

    const btn = document.getElementById(`btn-${prefix}`);
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons spinner">autorenew</span> Sending...';

    try {
        const payload = {
            appPlatform: appPlatform,
            token: pushToken,
            title: title,
            body: bodyText,
            image: image,
            data: {
                triggerType: triggerType,
                triggerId: triggerId
            }
        };

        if (prefix === 'logout') {
            const clearData = document.getElementById('logout-clearData').checked;
            payload.data.clearDataLogout = clearData;
        }

        const url = `${appHostUrl}/services/communications/api/pushNotification`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (res.status === 401) {
            handle401();
            return;
        }

        if (!res.ok) {
            const errObj = await res.json().catch(() => ({}));
            throw new Error(errObj.message || 'Push Notification failed');
        }

        statusEl.innerHTML = `<div style="color: #2e7d32; font-weight: 500; display: flex; align-items: center; gap: 4px; margin-top: 10px;">
            <span class="material-icons">check_circle</span> Notification sent successfully!
        </div>`;
    } catch (err) {
        statusEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ── Bulk XLSX Operations ──
function downloadTemplate() {
    // Generate a basic workbook with SheetJS
    const ws_data = [
        ["id", "name", "device_token", "contact_number"],
        ["41451", "Rajasekhar User", "c_VsAzAfRVey8qzl2CmWki:APA91bEvGP58tym9AGQHuQCyU_H2H7bxdYL-UgrfUsQHHVzvpZz7wJf-Q9p0fYS8nnHokQd-d-R88N0-rpN1czsvHtSQVGeR5ZSYQ4EDxeao1y8Yh0Ef4BM", "9649964096"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    
    // Download it
    XLSX.writeFile(wb, "bulk_fcm_template.xlsx");
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        try {
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to json, expecting headers in the first row
            const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
            
            let records = [];
            json.forEach(row => {
                // Find keys case-insensitively
                let id = "";
                let name = "";
                let deviceToken = "";
                let contactNumber = "";
                
                for (let key in row) {
                    const k = key.toLowerCase();
                    if (k === 'id') id = String(row[key]).trim();
                    if (k === 'name' || k.includes('name')) name = String(row[key]).trim();
                    if (k === 'device_token' || k.includes('device') || k.includes('fcm')) deviceToken = String(row[key]).trim();
                    if (k === 'contact_number' || k.includes('contact')) contactNumber = String(row[key]).trim();
                }
                
                if (name || deviceToken) {
                    records.push({ id, name, deviceToken, contactNumber });
                }
            });

            renderTable(records);
        } catch (err) {
            console.error(err);
            const status = document.getElementById('file-status');
            status.textContent = "Error reading XLSX file.";
            status.style.color = "#d32f2f";
        }

        // Reset file input
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

function renderTable(records) {
    const container = document.getElementById('file-table-container');
    const tbody = document.getElementById('file-table-body');
    const status = document.getElementById('file-status');

    if (records.length === 0) {
        status.textContent = "No valid records found in XLSX.";
        status.style.color = "#d32f2f";
        container.style.display = 'none';
        return;
    }

    status.textContent = `Loaded ${records.length} records.`;
    status.style.color = "#2e7d32";
    tbody.innerHTML = '';

    records.forEach(rec => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = "1px solid #e2e8f0";
        
        const tdId = document.createElement('td');
        tdId.style.padding = "8px";
        tdId.textContent = rec.id;

        const tdName = document.createElement('td');
        tdName.style.padding = "8px";
        tdName.textContent = rec.name;
        
        const tdToken = document.createElement('td');
        tdToken.style.padding = "8px";
        tdToken.style.maxWidth = "150px";
        tdToken.style.overflow = "hidden";
        tdToken.style.textOverflow = "ellipsis";
        tdToken.style.whiteSpace = "nowrap";
        tdToken.textContent = rec.deviceToken;
        tdToken.title = rec.deviceToken; // Show full on hover

        const tdContact = document.createElement('td');
        tdContact.style.padding = "8px";
        tdContact.textContent = rec.contactNumber;

        const tdAction = document.createElement('td');
        tdAction.style.padding = "8px";
        
        const btn = document.createElement('button');
        btn.className = "btn btn-secondary";
        btn.style.padding = "2px 8px";
        btn.style.fontSize = "0.75rem";
        btn.textContent = "Select";
        btn.onclick = () => selectRow(rec.deviceToken, tr);
        
        tdAction.appendChild(btn);
        
        tr.appendChild(tdId);
        tr.appendChild(tdName);
        tr.appendChild(tdToken);
        tr.appendChild(tdContact);
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
    });

    container.style.display = 'block';
}

function selectRow(fcmToken, rowElement) {
    // Populate the global token field
    const tokenInput = document.getElementById('pn-token');
    tokenInput.value = fcmToken;
    tokenInput.style.backgroundColor = "#e0f2fe"; // highlight briefly
    setTimeout(() => {
        tokenInput.style.backgroundColor = "";
    }, 500);

    // Highlight the selected row
    const tbody = document.getElementById('file-table-body');
    Array.from(tbody.children).forEach(r => r.style.backgroundColor = "");
    if (rowElement) {
        rowElement.style.backgroundColor = "#f0fdf4";
    }
}
