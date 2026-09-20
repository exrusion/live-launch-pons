export type GameCategory = "RUNNER" | "FLAPPY" | "SHOOTER";
export type Difficulty = "EASY" | "NORMAL" | "HARD";
export type RebateStatus = "NOT_APPLICABLE" | "PENDING" | "SENDING" | "SENT" | "FAILED";

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
