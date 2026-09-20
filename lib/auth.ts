import type { NextAuthOptions, Profile } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";
import { getServerSession } from "next-auth";
import { query, transaction } from "@/lib/db";

const xEnabled = Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
const adminXIds = new Set((process.env.ADMIN_X_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));

function xProfile(profile: Profile | undefined, fallbackId: string) {
  const raw = (profile || {}) as Record<string, unknown>;
  const data = (raw.data || {}) as Record<string, unknown>;
  const id = String(data.id || raw.id || fallbackId);
  const username = String(data.username || raw.username || raw.screen_name || `user_${id.slice(-6)}`);
  const name = String(data.name || raw.name || username);
  const image = String(data.profile_image_url || raw.profile_image_url_https || raw.image || "");
  return { id, username, name, image };
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
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/auth/signin", error: "/auth/signin" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "twitter" || !account.providerAccountId) return false;
      const x = xProfile(profile, account.providerAccountId);
      await transaction(async (client) => {
        const existing = await client.query<{ user_id: string; status: string }>(
          `SELECT x.user_id,u.status FROM x_accounts x JOIN users u ON u.id=x.user_id
           WHERE x.provider_user_id=$1 FOR UPDATE OF x,u`,
          [x.id],
        );
        if (existing.rows[0]?.status === "SUSPENDED") throw new Error("ACCOUNT_SUSPENDED");
        let userId = existing.rows[0]?.user_id;
        if (!userId) {
          const user = await client.query<{ id: string }>(
            "INSERT INTO users(display_name,image_url,role) VALUES($1,$2,$3) RETURNING id",
            [x.name, x.image || null, adminXIds.has(x.id) ? "ADMIN" : "CREATOR"],
          );
          userId = user.rows[0].id;
          const accountRow = await client.query<{ id: string }>(
            `INSERT INTO x_accounts(user_id,provider_user_id,username,profile_image_url)
             VALUES($1,$2,$3,$4) RETURNING id`,
            [userId, x.id, x.username, x.image || null],
          );
          await client.query("INSERT INTO free_launch_credits(user_id,x_account_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, accountRow.rows[0].id]);
        } else {
          await client.query("UPDATE x_accounts SET username=$2,profile_image_url=$3,updated_at=now() WHERE provider_user_id=$1", [x.id, x.username, x.image || null]);
          await client.query("UPDATE users SET display_name=$2,image_url=$3,role=CASE WHEN $4 THEN 'ADMIN' ELSE role END,updated_at=now() WHERE id=$1", [userId, x.name, x.image || null, adminXIds.has(x.id)]);
        }
      });
      return true;
    },
    async jwt({ token, account, profile }) {
      const providerId = account?.providerAccountId || (token.xId as string | undefined);
      if (account?.providerAccountId) token.xId = account.providerAccountId;
      if (profile) {
        const x = xProfile(profile, account?.providerAccountId || "");
        token.xUsername = x.username;
        token.picture = x.image || token.picture;
      }
      if (providerId && process.env.DATABASE_URL) {
        const result = await query<{ user_id: string; role: string; username: string; status: string }>(
          `SELECT x.user_id,u.role,u.status,x.username FROM x_accounts x JOIN users u ON u.id=x.user_id WHERE x.provider_user_id=$1`,
          [providerId],
        );
        if (result.rows[0]) {
          token.accountStatus = result.rows[0].status;
          token.userId = result.rows[0].status === "ACTIVE" ? result.rows[0].user_id : undefined;
          token.role = result.rows[0].role;
          token.xUsername = result.rows[0].username;
        }
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

export function auth() {
  return getServerSession(authOptions);
}

export function isXAuthConfigured() {
  return xEnabled;
}
