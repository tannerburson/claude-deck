export type ServiceState = "idle" | "running" | "attention" | "completed" | "failed";

export type AnimationState = {
  animationFrame?: number; // current animation frame for running state
  animationDirection?: 1 | -1; // 1 for forward, -1 for backward
  animationTimer?: NodeJS.Timeout; // timer for animation cycling
};

export type Service = {
  id: string;
  name: string;
  state: ServiceState;
  assignedContext?: string; // context of the slot key
} & AnimationState;

export type ServiceSummary = {
  running: number;
  attention: number;
  completed: number;
  failed: number;
  tracked: number; // total non-idle services
};

export type Slot = {
  context: string;               // Stream Deck context for this key
  setTitle: (t?: string) => Promise<void>;
  setImage: (svg?: string) => Promise<void>;
  showOk: () => Promise<void>;
  showAlert: () => Promise<void>;
};

// An aggregate key showing combined status across all services.
// Owns its own animation state, independent of any single service.
export type AggregateView = {
  slot: Slot;
} & AnimationState;
