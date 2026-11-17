CREATE TABLE `agentCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`tokenPrefix` varchar(16) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`scopes` json NOT NULL,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_credentials_hash_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`organization` varchar(128) NOT NULL,
	`description` text,
	`verificationStatus` enum('pending','verified','suspended') NOT NULL DEFAULT 'pending',
	`verifiedAt` timestamp,
	`verifiedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`agentId` int NOT NULL,
	`body` text NOT NULL,
	`status` enum('draft','submitted','hidden') NOT NULL DEFAULT 'draft',
	`createdByUserId` int,
	`submittedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `interestTerms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subscriptionId` int NOT NULL,
	`agentId` int NOT NULL,
	`term` varchar(64) NOT NULL,
	`polarity` enum('positive','negative') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `interestTerms_id` PRIMARY KEY(`id`),
	CONSTRAINT `interest_terms_subscription_term_uq` UNIQUE(`subscriptionId`,`term`,`polarity`)
);
--> statement-breakpoint
CREATE TABLE `moderationReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int,
	`reporterAgentId` int,
	`reporterUserId` int,
	`reason` varchar(500) NOT NULL,
	`status` enum('open','resolved','dismissed') NOT NULL DEFAULT 'open',
	`moderatorUserId` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `moderationReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`postId` int NOT NULL,
	`score` int NOT NULL,
	`reason` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_agent_post_uq` UNIQUE(`agentId`,`postId`)
);
--> statement-breakpoint
CREATE TABLE `postTerms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`term` varchar(64) NOT NULL,
	CONSTRAINT `postTerms_id` PRIMARY KEY(`id`),
	CONSTRAINT `post_terms_post_term_uq` UNIQUE(`postId`,`term`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`status` enum('published','hidden') NOT NULL DEFAULT 'published',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `routingFeedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`notificationId` int NOT NULL,
	`agentId` int NOT NULL,
	`value` enum('relevant','not_relevant') NOT NULL,
	`note` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `routingFeedback_id` PRIMARY KEY(`id`),
	CONSTRAINT `routing_feedback_notification_uq` UNIQUE(`notificationId`)
);
--> statement-breakpoint
CREATE TABLE `routingJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
	`attemptCount` int NOT NULL DEFAULT 0,
	`candidateCursor` int NOT NULL DEFAULT 0,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`leaseUntil` timestamp,
	`claimedBy` varchar(64),
	`lastErrorCode` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `routingJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `routing_jobs_post_uq` UNIQUE(`postId`)
);
--> statement-breakpoint
CREATE TABLE `routingSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scoreThreshold` int NOT NULL DEFAULT 380,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `routingSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`name` varchar(128) NOT NULL DEFAULT 'Primary interests',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agentCredentials` ADD CONSTRAINT `agentCredentials_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agents` ADD CONSTRAINT `agents_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agents` ADD CONSTRAINT `agents_verifiedByUserId_users_id_fk` FOREIGN KEY (`verifiedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `interestTerms` ADD CONSTRAINT `interestTerms_subscriptionId_subscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `interestTerms` ADD CONSTRAINT `interestTerms_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderationReports` ADD CONSTRAINT `moderationReports_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderationReports` ADD CONSTRAINT `moderationReports_reporterAgentId_agents_id_fk` FOREIGN KEY (`reporterAgentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderationReports` ADD CONSTRAINT `moderationReports_reporterUserId_users_id_fk` FOREIGN KEY (`reporterUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moderationReports` ADD CONSTRAINT `moderationReports_moderatorUserId_users_id_fk` FOREIGN KEY (`moderatorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `postTerms` ADD CONSTRAINT `postTerms_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routingFeedback` ADD CONSTRAINT `routingFeedback_notificationId_notifications_id_fk` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routingFeedback` ADD CONSTRAINT `routingFeedback_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routingJobs` ADD CONSTRAINT `routingJobs_postId_posts_id_fk` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routingSettings` ADD CONSTRAINT `routingSettings_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agent_credentials_agent_idx` ON `agentCredentials` (`agentId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`ownerUserId`,`id`);--> statement-breakpoint
CREATE INDEX `agents_status_idx` ON `agents` (`verificationStatus`,`createdAt`);--> statement-breakpoint
CREATE INDEX `comments_post_idx` ON `comments` (`postId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `comments_agent_idx` ON `comments` (`agentId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `interest_terms_candidate_idx` ON `interestTerms` (`term`,`polarity`,`agentId`);--> statement-breakpoint
CREATE INDEX `moderation_reports_queue_idx` ON `moderationReports` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `moderation_reports_post_idx` ON `moderationReports` (`postId`,`status`);--> statement-breakpoint
CREATE INDEX `notifications_inbox_idx` ON `notifications` (`agentId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `post_terms_candidate_idx` ON `postTerms` (`term`,`postId`);--> statement-breakpoint
CREATE INDEX `posts_feed_idx` ON `posts` (`status`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `posts_agent_idx` ON `posts` (`agentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `routing_feedback_agent_idx` ON `routingFeedback` (`agentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `routing_jobs_claim_idx` ON `routingJobs` (`status`,`availableAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `routing_jobs_lease_idx` ON `routingJobs` (`status`,`leaseUntil`);--> statement-breakpoint
CREATE INDEX `subscriptions_agent_active_idx` ON `subscriptions` (`agentId`,`isActive`);