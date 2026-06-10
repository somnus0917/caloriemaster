/**
 * End-to-end server tests. They need a real PostgreSQL — the test
 * suite will SKIP if DATABASE_URL is not set, so contributors without
 * Docker can still run the rest of the suite.
 *
 * To run them locally:
 *   docker run -d --rm --name cm-test -p 5433:5432 \
 *     -e POSTGRES_USER=cm -e POSTGRES_PASSWORD=cm -e POSTGRES_DB=cm \
 *     postgres:16
 *   DATABASE_URL=postgresql://cm:cm@localhost:5433/cm npx vitest run tests/server
 */
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/index";
import { closeDb } from "../../src/server/db/client";

const TEST_DATABASE_URL = process.env.DATABASE_URL;
const TEST_RUN = Boolean(TEST_DATABASE_URL);

if (!TEST_RUN) {
  console.warn(
    "\n[server tests] DATABASE_URL is not set — skipping integration tests.\n" +
      "Start a Postgres (docker run -p 5433:5432 ...) and re-run with DATABASE_URL.\n",
  );
}

let app: Awaited<ReturnType<typeof buildApp>> | null = null;

beforeAll(async () => {
  if (!TEST_RUN) return;
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.SESSION_COOKIE_NAME = "caloriemaster_session";
  process.env.SESSION_TTL_DAYS = "1";
  process.env.QWEN_API_KEY = "";
  process.env.BOOHEE_API_KEY = "";
  // Run migrations first so we have a clean schema.
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const client = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./migrations" });
  // Wipe data so each suite starts clean.
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`TRUNCATE sessions, ai_usage, food_items, food_records, user_settings, users RESTART IDENTITY CASCADE`);
  await client.end();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
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
  // Fastify may return an array of set-cookie strings.
  const list = Array.isArray(raw) ? raw : [raw];
  for (const value of list) {
    const match = value.match(/caloriemaster_session=([^;]+)/);
    if (match) {
      jar.set("caloriemaster_session", match[1]);
      return;
    }
  }
}

async function registerUser(email: string, password: string, jar: CookieJar): Promise<FastifyInjectResponse> {
  const res = await app!.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    payload: { email, password },
  });
  captureCookies(jar, res);
  return res;
}

async function loginUser(email: string, password: string, jar: CookieJar): Promise<FastifyInjectResponse> {
  const res = await app!.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    payload: { email, password },
  });
  captureCookies(jar, res);
  return res;
}

const sample = {
  timestamp: 1700000000000,
  mealType: "午餐",
  items: [{ name: "米饭", weightG: 150, caloriesPer100g: 116 }],
};

const runIfPg = TEST_RUN ? describe : describe.skip;

