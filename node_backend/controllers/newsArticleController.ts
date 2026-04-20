import { Request, Response } from 'express';
import NewsArticle from '../models/NewsArticle';
import NewsCrawlResult from '../models/NewsCrawlResult';
import { AuthRequest } from '../middleware/auth';

/**
 * Articles may be keyed by domainId (crawler) or workspaceId (legacy). When both JWT domain
 * and x-workspace are present, match either so listings work across workspace/header mismatches.
 */
function tenantScope(req: AuthRequest): Record<string, unknown> | null {
    const domainId = req.userDomain;
    const workspaceId = req.headers['x-workspace'] as string | undefined;
    if (domainId && workspaceId) {
        return { $or: [{ domainId }, { workspaceId }] };
    }
    if (domainId) {
        return { domainId };
    }
    if (workspaceId) {
        return { workspaceId };
    }
    return null;
}

export const newsArticleController = {
    // POST endpoint for n8n to submit news articles
    async submitNewsArticles(req: Request, res: Response) {
        try {
            const articles = req.body;

            // Get workspace and domain from headers or body defaults
            const workspaceId = (req.headers['x-workspace'] as string) ||
                req.body.workspaceId ||
                'ws_1758689602670_z3pxonjqn';
            const domainId = (req.headers['x-domain'] as string) ||
                req.body.domainId ||
                'domain_excollo-com_1762104581969';

            // Handle both single article and array of articles
            const articlesArray = Array.isArray(articles) ? articles : [articles];

            const savedArticles = [];

            for (const article of articlesArray) {
                try {
                    // Create or update article (upsert by URL to avoid duplicates)
                    const newsArticle = await NewsArticle.findOneAndUpdate(
                        { url: article.url },
                        {
                            title: article.title,
                            description: article.description,
                            url: article.url,
                            imageUrl: article.imageUrl || article.image_url,
                            source: article.source,
                            publishedDate: new Date(article.published_date || article.publishedDate || Date.now()),
                            company: article.company,
                            category: article.category,
                            sentiment: article.sentiment,
                            riskLevel: article.risk_level || article.riskLevel,
                            findings: article.finding || article.findings,
                            workspaceId,
                            domainId,
                            crawledAt: new Date(),
                        },
                        {
                            upsert: true,
                            new: true,
                            setDefaultsOnInsert: true,
                        }
                    );

                    savedArticles.push(newsArticle);
                } catch (err: any) {
                    console.error('Error saving article:', err);
                    // Continue with next article even if one fails
                }
            }

            res.status(201).json({
                message: 'News articles saved successfully',
                count: savedArticles.length,
                articles: savedArticles,
            });
        } catch (error: any) {
            console.error('Error saving news articles:', error);
            res.status(500).json({
                message: 'Error saving news articles',
                error: error.message,
            });
        }
    },

    // GET all news articles with filters
    async getNewsArticles(req: AuthRequest, res: Response) {
        try {
            const {
                company,
                sentiment,
                riskLevel,
                category,
                source,
                startDate,
                endDate,
                search,
                page = 1,
                limit = 20,
            } = req.query;

            const scope = tenantScope(req);
            if (!scope) {
                return res.status(400).json({ message: 'Domain or workspace context required' });
            }

            // Build query (domainId matches Python crawler saves; workspace-only legacy)
            const query: any = { ...scope };

            if (company) {
                query.company = { $regex: company, $options: 'i' };
            }

            if (sentiment) {
                query.sentiment = sentiment;
            }

            if (riskLevel) {
                query.riskLevel = riskLevel;
            }

            if (category) {
                query.category = category;
            }

            if (source) {
                query.source = { $regex: source, $options: 'i' };
            }

            if (search) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } },
                ];
            }

            if (startDate || endDate) {
                query.crawledAt = {};
                if (startDate) query.crawledAt.$gte = new Date(startDate as string);
                if (endDate) query.crawledAt.$lte = new Date(endDate as string);
            }

            // Execute query with pagination
            const skip = (Number(page) - 1) * Number(limit);

            const articles = await NewsArticle.find(query)
                .sort({ crawledAt: -1 })
                .skip(skip)
                .limit(Number(limit));

            const total = await NewsArticle.countDocuments(query);

            res.json({
                articles,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            console.error('Error fetching news articles:', error);
            res.status(500).json({
                message: 'Error fetching news articles',
                error: error.message,
            });
        }
    },

    // GET dashboard stats for news articles
    async getArticleStats(req: AuthRequest, res: Response) {
        try {
            const { startDate, endDate } = req.query;

            const scope = tenantScope(req);
            if (!scope) {
                return res.status(400).json({ message: 'Domain or workspace context required' });
            }

            // Build base query with date filters if provided
            const baseQuery: any = { ...scope };
            if (startDate || endDate) {
                baseQuery.crawledAt = {};
                if (startDate) baseQuery.crawledAt.$gte = new Date(startDate as string);
                if (endDate) baseQuery.crawledAt.$lte = new Date(endDate as string);
            }

            const companyKeyExpr = {
                $let: {
                    vars: {
                        t: {
                            $trim: {
                                input: { $ifNull: ['$company', 'Unknown'] },
                            },
                        },
                    },
                    in: {
                        $cond: [
                            { $eq: [{ $strLenCP: '$$t' }, 0] },
                            'unknown',
                            { $toLower: '$$t' },
                        ],
                    },
                },
            };

            const [
                totalArticles,
                companyAgg,
                topCompanies,
                recentArticles,
            ] = await Promise.all([
                NewsArticle.countDocuments(baseQuery),
                NewsArticle.aggregate([
                    { $match: baseQuery },
                    {
                        $addFields: {
                            companyKey: companyKeyExpr,
                            sentimentRank: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$sentiment', 'negative'] }, then: 3 },
                                        { case: { $eq: ['$sentiment', 'neutral'] }, then: 2 },
                                        { case: { $eq: ['$sentiment', 'positive'] }, then: 1 },
                                    ],
                                    default: 0,
                                },
                            },
                            riskRank: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$riskLevel', 'CRITICAL'] }, then: 4 },
                                        { case: { $eq: ['$riskLevel', 'HIGH'] }, then: 3 },
                                        { case: { $eq: ['$riskLevel', 'MEDIUM'] }, then: 2 },
                                        { case: { $eq: ['$riskLevel', 'LOW'] }, then: 1 },
                                    ],
                                    default: 0,
                                },
                            },
                        },
                    },
                    {
                        $group: {
                            _id: '$companyKey',
                            maxSentRank: { $max: '$sentimentRank' },
                            maxRiskRank: { $max: '$riskRank' },
                        },
                    },
                ]),
                NewsArticle.aggregate([
                    { $match: baseQuery },
                    { $group: { _id: '$company', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 10 },
                ]),
                NewsArticle.find(baseQuery)
                    .sort({ crawledAt: -1 })
                    .limit(5),
            ]);

            /** One row per company — same merge rule as News Monitor cards (max sentiment / max risk). */
            const sentimentSummary = {
                positive: 0,
                negative: 0,
                neutral: 0,
            };
            const riskDistribution = {
                LOW: 0,
                MEDIUM: 0,
                HIGH: 0,
                CRITICAL: 0,
            };

            for (const row of companyAgg) {
                const sr = row.maxSentRank ?? 0;
                if (sr >= 3) sentimentSummary.negative += 1;
                else if (sr === 2) sentimentSummary.neutral += 1;
                else if (sr === 1) sentimentSummary.positive += 1;
                else sentimentSummary.neutral += 1;

                const rr = row.maxRiskRank ?? 0;
                if (rr === 4) riskDistribution.CRITICAL += 1;
                else if (rr === 3) riskDistribution.HIGH += 1;
                else if (rr === 2) riskDistribution.MEDIUM += 1;
                else if (rr === 1) riskDistribution.LOW += 1;
            }

            const totalCompanies = companyAgg.length;

            res.json({
                totalCompanies,
                totalArticles,
                sentimentSummary,
                riskDistribution,
                topCompanies,
                recentArticles,
                lastCrawlDate: recentArticles[0]?.crawledAt || null,
            });
        } catch (error: any) {
            console.error('Error fetching article stats:', error);
            res.status(500).json({
                message: 'Error fetching article stats',
                error: error.message,
            });
        }
    },

    // GET single article by ID
    async getArticleById(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const scope = tenantScope(req);
            if (!scope) {
                return res.status(400).json({ message: 'Domain or workspace context required' });
            }

            const article = await NewsArticle.findOne({
                _id: id,
                ...scope,
            });

            if (!article) {
                return res.status(404).json({ message: 'Article not found' });
            }

            res.json(article);
        } catch (error: any) {
            console.error('Error fetching article:', error);
            res.status(500).json({
                message: 'Error fetching article',
                error: error.message,
            });
        }
    },

    // GET articles by company
    async getArticlesByCompany(req: AuthRequest, res: Response) {
        try {
            const { company } = req.params;
            const { page = 1, limit = 20 } = req.query;
            const scope = tenantScope(req);
            if (!scope) {
                return res.status(400).json({ message: 'Domain or workspace context required' });
            }

            const skip = (Number(page) - 1) * Number(limit);

            const articles = await NewsArticle.find({
                company: { $regex: company, $options: 'i' },
                ...scope,
            })
                .sort({ publishedDate: -1 })
                .skip(skip)
                .limit(Number(limit));

            const total = await NewsArticle.countDocuments({
                company: { $regex: company, $options: 'i' },
                ...scope,
            });

            res.json({
                articles,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            console.error('Error fetching company articles:', error);
            res.status(500).json({
                message: 'Error fetching company articles',
                error: error.message,
            });
        }
    },

    // DELETE article by ID
    async deleteArticle(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const scope = tenantScope(req);
            if (!scope) {
                return res.status(400).json({ message: 'Domain or workspace context required' });
            }

            const result = await NewsArticle.findOneAndDelete({
                _id: id,
                ...scope,
            });

            if (!result) {
                return res.status(404).json({ message: 'Article not found or access denied' });
            }

            res.json({ message: 'Article deleted successfully' });
        } catch (error: any) {
            console.error('Error deleting article:', error);
            res.status(500).json({
                message: 'Error deleting article',
                error: error.message,
            });
        }
    }
};
