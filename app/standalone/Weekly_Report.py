"""
Weekly Legacy Issues Report - SMFP (Services)

Queries Jira Cloud directly with the same JQL used by the
"Legacy issues - Service" dashboards (Overall + Last 4 weeks), builds an
Excel breakdown, and emails the summary to the configured recipients.

No Cropin login is required for this script (hide_auth = True in
app/script_configs.py) and no input file is required (requires_input = False).

Credentials (Jira API token + SMTP) are read from a local, git-ignored
config file: json_config/weekly_report_config.json — see
json_config/weekly_report_config.json.example for the expected format.
This keeps secrets out of the UI and out of source control, consistent
with how json_config/service_account.json / token.json are already
handled elsewhere in this app.

Inputs:
None required. This script ignores any uploaded input file.
"""

import base64
import json
import os
import smtplib
import datetime
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pandas as pd

CONFIG_PATH = os.path.join("json_config", "weekly_report_config.json")

JQL_OVERALL = (
    'project = "SMFP" and issuetype in (Bug) '
    'and status NOT IN (Closed, "Ready For Testing") '
    'and priority in (High, Highest) AND component = Services '
    'and created < -30d order by priority DESC, created DESC'
)

JQL_LAST_4_WEEKS = (
    'project = "SMFP" and issuetype in (Bug) '
    'and status NOT IN (Closed, "Ready For Testing") '
    'and priority in (High, Highest) AND component = Services '
    'and created >= -30d order by priority DESC, created DESC'
)

FIELDS = ["key", "summary", "priority", "status", "created", "assignee"]


def _load_report_config():
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(
            f"Missing {CONFIG_PATH}. Copy weekly_report_config.json.example to "
            "weekly_report_config.json in the same folder and fill in your "
            "Jira API token and SMTP credentials before running this script."
        )
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _jira_search(base_url, email, api_token, jql, log, max_results=100):
    auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    all_issues = []
    next_page_token = None
    import ssl
    context = ssl._create_unverified_context()
    
    while True:
        payload = {
            "jql": jql,
            "maxResults": max_results,
            "fields": FIELDS,
        }
        if next_page_token:
            payload["nextPageToken"] = next_page_token
            
        body = json.dumps(payload).encode()
        req = Request(
            f"{base_url}/rest/api/3/search/jql",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(req, context=context) as resp:
                data = json.loads(resp.read().decode())
        except HTTPError as e:
            raise Exception(f"Jira API error {e.code}: {e.read().decode()}")

        issues = data.get("issues", [])
        all_issues.extend(issues)
        log(f"   ...fetched {len(all_issues)} / {data.get('total', '?')} issues")

        next_page_token = data.get("nextPageToken")
        if not next_page_token or not issues:
            break

    return all_issues


def _issue_row(issue):
    f = issue["fields"]
    return {
        "Key": issue["key"],
        "Summary": f.get("summary", ""),
        "Priority": (f.get("priority") or {}).get("name", "?"),
        "Status": (f.get("status") or {}).get("name", "?"),
        "Created": (f.get("created") or "")[:10],
        "Assignee": (f.get("assignee") or {}).get("displayName", "Unassigned"),
    }


def _format_issue_line(issue):
    r = _issue_row(issue)
    return f"{r['Key']} — {r['Summary']} | Priority: {r['Priority']} | Status: {r['Status']} | Created: {r['Created']} | Assignee: {r['Assignee']}"


def _generate_graph(highest_count, high_count):
    import matplotlib
    matplotlib.use('agg')
    import matplotlib.pyplot as plt
    import io
    
    # Modern, clean styling for the graph
    plt.style.use('default')
    fig, ax = plt.subplots(figsize=(7, 3))
    fig.patch.set_facecolor('#ffffff')
    ax.set_facecolor('#ffffff')
    
    categories = ['Highest', 'High']
    counts = [highest_count, high_count]
    # Jira modern colors
    colors = ['#FF5630', '#FFAB00']
    
    # Draw bars, thin width for modern look
    bars = ax.bar(categories, counts, color=colors, width=0.4, edgecolor='none')
    
    # Remove all borders (spines)
    for spine in ax.spines.values():
        spine.set_visible(False)
        
    # Remove y-axis and ticks completely (since we show values on bars)
    ax.get_yaxis().set_visible(False)
    ax.tick_params(axis='x', which='both', bottom=False, top=False, labelsize=12, labelcolor='#42526E')
    
    # Add values on top of bars
    for bar in bars:
        yval = bar.get_height()
        if yval > 0:
            ax.text(bar.get_x() + bar.get_width()/2.0, yval + (max(counts) * 0.05), int(yval), 
                    va='bottom', ha='center', fontsize=12, fontweight='bold', color='#172B4D')
        
    plt.tight_layout()
    
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=150, bbox_inches='tight', transparent=True)
    plt.close()
    buf.seek(0)
    return buf.read()


