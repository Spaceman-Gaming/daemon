import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pgTable, timestamp, vector, text } from "drizzle-orm/pg-core";
import { cosineDistance } from "drizzle-orm";
import { sql, eq, desc, gte, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AIConfig, PostgresConfig } from "./types";
import { embed } from "ai";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import postgres from "postgres";

export class RecencyRAG {
    private db: PostgresJsDatabase<typeof RecencyRAGSchema> | undefined;
    private dbInitPromise: Promise<void>;
    private aiConfig: AIConfig;
    private openai: OpenAIProvider | undefined;

    constructor(aiConfig: AIConfig, postgresConfig: PostgresConfig) {
        this.aiConfig = aiConfig;
        this.openai = createOpenAI({
            baseURL: aiConfig.baseUrl ?? "https://api.openai.com/v1",
            apiKey: aiConfig.apiKey ?? process.env.OPENAI_API_KEY
        });

        // Initialize database connection
        this.dbInitPromise = this.initializeDatabase(postgresConfig);
    }

    private async initializeDatabase(postgresConfig: PostgresConfig): Promise<void> {
        try {
            // First connect to the default postgres database to check if our target database exists
            const defaultConfig = {
                ...postgresConfig,
                database: 'postgres' // Connect to default postgres database
            };
            
            const sql = postgres(defaultConfig);
            
            // Check if database exists and create it if it doesn't
            const result = await sql`
                SELECT 'CREATE DATABASE ${sql(postgresConfig.database)}'
                WHERE NOT EXISTS (
                    SELECT FROM pg_database WHERE datname = ${postgresConfig.database}
                )
            `;

            if (result.length > 0) {
                await sql`CREATE DATABASE ${sql(postgresConfig.database)}`;
            }
            await sql.end();

            // Now connect to our target database
            this.db = drizzle({
                connection: postgresConfig,
                schema: RecencyRAGSchema,
                casing: "snake_case",
            });
        } catch (error) {
            console.error("Error initializing database:", error);
            throw error;
        }
    }

    async init() {
        try {
            // Wait for database connection to be ready
            await this.dbInitPromise;
            
            if (!this.db) {
                throw new Error("Database connection not initialized");
            }

            await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

            const vectorDim = parseInt(this.aiConfig.vectorDimensions?.toString() ?? "1536");
            
            // Use raw string for the vector dimensions
            await this.db.execute(sql`CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                message TEXT NOT NULL,
                embeddings VECTOR(${sql.raw(vectorDim.toString())}) NOT NULL,
                timestamp TIMESTAMP DEFAULT NOW(),
                daemon_pubkey TEXT NOT NULL,
                channel_id TEXT
            )`);

            await this.db.execute(sql`CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages (timestamp)`);
            await this.db.execute(sql`CREATE INDEX IF NOT EXISTS messages_daemon_channel_idx ON messages (daemon_pubkey, channel_id)`);
            await this.db.execute(sql`CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id)`);
        } catch (error) {
            console.error("Failed to initialize RecencyRAG: ", error)
            throw error;
        }
    }

    async close() {}
    async insert(text: string, from: "user"| "agent", daemonPubkey: string, channelId?: string) {
        try {
            // Will be called twice, once for user message and once for AI message

            // Get embeddings on Text
            const embeddings = (await embed({
                model: this.openai!.textEmbeddingModel(this.aiConfig.embeddingModel ?? "text-embedding-3-small"),
                value: text,
            })).embedding as number[]; // Array<Number>


            const id = nanoid();
            await this.db?.insert(RecencyRAGSchema.messages).values({
                id: id,
                source: from,
                message: text,
                embeddings: embeddings,
                daemon_pubkey: daemonPubkey,
                channel_id: channelId ?? ""
            })

            return id;
        } catch (e: any){
            console.error("Failed to insert into RecencyRAG: ", e);
            throw e;
        }
    }
    async query(text: string, daemonPubkey: string, channelId?: string): Promise<string[]> {
        try {
            // Get embeddings for text

            const embeddings = (await embed({
                model: this.openai!.textEmbeddingModel(this.aiConfig.embeddingModel ?? "text-embedding-3-small"),
                value: text,
            })).embedding as number[]; // Array<Number>

            // Vector Text
            const similarityThreshold = 0.85; // TODO: Make this configurable
            const limit = 5; // TODO: Make this configurable
            const similarity = sql<number>`1 - (${cosineDistance(
                RecencyRAGSchema.messages.embeddings,
                embeddings
            )})`;

            // Get messages that match the vector search and belong to the daemon and channel_id

            const vectorSearchResults = await this.db?.select().from(RecencyRAGSchema.messages)
                .where(and(
                    eq(RecencyRAGSchema.messages.daemon_pubkey, daemonPubkey),
                    eq(RecencyRAGSchema.messages.channel_id, channelId ?? ""),
                    gte(similarity, similarityThreshold)
                ))
                .orderBy(desc(similarity))
                .limit(limit) ?? [];

            // Get last Y messages from channel_id that belong to the daemon
            const lastYMessages = await this.db?.select().from(RecencyRAGSchema.messages)
                .where(and(
                    eq(RecencyRAGSchema.messages.daemon_pubkey, daemonPubkey),
                    eq(RecencyRAGSchema.messages.channel_id, channelId ?? ""),
                ))
                .orderBy(desc(RecencyRAGSchema.messages.timestamp))
                .limit(limit) ?? [];

            return [...vectorSearchResults.map(result => result.message ?? ""), ...lastYMessages.map(result => result.message ?? "")];
        } catch (e: any){
            console.error("Failed to query RecencyRAG: ", e);
            throw e;
        }
    }
}

const messages = {
    id: text("id").primaryKey(),
    source: text("source"), // User or Agent
    message: text("message"),
    embeddings: vector("embeddings", {dimensions: 1536}).notNull(),
    timestamp: timestamp("timestamp").defaultNow(),
    channel_id: text("channel_id"),
    daemon_pubkey: text("daemon_pubkey").notNull(),
};

let RecencyRAGSchema = {
    messages: pgTable("messages", messages),
};

// RecenyRAG returns 2 sets of results
   // 1. Top N Vector Search Results
   // 2. Last Y Messages from Channel