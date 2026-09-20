import { CreateStudio } from "@/components/create-studio";
import { headers } from "next/headers";

export const metadata = { title: "Create a game" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  return <main className="shell page-shell create-page"><CreateStudio initialPrompt={(params.prompt || "").slice(0,900)} cspNonce={requestHeaders.get("x-nonce") || ""} /></main>;
}
