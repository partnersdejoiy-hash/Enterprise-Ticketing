CREATE TYPE "public"."role" AS ENUM('super_admin', 'admin', 'manager', 'agent', 'employee', 'external');
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed');
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"department_id" integer,
	"avatar" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"employee_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_employee_id_unique" UNIQUE("employee_id")
);

CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"sla_response_hours" integer DEFAULT 4 NOT NULL,
	"sla_resolution_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);

CREATE TABLE "ticket_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"author_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ticket_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_data" text NOT NULL,
	"uploaded_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ticket_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"action" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"department_id" integer,
	"assignee_id" integer,
	"created_by_id" integer NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"sla_deadline" timestamp,
	"raised_for_name" text,
	"raised_for_email" text,
	"cc_emails" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);

CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" "role" NOT NULL,
	"can_create_ticket" boolean DEFAULT true NOT NULL,
	"can_view_all_tickets" boolean DEFAULT false NOT NULL,
	"can_close_ticket" boolean DEFAULT false NOT NULL,
	"can_assign_tickets" boolean DEFAULT false NOT NULL,
	"can_delete_tickets" boolean DEFAULT false NOT NULL,
	"can_bulk_upload" boolean DEFAULT false NOT NULL,
	"can_export_data" boolean DEFAULT false NOT NULL,
	"can_view_reports" boolean DEFAULT false NOT NULL,
	"can_manage_departments" boolean DEFAULT false NOT NULL,
	"can_manage_users" boolean DEFAULT false NOT NULL,
	"can_request_documents" boolean DEFAULT true NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_unique" UNIQUE("role")
);

CREATE TABLE "email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"smtp_host" text DEFAULT '',
	"smtp_port" integer DEFAULT 587,
	"smtp_secure" boolean DEFAULT false,
	"smtp_user" text DEFAULT '',
	"smtp_pass" text DEFAULT '',
	"smtp_from_email" text DEFAULT '',
	"smtp_from_name" text DEFAULT 'OrbitDesk',
	"smtp_enabled" boolean DEFAULT false,
	"imap_host" text DEFAULT '',
	"imap_port" integer DEFAULT 993,
	"imap_secure" boolean DEFAULT true,
	"imap_user" text DEFAULT '',
	"imap_pass" text DEFAULT '',
	"imap_mailbox" text DEFAULT 'INBOX',
	"imap_poll_interval" integer DEFAULT 5,
	"imap_enabled" boolean DEFAULT false,
	"department_id" integer,
	"is_primary_sender" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);

CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"secret_header" text DEFAULT '',
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"trigger_type" text DEFAULT 'email_received' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"condition_logic" text DEFAULT 'AND' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

