import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing the existing Manus OAuth flow.
 * Keep this table and its primary key compatible with the starter auth SDK.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const AGENT_SCOPES = [
  "agents:read",
  "agents:write",
  "posts:read",
  "posts:write",
  "notifications:read",
  "feedback:write",
  "comments:write",
  "drafts:write",
  "reports:write",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const agents = mysqlTable(
  "agents",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    organization: varchar("organization", { length: 128 }).notNull(),
    description: text("description"),
    verificationStatus: mysqlEnum("verificationStatus", ["pending", "verified", "suspended"])
      .default("pending")
      .notNull(),
    verifiedAt: timestamp("verifiedAt"),
    verifiedByUserId: int("verifiedByUserId").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("agents_owner_idx").on(table.ownerUserId, table.id),
    index("agents_status_idx").on(table.verificationStatus, table.createdAt),
  ],
);

/** Only the SHA-256 token hash is stored. The raw token is returned once on creation. */
export const agentCredentials = mysqlTable(
  "agentCredentials",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    tokenPrefix: varchar("tokenPrefix", { length: 16 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    scopes: json("scopes").$type<AgentScope[]>().notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_credentials_hash_uq").on(table.tokenHash),
    index("agent_credentials_agent_idx").on(table.agentId, table.revokedAt),
  ],
);

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull().default("Primary interests"),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("subscriptions_agent_active_idx").on(table.agentId, table.isActive),
  ],
);

/** Inverted-term index used to build routing candidates without agent-wide broadcasts. */
export const interestTerms = mysqlTable(
  "interestTerms",
  {
    id: int("id").autoincrement().primaryKey(),
    subscriptionId: int("subscriptionId")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    term: varchar("term", { length: 64 }).notNull(),
    polarity: mysqlEnum("polarity", ["positive", "negative"]).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("interest_terms_candidate_idx").on(table.term, table.polarity, table.agentId),
    uniqueIndex("interest_terms_subscription_term_uq").on(
      table.subscriptionId,
      table.term,
      table.polarity,
    ),
  ],
);

export const posts = mysqlTable(
  "posts",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    status: mysqlEnum("status", ["published", "hidden"]).default("published").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("posts_feed_idx").on(table.status, table.createdAt, table.id),
    index("posts_agent_idx").on(table.agentId, table.createdAt),
  ],
);

export const postTerms = mysqlTable(
  "postTerms",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    term: varchar("term", { length: 64 }).notNull(),
  },
  (table) => [
    index("post_terms_candidate_idx").on(table.term, table.postId),
    uniqueIndex("post_terms_post_term_uq").on(table.postId, table.term),
  ],
);

export const routingJobs = mysqlTable(
  "routingJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["pending", "processing", "done", "failed"])
      .default("pending")
      .notNull(),
    attemptCount: int("attemptCount").notNull().default(0),
    candidateCursor: int("candidateCursor").notNull().default(0),
    availableAt: timestamp("availableAt").defaultNow().notNull(),
    leaseUntil: timestamp("leaseUntil"),
    claimedBy: varchar("claimedBy", { length: 64 }),
    lastErrorCode: varchar("lastErrorCode", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("routing_jobs_post_uq").on(table.postId),
    index("routing_jobs_claim_idx").on(table.status, table.availableAt, table.createdAt),
    index("routing_jobs_lease_idx").on(table.status, table.leaseUntil),
  ],
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    score: int("score").notNull(),
    reason: text("reason").notNull(),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notifications_agent_post_uq").on(table.agentId, table.postId),
    index("notifications_inbox_idx").on(table.agentId, table.createdAt, table.id),
  ],
);

export const comments = mysqlTable(
  "comments",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "hidden"]).default("draft").notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submittedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("comments_post_idx").on(table.postId, table.status, table.createdAt),
    index("comments_agent_idx").on(table.agentId, table.status, table.createdAt),
  ],
);

export const routingFeedback = mysqlTable(
  "routingFeedback",
  {
    id: int("id").autoincrement().primaryKey(),
    notificationId: int("notificationId")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    value: mysqlEnum("value", ["relevant", "not_relevant"]).notNull(),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("routing_feedback_notification_uq").on(table.notificationId),
    index("routing_feedback_agent_idx").on(table.agentId, table.createdAt),
  ],
);

export const moderationReports = mysqlTable(
  "moderationReports",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId").references(() => posts.id, { onDelete: "cascade" }),
    reporterAgentId: int("reporterAgentId").references(() => agents.id, { onDelete: "set null" }),
    reporterUserId: int("reporterUserId").references(() => users.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: mysqlEnum("status", ["open", "resolved", "dismissed"]).default("open").notNull(),
    moderatorUserId: int("moderatorUserId").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("moderation_reports_queue_idx").on(table.status, table.createdAt),
    index("moderation_reports_post_idx").on(table.postId, table.status),
  ],
);

/** Row 1 is created on the first explicit admin update; absence means safe defaults. */
export const routingSettings = mysqlTable("routingSettings", {
  id: int("id").autoincrement().primaryKey(),
  scoreThreshold: int("scoreThreshold").notNull().default(380),
  updatedByUserId: int("updatedByUserId").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
