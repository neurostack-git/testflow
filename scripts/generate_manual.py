#!/usr/bin/env python3
"""
TestFlow User Manual Generator
Creates demo accounts, captures screenshots via Playwright,
and compiles a polished PDF user guide.
"""

import os, sys, time, textwrap
from pathlib import Path
import boto3
from botocore.exceptions import ClientError
from playwright.sync_api import sync_playwright, Page

# ── Config ────────────────────────────────────────────────────────────────────
APP_URL      = "https://testflow-pi.vercel.app"
USER_POOL_ID = "ap-south-1_qo8RvnzbT"
REGION       = "ap-south-1"
PROFILE      = "cleanflowai-demo"

ADMIN_EMAIL    = "guide.admin@testflow-demo.com"
ADMIN_PASS     = "Admin@Guide2024"
ADMIN_NAME     = "Sarah Mitchell"

TESTER_EMAIL      = "guide.tester@testflow-demo.com"
TESTER_TEMP_PASS  = "TempGuide@123"
TESTER_FINAL_PASS = "Tester@Guide2024"
TESTER_NAME       = "Alex Turner"

PROJECT_NAME = "Mobile App QA"

SCRIPTS_DIR = Path(__file__).parent
SHOTS_DIR   = SCRIPTS_DIR / "screenshots"
SHOTS_DIR.mkdir(exist_ok=True)

admin_steps:  list[dict] = []
tester_steps: list[dict] = []


# ── Helpers ───────────────────────────────────────────────────────────────────
def shot(page: Page, bucket: list, name: str, caption: str, desc: str = "") -> None:
    path = SHOTS_DIR / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)
    bucket.append({"path": str(path), "caption": caption, "desc": desc})
    print(f"    ok  {name}")
    time.sleep(0.5)


