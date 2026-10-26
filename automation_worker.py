"""Worker runner for MegaPersonals Autonomous Automation Engine."""

import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent.resolve()
DATA_DIR = BASE_DIR / "data"

from automation_engine import AutonomousPipelineEngine, MicrosoftOAuthMailClient, log_step, update_state

def main():
    task_file = DATA_DIR / "automation_task.json"
    outlook_file = DATA_DIR / "outlook_config.json"

    task_cfg = {}
    if task_file.exists():
        try:
            with open(task_file, "r", encoding="utf-8") as f:
                task_cfg = json.load(f)
        except Exception as e:
            log_step(f"Error reading task config: {e}")

    outlook_cfg = {}
    if outlook_file.exists():
        try:
            with open(outlook_file, "r", encoding="utf-8") as f:
                outlook_cfg = json.load(f)
        except Exception as e:
            log_step(f"Error reading outlook config: {e}")

    # Merge configs
    flow_cfg = {
        "email": task_cfg.get("email") or outlook_cfg.get("email", "legendrobinsongews@outlook.com"),
        "password": task_cfg.get("password") or outlook_cfg.get("password", "Xbwbivcgya52300@"),
        "phone": task_cfg.get("phone", "2142513525"),
        "headline": task_cfg.get("headline", "Coffee first, then let's see where the night goes."),
        "body": task_cfg.get("body", "Always up for an adventurous road trip. Let's make a real plan."),
        "city": task_cfg.get("city", "Dallas"),
        "age": task_cfg.get("age", 26),
        "image_path": task_cfg.get("image_path", str(DATA_DIR / "default_post_image.jpg")),
        "reg_captcha": task_cfg.get("reg_captcha"),
        "post_captcha": task_cfg.get("post_captcha")
    }

    client_id = outlook_cfg.get("client_id", "9e5f94bc-e8a4-4e73-b8be-63364c29d753")
    refresh_token = outlook_cfg.get("refresh_token", "")
    mail_client = None

    if refresh_token:
        mail_client = MicrosoftOAuthMailClient(client_id=client_id, refresh_token=refresh_token, email=flow_cfg["email"])

    cdp_port = int(task_cfg.get("cdp_port") or 51793)
    cdp_url = f"http://127.0.0.1:{cdp_port}"
    log_step(f"Connecting to MoreLogin browser over CDP: {cdp_url}...")
    update_state({"browser_connected": False, "running": True, "cdp_port": cdp_port})

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.connect_over_cdp(cdp_url, timeout=12000)
            update_state({"browser_connected": True})
            ctx = browser.contexts[0]

            pages = [p for p in ctx.pages if "megapersonals" in p.url.lower() or "agesmart" in p.url.lower()]
            if pages:
                page = pages[0]
            else:
                page = ctx.new_page()
                page.goto("https://megapersonals.eu/users/register", timeout=30000)

            page.bring_to_front()
            log_step(f"Attached to page: {page.url}")

            engine = AutonomousPipelineEngine(page=page, config=flow_cfg, mail_client=mail_client)
            engine.run_autonomous_loop()

        except Exception as e:
            err_msg = str(e)
            log_step(f"❌ Automation encountered an error: {err_msg}")
            update_state({"running": False, "error": err_msg})

if __name__ == "__main__":
    main()
