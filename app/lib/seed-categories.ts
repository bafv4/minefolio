// カテゴリシードデータ
// 実行方法: npx tsx app/lib/seed-categories.ts

import { config } from "dotenv";
config(); // .env ファイルを読み込む

import { createDb } from "./db";
import { speedrunCategories } from "./schema";

const MINECRAFT_CATEGORIES = [
  // Java Edition RSG (1.16-1.19)
  // r8rg67rn: Seed Type - 21d4zvp1 = Random Seed, klrzpjo1 = Set Seed
  // wl33kewl: Version Range - 4qye4731 = 1.16-1.19, lx5oek31 = 1.20+
  {
    name: "Java: RSG 1.16-1.19",
    slug: "java-rsg-1.16-1.19",
    description: "Java Edition Random Seed Glitchless (1.16-1.19)",
    speedruncomGameId: "j1npme6p",
    speedruncomCategoryId: "mkeyl926",
    // RSG (Random Seed) + 1.16-1.19
    speedruncomVariables: JSON.stringify({ "wl33kewl": "4qye4731", "r8rg67rn": "21d4zvp1" }),
    categoryType: "speedruncom" as const,
    displayOrder: 1,
  },
  // Java Edition SSG (1.16-1.19)
  {
    name: "Java: SSG 1.16-1.19",
    slug: "java-ssg-1.16-1.19",
    description: "Java Edition Set Seed Glitchless (1.16-1.19)",
    speedruncomGameId: "j1npme6p",
    speedruncomCategoryId: "mkeyl926",
    // SSG (Set Seed) + 1.16-1.19
    speedruncomVariables: JSON.stringify({ "wl33kewl": "4qye4731", "r8rg67rn": "klrzpjo1" }),
    categoryType: "speedruncom" as const,
    displayOrder: 2,
  },
  // Java Edition SSG (1.20+)
  {
    name: "Java: SSG 1.20+",
    slug: "java-ssg-1.20",
    description: "Java Edition Set Seed Glitchless (1.20+)",
    speedruncomGameId: "j1npme6p",
    speedruncomCategoryId: "mkeyl926",
    // SSG (Set Seed) + 1.20+
    speedruncomVariables: JSON.stringify({ "wl33kewl": "lx5oek31", "r8rg67rn": "klrzpjo1" }),
    categoryType: "speedruncom" as const,
    displayOrder: 3,
  },
];

async function seedCategories() {
  const db = createDb();

  console.log("Seeding speedrun categories...");

  for (const category of MINECRAFT_CATEGORIES) {
    try {
      await db.insert(speedrunCategories).values({
        name: category.name,
        slug: category.slug,
        description: category.description,
        speedruncomGameId: category.speedruncomGameId,
        speedruncomCategoryId: category.speedruncomCategoryId,
        speedruncomVariables: category.speedruncomVariables,
        categoryType: category.categoryType,
        displayOrder: category.displayOrder,
        isActive: true,
      }).onConflictDoUpdate({
        target: speedrunCategories.slug,
        set: {
          name: category.name,
          description: category.description,
          speedruncomGameId: category.speedruncomGameId,
          speedruncomCategoryId: category.speedruncomCategoryId,
          speedruncomVariables: category.speedruncomVariables,
          displayOrder: category.displayOrder,
          updatedAt: new Date(),
        },
      });
      console.log(`  ✓ ${category.name}`);
    } catch (error) {
      console.error(`  ✗ ${category.name}:`, error);
    }
  }

  console.log("Done!");
}

// 直接実行された場合のみ実行
seedCategories().catch(console.error);
