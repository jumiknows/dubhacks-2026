import { redirect } from "next/navigation";
import { OrbiCart } from "../components/orbicart/orbicart";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.google || params.onboarding !== undefined) { const query = new URLSearchParams(); if (typeof params.google === "string") query.set("google", params.google); if (params.onboarding !== undefined) query.set("onboarding", ""); redirect(`/shop?${query}`); }
  // Today in the Pacific time zone, so "this weekend" means the same thing as for the user.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  return <OrbiCart today={today} />;
}
