import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const COOKIE_NAME = "pons_creator";
const MAX_AGE = 60 * 60 * 24 * 90;
type CreatorUser = { id: string; role: string; accountStatus: string; xUsername: string; xId: string; image: string | null };
export type CreatorSession = { user: CreatorUser };

function secret() {
  const value = process.env.CREATOR_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("CREATOR_SESSION_SECRET_NOT_CONFIGURED");
  return value;
}
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
function issue(userId: string) { const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`; return `${payload}.${sign(payload)}`; }
function parse(value?: string) {
  if (!value) return null;
  const [userId, expires, signature] = value.split(".");
  if (!userId || !expires || !signature || Number(expires) < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : null;
}
async function load(userId: string | null): Promise<CreatorSession | null> {
  if (!userId) return null;
  const result = await query<{ id: string; role: string; status: string; display_name: string | null; image_url: string | null }>("SELECT id,role,status,display_name,image_url FROM users WHERE id=$1 AND status='ACTIVE' LIMIT 1", [userId]);
  const user = result.rows[0];
  return user ? { user: { id: user.id, role: user.role, accountStatus: user.status, xUsername: user.display_name || "creator", xId: "", image: user.image_url } } : null;
}
export async function auth() { const store = await cookies(); return load(parse(store.get(COOKIE_NAME)?.value)); }
export async function creatorFromRequest(request: NextRequest) { return load(parse(request.cookies.get(COOKIE_NAME)?.value)); }
export async function ensureCreator(request: NextRequest): Promise<{ session: CreatorSession; cookie?: string }> {
  const existing = await creatorFromRequest(request);
  if (existing) return { session: existing };
  const created = await query<{ id: string; role: string; status: string }>("INSERT INTO users(display_name,role,status) VALUES('Creator','CREATOR','ACTIVE') RETURNING id,role,status");
  const user = created.rows[0];
  return { session: { user: { id: user.id, role: user.role, accountStatus: user.status, xUsername: "creator", xId: "", image: null } }, cookie: issue(user.id) };
}
export function attachCreatorCookie<T extends NextResponse>(response: T, value?: string) {
  if (value) response.cookies.set(COOKIE_NAME, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return response;
}
