import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextAuthOptions, Profile, Session } from "next-auth";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import TwitterProvider from "next-auth/providers/twitter";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

const COOKIE_NAME = "pons_creator";
const MAX_AGE = 60 * 60 * 24 * 90;
const xEnabled = Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
const adminXIds = new Set((process.env.ADMIN_X_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));

type CreatorUser = {
  id: string;
  role: string;
  accountStatus: string;
  xUsername: string;
  xId: string;
  image: string | null;
};

export type CreatorSession = { user: CreatorUser };

function creatorSecret() {
  const value = process.env.CREATOR_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("CREATOR_SESSION_SECRET_NOT_CONFIGURED");
  return value;
}

function nextAuthSecret() {
  const value = process.env.NEXTAUTH_SECRET || process.env.CREATOR_SESSION_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET_NOT_CONFIGURED");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", creatorSecret()).update(payload).digest("base64url");
}

function issue(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

function parse(value?: string) {
  if (!value) return null;
  const [userId, expires, signature] = value.split(".");
  if (!userId || !expires || !signature || Number(expires) < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : null;
}

function xProfile(profile: Profile | undefined, fallbackId: string) {
  const raw = (profile || {}) as Record<string, unknown>;
  const data = (raw.data || {}) as Record<string, unknown>;
  const id = String(data.id || raw.id || fallbackId);
  const username = String(data.username || raw.username || raw.screen_name || `user_${id.slice(-6)}`);
  const name = String(data.name || raw.name || username);
  const image = String(data.profile_image_url || raw.profile_image_url_https || raw.image || "");
  return { id, username, name, image };
}

async function load(userId: string | null): Promise<CreatorSession | null> {
  if (!userId) return null;
  const result = await query<{
    id: string;
    role: string;
    status: string;
    display_name: string | null;
    image_url: string | null;
    provider_user_id: string | null;
    username: string | null;
    profile_image_url: string | null;
  }>(
    `SELECT u.id,u.role,u.status,u.display_name,u.image_url,
            x.provider_user_id,x.username,x.profile_image_url
       FROM users u
       LEFT JOIN x_accounts x ON x.user_id=u.id
      WHERE u.id=$1 AND u.status='ACTIVE'
      LIMIT 1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  return {
    user: {
      id: user.id,
      role: user.role,
      accountStatus: user.status,
      xUsername: user.username || user.display_name || "creator",
      xId: user.provider_user_id || "",
      image: user.profile_image_url || user.image_url,
    },
  };
}

function creatorSessionFromNextAuth(session: Session): CreatorSession | null {
  if (!session.user?.id) return null;
  return {
    user: {
      id: session.user.id,
      role: session.user.role || "CREATOR",
      accountStatus: session.user.accountStatus || "ACTIVE",
      xUsername: session.user.xUsername || session.user.name || "creator",
      xId: session.user.xId || "",
      image: session.user.image || null,
    },
  };
}

async function nextAuthSessionFromRequest(request: NextRequest) {
  const token = await getToken({ req: request, secret: nextAuthSecret() });
  if (!token) return { present: false, session: null as CreatorSession | null };
  const userId = typeof token.userId === "string" ? token.userId : "";
  return { present: true, session: userId ? await load(userId) : null };
}

export const authOptions: NextAuthOptions = {
  providers: xEnabled
    ? [
        TwitterProvider({
          clientId: process.env.X_CLIENT_ID!,
          clientSecret: process.env.X_CLIENT_SECRET!,
          version: "2.0",
        }),
      ]
    : [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  secret: process.env.NEXTAUTH_SECRET || process.env.CREATOR_SESSION_SECRET,
  pages: { signIn: "/auth/signin", error: "/auth/signin" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "twitter" || !account.providerAccountId) return false;
      const x = xProfile(profile, account.providerAccountId);
      const cookieStore = await cookies();
      const anonymousUserId = parse(cookieStore.get(COOKIE_NAME)?.value);

      await transaction(async (client) => {
        // A row lock cannot serialize two first logins when the X account does
        // not exist yet, so lock the durable provider ID before checking it.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`x-account:${x.id}`]);
        const existing = await client.query<{ user_id: string; status: string }>(
          `SELECT x.user_id,u.status
             FROM x_accounts x
             JOIN users u ON u.id=x.user_id
            WHERE x.provider_user_id=$1
            FOR UPDATE OF x,u`,
          [x.id],
        );
        if (existing.rows[0]?.status === "SUSPENDED") throw new Error("ACCOUNT_SUSPENDED");

        let userId = existing.rows[0]?.user_id;
        if (!userId && anonymousUserId) {
          // Preserve drafts made before X sign-in, but only if this browser's
          // active creator has never been linked to another X identity.
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`creator:${anonymousUserId}`]);
          const candidate = await client.query<{ id: string }>(
            `SELECT u.id
               FROM users u
              WHERE u.id=$1
                AND u.status='ACTIVE'
                AND NOT EXISTS (SELECT 1 FROM x_accounts x WHERE x.user_id=u.id)
              FOR UPDATE`,
            [anonymousUserId],
          );
          userId = candidate.rows[0]?.id;
        }

        if (!userId) {
          const created = await client.query<{ id: string }>(
            "INSERT INTO users(display_name,image_url,role) VALUES($1,$2,$3) RETURNING id",
            [x.name, x.image || null, adminXIds.has(x.id) ? "ADMIN" : "CREATOR"],
          );
          userId = created.rows[0].id;
        }

        const accountRow = await client.query<{ id: string }>(
          `INSERT INTO x_accounts(user_id,provider_user_id,username,profile_image_url)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(provider_user_id) DO UPDATE SET
             username=EXCLUDED.username,
             profile_image_url=EXCLUDED.profile_image_url,
             updated_at=now()
           RETURNING id`,
          [userId, x.id, x.username, x.image || null],
        );
        await client.query(
          `UPDATE users
              SET display_name=$2,image_url=$3,
                  role=CASE WHEN $4 THEN 'ADMIN' ELSE role END,
                  updated_at=now()
            WHERE id=$1`,
          [userId, x.name, x.image || null, adminXIds.has(x.id)],
        );
        await client.query(
          `INSERT INTO free_launch_credits(user_id,x_account_id)
           VALUES($1,$2)
           ON CONFLICT(x_account_id) DO NOTHING`,
          [userId, accountRow.rows[0].id],
        );
      });
      return true;
    },
    async jwt({ token, account, profile }) {
      const providerId = account?.providerAccountId || (typeof token.xId === "string" ? token.xId : undefined);
      if (account?.providerAccountId) token.xId = account.providerAccountId;
      if (profile) {
        const x = xProfile(profile, account?.providerAccountId || "");
        token.xUsername = x.username;
        token.picture = x.image || token.picture;
      }
      if (providerId && process.env.DATABASE_URL) {
        const result = await query<{ user_id: string; role: string; username: string; status: string; image_url: string | null }>(
          `SELECT x.user_id,u.role,u.status,x.username,COALESCE(x.profile_image_url,u.image_url) AS image_url
             FROM x_accounts x
             JOIN users u ON u.id=x.user_id
            WHERE x.provider_user_id=$1`,
          [providerId],
        );
        const user = result.rows[0];
        token.accountStatus = user?.status || "SUSPENDED";
        token.userId = user?.status === "ACTIVE" ? user.user_id : undefined;
        token.role = user?.role || "CREATOR";
        token.xUsername = user?.username || token.xUsername;
        token.picture = user?.image_url || token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId || "");
        session.user.role = String(token.role || "CREATOR");
        session.user.xId = String(token.xId || "");
        session.user.xUsername = String(token.xUsername || "");
        session.user.accountStatus = String(token.accountStatus || "ACTIVE");
      }
      return session;
    },
  },
};

export async function auth(): Promise<CreatorSession | null> {
  const xSession = await getServerSession(authOptions);
  // Never fall back to an anonymous creator when an X session exists but its
  // linked platform account is suspended or otherwise invalid.
  if (xSession?.user?.xId) return creatorSessionFromNextAuth(xSession);
  const store = await cookies();
  return load(parse(store.get(COOKIE_NAME)?.value));
}

export async function creatorFromRequest(request: NextRequest) {
  const x = await nextAuthSessionFromRequest(request);
  if (x.present) return x.session;
  return load(parse(request.cookies.get(COOKIE_NAME)?.value));
}

export async function ensureCreator(request: NextRequest): Promise<{ session: CreatorSession; cookie?: string }> {
  const existing = await creatorFromRequest(request);
  if (existing) {
    const cookieUserId = parse(request.cookies.get(COOKIE_NAME)?.value);
    return { session: existing, cookie: cookieUserId === existing.user.id ? undefined : issue(existing.user.id) };
  }

  // An invalid X token must not silently downgrade into an anonymous creator
  // and bypass an account suspension.
  const x = await nextAuthSessionFromRequest(request);
  if (x.present) throw new Error("ACCOUNT_NOT_ACTIVE");

  const created = await query<{ id: string; role: string; status: string }>(
    "INSERT INTO users(display_name,role,status) VALUES('Creator','CREATOR','ACTIVE') RETURNING id,role,status",
  );
  const user = created.rows[0];
  return {
    session: {
      user: {
        id: user.id,
        role: user.role,
        accountStatus: user.status,
        xUsername: "creator",
        xId: "",
        image: null,
      },
    },
    cookie: issue(user.id),
  };
}

export function attachCreatorCookie<T extends NextResponse>(response: T, value?: string) {
  if (value) {
    response.cookies.set(COOKIE_NAME, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
  return response;
}

export function isXAuthConfigured() {
  return xEnabled;
}