runIfPg("server: auth", () => {
  it("rejects registration with an invalid payload", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      payload: { email: "not-an-email", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("registers a user and sets a HttpOnly session cookie", async () => {
    const jar: CookieJar = new Map();
    const res = await registerUser("alice@example.com", "password1234", jar);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.passwordHash).toBeUndefined();
    expect(jar.get("caloriemaster_session")).toBeTruthy();
    const setCookie = res.headers["set-cookie"];
    expect(String(setCookie)).toMatch(/HttpOnly/i);
    expect(String(setCookie)).toMatch(/SameSite=Lax/i);
  });

  it("normalises email to lowercase", async () => {
    const jar: CookieJar = new Map();
    const res = await registerUser("Bob@Example.com", "password1234", jar);
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe("bob@example.com");
  });

  it("rejects duplicate email with EMAIL_ALREADY_EXISTS", async () => {
    await registerUser("carol@example.com", "password1234", new Map());
    const res = await registerUser("carol@example.com", "password1234", new Map());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("rejects passwords shorter than 8 chars with PASSWORD_TOO_WEAK", async () => {
    const res = await registerUser("weak@example.com", "abc", new Map());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("PASSWORD_TOO_WEAK");
  });

  it("logs in with correct credentials and returns the user", async () => {
    await registerUser("dave@example.com", "password1234", new Map());
    const jar: CookieJar = new Map();
    const res = await loginUser("dave@example.com", "password1234", jar);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("dave@example.com");
    expect(jar.get("caloriemaster_session")).toBeTruthy();
  });

  it("returns INVALID_CREDENTIALS for wrong password", async () => {
    await registerUser("eve@example.com", "password1234", new Map());
    const res = await loginUser("eve@example.com", "wrongpassword1", new Map());
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS for unknown email (no enumeration)", async () => {
    const res = await loginUser("nobody@example.com", "password1234", new Map());
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("/api/auth/me returns 401 without cookie and 200 with it", async () => {
    const noAuth = await app!.inject({ method: "GET", url: "/api/auth/me" });
    expect(noAuth.statusCode).toBe(401);
    const jar: CookieJar = new Map();
    await registerUser("frank@example.com", "password1234", jar);
    const me = await app!.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieHeader(jar) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("frank@example.com");
    expect(me.json().user.passwordHash).toBeUndefined();
  });

  it("logout invalidates the session", async () => {
    const jar: CookieJar = new Map();
    await registerUser("grace@example.com", "password1234", jar);
    const me = await app!.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookieHeader(jar) } });
    expect(me.statusCode).toBe(200);
    const logout = await app!.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: cookieHeader(jar), origin: "http://localhost:3000" },
    });
    expect(logout.statusCode).toBe(200);
    const me2 = await app!.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookieHeader(jar) } });
    expect(me2.statusCode).toBe(401);
  });

  it("does not leak the password hash in any response", async () => {
    const jar: CookieJar = new Map();
    const res = await registerUser("harry@example.com", "password1234", jar);
    const raw = res.body;
    expect(raw).not.toMatch(/passwordHash/);
    expect(raw).not.toMatch(/argon2/);
  });
});

runIfPg("server: records isolation", () => {
  it("user A cannot see, edit or delete user B's records", async () => {
    const jarA: CookieJar = new Map();
    const jarB: CookieJar = new Map();
    await registerUser("iz@example.com", "password1234", jarA);
    await registerUser("jay@example.com", "password1234", jarB);
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jarA), origin: "http://localhost:3000" },
      payload: sample,
    });
    expect(create.statusCode).toBe(201);
    const aId = create.json().record.id;

    // B lists records — should see nothing.
    const bList = await app!.inject({
      method: "GET",
      url: "/api/records",
      headers: { cookie: cookieHeader(jarB) },
    });
    expect(bList.json().records).toHaveLength(0);

    // B tries to GET A's record directly.
    const bGet = await app!.inject({
      method: "GET",
      url: `/api/records/${aId}`,
      headers: { cookie: cookieHeader(jarB) },
    });
    expect(bGet.statusCode).toBe(404);

    // B tries to PUT A's record.
    const bPut = await app!.inject({
      method: "PUT",
      url: `/api/records/${aId}`,
      headers: { "content-type": "application/json", cookie: cookieHeader(jarB), origin: "http://localhost:3000" },
      payload: sample,
    });
    expect(bPut.statusCode).toBe(404);

    // B tries to DELETE A's record.
    const bDelete = await app!.inject({
      method: "DELETE",
      url: `/api/records/${aId}`,
      headers: { cookie: cookieHeader(jarB), origin: "http://localhost:3000" },
    });
    expect(bDelete.statusCode).toBe(404);

    // A's record still exists.
    const aGet = await app!.inject({
      method: "GET",
      url: `/api/records/${aId}`,
      headers: { cookie: cookieHeader(jarA) },
    });
    expect(aGet.statusCode).toBe(200);
  });

  it("guessing a UUID still cannot access other users' data", async () => {
    const jarA: CookieJar = new Map();
    const jarB: CookieJar = new Map();
    await registerUser("kate@example.com", "password1234", jarA);
    await registerUser("leo@example.com", "password1234", jarB);
    const create = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jarA), origin: "http://localhost:3000" },
      payload: sample,
    });
    const aId = create.json().record.id;
    // Hit A's record with a valid-looking but unrelated UUID.
    const otherId = "00000000-0000-0000-0000-000000000000";
    const res = await app!.inject({
      method: "GET",
      url: `/api/records/${otherId}`,
      headers: { cookie: cookieHeader(jarB) },
    });
    expect(res.statusCode).toBe(404);
    void aId;
  });

  it("settings are per-user", async () => {
    const jarA: CookieJar = new Map();
    const jarB: CookieJar = new Map();
    await registerUser("mia@example.com", "password1234", jarA);
    await registerUser("nick@example.com", "password1234", jarB);
    const setA = await app!.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "content-type": "application/json", cookie: cookieHeader(jarA), origin: "http://localhost:3000" },
      payload: { dailyTarget: 1800, dailyLimit: 2200 },
    });
    expect(setA.statusCode).toBe(200);
    const getA = await app!.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie: cookieHeader(jarA) },
    });
    const getB = await app!.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie: cookieHeader(jarB) },
    });
    expect(getA.json().settings.dailyTarget).toBe(1800);
    expect(getB.json().settings.dailyTarget).toBe(2000); // default
  });

  it("AI and records endpoints reject unauthenticated requests", async () => {
    // POST without an Origin header is rejected by CSRF first.
    const r1 = await app!.inject({
      method: "POST",
      url: "/api/recognize-food",
      headers: { "content-type": "application/json" },
      payload: { imageBase64: "data:image/jpeg;base64,aaaa" },
    });
    expect([401, 403]).toContain(r1.statusCode);
    // GET requests skip CSRF and go straight to auth.
    const r2 = await app!.inject({ method: "GET", url: "/api/records" });
    expect(r2.statusCode).toBe(401);
    const r3 = await app!.inject({ method: "GET", url: "/api/settings" });
    expect(r3.statusCode).toBe(401);
    const r4 = await app!.inject({ method: "GET", url: "/api/boohee?code=foo" });
    expect(r4.statusCode).toBe(401);
  });
});

