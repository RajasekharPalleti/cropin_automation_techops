// ── Translation page JS ──────────────────────────────────────────────────
// Persists token + baseUrl in localStorage so page refresh keeps the session.
// 401 from any API call forces re-login.

const LS_TOKEN = 'translation_token';
const LS_APP_HOST = 'translation_app_host';
const LS_WEB_HOST = 'translation_web_host';
const LS_ENV = 'translation_env';
const LS_TENANT = 'translation_tenant';
const LS_USERNAME = 'translation_username';

const SSO_CONFIG = {
    QA: 'https://v2sso-gcp.cropin.co.in',
    UAT: 'https://v2sso-uat-gcp.cropin.co.in',
    PROD: 'https://sso.sg.cropin.in'
};

const LS_LOGINTYPE = 'translation_logintype';

// ── runtime state ──
let token = null;
let appHostUrl = null;
let webHostUrl = null;
let currentTranslationId = null;

// ── Download Helpers ──
async function extractDownloadUrl(res) {
    const textStr = await res.text();
    let data;
    try { data = JSON.parse(textStr); } catch(e) { data = textStr; }
    
    if (typeof data === 'string' && data.startsWith('http')) return data.trim();
    if (data && data.url) return data.url;
    if (data && data.data && data.data.url) return data.data.url;
    if (data && data.downloadUrl) return data.downloadUrl;
    if (data && data.data && typeof data.data === 'string' && data.data.startsWith('http')) return data.data;
    if (data && data.message && typeof data.message === 'string' && data.message.startsWith('http')) return data.message;
    return null;
}

async function triggerInternalDownload(downloadUrl, defaultFilename) {
    const env = localStorage.getItem(LS_ENV) || '';
    const prefix = env ? `${env}_` : '';

    try {
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) throw new Error(`Status ${fileRes.status}`);
        
        const blob = await fileRes.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = prefix + defaultFilename;
        
        const cd = fileRes.headers.get('content-disposition');
        if (cd) {
            const matches = /filename="?([^"]+)"?/.exec(cd);
            if (matches && matches[1]) {
                a.download = prefix + matches[1];
            }
        }
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        }, 100);
    } catch (err) {
        console.warn("Internal Blob fetch failed (likely CORS), falling back to tab navigation.", err);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.target = '_blank';
        a.download = prefix + defaultFilename; // Might be ignored by browser for cross-origin, but we try
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => { a.remove(); }, 100);
    }
}

// ── load languages & custom multiselect logic ──
function toggleLangDropdown() {
    const box = document.getElementById('lang-dropdown-box');
    if (box.style.display === 'none') {
        box.style.display = 'block';
        document.getElementById('lang-search-input').focus();
    } else {
        box.style.display = 'none';
    }
}

document.addEventListener('click', function(event) {
    const ms = document.getElementById('cloud-lang-multiselect');
    const box = document.getElementById('lang-dropdown-box');
    if (ms && box && !ms.contains(event.target)) {
        box.style.display = 'none';
    }
});

function filterLanguages() {
    const term = document.getElementById('lang-search-input').value.toLowerCase();
    const items = document.querySelectorAll('.lang-cb-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(term) ? 'flex' : 'none';
    });
}

function handleLangSelectionChange() {
    const list = document.getElementById('lang-checkbox-list');
    const items = Array.from(list.querySelectorAll('.lang-cb-item'));
    
    const checked = items.filter(item => item.querySelector('.lang-cb').checked);
    const unchecked = items.filter(item => !item.querySelector('.lang-cb').checked);
    
    // Reorder DOM elements: checked first, then unchecked
    checked.forEach(item => list.appendChild(item));
    unchecked.forEach(item => list.appendChild(item));

    const chipsContainer = document.getElementById('cloud-lang-chips');
    if (chipsContainer) {
        chipsContainer.innerHTML = '';
        checked.forEach(item => {
            const text = item.textContent.trim();
            const chip = document.createElement('div');
            chip.style.background = '#e0f2fe';
            chip.style.color = '#0284c7';
            chip.style.padding = '4px 8px';
            chip.style.borderRadius = '12px';
            chip.style.fontSize = '0.75rem';
            chip.style.display = 'flex';
            chip.style.alignItems = 'center';
            chip.textContent = text;
            chipsContainer.appendChild(chip);
        });
    }

    const textEl = document.getElementById('lang-selected-text');
    if (checked.length === 0) {
        textEl.textContent = 'Select languages...';
        textEl.style.color = '#6b7280';
    } else {
        textEl.textContent = `${checked.length} language${checked.length > 1 ? 's' : ''} selected`;
        textEl.style.color = '#333';
    }
}

