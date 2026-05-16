import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const RESTAURANTS_DIR = join(import.meta.dir, "..", "..", "outputs", "restaurants");

export interface RestaurantInfo {
  name: string;
  slug: string;
  phone: string;
  website: string;
}

export function loadRestaurants(): RestaurantInfo[] {
  const files = readdirSync(RESTAURANTS_DIR).filter((f) => f.endsWith(".md"));
  const restaurants: RestaurantInfo[] = [];

  for (const file of files) {
    const content = readFileSync(join(RESTAURANTS_DIR, file), "utf-8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const slugMatch = content.match(/^slug:\s*(.+)$/m);
    const phoneMatch = content.match(/^phone:\s*"?(.+?)"?$/m);
    const websiteMatch = content.match(/^website:\s*(.+)$/m);

    if (nameMatch?.[1] && slugMatch?.[1] && phoneMatch?.[1]) {
      restaurants.push({
        name: nameMatch[1].trim(),
        slug: slugMatch[1].trim(),
        phone: phoneMatch[1].trim().replace(/[^\d+]/g, "").replace(/^(\d{10})$/, "+1$1"),
        website: websiteMatch?.[1]?.trim() ?? "",
      });
    }
  }

  return restaurants;
}

export function buildPhoneIndex(restaurants: RestaurantInfo[]): Map<string, RestaurantInfo> {
  const index = new Map<string, RestaurantInfo>();
  for (const r of restaurants) {
    if (r.phone) index.set(r.phone, r);
  }
  return index;
}
