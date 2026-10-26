"""Autonomous MegaPersonals & AgeSmart KYC Flow Engine.
Integrated into USA Phone Validator & Proxy Automation Platform.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from playwright.sync_api import Page, sync_playwright

LOGGER = logging.getLogger("automation_engine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BASE_DIR = Path(__file__).parent.resolve()
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATE_FILE = DATA_DIR / "automation_state.json"
CAPTCHA_IMG_FILE = DATA_DIR / "latest_captcha.png"
CAPTCHA_SOLUTION_FILE = DATA_DIR / "captcha_solution.json"


def update_state(state_dict: dict[str, Any]):
    """Write current state to JSON file for Web UI IPC."""
    try:
        current = {}
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    current = json.load(f)
            except Exception:
                current = {}

        current.update(state_dict)
        current["last_updated"] = time.time()
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        LOGGER.error("Failed to update state file: %s", e)


def log_step(msg: str):
    LOGGER.info(msg)
    try:
        current = {}
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    current = json.load(f)
            except Exception:
                pass
        logs = current.get("logs", [])
        timestamp = time.strftime("%H:%M:%S")
        logs.append(f"[{timestamp}] {msg}")
        if len(logs) > 60:
            logs = logs[-60:]
        current["logs"] = logs
        current["last_log"] = msg
        update_state(current)
    except Exception:
        pass


class MicrosoftOAuthMailClient:
    """Fetches OTP codes from Outlook via Microsoft Graph API using OAuth2 Refresh Token."""

    def __init__(self, client_id: str, refresh_token: str, email: str = ""):
        self.client_id = client_id or "9e5f94bc-e8a4-4e73-b8be-63364c29d753"
        self.refresh_token = refresh_token
        self.email = email
        self.access_token: Optional[str] = None
        self.token_expiry: float = 0.0

    def refresh_access_token(self) -> str:
        """Exchange refresh_token for a fresh access_token."""
        data = urllib.parse.urlencode({
            "client_id": self.client_id,
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            self.access_token = res["access_token"]
            self.token_expiry = time.time() + float(res.get("expires_in", 3600)) - 60
            if "refresh_token" in res:
                self.refresh_token = res["refresh_token"]
            return self.access_token

    def get_valid_token(self) -> str:
        if not self.access_token or time.time() >= self.token_expiry:
            return self.refresh_access_token()
        return self.access_token

    def fetch_latest_otp(self, timeout_s: float = 45.0, poll_interval_s: float = 3.0) -> Optional[str]:
        """Polls Inbox for a 4-digit MegaPersonals PIN."""
        deadline = time.time() + timeout_s
        log_step("Polling Microsoft Graph API for MegaPersonals 4-digit PIN code...")

        while time.time() < deadline:
            try:
                token = self.get_valid_token()
                url = "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,bodyPreview,body,receivedDateTime&$orderby=receivedDateTime%20desc"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    messages = data.get("value", [])

                    for msg in messages:
                        subject = msg.get("subject", "")
                        preview = msg.get("bodyPreview", "")
                        full_content = f"{subject} {preview}"

                        if any(k in full_content.lower() for k in ("megapersonals", "pin", "code", "verif")):
                            match = re.search(r"PIN\s*CODE[:\s]*(\d{4,6})", full_content, re.IGNORECASE)
                            if not match:
                                match = re.search(r"\b(\d{4})\b", full_content)
                            if match:
                                otp = match.group(1)
                                log_step(f"Found OTP Code from Graph API: {otp} (Subject: '{subject}')")
                                return otp

            except Exception as e:
                LOGGER.warning("Graph API polling notice: %s", e)

            time.sleep(poll_interval_s)

        return None


class AutonomousPipelineEngine:
    """Autonomous MegaPersonals Pipeline Manager with step detection and self-healing."""

    def __init__(self, page: Page, config: dict[str, Any], mail_client: Optional[MicrosoftOAuthMailClient] = None):
        self.page = page
        self.config = config
        self.mail_client = mail_client

    def detect_current_step(self) -> str:
        """Detect current workflow stage based on URL and DOM state."""
        url = self.page.url.lower()

        if "agesmart.eu" in url:
            if "/terms/" in url:
                return "agesmart_terms"
            if "/dob/" in url:
                return "agesmart_dob"
            return "agesmart_kyc"

        if "/direct-verification" in url:
            return "direct_verification"

        if "/pendingimages" in url:
            return "pending_images"

        if "/users/posts/create" in url:
            try:
                is_stage2 = self.page.evaluate("""() => {
                    const s2 = document.querySelector('#secondStage');
                    return s2 && s2.style.display !== 'none' && s2.style.display !== '';
                }""")
                return "post_stage2" if is_stage2 else "post_stage1"
            except Exception:
                return "post_stage1"

        if "/users/posters_agreement" in url:
            return "posters_agreement"

        if "/users/confirm_user" in url or "/users/receive_confirmation_email" in url:
            return "email_otp"

        if "/users/register" in url:
            return "registration"

        if "megapersonals.eu" in url:
            # Check if login or landing
            if "/users/auth/login" in url or "/home" in url:
                return "landing"

        return "unknown"

    def run_autonomous_loop(self):
        """Main loop: inspects state, runs current step, recovers on failure."""
        log_step("Starting Autonomous MegaPersonals Engine loop...")
        update_state({"running": True, "completed": False, "error": None})

        max_iterations = 40
        iteration = 0

        while iteration < max_iterations:
            iteration += 1
            step = self.detect_current_step()
            update_state({
                "step": step,
                "current_url": self.page.url
            })
            log_step(f"--> Detected Step: [{step}] (URL: {self.page.url})")

            if step == "landing":
                log_step("Navigating to Registration page...")
                self.page.goto("https://megapersonals.eu/users/register", timeout=30000)
                time.sleep(3)
                continue

            elif step == "registration":
                update_state({"progress_percent": 15})
                success = self.execute_registration_step()
                if not success:
                    log_step("Registration pending. Waiting or checking captcha...")
                    time.sleep(3)
                    continue

            elif step == "email_otp":
                update_state({"progress_percent": 35})
                success = self.execute_otp_step()
                if not success:
                    log_step("OTP step waiting. Retrying...")
                    time.sleep(3)
                    continue

            elif step == "posters_agreement":
                update_state({"progress_percent": 50})
                success = self.execute_posters_agreement_step()
                if not success:
                    time.sleep(2)
                    continue

            elif step == "post_stage1":
                update_state({"progress_percent": 65})
                success = self.execute_post_stage1_step()
                if not success:
                    time.sleep(2)
                    continue

            elif step == "post_stage2":
                update_state({"progress_percent": 80})
                success = self.execute_post_stage2_step()
                if not success:
                    time.sleep(2)
                    continue

            elif step in ("pending_images", "direct_verification"):
                update_state({"progress_percent": 90})
                self.execute_pending_images_and_handoff()

            elif step == "agesmart_terms":
                update_state({"progress_percent": 95})
                success = self.execute_agesmart_terms_step()
                if not success:
                    time.sleep(2)
                    continue

            elif step == "agesmart_dob":
                self.execute_agesmart_dob_step()

            elif step == "agesmart_kyc":
                update_state({
                    "progress_percent": 100,
                    "completed": True,
                    "running": False,
                    "agesmart_url": self.page.url
                })
                log_step(f"🎉 SUCCESS: Reached AgeSmart KYC Verification Screen! URL: {self.page.url}")
                break

            else:
                log_step(f"Settle pause (URL: {self.page.url}). Waiting...")
                time.sleep(3)

        if iteration >= max_iterations:
            update_state({"running": False, "error": "Maximum steps exceeded"})

    def await_captcha_solution(self, img_locator, step_name: str) -> str:
        """Saves captcha image to data folder and awaits UI or file input."""
        try:
            if CAPTCHA_SOLUTION_FILE.exists():
                CAPTCHA_SOLUTION_FILE.unlink()
        except Exception:
            pass

        img_locator.screenshot(path=str(CAPTCHA_IMG_FILE))
        log_step(f"[{step_name}] Captcha image saved. Awaiting solution...")
        update_state({
            "captcha_needed": True,
            "captcha_step": step_name,
            "captcha_timestamp": time.time()
        })

        # Wait up to 60 seconds for solution in file or config
        deadline = time.time() + 60
        while time.time() < deadline:
            # 1. Check file written by Web UI API
            if CAPTCHA_SOLUTION_FILE.exists():
                try:
                    with open(CAPTCHA_SOLUTION_FILE, "r", encoding="utf-8") as f:
                        sol = json.load(f)
                        code = sol.get("code", "").strip().upper()
                        if code:
                            log_step(f"[{step_name}] Received captcha solution: {code}")
                            update_state({"captcha_needed": False})
                            CAPTCHA_SOLUTION_FILE.unlink(missing_ok=True)
                            return code
                except Exception:
                    pass

            # 2. Check if config has pre-provided code
            preset = self.config.get(f"{step_name}_captcha")
            if preset:
                update_state({"captcha_needed": False})
                return preset.strip().upper()

            time.sleep(1)

        update_state({"captcha_needed": False})
        return ""

    def execute_registration_step(self) -> bool:
        log_step("[Step 1: Registration] Filling email, password, and agreement...")
        email = self.config.get("email") or "legendrobinsongews@outlook.com"
        pwd = self.config.get("password") or "Xbwbivcgya52300@"

        # Ensure strong password
        if not any(c.isupper() for c in pwd):
            pwd = pwd.capitalize()
        if not any(c in "@!#$%&*" for c in pwd):
            pwd = pwd + "@"

        self.page.locator("#person_email_field_signup").fill(email)
        self.page.locator("#person_password_field_signup").fill(pwd)
        self.page.locator("#person_confirmPassword_field_signup").fill(pwd)

        # Force age checkbox
        self.page.evaluate("""() => {
            const chk = document.querySelector('#checkage');
            if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
        }""")

        # Captcha handling
        img_loc = self.page.locator("#captcha_image_itself")
        if img_loc.count() > 0 and img_loc.is_visible():
            code = self.await_captcha_solution(img_loc, "reg")
            if code:
                self.page.locator("#captcha_code").fill(code)
                time.sleep(0.5)

            # Submit
            self.page.evaluate("document.querySelector('#sign_up_data_submit_button').click()")
            time.sleep(4)

        return "/users/confirm_user" in self.page.url.lower()

    def execute_otp_step(self) -> bool:
        log_step("[Step 2: Email OTP] Reading 4-digit PIN code from Outlook...")
        otp_code = None

        if self.mail_client:
            otp_code = self.mail_client.fetch_latest_otp(timeout_s=35.0)

        if not otp_code:
            # Check if preset in config or state
            otp_code = self.config.get("otp_code")

        if otp_code and len(otp_code) == 4 and otp_code.isdigit():
            log_step(f"[Step 2: Email OTP] Submitting PIN: {otp_code}")
            d1 = self.page.locator('input[name="digit1"]')
            d2 = self.page.locator('input[name="digit2"]')
            d3 = self.page.locator('input[name="digit3"]')
            d4 = self.page.locator('input[name="digit4"]')

            d1.fill(otp_code[0])
            d2.fill(otp_code[1])
            d3.fill(otp_code[2])
            d4.fill(otp_code[3])
            time.sleep(0.5)

            self.page.locator('button[type="submit"].btn-proceed').click()
            time.sleep(4)
            return "/users/posters_agreement" in self.page.url.lower()

        return False

    def execute_posters_agreement_step(self) -> bool:
        log_step("[Step 3: Poster's Agreement] Signing agreement...")
        self.page.evaluate("""() => {
            const containers = document.querySelectorAll('div, textarea, section');
            containers.forEach(c => {
                if (c.scrollHeight > c.clientHeight && c.clientHeight > 100) c.scrollTop = c.scrollHeight;
            });
            const chk = document.querySelector('#checkbox-agree');
            if (chk) {
                chk.disabled = false;
                chk.checked = true;
                chk.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const btn = document.querySelector('#postagree');
            if (btn) btn.disabled = false;
        }""")
        time.sleep(0.5)

        self.page.evaluate("document.querySelector('#postagree').click()")
        time.sleep(1.5)
        self.page.evaluate("""() => {
            const btn = document.querySelector('#postrequirementsagree');
            if (btn) btn.click();
        }""")
        time.sleep(4)
        return "/users/posts/create" in self.page.url.lower()

    def execute_post_stage1_step(self) -> bool:
        log_step("[Step 4: Post Creation - Stage 1] Filling details and bypassing phone limits...")
        phone = self.config.get("phone", "2142513525").replace("+1", "").replace(" ", "").replace("-", "")
        # Format as XXX-XXX-XXXX
        formatted_phone = f"{phone[:3]}-{phone[3:6]}-{phone[6:]}" if len(phone) == 10 else phone
        headline = self.config.get("headline", "Coffee first, then let's see where the night goes.")
        body = self.config.get("body", "Looking for someone with great banter, positive energy, and zero drama.")
        city = self.config.get("city", "Dallas")
        age_val = str(self.config.get("age", 26))

        self.page.evaluate(f"""() => {{
            // Dismiss alert if any
            document.querySelectorAll('button').forEach(b => {{
                if (b.innerText && b.innerText.trim() === 'OK') b.click();
            }});

            // I AM: Female (1)
            const iam = document.querySelector('#iam');
            if (iam) {{ iam.value = '1'; iam.dispatchEvent(new Event('change', {{ bubbles: true }})); }}

            // I SEE: MEN
            const menCb = document.querySelector('#iseeCategories_itemList input[data-val="MEN"]');
            if (menCb && !menCb.checked) menCb.click();

            // Age
            const age = document.querySelector('#age');
            if (age) {{ age.value = '{age_val}'; age.dispatchEvent(new Event('change', {{ bubbles: true }})); }}

            // Title & Body
            const title = document.querySelector('#title');
            if (title) {{
                title.value = {json.dumps(headline)};
                title.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}
            const body = document.querySelector('#body');
            if (body) {{
                body.value = {json.dumps(body)};
                body.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}

            // City
            const cityName = document.querySelector('#cityName');
            if (cityName) {{
                cityName.value = '{city}';
                cityName.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}

            // Phone number
            const phoneInp = document.querySelector('#phonenumber');
            if (phoneInp) {{
                phoneInp.value = '{formatted_phone}';
                phoneInp.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}

            // Crucial bypass
            window.checkIsExceededPhoneValidation = function() {{ return false; }};

            // Transition to secondStage
            const s1 = document.querySelector('#firstStage');
            const s2 = document.querySelector('#secondStage');
            if (s1) s1.style.display = 'none';
            if (s2) s2.style.display = 'block';
        }}""")
        time.sleep(2)
        return True

    def execute_post_stage2_step(self) -> bool:
        log_step("[Step 4: Post Creation - Stage 2] Uploading image and solving publish captcha...")
        # Check if image already uploaded
        img_uploaded = self.page.evaluate("""() => {
            const img = document.querySelector('img[src*="image-processor.apnot.com"], .preview-image');
            return !!img;
        }""")

        if not img_uploaded:
            img_file = Path(self.config.get("image_path") or DATA_DIR / "default_post_image.jpg").resolve()
            if img_file.exists():
                log_step(f"Uploading post image: {img_file.name}")
                file_input = self.page.locator('#input_image, input[name="file"], input[type="file"]')
                if file_input.count() > 0:
                    file_input.first.set_input_files(str(img_file))
                    time.sleep(4)

        # 2nd Captcha
        img_loc = self.page.locator("#captcha_image_itself")
        if img_loc.count() > 0 and img_loc.is_visible():
            code = self.await_captcha_solution(img_loc, "post")
            if code:
                self.page.locator("#captcha_code").fill(code)
                time.sleep(0.5)

            # Click Publish
            self.page.evaluate("document.querySelector('#input_send').click()")
            time.sleep(5)

        return True

    def execute_pending_images_and_handoff(self):
        log_step("[Step 5: Direct Verification] Waiting for AgeSmart KYC transition...")
        for _ in range(15):
            url = self.page.url.lower()
            if "agesmart.eu" in url:
                log_step(f"Successfully reached AgeSmart: {self.page.url}")
                update_state({"agesmart_url": self.page.url})
                return
            time.sleep(2)

    def execute_agesmart_terms_step(self) -> bool:
        log_step("[Step 6: AgeSmart Terms] Accepting terms...")
        self.page.evaluate("""() => {
            const boxes = document.querySelectorAll('div, textarea, section');
            boxes.forEach(b => { if (b.scrollHeight > b.clientHeight) b.scrollTop = b.scrollHeight; });
            const chk = document.querySelector('#agreeCheckbox');
            if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
            const btn = document.querySelector('button.btn-accept');
            if (btn) { btn.classList.remove('disabled'); btn.disabled = false; btn.click(); }
        }""")
        time.sleep(4)
        return "/dob/" in self.page.url.lower() or "/verification/" in self.page.url.lower()

    def execute_agesmart_dob_step(self):
        log_step("[Step 7: AgeSmart DOB] Submitting DOB...")
        dob = self.config.get("dob", "2000-05-15")
        self.page.evaluate(f"""() => {{
            const inp = document.querySelector("input[name='dateOfBirth'], #dateOfBirth, input[type='date']");
            if (inp) inp.value = '{dob}';
            const btn = document.querySelector("#btn-go-to-photo-id, button[type='submit']");
            if (btn) btn.click();
        }}""")
        time.sleep(3)