async function loadCloudLanguages() {
    const listEl = document.getElementById('lang-checkbox-list');
    if (!listEl || !appHostUrl || !token) return;
    
    // Only load once
    if (listEl.querySelector('.lang-cb-item')) return;

    try {
        const url = `${appHostUrl}/services/farm/api/languages/search-all?size=5000`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch languages');
        const data = await res.json();
        
        listEl.innerHTML = ''; // clear loading text
        
        const activeLangs = data.filter(lang => lang.deleted === false);
        activeLangs.forEach(lang => {
            const label = document.createElement('label');
            label.className = 'lang-cb-item';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.padding = '6px 8px';
            label.style.cursor = 'pointer';
            label.style.borderRadius = '4px';
            
            label.onmouseover = () => label.style.background = '#f5f5f5';
            label.onmouseout = () => label.style.background = 'transparent';
            
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = lang.code;
            cb.className = 'lang-cb';
            cb.style.marginRight = '8px';
            cb.onchange = handleLangSelectionChange;
            
            const text = document.createTextNode(`${lang.name} (${lang.code})`);
            
            label.appendChild(cb);
            label.appendChild(text);
            listEl.appendChild(label);
        });
    } catch (err) {
        console.error("Error loading languages:", err);
        listEl.innerHTML = '<div style="padding: 8px; color: #e74c3c;">Failed to load languages</div>';
    }
}

// ── screen helpers ──
function showScreen(id) {
    ['screen-login', 'screen-ops'].forEach(s => {
        document.getElementById(s).classList.toggle('active', s === id);
    });
    if (id === 'screen-ops') {
        const loginType = localStorage.getItem(LS_LOGINTYPE);
        const isMeta = (loginType === 'meta');
        document.getElementById('meta-config-section').style.display = isMeta ? 'block' : 'none';
        document.getElementById('meta-apis-section').style.display = isMeta ? 'block' : 'none';
        document.getElementById('cloud-apis-section').style.display = !isMeta ? 'block' : 'none';
        
        if (!isMeta) {
            loadCloudLanguages();
        }
    }
}

function updateSessionBanner() {
    const banner = document.getElementById('session-banner');
    const text = document.getElementById('session-info-text');
    const env = localStorage.getItem(LS_ENV) || '';
    const tenant = localStorage.getItem(LS_TENANT) || '';
    const username = localStorage.getItem(LS_USERNAME) || '';
    const ah = localStorage.getItem(LS_APP_HOST) || '';
    const wh = localStorage.getItem(LS_WEB_HOST) || '';
    const ltype = localStorage.getItem(LS_LOGINTYPE) || '';

    // For meta, urls might not be immediately available, so we just show the banner if token exists.
    if (token) {
        banner.style.display = '';
        const activeHost = (ltype === 'meta') ? wh : ah;
        text.textContent = `Logged in · ${ltype.toUpperCase()} · ${env}${tenant ? ' · ' + tenant : ''}${username ? ' · ' + username : ''} ${activeHost ? ' · ' + activeHost : ' (Hosts pending)'}`;
        document.getElementById('logout-btn').style.display = '';
    } else {
        banner.style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
    }
}

// ── on page load: restore session ──
(function init() {
    const savedToken = localStorage.getItem(LS_TOKEN);
    const savedAppHost = localStorage.getItem(LS_APP_HOST);
    const savedWebHost = localStorage.getItem(LS_WEB_HOST);
    const savedTenant = localStorage.getItem(LS_TENANT);
    const savedEnv = localStorage.getItem(LS_ENV);
    const savedLType = localStorage.getItem(LS_LOGINTYPE) || 'cloud';

    if (savedTenant) document.getElementById('tenant').value = savedTenant;
    if (savedEnv) document.getElementById('env').value = savedEnv;
    document.getElementById('login-type').value = savedLType;

    // Handle login type change
    document.getElementById('login-type').addEventListener('change', function () {
        const type = this.value;
        const tenantContainer = document.getElementById('tenant-container');
        if (type === 'meta') {
            tenantContainer.style.display = 'none';
        } else {
            tenantContainer.style.display = 'block';
        }
    });
    // Trigger immediately to set correct initial state
    document.getElementById('login-type').dispatchEvent(new Event('change'));

    if (savedToken) {
        token = savedToken;
        appHostUrl = savedAppHost || '';
        webHostUrl = savedWebHost || '';
        updateSessionBanner();
        showScreen('screen-ops');
    } else {
        showScreen('screen-login');
    }
})();

