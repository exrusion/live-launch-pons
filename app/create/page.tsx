import { CreateStudio } from "@/components/create-studio";

export const metadata = { title: "Create a game" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const params = await searchParams;
  return <main className="shell page-shell create-page"><CreateStudio initialPrompt={(params.prompt || "").slice(0,900)} /></main>;
}
