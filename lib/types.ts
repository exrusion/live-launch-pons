export type GameCategory = "RUNNER" | "FLAPPY" | "SHOOTER";
export type Difficulty = "EASY" | "NORMAL" | "HARD";
export type RebateStatus = "NOT_APPLICABLE" | "PENDING" | "SENDING" | "SENT" | "FAILED";

export type GameGenerationMetadata = {
  mode: "ai" | "deterministic" | "fallback";
  provider: string;
  model: string;
  version: "blueprint-v1";
  attempts: number;
  attemptedModels: string[];
  failureCode?: string;
  jobId?: string;
};

export type GameMechanics = {
  worldPattern: "grid" | "stars" | "circuit" | "waves";
  playerForm: "runner" | "orb" | "ship" | "bot";
  obstacleForm: "barrier" | "spike" | "drone" | "meteor";
  collectibleForm: "shard" | "star" | "crystal" | "neuron";
  gravity: number;
  jumpPower: number;
  spawnRate: number;
  collectibleRate: number;
  obstacleScale: number;
  enemyAggression: number;
  projectileSpeed: number;
};

export type GameConfig = {
  category: GameCategory;
  title: string;
  instructions: string;
  story: string;
  palette: {
    background: string;
    primary: string;
    accent: string;
    danger: string;
    text: string;
  };
  character: { shape: string; label: string };
  obstacle: { shape: string; label: string };
  collectible: { shape: string; label: string };
  difficulty: Difficulty;
  speed: number;
  soundStyle: "arcade" | "soft" | "silent";
  seed: number;
  mechanics: GameMechanics;
  generation?: GameGenerationMetadata;
};

export type CreateGameInput = {
  name: string;
  ticker: string;
  description: string;
  prompt: string;
  category: GameCategory;
  visualStyle: string;
  difficulty: Difficulty;
  developerBuyEth?: string;
  xUrl?: string;
  websiteUrl?: string;
};
