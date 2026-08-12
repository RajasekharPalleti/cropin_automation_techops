/**
 * weekly_report.js
 * Handles UI interactions for the standalone Weekly Report modal.
 */

document.addEventListener('DOMContentLoaded', () => {
    const navBtn = document.getElementById('weekly-report-nav-btn');
    const modal = document.getElementById('weekly-report-modal');
    const closeBtn = document.getElementById('weekly-report-close');
    const runBtn = document.getElementById('weekly-report-run-btn');
    const consoleArea = document.getElementById('weekly-report-console');
    const statusDiv = document.getElementById('weekly-report-status');

    function log(message, type = 'info') {
        const line = document.createElement('div');
        line.textContent = `> ${message}`;
        if (type === 'error') line.style.color = '#ff4444';
        else if (type === 'success') line.style.color = '#00C851';
        consoleArea.appendChild(line);
        consoleArea.scrollTop = consoleArea.scrollHeight;
    }

    if (navBtn) {
        navBtn.addEventListener('click', () => {
            if (modal) modal.style.display = 'block';
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (modal) modal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    if (runBtn) {
        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            runBtn.innerHTML = '<span class="material-icons" style="font-size:1.1rem;">hourglass_empty</span> Running...';
            consoleArea.innerHTML = ''; // clear logs
            statusDiv.style.display = 'none';
            statusDiv.className = 'alert-info';
            
            log('Starting Weekly Report execution...');

            try {
                const response = await fetch('/api/weekly-report/run', {
                    method: 'POST'
                });
                
                // We will read the stream
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let result = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    result += chunk;
                    
                    // Parse chunk as lines
                    const lines = chunk.split('\n');
                    lines.forEach(l => {
                        if (l.trim()) log(l.trim());
                    });
                }
                
                if (response.ok) {
                    log('Execution completed successfully!', 'success');
                    statusDiv.textContent = 'Report generated and emailed successfully.';
                    statusDiv.style.color = '#00C851';
                    statusDiv.style.display = 'block';
                } else {
                    throw new Error(result || response.statusText);
                }

            } catch (err) {
                console.error(err);
                log(`Error: ${err.message}`, 'error');
                statusDiv.textContent = 'Failed to generate report. Check logs.';
                statusDiv.style.color = '#ff4444';
                statusDiv.style.display = 'block';
            } finally {
                runBtn.disabled = false;
                runBtn.innerHTML = '<span class="material-icons" style="font-size:1.1rem;">play_arrow</span> Run Report Now';
            }
        });
    }
});
