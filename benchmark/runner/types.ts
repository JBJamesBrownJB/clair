export interface SliceDef {
  id: string;
  title: string;
  backlog: string[];
}

export interface RunConfig {
  id: string;
  description?: string;
  status?: string;
  base: {
    branch: string;
    sha: string;
  };
  gate: {
    branch: string;
    sha: string;
    command: string;
  };
  arm: string;
  topology: string;
  level: string;
  slices: SliceDef[];
  agents: number;
  information_asymmetry?: boolean;
  model: string;
  temperature?: number;
  budget: {
    max_tokens_per_agent: number;
    max_turns_per_agent: number;
  };
  integration: {
    mode: string;
    resolver?: string;
    resolver_budget?: {
      max_tokens: number;
      max_turns: number;
    };
  };
  trials: {
    k: number;
  };
  metrics: string[];
}

export interface SliceSpec {
  id: string;
  title: string;
  prompt: string;
}
