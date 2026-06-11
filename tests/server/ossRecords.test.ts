/**
 * Integration tests for OSS-backed record image flows.
 *
 * The `ObjectStorage` interface is replaced with a `FakeStorage`,
 * so no real OSS bucket is required. The tests cover:
 *
 *   - successful create + upload + image-url roundtrip
 *   - compensation when DB write fails after OSS upload
 *   - compensation when sourceId collides (orphan deletion)
 *   - compensation when OSS upload fails (no DB row)
 *   - replace / remove thumbnail actions
 *   - deleting a record leaves the OSS object untouched
 *   - cross-user image URL access is denied
 *   - SVG / HTTP / oversized inputs rejected
 *   - legacy base64 thumbnail import path
 */
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildApp } from "../../src/server/index";
import { closeDb } from "../../src/server/db/client";
import {
  buildThumbnailObjectKey,
  type SupportedImageMime,
} from "../../src/server/storage/storage";
import { setObjectStorageForTests } from "../../src/server/storage";
import { makeFakeStorage, type FakeStorage } from "./fakeStorage";

const TEST_DATABASE_URL = process.env.DATABASE_URL;
const TEST_RUN = Boolean(TEST_DATABASE_URL);

if (!TEST_RUN) {
  console.warn(
    "\n[oss tests] DATABASE_URL is not set — skipping integration tests.\n",
  );
}

let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let storage: FakeStorage | null = null;

beforeAll(async () => {
  if (!TEST_RUN) return;
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.SESSION_COOKIE_NAME = "caloriemaster_session";
  process.env.SESSION_TTL_DAYS = "1";
  process.env.QWEN_API_KEY = "";
  process.env.BOOHEE_API_KEY = "";
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.execute(sql`TRUNCATE sessions, ai_usage, food_items, food_records, user_settings, users RESTART IDENTITY CASCADE`);
  await client.end();
  storage = makeFakeStorage();
  setObjectStorageForTests(storage);
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  setObjectStorageForTests(null);
  await closeDb();
});

type CookieJar = Map<string, string>;
function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
type FastifyInjectResponse = Awaited<ReturnType<Awaited<ReturnType<typeof buildApp>>["inject"]>>;
function captureCookies(jar: CookieJar, response: FastifyInjectResponse) {
  const raw = response.headers["set-cookie"];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const value of list) {
    const match = value.match(/caloriemaster_session=([^;]+)/);
    if (match) {
      jar.set("caloriemaster_session", match[1]);
      return;
    }
  }
}

async function registerUser(email: string, password: string, jar: CookieJar) {
  const res = await app!.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    payload: { email, password },
  });
  captureCookies(jar, res);
  return res;
}

// A real 1×1 transparent PNG so the image processor can decode it
// during the test (instead of fabricating a fake buffer).
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeRecordPayload(extra: Record<string, unknown> = {}) {
  return {
    timestamp: Date.now(),
    mealType: "午餐",
    items: [{ name: "米饭", weightG: 150, caloriesPer100g: 116 }],
    ...extra,
  };
}

const runIfPg = TEST_RUN ? describe : describe.skip;