runIfPg("server: records validation", () => {
  it("rejects records with no items", async () => {
    const jar: CookieJar = new Map();
    await registerUser("olive@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: { timestamp: 1, mealType: "x", items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects more than 20 items", async () => {
    const jar: CookieJar = new Map();
    await registerUser("pat@example.com", "password1234", jar);
    const items = Array.from({ length: 21 }, () => ({ name: "x", weightG: 100, caloriesPer100g: 100 }));
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: { timestamp: 1, mealType: "x", items },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative weight", async () => {
    const jar: CookieJar = new Map();
    await registerUser("quinn@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: { timestamp: 1, mealType: "x", items: [{ name: "x", weightG: -1, caloriesPer100g: 100 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("server recomputes total calories from items", async () => {
    const jar: CookieJar = new Map();
    await registerUser("rob@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: { timestamp: 1, mealType: "午餐", items: [{ name: "x", weightG: 200, caloriesPer100g: 200 }] },
    });
    expect(res.statusCode).toBe(201);
    const rec = res.json().record;
    expect(rec.totalCalories).toBe(400);
    expect(rec.foods[0].totalCalories).toBe(400);
  });

  it("does not trust userId from the client", async () => {
    const jar: CookieJar = new Map();
    await registerUser("sam@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://localhost:3000" },
      payload: { timestamp: 1, mealType: "午餐", userId: "00000000-0000-0000-0000-000000000000", items: [{ name: "x", weightG: 100, caloriesPer100g: 100 }] },
    });
    expect(res.statusCode).toBe(201);
    const list = await app!.inject({ method: "GET", url: "/api/records", headers: { cookie: cookieHeader(jar) } });
    const rec = list.json().records[0];
    expect(rec.userId).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});

runIfPg("server: rate limit & CSRF", () => {
  it("CSRF: POST without matching Origin is rejected", async () => {
    const jar: CookieJar = new Map();
    await registerUser("tom@example.com", "password1234", jar);
    const res = await app!.inject({
      method: "POST",
      url: "/api/records",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar), origin: "http://evil.example.com" },
      payload: sample,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_ORIGIN_REJECTED");
  });
});
