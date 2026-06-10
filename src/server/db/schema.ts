/**
 * Database schema. Single source of truth for table layout.
 * Migrations are generated from this file by drizzle-kit.
 *
 * SECURITY: every table that holds user-owned data carries a `userId`
 * foreign key and every query must include it. There are no global
 * "find by id" helpers.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  real,
  boolean,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    username: varchar("username", { length: 50 }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  dailyTarget: real("daily_target").notNull().default(2000),
  dailyLimit: real("daily_limit").notNull().default(2300),
  updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
});

export const foodRecords = pgTable(
  "food_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional client-side id from localStorage migration / demo seed, used for dedup. */
    sourceId: varchar("source_id", { length: 100 }),
    timestamp: timestamp("timestamp", { withTimezone: false }).notNull(),
    mealType: varchar("meal_type", { length: 20 }).notNull(),
    totalCalories: real("total_calories").notNull(),
    /**
     * Legacy inline thumbnail (base64 data URL). New records store
     * their image in OSS via `imageObjectKey` instead. We keep this
     * column for the one-shot localStorage migration path.
     */
    thumbnailUrl: text("thumbnail_url"),
    /**
     * OSS object key for the processed thumbnail. Only the key is
     * stored — the public bucket URL is never persisted, and the
     * browser fetches a short-lived signed URL on demand.
     */
    imageObjectKey: text("image_object_key"),
    imageMimeType: varchar("image_mime_type", { length: 30 }),
    imageSize: integer("image_size"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    userTsIdx: index("food_records_user_ts_idx").on(t.userId, t.timestamp),
    userSourceUnique: uniqueIndex("food_records_user_source_idx").on(t.userId, t.sourceId),
  }),
);

export const foodItems = pgTable(
  "food_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => foodRecords.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    name: varchar("name", { length: 50 }).notNull(),
    weightG: real("weight_g").notNull(),
    caloriesPer100g: real("calories_per_100g").notNull(),
    totalCalories: real("total_calories").notNull(),
    confidence: varchar("confidence", { length: 10 }),
    calorieSource: varchar("calorie_source", { length: 20 }),
    booheeCode: varchar("boohee_code", { length: 50 }),
    proteinPer100g: real("protein_per_100g"),
    fatPer100g: real("fat_per_100g"),
    carbohydratePer100g: real("carbohydrate_per_100g"),
    healthLight: varchar("health_light", { length: 10 }),
  },
  (t) => ({
    recordIdx: index("food_items_record_idx").on(t.recordId),
  }),
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ISO date YYYY-MM-DD in UTC. */
    date: varchar("date", { length: 10 }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    userDateUnique: uniqueIndex("ai_usage_user_date_idx").on(t.userId, t.date),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type FoodRecord = typeof foodRecords.$inferSelect;
export type NewFoodRecord = typeof foodRecords.$inferInsert;
export type FoodItem = typeof foodItems.$inferSelect;
export type NewFoodItem = typeof foodItems.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