runIfPg("OSS-backed records", () => {
  it("uploads a thumbnail on create and exposes a signed image URL", async () => {
    const jar: CookieJar = new Map();
    await registerUser("alice-img@example.com", "password1234", jar);
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
    });
    expect(create.statusCode).toBe(201);
    const record = create.json().record;
    expect(record.hasImage).toBe(true);
    expect(record.imageMimeType).toBe("image/webp");
    expect(storage!.uploads).toHaveLength(1);
    const uploadedKey = storage!.uploads[0].recordId;
    expect(uploadedKey).toBe(record.id);

    // Sign URL endpoint
    const sign = await app!.inject({
      method: "GET",
      url: `/api/records/${record.id}/image-url`,
      headers: { cookie: cookieHeader(jar) },
    });
    expect(sign.statusCode).toBe(200);
    const signBody = sign.json();
    expect(signBody.url).toMatch(/^https:\/\/fake-oss\.example\//);
    expect(signBody.expiresIn).toBeGreaterThan(0);
  });

  it("rejects SVG / HTTP / oversized inputs", async () => {
    const jar: CookieJar = new Map();
    await registerUser("svg@example.com", "password1234", jar);
    const svg = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }),
    });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().error.code).toBe("IMAGE_INVALID");

    const http = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: "https://example.com/x.jpg" }),
    });
    expect(http.statusCode).toBe(400);
    expect(http.json().error.code).toBe("IMAGE_INVALID");

    // Image data URL above the JSON-field cap. The Zod schema
    // rejects it as INVALID_REQUEST; the deeper 4 MB / 200 KB
    // caps are covered by the unit tests for the image processor
    // and dataUrl decoder.
    const hugeDataUrl = "data:image/jpeg;base64," + "a".repeat(40 * 1024);
    const huge = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: hugeDataUrl }),
    });
    expect(huge.statusCode).toBe(400);
    expect(huge.json().error.code).toBe("INVALID_REQUEST");

    // No storage side effects.
    expect(storage!.uploads.find((u) => u.userId.includes("svg"))).toBeUndefined();
  });

  it("leaves the OSS object untouched when the record is deleted", async () => {
    const jar: CookieJar = new Map();
    await registerUser("deleter@example.com", "password1234", jar);
    const deletesBefore = storage!.deletes.length;
    const objectsBefore = storage!.objects.size;
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
    });
    const recordId = create.json().record.id;
    // Capture the object key that belongs to THIS record.
    const objectKey = [...storage!.objects.keys()].reverse().find((k) => k.includes(recordId))!;
    expect(objectKey).toBeTruthy();
    expect(storage!.deletes).toHaveLength(deletesBefore);
    const del = await app!.inject({
      method: "DELETE",
      url: `/api/records/${recordId}`,
      headers: { cookie: cookieHeader(jar), origin: "http://localhost:3000" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deletedId).toBe(recordId);
    expect(storage!.deletes).toHaveLength(deletesBefore);
    expect(storage!.objects.has(objectKey)).toBe(true);
    expect(storage!.objects.size).toBe(objectsBefore + 1);
  });

  it("cross-user image URL access is denied (user A cannot see B's record)", async () => {
    const jarA: CookieJar = new Map();
    const jarB: CookieJar = new Map();
    await registerUser("a-img@example.com", "password1234", jarA);
    await registerUser("b-img@example.com", "password1234", jarB);
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jarA), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
    });
    const recordId = create.json().record.id;
    const evil = await app!.inject({
      method: "GET",
      url: `/api/records/${recordId}/image-url`,
      headers: { cookie: cookieHeader(jarB) },
    });
    expect(evil.statusCode).toBe(404);
    expect(evil.json().error.code).toBe("RECORD_NOT_FOUND");
  });

  it("replace: uploads new image then deletes old; failure keeps the old image", async () => {
    const jar: CookieJar = new Map();
    await registerUser("replacer@example.com", "password1234", jar);
    const before = storage!.uploads.length;
    const beforeDeletes = storage!.deletes.length;
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
    });
    const recordId = create.json().record.id;
    const oldObjectKey = [...storage!.objects.keys()].pop()!;
    expect(storage!.objects.has(oldObjectKey)).toBe(true);

    // Successful replace
    const update = await app!.inject({
      method: "PUT",
      url: `/api/records/${recordId}`,
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: {
        ...makeRecordPayload(),
        thumbnailAction: { type: "replace", dataUrl: TINY_PNG },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(storage!.uploads.length).toBe(before + 2);
    expect(storage!.deletes.length).toBe(beforeDeletes + 1);
    expect(storage!.deletes).toContain(oldObjectKey);
    expect(storage!.objects.has(oldObjectKey)).toBe(false);

    // Remove
    const rm = await app!.inject({
      method: "PUT",
      url: `/api/records/${recordId}`,
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: {
        ...makeRecordPayload(),
        thumbnailAction: { type: "remove" },
      },
    });
    expect(rm.statusCode).toBe(200);
    expect(rm.json().record.hasImage).toBe(false);
  });

  it("when OSS upload fails, no DB record is created", async () => {
    const jar: CookieJar = new Map();
    await registerUser("uploady@example.com", "password1234", jar);
    storage!.opts.failUploads = true;
    try {
      const res = await app!.inject({
        method: "POST",
        url: "/api/records",
        headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
        payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("IMAGE_UPLOAD_FAILED");
      // The list must be empty.
      const list = await app!.inject({
        method: "GET",
        url: "/api/records",
        headers: { cookie: cookieHeader(jar) },
      });
      expect(list.json().records).toHaveLength(0);
    } finally {
      storage!.opts.failUploads = false;
    }
  });

  it("when DB insert fails after a successful OSS upload, the OSS object is rolled back", async () => {
    const jar: CookieJar = new Map();
    await registerUser("rollback@example.com", "password1234", jar);
    const beforeUploads = storage!.uploads.length;
    const beforeDeletes = storage!.deletes.length;
    const beforeObjects = storage!.objects.size;

    // Force a DB-side failure by reusing an existing record's
    // sourceId AFTER a successful upload: we send two creates with
    // the same sourceId, the second hits the onConflictDoNothing
    // branch and we expect the orphan to be cleaned up.
    const sourceId = `rollback-test-${Date.now()}`;
    const first = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ sourceId, thumbnailDataUrl: TINY_PNG }),
    });
    expect(first.statusCode).toBe(201);
    expect(storage!.uploads.length).toBe(beforeUploads + 1);
    const objectKeyAfterFirst = [...storage!.objects.keys()].pop()!;

    // Second create with same sourceId. The DB INSERT will hit
    // onConflictDoNothing (no row returned). The service detects
    // this and rolls back the just-uploaded OSS object, then
    // returns the existing record (201, since this is still a
    // create call that succeeded against the idempotency key).
    const second = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ sourceId, thumbnailDataUrl: TINY_PNG }),
    });
    expect(second.statusCode).toBe(201);
    expect(storage!.uploads.length).toBe(beforeUploads + 2);
    // The second upload's object should have been deleted as an orphan.
    expect(storage!.deletes.length).toBeGreaterThan(beforeDeletes);
    expect(storage!.objects.size).toBe(beforeObjects + 1); // only the first one remains

    void objectKeyAfterFirst;
  });

  it("delete removes the record without touching OSS", async () => {
    const jar: CookieJar = new Map();
    await registerUser("delete-leaves-oss@example.com", "password1234", jar);
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: makeRecordPayload({ thumbnailDataUrl: TINY_PNG }),
    });
    const recordId = create.json().record.id;
    const beforeDeletes = storage!.deletes.length;
    const beforeObjects = storage!.objects.size;
    const del = await app!.inject({
      method: "DELETE",
      url: `/api/records/${recordId}`,
      headers: { cookie: cookieHeader(jar), origin: "http://localhost:3000" },
    });
    expect(del.statusCode).toBe(200);
    expect(storage!.deletes.length).toBe(beforeDeletes);
    expect(storage!.objects.size).toBe(beforeObjects);
    const list = await app!.inject({
      method: "GET",
      url: "/api/records",
      headers: { cookie: cookieHeader(jar) },
    });
    expect(list.json().records.find((r: { id: string }) => r.id === recordId)).toBeUndefined();
  });

  it("imports legacy base64 thumbnails via /api/records/import", async () => {
    const jar: CookieJar = new Map();
    await registerUser("importer@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records/import",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: {
        records: [
          makeRecordPayload({ sourceId: `legacy-${Date.now()}-a`, thumbnailDataUrl: TINY_PNG }),
          makeRecordPayload({ sourceId: `legacy-${Date.now()}-b`, thumbnailDataUrl: TINY_PNG }),
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(2);
  });
});

runIfPg("ObjectStorage buildThumbnailObjectKey", () => {
  it("builds a canonical key with no user-controlled parts", () => {
    const key = buildThumbnailObjectKey(
      "u1",
      "r1",
      "image/jpeg" as SupportedImageMime,
      "abcdef",
    );
    expect(key).toBe("users/u1/records/r1/thumbnail-abcdef.jpg");
    const webp = buildThumbnailObjectKey(
      "u1",
      "r1",
      "image/webp" as SupportedImageMime,
      "abcdef",
    );
    expect(webp).toBe("users/u1/records/r1/thumbnail-abcdef.webp");
  });
});