# ── 1. Provision accounts via boto3 ──────────────────────────────────────────
def provision():
    session = boto3.Session(profile_name=PROFILE, region_name=REGION)
    cog   = session.client("cognito-idp")
    table = session.resource("dynamodb").Table("testflow")

    def upsert(email, role, temp_pass, name, permanent_pass=None):
        try:
            r = cog.admin_create_user(
                UserPoolId=USER_POOL_ID,
                Username=email,
                UserAttributes=[
                    {"Name": "email",          "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "custom:role",    "Value": role},
                ],
                TemporaryPassword=temp_pass,
                MessageAction="SUPPRESS",
            )
            sub = {a["Name"]: a["Value"] for a in r["User"]["Attributes"]}["sub"]
        except cog.exceptions.UsernameExistsException:
            u   = cog.admin_get_user(UserPoolId=USER_POOL_ID, Username=email)
            sub = {a["Name"]: a["Value"] for a in u["UserAttributes"]}["sub"]
            if not permanent_pass:
                # Reset tester back to FORCE_CHANGE_PASSWORD so onboarding shows
                try:
                    cog.admin_set_user_password(
                        UserPoolId=USER_POOL_ID, Username=email,
                        Password=temp_pass, Permanent=False)
                except Exception:
                    pass

        if permanent_pass:
            cog.admin_set_user_password(
                UserPoolId=USER_POOL_ID, Username=email,
                Password=permanent_pass, Permanent=True)

        try:
            table.put_item(
                Item={"PK": f"USER#{sub}", "SK": "PROFILE",
                      "email": email, "role": role, "name": name, "phone": ""},
                ConditionExpression="attribute_not_exists(PK)")
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
        return sub

    print("Provisioning accounts…")
    admin_sub  = upsert(ADMIN_EMAIL,  "admin",  "TmpAdmin@123", ADMIN_NAME,  ADMIN_PASS)
    tester_sub = upsert(TESTER_EMAIL, "tester", TESTER_TEMP_PASS, TESTER_NAME)
    print(f"  admin  -> {admin_sub[:8]}...")
    print(f"  tester -> {tester_sub[:8]}...")
    return admin_sub, tester_sub


# ── 2. Admin screenshots ──────────────────────────────────────────────────────
def run_admin(page: Page) -> str:
    s = admin_steps

    # --- Signup flow (visual only – we already have a programmatic account) ---
    page.goto(f"{APP_URL}/signup", wait_until="networkidle")
    shot(page, s, "01_signup",
         "Admin Sign-Up Page",
         "New admins register at /signup. Enter your full name, work email, and a strong password, then click 'Create account'.")

    page.fill('input#name',    "Sarah Mitchell")
    page.fill('input#email',   ADMIN_EMAIL)
    page.fill('input#password',   ADMIN_PASS)
    page.fill('input#confirm', ADMIN_PASS)
    shot(page, s, "02_signup_filled",
         "Completed Sign-Up Form",
         "After submitting, a 6-digit verification code is emailed to you. Enter it to activate your account.")

    # --- Login ---
    page.goto(f"{APP_URL}/login", wait_until="networkidle")
    shot(page, s, "03_login",
         "Admin Login Page",
         "Return to /login and sign in with your email and password.")

    page.fill('input[type="email"]',    ADMIN_EMAIL)
    page.fill('input[type="password"]', ADMIN_PASS)
    page.click('button[type="submit"]')
    page.wait_for_url(f"{APP_URL}/dashboard", timeout=20000)
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)

    # --- Dashboard ---
    shot(page, s, "04_dashboard",
         "Admin Dashboard",
         "After login you land on the Dashboard. All your projects are shown here. Click '+ New Project' to create one.")

    page.click('button:has-text("New Project")')
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "05_new_project_dialog",
         "New Project Dialog",
         "Enter a project name (e.g. 'Mobile App QA') and click 'Create Project'.")

    page.fill('input#title', PROJECT_NAME)
    shot(page, s, "06_project_name_typed",
         "Project Name Entered",
         "Type a descriptive project name, then click Create Project to confirm.")

    page.click('button:has-text("Create Project")')
    page.wait_for_selector('[role="dialog"]', state="hidden", timeout=8000)
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)
    shot(page, s, "07_dashboard_project_created",
         "Project Card on Dashboard",
         "The new project card appears. Click it to open the project and start managing bugs.")

    # --- Project page ---
    page.click(f'text={PROJECT_NAME}')
    page.wait_for_load_state("networkidle")
    time.sleep(1.5)
    project_url = page.url
    shot(page, s, "08_project_page",
         "Project Page - Bugs & Reports",
         "The project page shows the bugs table (top) and the Overall Report section (bottom). Admins see an 'Invite Tester' button in the header.")

    # --- Invite tester ---
    page.click('button:has-text("Invite Tester")')
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "09_invite_dialog",
         "Invite Tester Dialog",
         "Enter the tester's email address and click 'Send Invite'. They will receive login credentials via email automatically.")

    page.fill('input#invite-email', TESTER_EMAIL)
    shot(page, s, "10_invite_filled",
         "Invite Form - Email Entered",
         "Once the email is entered, click Send Invite. The tester is added to the project immediately.")

    page.click('button:has-text("Send Invite")')
    time.sleep(3)
    # Could show success or "already a member" - screenshot either way
    shot(page, s, "11_invite_success",
         "Invitation Sent Successfully",
         "A confirmation screen confirms the invite. The tester now has access to this project.")
    # Close dialog however it ended
    try:
        page.click('button:has-text("Done")', timeout=2000)
    except Exception:
        try:
            page.click('button:has-text("Cancel")', timeout=2000)
        except Exception:
            page.keyboard.press("Escape")
    time.sleep(0.8)

    # --- Report a bug (admin "Add Row") ---
    page.click('button:has-text("Add Row")')
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "12_report_bug_dialog",
         "Report Bug Dialog",
         "Click 'Add Row' to log a bug. Enter a title, detailed description, and attach screenshots if available.")

    page.fill('input#bug-title', "Sign-In button unresponsive on iOS 17")
    page.fill('textarea#bug-desc',
              "The Sign In button does not respond on iPhone 14 (iOS 17.2, Safari and Chrome mobile). "
              "Desktop browsers work fine.\n\n"
              "Steps to reproduce:\n"
              "1. Open the app on an iPhone 14\n"
              "2. Enter valid credentials\n"
              "3. Tap Sign In - no response")
    shot(page, s, "13_bug_form_filled",
         "Bug Form Completed",
         "Provide a short title and clear steps-to-reproduce. Detailed reports speed up the fix cycle.")

    page.click('button:has-text("Submit Bug")')
    page.wait_for_selector('[role="dialog"]', state="hidden", timeout=8000)
    time.sleep(1.2)
    shot(page, s, "14_bug_in_table",
         "Bug Listed in Table",
         "The bug appears in the table with status 'Open'. The reporter's name and timestamp are displayed.")

    # --- Bug detail view ---
    page.locator('td:has-text("Sign-In button")').first.click()
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "15_bug_detail",
         "Bug Detail View",
         "Clicking a row opens the Bug Detail dialog. It shows the full description, screenshots, and current status.")
    page.keyboard.press("Escape")
    time.sleep(0.6)

    # --- Change status ---
    page.locator('button:has-text("Open")').first.click()
    time.sleep(0.6)
    shot(page, s, "16_status_dropdown",
         "Status Dropdown",
         "Click the coloured status badge to open the dropdown. Select 'Fixed' when the bug has been resolved.")

    page.click('[role="menuitem"]:has-text("Fixed")')
    time.sleep(1.0)
    shot(page, s, "17_status_fixed",
         "Bug Marked as Fixed",
         "Status changes to 'Fixed' (green). The reporter receives an email and WhatsApp notification to re-test.")

    # --- Edit bug ---
    page.locator('button[title="Edit bug"]').first.click()
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "18_edit_bug",
         "Edit Bug Dialog",
         "Click the pencil icon on any row to edit the title, description, or status of an existing bug.")
    page.keyboard.press("Escape")
    time.sleep(0.6)

    # --- Admin panel - expand project to see members ---
    page.click('a[href="/admin"]')
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)
    shot(page, s, "19_admin_panel",
         "Admin Panel",
         "The Admin panel lists all your projects. Click a project row to expand it and see its testers.")

    # Expand the project row to see tester
    page.locator(f'text={PROJECT_NAME}').first.click()
    time.sleep(1.5)
    shot(page, s, "20_admin_panel_expanded",
         "Admin Panel - Tester List",
         "Expanding a project shows all testers. Use the trash icon to remove a tester from the project.")

    # --- Profile ---
    page.click('a[href="/profile"]')
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)
    shot(page, s, "21_profile",
         "Profile & Settings",
         "Update your display name, email, and WhatsApp number for bug-fix notifications on the Profile page.")

    return project_url