def _build_email_body(base_url, overall_issues, recent_issues):
    overall_highest = sum(1 for i in overall_issues if i["fields"].get("priority", {}).get("name") == "Highest")
    overall_high = sum(1 for i in overall_issues if i["fields"].get("priority", {}).get("name") == "High")

    recent_highest = sum(1 for i in recent_issues if i["fields"].get("priority", {}).get("name") == "Highest")
    recent_high = sum(1 for i in recent_issues if i["fields"].get("priority", {}).get("name") == "High")

    overall_jql_encoded = urllib.parse.quote(JQL_OVERALL)
    recent_jql_encoded = urllib.parse.quote(JQL_LAST_4_WEEKS)

    overall_link = f"{base_url}/jira/software/c/projects/SMFP/issues/?filter=allissues&jql={overall_jql_encoded}"
    recent_link = f"{base_url}/jira/software/c/projects/SMFP/issues/?filter=allissues&jql={recent_jql_encoded}"
    
    overall_img_data = _generate_graph(overall_highest, overall_high)
    recent_img_data = _generate_graph(recent_highest, recent_high)

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #172B4D; background-color: #ffffff; margin: 0; padding: 10px; }}
            .container {{ width: 100%; max-width: 100%; margin: 0; background: #ffffff; border-radius: 8px; border: 1px solid #DFE1E6; overflow: hidden; }}
            .header {{ background-color: #0052CC; color: white; padding: 20px 30px; text-align: center; font-size: 18px; font-weight: bold; letter-spacing: 0.5px; }}
            .content {{ padding: 30px; }}
            .section {{ margin-bottom: 30px; border: 1px solid #DFE1E6; border-radius: 6px; padding: 20px; background: #FAFBFC; }}
            .section-title {{ font-size: 16px; font-weight: 600; color: #0052CC; margin-top: 0; margin-bottom: 15px; }}
            .btn {{ background-color: #0052CC; color: #ffffff !important; padding: 6px 14px; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 600; display: inline-block; }}
            .metrics {{ display: flex; gap: 20px; margin-bottom: 20px; }}
            .metric-box {{ flex: 1; background: #fff; border: 1px solid #DFE1E6; border-radius: 4px; padding: 10px; text-align: center; }}
            .metric-label {{ font-size: 12px; color: #6B778C; text-transform: uppercase; font-weight: 600; margin-bottom: 5px; }}
            .metric-value.highest {{ font-size: 24px; font-weight: bold; color: #FF5630; }}
            .metric-value.high {{ font-size: 24px; font-weight: bold; color: #FFAB00; }}
            .chart-container {{ text-align: center; background: #fff; border-radius: 4px; border: 1px solid #DFE1E6; padding: 15px 0; }}
            .chart-img {{ max-width: 100%; height: auto; }}
            .footer {{ border-top: 1px solid #DFE1E6; padding-top: 20px; color: #5E6C84; font-size: 13px; text-align: left; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                Weekly Legacy Issues Report (SMFP / Services)
            </div>
            <div class="content">
                <p style="margin-top: 0;">Hi Team,</p>
                <p>Please find the summary of open highest/high issues in Jira related to the service.</p>
                
                <!-- Overall Section -->
                <div class="section">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 15px;">
                        <tr>
                            <td align="left" style="font-size: 16px; font-weight: 600; color: #0052CC; margin: 0;">
                                Issues Older Than 30 Days
                            </td>
                            <td align="right">
                                <a href="{overall_link}" class="btn">View in Jira</a>
                            </td>
                        </tr>
                    </table>
                    
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px; margin-top: 15px;">
                        <tr>
                            <td width="48%" align="center" style="background: #fff; border: 1px solid #DFE1E6; border-radius: 4px; padding: 12px;">
                                <div class="metric-label">Highest</div>
                                <div class="metric-value highest">{overall_highest}</div>
                            </td>
                            <td width="4%"></td>
                            <td width="48%" align="center" style="background: #fff; border: 1px solid #DFE1E6; border-radius: 4px; padding: 12px;">
                                <div class="metric-label">High</div>
                                <div class="metric-value high">{overall_high}</div>
                            </td>
                        </tr>
                    </table>
                    
                    <div class="chart-container">
                        <img src="cid:overall_chart" alt="Overall Issues Trend" class="chart-img">
                    </div>
                </div>
                
                <!-- Recent Section -->
                <div class="section">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 15px;">
                        <tr>
                            <td align="left" style="font-size: 16px; font-weight: 600; color: #0052CC; margin: 0;">
                                Issues From Last 30 Days
                            </td>
                            <td align="right">
                                <a href="{recent_link}" class="btn">View in Jira</a>
                            </td>
                        </tr>
                    </table>
                    
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px; margin-top: 15px;">
                        <tr>
                            <td width="48%" align="center" style="background: #fff; border: 1px solid #DFE1E6; border-radius: 4px; padding: 12px;">
                                <div class="metric-label">Highest</div>
                                <div class="metric-value highest">{recent_highest}</div>
                            </td>
                            <td width="4%"></td>
                            <td width="48%" align="center" style="background: #fff; border: 1px solid #DFE1E6; border-radius: 4px; padding: 12px;">
                                <div class="metric-label">High</div>
                                <div class="metric-value high">{recent_high}</div>
                            </td>
                        </tr>
                    </table>
                    
                    <div class="chart-container">
                        <img src="cid:recent_chart" alt="Recent Issues Trend" class="chart-img">
                    </div>
                </div>

                <div class="footer">
                    Regards,<br><br>
                    <strong>Rajasekhar Palleti</strong><br>
                    QA Engineer | Cropin
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    return html, overall_img_data, recent_img_data


def _send_email(cfg, subject, body, overall_img_data, recent_img_data):
    from email.mime.image import MIMEImage
    
    smtp_host = cfg["smtp_host"]
    smtp_port = int(cfg["smtp_port"])
    smtp_user = cfg["smtp_user"]
    smtp_password = cfg["smtp_password"]
    mail_from = cfg.get("mail_from", smtp_user)
    mail_to = [addr.strip() for addr in cfg.get("mail_to", "").split(",") if addr.strip()]
    mail_cc = [addr.strip() for addr in cfg.get("mail_cc", "").split(",") if addr.strip()]

    msg = MIMEMultipart("related")
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = ", ".join(mail_to)
    if mail_cc:
        msg["Cc"] = ", ".join(mail_cc)

    msg_alt = MIMEMultipart("alternative")
    msg.attach(msg_alt)
    msg_alt.attach(MIMEText(body, "html"))

    if overall_img_data:
        img1 = MIMEImage(overall_img_data)
        img1.add_header('Content-ID', '<overall_chart>')
        msg.attach(img1)
        
    if recent_img_data:
        img2 = MIMEImage(recent_img_data)
        img2.add_header('Content-ID', '<recent_chart>')
        msg.attach(img2)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=120) as server:
        import ssl
        context = ssl._create_unverified_context()
        server.starttls(context=context)
        server.login(smtp_user, smtp_password)
        server.sendmail(mail_from, mail_to + mail_cc, msg.as_string())


def run(input_excel, output_excel, config, log_callback=None, action="send"):
    def log(msg):
        if log_callback:
            log_callback(msg)
        print(msg)

    log("Loading Jira/SMTP config from json_config/weekly_report_config.json...")
    cfg = _load_report_config()

    base_url = cfg["jira_base_url"].rstrip("/")
    jira_email = cfg["jira_email"]
    jira_api_token = cfg["jira_api_token"]

    CACHE_PATH = os.path.join("json_config", "weekly_report_cache.json")
    import time
    
    use_cache = False
    if action == "send" and os.path.exists(CACHE_PATH):
        if time.time() - os.path.getmtime(CACHE_PATH) < 1800: # 30 mins
            try:
                with open(CACHE_PATH, "r", encoding="utf-8") as f:
                    cache_data = json.load(f)
                    overall_issues = cache_data.get("overall_issues")
                    recent_issues = cache_data.get("recent_issues")
                    if overall_issues is not None and recent_issues is not None:
                        use_cache = True
                        log("Using cached Jira data from the recent Fetch...")
                        log(f"Found {len(overall_issues)} overall legacy issue(s).")
                        log(f"Found {len(recent_issues)} issue(s) from the last 4 weeks.")
            except Exception:
                pass

    if not use_cache:
        log("Querying Jira: OVERALL legacy issues (open > 30 days)...")
        overall_issues = _jira_search(base_url, jira_email, jira_api_token, JQL_OVERALL, log)
        log(f"Found {len(overall_issues)} overall legacy issue(s).")

        log("Querying Jira: issues opened in LAST 4 WEEKS...")
        recent_issues = _jira_search(base_url, jira_email, jira_api_token, JQL_LAST_4_WEEKS, log)
        log(f"Found {len(recent_issues)} issue(s) from the last 4 weeks.")
        
        try:
            with open(CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump({"overall_issues": overall_issues, "recent_issues": recent_issues}, f)
        except Exception as e:
            log(f"Warning: could not save cache: {e}")

    if action == "fetch":
        log("Data fetch complete. Please review the counts before sending the email.")
        return

    body, overall_img, recent_img = _build_email_body(base_url, overall_issues, recent_issues)
    today = datetime.date.today().strftime("%d %b %Y")
    subject = f"Weekly Legacy Issues Report — SMFP / Services — {today}"

    mail_to_str = cfg.get('mail_to', '')
    mail_cc_str = cfg.get('mail_cc', '')
    if mail_cc_str:
        log(f"Sending email to: {mail_to_str} (CC: {mail_cc_str})")
    else:
        log(f"Sending email to: {mail_to_str}")
        
    _send_email(cfg, subject, body, overall_img, recent_img)
    log("Email sent successfully.")
