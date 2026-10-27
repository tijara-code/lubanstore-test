CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "catalogue_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"what" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"key" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'taken' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm" (
	"phone_key" text PRIMARY KEY NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_hours" (
	"hour" timestamp with time zone NOT NULL,
	"sid" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"item" text DEFAULT '' NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_hours_hour_sid_country_name_item_pk" PRIMARY KEY("hour","sid","country","name","item")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"item" text,
	"sid" text,
	"country" text,
	"city" text,
	"lat" real,
	"lng" real
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"side" text DEFAULT 'server' NOT NULL,
	"source" text,
	"message" text NOT NULL,
	"order_id" text,
	"path" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "ops" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"from" text,
	"to" text,
	"by" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"pay" text NOT NULL,
	"lang" text DEFAULT 'ar' NOT NULL,
	"origin" text,
	"name" text,
	"phone" text,
	"phone_key" text,
	"email" text,
	"country" text,
	"country_code" text NOT NULL,
	"city" text,
	"region" text,
	"note" text,
	"items" jsonb NOT NULL,
	"cur" text NOT NULL,
	"sub" numeric NOT NULL,
	"ship" numeric DEFAULT 0 NOT NULL,
	"cod_fee" numeric DEFAULT 0 NOT NULL,
	"total" numeric NOT NULL,
	"omr_rate" double precision NOT NULL,
	"omr" numeric NOT NULL,
	"amount_baisa" integer,
	"dedupe_id" text,
	"invoice_key" text NOT NULL,
	"attribution" jsonb,
	"client" jsonb,
	"session_id" text,
	"invoice_no" text,
	"expire_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"payment_id" text,
	"masked_card" text,
	"card_type" text,
	"refunded" boolean DEFAULT false NOT NULL,
	"gateway_fee" numeric,
	"net_amount" numeric,
	"gateway" jsonb,
	"last_payment_error" text,
	"tracking" text,
	"carrier" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"admin_note" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flagged_at" timestamp with time zone,
	"trashed" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"pii_cleared_at" timestamp with time zone,
	CONSTRAINT "orders_dedupe_id_unique" UNIQUE("dedupe_id"),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('pending','new','prep','ship','done','void')),
	CONSTRAINT "orders_payment_status_check" CHECK ("orders"."payment_status" in ('unpaid','paid','cod','refunded','cancelled')),
	CONSTRAINT "orders_pay_check" CHECK ("orders"."pay" in ('cod','card','transfer'))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"carrier" text DEFAULT 'empower' NOT NULL,
	"sent_id" text NOT NULL,
	"reference" text,
	"awb" text,
	"courier_name" text,
	"status" text,
	"cod" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text,
	"order_id" text,
	"invoice" text,
	"verified" boolean DEFAULT false NOT NULL,
	"applied" text,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "webhook_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "catalogue_changes_at_idx" ON "catalogue_changes" USING btree ("at");--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "events_sid_at_idx" ON "events" USING btree ("sid","at");--> statement-breakpoint
CREATE INDEX "logs_at_idx" ON "logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_country_idx" ON "orders" USING btree ("status","country_code","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_invoice_no_idx" ON "orders" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "orders_phone_key_idx" ON "orders" USING btree ("phone_key");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_updated_idx" ON "shipments" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");