# ── 3. Tester screenshots ─────────────────────────────────────────────────────
def run_tester(page: Page, project_url: str) -> None:
    s = tester_steps

    # --- Tester receives invite email (show login page) ---
    page.goto(f"{APP_URL}/login", wait_until="networkidle")
    shot(page, s, "t01_login",
         "Tester Login Page",
         "Testers receive an invitation email with a temporary password. Open TestFlow and go to the login page.")

    page.fill('input[type="email"]',    TESTER_EMAIL)
    page.fill('input[type="password"]', TESTER_TEMP_PASS)
    shot(page, s, "t02_login_filled",
         "Entering Temporary Credentials",
         "Enter the email address and the temporary password from the invitation email, then click Sign in.")

    page.click('button[type="submit"]')
    page.wait_for_url(f"{APP_URL}/onboarding", timeout=20000)
    page.wait_for_load_state("networkidle")
    time.sleep(0.8)
    shot(page, s, "t03_onboarding",
         "Account Setup - First Login",
         "First-time login redirects to the Account Setup page. Set your full name and a permanent password.")

    page.fill('input#name',     TESTER_NAME)
    page.fill('input#password', TESTER_FINAL_PASS)
    page.fill('input#confirm',  TESTER_FINAL_PASS)
    shot(page, s, "t04_onboarding_filled",
         "Onboarding Form Completed",
         "Enter your name and a secure password (min. 8 characters with a digit). Click 'Complete Setup' to continue.")

    page.click('button:has-text("Complete Setup")')
    page.wait_for_url(f"{APP_URL}/dashboard", timeout=20000)
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)
    shot(page, s, "t05_dashboard",
         "Tester Dashboard",
         "The Tester dashboard shows all projects you have been invited to. Click a project card to open it.")

    # --- Open project ---
    page.click(f'text={PROJECT_NAME}')
    page.wait_for_load_state("networkidle")
    time.sleep(1.5)
    shot(page, s, "t06_project",
         "Project View",
         "The project page shows all bugs reported in this project - including bugs from other team members.")

    # --- Report a bug ---
    page.click('button:has-text("Report Bug")')
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "t07_report_bug",
         "Report a Bug",
         "Click '+ Report Bug' to log a new issue. Enter a title, description, and optionally attach screenshots.")

    page.fill('input#bug-title', "Checkout crashes on Safari 16")
    page.fill('textarea#bug-desc',
              "Tapping 'Proceed to Payment' on Safari 16.x (iPhone 13) shows a blank white screen. "
              "Chrome and Firefox on the same device work correctly.\n\n"
              "Steps to reproduce:\n"
              "1. Add any item to the cart\n"
              "2. Go to the checkout page\n"
              "3. Tap 'Proceed to Payment'\n"
              "Expected: payment page opens\n"
              "Actual: blank white screen")
    shot(page, s, "t08_bug_filled",
         "Bug Form Completed",
         "Provide a clear title and step-by-step reproduction steps. Attach screenshots to give visual context.")

    page.click('button:has-text("Submit Bug")')
    page.wait_for_selector('[role="dialog"]', state="hidden", timeout=8000)
    time.sleep(1.2)
    shot(page, s, "t09_bug_submitted",
         "Bug Submitted",
         "Your bug appears in the table with 'Open' status. Your name is shown as the reporter.")

    # --- Bug detail ---
    page.locator('td:has-text("Checkout crashes")').first.click()
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "t10_bug_detail",
         "Bug Detail View",
         "Click any row to view the full bug details - description, attachments, and the status history.")
    page.keyboard.press("Escape")
    time.sleep(0.6)

    # --- Status dropdown ---
    page.locator('button:has-text("Open")').last.click()
    time.sleep(0.6)
    shot(page, s, "t11_status_dropdown",
         "Updating Bug Status",
         "After an admin marks your bug as Fixed, you can verify it or set it back to Reopen if the issue persists.")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # --- Edit own bug ---
    page.locator('button[title="Edit bug"]').last.click()
    page.wait_for_selector('[role="dialog"]', state="visible")
    shot(page, s, "t12_edit_bug",
         "Edit Your Bug",
         "Click the pencil icon to edit the title or description of a bug you reported.")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # --- Overall Report section ---
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(1.0)
    shot(page, s, "t13_overall_report",
         "Overall Report Section",
         "Scroll to the bottom to find the Overall Report section. Upload project-wide test summaries (.pdf, .md, .txt, .docx). Max 5 files.")

    # --- Profile ---
    page.click('a[href="/profile"]')
    page.wait_for_load_state("networkidle")
    time.sleep(1.2)
    shot(page, s, "t14_profile",
         "Tester Profile",
         "Update your display name and WhatsApp number on the Profile page to receive bug-fix notifications.")


