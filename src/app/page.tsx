import { redirect } from "next/navigation";

/**
 * This service is the generator API now, not a web app.
 *
 * The web front end used to live here and had drifted to about a tenth of what
 * the phone could do — five pages against forty libraries. It is the Expo
 * build now, which is the same code the phone runs. Anyone arriving at the old
 * address gets sent to the real thing rather than a stale copy of it, which is
 * the failure mode worth preventing: a second front door showing an older app.
 */
export const dynamic = "force-static";

export default function Home() {
  redirect("https://inkline.expo.app");
}
