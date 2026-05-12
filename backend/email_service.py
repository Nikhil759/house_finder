"""
NestIQ Email Service — welcome email, digest builder, Resend helper,
PostHog server-side capture, and Resend webhook processing.
"""

import hashlib
import hmac
import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests as http

from email_tokens import (
    ACTION_CHANGE_FREQUENCY,
    ACTION_UNSUBSCRIBE_ALL,
    ACTION_UNSUBSCRIBE_TYPE,
    generate_token,
)

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

APP_URL = os.environ.get("APP_URL", "https://nestiq.homes")
API_URL = os.environ.get("API_URL", APP_URL)

FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "alerts@nestiq.homes")
REPLY_TO = os.environ.get("RESEND_REPLY_TO", "hello@nestiq.homes")

PHYSICAL_ADDRESS = (
    "NestIQ · IndiQube ETA, 3rd Floor, No. 38/4, "
    "Adjacent to Domlur Flyover, Bengaluru, Karnataka 560071, India"
)

FREQUENCY_LABELS = {
    "daily": "Everyday",
    "every_3_days": "Every 3 days",
    "every_5_days": "Every 5 days",
    "weekly": "Weekly",
}

SOURCE_BADGES = {
    "nobroker": ("NB", "#e63946", "#1e0a0c"),
    "housing": ("HC", "#7c3aed", "#120a1e"),
    "99acres": ("99", "#0076be", "#0a1520"),
    "reddit": ("Rd", "#ff4500", "#1e0e00"),
    "telegram": ("TG", "#229ed9", "#0a1a22"),
}

SOURCE_NAMES = {
    "nobroker": "NoBroker",
    "housing": "Housing.com",
    "99acres": "99acres",
    "reddit": "Reddit",
    "telegram": "Telegram",
}

# ── Resend send helper ───────────────────────────────────────────────────────


def _resend_send(to_email: str, subject: str, html: str) -> Tuple[bool, str]:
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return False, "RESEND_API_KEY not configured"

    import uuid
    unique_id = f"<{uuid.uuid4()}@nestiq.homes>"

    try:
        resp = http.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": f"NestIQ <{FROM_EMAIL}>",
                "to": [to_email],
                "reply_to": REPLY_TO,
                "subject": subject,
                "html": html,
                "headers": {
                    "X-Entity-Ref-ID": unique_id,
                },
            },
            timeout=15,
        )
        ok = resp.status_code in (200, 201)
        log.info("Resend response [%d]: %s", resp.status_code, resp.text[:500])
        return ok, resp.text
    except Exception as exc:
        return False, str(exc)


# ── PostHog server-side capture ──────────────────────────────────────────────


