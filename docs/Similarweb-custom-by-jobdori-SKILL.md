# SimilarWeb Conservative Skill (Jobdori Custom)

## Overview

Cost-optimized SimilarWeb data collection skill for Jobdori pirate site traffic analysis.
Fixed to **1-month query period** to minimize credit usage.

---

## Available Endpoints

### 1. Traffic & Engagement (~20 credits/domain/month)

Returns visits, unique visitors, bounce rate, pages per visit, and average visit duration.

```python
from ApiClient import ApiClient
client = ApiClient()

result = client.call_api(
    "SimilarWeb/similarweb_get_traffic_and_engagement",
    {
        "domain": "example.com",
        "start_date": "2026-01",
        "end_date": "2026-01",
        "main_domain_only": "false",
        "granularity": "monthly"
    }
)
```

**Response fields:**
- `visits` — Total visits
- `unique_visitors` — Unique visitors (deduplicated)
- `bounce_rate` — Bounce rate (0~1)
- `pages_per_visit` — Average pages per visit
- `avg_visit_duration` — Average visit duration (seconds)

---

### 2. Page Views (4 credits/domain/month)

```python
result = client.call_api(
    "SimilarWeb/similarweb_get_page_views",
    {
        "domain": "example.com",
        "start_date": "2026-01",
        "end_date": "2026-01",
        "main_domain_only": "false",
        "granularity": "monthly"
    }
)
```

**Response fields:**
- `page_views` — Total page views

---

### 3. Global Rank (4 credits/domain/month)

```python
result = client.call_api(
    "SimilarWeb/similarweb_get_global_rank",
    {
        "domain": "example.com",
        "start_date": "2026-01",
        "end_date": "2026-01",
        "main_domain_only": "false",
        "granularity": "monthly"
    }
)
```

**Response fields:**
- `global_rank` — Global traffic rank

---

### 4. Industry Rank (8 credits/domain)

Returns the **latest available month** data only. No date parameter needed.

```python
result = client.call_api(
    "SimilarWeb/similarweb_get_industry_rank",
    {
        "domain": "example.com"
    }
)
```

**Response fields:**
- `category` — Industry category (e.g., "Arts & Entertainment > Animation & Comics")
- `category_rank` — Rank within the category

---

## Excluded Endpoints (Cost Too High)

| Endpoint | Reason |
|---|---|
| Traffic by Country | ~40 credits/domain/month — too expensive |
| Traffic Sources | ~80 credits/domain/month — too expensive |
| Country Rank | Requires specific country code, no global lookup |

---

## Cost Estimation

| Endpoint | Credits | Per 50 Domains |
|---|---|---|
| Traffic & Engagement | ~20 | 1,000 |
| Page Views | 4 | 200 |
| Global Rank | 4 | 200 |
| Industry Rank | 8 | 400 |
| **Total** | **~36** | **~1,800** |

---

## Data Collection Rules

1. **Fixed 1-month period**: `start_date` and `end_date` must be the same month.
2. **Save immediately**: Write API response to JSON file after each call to prevent data loss.
3. **No multi-month queries**: Do NOT set start_date and end_date to different months.
4. **Industry Rank**: Always use latest month (no date parameter).

---

## Example Workflow

```python
import json
from ApiClient import ApiClient

client = ApiClient()
domain = "example.com"
month = "2026-01"

# 1. Traffic & Engagement (~20 credits)
traffic = client.call_api("SimilarWeb/similarweb_get_traffic_and_engagement", {
    "domain": domain, "start_date": month, "end_date": month,
    "main_domain_only": "false", "granularity": "monthly"
})
with open(f"/home/ubuntu/{domain}_traffic_engagement.json", "w") as f:
    json.dump(traffic, f, indent=2)

# 2. Page Views (4 credits)
page_views = client.call_api("SimilarWeb/similarweb_get_page_views", {
    "domain": domain, "start_date": month, "end_date": month,
    "main_domain_only": "false", "granularity": "monthly"
})
with open(f"/home/ubuntu/{domain}_page_views.json", "w") as f:
    json.dump(page_views, f, indent=2)

# 3. Global Rank (4 credits)
global_rank = client.call_api("SimilarWeb/similarweb_get_global_rank", {
    "domain": domain, "start_date": month, "end_date": month,
    "main_domain_only": "false", "granularity": "monthly"
})
with open(f"/home/ubuntu/{domain}_global_rank.json", "w") as f:
    json.dump(global_rank, f, indent=2)

# 4. Industry Rank (8 credits) — latest month only
industry_rank = client.call_api("SimilarWeb/similarweb_get_industry_rank", {
    "domain": domain
})
with open(f"/home/ubuntu/{domain}_industry_rank.json", "w") as f:
    json.dump(industry_rank, f, indent=2)

print(f"Estimated credits used: ~36 for {domain}")
```
