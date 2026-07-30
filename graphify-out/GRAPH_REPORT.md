# Graph Report - .  (2026-07-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1550 nodes · 3332 edges · 102 communities (90 shown, 12 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `97191186`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- email_service.py
- ingest_99acres.py
- route
- app.py
- reva_tweet_common.py
- localities.py
- App.jsx
- Search.jsx
- dependencies
- Landing.jsx
- flag_store.py
- run_post_ingest_transforms
- listing_store.py
- tag_locality_feed.py
- HealthPage.jsx
- MyHub.jsx
- record_transform_end
- slow_path.py
- get_connection
- ingestion/ingest_reddit.py
- LocalityGuide.jsx
- ingest_stanza.py
- get_connection
- posthog.js
- enrich_society_images.py
- ingest_telegram.py
- replica_queries.py
- Navbar.jsx
- LocalityDetail.jsx
- StandardListing
- scrape_reddit_discussions.py
- ListingDetail.jsx
- PulseLocality.jsx
- useAuth
- NewForYou.jsx
- housing.py
- classify_listing_type.py
- upsert_listings_batch
- DesktopSidebar.jsx
- listing_extractor.py
- useNewListings
- enrich_locality_images.py
- test_replica_vs_supabase.py
- sync_to_sqlite.py
- run_dedup.py
- pulse_transforms.py
- view_store.py
- main.jsx
- RenterReports.jsx
- Profile.jsx
- Pulse.jsx
- scrape_google_news_rss.py
- fast_path.py
- UpsertStats
- Societies.jsx
- enrich_societies_from_places.py
- extract_nobroker_payload.py
- scripts/ingest_reddit.py
- trigger_sync_after_completion
- rank_pulse_feed
- useListingFlags.js
- AnalyticsDashboard.jsx
- locality_matcher.py
- manifest.json
- get_recent_sync_runs
- useSearchLogs.js
- enrich_geocode_reddit.py
- enrich_geocode_telegram.py
- scoring.py
- extract_housing_society.py
- generate_icons.py
- stats
- _json_loads_safe
- useSavedListings
- backfill_housing_coords.py
- link_listings_to_societies.py
- PostHogRouteTracker.jsx
- audit_housing_payload.py
- migrate_image_urls_to_images_json.py
- seed_gurgaon_societies.py
- log_listing_view
- _Cursor
- verify_token
- normalize_localities.py
- _handle_unhandled_exception
- run_all.py
- run_pulse_cron.sh
- run_pulse_railway_cron.sh
- run_reddit_cron.sh
- run_reddit_discussions_cron.sh
- generate_session.py
- frontend/vercel.json
- run_ingestion.sh
- setup_cron.sh
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `StandardListing` - 41 edges
2. `get_connection()` - 39 edges
3. `trigger_sync_after_completion()` - 34 edges
4. `useAuth()` - 31 edges
5. `UpsertStats` - 30 edges
6. `record_run_end()` - 29 edges
7. `record_run_start()` - 27 edges
8. `extract_locality()` - 27 edges
9. `useDesktop()` - 24 edges
10. `record_transform_end()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `run_ingestion()` --calls--> `init_listings_table()`  [INFERRED]
  scripts/ingest_reddit.py → backend/listing_store.py
- `run_ingestion()` --calls--> `upsert_listings_batch()`  [INFERRED]
  scripts/ingest_reddit.py → backend/listing_store.py
- `normalize_reddit_post()` --calls--> `extract_locality()`  [INFERRED]
  scripts/ingest_reddit.py → backend/localities.py
- `run_backfill()` --calls--> `StandardListing`  [EXTRACTED]
  scripts/backfill_listing_type.py → backend/ingestion/models.py
- `build_email_html()` --calls--> `_extract_price()`  [INFERRED]
  backend/app.py → backend/ingestion/ingest_reddit.py

## Import Cycles
- None detected.

## Communities (102 total, 12 thin omitted)

### Community 0 - "email_service.py"
Cohesion: 0.06
Nodes (54): _get_conn(), One-time backfill: subscribe existing users and send launch announcement.…, Send the launch announcement to a specific email without touching the DB., run(), test_email(), _apply_keywords_filter(), _collect_digest_listings(), _count_new_listings_for_searches() (+46 more)

### Community 1 - "ingest_99acres.py"
Cohesion: 0.07
Nodes (48): _build_pg_url(), _build_session(), _build_url(), _enrich_pg_from_detail(), _extract_source_id(), _extract_type_attributes(), fetch_page(), fetch_pg_page() (+40 more)

### Community 2 - "route"
Cohesion: 0.09
Nodes (47): bangalore_rent_trend(), _Conn, email_action(), email_init_subscription(), email_preferences_get(), email_preferences_put(), _get_pg_conn(), get_societies() (+39 more)

### Community 3 - "app.py"
Cohesion: 0.06
Nodes (42): after_request, build_email_html(), _build_pullpush_query(), build_query(), check_alerts(), create_alert(), delete_alert(), _extract_bhk() (+34 more)

### Community 4 - "reva_tweet_common.py"
Cohesion: 0.10
Nodes (43): get_db_connection(), main(), post_tweet(), Reva Pulse Tweet — posts one tweet per cron run. Cron schedule (Railway):…, _app_url(), build_anti_repetition_block(), build_prompt(), compose_tweet_with_link() (+35 more)

### Community 5 - "localities.py"
Cohesion: 0.06
Nodes (43): _attach_flag_summaries(), _attach_view_summaries(), extract_contact(), extract_price(), extract_telegram_title(), fetch_telegram(), fetch_telegram_async(), is_relevant() (+35 more)

### Community 6 - "App.jsx"
Cohesion: 0.08
Nodes (27): App(), BANGALORE_AREAS, _BK_BROKER, _BK_LOCALITIES, _BK_SPAM, BUDGET_STOPS, BudgetSlider(), buildScoreBreakdown() (+19 more)

### Community 7 - "Search.jsx"
Cohesion: 0.06
Nodes (22): BHK_OPTIONS, CATEGORY_TABS, DEFAULT_FILTERS, formatPrice(), FURNISHED_OPTIONS, GridCard(), idHash(), KNOWN_SOURCES (+14 more)

### Community 8 - "dependencies"
Cohesion: 0.06
Nodes (35): @fortawesome/fontawesome-svg-core, @fortawesome/free-solid-svg-icons, @fortawesome/react-fontawesome, framer-motion, dependencies, @fortawesome/fontawesome-svg-core, @fortawesome/free-solid-svg-icons, @fortawesome/react-fontawesome (+27 more)

### Community 9 - "Landing.jsx"
Cohesion: 0.07
Nodes (20): EncoreLeaderboardStrip(), EncoreSidebarBadge(), fadeSlideUp, labelStyle, logoImgStyle, subtitleStyle, DOT_CONFIG, RadarAnimation() (+12 more)

### Community 10 - "flag_store.py"
Cohesion: 0.14
Nodes (28): create_flag(), list_flags(), Submit a flag for a listing. Anonymous-friendly — no auth required. Body: {…, Return active flags for a listing (anonymous — no author info exposed)., check_rate_limits(), _count_recent(), _ensure_sqlite_table(), _get_conn() (+20 more)

### Community 11 - "run_post_ingest_transforms"
Cohesion: 0.12
Nodes (23): _extract_from_url_slug(), fetch_locality(), get_active_localities(), main(), normalize(), Resolve a locality name to a Housing.com internal hash. Uses hardcoded hashes…, Fetch raw listings for one locality from the Housing.com GraphQL API., Pull area_sqft, bhk, furnishing, and property_type from the Housing.com URL… (+15 more)

### Community 12 - "listing_store.py"
Cohesion: 0.15
Nodes (26): ingestion_status(), pipeline_status(), Show DB listing counts by source, locality breakdown, and total., Return ingestion pipeline health dashboard. Queries the new ingestion_runs and…, _build_image_list(), _get_conn(), get_listing_counts(), get_locality_counts() (+18 more)

### Community 13 - "tag_locality_feed.py"
Cohesion: 0.14
Nodes (26): _all_fallbacks(), _build_prompt_header(), bulk_update(), call_gemini_batch(), _clamp(), ensure_topic_exists(), fetch_canonical_topics(), fetch_untagged() (+18 more)

### Community 14 - "HealthPage.jsx"
Cohesion: 0.11
Nodes (15): FEED_INGEST_META, FEED_SOURCE_META, FeedSourceCard(), formatAge(), formatDuration(), HealthPage(), IngestionRunsTable(), relativeTime() (+7 more)

### Community 15 - "MyHub.jsx"
Cohesion: 0.12
Nodes (20): formatPriceStr(), ghostIconBtn, KNOWN_SOURCES, MyHub(), NewLeadCard(), normalizeNewLead(), normalizeRow(), normalizeSource() (+12 more)

### Community 16 - "record_transform_end"
Cohesion: 0.15
Nodes (23): Any, check_stale_sources(), check_transform_health(), main(), Pipeline health check — detects stale ingestion sources. Queries ingestion_runs…, Return list of sources whose last success is overdue., Check for elevated Gemini fallback rates in recent transform runs., get_connection() (+15 more)

### Community 17 - "slow_path.py"
Cohesion: 0.11
Nodes (24): _address_tokens(), _extract_bhk_number(), _is_dedup_match(), _load_locality_sentiment(), _load_locality_stats(), main(), Slow-path transforms — scheduled daily at 2:30–3:00 AM UTC via Railway Cron.…, Extract the numeric part from '2 BHK' → 2. (+16 more)

### Community 18 - "get_connection"
Cohesion: 0.18
Nodes (18): get_connection(), _listing_to_row(), mark_stale(), datetime, Shared database writer for all ingestion scripts. Connects to Supabase Postgres…, After a full scrape cycle for a source, mark listings that weren't seen in this…, Update the ingestion_runs row with final metrics., Return a psycopg2 connection to Supabase Postgres. (+10 more)

### Community 19 - "ingestion/ingest_reddit.py"
Cohesion: 0.14
Nodes (22): discard_not_a_listing(), Post-upsert: set status='discarded' for rows classified as not_a_listing.…, _extract_bhk(), _extract_contact(), _extract_furnishing(), _extract_price(), fetch_via_oauth(), fetch_via_public_json() (+14 more)

### Community 20 - "LocalityGuide.jsx"
Cohesion: 0.12
Nodes (16): BHK_OPTIONS, COLLAPSED_COUNTS, decodeHTML(), FEED_FILTERS, formatDeposit(), formatRent(), LocalityGuide(), LocalityRow() (+8 more)

### Community 21 - "ingest_stanza.py"
Cohesion: 0.15
Nodes (21): _extract_type_attributes_basic(), _extract_type_attributes_rich(), fetch_all_data(), _fetch_page_props(), _find_nearest_locality(), main(), normalize_basic(), normalize_rich() (+13 more)

### Community 22 - "get_connection"
Cohesion: 0.13
Nodes (19): _ensure_column(), get_connection(), _get_freshness_comparison(), health_check(), initialize_replica(), Local SQLite Read Replica for NestIQ ===================================== This…, Return a configured SQLite connection to the replica database. PRAGMAs applied:…, Create all replica tables and indexes if they don't exist, then patch in any… (+11 more)

### Community 23 - "posthog.js"
Cohesion: 0.16
Nodes (17): SignInModal(), applyInternalSuperProperties(), initPostHog(), resolveInternalUser(), trackFirstSaveToastShown(), trackFlagButtonClicked(), trackFlagModalOpened(), trackFlagRetracted() (+9 more)

### Community 24 - "enrich_society_images.py"
Cohesion: 0.16
Nodes (19): backfill_society_place_id(), fetch_image(), get_societies(), main(), match_confidence(), parse_fetched_at(), datetime, Lowercase words of 3+ characters, stripping punctuation. (+11 more)

### Community 25 - "ingest_telegram.py"
Cohesion: 0.18
Nodes (18): _extract_amenities(), _extract_bhk(), _extract_contact(), _extract_deposit(), _extract_furnishing(), _extract_maps_url(), _extract_price_int(), _extract_title() (+10 more)

### Community 26 - "replica_queries.py"
Cohesion: 0.20
Nodes (17): bangalore_rent_trend_replica(), _days_since_iso(), pulse_feed_for_locality_replica(), pulse_feed_replica(), pulse_locality_replica(), pulse_topics_replica(), pulse_trending_replica(), SQLite Replica Query Helpers ============================ Centralized read… (+9 more)

### Community 27 - "Navbar.jsx"
Cohesion: 0.19
Nodes (10): InstallBanner(), Navbar(), detectInstalled(), usePWAInstall(), LandingPage(), PWAInstallNudge(), getInitialTheme(), ThemeContext (+2 more)

### Community 28 - "LocalityDetail.jsx"
Cohesion: 0.15
Nodes (13): BHK_COLORS, decodeHTML(), FEED_FILTERS, formatRent(), formatRentShort(), LocalityDetail(), NewsCard(), PALETTE (+5 more)

### Community 29 - "StandardListing"
Cohesion: 0.16
Nodes (10): Tiered anomaly detection for Bangalore rental prices. Tiers: < 2,000 → garbage…, Deposits in Bangalore are typically 2–10 months rent (₹16k–₹10L). Discard…, Accept Unix timestamps (int/float) or ISO strings., Canonical listing shape written to the `listings` table., Normalize BHK strings to a consistent format., Normalize furnishing to one of three canonical values., Accept string prices like '₹25,000' and convert to int., StandardListing (+2 more)

### Community 30 - "scrape_reddit_discussions.py"
Cohesion: 0.16
Nodes (17): _already_covered(), get_oauth_token(), insert_posts(), _is_listing(), main(), Fetch an app-only OAuth token from Reddit., Return True if locality_feed already has >= ALREADY_HAVE reddit rows in the…, Return True if the title looks like a rental listing (pre-filter before Gemini). (+9 more)

### Community 31 - "ListingDetail.jsx"
Cohesion: 0.18
Nodes (12): Toast(), trackFirstSaveToastHubClicked(), cleanMarkdown(), deltaColor(), deriveSignals(), formatPrice(), ListingDetail(), localityToSlug() (+4 more)

### Community 32 - "PulseLocality.jsx"
Cohesion: 0.19
Nodes (15): matchesPulseLocalityTab(), PULSE_LOCALITY_FEED_TABS, PULSE_SOURCE_COLORS, PULSE_SOURCE_LABELS, pulseSourceColor(), pulseSourceLabel(), SignalCard(), decodeHTML() (+7 more)

### Community 33 - "useAuth"
Cohesion: 0.19
Nodes (10): AuthButton(), applyOwnerFlag(), useAuth(), identifyUser(), resetPostHog(), trackSigninCompleted(), AdminRoute(), Preferences() (+2 more)

### Community 34 - "NewForYou.jsx"
Cohesion: 0.17
Nodes (15): BackgroundPattern(), ICONS, POSITIONS, buildWhatsAppMessage(), extractPhone(), MiniCard(), NewForYou(), pillStyle (+7 more)

### Community 35 - "housing.py"
Cohesion: 0.16
Nodes (15): _fetch_hash(), fetch_housing_locality(), normalize_housing_listing(), Housing.com integration — fetches rental listings via GraphQL API. Hash…, Hit Housing.com's autocomplete API to get the internal locality hash. Returns…, Return the Housing.com hash for a locality. Checks in-memory cache →…, Pre-resolve hashes for all ingestion localities at startup., Fetch listings for one locality from the Housing.com GraphQL API. Returns a… (+7 more)

### Community 36 - "classify_listing_type.py"
Cohesion: 0.23
Nodes (14): _build_batch_prompt(), _call_gemini(), classify_listing_types(), _get_api_key(), _parse_response(), _probe_model(), Gemini-based listing type classifier for Reddit and Telegram listings.…, Classify listing_type for a list of StandardListing objects. Mutates each… (+6 more)

### Community 37 - "upsert_listings_batch"
Cohesion: 0.17
Nodes (15): _extract_price_int(), purge_old_listings(), Legacy upsert for the old in-app ingestion (Telegram daemon, etc.). For…, No-op for Postgres — lifecycle managed by ingestion pipeline., upsert_listing(), upsert_listings_batch(), build_search_param(), fetch_nobroker_locality() (+7 more)

### Community 38 - "DesktopSidebar.jsx"
Cohesion: 0.25
Nodes (9): CITY_PREFIX, CityContext, mapPathToCity(), useCity(), BottomNav(), CITIES, CitySwitcher(), Logo() (+1 more)

### Community 39 - "listing_extractor.py"
Cohesion: 0.25
Nodes (14): _build_prompt(), _call_gemini(), _call_gemini_fallback(), extract_listings_batch(), _get_api_key(), _is_obvious_non_listing(), _parse_response(), _probe_model() (+6 more)

### Community 40 - "useNewListings"
Cohesion: 0.26
Nodes (11): MobileNav(), clearCache(), fetchOneSearch(), readCache(), useNewListings(), writeCache(), generateSearchName(), migrationDoneKey() (+3 more)

### Community 41 - "enrich_locality_images.py"
Cohesion: 0.21
Nodes (14): fetch_image(), find_photo_reference(), get_localities(), locality_slug(), main(), Return localities to process. When --whitelist is set, use the hardcoded…, Run a Google Places Text Search. Returns (place_id, name, photo_reference) or…, Try two queries to find a photo_reference for the locality. Returns (place_id,… (+6 more)

### Community 42 - "test_replica_vs_supabase.py"
Cohesion: 0.21
Nodes (13): get_listing(), Return a single listing by composite ID (source_sourceid)., get_listing_by_id(), Return a single listing dict by composite ID (source_sourceid)., get_listing_by_id_replica(), query_listings_replica(), SQLite replica version of query_listings() from listing_store.py. Same…, SQLite replica version of get_listing_by_id() from listing_store.py. Same… (+5 more)

### Community 43 - "sync_to_sqlite.py"
Cohesion: 0.20
Nodes (13): trigger_sync(), main(), Sync Job: Supabase Postgres → Local SQLite Replica…, Insert a sync_runs row with status='running'. Returns row id or None on failure., Update sync_runs row with final results. Non-fatal on failure., Orchestrate full-refresh sync across all (or a subset of) replica tables.…, Convert a Python value returned by psycopg2 to a SQLite-compatible value.…, Full-refresh sync for a single table: DELETE + INSERT. Returns a stats dict… (+5 more)

### Community 44 - "run_dedup.py"
Cohesion: 0.19
Nodes (11): _address_check(), _address_tokens(), _get_connection(), _is_match(), Token-based address gate. Returns True (allow) if: - Either address yields no…, High-confidence duplicate check. ALL five conditions must hold: 1. Same…, Fetch recent active listings, find duplicates across sources, update…, Extract meaningful sub-location tokens from an address string. Two rules to… (+3 more)

### Community 45 - "pulse_transforms.py"
Cohesion: 0.22
Nodes (13): _build_editor_prompt(), _fetch_editor_pool(), _get_api_key(), main(), _parse_editor_response(), Pulse fast-path + slow-path transforms. Fast-path (called after each Pulse…, Gemini Flash acts as a city editor, ranking the best posts from the last 24…, Balanced pool of high-sentiment posts from the last 24 hours. (+5 more)

### Community 46 - "view_store.py"
Cohesion: 0.24
Nodes (13): _ensure_sqlite_tables(), _get_conn(), get_view_summaries(), get_view_summary(), is_valid_uuid(), log_view(), _put_conn(), Listing view store — anonymous view tracking for listing detail pages. Views… (+5 more)

### Community 47 - "main.jsx"
Cohesion: 0.26
Nodes (9): CityProvider(), AppHeader(), ScrollToTop(), useDesktop(), AnalyticsPage(), Landing(), Search(), Societies() (+1 more)

### Community 48 - "RenterReports.jsx"
Cohesion: 0.23
Nodes (11): FlagModal(), containerStyle, ghostBtn(), miniLabel, OwnFlagCard(), relativeTime(), RenterReports(), sectionLabel (+3 more)

### Community 49 - "Profile.jsx"
Cohesion: 0.18
Nodes (8): BHK_ALERT_OPTIONS, DEFAULT_SOURCES, filterSummaryChips(), formatBhkLabel(), formatBudget(), FREQUENCIES, s, SOURCE_OPTIONS

### Community 50 - "Pulse.jsx"
Cohesion: 0.22
Nodes (11): BHK_OPTIONS, FEED_TABS, formatScore(), LocalityActivityCard(), localityToSlug(), Pulse(), SENTIMENT_COLORS, sentimentArrow() (+3 more)

### Community 51 - "scrape_google_news_rss.py"
Cohesion: 0.28
Nodes (12): _article_source_id(), build_rss_url(), fetch_all_articles(), fetch_query_items(), insert_articles(), _is_relevant(), main(), parse_published_at() (+4 more)

### Community 52 - "fast_path.py"
Cohesion: 0.18
Nodes (12): datetime, Fast-path transforms — called at the end of each ingestion script's main().…, Gemini Flash Lite batch tagging: category, topic, sentiment, locality NER,…, Copy tagged posts into feed_curated, excluding listing/flatmate_search/spam., Near-duplicate news dedup (>85% title similarity)., Mark listings not seen in this cycle as stale/expired., _run_category_filter(), _run_gemini_tagging() (+4 more)

### Community 53 - "UpsertStats"
Cohesion: 0.13
Nodes (25): Batch upsert listings using INSERT ... ON CONFLICT. Detects price changes via a…, Insert a new ingestion_runs row. Returns the row id., Counters returned by upsert_listings., record_run_start(), upsert_listings(), UpsertStats, main(), _print_pg_dry_run_report() (+17 more)

### Community 55 - "Societies.jsx"
Cohesion: 0.32
Nodes (9): DesktopSidebar(), logError(), logStart(), logSuccess(), captureApiError(), formatDeveloper(), SocietyCard(), formatRentShort() (+1 more)

### Community 56 - "enrich_societies_from_places.py"
Cohesion: 0.30
Nodes (11): fetch_image(), get_societies(), main(), match_confidence(), Return societies missing a place_id (or all, with --force)., Returns (place_id, google_name, photo_references[:3], [lat, lng]) or (None,…, section(), text_search_society() (+3 more)

### Community 57 - "extract_nobroker_payload.py"
Cohesion: 0.27
Nodes (11): ensure_columns(), extract_coords(), extract_image_urls(), extract_society(), get_conn(), main(), parse_payload(), Build image URLs from photos[].imagesMap.large (preferred) or .original. URL… (+3 more)

### Community 58 - "scripts/ingest_reddit.py"
Cohesion: 0.29
Nodes (11): build_broad_query(), build_locality_query(), extract_contact(), extract_price(), fetch_reddit_search(), _get_headers(), is_listing(), normalize_reddit_post() (+3 more)

### Community 59 - "trigger_sync_after_completion"
Cohesion: 0.24
Nodes (12): fetch_articles(), _get_api_key(), insert_articles(), _is_relevant(), main(), _parse_published_at(), datetime, Check title + description for relevance to Bangalore / the target locality. (+4 more)

### Community 60 - "rank_pulse_feed"
Cohesion: 0.29
Nodes (10): attach_decay_scores(), days_since_iso(), _fill_balanced(), is_high_sentiment(), rank_pulse_feed(), Ranking helpers for the city-wide Pulse feed., Interleave positive, negative, and neutral posts toward a mixed feed., Featured editor picks first, then a balanced mix of high-|sentiment| posts. (+2 more)

### Community 61 - "useListingFlags.js"
Cohesion: 0.27
Nodes (9): RFC-4122, FLAG_SHORT_LABELS, getDeviceId(), makeUuid(), useListingFlags(), useLogListingView(), trackFlagSubmitted(), trackListingViewLogged() (+1 more)

### Community 62 - "AnalyticsDashboard.jsx"
Cohesion: 0.31
Nodes (7): AnalyticsDashboard(), BarList(), fmtDuration(), fmtNum(), NewReturningBar(), periodLabel(), PERIODS

### Community 63 - "locality_matcher.py"
Cohesion: 0.24
Nodes (9): Second-pass locality matching using rapidfuzz for Reddit/Telegram posts where…, _run_fuzzy_locality_matching(), _build_alias_index(), fuzzy_match_text(), fuzzy_match_unmatched_listings(), Fuzzy locality matching for Reddit/Telegram listings that didn't get a locality…, Build a flat list of all aliases for rapidfuzz matching., Try to extract a locality from free text using fuzzy matching. Returns… (+1 more)

### Community 64 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 65 - "get_recent_sync_runs"
Cohesion: 0.25
Nodes (7): replica_status(), sync_runs_list(), get_recent_sync_runs(), get_sync_health(), Sync health monitoring — queries the sync_runs table in Supabase to provide a…, Query sync_runs table in Supabase, return health summary dict. Returns a safe…, Fetch the last N sync runs from Supabase for display in the UI. Returns a list…

### Community 66 - "useSearchLogs.js"
Cohesion: 0.46
Nodes (7): clearLocalLogs(), getSessionId(), LS_MIGRATED_KEY(), readLocalLogs(), supabaseSaveSearch(), useSearchLogs(), writeLocalLogs()

### Community 67 - "enrich_geocode_reddit.py"
Cohesion: 0.39
Nodes (7): centroid_for_locality(), geocode_address(), get_conn(), main(), Look up the centroid for a locality name using the canonical alias map. Returns…, Call the Google Geocoding API for '<address>, Bangalore'. Returns (lat, lng) on…, section()

### Community 68 - "enrich_geocode_telegram.py"
Cohesion: 0.39
Nodes (7): centroid_for_locality(), geocode_address(), get_conn(), main(), Look up the centroid for a locality name using the canonical alias map. Returns…, Call the Google Geocoding API for '<address>, Bangalore'. Returns (lat, lng) on…, section()

### Community 69 - "scoring.py"
Cohesion: 0.38
Nodes (6): compute_quality_score(), _get_locality_keywords(), datetime, Quality scoring for listings — shared across all ingestion scripts. Produces a…, Lazy-load locality names to avoid import-time DB dependency., Compute a 0–100 quality score for a listing.

### Community 70 - "extract_housing_society.py"
Cohesion: 0.43
Nodes (6): extract_society(), get_conn(), main(), Returns (society_name, None) on success, or (None, reason) when skipped., section(), SkipReason

### Community 71 - "generate_icons.py"
Cohesion: 0.38
Nodes (5): lerp_color(), make_icon(), point_to_segment_dist(), Generate PWA icon PNGs (192x192 and 512x512) for NestIQ. Uses only Python…, Return a flat list of (r,g,b) tuples for a size×size NestIQ radar icon.

### Community 72 - "stats"
Cohesion: 0.40
Nodes (6): _posthog_query(), Run a HogQL query against the PostHog API and return the raw result., Run a HogQL query, returning empty results instead of raising on failure., Return PostHog analytics stats for the internal dashboard. Accepts…, _safe_posthog_query(), stats()

### Community 73 - "_json_loads_safe"
Cohesion: 0.40
Nodes (6): build_image_list_replica(), _json_loads_safe(), Parse a JSON string from SQLite. Returns the parsed object or val as-is., Build a unified image list for a listing response (SQLite replica version).…, Convert a wide-SELECT row (46 columns) to a listing dict (SQLite version)., _row_to_listing_replica()

### Community 74 - "useSavedListings"
Cohesion: 0.60
Nodes (5): migrateOldLS(), readLS(), useSavedListings(), writeLS(), trackLocalStorageSavesMerged()

### Community 75 - "backfill_housing_coords.py"
Cohesion: 0.53
Nodes (5): fetch_coords_for_locality(), get_conn(), main(), Returns {listingId: (lat, lng)} for every property returned by the search,…, section()

### Community 76 - "link_listings_to_societies.py"
Cohesion: 0.60
Nodes (5): get_conn(), main(), overlap_ratio(), section(), tokenize()

### Community 77 - "PostHogRouteTracker.jsx"
Cohesion: 0.70
Nodes (3): PostHogRouteTracker(), usePageTracking(), trackPageView()

### Community 79 - "migrate_image_urls_to_images_json.py"
Cohesion: 0.70
Nodes (4): build_images_json(), get_conn(), main(), section()

### Community 80 - "seed_gurgaon_societies.py"
Cohesion: 0.70
Nodes (4): get_conn(), main(), section(), slugify()

### Community 81 - "log_listing_view"
Cohesion: 0.50
Nodes (4): _client_ip(), log_listing_view(), Best-effort client IP extraction (honours X-Forwarded-For for Railway/Vercel)., Record a listing-detail-page view. Body: { listing_id, device_id, user_id? }…

### Community 83 - "verify_token"
Cohesion: 0.50
Nodes (4): email_verify_token(), Verify a signed email token and return the user_id (for preferences page…, Decode and verify a token. Returns the payload dict or None on failure. Payload…, verify_token()

### Community 84 - "normalize_localities.py"
Cohesion: 0.83
Nodes (3): get_conn(), main(), section()

### Community 85 - "_handle_unhandled_exception"
Cohesion: 0.67
Nodes (3): _handle_unhandled_exception(), Catch-all: send to PostHog and return 500., errorhandler

## Knowledge Gaps
- **122 isolated node(s):** `run_pulse_cron.sh script`, `PYTHONPATH`, `run_pulse_railway_cron.sh script`, `PYTHONPATH`, `run_reddit_cron.sh script` (+117 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get_connection()` connect `get_connection` to `get_recent_sync_runs`, `route`, `app.py`, `classify_listing_type.py`, `run_post_ingest_transforms`, `sync_to_sqlite.py`, `tag_locality_feed.py`, `pulse_transforms.py`, `ingestion/ingest_reddit.py`, `scrape_google_news_rss.py`, `UpsertStats`, `get_connection`, `ingest_telegram.py`, `trigger_sync_after_completion`, `scrape_reddit_discussions.py`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `trigger_sync_after_completion()` connect `trigger_sync_after_completion` to `ingest_99acres.py`, `run_post_ingest_transforms`, `run_dedup.py`, `tag_locality_feed.py`, `pulse_transforms.py`, `slow_path.py`, `get_connection`, `ingestion/ingest_reddit.py`, `scrape_google_news_rss.py`, `ingest_stanza.py`, `UpsertStats`, `ingest_telegram.py`, `scrape_reddit_discussions.py`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `extract_locality()` connect `ingest_telegram.py` to `ingest_99acres.py`, `housing.py`, `app.py`, `localities.py`, `upsert_listings_batch`, `run_post_ingest_transforms`, `ingestion/ingest_reddit.py`, `UpsertStats`, `ingest_stanza.py`, `scripts/ingest_reddit.py`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `run_pulse_cron.sh script`, `PYTHONPATH`, `run_pulse_railway_cron.sh script` to the rest of the system?**
  _122 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `email_service.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06352087114337568 - nodes in this community are weakly interconnected._
- **Should `ingest_99acres.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06623376623376623 - nodes in this community are weakly interconnected._
- **Should `route` be split into smaller, more focused modules?**
  _Cohesion score 0.09084556254367575 - nodes in this community are weakly interconnected._