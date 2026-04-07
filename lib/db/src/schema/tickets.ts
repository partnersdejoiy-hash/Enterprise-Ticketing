import { pgTable, serial, text, boolean, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ticketStatusEnum = pgEnum("ticket_status", ["open", "assigned", "in_progress", "waiting", "resolved", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "urgent"]);

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: text("ticket_number").notNull().unique(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: ticketStatusEnum("status").notNull().default("open"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),
  departmentId: integer("department_id"),
  assigneeId: integer("assignee_id"),
  createdById: integer("created_by_id").notNull(),
  tags: text("tags").array().notNull().default([]),
  slaBreached: boolean("sla_breached").notNull().default(false),
  slaDeadline: timestamp("sla_deadline"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const commentsTable = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  authorId: integer("author_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketHistoryTable = pgTable("ticket_history", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedById: integer("changed_by_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;

export const insertCommentSchema = createInsertSchema(commentsTable).omit({ id: true, createdAt: true });
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
