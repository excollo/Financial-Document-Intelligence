import logging
import json
import httpx
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
import xml.etree.ElementTree as ET
import re
import time
from pymongo import MongoClient
from app.core.config import settings

logger = logging.getLogger(__name__)

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
    NEGATIVE_KEYWORDS = [
        "fraud", "scam", "arrest", "arrested", "raid", "cbi", "sfio", "sebi",
        "show cause", "penalty", "default", "insolvency", "bankruptcy",
        "money laundering", "fema", "nclt", "forgery", "irregularities",
        "probe", "investigation", "charge sheet", "chargesheet", "court case", "lawsuit",
        "ed", "rbi", "f.i.r", "fir"
    ]
    _ENTITY_CATEGORY_LIMITS = {"promoters": 3, "kmp": 3, "directors": 3, "group_companies": 2}
    _ENTITY_STOPWORDS = {
        "india", "limited", "ltd", "bank", "company", "group", "news",
        "share", "stock", "market", "financial", "services"
    }
    
    def __init__(self):
        self.client_db = MongoClient(settings.MONGODB_URI)
        # Prefer database from URI so Node/Python always point to the same tenant DB.
        try:
            self.db = self.client_db.get_default_database()
            if self.db is None:
                raise ValueError("default database not present in URI")
        except Exception:
            self.db = self.client_db[settings.MONGO_DB_NAME]
        self.domains_collection = self.db["domains"]
        self.articles_collection = self.db["newsarticles"]
        logger.info("Initialized NewsMonitorCrawler (GPT + Serper mode).")

    @staticmethod
    def _normalize_name(name: str) -> str:
        return re.sub(r"\s+", " ", (name or "").strip()).lower()

    @staticmethod
    def _sanitize_term(term: str) -> str:
        s = re.sub(r"\s+", " ", (term or "").strip())
        return s[:120] if len(s) > 120 else s

    @staticmethod
    def _title_key(title: str) -> str:
        t = re.sub(r"[^a-z0-9\s]", " ", (title or "").lower())
        t = re.sub(r"\s+", " ", t).strip()
        return " ".join(t.split()[:14])

    def _term_in_text(self, text: str, term: str) -> bool:
        t = self._sanitize_term(term)
        if not t:
            return False
        # Short terms (ED/FIR/CBI etc.) must be whole-word, never substring.
        if len(t) <= 4 or t.isalnum():
            return re.search(rf"\b{re.escape(t)}\b", text, re.IGNORECASE) is not None
        return t.lower() in text.lower()

    def _is_generic_entity(self, term: str) -> bool:
        clean = self._normalize_name(re.sub(r"[^a-zA-Z0-9\s]", " ", term))
        if not clean:
            return True
        bits = clean.split()
        if len(bits) == 1 and bits[0] in self._ENTITY_STOPWORDS:
            return True
        if len(clean) < 3:
            return True
        return False

    def _clean_entities(self, company_name: str, entities: Dict[str, List[str]]) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {k: [] for k in self._ENTITY_CATEGORY_LIMITS}
        seen = {self._normalize_name(company_name)}
        for key, lim in self._ENTITY_CATEGORY_LIMITS.items():
            for raw in entities.get(key, []) or []:
                s = self._sanitize_term(raw)
                n = self._normalize_name(s)
                if not s or n in seen or self._is_generic_entity(s):
                    continue
                seen.add(n)
                out[key].append(s)
                if len(out[key]) >= lim:
                    break
        return out

    def search_with_serper(self, query: str, entities: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        """Serper News API: one strict query per company; return only company-linked snippets."""
        if not settings.SERPER_API_KEY:
            logger.warning("SERPER_API_KEY not found. Skipping Serper search.")
            return []
        url = "https://google.serper.dev/news"
        company = self._sanitize_term(query)
        clean_entities = self._clean_entities(company, entities or {})
        related_terms = [company]
        related_terms.extend(clean_entities.get("promoters", []))
        related_terms.extend(clean_entities.get("kmp", []))
        related_terms.extend(clean_entities.get("directors", []))
        related_terms.extend(clean_entities.get("group_companies", []))
        related_terms = [t for t in related_terms if t]

        if not related_terms:
            return []

        related_or = " OR ".join(f'"{t}"' for t in related_terms[:10])
        negative_terms = (
            "(fraud OR scam OR CBI OR ED OR SEBI OR RBI OR SFIO OR arrest OR investigation OR "
            "raid OR default OR insolvency OR NCLT OR penalty OR chargesheet OR money laundering)"
        )
        # Must include primary company mention to reduce noisy unrelated entity hits.
        full_query = f'"{company}" ({related_or}) {negative_terms}'
        headers = {
            'X-API-KEY': settings.SERPER_API_KEY,
            'Content-Type': 'application/json'
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                results = []
                seen_urls = set()
                payload = {
                    "q": full_query[:1700],
                    "num": 10,
                    "gl": "in",
                    "hl": "en",
                    "tbs": "qdr:w",
                }
                response = client.post(url, headers=headers, json=payload)
                if response.status_code == 400:
                    payload.pop("tbs", None)
                    response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()

                for news in data.get("news", []):
                    txt = f"{news.get('title', '')} {news.get('snippet', '')}"
                    # Strict post-filter: mention monitored company OR cleaned related entity.
                    if not any(self._term_in_text(txt, t) for t in related_terms):
                        continue
                    url_value = (news.get("link", "") or "").strip().lower()
                    if not url_value or url_value in seen_urls:
                        continue
                    seen_urls.add(url_value)
                    results.append({
                        "title": news.get("title", ""),
                        "url": news.get("link", ""),
                        "description": news.get("snippet", ""),
                        "source": news.get("source", ""),
                        "publishedDate": news.get("date", ""),
                        "sourceType": "serper",
                        "queriedAt": datetime.now(timezone.utc).isoformat()
                    })
                return results
        except Exception as e:
            logger.error(f"Serper Search Error query='{query}': {e}")
            return []


    def analyze_findings_with_gpt(self, articles: List[Dict[str, Any]], company_list: List[str]) -> List[Dict[str, Any]]:
        """Use GPT to keep only adverse rows explicitly linked to monitored company/entities."""
        if not articles or not settings.OPENAI_API_KEY:
            return []
            
        batch_size = 15
        adverse_articles = []
        
        for i in range(0, len(articles), batch_size):
            batch = articles[i:i+batch_size]
            
            slim_articles = json.dumps(
                [{"title": a.get("title", ""), "description": a.get("description", ""), "url": a.get("url", ""), "source": a.get("source", "")} for a in batch],
                ensure_ascii=False,
            )
            prompt = f"""
            You are a financial-risk validator.
            Keep ONLY rows that are BOTH:
            1) clearly adverse/negative, and
            2) clearly linked to one of these monitored companies: {", ".join(company_list)}.

            Reject generic market/regulatory news if the monitored company/entity is not explicitly in headline/snippet.
            Use CRITICAL only for severe, direct allegations/actions (fraud, arrests, ED/CBI raid, chargesheet, major enforcement).
            Use HIGH/MEDIUM for less severe developments.

            Articles:
            {slim_articles}

            Return strict JSON:
            {{"findings":[{{"url":"original_url","sentiment":"negative","riskLevel":"CRITICAL|HIGH|MEDIUM","findings":"one-line reason","category":"regulatory|legal|financial|governance"}}]}}
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

    def rule_based_negative_filter(self, articles: List[Dict[str, Any]], company: str, entities: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        """Deterministic fallback when LLM misses true adverse results."""
        if not articles:
            return []

        related_terms = [company]
        if entities:
            clean_entities = self._clean_entities(company, entities)
            related_terms.extend(clean_entities.get("promoters", []))
            related_terms.extend(clean_entities.get("kmp", []))
            related_terms.extend(clean_entities.get("directors", []))
            related_terms.extend(clean_entities.get("group_companies", []))

        def has_related_entity(text: str) -> bool:
            return any(self._term_in_text(text, term) for term in related_terms if term)

        keyword_patterns = {
            kw: re.compile(rf"\b{re.escape(kw)}\b", re.IGNORECASE) for kw in self.NEGATIVE_KEYWORDS
        }

        filtered = []
        for article in articles:
            text = f"{article.get('title', '')} {article.get('description', '')}"
            matched_keywords = [kw for kw, pat in keyword_patterns.items() if pat.search(text)]
            if matched_keywords and has_related_entity(text):
                risk = "HIGH"
                text_l = text.lower()
                if any(k in text_l for k in ["arrest", "chargesheet", "charge sheet", "cbi", "sfio", "money laundering", "fraud", "ed "]):
                    risk = "CRITICAL"
                category = "legal"
                if any(k in text_l for k in ["sebi", "show cause", "penalty", "rbi"]):
                    category = "regulatory"
                if any(k in text_l for k in ["default", "insolvency", "bankruptcy"]):
                    category = "financial"
                item = article.copy()
                item.update({
                    "sentiment": "negative",
                    "riskLevel": risk,
                    "category": category,
                    "findings": f"Flagged by keyword match: {', '.join(matched_keywords[:5])}",
                    "company": company
                })
                filtered.append(item)
        return filtered

    def search_web_context_with_serper(self, company_name: str) -> str:
        """Fetch quick web snippets for entity discovery (promoters/directors/KMP/group)."""
        if not settings.SERPER_API_KEY:
            return ""

        url = "https://google.serper.dev/search"
        payload = json.dumps({
            "q": f'"{company_name}" promoters directors CEO CFO KMP group companies India',
            "num": 10
        })
        headers = {
            'X-API-KEY': settings.SERPER_API_KEY,
            'Content-Type': 'application/json'
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(url, headers=headers, data=payload)
                response.raise_for_status()
                data = response.json()

            snippets = []
            for item in data.get("organic", [])[:10]:
                text = " | ".join(filter(None, [
                    item.get("title", ""),
                    item.get("snippet", ""),
                    item.get("link", "")
                ]))
                if text:
                    snippets.append(text)
            return "\n".join(snippets)
        except Exception as e:
            logger.warning(f"Serper context search failed for {company_name}: {e}")
            return ""

    def discover_entities_gpt(self, company_name: str) -> Dict[str, List[str]]:
        """Discover promoters, directors, KMP and group companies using Serper + GPT."""
        default_data = {"promoters": [], "kmp": [], "directors": [], "group_companies": []}
        if not settings.OPENAI_API_KEY:
            return default_data

        web_context = self.search_web_context_with_serper(company_name)
        prompt = f"""
        Identify the following for the Indian company '{company_name}' using the provided web context:
        1. Promoters (Individuals or entities)
        2. KMP (CEO/CFO/CS and other key management people)
        3. Directors (including independent/whole-time directors where available)
        4. Subsidiary or Group Companies

        Web context:
        {web_context if web_context else "No context available"}

        Return only entities that are reasonably likely to be related to this company.
        Return the result as a strictly valid JSON object with the following structure:
        {{
            "promoters": ["Name 1", "Name 2"],
            "kmp": ["Name 1", "Name 2"],
            "directors": ["Name 1", "Name 2"],
            "group_companies": ["Company 1", "Company 2"]
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
                
                logger.info(
                    f"Entities discovered for {company_name}: "
                    f"P:{len(data.get('promoters', []))}, "
                    f"K:{len(data.get('kmp', []))}, "
                    f"D:{len(data.get('directors', []))}, "
                    f"G:{len(data.get('group_companies', []))}"
                )
                return data
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

    def filter_rss_by_company_entities(self, articles: List[Dict[str, Any]], company_entities: Dict[str, Dict[str, List[str]]]) -> List[Dict[str, Any]]:
        """Filter RSS articles by company + related promoter/director/KMP/group entities."""
        if not company_entities:
            return []

        filtered = []
        seen_urls = set()

        for article in articles:
            text_to_search = f"{article.get('title', '')} {article.get('description', '')}"
            url_key = (article.get("url") or "").strip().lower()

            for company, entities in company_entities.items():
                clean_entities = self._clean_entities(company, entities)
                related_terms = [company]
                related_terms.extend(clean_entities.get("promoters", []))
                related_terms.extend(clean_entities.get("kmp", []))
                related_terms.extend(clean_entities.get("directors", []))
                related_terms.extend(clean_entities.get("group_companies", []))

                if any(self._term_in_text(text_to_search, term) for term in related_terms):
                    article_copy = article.copy()
                    article_copy["company"] = company
                    if not url_key or url_key not in seen_urls:
                        filtered.append(article_copy)
                        if url_key:
                            seen_urls.add(url_key)
                    break

        logger.info(f"RSS Filter: {len(articles)} total -> {len(filtered)} matching companies")
        return filtered

    def final_validate_combined_findings(self, findings: List[Dict[str, Any]], monitored_companies: List[str]) -> List[Dict[str, Any]]:
        """Final agent pass on RSS+Serper outputs to remove wrong-company/noise rows."""
        if not findings:
            return []
        if not settings.OPENAI_API_KEY:
            return findings

        by_url: Dict[str, Dict[str, Any]] = {}
        for f in findings:
            u = (f.get("url") or "").strip()
            if u and u not in by_url:
                by_url[u] = f
        slim = [
            {
                "url": x.get("url", ""),
                "company": x.get("company", ""),
                "title": x.get("title", ""),
                "description": x.get("description", ""),
                "source": x.get("source", ""),
                "sourceType": x.get("sourceType", ""),
            }
            for x in by_url.values()
            if x.get("url")
        ]
        if not slim:
            return findings

        prompt = f"""
        Validate adverse findings for monitored companies: {", ".join(monitored_companies)}.
        Keep only entries that are BOTH negative/adverse and clearly linked to one monitored company.
        Drop ambiguous or unrelated entries.
        Output strict JSON:
        {{"findings":[{{"url":"exact-url","company":"one monitored company","riskLevel":"CRITICAL|HIGH|MEDIUM","category":"regulatory|legal|financial|governance","findings":"one-line reason"}}]}}
        Items:
        {json.dumps(slim, ensure_ascii=False)}
        """
        try:
            with httpx.Client(timeout=90.0) as client:
                resp = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.GPT_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "response_format": {"type": "json_object"},
                    },
                )
                resp.raise_for_status()
                data = json.loads(resp.json()["choices"][0]["message"]["content"])
            rows = data.get("findings", [])
            if not isinstance(rows, list):
                return findings
            out: List[Dict[str, Any]] = []
            for r in rows:
                if not isinstance(r, dict):
                    continue
                u = (r.get("url") or "").strip()
                c = r.get("company", "")
                if not u or u not in by_url:
                    continue
                if c not in monitored_companies:
                    continue
                item = dict(by_url[u])
                item["company"] = c
                if r.get("riskLevel"):
                    item["riskLevel"] = r["riskLevel"]
                if r.get("category"):
                    item["category"] = r["category"]
                if r.get("findings"):
                    item["findings"] = r["findings"]
                out.append(item)
            return out
        except Exception as e:
            logger.error("Final validation pass failed: %s", e)
            return findings

    def merge_to_company_cards(self, findings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """One final row per company with deduped source citations."""
        if not findings:
            return []
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for f in findings:
            c = self._sanitize_term(f.get("company") or "Unknown")
            if not c:
                continue
            buckets.setdefault(c, []).append(f)

        risk_rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
        cards: List[Dict[str, Any]] = []
        for company, group in buckets.items():
            # Prefer newest/most-informative row as base
            group.sort(key=lambda x: str(x.get("publishedDate", "")), reverse=True)
            base = dict(group[0])
            base["company"] = company
            base["sentiment"] = "negative"
            seen = set()
            cites = []
            for g in group:
                u = (g.get("url") or "").strip()
                if u and u not in seen:
                    seen.add(u)
                    cites.append({
                        "url": u,
                        "title": g.get("title", "") or "",
                        "source": str(g.get("source", "")),
                    })
                for c in g.get("citations", []) or []:
                    if isinstance(c, dict):
                        cu = (c.get("url") or "").strip()
                        if cu and cu not in seen:
                            seen.add(cu)
                            cites.append({
                                "url": cu,
                                "title": c.get("title", "") or "",
                                "source": str(c.get("source", "")),
                            })
            base["citations"] = cites
            if cites:
                base["url"] = cites[0]["url"]

            # Keep strongest risk and compact findings text.
            strongest = base.get("riskLevel", "HIGH")
            for g in group:
                r = g.get("riskLevel", "HIGH")
                if risk_rank.get(r, 1) > risk_rank.get(strongest, 1):
                    strongest = r
            base["riskLevel"] = strongest
            merged_findings = [str(g.get("findings", "")).strip() for g in group if g.get("findings")]
            if merged_findings:
                base["findings"] = " | ".join(dict.fromkeys(merged_findings))[:3000]
            cards.append(base)
        return cards


    def merge_articles(self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Deduplicate same article across sources and retain all citation links."""
        if not articles:
            return []

        merged = {}
        for art in articles:
            company = art.get("company") or art.get("entityName") or "Unknown"
            url = (art.get("url") or "").strip().lower()
            title_norm = re.sub(r"\s+", " ", (art.get("title") or "").strip().lower())
            key = f"url::{url}" if url else f"title::{company.lower()}::{title_norm}"

            if key not in merged:
                item = art.copy()
                item["company"] = company
                item["citations"] = [art["url"]] if art.get("url") else []
                merged[key] = item
                continue

            existing = merged[key]
            new_desc = art.get("description") or art.get("summary") or ""
            if new_desc and new_desc not in (existing.get("description") or ""):
                existing["description"] = f"{existing.get('description', '')} | {new_desc}".strip(" |")
                existing["findings"] = f"{existing.get('findings', '')} | {new_desc}".strip(" |")

            new_url = art.get("url")
            if new_url and new_url not in existing["citations"]:
                existing["citations"].append(new_url)

            new_source = art.get("source")
            if new_source and new_source not in (existing.get("source") or ""):
                existing["source"] = f"{existing.get('source', '')}, {new_source}".strip(", ")

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
            
        all_entities = [company_name] + entities.get("promoters", []) + entities.get("kmp", []) + entities.get("group_companies", [])
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
            return {"success": False, "error": f"Domain {domain_id} not found."}
            
        raw_companies = domain.get("monitored_companies", [])
        monitored_companies: List[str] = []
        for item in raw_companies:
            # Replace various separators with a uniform one (comma)
            text = str(item).replace("\r\n", "\n").replace("\r", "\n")
            # Split by newline or comma
            import re
            parts = re.split(r'[\n,]', text)
            monitored_companies.extend([self._sanitize_term(p) for p in parts if self._sanitize_term(p)])
        # Deduplicate while preserving order
        monitored_companies = list(dict.fromkeys(monitored_companies))
                
        workspace_id = domain.get("workspaceId") or "ws_1758689602670_z3pxonjqn"
        
        if not monitored_companies:
            logger.info(f"No monitored companies for domain {domain_id}. Skipping.")
            return {"success": True, "article_count": 0, "message": "No companies to monitor."}
            
        # Consolidate all news found
        all_news = []
        total_articles = 0
        errors = []
        
        # Discover related entities once per company for both RSS and Serper flows.
        company_entities: Dict[str, Dict[str, List[str]]] = {}
        for company in monitored_companies:
            company_entities[company] = self.discover_entities_gpt(company)
            time.sleep(0.2)

        # Step 1: RSS Feeds + entity-based filtering
        logger.info("Step 1: Checking RSS Feeds...")
        rss_articles = self.fetch_rss_articles()
        filtered_rss = self.filter_rss_by_company_entities(rss_articles, company_entities)
        
        if filtered_rss:
            logger.info(f"Found {len(filtered_rss)} matching RSS items. Analyzing sentiment with GPT...")
            rss_adverse = self.analyze_findings_with_gpt(filtered_rss, monitored_companies)
            if not rss_adverse:
                # GPT can occasionally miss direct adverse snippets; apply deterministic fallback.
                for company in monitored_companies:
                    rss_adverse.extend(
                        self.rule_based_negative_filter(
                            [a for a in filtered_rss if a.get("company") == company],
                            company,
                            company_entities.get(company, {})
                        )
                    )
            if rss_adverse:
                all_news.extend(rss_adverse)
                logger.info(f"Step 1 Complete: Found {len(rss_adverse)} adverse RSS findings.")

        # Step 2: Serper Web Search Fallback (Highly Reliable, Bypasses AI Quotas)
        logger.info("Step 2: Performing Serper Search for monitored companies...")
        
        search_findings = []
        for company in monitored_companies:
            logger.info(f"Processing company: {company}")
            
            # Sub-step A: Use already discovered entities (Promoters/KMP/Directors/Group companies)
            entities = company_entities.get(company, {})
            
            # Sub-step B: Search Serper with improved query for Company + Promoters + Groups
            logger.info(f"Searching Serper for {company} and associated entities...")
            serper_results = self.search_with_serper(company, entities)
            
            if serper_results:
                for res in serper_results:
                    res["company"] = company
                
                # Sub-step C: Filter and analyze with GPT
                deep_adverse = self.analyze_findings_with_gpt(serper_results, [company])
                if not deep_adverse:
                    deep_adverse = self.rule_based_negative_filter(serper_results, company, entities)
                if deep_adverse:
                    search_findings.extend(deep_adverse)
            
            # Tiny delay to avoid aggressive rate limiting on GPT/Serper
            time.sleep(0.5)
            
        if search_findings:
            all_news.extend(search_findings)
            logger.info(f"Step 2 Complete: Found {len(search_findings)} web search findings.")

        # Final Step: Agent validates combined outputs (RSS + Serper), then collapse to one company card.
        if all_news:
            validated = self.final_validate_combined_findings(all_news, monitored_companies)
            merged_news = self.merge_to_company_cards(validated)
            for art in merged_news:
                art["domainId"] = domain_id
                art["crawledAt"] = datetime.now(timezone.utc)
                
            logger.info(f"Consolidated into {len(merged_news)} company cards from {len(all_news)} total signals.")
            self.save_articles(merged_news, workspace_id)
            total_articles = len(merged_news)
        else:
            logger.info("No adverse articles found from any source.")
            total_articles = 0
                
        logger.info(f"News Monitor for domain {domain_id} Completed. Total Unique Companies: {total_articles}")
        
        return {
            "success": True,
            "article_count": total_articles,
            "errors": errors if errors else None,
            "message": f"Monitor completed. Found findings for {total_articles} companies."
        }

def run_monitor(domain_id: Optional[str] = None):
    """Entry point for Celery task or instant trigger."""
    crawler = NewsMonitorCrawler()
    if domain_id:
        return crawler.run_for_domain(domain_id)
    else:
        return crawler.run_daily_monitor()