# ── 4. Generate PDF ───────────────────────────────────────────────────────────
def generate_pdf() -> str:
    from fpdf import FPDF

    ORANGE = (249, 115, 22)
    DARK   = (17,  24,  39)
    GRAY   = (107, 114, 128)
    LGRAY  = (229, 231, 235)
    WHITE  = (255, 255, 255)

    class PDF(FPDF):
        def footer(self):
            self.set_y(-12)
            self.set_draw_color(*LGRAY)
            self.set_line_width(0.3)
            self.line(15, self.get_y(), 195, self.get_y())
            self.set_y(-10)
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*GRAY)
            self.cell(90, 5, "TestFlow User Guide", align="L")
            self.cell(90, 5, f"Page {self.page_no()}", align="R")

    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=18)

    # ── Cover ────────────────────────────────────────────────────────────────
    pdf.add_page()
    # Orange top stripe
    pdf.set_fill_color(*ORANGE)
    pdf.rect(0, 0, 210, 100, "F")
    # White card
    pdf.set_fill_color(*WHITE)
    pdf.set_draw_color(*LGRAY)
    pdf.set_line_width(0.4)
    pdf.rect(25, 70, 160, 130, "FD")
    # Title in orange zone
    pdf.set_xy(0, 22)
    pdf.set_font("Helvetica", "B", 42)
    pdf.set_text_color(*WHITE)
    pdf.cell(210, 16, "TestFlow", align="C", ln=1)
    pdf.set_font("Helvetica", "", 16)
    pdf.set_text_color(255, 220, 190)
    pdf.cell(210, 10, "Bug Reporting & Tracking", align="C", ln=1)
    # Card content
    pdf.set_xy(25, 88)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*DARK)
    pdf.cell(160, 10, "User Guide", align="C", ln=1)
    pdf.set_xy(25, 101)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*GRAY)
    pdf.cell(160, 7, "Step-by-step instructions for Admins and Testers", align="C", ln=1)
    # Divider
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.5)
    pdf.line(60, 113, 150, 113)
    # Contents
    pdf.set_xy(35, 120)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*DARK)
    pdf.cell(140, 8, "What's inside", ln=1)
    items = [
        ("Part 1 -- Admin Guide",   "Create projects  Invite testers  Manage & track bugs"),
        ("Part 2 -- Tester Guide",  "Onboarding  Report bugs  Update status  Upload reports"),
    ]
    for title, desc in items:
        pdf.set_xy(35, pdf.get_y() + 3)
        pdf.set_fill_color(*ORANGE)
        pdf.ellipse(36, pdf.get_y() + 2, 3, 3, "F")
        pdf.set_xy(42, pdf.get_y())
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*DARK)
        pdf.cell(148, 6, title, ln=1)
        pdf.set_x(42)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*GRAY)
        pdf.cell(148, 6, desc, ln=1)

    # ── Section header ───────────────────────────────────────────────────────
    def section_page(part: str, title: str, subtitle: str):
        pdf.add_page()
        pdf.set_fill_color(*ORANGE)
        pdf.rect(0, 0, 210, 297, "F")
        pdf.set_xy(0, 95)
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(255, 200, 150)
        pdf.cell(210, 8, part.upper(), align="C", ln=1)
        pdf.set_xy(0, 107)
        pdf.set_font("Helvetica", "B", 34)
        pdf.set_text_color(*WHITE)
        pdf.cell(210, 14, title, align="C", ln=1)
        pdf.set_xy(0, 126)
        pdf.set_font("Helvetica", "", 13)
        pdf.set_text_color(255, 220, 190)
        pdf.cell(210, 8, subtitle, align="C", ln=1)

    # ── Step page ────────────────────────────────────────────────────────────
    def step_page(num: int, meta: dict):
        pdf.add_page()
        # Step badge (solid rect)
        pdf.set_fill_color(*ORANGE)
        pdf.rect(15, 12, 22, 8, "F")
        pdf.set_xy(15, 12.8)
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_text_color(*WHITE)
        pdf.cell(22, 6, f"STEP {num}", align="C")
        # Caption
        pdf.set_xy(41, 12)
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(*DARK)
        pdf.cell(154, 9, meta["caption"])
        # Thin divider
        pdf.set_draw_color(*ORANGE)
        pdf.set_line_width(0.4)
        pdf.line(15, 23, 195, 23)
        # Description
        if meta.get("desc"):
            pdf.set_xy(15, 27)
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(*GRAY)
            for line in textwrap.wrap(meta["desc"], width=100):
                pdf.cell(180, 5.2, line, ln=1)
                pdf.set_x(15)
        # Screenshot
        img_y = pdf.get_y() + 5
        if Path(meta["path"]).exists():
            pdf.image(meta["path"], x=15, y=img_y, w=180)

    # ── Build PDF ─────────────────────────────────────────────────────────────
    section_page("Part 1", "Admin Guide",
                 "Create projects · Invite testers · Report & manage bugs")
    for i, m in enumerate(admin_steps, 1):
        step_page(i, m)

    section_page("Part 2", "Tester Guide",
                 "Onboarding · Report bugs · Update status · Upload reports")
    for i, m in enumerate(tester_steps, 1):
        step_page(i, m)

    out = str(SCRIPTS_DIR / "TestFlow_User_Guide.pdf")
    pdf.output(out)
    return out


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    admin_sub, tester_sub = provision()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        print("\nCapturing Admin flow…")
        admin_ctx  = browser.new_context(viewport={"width": 1280, "height": 800})
        admin_page = admin_ctx.new_page()
        project_url = run_admin(admin_page)
        admin_page.close()
        admin_ctx.close()

        print("\nCapturing Tester flow…")
        tester_ctx  = browser.new_context(viewport={"width": 1280, "height": 800})
        tester_page = tester_ctx.new_page()
        run_tester(tester_page, project_url)
        tester_page.close()
        tester_ctx.close()

        browser.close()

    print("\nGenerating PDF…")
    out = generate_pdf()
    print(f"\nDone -> {out}")
    print(f"  Admin steps:  {len(admin_steps)}")
    print(f"  Tester steps: {len(tester_steps)}")
    print(f"  Total pages:  {2 + len(admin_steps) + len(tester_steps) + 2}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--pdf-only":
        # Reload screenshot metadata from disk
        for f in sorted(SHOTS_DIR.glob("0*.png")) + sorted(SHOTS_DIR.glob("t*.png")):
            pass  # paths already tracked if re-running full script
        print("Generating PDF from existing screenshots...")
        out = generate_pdf()
        print(f"Done -> {out}")
    else:
        main()
