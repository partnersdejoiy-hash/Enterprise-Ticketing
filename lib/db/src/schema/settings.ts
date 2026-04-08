import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;

export const emailAccountsTable = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  smtpHost: text("smtp_host").default(""),
  smtpPort: integer("smtp_port").default(587),
  smtpSecure: boolean("smtp_secure").default(false),
  smtpUser: text("smtp_user").default(""),
  smtpPass: text("smtp_pass").default(""),
  smtpFromEmail: text("smtp_from_email").default(""),
  smtpFromName: text("smtp_from_name").default("OrbitDesk"),
  smtpEnabled: boolean("smtp_enabled").default(false),
  imapHost: text("imap_host").default(""),
  imapPort: integer("imap_port").default(993),
  imapSecure: boolean("imap_secure").default(true),
  imapUser: text("imap_user").default(""),
  imapPass: text("imap_pass").default(""),
  imapMailbox: text("imap_mailbox").default("INBOX"),
  imapPollInterval: integer("imap_poll_interval").default(5),
  imapEnabled: boolean("imap_enabled").default(false),
  departmentId: integer("department_id"),
  isPrimarySender: boolean("is_primary_sender").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailAccount = typeof emailAccountsTable.$inferSelect;
