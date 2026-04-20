import mongoose, { Schema, Document } from 'mongoose';

export interface INewsArticle extends Document {
    title: string;
    description: string;
    url: string;
    imageUrl?: string;
    source: string;
    publishedDate: Date;
    company: string;
    category: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    confidence?: 'low' | 'medium' | 'high';
    findings?: string;
    /** Same story from RSS + Serper: multiple sources */
    citations?: Array<{ url: string; title?: string; source?: string }>;
    workspaceId: string;
    domainId: string;
    crawledAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const NewsArticleSchema: Schema = new Schema(
    {
        title: {
            type: String,
            required: true,
            index: true,
        },
        description: {
            type: String,
            required: true,
        },
        url: {
            type: String,
            required: true,
            unique: true,
        },
        imageUrl: {
            type: String,
        },
        source: {
            type: String,
            required: true,
            index: true,
        },
        publishedDate: {
            type: Date,
            required: true,
            index: true,
        },
        company: {
            type: String,
            required: true,
            index: true,
        },
        category: {
            type: String,
            required: true,
            index: true,
        },
        sentiment: {
            type: String,
            enum: ['positive', 'negative', 'neutral'],
            required: true,
            index: true,
        },
        riskLevel: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        },
        confidence: {
            type: String,
            enum: ['low', 'medium', 'high'],
        },
        findings: {
            type: String,
        },
        citations: {
            type: [
                {
                    url: { type: String, required: true },
                    title: { type: String },
                    source: { type: String },
                },
            ],
            default: undefined,
        },
        workspaceId: {
            type: String,
            required: true,
            index: true,
        },
        domainId: {
            type: String,
            required: true,
            index: true,
        },
        crawledAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Compound indexes
NewsArticleSchema.index({ workspaceId: 1, company: 1, publishedDate: -1 });
NewsArticleSchema.index({ workspaceId: 1, sentiment: 1 });
NewsArticleSchema.index({ workspaceId: 1, riskLevel: 1 });
NewsArticleSchema.index({ workspaceId: 1, category: 1 });

export default mongoose.model<INewsArticle>('NewsArticle', NewsArticleSchema);
