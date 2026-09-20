import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { freeLaunchStatus } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";
export const dynamic = "force-dynamic";
export default async function ProfilePage(){ const session=await auth(); if(!session?.user?.id||!session.user.xId||session.user.accountStatus!=="ACTIVE")redirect("/auth/signin?callbackUrl=%2Fprofile"); const credit=await freeLaunchStatus(session.user.id); return <main className="shell narrow-page"><div className="profile-card"><div className="profile-avatar">{session.user.image?<img src={session.user.image} alt=""/>:"@"}</div><span className="eyebrow">Verified creator</span><h1>@{session.user.xUsername}</h1><p>X account ID <code>{session.user.xId}</code></p><div className="profile-facts"><div><span>Launch-fee credit</span><StatusBadge status={credit?.status||"UNAVAILABLE"}/></div><div><span>Primary wallet</span><b>{credit?.primary_wallet||"Not verified"}</b></div><div><span>Role</span><b>{session.user.role.toLowerCase()}</b></div></div></div></main>; }
