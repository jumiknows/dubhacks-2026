import { redirect } from "next/navigation";

// The shopping board now lives on the main screen. Keep old links, Google sign-in and checkout returns working.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const v of [value].flat()) if (v !== undefined) query.append(key, v);
  redirect(query.size ? `/?${query}` : "/");
}
