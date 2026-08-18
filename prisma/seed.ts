/**
 * prisma/seed.ts
 * -----------------------------------------------------------------------------
 * Idempotent seed. Populates:
 *   - Plans      (from the legacy PLANS in js/data.js)
 *   - ModelPricing (from the legacy MODELS in js/data.js)
 *   - ProviderConfig (from the legacy config.js / .env — values now via env)
 *   - A default admin user (ADMIN_EMAIL / ADMIN_PASSWORD)
 *
 * Safe to run repeatedly — uses upsert everywhere.
 * -----------------------------------------------------------------------------
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedPlans() {
  await prisma.plan.upsert({
    where: { id: "free" },
    update: {},
    create: {
      id: "free",
      name: "Free Tier",
      monthlyFee: 0,
      allowance: BigInt(500_000), // 500K tokens / month
      overage: false,
      highlight: false,
      features: [
        "500K tokens / month",
        "All models included",
        "Token calculator",
        "Usage dashboard",
      ],
    },
  });

  await prisma.plan.upsert({
    where: { id: "payg" },
    update: {},
    create: {
      id: "payg",
      name: "Pay-as-you-go",
      monthlyFee: 0,
      allowance: null, // unlimited (legacy Infinity)
      overage: true,
      highlight: true,
      features: [
        "No monthly fee",
        "Pay only for what you use",
        "All models included",
        "Priority throughput",
        "Usage alerts & budgets",
      ],
    },
  });
}

async function seedModels() {
  const models = [
    {
      id: "deepseek-v4-flash",
      provider: "DeepSeek",
      displayName: "DeepSeek Chat",
      inputPrice: 0.14,
      outputPrice: 0.28,
      contextWindow: 64_000,
      capabilities: ["chat", "code", "reasoning"],
      description: "General-purpose chat model with strong reasoning.",
    },
    {
      id: "deepseek-reasoner",
      provider: "DeepSeek",
      displayName: "DeepSeek Reasoner",
      inputPrice: 0.55,
      outputPrice: 2.19,
      contextWindow: 64_000,
      capabilities: ["advanced-reasoning", "math", "code"],
      description: "Specialized chain-of-thought reasoning model.",
    },
    {
      id: "MiniMax-M3",
      provider: "MiniMax",
      displayName: "MiniMax ABaB Text",
      inputPrice: 0.1,
      outputPrice: 0.3,
      contextWindow: 32_000,
      capabilities: ["chat", "long-context"],
      description: "Fast, cost-efficient text generation.",
    },
    {
      id: "LongCat-2.0",
      provider: "LongCat",
      displayName: "LongCat Flash Chat",
      inputPrice: 0.07,
      outputPrice: 0.2,
      contextWindow: 128_000,
      capabilities: ["chat", "long-context", "multilingual"],
      description: "Ultra-fast model with a large context window.",
    },
    {
      id: "gpt-4o",
      provider: "OpenAI",
      displayName: "GPT-4o",
      inputPrice: 2.5,
      outputPrice: 10,
      contextWindow: 128_000,
      capabilities: ["chat", "reasoning", "code", "multimodal"],
      description: "Flagship general-purpose model with strong reasoning.",
    },
    {
      id: "gpt-4o-mini",
      provider: "OpenAI",
      displayName: "GPT-4o Mini",
      inputPrice: 0.15,
      outputPrice: 0.6,
      contextWindow: 128_000,
      capabilities: ["chat", "code", "fast"],
      description: "Small, fast, and affordable model for focused tasks.",
    },
    {
      id: "claude-opus-4-20250514",
      provider: "Anthropic",
      displayName: "Claude Opus 4",
      inputPrice: 15,
      outputPrice: 75,
      contextWindow: 200_000,
      capabilities: ["chat", "reasoning", "code", "advanced-reasoning"],
      description: "Most capable Claude model for complex tasks.",
    },
    {
      id: "claude-sonnet-4-20250514",
      provider: "Anthropic",
      displayName: "Claude Sonnet 4",
      inputPrice: 3,
      outputPrice: 15,
      contextWindow: 200_000,
      capabilities: ["chat", "reasoning", "code"],
      description: "Balanced model for intelligence and speed.",
    },
    {
      id: "claude-haiku-4-5-20251001",
      provider: "Anthropic",
      displayName: "Claude Haiku 4.5",
      inputPrice: 1,
      outputPrice: 5,
      contextWindow: 200_000,
      capabilities: ["chat", "fast"],
      description: "Fastest and most affordable Claude model.",
    },
  ];

  for (const m of models) {
    await prisma.modelPricing.upsert({
      where: { id: m.id },
      update: {},
      create: m,
    });
  }
}

async function seedProviders() {
  const providers = [
    {
      id: "deepseek",
      displayName: "DeepSeek",
      baseUrl: process.env.SEED_DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      apiKey: process.env.SEED_DEEPSEEK_API_KEY || "",
      chatPath: "/chat/completions",
    },
    {
      id: "minimax",
      displayName: "MiniMax",
      baseUrl: process.env.SEED_MINIMAX_BASE_URL || "https://api.minimax.chat/v1",
      apiKey: process.env.SEED_MINIMAX_API_KEY || "",
      chatPath: "/text/chatcompletion_v2",
    },
    {
      id: "longcat",
      displayName: "LongCat",
      baseUrl: process.env.SEED_LONGCAT_BASE_URL || "https://api.longcat.chat/openai/v1",
      apiKey: process.env.SEED_LONGCAT_API_KEY || "",
      chatPath: "/chat/completions",
    },
    {
      id: "openai",
      displayName: "OpenAI",
      baseUrl: process.env.SEED_OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.SEED_OPENAI_API_KEY || "",
      chatPath: "/chat/completions",
    },
    {
      id: "anthropic",
      displayName: "Anthropic",
      baseUrl: process.env.SEED_ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
      apiKey: process.env.SEED_ANTHROPIC_API_KEY || "",
      chatPath: "/messages",
    },
  ];

  for (const p of providers) {
    await prisma.providerConfig.upsert({
      where: { id: p.id },
      // Only update the key/url if a seed value was provided, so we never
      // clobber keys edited in the admin UI with empty env values.
      update: p.apiKey ? { baseUrl: p.baseUrl, apiKey: p.apiKey } : {},
      create: p,
    });
  }
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@tokenplan.local";
  const password = process.env.ADMIN_PASSWORD || "admin12345";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", disabled: false },
    create: {
      email,
      name: "Administrator",
      passwordHash,
      role: "ADMIN",
      planId: "payg",
    },
  });
  console.log(`Seeded admin user: ${email}`);
}

async function main() {
  await seedPlans();
  await seedModels();
  await seedProviders();
  await seedAdmin(); // depends on plans existing
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
