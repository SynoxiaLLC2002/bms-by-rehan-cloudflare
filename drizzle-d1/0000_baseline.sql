CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_key` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`language` text DEFAULT 'en' NOT NULL,
	`direction` text,
	`translation_group` integer,
	`parent_id` integer,
	`archive_color` text,
	`archive_hover_color` text,
	`header_image` text,
	`archive_columns` text DEFAULT 'default' NOT NULL,
	`archive_card_style` text DEFAULT 'default' NOT NULL,
	`archive_design` text,
	`seo_title` text,
	`seo_description` text,
	`focus_keyword` text,
	`canonical_url` text,
	`og_title` text,
	`og_description` text,
	`og_image` text,
	`no_index` integer DEFAULT false NOT NULL,
	`no_follow` integer DEFAULT false NOT NULL,
	`no_archive` integer DEFAULT false NOT NULL,
	`no_image_index` integer DEFAULT false NOT NULL,
	`no_snippet` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_language_slug_key` ON `categories` (`language`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_language_idx` ON `categories` (`language`);--> statement-breakpoint
CREATE INDEX `categories_translation_group_idx` ON `categories` (`translation_group`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer,
	`page_id` integer,
	`parent_id` integer,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`author_url` text,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_one_target" CHECK(("comments"."post_id" IS NULL) <> ("comments"."page_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `comments_post_idx` ON `comments` (`post_id`,`status`);--> statement-breakpoint
CREATE INDEX `comments_page_status_created_idx` ON `comments` (`page_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `elements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`content` text,
	`hook` text DEFAULT 'before_footer' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`conditions` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `error_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text DEFAULT 'render' NOT NULL,
	`path` text,
	`method` text,
	`message` text NOT NULL,
	`stack` text,
	`digest` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `error_log_created_idx` ON `error_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_name` text DEFAULT 'Contact' NOT NULL,
	`page_path` text,
	`data` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`blur` text,
	`alt` text,
	`caption` text,
	`uploaded_by_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_url_idx` ON `media` (`url`);--> statement-breakpoint
CREATE TABLE `menus` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`auto_add_pages` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nav_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`menu_id` integer,
	`label` text NOT NULL,
	`object_type` text DEFAULT 'custom',
	`object_id` integer,
	`icon` text,
	`description` text,
	`badge` text,
	`highlight` text,
	`mega_menu` integer DEFAULT false,
	`mega_columns` integer DEFAULT 2,
	`url` text NOT NULL,
	`target` text DEFAULT '_self',
	`order` integer DEFAULT 0,
	`parent_id` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `menus`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `not_found_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`referrer` text,
	`last_hit` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `not_found_log_path_unique` ON `not_found_log` (`path`);--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`token_name` text NOT NULL,
	`role` text NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text,
	`featured_image` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`template` text DEFAULT 'default',
	`author_id` text,
	`seo_title` text,
	`seo_description` text,
	`seo_keywords` text,
	`og_title` text,
	`og_description` text,
	`og_image` text,
	`twitter_title` text,
	`twitter_description` text,
	`twitter_image` text,
	`canonical_url` text,
	`no_index` integer DEFAULT false,
	`no_follow` integer DEFAULT false,
	`robots_advanced` text,
	`schema_type` text DEFAULT 'WebPage',
	`schemas` text,
	`transparent_header` text DEFAULT 'default' NOT NULL,
	`show_title` text DEFAULT 'default' NOT NULL,
	`post_layout` text DEFAULT 'default' NOT NULL,
	`content_style` text DEFAULT 'default' NOT NULL,
	`vertical_spacing` text DEFAULT 'default' NOT NULL,
	`show_featured_image` text DEFAULT 'default' NOT NULL,
	`show_comments` text DEFAULT 'default' NOT NULL,
	`deleted_at` integer,
	`css_classes` text,
	`disable_header` integer DEFAULT false NOT NULL,
	`disable_footer` integer DEFAULT false NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`direction` text,
	`translation_group` integer,
	`published_at` integer,
	`script_head` text,
	`script_body_end` text,
	`custom_css` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_language_slug_key` ON `pages` (`language`,`slug`);--> statement-breakpoint
CREATE INDEX `pages_language_idx` ON `pages` (`language`,`status`);--> statement-breakpoint
CREATE INDEX `pages_translation_group_idx` ON `pages` (`translation_group`);--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`manifest` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`installed_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_slug_unique` ON `plugins` (`slug`);--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_tags_tag_idx` ON `post_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text,
	`content` text,
	`search_text` text,
	`featured_image` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`category_id` integer,
	`author_id` text,
	`seo_title` text,
	`seo_description` text,
	`seo_keywords` text,
	`og_title` text,
	`og_description` text,
	`og_image` text,
	`twitter_title` text,
	`twitter_description` text,
	`twitter_image` text,
	`canonical_url` text,
	`no_index` integer DEFAULT false,
	`no_follow` integer DEFAULT false,
	`robots_advanced` text,
	`schema_type` text DEFAULT 'Article',
	`schemas` text,
	`transparent_header` text DEFAULT 'default' NOT NULL,
	`show_title` text DEFAULT 'default' NOT NULL,
	`post_layout` text DEFAULT 'default' NOT NULL,
	`content_style` text DEFAULT 'default' NOT NULL,
	`vertical_spacing` text DEFAULT 'default' NOT NULL,
	`show_featured_image` text DEFAULT 'default' NOT NULL,
	`show_comments` text DEFAULT 'default' NOT NULL,
	`deleted_at` integer,
	`css_classes` text,
	`disable_header` integer DEFAULT false NOT NULL,
	`disable_footer` integer DEFAULT false NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`direction` text,
	`translation_group` integer,
	`published_at` integer,
	`script_head` text,
	`script_body_end` text,
	`custom_css` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_language_slug_key` ON `posts` (`language`,`slug`);--> statement-breakpoint
CREATE INDEX `posts_language_idx` ON `posts` (`language`,`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_translation_group_idx` ON `posts` (`translation_group`);--> statement-breakpoint
CREATE INDEX `posts_status_published_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_category_idx` ON `posts` (`category_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `redirects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`destination` text NOT NULL,
	`type` integer DEFAULT 301 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_hit` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redirects_source_unique` ON `redirects` (`source`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_kind` text NOT NULL,
	`document_id` integer NOT NULL,
	`title` text,
	`content` text,
	`excerpt` text,
	`meta` text,
	`author_id` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `revisions_document_idx` ON `revisions` (`document_kind`,`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`type` text DEFAULT 'text',
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_settings_key_unique` ON `site_settings` (`key`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`language` text DEFAULT 'en' NOT NULL,
	`direction` text,
	`translation_group` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_language_slug_key` ON `tags` (`language`,`slug`);--> statement-breakpoint
CREATE INDEX `tags_language_idx` ON `tags` (`language`);--> statement-breakpoint
CREATE INDEX `tags_translation_group_idx` ON `tags` (`translation_group`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`email_verified` integer,
	`image` text,
	`password` text,
	`role` text DEFAULT 'editor' NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false,
	`totp_reset_failures` integer DEFAULT 0 NOT NULL,
	`totp_reset_since` integer,
	`last_login` integer,
	`slug` text,
	`bio` text,
	`website` text,
	`twitter` text,
	`linkedin` text,
	`facebook` text,
	`instagram` text,
	`github` text,
	`youtube` text,
	`seo_title` text,
	`seo_description` text,
	`canonical_url` text,
	`og_image` text,
	`no_index` integer DEFAULT false NOT NULL,
	`public_profile` integer DEFAULT false NOT NULL,
	`direction` text,
	`language` text,
	`page_layout` text DEFAULT 'default' NOT NULL,
	`content_style` text DEFAULT 'default' NOT NULL,
	`vertical_spacing` text DEFAULT 'default' NOT NULL,
	`transparent_header` text DEFAULT 'default' NOT NULL,
	`disable_header` integer DEFAULT false NOT NULL,
	`disable_footer` integer DEFAULT false NOT NULL,
	`css_classes` text,
	`custom_css` text,
	`script_head` text,
	`script_body_end` text,
	`content` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_key` ON `users` (`slug`);--> statement-breakpoint
-- ── Hand-written: what drizzle-kit cannot express ───────────────────────────
-- Full-text search over title, excerpt and search_text (lib/search.ts).
-- External content: the text stays in `posts`, this holds only the index.
-- remove_diacritics 2: case and accents do not matter (Polish ogonki, Arabic
-- harakat), as the insensitive collation did on MariaDB.
CREATE VIRTUAL TABLE `posts_fts` USING fts5(title, excerpt, search_text, content='posts', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `posts_fts_ai` AFTER INSERT ON `posts` BEGIN
  INSERT INTO posts_fts(rowid, title, excerpt, search_text) VALUES (new.id, new.title, new.excerpt, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `posts_fts_ad` AFTER DELETE ON `posts` BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, search_text) VALUES ('delete', old.id, old.title, old.excerpt, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `posts_fts_au` AFTER UPDATE OF title, excerpt, search_text ON `posts` BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, search_text) VALUES ('delete', old.id, old.title, old.excerpt, old.search_text);
  INSERT INTO posts_fts(rowid, title, excerpt, search_text) VALUES (new.id, new.title, new.excerpt, new.search_text);
END;
