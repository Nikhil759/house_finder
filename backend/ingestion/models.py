"""
StandardListing — the unified data contract for all sources.

Every ingestion script (Reddit, Telegram, NoBroker, Housing.com) must
produce StandardListing instances.  Pydantic validates at ingestion time
so malformed data never reaches the database.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class StandardListing(BaseModel):
    """Canonical listing shape written to the `listings` table."""

    # ── Identity ──
    source: str = Field(..., pattern=r"^(reddit|telegram|nobroker|housing|99acres|zolo|colive)$")
    source_id: str
    source_url: Optional[str] = None
    source_group: Optional[str] = None

    # ── Core listing ──
    title: Optional[str] = None
    body: Optional[str] = None
    bhk: Optional[str] = None
    property_type: Optional[str] = None
    furnishing: Optional[str] = None

    # ── Pricing (always integer ₹) ──
    rent: Optional[int] = None
    deposit: Optional[int] = None
    maintenance: Optional[int] = None

    # ── Location ──
    locality: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    maps_url: Optional[str] = None

    # ── Property details ──
    area_sqft: Optional[int] = None
    floor_info: Optional[str] = None
    amenities: list[str] = Field(default_factory=list)
    lease_type: Optional[str] = None

    # ── Contact ──
    contact_phone: Optional[str] = None
    contact_name: Optional[str] = None
    is_broker: bool = False
    no_brokerage: bool = False

    # ── Flags ──
    is_flatmate: bool = False
    is_sponsored: bool = False

    # ── Listing type (full_house | pg | flatmate | not_a_listing) ──
    listing_type: str = "full_house"
    # type_attributes JSONB — PG-specific keys include:
    #   occupancy: 'single' | 'double' | 'triple' | 'quad' | 'couple'
    #   gender_pref: 'male' | 'female' | 'co-ed'
    #   meals_included, attached_bathroom: bool
    #   (plus source-specific keys — see ingest_zolo.py, ingest_colive.py)
    type_attributes: dict = Field(default_factory=dict)

    # ── Media ──
    thumbnail_url: Optional[str] = None
    image_urls: list[str] = Field(default_factory=list)

    # ── Enriched ──
    society_name: Optional[str] = None

    # ── Timestamps ──
    posted_at: Optional[datetime] = None
    scraped_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # ── Scoring ──
    quality_score: int = 0

    # ── Raw data (original API response for reprocessing) ──
    raw_payload: Optional[dict] = None

    # ── Validators ──

    @field_validator("rent", "deposit", "maintenance", mode="before")
    @classmethod
    def coerce_price(cls, v):
        """Accept string prices like '₹25,000' and convert to int."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return int(v) if v > 0 else None
        if isinstance(v, str):
            import re
            nums = re.sub(r"[^\d]", "", v)
            return int(nums) if nums else None
        return None

    @field_validator("rent", mode="after")
    @classmethod
    def sanitize_rent(cls, v):
        """
        Tiered anomaly detection for Bangalore rental prices.

        Tiers:
          < 2,000              → garbage (test listings, data errors) → null
          2,000 – 7,999        → suspicious but possible (PG/hostel) → keep
          8,000 – 149,999      → normal range → keep
          150,000 – 1,799,999  → likely annual quote → divide by 12 if result in range
          >= 1,800,000         → clearly garbage → null
        """
        if v is None:
            return None

        # Garbage floor
        if v < 2000:
            return None

        # Normal Bangalore rent range
        if v <= 149_999:
            return v

        # Possible annual quote: 1.5L–18L range
        if 150_000 <= v <= 1_799_999:
            monthly = v // 12
            if 8_000 <= monthly <= 149_999:
                return monthly
            return None

        # > 18L — clearly garbage
        return None

    @field_validator("deposit", mode="after")
    @classmethod
    def sanitize_deposit(cls, v):
        """
        Deposits in Bangalore are typically 2–10 months rent (₹16k–₹10L).
        Discard anything that looks like garbage.
        """
        if v is None:
            return None
        if v < 1000:
            return None
        if v > 5_000_000:
            return None
        return v

    @field_validator("area_sqft", mode="before")
    @classmethod
    def coerce_area(cls, v):
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return int(v) if v > 0 else None
        return None

    @field_validator("posted_at", mode="before")
    @classmethod
    def coerce_posted_at(cls, v):
        """Accept Unix timestamps (int/float) or ISO strings."""
        if v is None:
            return None
        if isinstance(v, datetime):
            return v
        if isinstance(v, (int, float)):
            if v > 1e12:
                v = v / 1000
            return datetime.fromtimestamp(v, tz=timezone.utc)
        if isinstance(v, str):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        return None

    @field_validator("bhk", mode="before")
    @classmethod
    def normalize_bhk(cls, v):
        """Normalize BHK strings to a consistent format."""
        if not v:
            return None
        import re
        v = str(v).strip()
        m = re.search(r"(\d)\s*BHK", v, re.IGNORECASE)
        if m:
            return f"{m.group(1)} BHK"
        if re.search(r"studio|1\s*rk", v, re.IGNORECASE):
            return "Studio/1RK"
        return v

    @field_validator("furnishing", mode="before")
    @classmethod
    def normalize_furnishing(cls, v):
        """Normalize furnishing to one of three canonical values."""
        if not v:
            return None
        v_lower = str(v).strip().lower().replace("-", " ").replace("_", " ")
        if "fully" in v_lower and "furnished" in v_lower:
            return "Fully Furnished"
        if "semi" in v_lower and "furnished" in v_lower:
            return "Semi Furnished"
        if "unfurnished" in v_lower:
            return "Unfurnished"
        return str(v).strip()

    @field_validator("body", mode="before")
    @classmethod
    def truncate_body(cls, v):
        if isinstance(v, str) and len(v) > 5000:
            return v[:5000]
        return v
