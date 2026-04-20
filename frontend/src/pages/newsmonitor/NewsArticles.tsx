import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Navbar } from '@/components/sharedcomponents/Navbar';
import { TrendingUp, Filter, ChevronDown, ExternalLink, Calendar, Building2, Tag, AlertCircle, AlertTriangle, CheckCircle, Info, RefreshCw, Trash2, Zap } from 'lucide-react';
import { domainService } from '@/services/domainService';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/** Same JWT storage as AuthContext; never send `Bearer null` (it overrides axios.defaults). */
function authHeaders(workspaceId: string): Record<string, string> {
    const token = localStorage.getItem('accessToken') || localStorage.getItem('token');
    const h: Record<string, string> = { 'x-workspace': workspaceId };
    if (token) {
        h.Authorization = `Bearer ${token}`;
    }
    return h;
}

interface NewsArticle {
    _id: string;
    title: string;
    description: string;
    url: string;
    imageUrl?: string;
    source: string;
    publishedDate: string;
    company: string;
    category: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    findings?: string;
    citations?: Array<{ url: string; title?: string; source?: string }> | string[];
}

/** One card per company; multiple DB rows collapsed with all outbound links */
interface CompanyNewsGroup {
    key: string;
    company: string;
    articles: NewsArticle[];
    /** Deduped links for buttons (primary story + citations) */
    sourceLinks: { url: string; label: string }[];
}

interface ArticleStats {
    /** Distinct companies (matches grouped cards); falls back to article count if API is older */
    totalCompanies?: number;
    totalArticles: number;
    sentimentSummary: {
        positive: number;
        negative: number;
        neutral: number;
    };
    riskDistribution: {
        LOW: number;
        MEDIUM: number;
        HIGH: number;
        CRITICAL: number;
    };
    lastCrawlDate: string | null;
}

