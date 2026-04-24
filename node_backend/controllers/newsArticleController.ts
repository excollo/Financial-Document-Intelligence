import { Request, Response } from 'express';
import NewsArticle from '../models/NewsArticle';
import NewsCrawlResult from '../models/NewsCrawlResult';

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
    async getNewsArticles(req: Request, res: Response) {
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

            const workspaceId = req.headers['x-workspace'] as string;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            // Build query
            const query: any = { workspaceId };

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

            // Return one consolidated card per company with merged source links.
            const skip = (Number(page) - 1) * Number(limit);
            const riskOrderExpr = {
                $switch: {
                    branches: [
                        { case: { $eq: ['$riskLevel', 'CRITICAL'] }, then: 4 },
                        { case: { $eq: ['$riskLevel', 'HIGH'] }, then: 3 },
                        { case: { $eq: ['$riskLevel', 'MEDIUM'] }, then: 2 },
                        { case: { $eq: ['$riskLevel', 'LOW'] }, then: 1 },
                    ],
                    default: 0,
                }
            };

            const groupedRows = await NewsArticle.aggregate([
                { $match: query },
                {
                    $addFields: {
                        _riskRank: riskOrderExpr,
                        _publishedDateSafe: { $ifNull: ['$publishedDate', '$crawledAt'] },
                    }
                },
                // Sort so first item in each group is newest + highest risk.
                { $sort: { company: 1, _riskRank: -1, _publishedDateSafe: -1, crawledAt: -1 } },
                {
                    $group: {
                        _id: '$company',
                        representative: { $first: '$$ROOT' },
                        maxRisk: { $max: '$_riskRank' },
                        urls: { $addToSet: '$url' },
                        sources: { $addToSet: '$source' },
                        descriptions: { $addToSet: '$description' },
                        findingsList: { $addToSet: '$findings' },
                        sentiments: { $addToSet: '$sentiment' },
                        categories: { $addToSet: '$category' },
                    }
                },
                { $sort: { 'representative.crawledAt': -1 } },
                { $skip: skip },
                { $limit: Number(limit) },
            ]);

            const riskByRank: Record<number, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
                1: 'LOW',
                2: 'MEDIUM',
                3: 'HIGH',
                4: 'CRITICAL',
            };

            const articles = groupedRows.map((row: any) => {
                const rep = row.representative || {};
                const cleanUrls = (row.urls || []).filter((u: any) => typeof u === 'string' && u.trim().length > 0);
                const cleanSources = (row.sources || []).filter((s: any) => typeof s === 'string' && s.trim().length > 0);
                const cleanFindings = (row.findingsList || []).filter((f: any) => typeof f === 'string' && f.trim().length > 0);
                const mergedFinding = cleanFindings.length > 0
                    ? cleanFindings.slice(0, 3).join(' | ')
                    : rep.findings || rep.description || '';

                return {
                    ...rep,
                    company: row._id,
                    url: cleanUrls[0] || rep.url,
                    citations: cleanUrls,
                    source: cleanSources.join(', ') || rep.source,
                    findings: mergedFinding,
                    riskLevel: riskByRank[row.maxRisk] || rep.riskLevel || 'LOW',
                };
            });

            const groupedTotalRows = await NewsArticle.aggregate([
                { $match: query },
                { $group: { _id: '$company' } },
                { $count: 'total' }
            ]);
            const total = groupedTotalRows[0]?.total || 0;

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
    async getArticleStats(req: Request, res: Response) {
        try {
            const workspaceId = req.headers['x-workspace'] as string;
            const { startDate, endDate } = req.query;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            // Build base query with date filters if provided
            const baseQuery: any = { workspaceId };
            if (startDate || endDate) {
                baseQuery.crawledAt = {};
                if (startDate) baseQuery.crawledAt.$gte = new Date(startDate as string);
                if (endDate) baseQuery.crawledAt.$lte = new Date(endDate as string);
            }

            const riskOrderExpr = {
                $switch: {
                    branches: [
                        { case: { $eq: ['$riskLevel', 'CRITICAL'] }, then: 4 },
                        { case: { $eq: ['$riskLevel', 'HIGH'] }, then: 3 },
                        { case: { $eq: ['$riskLevel', 'MEDIUM'] }, then: 2 },
                        { case: { $eq: ['$riskLevel', 'LOW'] }, then: 1 },
                    ],
                    default: 0,
                }
            };

            const companySummaries = await NewsArticle.aggregate([
                { $match: baseQuery },
                {
                    $addFields: {
                        _riskRank: riskOrderExpr,
                        _publishedDateSafe: { $ifNull: ['$publishedDate', '$crawledAt'] },
                    }
                },
                { $sort: { company: 1, _riskRank: -1, _publishedDateSafe: -1, crawledAt: -1 } },
                {
                    $group: {
                        _id: '$company',
                        representative: { $first: '$$ROOT' },
                        maxRisk: { $max: '$_riskRank' },
                        sentiment: { $first: '$sentiment' },
                    }
                },
                { $sort: { 'representative.crawledAt': -1 } },
            ]);

            // Format sentiment counts
            const sentimentSummary = {
                positive: 0,
                negative: 0,
                neutral: 0,
            };
            companySummaries.forEach((item: any) => {
                const sentiment = item.sentiment as keyof typeof sentimentSummary;
                if (sentimentSummary[sentiment] !== undefined) {
                    sentimentSummary[sentiment] += 1;
                }
            });

            // Format risk counts
            const riskDistribution = {
                LOW: 0,
                MEDIUM: 0,
                HIGH: 0,
                CRITICAL: 0,
            };
            companySummaries.forEach((item: any) => {
                if (item.maxRisk >= 4) riskDistribution.CRITICAL += 1;
                else if (item.maxRisk === 3) riskDistribution.HIGH += 1;
                else if (item.maxRisk === 2) riskDistribution.MEDIUM += 1;
                else if (item.maxRisk === 1) riskDistribution.LOW += 1;
            });

            const companyCounts = companySummaries.slice(0, 10).map((item: any) => ({
                _id: item._id,
                count: 1,
            }));
            const recentArticles = companySummaries.slice(0, 5).map((item: any) => item.representative);
            const totalArticles = companySummaries.length;

            res.json({
                totalArticles,
                sentimentSummary,
                riskDistribution,
                topCompanies: companyCounts,
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
    async getArticleById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const workspaceId = req.headers['x-workspace'] as string;

            const article = await NewsArticle.findOne({
                _id: id,
                workspaceId,
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
    async getArticlesByCompany(req: Request, res: Response) {
        try {
            const { company } = req.params;
            const { page = 1, limit = 20 } = req.query;
            const workspaceId = req.headers['x-workspace'] as string;

            const skip = (Number(page) - 1) * Number(limit);

            const articles = await NewsArticle.find({
                company: { $regex: company, $options: 'i' },
                workspaceId,
            })
                .sort({ publishedDate: -1 })
                .skip(skip)
                .limit(Number(limit));

            const total = await NewsArticle.countDocuments({
                company: { $regex: company, $options: 'i' },
                workspaceId,
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
    async deleteArticle(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const workspaceId = req.headers['x-workspace'] as string;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            const result = await NewsArticle.findOneAndDelete({
                _id: id,
                workspaceId
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
