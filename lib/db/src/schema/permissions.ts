import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { roleEnum } from "./users";

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: roleEnum("role").notNull().unique(),

  // Ticket permissions
  canCreateTicket: boolean("can_create_ticket").notNull().default(true),
  canViewAllTickets: boolean("can_view_all_tickets").notNull().default(false),
  canCloseTicket: boolean("can_close_ticket").notNull().default(false),
  canAssignTickets: boolean("can_assign_tickets").notNull().default(false),
  canDeleteTickets: boolean("can_delete_tickets").notNull().default(false),

  // Operational permissions
  canBulkUpload: boolean("can_bulk_upload").notNull().default(false),
  canExportData: boolean("can_export_data").notNull().default(false),
  canViewReports: boolean("can_view_reports").notNull().default(false),

  // Admin permissions
  canManageDepartments: boolean("can_manage_departments").notNull().default(false),
  canManageUsers: boolean("can_manage_users").notNull().default(false),

  // Self-service
  canRequestDocuments: boolean("can_request_documents").notNull().default(true),

  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RolePermissions = typeof rolePermissionsTable.$inferSelect;