const NewsArticles: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [articles, setArticles] = useState<NewsArticle[]>([]);
    const [stats, setStats] = useState<ArticleStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [selectedSentiment, setSelectedSentiment] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);
    const [timeFilter, setTimeFilter] = useState<'today' | 'yesterday' | 'last7' | 'last30' | 'all'>('last7');
    const [showTimeFilter, setShowTimeFilter] = useState(false);
    const [isCrawling, setIsCrawling] = useState(false);
    const [domainId, setDomainId] = useState<string | null>(null);
    const initialLoadDone = React.useRef(false);

    // Force reload when navigating to this page
    useEffect(() => {
        const isRefresh = sessionStorage.getItem('newsMonitorJustReloaded');

        // If we didn't just reload, trigger a reload
        if (!isRefresh) {
            console.log('Navigated to news monitor - triggering reload');
            sessionStorage.setItem('newsMonitorJustReloaded', 'true');
            window.location.reload();
            return;
        }

        // Clear the reload flag after component mounts
        sessionStorage.removeItem('newsMonitorJustReloaded');

        // Cleanup: remove flag when leaving the page
        return () => {
            console.log('Leaving news monitor - clearing reload flag');
            sessionStorage.removeItem('newsMonitorJustReloaded');
        };
    }, []);

    // Initial load only once
    useEffect(() => {
        if (!initialLoadDone.current) {
            console.log('Initial load - fetching data');
            fetchStats();
            fetchArticles();
            initialLoadDone.current = true;
        }
    }, []);

    // Reload when filters change
    useEffect(() => {
        if (initialLoadDone.current) {
            console.log('Filters changed - fetching articles and stats');
            fetchStats();
            fetchArticles();
        }
    }, [selectedCompany, selectedSentiment, selectedCategory, searchQuery, timeFilter]);

    const fetchStats = async () => {
        try {
            const workspaceId = localStorage.getItem('workspaceId') || 'ws_1758689602670_z3pxonjqn';

            // Add date range based on time filter
            const params: any = {};
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            switch (timeFilter) {
                case 'today':
                    params.startDate = startOfToday.toISOString();
                    break;
                case 'yesterday':
                    const startOfYesterday = new Date(startOfToday);
                    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
                    params.startDate = startOfYesterday.toISOString();
                    params.endDate = startOfToday.toISOString();
                    break;
                case 'last7':
                    const last7Days = new Date(startOfToday);
                    last7Days.setDate(last7Days.getDate() - 7);
                    params.startDate = last7Days.toISOString();
                    break;
                case 'last30':
                    const last30Days = new Date(startOfToday);
                    last30Days.setDate(last30Days.getDate() - 30);
                    params.startDate = last30Days.toISOString();
                    break;
                case 'all':
                    // No date filter
                    break;
            }

            console.log('Fetching stats from:', `${API_URL}/news-articles/stats`, 'with params:', params);

            const response = await axios.get(
                `${API_URL}/news-articles/stats`,
                {
                    headers: authHeaders(workspaceId),
                    params,
                }
            );

            console.log('Stats response:', response.data);
            setStats(response.data);
        } catch (error: any) {
            console.error('Error fetching stats:', error);
            console.error('Error response:', error.response?.data);
        }
    };

    const fetchArticles = async () => {
        try {
            setLoading(true);
            const workspaceId = localStorage.getItem('workspaceId') || 'ws_1758689602670_z3pxonjqn';

            const params: any = { limit: 50 };
            if (selectedCompany) params.company = selectedCompany;
            if (selectedSentiment) params.sentiment = selectedSentiment;
            if (selectedCategory) params.category = selectedCategory;
            if (searchQuery) params.search = searchQuery;

            // Add date range based on time filter
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            switch (timeFilter) {
                case 'today':
                    params.startDate = startOfToday.toISOString();
                    break;
                case 'yesterday':
                    const startOfYesterday = new Date(startOfToday);
                    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
                    params.startDate = startOfYesterday.toISOString();
                    params.endDate = startOfToday.toISOString();
                    break;
                case 'last7':
                    const last7Days = new Date(startOfToday);
                    last7Days.setDate(last7Days.getDate() - 7);
                    params.startDate = last7Days.toISOString();
                    break;
                case 'last30':
                    const last30Days = new Date(startOfToday);
                    last30Days.setDate(last30Days.getDate() - 30);
                    params.startDate = last30Days.toISOString();
                    break;
                case 'all':
                    // No date filter
                    break;
            }

            console.log('Fetching articles from:', `${API_URL}/news-articles`, 'with params:', params);

            const response = await axios.get(
                `${API_URL}/news-articles`,
                {
                    headers: authHeaders(workspaceId),
                    params,
                }
            );

            console.log('Articles response:', response.data);
            setArticles(response.data.articles);
            console.log(response.data.articles);
        } catch (error: any) {
            console.error('Error fetching articles:', error);
            console.error('Error response:', error.response?.data);
        } finally {
            setLoading(false);
        }
    };

    const getSentimentConfig = (sentiment: string) => {
        switch (sentiment) {
            case 'positive':
                return {
                    bgColor: 'bg-green-50',
                    borderColor: 'border-green-200',
                    textColor: 'text-gray-800',
                    badgeColor: 'bg-green-100 text-green-800',
                    icon: <CheckCircle className="h-5 w-5" />,
                    iconColor: 'text-green-600'
                };
            case 'negative':
                return {
                    bgColor: 'bg-red-50',
                    borderColor: 'border-red-200',
                    textColor: 'text-gray-800',
                    badgeColor: 'bg-red-100 text-red-800',
                    icon: <AlertTriangle className="h-5 w-5" />,
                    iconColor: 'text-red-600'
                };
            case 'neutral':
                return {
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200',
                    textColor: 'text-gray-800',
                    badgeColor: 'bg-gray-100 text-gray-800',
                    icon: <Info className="h-5 w-5" />,
                    iconColor: 'text-gray-600'
                };
            default:
                return {
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200',
                    textColor: 'text-gray-800',
                    badgeColor: 'bg-gray-100 text-gray-800',
                    icon: <Info className="h-5 w-5" />,
                    iconColor: 'text-gray-600'
                };
        }
    };

    const handleDeleteGroup = async (ids: string[]) => {
        if (ids.length === 0) return;
        const msg =
            ids.length === 1
                ? 'Are you sure you want to delete this news article?'
                : `Delete all ${ids.length} saved articles for this company?`;
        if (!window.confirm(msg)) return;

        try {
            const workspaceId = localStorage.getItem('workspaceId') || 'ws_1758689602670_z3pxonjqn';
            await Promise.all(
                ids.map((id) =>
                    axios.delete(`${API_URL}/news-articles/${id}`, {
                        headers: authHeaders(workspaceId),
                    })
                )
            );
            toast.success(ids.length === 1 ? 'Article deleted successfully' : 'Articles deleted successfully');
            setArticles((prev) => prev.filter((a) => !ids.includes(a._id)));
            fetchStats();
        } catch (error: any) {
            console.error('Error deleting articles:', error);
            toast.error(error.response?.data?.message || 'Failed to delete article(s)');
        }
    };

    const getRiskLevelColor = (level?: string) => {
        switch (level) {
            case 'LOW':
                return 'bg-green-500 text-white';
            case 'MEDIUM':
                return 'bg-yellow-500 text-white';
            case 'HIGH':
                return 'bg-orange-500 text-white';
            case 'CRITICAL':
                return 'bg-red-600 text-white';
            default:
                return 'bg-gray-500 text-white';
        }
    };

    const formatDate = (dateString: string | undefined) => {
        if (!dateString) return 'Date unknown';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return 'Date unknown';
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffHours < 1) {
            return 'Just now';
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        }
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const RISK_RANK: Record<string, number> = {
        CRITICAL: 4,
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
    };

    const SENTIMENT_RANK: Record<string, number> = {
        negative: 3,
        neutral: 2,
        positive: 1,
    };

    const groupArticlesByCompany = (list: NewsArticle[]): CompanyNewsGroup[] => {
        const byKey = new Map<string, NewsArticle[]>();
        for (const a of list) {
            const key = (a.company || 'Unknown').trim().toLowerCase() || 'unknown';
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key)!.push(a);
        }
        const groups: CompanyNewsGroup[] = [];
        for (const [key, arts] of byKey) {
            const sorted = [...arts].sort(
                (x, y) =>
                    new Date(y.publishedDate || 0).getTime() -
                    new Date(x.publishedDate || 0).getTime()
            );
            const seenUrls = new Set<string>();
            const sourceLinks: { url: string; label: string }[] = [];
            const pushLink = (url: string | undefined, label: string) => {
                if (!url || !url.trim() || seenUrls.has(url)) return;
                seenUrls.add(url);
                sourceLinks.push({ url: url.trim(), label: label || 'Source' });
            };
            for (const art of sorted) {
                pushLink(art.url, art.source || 'Article');
                const cits = art.citations;
                if (Array.isArray(cits)) {
                    for (const c of cits) {
                        if (typeof c === 'string') pushLink(c, 'Citation');
                        else if (c && typeof c === 'object' && 'url' in c)
                            pushLink(c.url, c.source || c.title || 'Source');
                    }
                }
            }
            groups.push({
                key,
                company: sorted[0]?.company || 'Unknown',
                articles: sorted,
                sourceLinks,
            });
        }
        groups.sort((a, b) => {
            const da = new Date(a.articles[0]?.publishedDate || 0).getTime();
            const db = new Date(b.articles[0]?.publishedDate || 0).getTime();
            return db - da;
        });
        return groups;
    };

    const companyGroups = useMemo(
        () => groupArticlesByCompany(articles),
        [articles]
    );

    const mergeGroupDisplay = (arts: NewsArticle[]) => {
        const primary = arts[0];
        let sentiment = primary.sentiment;
        for (const a of arts) {
            if ((SENTIMENT_RANK[a.sentiment] || 0) > (SENTIMENT_RANK[sentiment] || 0)) {
                sentiment = a.sentiment;
            }
        }
        let riskLevel: NewsArticle['riskLevel'] | undefined;
        for (const a of arts) {
            if (!a.riskLevel) continue;
            if (!riskLevel || (RISK_RANK[a.riskLevel] || 0) > (RISK_RANK[riskLevel] || 0)) {
                riskLevel = a.riskLevel;
            }
        }
        const findings =
            primary.findings ||
            arts.map((a) => a.findings).find((f) => f && f.trim()) ||
            '';
        return { primary, sentiment, riskLevel, findings };
    };

    const clearFilters = () => {
        setSelectedCompany('');
        setSelectedSentiment('');
        setSelectedCategory('');
        setSearchQuery('');
    };

    const handleRefresh = () => {
        fetchStats();
        fetchArticles();
    };

    const handleTriggerCrawl = async () => {
        try {
            let targetDomainId = domainId;
            
            if (!targetDomainId) {
                const config = await domainService.getConfig();
                if (config?.domainId) {
                    targetDomainId = config.domainId;
                    setDomainId(config.domainId);
                } else {
                    toast.error("No active domain configuration found");
                    return;
                }
            }

            setIsCrawling(true);
            const workspaceId = localStorage.getItem('workspaceId') || 'ws_1758689602670_z3pxonjqn';
            toast.info("Starting news crawl... This may take a minute.");
            
            const response = await axios.post(
                `${API_URL}/domain/trigger-news-crawl`,
                { domainId: targetDomainId },
                {
                    headers: authHeaders(workspaceId),
                }
            );
            
            const result = response.data.pythonResponse || response.data;
            
            if (result.status === 'completed') {
                toast.success(`Search completed! Found ${result.article_count} new findings.`);
                handleRefresh();
            } else {
                toast.error(result.message || 'Monitor run failed');
            }
        } catch (error: any) {
            console.error('Error triggering news monitor:', error);
            const d = error.response?.data;
            const errorMsg =
                (typeof d?.detail === 'string' ? d.detail : null) ||
                (typeof d?.error === 'string' ? d.error : null) ||
                (typeof d?.details === 'string' ? d.details : null) ||
                (d?.detail != null ? String(d.detail) : null) ||
                error.message ||
                'Failed to trigger monitor';
            toast.error(errorMsg);
        } finally {
            setIsCrawling(false);
        }
    };

    return (
        <div className="min-h-screen bg-white flex flex-col">
            <Navbar
                showSearch
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                onSidebarOpen={() => { }}
                sidebarOpen={false}
            />

            <main className="flex-1 max-w-[100vw]  h-[90vh] fixed top-[10vh] overflow-y-auto w-full m-auto px-6 py-6">
                {/* Stats Summary */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                        <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total</div>
                            <div className="text-2xl font-bold text-[#232323]">
                                {stats.totalCompanies ?? stats.totalArticles}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">Companies</div>
                            {stats.totalCompanies != null &&
                                stats.totalArticles > stats.totalCompanies && (
                                    <div className="text-xs text-gray-400 mt-1">
                                        {stats.totalArticles} article sources
                                    </div>
                                )}
                        </div>
                        {/* 
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-green-700 uppercase tracking-wide mb-1">Positive</div>
                            <div className="text-2xl font-bold text-green-700">{stats.sentimentSummary.positive}</div>
                            <div className="text-xs text-green-600 mt-1">Good news</div>
                        </div> */}

                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-red-700 uppercase tracking-wide mb-1">Negative</div>
                            <div className="text-2xl font-bold text-red-700">{stats.sentimentSummary.negative}</div>
                            <div className="text-xs text-red-600 mt-1">Critical alerts</div>
                        </div>

                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-green-700 uppercase tracking-wide mb-1">Low Risk</div>
                            <div className="text-2xl font-bold text-green-700">{stats.riskDistribution.LOW}</div>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-yellow-700 uppercase tracking-wide mb-1">Medium</div>
                            <div className="text-2xl font-bold text-yellow-700">{stats.riskDistribution.MEDIUM}</div>
                        </div>

                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="text-xs text-red-700 uppercase tracking-wide mb-1">High Risk</div>
                            <div className="text-2xl font-bold text-red-700">
                                {stats.riskDistribution.HIGH + stats.riskDistribution.CRITICAL}
                            </div>
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="bg-[#F7F5F0] border border-gray-200 rounded-lg p-2 mb-2">
                    <div className="flex items-center justify-between pt-2 mb-2">
                        <button
                            className="flex items-center gap-2 text-sm font-semibold text-[#4B2A06] hover:text-[#FF7A1A] transition-colors"
                            onClick={() => setShowFilters(!showFilters)}
                        >
                            <Filter className="h-4 w-4" />
                            Filters
                            <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                        </button>
                        <div className="flex items-center gap-3">
                            {/* Time Filter Dropdown */}
                            <div className="relative">
                                <button
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-semibold"
                                    onClick={() => setShowTimeFilter(!showTimeFilter)}
                                >
                                    <Calendar className="h-4 w-4" />
                                    <span>
                                        {timeFilter === 'today' && 'Today'}
                                        {timeFilter === 'yesterday' && 'Yesterday'}
                                        {timeFilter === 'last7' && 'Last 7 days'}
                                        {timeFilter === 'last30' && 'Last 30 days'}
                                        {timeFilter === 'all' && 'All Time'}
                                    </span>
                                    <ChevronDown className="h-4 w-4" />
                                </button>

                                {showTimeFilter && (
                                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                                        <div className="py-1">
                                            <button
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${timeFilter === 'today' ? 'bg-[#F7F5F0] text-[#4B2A06] font-semibold' : 'text-gray-700'
                                                    }`}
                                                onClick={() => {
                                                    setTimeFilter('today');
                                                    setShowTimeFilter(false);
                                                }}
                                            >
                                                Today
                                            </button>
                                            <button
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${timeFilter === 'yesterday' ? 'bg-[#F7F5F0] text-[#4B2A06] font-semibold' : 'text-gray-700'
                                                    }`}
                                                onClick={() => {
                                                    setTimeFilter('yesterday');
                                                    setShowTimeFilter(false);
                                                }}
                                            >
                                                Yesterday
                                            </button>
                                            <button
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${timeFilter === 'last7' ? 'bg-[#F7F5F0] text-[#4B2A06] font-semibold' : 'text-gray-700'
                                                    }`}
                                                onClick={() => {
                                                    setTimeFilter('last7');
                                                    setShowTimeFilter(false);
                                                }}
                                            >
                                                Last 7 days
                                            </button>
                                            <button
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${timeFilter === 'last30' ? 'bg-[#F7F5F0] text-[#4B2A06] font-semibold' : 'text-gray-700'
                                                    }`}
                                                onClick={() => {
                                                    setTimeFilter('last30');
                                                    setShowTimeFilter(false);
                                                }}
                                            >
                                                Last 30 days
                                            </button>
                                            <button
                                                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${timeFilter === 'all' ? 'bg-[#F7F5F0] text-[#4B2A06] font-semibold' : 'text-gray-700'
                                                    }`}
                                                onClick={() => {
                                                    setTimeFilter('all');
                                                    setShowTimeFilter(false);
                                                }}
                                            >
                                                All Time
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                className={`flex items-center gap-1.5 ml-2 px-3 py-1.5 bg-[#FF7A1A] text-white text-xs font-bold rounded-lg hover:bg-[#4B2A06] transition-all ${isCrawling ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={handleTriggerCrawl}
                                disabled={isCrawling}
                            >
                                <Zap className={`h-4 w-4 ${isCrawling ? 'animate-pulse' : ''}`} />
                                {isCrawling ? 'Crawling...' : 'Run Monitor Now'}
                            </button>

                            <button
                                className="flex items-center gap-1.5 text-xs text-[#4B2A06] hover:text-[#FF7A1A] font-semibold transition-colors"
                                onClick={handleRefresh}
                                title="Refresh news"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh
                            </button>
                            {(selectedCompany || selectedSentiment || selectedCategory) && (
                                <button
                                    className="text-xs text-[#FF7A1A] hover:underline font-semibold"
                                    onClick={clearFilters}
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>
                    </div>

                    {showFilters && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                                type="text"
                                placeholder="Filter by company..."
                                value={selectedCompany}
                                onChange={(e) => setSelectedCompany(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A1A] focus:border-transparent"
                            />

                            <select
                                value={selectedSentiment}
                                onChange={(e) => setSelectedSentiment(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A1A] focus:border-transparent"
                            >
                                <option value="">All Sentiments</option>
                                <option value="positive">✓ Positive News</option>
                                <option value="negative">⚠ Negative News</option>
                                <option value="neutral">○ Neutral Updates</option>
                            </select>

                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A1A] focus:border-transparent"
                            >
                                <option value="">All Categories</option>
                                <option value="Operational">Operational</option>
                                <option value="Strategic">Strategic</option>
                                <option value="Regulatory">Regulatory</option>
                                <option value="Financial">Financial</option>
                                <option value="Legal">Legal</option>
                            </select>
                        </div>
                    )}
                </div>

                {/* Results Count — one row per company; article rows may be merged */}
                <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-600">
                        Showing{' '}
                        <span className="font-semibold text-[#232323]">{companyGroups.length}</span>{' '}
                        {companyGroups.length === 1 ? 'company' : 'companies'}
                        {articles.length > companyGroups.length && (
                            <span className="text-gray-500">
                                {' '}
                                ({articles.length} sources)
                            </span>
                        )}
                        {timeFilter !== 'all' && (
                            <span className="text-[#FF7A1A] font-semibold ml-1">
                                {timeFilter === 'today' && '(Today)'}
                                {timeFilter === 'yesterday' && '(Yesterday)'}
                                {timeFilter === 'last7' && '(Last 7 days)'}
                                {timeFilter === 'last30' && '(Last 30 days)'}
                            </span>
                        )}
                    </p>
                </div>

                {/* News Feed - Full Width Cards */}
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="text-center">
                            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF7A1A] mb-4"></div>
                            <p className="text-gray-500">Loading latest news...</p>
                        </div>
                    </div>
                ) : companyGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                        <TrendingUp className="h-16 w-16 mb-4 opacity-30" />
                        <p className="text-lg font-semibold mb-2">No articles found</p>
                        <p className="text-sm">Try adjusting your filters to see more results</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-1 gap-6 ">
                        {companyGroups.map((group) => {
                            const { primary, sentiment, riskLevel, findings } = mergeGroupDisplay(group.articles);
                            const sentimentConfig = getSentimentConfig(sentiment);
                            const ids = group.articles.map((a) => a._id);

                            return (
                                <div
                                    key={group.key}
                                    className={`${sentimentConfig.bgColor} border-2 ${sentimentConfig.borderColor} rounded-xl overflow-hidden hover:shadow-2xl transition-all duration-300`}
                                >
                                    <div className="px-4 py-2">
                                        {/* Header with Company and Sentiment */}
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${sentimentConfig.badgeColor}`}>
                                                    <Building2 className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-[#232323]">{group.company}</h3>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        <span className="text-xs text-gray-500 flex items-center gap-1">
                                                            <Calendar className="h-3 w-3" />
                                                            {formatDate(primary.publishedDate)}
                                                        </span>
                                                        {group.articles.length > 1 && (
                                                            <>
                                                                <span className="text-xs text-gray-400">•</span>
                                                                <span className="text-xs text-gray-600">
                                                                    {group.articles.length} saved stories
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap justify-end">
                                                <div className={`flex items-center gap-2 px-2 py-1 rounded-full ${sentimentConfig.badgeColor} text-xs`}>
                                                    {sentimentConfig.icon}
                                                    <span className="capitalize">{sentiment}</span>
                                                </div>
                                                {riskLevel && (
                                                    <span className={`px-2 py-1 rounded-full text-xs uppercase ${getRiskLevelColor(riskLevel)}`}>
                                                        {riskLevel}
                                                    </span>
                                                )}

                                                <span className="inline-flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-3 py-1 rounded-full text-xs font-semibold">
                                                    <Tag className="h-3 w-3" />
                                                    {primary.category}
                                                </span>

                                                <button
                                                    onClick={() => handleDeleteGroup(ids)}
                                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Delete all articles for this company"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Title/Description */}
                                        <div className={`mb-2 ${sentimentConfig.textColor}`}>
                                            <p className="text-sm text-gray leading-relaxed">
                                                {primary.description}
                                            </p>
                                        </div>

                                        {/* Key Finding (if available) */}
                                        {findings && findings !== primary.description && (
                                            <div className={`p-4 rounded-lg border-l-4 mb-4 ${sentiment === 'positive'
                                                ? 'bg-green-100 border-green-500'
                                                : sentiment === 'negative'
                                                    ? 'bg-red-100 border-red-500'
                                                    : 'bg-gray-100 border-gray-500'
                                                }`}>
                                                <div className="flex items-start gap-2">
                                                    <AlertCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${sentiment === 'positive'
                                                        ? 'text-green-700'
                                                        : sentiment === 'negative'
                                                            ? 'text-red-700'
                                                            : 'text-gray-700'
                                                        }`} />
                                                    <div>
                                                        <p className="text-xs font-bold uppercase tracking-wide mb-1 opacity-75">
                                                            Key Finding
                                                        </p>
                                                        <p className="text-sm leading-relaxed">
                                                            {findings}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Footer — one button per outbound link */}
                                        <div className="flex flex-col gap-2 pt-2 border-t border-gray-200">
                                            <div className="text-xs text-gray-500 mb-1">
                                                Open a source:
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {(group.sourceLinks.length > 0
                                                    ? group.sourceLinks
                                                    : primary.url
                                                        ? [{ url: primary.url, label: primary.source || 'View' }]
                                                        : []
                                                ).map((link, idx) => (
                                                    <a
                                                        key={`${link.url}-${idx}`}
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FF7A1A] text-white rounded-lg text-xs font-semibold hover:bg-[#4B2A06] transition-colors"
                                                    >
                                                        {link.label}
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
};

export default NewsArticles;