def posthog_capture(distinct_id: str, event: str, properties: Optional[dict] = None):
    """Fire a PostHog event from the server (best-effort, non-blocking)."""
    api_key = os.environ.get("POSTHOG_PROJECT_API_KEY", "")
    if not api_key:
        return
    try:
        http.post(
            "https://app.posthog.com/capture/",
            json={
                "api_key": api_key,
                "distinct_id": distinct_id,
                "event": event,
                "properties": properties or {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            timeout=5,
        )
    except Exception:
        pass


# ── Shared email style primitives ────────────────────────────────────────────

_STYLE = {
    "bg": "#0d0d14",
    "surface": "#0d0d1e",
    "border": "#1e1e2e",
    "text": "#e8e4d8",
    "muted": "#777",
    "amber": "#f5a623",
    "mono": "'DM Mono', Menlo, Consolas, monospace",
    "sans": "'DM Sans', Helvetica, Arial, sans-serif",
}


def _email_wrapper(body_html: str) -> str:
    unique_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:{_STYLE['bg']};color:{_STYLE['text']};">
<div style="max-width:600px;margin:0 auto;padding:32px 20px;font-family:{_STYLE['sans']};">
{body_html}
</div>
<div style="display:none;font-size:0;line-height:0;color:transparent;">{unique_id}</div>
</body></html>"""


def _footer_html(user_id: str, current_frequency: str = "daily", include_frequency_switchers: bool = False) -> str:
    """Build the shared email footer with unsubscribe and preferences links."""
    prefs_token = generate_token(user_id, ACTION_UNSUBSCRIBE_TYPE, "new_listings")
    prefs_url = f"{APP_URL}/preferences?token={prefs_token}"
    unsub_type_url = f"{API_URL}/api/email/action?token={generate_token(user_id, ACTION_UNSUBSCRIBE_TYPE, 'new_listings')}"
    unsub_all_url = f"{API_URL}/api/email/action?token={generate_token(user_id, ACTION_UNSUBSCRIBE_ALL)}"

    links = [
        f'<a href="{prefs_url}" style="color:{_STYLE["amber"]};text-decoration:underline;">Manage email preferences</a>',
        f'<a href="{unsub_type_url}" style="color:{_STYLE["muted"]};text-decoration:underline;">Unsubscribe from new listing emails</a>',
        f'<a href="{unsub_all_url}" style="color:{_STYLE["muted"]};text-decoration:underline;">Unsubscribe from all NestIQ emails</a>',
    ]

    links_html = f'<br style="line-height:24px;">'.join(links)

    return f"""
<div style="margin-top:40px;padding-top:24px;border-top:1px solid {_STYLE['border']};font-size:12px;line-height:1.8;color:{_STYLE['muted']};font-family:{_STYLE['mono']};">
  <p style="margin:0;">{links_html}</p>
</div>"""


# ── Welcome email ────────────────────────────────────────────────────────────


def build_welcome_html(user_id: str) -> str:
    prefs_token = generate_token(user_id, ACTION_UNSUBSCRIBE_TYPE, "new_listings")
    prefs_url = f"{APP_URL}/preferences?token={prefs_token}"

    body = f"""
<p style="color:{_STYLE['amber']};font-size:10px;letter-spacing:0.2em;margin:0 0 8px 0;font-family:{_STYLE['mono']};">
  NESTIQ
</p>
<h1 style="color:{_STYLE['text']};font-weight:400;font-size:24px;margin:0 0 24px 0;line-height:1.3;">
  Welcome to NestIQ
</h1>
<p style="font-size:15px;line-height:1.7;color:{_STYLE['text']};margin:0 0 16px 0;">
  NestIQ tracks new rental listings across NoBroker, Housing.com, 99acres,
  Telegram groups, and Reddit — then delivers them as a curated feed in your
  interest areas.
</p>
<p style="font-size:15px;line-height:1.7;color:{_STYLE['text']};margin:0 0 24px 0;">
  We'll send you a <strong>daily email</strong> with new listings in the localities
  you care about. You can switch to every 2 days, weekly, or unsubscribe anytime
  — no hoops.
</p>
<a href="{prefs_url}"
   style="display:inline-block;background:{_STYLE['amber']};color:#1a0a00;
          font-family:{_STYLE['mono']};font-size:13px;font-weight:600;
          letter-spacing:0.04em;text-decoration:none;padding:12px 28px;
          border-radius:6px;">
  Manage email preferences
</a>
<p style="margin:24px 0 0 0;">
  <a href="{APP_URL}" style="color:{_STYLE['amber']};font-size:13px;font-family:{_STYLE['mono']};text-decoration:none;">
    Go to NestIQ →
  </a>
</p>
{_footer_html(user_id, include_frequency_switchers=False)}"""

    return _email_wrapper(body)


def send_welcome_email(to_email: str, user_id: str) -> Tuple[bool, str]:
    html = build_welcome_html(user_id)
    return _resend_send(
        to_email,
        "Welcome to NestIQ \u2014 here\u2019s what to expect",
        html,
    )


# ── Digest email ─────────────────────────────────────────────────────────────


def _format_price(rent) -> str:
    if not rent:
        return ""
    try:
        n = int(rent)
    except (ValueError, TypeError):
        return ""
    if n >= 100_000:
        return f"\u20b9{n / 100_000:.1f}L"
    if n >= 1_000:
        return f"\u20b9{n / 1_000:.0f}k"
    return f"\u20b9{n}"


def _source_badge_html(source: str) -> str:
    abbr, fg, bg = SOURCE_BADGES.get(source, ("?", "#888", "#222"))
    return (
        f'<span style="display:inline-block;background:{bg};color:{fg};'
        f'font-size:9px;font-weight:700;font-family:{_STYLE["mono"]};'
        f'padding:2px 6px;border-radius:3px;letter-spacing:0.05em;'
        f'vertical-align:middle;margin-right:6px;">{abbr}</span>'
    )


def _listing_row_html(listing: dict) -> str:
    lid = listing.get("id", "")
    title = (listing.get("title") or "Untitled")[:90]
    if len(listing.get("title") or "") > 90:
        title += "\u2026"

    bhk = listing.get("bhk") or ""
    sqft = listing.get("sqft") or listing.get("area_sqft") or ""
    locality = listing.get("locality") or ""
    price = _format_price(listing.get("rent"))
    iq = listing.get("quality_score")
    source = listing.get("source") or ""
    source_url = listing.get("source_url") or ""

    detail_parts = [p for p in [bhk, f"{sqft} sqft" if sqft else "", locality] if p]
    detail_line = " · ".join(detail_parts)

    utm = "utm_source=email&utm_medium=digest&utm_campaign=new_listings"
    nestiq_url = f"{APP_URL}/listing/{lid}?{utm}&utm_content=listing_{lid}"

    iq_html = ""
    if iq:
        iq_html = (
            f'<span style="display:inline-block;background:#1a2a1a;color:{_STYLE["amber"]};'
            f'font-size:10px;font-family:{_STYLE["mono"]};font-weight:700;'
            f'padding:2px 7px;border-radius:3px;margin-left:6px;">'
            f'IQ {iq}</span>'
        )

    price_html = ""
    if price:
        price_html = (
            f'<span style="color:#6ee09a;font-size:13px;font-family:{_STYLE["mono"]};">'
            f'{price}</span>'
        )

    btn_style = (
        f'display:inline-block;font-family:{_STYLE["mono"]};font-size:11px;'
        f'font-weight:600;text-decoration:none;padding:6px 12px;border-radius:4px;'
        f'white-space:nowrap;'
    )

    source_btn_html = ""
    if source_url:
        source_label = SOURCE_NAMES.get(source, source.capitalize())
        _, src_fg, _ = SOURCE_BADGES.get(source, ("?", "#888", "#333"))
        source_btn_html = (
            f'<td style="padding-left:10px;">'
            f'<a href="{source_url}" style="{btn_style}'
            f'background:{src_fg};color:#fff;">'
            f'View on {source_label}</a></td>'
        )

    return f"""<tr>
  <td style="padding:14px 16px;border-bottom:1px solid {_STYLE['border']};">
    <div style="margin-bottom:6px;">
      {_source_badge_html(source)}
      <span style="color:{_STYLE['text']};font-size:14px;line-height:1.4;">{title}</span>
    </div>
    <div style="font-size:12px;color:{_STYLE['muted']};font-family:{_STYLE['mono']};margin-bottom:4px;">
      {detail_line}
    </div>
    <div style="margin-bottom:10px;">
      {price_html}{iq_html}
    </div>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td><a href="{nestiq_url}" style="{btn_style}background:{_STYLE['amber']};color:#1a0a00;">View on NestIQ</a></td>
      {source_btn_html}
    </tr></table>
  </td>
</tr>"""


def build_digest_subject(listings_by_locality: Dict[str, list]) -> str:
    """Dynamic subject: '[N] new listings in [Top Locality] and [M] others'."""
    total = sum(len(v) for v in listings_by_locality.values())
    localities = list(listings_by_locality.keys())
    if not localities:
        return f"{total} new listings on NestIQ"
    top = localities[0]
    if len(localities) == 1:
        return f"{total} new listing{'s' if total != 1 else ''} in {top}"
    others = len(localities) - 1
    return f"{total} new listing{'s' if total != 1 else ''} in {top} and {others} other{'s' if others != 1 else ''}"


def build_digest_html(
    user_id: str,
    listings_by_locality: Dict[str, list],
    total_available: int,
    current_frequency: str,
) -> str:
    """Build the New Listings Digest HTML email."""
    total_shown = sum(len(v) for v in listings_by_locality.values())
    subject_text = build_digest_subject(listings_by_locality)

    rows_html = ""
    for locality, listings in listings_by_locality.items():
        rows_html += f"""<tr>
  <td style="padding:12px 16px 4px;background:{_STYLE['surface']};border-bottom:1px solid {_STYLE['border']};">
    <p style="margin:0;font-family:{_STYLE['mono']};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:{_STYLE['amber']};">
      {locality}
    </p>
  </td>
</tr>"""
        for listing in listings:
            rows_html += _listing_row_html(listing)

    overflow_html = ""
    if total_available > total_shown:
        utm = "utm_source=email&utm_medium=digest&utm_campaign=new_listings"
        overflow_html = f"""
<p style="text-align:center;margin:20px 0 0 0;">
  <a href="{APP_URL}/new?{utm}"
     style="color:{_STYLE['amber']};font-family:{_STYLE['mono']};font-size:13px;text-decoration:none;">
    See all {total_available} new listings on NestIQ &rarr;
  </a>
</p>"""

    body = f"""
<p style="color:{_STYLE['amber']};font-size:10px;letter-spacing:0.2em;margin:0 0 8px 0;font-family:{_STYLE['mono']};">
  NESTIQ &middot; NEW LISTINGS
</p>
<h1 style="color:{_STYLE['text']};font-weight:400;font-size:22px;margin:0 0 24px 0;line-height:1.3;">
  {subject_text}
</h1>

<table width="100%" cellpadding="0" cellspacing="0"
  style="border-collapse:collapse;background:{_STYLE['surface']};border:1px solid {_STYLE['border']};border-radius:8px;overflow:hidden;">
  {rows_html}
</table>

{overflow_html}

{_footer_html(user_id, current_frequency=current_frequency)}"""

    return _email_wrapper(body)


def send_digest_email(
    to_email: str,
    user_id: str,
    listings_by_locality: Dict[str, list],
    total_available: int,
    current_frequency: str,
) -> Tuple[bool, str]:
    subject = build_digest_subject(listings_by_locality)
    html = build_digest_html(user_id, listings_by_locality, total_available, current_frequency)
    return _resend_send(to_email, subject, html)


# ── Resend webhook verification & processing ────────────────────────────────


def verify_resend_webhook(payload_bytes: bytes, signature: str) -> bool:
    """Verify the Resend webhook signature (svix-based HMAC)."""
    secret = os.environ.get("RESEND_WEBHOOK_SECRET", "")
    if not secret:
        log.warning("RESEND_WEBHOOK_SECRET not configured — skipping verification")
        return True  # fail-open in dev; tighten for production
    # Resend uses Svix: the secret is base64-encoded after a "whsec_" prefix
    import base64
    if secret.startswith("whsec_"):
        secret = secret[6:]
    try:
        key = base64.b64decode(secret)
    except Exception:
        log.error("Invalid RESEND_WEBHOOK_SECRET format")
        return False
    expected = hmac.new(key, payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── One-click action confirmation pages ──────────────────────────────────────


def action_success_html(message: str) -> str:
    body = f"""
<div style="text-align:center;padding:60px 20px;">
  <p style="color:{_STYLE['amber']};font-size:10px;letter-spacing:0.2em;margin:0 0 16px 0;font-family:{_STYLE['mono']};">
    NESTIQ
  </p>
  <h1 style="color:{_STYLE['text']};font-weight:400;font-size:22px;margin:0 0 16px 0;">
    {message}
  </h1>
  <p style="font-size:14px;color:{_STYLE['muted']};margin:0 0 24px 0;">
    This change has been applied immediately.
  </p>
  <a href="{APP_URL}/preferences"
     style="color:{_STYLE['amber']};font-family:{_STYLE['mono']};font-size:13px;text-decoration:none;">
    Manage email preferences &rarr;
  </a>
</div>"""
    return _email_wrapper(body)


def action_error_html(message: str) -> str:
    body = f"""
<div style="text-align:center;padding:60px 20px;">
  <p style="color:{_STYLE['amber']};font-size:10px;letter-spacing:0.2em;margin:0 0 16px 0;font-family:{_STYLE['mono']};">
    NESTIQ
  </p>
  <h1 style="color:{_STYLE['text']};font-weight:400;font-size:22px;margin:0 0 16px 0;">
    {message}
  </h1>
  <p style="font-size:14px;color:{_STYLE['muted']};margin:0 0 24px 0;">
    This link may have expired.  You can manage your preferences directly.
  </p>
  <a href="{APP_URL}/preferences"
     style="color:{_STYLE['amber']};font-family:{_STYLE['mono']};font-size:13px;text-decoration:none;">
    Go to email preferences &rarr;
  </a>
</div>"""
    return _email_wrapper(body)
