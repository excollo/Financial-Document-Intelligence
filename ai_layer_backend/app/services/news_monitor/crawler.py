import logging
import json
import os
import httpx
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
import xml.etree.ElementTree as ET
import re
import time
import random
from pymongo import MongoClient
from app.core.config import settings

logger = logging.getLogger(__name__)


def _resolve_serper_api_key() -> str:
    """Prefer Settings (.env); fallback to process env (Celery/Azure sometimes omit pydantic .env path)."""
    v = getattr(settings, "SERPER_API_KEY", None)
    if v is not None and str(v).strip():
        return str(v).strip()
    for key in ("SERPER_API_KEY", "SERPER_KEY"):
        ev = os.environ.get(key)
        if ev and str(ev).strip():
            return str(ev).strip()
    return ""

class QuotaExhaustedError(Exception):
    """Raised when an AI model's quota is exhausted."""
    pass

class NewsMonitorCrawler:
    """
    Automated News Crawler Service using Gemini with Google Search Grounding.
    Migrated to google-genai (V2 SDK) for better tool support.
    """
    
    RSS_FEEDS = [
        "https://www.thehindubusinessline.com/companies/feeder/default.rss",
        "https://economictimes.indiatimes.com/rssfeedsdefault.cms",
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "https://economictimes.indiatimes.com/news/company/rssfeeds/2146842.cms",
        "https://www.livemint.com/rss/companies",
        "https://www.livemint.com/rss/markets",
        "https://www.livemint.com/rss/news",
        "https://www.business-standard.com/rss/home_page_top_stories.rss",
        "https://www.business-standard.com/rss/companies-101.rss",
        "https://www.business-standard.com/rss/markets-106.rss",
        "https://www.moneycontrol.com/rss/latestnews.xml",
        "https://www.moneycontrol.com/rss/business.xml",
        "https://www.ft.com/rss/companies"
    ]
    
    def __init__(self):
        self.client_db = MongoClient(settings.MONGODB_URI)
        # Match app/db/mongo.py: prefer database name from the connection string, else MONGO_DB_NAME
        try:
            self.db = self.client_db.get_default_database()
        except Exception:
            self.db = self.client_db[settings.MONGO_DB_NAME]
        self.domains_collection = self.db["domains"]
        self.articles_collection = self.db["newsarticles"]
        _sk = _resolve_serper_api_key()
        logger.info(
            "Initialized NewsMonitorCrawler (db=%s) Serper=%s",
            getattr(self.db, "name", settings.MONGO_DB_NAME),
            "yes" if _sk else "NO_KEY",
        )
        if not _sk:
            logger.warning(
                "SERPER_API_KEY / SERPER_KEY is empty — Google News search is disabled. "
                "Set SERPER_API_KEY in ai_layer_backend/.env (or App Settings on Azure) and restart workers."
            )

    # Caps keep Serper/Google query length within practical limits while covering company + related parties.
    _SERPER_MAX_PROMOTERS = 5
    _SERPER_MAX_DIRECTORS = 5
    _SERPER_MAX_GROUP = 4
    # Serper /news: keep num ≤ 10 (API validation); credits count only on HTTP 2xx
    _SERPER_NEWS_NUM = 10

    @staticmethod
    def _sanitize_serper_term(term: str) -> str:
        """Ampersands and odd characters can trigger Serper 400; normalize for Google query syntax."""
        s = (term or "").strip()
        s = s.replace("&", " and ")
        s = re.sub(r"\s+", " ", s)
        return s[:120] if len(s) > 120 else s

    def search_with_serper(self, company_name: str, entities: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        """
        Serper **News** API only: POST https://google.serper.dev/news
        (Do not use /search + tbm=nws — Serper returns 400 and does not bill failed calls.)

        One query per company: company + related parties + adverse keywords; India locale.
        """
        api_key = _resolve_serper_api_key()
        if not api_key:
            logger.warning("Serper API key missing — skipping Serper search.")
            return []

        url = "https://google.serper.dev/news"
        entities = entities or {}

        def _dedupe_names(names: List[str]) -> List[str]:
            seen = set()
            out: List[str] = []
            for n in names:
                s = NewsMonitorCrawler._sanitize_serper_term(n)
                if not s:
                    continue
                key = s.casefold()
                if key in seen:
                    continue
                seen.add(key)
                out.append(s)
            return out

        parts: List[str] = [self._sanitize_serper_term(company_name)]
        parts.extend(entities.get("promoters", [])[: self._SERPER_MAX_PROMOTERS])
        parts.extend(entities.get("directors", [])[: self._SERPER_MAX_DIRECTORS])
        parts.extend(entities.get("kmp", [])[:3])
        parts.extend(entities.get("group_companies", [])[: self._SERPER_MAX_GROUP])
        entity_terms = _dedupe_names(parts)[:16]

        if not entity_terms:
            return []

        or_names = " OR ".join(f'"{t}"' for t in entity_terms)
        negative = (
            "(fraud OR SEBI OR RBI OR ED OR CBI OR SFIO OR NCLT OR insolvency OR "
            '"show cause" OR investigation OR arrest OR default OR irregularities OR penalty OR '
            '"money laundering" OR disqualification OR forensic OR raid OR cyber fraud)'
        )
        full_query = f"({or_names}) {negative}"
        if len(full_query) > 1800:
            full_query = full_query[:1800]

        headers = {
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        }

        def _post(payload: Dict[str, Any]) -> httpx.Response:
            with httpx.Client(timeout=45.0) as client:
                return client.post(url, headers=headers, json=payload)

        # Try with time filter; on 400 retry without tbs (some keys reject tbs on /news)
        payload: Dict[str, Any] = {
            "q": full_query,
            "num": self._SERPER_NEWS_NUM,
            "gl": "in",
            "hl": "en",
            "tbs": "qdr:w",
        }

        try:
            logger.info(
                "Calling Serper POST /news company=%s terms=%s q_len=%s",
                company_name,
                len(entity_terms),
                len(full_query),
            )
            response = _post(payload)
            if response.status_code == 400:
                logger.warning(
                    "Serper /news 400 with tbs — retrying without tbs. body=%s",
                    (response.text or "")[:400],
                )
                payload.pop("tbs", None)
                response = _post(payload)
            if response.status_code >= 400:
                logger.error(
                    "Serper /news failed HTTP %s company=%s body=%s",
                    response.status_code,
                    company_name,
                    (response.text or "")[:500],
                )
                return []

            data = response.json()
            raw_news = data.get("news")
            if raw_news is None:
                logger.warning(
                    "Serper /news: no 'news' key (keys=%s)",
                    list(data.keys())[:12],
                )
                raw_news = []

            results = []
            for news in raw_news:
                results.append({
                    "title": news.get("title", ""),
                    "url": news.get("link", ""),
                    "description": news.get("snippet", ""),
                    "source": news.get("source", ""),
                    "publishedDate": news.get("date", ""),
                    "sourceType": "serper",
                })
            logger.info(
                "Serper /news OK company=%s hits=%s",
                company_name,
                len(results),
            )
            return results
        except Exception as e:
            logger.error("Serper Search Error company=%s: %s", company_name, e)
            return []


    def analyze_findings_with_gpt(self, articles: List[Dict[str, Any]], company_list: List[str]) -> List[Dict[str, Any]]:
        """Use GPT-4o-mini to filter for negative/adverse articles with high speed/low quota usage."""
        if not articles or not settings.OPENAI_API_KEY:
            return []
            
        batch_size = 15
        adverse_articles = []
        
        for i in range(0, len(articles), batch_size):
            batch = articles[i:i+batch_size]

            # Build JSON outside the f-string — nested {{ }} + dict comp inside f-strings breaks on Python 3.14+
            articles_payload = json.dumps(
                [
                    {
                        "title": a.get("title", ""),
                        "description": a.get("description", ""),
                        "url": a.get("url", ""),
                        "source": a.get("source", ""),
                    }
                    for a in batch
                ],
                ensure_ascii=False,
            )

            prompt = f"""
            Identify strictly NEGATIVE or ADVERSE news findings for these companies: {", ".join(company_list)}
            
            Negative news categories: Regulatory (SEBI/RBI), Legal (Court/Firms), Financial (Defaults/Fraud), Governance (Insiders).
            INCLUDE cases where an employee, officer, branch manager, or subsidiary of the company is arrested, investigated, or charged (e.g. CBI/ED/cyber fraud), if the company name appears and the story is adverse.
            IGNORE expansion, general news, or stock price updates.
            
            Articles to analyze:
            {articles_payload}
            
            RESPONSE: Return a JSON object with a key "findings" containing a list of objects ONLY for negative articles.
            Format for each item in "findings":
            {{
                "url": "original_url",
                "sentiment": "negative",
                "riskLevel": "CRITICAL|HIGH|MEDIUM",
                "findings": "Brief adverse summary explaining why it is flagged",
                "category": "regulatory|legal|financial|governance"
            }}
            If no negative news, findings should be [].
            """
            
            try:
                url = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": settings.GPT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": { "type": "json_object" }
                }
                
                with httpx.Client(timeout=60.0) as client:
                    resp = client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    result_data = resp.json()["choices"][0]["message"]["content"]
                    
                    data = json.loads(result_data)
                    findings = data.get("findings", [])
                    if not isinstance(findings, list):
                        findings = []
                    
                    url_map = {a.get("url", ""): a for a in batch if a.get("url")}
                    for f in findings:
                        if not isinstance(f, dict):
                            continue
                        if f.get("url") in url_map:
                            # Verify company is actually mentioned in this finding if possible
                            item = url_map[f["url"]].copy()
                            item.update(f)
                            adverse_articles.append(item)
            except Exception as e:
                logger.error(f"GPT Filtering Error: {e}")
                
        return adverse_articles

    def adverse_keyword_fallback(
        self, articles: List[Dict[str, Any]], company_name: str
    ) -> List[Dict[str, Any]]:
        """
        When Serper returns hits but GPT returns no rows (e.g. employee-fraud headlines),
        keep items whose snippet/title matches adverse terms AND the monitored company name.
        """
        if not articles:
            return []
        adverse = re.compile(
            r"fraud|scam|cyber\s*fraud|cbi|ed\b|sebi|sfio|arrest|arrested|investigation|"
            r"chargesheet|penalty|raid|forensic|money\s*laundering|bribery|cheating|"
            r"default|insolvency|nclt|show\s*cause",
            re.I,
        )
        name = company_name.strip()
        if len(name) < 2:
            return []
        # Match company mention loosely (handles "IndusInd Bank" vs minor spacing)
        company_pat = re.compile(re.escape(name), re.I)
        out: List[Dict[str, Any]] = []
        for a in articles:
            text = f"{a.get('title', '')} {a.get('description', '')}"
            if not adverse.search(text):
                continue
            if not company_pat.search(text):
                continue
            item = dict(a)
            item["sentiment"] = "negative"
            item["riskLevel"] = "HIGH"
            item["findings"] = (
                "Flagged by keyword pass (regulatory/legal/fraud terms + company name in headline/snippet). "
                "Review source for full context."
            )
            item["category"] = "legal"
            out.append(item)
        return out

    def discover_entities_gpt(self, company_name: str) -> Dict[str, List[str]]:
        """Discover promoters, directors/KMP, and group companies using GPT (for Serper query scope)."""
        default_data = {"promoters": [], "directors": [], "kmp": [], "group_companies": []}
        if not settings.OPENAI_API_KEY:
            return default_data

        prompt = f"""
        For the Indian listed or known company '{company_name}', list names that would appear in news searches:
        1. Promoters (individuals or entities) — up to 5, most relevant only.
        2. Directors and key managerial persons — CEO, CFO, chairperson, whole-time directors — up to 5.
        3. Major subsidiary or listed group companies — up to 4.

        Use commonly known public names only; omit if uncertain. Return empty arrays rather than guessing.

        Return strictly valid JSON:
        {{
            "promoters": ["Name 1"],
            "directors": ["Name 1"],
            "group_companies": ["Company 1"]
        }}
        """
        
        try:
            url = "https://api.openai.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": settings.GPT_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": { "type": "json_object" }
            }
            
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                data = json.loads(resp.json()["choices"][0]["message"]["content"])
                if not isinstance(data, dict):
                    logger.warning("discover_entities_gpt: non-object JSON for %s", company_name)
                    return default_data
                merged = {
                    **default_data,
                    **{
                        k: (data.get(k) if isinstance(data.get(k), list) else [])
                        for k in default_data
                    },
                }
                logger.info(
                    "Entities discovered for %s: P=%s D=%s G=%s",
                    company_name,
                    len(merged.get("promoters", [])),
                    len(merged.get("directors", [])),
                    len(merged.get("group_companies", [])),
                )
                return merged
        except Exception as e:
            logger.error(f"Error discovering entities for {company_name}: {e}")
            return default_data

    def fetch_rss_articles(self) -> List[Dict[str, Any]]:
        """Fetch articles from all configured RSS feeds."""
        all_articles = []
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/",
            "Cache-Control": "no-cache"
        }
        
        with httpx.Client(timeout=45.0, headers=headers, follow_redirects=True) as client:
            for url in self.RSS_FEEDS:
                # Handle FT redirect and check FT specific URL
                target_url = url
                if "ft.com/rss/companies" in url:
                    target_url = "https://www.ft.com/companies?format=rss"
                    
                try:
                    logger.info(f"Fetching RSS: {target_url}")
                    response = client.get(target_url)
                    response.raise_for_status()
                    
                    root = ET.fromstring(response.text)
                    items = root.findall('.//item')
                    
                    source_name = url.split("//")[1].split("/")[0]
                    
                    for item in items:
                        title = item.find('title')
                        link = item.find('link')
                        description = item.find('description')
                        pub_date = item.find('pubDate')
                        
                        article = {
                            "title": title.text if title is not None else "",
                            "url": link.text if link is not None else "",
                            "description": description.text if description is not None else "",
                            "publishedDate": pub_date.text if pub_date is not None else "",
                            "source": source_name,
                            "sourceType": "rss"
                        }
                        all_articles.append(article)
                        
                except Exception as e:
                    logger.warning(f"Failed to fetch RSS from {url}: {e}")
                    
        return all_articles

    def filter_rss_by_companies(self, articles: List[Dict[str, Any]], monitored_companies: List[str]) -> List[Dict[str, Any]]:
        """Filter articles to only those mentioning monitored companies."""
        if not monitored_companies:
            return []
            
        filtered = []
        # Create regex patterns for whole word matching
        patterns = [re.compile(rf'\b{re.escape(company)}\b', re.IGNORECASE) for company in monitored_companies]
        
        for article in articles:
            text_to_search = f"{article.get('title', '')} {article.get('description', '')}".lower()
            for company in monitored_companies:
                # Use a more flexible search that handles companies with special chars like '&'
                # Check for either whole word or exact containment if it contains special chars
                if company.lower() in text_to_search:
                    # Double check it's not a substring of another word if it's alphanumeric
                    if company.isalnum():
                        if re.search(rf'\b{re.escape(company)}\b', text_to_search, re.IGNORECASE):
                            article["company"] = company
                            filtered.append(article)
                            break
                    else:
                        article["company"] = company
                        filtered.append(article)
                        break
        
        logger.info(f"RSS Filter: {len(articles)} total -> {len(filtered)} matching companies")
        return filtered

    def _title_cluster_key(self, title: str) -> str:
        """Loose key to group the same story from RSS vs Serper with slightly different headlines."""
        t = re.sub(r"\s+", " ", (title or "").lower().strip())
        words = re.sub(r"[^a-z0-9\s]", "", t).split()[:14]
        return " ".join(words)

    def analyze_rss_with_entity_context(
        self,
        rss_items: List[Dict[str, Any]],
        monitored_companies: List[str],
        entity_by_company: Dict[str, Dict[str, List[str]]],
    ) -> List[Dict[str, Any]]:
        """
        LLM pass: use discovered promoters/directors/group co. context to decide which RSS rows
        are adverse and which monitored company they relate to.
        """
        if not rss_items or not settings.OPENAI_API_KEY:
            return []

        compact_entities = {
            c: {
                "promoters": entity_by_company.get(c, {}).get("promoters", [])[:6],
                "directors": entity_by_company.get(c, {}).get("directors", [])[:6],
                "kmp": entity_by_company.get(c, {}).get("kmp", [])[:4],
                "group_companies": entity_by_company.get(c, {}).get("group_companies", [])[:5],
            }
            for c in monitored_companies
        }

        adverse_out: List[Dict[str, Any]] = []
        batch_size = 22
        for start in range(0, len(rss_items), batch_size):
            batch = rss_items[start : start + batch_size]
            slim = [
                {
                    "title": x.get("title", ""),
                    "description": (x.get("description") or "")[:650],
                    "url": x.get("url", ""),
                    "source": x.get("source", ""),
                }
                for x in batch
            ]
            prompt = f"""You are a financial risk analyst for Indian markets.

MONITORED COMPANIES AND RELATED PARTIES (use for matching; JSON):
{json.dumps(compact_entities, ensure_ascii=False)}

RSS ITEMS:
{json.dumps(slim, ensure_ascii=False)}

TASK: Select ONLY adverse/negative items: fraud, investigation, arrest, SEBI/RBI/ED/CBI/SFIO/NCLT, default, penalty, cyber fraud involving bank/company staff, insolvency, raids, forensic.
Include stories where a promoter, director, KMP, or group company is named if a monitored company is implicated.

Return JSON: {{"findings": [{{"url": "exact url from items", "company": "one of the monitored company names", "sentiment": "negative", "riskLevel": "CRITICAL|HIGH|MEDIUM", "findings": "one line why", "category": "regulatory|legal|financial|governance"}}]}}
If nothing qualifies: {{"findings": []}}"""

            try:
                api = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "model": settings.GPT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                }
                with httpx.Client(timeout=90.0) as client:
                    resp = client.post(api, headers=headers, json=payload)
                    resp.raise_for_status()
                    data = json.loads(resp.json()["choices"][0]["message"]["content"])
                findings = data.get("findings", [])
                if not isinstance(findings, list):
                    continue
                url_map = {x.get("url", ""): x for x in batch if x.get("url")}
                for f in findings:
                    if not isinstance(f, dict):
                        continue
                    u = f.get("url", "")
                    if u not in url_map:
                        continue
                    base = url_map[u].copy()
                    base.update(f)
                    adverse_out.append(base)
            except Exception as e:
                logger.error("RSS entity-context LLM error: %s", e)

        logger.info("RSS LLM (entity context): %s adverse rows", len(adverse_out))
        return adverse_out

    def merge_duplicate_story_sources(self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Merge rows that describe the same story (same company + similar title) and attach all URLs."""
        if not articles:
            return []
        groups: Dict[tuple, List[Dict[str, Any]]] = {}
        for a in articles:
            key = (a.get("company", "Unknown"), self._title_cluster_key(a.get("title", "")))
            groups.setdefault(key, []).append(a)

        merged: List[Dict[str, Any]] = []
        for key, group in groups.items():
            if len(group) == 1:
                a = dict(group[0])
                u = (a.get("url") or "").strip()
                if u:
                    a["citations"] = [
                        {"url": u, "title": a.get("title", ""), "source": str(a.get("source", ""))}
                    ]
                merged.append(a)
                continue

            group.sort(key=lambda g: str(g.get("publishedDate", "")), reverse=True)
            base = dict(group[0])
            cites: List[Dict[str, str]] = []
            seen_u = set()
            for g in group:
                u = (g.get("url") or "").strip()
                if u and u not in seen_u:
                    seen_u.add(u)
                    cites.append(
                        {
                            "url": u,
                            "title": g.get("title", "") or "",
                            "source": str(g.get("source", "")),
                        }
                    )
            base["citations"] = cites
            if cites:
                base["url"] = cites[0]["url"]
            descs = [g.get("description") for g in group if g.get("description")]
            if descs:
                base["description"] = " | ".join(descs)[:12000]
            fins = [g.get("findings") for g in group if g.get("findings")]
            if fins:
                base["findings"] = "\n".join(fins)[:12000]
            srcs = [str(g.get("source", "")) for g in group if g.get("source")]
            if srcs:
                base["source"] = ", ".join(sorted(set(srcs)))[:2000]
            merged.append(base)
        return merged

    def merge_articles(self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Deduplicate and merge articles by company name."""
        if not articles:
            return []
            
        merged = {}
        for art in articles:
            company = art.get("company") or art.get("entityName") or "Unknown"
            if company not in merged:
                # First time seeing this company
                merged[company] = art.copy()
                # Ensure we have a list for URLs if we want to show multiple
                if "url" in art:
                    merged[company]["citations"] = [art["url"]]
            else:
                # Merge logic
                existing = merged[company]
                
                # Combine descriptions/findings
                new_desc = art.get("description") or art.get("summary") or ""
                if new_desc and new_desc not in existing.get("description", ""):
                    existing["description"] = existing.get("description", "") + " | " + new_desc
                    existing["findings"] = existing.get("findings", "") + " | " + new_desc
                
                # Combine URLs
                new_url = art.get("url")
                if "citations" not in existing:
                    existing["citations"] = [existing.get("url")] if existing.get("url") else []
                
                if new_url and new_url not in existing["citations"]:
                    existing["citations"].append(new_url)
                    # Update primary url to the most recent one
                    existing["url"] = new_url
                
                # Update source to show multiple if different
                new_source = art.get("source")
                if new_source and new_source not in existing.get("source", ""):
                    existing["source"] = existing.get("source", "") + ", " + new_source
                    
                # Pick higher risk if applicable
                risk_map = {"CLEAR": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
                current_risk = risk_map.get(existing.get("riskLevel", "LOW"), 1)
                new_risk = risk_map.get(art.get("riskLevel", "LOW"), 1)
                if new_risk > current_risk:
                    existing["riskLevel"] = art.get("riskLevel")

        return list(merged.values())

    def crawl_with_perplexity(self, company_name: str, entities: Dict[str, List[str]], domain_id: str) -> List[Dict[str, Any]]:
        """Fallback task using Perplexity API (Looking for news in last 2 days)."""
        if not settings.PERPLEXITY_API_KEY:
            logger.warning("PERPLEXITY_API_KEY not found. Fallback skipped.")
            return []
            
        all_entities = (
            [company_name]
            + entities.get("promoters", [])
            + entities.get("directors", [])
            + entities.get("kmp", [])
            + entities.get("group_companies", [])
        )
        entities_str = ", ".join(all_entities)

        current_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        prompt = f"""
        You are a Financial Risk Intelligence Agent.
        Current System Time: {current_date}

        Your task is to search the web for strictly RECENT (published within the last 24 HOURS) and FACTUAL news articles related to the following company and its management.
        
        STRICT TIME RULE: DO NOT return any results published before { (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M") }. If news is older than 24 hours, IGNORE IT.

        TARGET ENTITIES:
        Primary Company: {company_name}
        Promoters/KMPs/Group: {entities_str}

        IDENTIFY ONLY NEGATIVE/ADVERSE INFORMATION:
        - Legal cases, lawsuits, FIRs, arrests
        - Regulatory actions (SEBI, RBI, MCA, NCLT, Courts)
        - Fraud, financial misstatements, defaults, debt issues
        - Raids, investigations (ED, CBI, SFIO)
        - Insolvency, bankruptcy, liquidation
        - Business shutdowns or major operational failures

        STRICT QUALITY RULES:
        1. Use ONLY real, verifiable web sources from the LAST 24 HOURS.
        2. IGNORE all historical data, past news, or generic company profiles.
        3. DO NOT speculate or infer risk; only report documented facts.
        4. Always provide the exact source URL.
        5. Prioritize Indian news sources (Economic Times, Reuters India, etc.).
        6. Clearly mention which SPECIFIC ENTITY the news pertains to.

        OUTPUT FORMAT (STRICT JSON ONLY):
        [
            {{
                "entityName": "Specific Name",
                "headline": "Headline",
                "summary": "Summary",
                "date": "YYYY-MM-DD",
                "source": "Source",
                "url": "URL"
            }}
        ]
        If no negative news is found, return exactly [].
        """

        try:
            url = "https://api.perplexity.ai/chat/completions"
            headers = {
                "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "sonar",
                "messages": [
                    {"role": "system", "content": "You are a specialized risk analyst. Return JSON output only. Ensure the output is a valid JSON array of objects."},
                    {"role": "user", "content": prompt}
                ]
            }
            
            with httpx.Client(timeout=60.0) as client:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                
                content = data["choices"][0]["message"]["content"]
                # Perplexity json_object mode still might return a wrapper
                try:
                    articles = json.loads(content)
                    # If it returned a dict with a list, extract it
                    if isinstance(articles, dict):
                        for key in ["articles", "negativeNews", "results"]:
                            if key in articles:
                                articles = articles[key]
                                break
                    
                    if not isinstance(articles, list):
                        articles = [articles] if isinstance(articles, dict) and "title" in articles else []
                except Exception as je:
                    logger.warning(f"Perplexity JSON parse failed for {company_name}: {je}. Attempting robust recovery.")
                    # Robust recovery: find from first [ to last ]
                    try:
                        import re
                        match = re.search(r'\[.*\]', content, re.DOTALL)
                        if match:
                            articles = json.loads(match.group(0))
                        else:
                            # Try finding first { and last } if it returned a single object instead
                            match_obj = re.search(r'\{.*\}', content, re.DOTALL)
                            if match_obj:
                                articles = [json.loads(match_obj.group(0))]
                            else:
                                articles = []
                    except Exception as e2:
                        logger.error(f"Perplexity Robust Parse Error for {company_name}: {e2}")
                        articles = []

                if not isinstance(articles, list):
                    articles = [articles] if isinstance(articles, dict) else []

                # Clean and enrich
                valid_articles = []
                for article in articles:
                    if isinstance(article, dict) and article.get("url"):
                        # Map Perplexity keys to system keys
                        article["title"] = article.get("headline", "News Finding")
                        article["description"] = article.get("summary", "")
                        article["publishedDate"] = article.get("date", "")
                        article["findings"] = article.get("summary", "")
                        article["company"] = company_name
                        article["category"] = "legal"
                        article["sentiment"] = "negative"
                        article["riskLevel"] = "HIGH"
                        
                        article["domainId"] = domain_id
                        article["crawledAt"] = datetime.now(timezone.utc)
                        article["workspaceId"] = "unknown" # Will be set by save_articles
                        valid_articles.append(article)
                
                logger.info(f"Perplexity found {len(valid_articles)} articles for {company_name}")
                return valid_articles

        except Exception as e:
            logger.error(f"Perplexity Fallback Error for {company_name}: {e}")
            return []

    def save_articles(self, articles: List[Dict[str, Any]], workspace_id: str):
        """Saves articles to MongoDB, avoiding duplicates by URL."""
        if not articles:
            return
            
        for article in articles:
            article["workspaceId"] = workspace_id
            if not article.get("publishedDate"):
                article["publishedDate"] = datetime.now(timezone.utc)
            try:
                self.articles_collection.update_one(
                    {"url": article["url"]},
                    {"$set": article},
                    upsert=True
                )
            except Exception as e:
                logger.error(f"Error saving article {article.get('url')}: {e}")

    def run_daily_monitor(self):
        """Runs the daily monitoring job for all enabled domains."""
        logger.info("Starting Daily News Monitor Job...")
        
        # 1. Get all domains with News Monitor enabled
        domains = list(self.domains_collection.find({
            "news_monitor_enabled": True, 
            "status": "active"
        }))
        
        logger.info(f"Found {len(domains)} domains with News Monitor enabled.")
        
        for domain in domains:
            self.run_for_domain(domain.get("domainId"))
        
        logger.info("Daily News Monitor Job Completed.")

    def run_for_domain(self, domain_id: str) -> Dict[str, Any]:
        """Runs the monitoring job for a specific domain immediately."""
        logger.info(f"Starting News Monitor for domain {domain_id}...")
        
        domain = self.domains_collection.find_one({"domainId": domain_id})
        if not domain:
            logger.error(f"Domain {domain_id} not found.")
            return {
                "success": False,
                "error": f"Domain {domain_id} not found.",
                "code": "DOMAIN_NOT_FOUND",
            }
            
        raw_companies = domain.get("monitored_companies", [])
        monitored_companies = []
        for item in raw_companies:
            # Replace various separators with a uniform one (comma)
            text = item.replace("\r\n", "\n").replace("\r", "\n")
            # Split by newline or comma
            import re
            parts = re.split(r'[\n,]', text)
            monitored_companies.extend([p.strip() for p in parts if p.strip()])
                
        workspace_id = domain.get("workspaceId") or "ws_1758689602670_z3pxonjqn"
        
        if not monitored_companies:
            logger.info(f"No monitored companies for domain {domain_id}. Skipping.")
            return {"success": True, "article_count": 0, "message": "No companies to monitor."}
            
        # Consolidate all news found
        all_news: List[Dict[str, Any]] = []
        total_articles = 0
        errors = []

        # Step 0: Discover promoters / directors / KMP / group companies once per monitored name (RSS + Serper)
        logger.info("Step 0: Entity discovery (GPT) for %s companies...", len(monitored_companies))
        entity_by_company: Dict[str, Dict[str, List[str]]] = {}
        for company in monitored_companies:
            entity_by_company[company] = self.discover_entities_gpt(company)
            time.sleep(0.35)

        # Step 1: RSS — keyword prefilter, then LLM with full entity context
        logger.info("Step 1: RSS feeds + LLM filter (with entity context)...")
        rss_articles = self.fetch_rss_articles()
        filtered_rss = self.filter_rss_by_companies(rss_articles, monitored_companies)

        rss_adverse: List[Dict[str, Any]] = []
        if filtered_rss:
            rss_adverse = self.analyze_rss_with_entity_context(
                filtered_rss, monitored_companies, entity_by_company
            )
            if not rss_adverse:
                for a in filtered_rss:
                    c = a.get("company") or ""
                    if c:
                        rss_adverse.extend(self.adverse_keyword_fallback([a], c))
            if rss_adverse:
                all_news.extend(rss_adverse)
                logger.info("Step 1: %s adverse RSS rows after LLM/keyword.", len(rss_adverse))

        # Step 2: Serper — one Google News query per company (uses same entity map; consumes Serper credits)
        logger.info("Step 2: Serper Google News (1 query per company, last ~7 days)...")
        search_findings: List[Dict[str, Any]] = []
        for company in monitored_companies:
            logger.info("Processing company: %s", company)
            entities = entity_by_company.get(company) or {}
            serper_results = self.search_with_serper(company, entities)

            if serper_results:
                for res in serper_results:
                    res["company"] = company

                deep_adverse = self.analyze_findings_with_gpt(serper_results, [company])
                if not deep_adverse:
                    deep_adverse = self.adverse_keyword_fallback(serper_results, company)
                    if deep_adverse:
                        logger.info(
                            "Keyword fallback kept %s Serper items for %s",
                            len(deep_adverse),
                            company,
                        )
                if deep_adverse:
                    search_findings.extend(deep_adverse)

            time.sleep(0.5)

        if search_findings:
            all_news.extend(search_findings)
            logger.info("Step 2: %s adverse rows from Serper pipeline.", len(search_findings))

        # Final: global URL dedupe → merge same story (similar title + company) → save with citations[]
        if all_news:
            seen_urls = set()
            url_deduped: List[Dict[str, Any]] = []
            for art in all_news:
                u = (art.get("url") or "").strip()
                if not u or u in seen_urls:
                    continue
                seen_urls.add(u)
                url_deduped.append(art)

            merged_stories = self.merge_duplicate_story_sources(url_deduped)
            for art in merged_stories:
                art["domainId"] = domain_id
                art["crawledAt"] = datetime.now(timezone.utc)

            logger.info(
                "Saving %s merged story rows from %s URL-deduped signals (raw signals=%s).",
                len(merged_stories),
                len(url_deduped),
                len(all_news),
            )
            self.save_articles(merged_stories, workspace_id)
            total_articles = len(merged_stories)
        else:
            logger.info("No adverse articles found from any source.")
            total_articles = 0

        logger.info(
            "News Monitor for domain %s completed. Saved story rows=%s",
            domain_id,
            total_articles,
        )
        
        return {
            "success": True,
            "article_count": total_articles,
            "errors": errors if errors else None,
            "message": f"Monitor completed. Saved {total_articles} story row(s) (RSS + Serper, deduped).",
        }

def run_monitor(domain_id: Optional[str] = None):
    """Entry point for Celery task or instant trigger."""
    crawler = NewsMonitorCrawler()
    if domain_id:
        return crawler.run_for_domain(domain_id)
    else:
        return crawler.run_daily_monitor()
