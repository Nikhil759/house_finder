"""
Signed URL tokens for one-click email actions (unsubscribe, frequency change).

Uses itsdangerous (Flask transitive dependency) so recipients can act on
emails without needing to log in.  Tokens are HMAC-signed with a dedicated
secret and expire after 30 days.
"""

import os
from typing import Optional

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

_MAX_AGE = 30 * 24 * 60 * 60  # 30 days in seconds

ACTION_UNSUBSCRIBE_TYPE = "unsubscribe_type"
ACTION_UNSUBSCRIBE_ALL = "unsubscribe_all"
ACTION_CHANGE_FREQUENCY = "change_frequency"

VALID_ACTIONS = {ACTION_UNSUBSCRIBE_TYPE, ACTION_UNSUBSCRIBE_ALL, ACTION_CHANGE_FREQUENCY}


def _get_serializer() -> URLSafeTimedSerializer:
    secret = os.environ.get("EMAIL_ACTION_SECRET", "")
    if not secret:
        raise RuntimeError("EMAIL_ACTION_SECRET env var is not set")
    return URLSafeTimedSerializer(secret, salt="nestiq-email-actions")


def generate_token(user_id: str, action: str, value: str = "") -> str:
    """Create a signed token encoding an email action.

    Parameters
    ----------
    user_id : str
        UUID of the target user.
    action : str
        One of ACTION_UNSUBSCRIBE_TYPE, ACTION_UNSUBSCRIBE_ALL, ACTION_CHANGE_FREQUENCY.
    value : str
        Extra payload — e.g. the new frequency for ACTION_CHANGE_FREQUENCY,
        or the email type for ACTION_UNSUBSCRIBE_TYPE.
    """
    if action not in VALID_ACTIONS:
        raise ValueError(f"Unknown action: {action}")
    return _get_serializer().dumps({"uid": user_id, "act": action, "val": value})


def verify_token(token: str) -> Optional[dict]:
    """Decode and verify a token.  Returns the payload dict or None on failure.

    Payload keys: ``uid``, ``act``, ``val``.
    """
    try:
        data = _get_serializer().loads(token, max_age=_MAX_AGE)
        if data.get("act") not in VALID_ACTIONS:
            return None
        return data
    except (BadSignature, SignatureExpired):
        return None
