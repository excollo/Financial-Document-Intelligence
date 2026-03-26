import logging
import json
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
        self.client_db = MongoClient(settings.MONGO_URI)
        self.db = self.client_db[settings.MONGO_DB_NAME]
        self.domains_collection = self.db["domains"]
        self.articles_collection = self.db["newsarticles"]
        logger.info("Initialized NewsMonitorCrawler (GPT + Serper mode).")

    def search_with_serper(self, query: str, entities: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        """Search the web using Serper API (News mode) with focus on adverse findings."""
        if not settings.SERPER_API_KEY:
            logger.warning("SERPER_API_KEY not found. Skipping Serper search.")
            return []
            
        url = "https://google.serper.dev/search"
        
        # Build a robust query covering promoters and group companies if provided
        search_terms = [query]
        if entities:
            # Add up to 2 promoters and 2 group companies to the query to avoid it being too long
            search_terms.extend(entities.get("promoters", [])[:2])
            search_terms.extend(entities.get("group_companies", [])[:2])
        
        # Focused negative search terms
        base_query = " OR ".join([f'"{term}"' for term in search_terms])
        full_query = f"({base_query}) (fraud OR SEBI OR "
        full_query += '"show cause" OR "investigation" OR "arrest" OR "default" OR "irregularities" OR "penalty")'
        
        payload = json.dumps({"q": full_query, "tbm": "nws", "num": 10})
        headers = {
            'X-API-KEY': settings.SERPER_API_KEY,
            'Content-Type': 'application/json'
        }
        
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(url, headers=headers, data=payload)
                response.raise_for_status()
                data = response.json()
                
                results = []
                for news in data.get("news", []):
                    results.append({
                        "title": news.get("title", ""),
                        "url": news.get("link", ""),
                        "description": news.get("snippet", ""),
                        "source": news.get("source", ""),
                        "publishedDate": news.get("date", ""),
                        "sourceType": "serper"
                    })
                return results
        except Exception as e:
            logger.error(f"Serper Search Error query='{full_query}': {e}")
            return []


    def analyze_findings_with_gpt(self, articles: List[Dict[str, Any]], company_list: List[str]) -> List[Dict[str, Any]]:
        """Use GPT-4o-mini to filter for negative/adverse articles with high speed/low quota usage."""
        if not articles or not settings.OPENAI_API_KEY:
            return []
            
        batch_size = 15
        adverse_articles = []
        
        for i in range(0, len(articles), batch_size):
            batch = articles[i:i+batch_size]
            
            prompt = f"""
            Identify strictly NEGATIVE or ADVERSE news findings for these companies: {", ".join(company_list)}
            
            Negative news categories: Regulatory (SEBI/RBI), Legal (Court/Firms), Financial (Defaults/Fraud), Governance (Insiders).
            IGNORE expansion, general news, or stock price updates.
            
            Articles to analyze:
            {json.dumps([{ "title": a['title'], "description": a['description'], "url": a['url'], "source": a['source'] } for a in batch])}
            
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
                    
                    url_map = {a["url"]: a for a in batch}
                    for f in findings:
                        if f.get("url") in url_map:
                            # Verify company is actually mentioned in this finding if possible
                            item = url_map[f["url"]].copy()
                            item.update(f)
                            adverse_articles.append(item)
            except Exception as e:
                logger.error(f"GPT Filtering Error: {e}")
                
        return adverse_articles

    def discover_entities_gpt(self, company_name: str) -> Dict[str, List[str]]:
        """Discover Promoters and Group Companies using GPT."""
        default_data = {"promoters": [], "kmp": [], "group_companies": []}
        if not settings.OPENAI_API_KEY:
            return default_data
            
        prompt = f"""
        Identify the following for the Indian company '{company_name}':
        1. Promoters (Individuals or entities)
        2. Subsidiary or Group Companies
        
        Return the result as a strictly valid JSON object with the following structure:
        {{
            "promoters": ["Name 1", "Name 2"],
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
                
                logger.info(f"Entities discovered for {company_name}: P:{len(data.get('promoters', []))}, G:{len(data.get('group_companies', []))}")
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
        all_news = []
        total_articles = 0
        errors = []
        
        # Step 1: RSS Feeds + Fast Filtering (Code based match)
        logger.info("Step 1: Checking RSS Feeds...")
        rss_articles = self.fetch_rss_articles()
        filtered_rss = self.filter_rss_by_companies(rss_articles, monitored_companies)
        
        if filtered_rss:
            logger.info(f"Found {len(filtered_rss)} matching RSS items. Analyzing sentiment with GPT...")
            rss_adverse = self.analyze_findings_with_gpt(filtered_rss, monitored_companies)
            if rss_adverse:
                all_news.extend(rss_adverse)
                logger.info(f"Step 1 Complete: Found {len(rss_adverse)} adverse RSS findings.")

        # Step 2: Serper Web Search Fallback (Highly Reliable, Bypasses AI Quotas)
        logger.info("Step 2: Performing Serper Search for monitored companies...")
        
        search_findings = []
        for company in monitored_companies:
            logger.info(f"Processing company: {company}")
            
            # Sub-step A: Discover entities (Promoters/Group companies) using GPT
            entities = self.discover_entities_gpt(company)
            
            # Sub-step B: Search Serper with improved query for Company + Promoters + Groups
            logger.info(f"Searching Serper for {company} and associated entities...")
            serper_results = self.search_with_serper(company, entities)
            
            if serper_results:
                for res in serper_results:
                    res["company"] = company
                
                # Sub-step C: Filter and analyze with GPT
                deep_adverse = self.analyze_findings_with_gpt(serper_results, [company])
                if deep_adverse:
                    search_findings.extend(deep_adverse)
            
            # Tiny delay to avoid aggressive rate limiting on GPT/Serper
            time.sleep(0.5)
            
        if search_findings:
            all_news.extend(search_findings)
            logger.info(f"Step 2 Complete: Found {len(search_findings)} web search findings.")

        # Final Step: Merge and Save
        if all_news:
            merged_news = self.merge_articles(all_news)
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