// ── 401 handler ──
function handle401() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_APP_HOST);
    localStorage.removeItem(LS_WEB_HOST);
    token = null; appHostUrl = null; webHostUrl = null;
    alert('Your session has expired (401). Please log in again.');
    updateSessionBanner();
    showScreen('screen-login');
}

// ── LOGIN ──
async function doLogin() {
    const loginType = document.getElementById('login-type').value;
    const env = document.getElementById('env').value;
    const tenant = document.getElementById('tenant').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errEl.style.display = 'none';

    if (loginType === 'cloud' && !tenant) {
        errEl.textContent = 'Tenant Name is required for Cloud login.';
        errEl.style.display = 'block';
        return;
    }

    if (!username || !password) {
        errEl.textContent = 'Username and Password are required.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons" style="font-size:1rem;">hourglass_top</span> Authenticating…';

    try {
        const bodyObj = {
            username, password,
            grant_type: 'password',
            client_id: 'resource_server',
            client_secret: 'resource_server',
            scope: 'openid'
        };
        const body = new URLSearchParams(bodyObj);

        const loginUrl = loginType === 'meta'
            ? `${SSO_CONFIG[env]}/auth/realms/cropin/protocol/openid-connect/token`
            : `${SSO_CONFIG[env]}/auth/realms/${encodeURIComponent(tenant)}/protocol/openid-connect/token`;

        const res = await fetch(
            loginUrl,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
        );
        if (!res.ok) throw new Error(`Auth failed: ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!data.access_token) throw new Error('No access_token in response.');

        token = data.access_token;
        localStorage.setItem(LS_TOKEN, token);
        localStorage.setItem(LS_ENV, env);
        localStorage.setItem(LS_LOGINTYPE, loginType);

        if (loginType === 'cloud') {
            localStorage.setItem(LS_TENANT, tenant);
        } else {
            localStorage.removeItem(LS_TENANT);
        }
        localStorage.setItem(LS_USERNAME, username);

        // Auto-fetch/set appHost from tenant config ONLY FOR CLOUD
        const CONFIG_HOST = { QA: 'https://intl-v2.cropin.co.in', UAT: 'https://intl-v2uat.cropin.co.in' };
        const FALLBACK_HOST = { QA: 'https://au-v2.cropin.co.in', UAT: 'https://au-v2uat-gcp.cropin.co.in', PROD: 'https://cloud.cropin.in' };

        if (loginType === 'cloud') {
            try {
                if (env === 'PROD') {
                    appHostUrl = 'https://cloud.cropin.in';
                    webHostUrl = 'https://cloud.cropin.in';
                } else {
                    const cfgBase = CONFIG_HOST[env];
                    if (!cfgBase) throw new Error('no config host for env');
                    const cfgRes = await fetch(`${cfgBase}/${encodeURIComponent(tenant)}`, {
                        headers: { 'accept': 'application/json, text/plain, */*', 'accept-language': 'en-GB,en;q=0.5' }
                    });
                    if (cfgRes.ok) {
                        const cfg = await cfgRes.json();
                        if (cfg.appHost) appHostUrl = cfg.appHost.replace(/\/$/, '');
                        if (cfg.webHost) webHostUrl = cfg.webHost.replace(/\/$/, '');
                    }
                }
            } catch (_) {
                // silently ignore
            }
            // Fallbacks if auto-fetch failed
            if (!appHostUrl) appHostUrl = FALLBACK_HOST[env] || FALLBACK_HOST.QA;
            if (!webHostUrl) webHostUrl = (FALLBACK_HOST[env] || FALLBACK_HOST.QA).replace('-gcp', '');
            
            localStorage.setItem(LS_APP_HOST, appHostUrl);
            localStorage.setItem(LS_WEB_HOST, webHostUrl);
        } else {
            // For Meta, we don't fetch URLs here. We leave them empty until they provide the tenant on the next screen.
            appHostUrl = '';
            webHostUrl = '';
            localStorage.setItem(LS_APP_HOST, appHostUrl);
            localStorage.setItem(LS_WEB_HOST, webHostUrl);
        }

        updateSessionBanner();
        showScreen('screen-ops');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons" style="font-size:1rem;">lock_open</span> Authenticate & Proceed';
    }
}


// ── LOGOUT ──
function doLogout() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ENV);
    localStorage.removeItem(LS_TENANT);
    localStorage.removeItem(LS_USERNAME);
    localStorage.removeItem(LS_APP_HOST);
    localStorage.removeItem(LS_WEB_HOST);
    localStorage.removeItem(LS_LOGINTYPE);
    
    token = null; 
    appHostUrl = null;
    webHostUrl = null;
    currentTranslationId = null;
    
    document.getElementById('session-banner').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'none';
    // clear login fields
    ['tenant', 'username', 'password'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('login-error').style.display = 'none';
    showScreen('screen-login');
}

// ── Meta Config ──
async function fetchMetaBaseUrl() {
    const tenant = document.getElementById('meta-tenant').value.trim();
    const statusEl = document.getElementById('meta-config-status');
    const errEl = document.getElementById('meta-config-error');
    const env = localStorage.getItem(LS_ENV);

    errEl.style.display = 'none';
    statusEl.textContent = '';

    if (!tenant) {
        errEl.textContent = 'Please enter a tenant name.';
        errEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('meta-config-btn');
    btn.disabled = true;
    statusEl.textContent = 'Fetching config...';
    statusEl.style.color = '#1565c0';

    try {
        let newAppHost = '';
        let newWebHost = '';
        const CONFIG_HOST = { QA: 'https://intl-v2.cropin.co.in', UAT: 'https://intl-v2uat.cropin.co.in' };
        const FALLBACK_HOST = { QA: 'https://au-v2.cropin.co.in', UAT: 'https://au-v2uat-gcp.cropin.co.in', PROD: 'https://cloud.cropin.in' };

        if (env === 'PROD') {
            newAppHost = 'https://cloud.cropin.in';
            newWebHost = 'https://cloud.cropin.in';
        } else {
            const cfgBase = CONFIG_HOST[env];
            if (!cfgBase) throw new Error('No config host for env');
            const cfgRes = await fetch(`${cfgBase}/${encodeURIComponent(tenant)}`, {
                headers: { 'accept': 'application/json, text/plain, */*', 'accept-language': 'en-GB,en;q=0.5' }
            });
            if (cfgRes.ok) {
                const cfg = await cfgRes.json();
                if (cfg.appHost) newAppHost = cfg.appHost.replace(/\/$/, '');
                if (cfg.webHost) newWebHost = cfg.webHost.replace(/\/$/, '');
            }
        }

        if (!newAppHost) {
            newAppHost = FALLBACK_HOST[env] || FALLBACK_HOST.QA;
            console.warn("Failed to fetch appHost dynamically, using fallback.");
        }
        if (!newWebHost) {
            newWebHost = (FALLBACK_HOST[env] || FALLBACK_HOST.QA).replace('-gcp', '');
            console.warn("Failed to fetch webHost dynamically, using fallback.");
        }

        appHostUrl = newAppHost;
        webHostUrl = newWebHost;
        localStorage.setItem(LS_APP_HOST, appHostUrl);
        localStorage.setItem(LS_WEB_HOST, webHostUrl);
        updateSessionBanner();

        statusEl.textContent = `Base URL configured: ${webHostUrl}`;
        statusEl.style.color = '#2e7d32';
    } catch (err) {
        errEl.textContent = `Error fetching config: ${err.message}`;
        errEl.style.display = 'block';
        statusEl.textContent = '';
    } finally {
        btn.disabled = false;
    }
}

// ── API: Download Template ──
async function doDownloadTemplate() {
    const btn = document.getElementById('dl-template-btn');
    const statusEl = document.getElementById('dl-template-status');
    const errEl = document.getElementById('dl-template-error');
    const ltype = localStorage.getItem(LS_LOGINTYPE);

    // Pick base URL: download API prefers webHost for meta, appHost for cloud
    const urlBase = (ltype === 'meta') ? webHostUrl : appHostUrl;

    if (!token || !urlBase) {
        handle401();
        return;
    }

    errEl.style.display = 'none';
    statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Requesting template URL...';
    statusEl.style.color = '#1565c0';
    btn.disabled = true;

    try {
        const url = `${urlBase}/meta/api/language-translates/download-template`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (res.status === 401) { handle401(); return; }
        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const downloadUrl = await extractDownloadUrl(res);
        if (!downloadUrl) throw new Error('Could not find download URL in the API response. Check console for details.');

        statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Template URL received. Downloading internally...';
        await triggerInternalDownload(downloadUrl, "translation_template.xlsx");

        statusEl.innerHTML = '<span class="material-icons" style="font-size:1rem;">check_circle</span> Template downloaded successfully.';
        statusEl.style.color = '#2e7d32';
    } catch (err) {
        console.error("Download Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
    }
}

// ── API: Download English Strings ──
async function doDownloadEnglishStrings() {
    const btn = document.getElementById('dl-eng-strings-btn');
    const statusEl = document.getElementById('dl-eng-strings-status');
    const errEl = document.getElementById('dl-eng-strings-error');
    const ltype = localStorage.getItem(LS_LOGINTYPE);

    const urlBase = (ltype === 'meta') ? webHostUrl : appHostUrl;

    if (!token || !urlBase) {
        handle401();
        return;
    }

    errEl.style.display = 'none';
    statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Requesting english strings URL...';
    statusEl.style.color = '#2980b9';
    btn.disabled = true;

    try {
        const url = `${urlBase}/meta/api/language-translates/download-english-strings`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (res.status === 401) { handle401(); return; }
        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const downloadUrl = await extractDownloadUrl(res);
        if (!downloadUrl) throw new Error('Could not find download URL in the API response. Check console for details.');

        statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Strings URL received. Downloading internally...';
        await triggerInternalDownload(downloadUrl, "english_strings.xlsx");

        statusEl.innerHTML = '<span class="material-icons" style="font-size:1rem;">check_circle</span> English strings downloaded successfully.';
        statusEl.style.color = '#2e7d32';
    } catch (err) {
        console.error("Download Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

// ── CLOUD API 1: Download Translation Template File ──
async function doCloudDownloadLabel() {
    const btn = document.getElementById('cloud-dl-label-btn');
    const statusEl = document.getElementById('cloud-dl-label-status');
    const errEl = document.getElementById('cloud-dl-label-error');
    const tenant = localStorage.getItem(LS_TENANT);

    if (!token || !appHostUrl) {
        handle401();
        return;
    }
    
    if (!tenant) {
        errEl.textContent = 'Tenant name is missing. Please log in again.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Requesting translation template URL...';
    statusEl.style.color = '#1abc9c';
    btn.disabled = true;

    try {
        const checkboxes = document.querySelectorAll('.lang-cb:checked');
        const selectedCodes = Array.from(checkboxes).map(cb => cb.value);
        const langCodesInput = selectedCodes.join(',');

        const paramsObj = { tenant: tenant };
        if (langCodesInput) {
            paramsObj.languageCodes = langCodesInput;
        }

        const queryParams = new URLSearchParams(paramsObj);
        const url = `${appHostUrl}/services/fileupload-service/api/language-downloads/template?${queryParams.toString()}`;

        let res;
        
        let maxRetries = parseInt(document.getElementById('cloud-dl-retries').value, 10);
        if (isNaN(maxRetries) || maxRetries < 0) maxRetries = 0;
        if (maxRetries > 3) maxRetries = 3;

        let delayInterval = parseInt(document.getElementById('cloud-dl-interval').value, 10);
        if (isNaN(delayInterval) || delayInterval < 1) delayInterval = 1;
        if (delayInterval > 30) delayInterval = 30;

        const delayMs = delayInterval * 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    statusEl.innerHTML = `<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Attempt ${attempt}... Retrying download request...`;
                }
                
                res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (res.status === 401) { handle401(); return; }
                if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);
                
                // If successful, break out of the retry loop
                break;
            } catch (err) {
                if (attempt === maxRetries) {
                    throw new Error(`Failed after ${maxRetries} attempts. Last error: ${err.message}`);
                }
                console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs/1000}s...`, err);
                statusEl.innerHTML = `<span class="material-icons spinner" style="font-size:1rem; color:#f39c12;">autorenew</span> Attempt ${attempt} failed, retrying in ${delayMs/1000}s...`;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> File received. Generating download...';
        
        const blob = await res.blob();
        
        let baseFilename = `${tenant}`;
        if (langCodesInput) {
            // Strip spaces and replace commas with underscores (e.g., 'en, es' -> 'en_es')
            baseFilename += `_${langCodesInput.replace(/\s+/g, '').replace(/,/g, '_')}`;
        }
        baseFilename += '.xlsx';

        // Add environment prefix
        const env = localStorage.getItem(LS_ENV) || '';
        const prefix = env ? `${env}_` : '';
        let finalFilename = prefix + baseFilename;

        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        }, 100);

        statusEl.innerHTML = '<span class="material-icons" style="font-size:1rem;">check_circle</span> Translation template downloaded successfully.';
        statusEl.style.color = '#2e7d32';
    } catch (err) {
        console.error("Cloud Download Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

// ── CLOUD API 2: Upload Corrected Translation File ──
async function doCloudUploadTemplate() {
    const btn = document.getElementById('cloud-ul-btn');
    const statusEl = document.getElementById('cloud-ul-status');
    const errEl = document.getElementById('cloud-ul-error');
    const fileInput = document.getElementById('cloud-ul-file');
    const tenant = localStorage.getItem(LS_TENANT);

    if (!token || !appHostUrl) {
        handle401();
        return;
    }

    if (!tenant) {
        errEl.textContent = 'Tenant name is missing. Please log in again.';
        errEl.style.display = 'block';
        return;
    }

    if (!fileInput.files || fileInput.files.length === 0) {
        errEl.textContent = 'Please select a file to upload.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    statusEl.textContent = 'Uploading file...';
    statusEl.style.color = '#f39c12';
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('tenant', tenant);
        formData.append('file', fileInput.files[0]);

        const url = `${appHostUrl}/services/fileupload-service/api/language-uploads/template`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: formData
        });

        if (res.status === 401) { handle401(); return; }
        
        let data;
        const textStr = await res.text();
        try { data = JSON.parse(textStr); } catch(e) { data = textStr; }
        
        console.log("Cloud Upload Template API Response:", data);

        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const formattedData = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        statusEl.innerHTML = `
            <div style="margin-bottom: 8px; color: #2e7d32;"><strong>Upload successful!</strong> Response:</div>
            <pre style="background: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; color: #334155; border: 1px solid #e2e8f0; margin: 0; max-height: 250px; overflow-y: auto;">${formattedData}</pre>
        `;
    } catch (err) {
        console.error("Cloud Upload Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}
// ── API: Upload Template ──
async function doUploadTemplate() {
    const btn = document.getElementById('ul-template-btn');
    const statusEl = document.getElementById('ul-template-status');
    const errEl = document.getElementById('ul-template-error');
    const ltype = localStorage.getItem(LS_LOGINTYPE);

    const reviewTrans = document.getElementById('ul-review').value.trim();
    const uploadedBy = document.getElementById('ul-uploaded-by').value.trim();
    const nameStr = document.getElementById('ul-name').value.trim();
    const fileInput = document.getElementById('ul-file');

    const urlBase = (ltype === 'meta') ? webHostUrl : appHostUrl;

    if (!token || !urlBase) {
        handle401();
        return;
    }

    if (!fileInput.files.length) {
        errEl.textContent = 'Please select a file to upload.';
        errEl.style.display = 'block';
        return;
    }
    if (!reviewTrans || !uploadedBy || !nameStr) {
        errEl.textContent = 'Please fill out all required parameters.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    statusEl.textContent = 'Uploading template...';
    statusEl.style.color = '#1565c0';
    btn.disabled = true;

    try {
        const formData = new FormData();
        // Typically the backend expects the multipart field name to be 'file'
        formData.append('file', fileInput.files[0]);

        const queryParams = new URLSearchParams({
            reviewTranslation: reviewTrans,
            uploadedBy: uploadedBy,
            name: nameStr
        });

        const url = `${urlBase}/meta/api/language-translates/google-template?${queryParams.toString()}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
                // Do NOT set Content-Type; let browser set it automatically with boundary for FormData
            },
            body: formData
        });

        if (res.status === 401) { handle401(); return; }
        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const data = await res.json();
        console.log("Upload Template API Response:", data);

        if (data.id) {
            currentTranslationId = data.id;
            statusEl.innerHTML = `<strong>Upload successful!</strong> Translation ID captured: <code>${currentTranslationId}</code>`;
            statusEl.style.color = '#2e7d32';
            // Auto-fill for the next step
            document.getElementById('dl-translated-id').value = currentTranslationId;
        } else {
            statusEl.textContent = 'Upload successful, but no ID returned in response.';
            statusEl.style.color = '#f39c12';
        }
    } catch (err) {
        console.error("Upload Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

// ── API: Download Translated File ──
async function doDownloadTranslatedFile() {
    const btn = document.getElementById('dl-translated-btn');
    const statusEl = document.getElementById('dl-translated-status');
    const errEl = document.getElementById('dl-translated-error');
    const ltype = localStorage.getItem(LS_LOGINTYPE);
    
    const transId = document.getElementById('dl-translated-id').value.trim();

    const urlBase = (ltype === 'meta') ? webHostUrl : appHostUrl;

    if (!token || !urlBase) {
        handle401();
        return;
    }

    if (!transId) {
        errEl.textContent = 'Please provide a Translation Upload ID.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Requesting translated file URL...';
    statusEl.style.color = '#8e44ad';
    btn.disabled = true;

    try {
        const queryParams = new URLSearchParams({
            translationUploadId: transId
        });
        
        const url = `${urlBase}/meta/api/language-translates/download-translated-file?${queryParams.toString()}`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (res.status === 401) { handle401(); return; }
        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const downloadUrl = await extractDownloadUrl(res);
        if (!downloadUrl) throw new Error('Could not find download URL in the API response. Check console for details.');

        statusEl.innerHTML = '<span class="material-icons spinner" style="font-size:1rem;">autorenew</span> Template URL received. Downloading internally...';
        await triggerInternalDownload(downloadUrl, `translated_template_${transId}.xlsx`);

        statusEl.innerHTML = '<span class="material-icons" style="font-size:1rem;">check_circle</span> Translated Template downloaded successfully.';
        statusEl.style.color = '#2e7d32';
    } catch (err) {
        console.error("Download Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

// ── API: Upload Corrected Translation ──
async function doUploadCorrectedTranslation() {
    const btn = document.getElementById('ul-corr-btn');
    const statusEl = document.getElementById('ul-corr-status');
    const errEl = document.getElementById('ul-corr-error');
    const ltype = localStorage.getItem(LS_LOGINTYPE);

    const fileType = document.getElementById('ul-corr-filetype').value.trim();
    const uploadedBy = document.getElementById('ul-corr-uploaded-by').value.trim();
    const nameStr = document.getElementById('ul-corr-name').value.trim();
    const fileInput = document.getElementById('ul-corr-file');

    const urlBase = (ltype === 'meta') ? webHostUrl : appHostUrl;

    if (!token || !urlBase) {
        handle401();
        return;
    }

    if (!fileInput.files.length) {
        errEl.textContent = 'Please select a corrected file to upload.';
        errEl.style.display = 'block';
        return;
    }
    if (!fileType || !uploadedBy || !nameStr) {
        errEl.textContent = 'Please fill out all required parameters.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    statusEl.textContent = 'Uploading corrected translation...';
    statusEl.style.color = '#e67e22';
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        const queryParams = new URLSearchParams({
            uploadedBy: uploadedBy,
            fileType: fileType,
            name: nameStr
        });

        const url = `${urlBase}/meta/api/language-translates/corrected-translation?${queryParams.toString()}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: formData
        });

        if (res.status === 401) { handle401(); return; }
        if (!res.ok) throw new Error(`API failed: ${res.status} ${res.statusText}`);

        const data = await res.json();
        console.log("Upload Corrected Translation API Response:", data);

        if (data.id || data.success || res.ok) {
            statusEl.innerHTML = `<strong>Upload successful!</strong> Corrected translation has been uploaded.`;
            statusEl.style.color = '#2e7d32';
        } else {
            statusEl.textContent = 'Upload completed but response format is unknown.';
            statusEl.style.color = '#f39c12';
        }
    } catch (err) {
        console.error("Upload Corrected Error:", err);
        statusEl.textContent = '';
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

