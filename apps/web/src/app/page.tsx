import { OrbiCart } from "../components/orbicart/orbicart";

export const dynamic = "force-dynamic";

export default function Page() {
  // Today in the Pacific time zone, so "this weekend" means the same thing as for the user.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  return <OrbiCart today={today} />;
}
