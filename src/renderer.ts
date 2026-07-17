import type { AggregateView, AnimationState, Service, ServiceSummary, Slot } from "./types.js";
import { ANIMATION_FRAMES, ANIMATION_FRAME_DURATION } from "./config.js";

function stopAnimation(anim: AnimationState) {
  if (anim.animationTimer) {
    clearInterval(anim.animationTimer);
    anim.animationTimer = undefined;
  }
}

// Ping-pong the running frames on the given slot. Frame position lives on
// `anim`, so repaints resume from the current frame instead of restarting.
function startPulseAnimation(anim: AnimationState, slot: Slot) {
  stopAnimation(anim);

  anim.animationFrame = anim.animationFrame || 1;
  anim.animationDirection = anim.animationDirection || 1;

  const updateFrame = () => {
    const frameNumber = anim.animationFrame || 1;
    slot.setImage(`imgs/states/running-${frameNumber}.svg`);

    // Ping-pong animation: 1→2→3→4→5→6→5→4→3→2→1→2→...
    const direction = anim.animationDirection || 1;
    let nextFrame = frameNumber + direction;

    // Change direction at boundaries
    if (nextFrame > ANIMATION_FRAMES) {
      anim.animationDirection = -1;
      nextFrame = ANIMATION_FRAMES - 1; // Go back one frame from max
    } else if (nextFrame < 1) {
      anim.animationDirection = 1;
      nextFrame = 2; // Go forward to frame 2
    }

    anim.animationFrame = nextFrame;
  };

  // Set initial frame
  updateFrame();

  // Set up timer for animation using configurable duration
  anim.animationTimer = setInterval(updateFrame, ANIMATION_FRAME_DURATION);
}

export function paintIdle(slot: Slot) {
  slot.setTitle(""); // Clear the title when going to idle state
  return slot.setImage("imgs/states/idle.svg");
}

export function paintRunning(slot: Slot, name: string, service: Service) {
  slot.setTitle(name);
  startPulseAnimation(service, slot);
  return Promise.resolve();
}

export function paintAttention(slot: Slot, name: string) {
  slot.setTitle(name);
  return slot.setImage("imgs/states/attention.svg");
}

export function paintDone(slot: Slot, name: string) {
  slot.setTitle(name);
  return slot.setImage("imgs/states/completed.svg");
}

export function paintFailed(slot: Slot, name: string) {
  slot.setTitle(name);
  return slot.setImage("imgs/states/completed.svg"); // Use same image for failed state
}

export function stopAggregateAnimation(view: AggregateView) {
  stopAnimation(view);
}

// Paint an aggregate key from a summary of all services. Priority rollup:
// any attention → static amber icon (most actionable); else any running →
// pulsating icon; else any finished → static icon; else idle.
export function paintAggregate(view: AggregateView, summary: ServiceSummary) {
  const { slot } = view;

  if (summary.tracked === 0) {
    stopAggregateAnimation(view);
    return paintIdle(slot);
  }

  const lines: string[] = [];
  if (summary.attention) lines.push(`! ${summary.attention}`);
  if (summary.running) lines.push(`▶ ${summary.running}`);
  if (summary.completed) lines.push(`✓ ${summary.completed}`);
  if (summary.failed) lines.push(`✗ ${summary.failed}`);
  slot.setTitle(lines.join("\n"));

  if (summary.attention > 0) {
    stopAggregateAnimation(view);
    return slot.setImage("imgs/states/attention.svg");
  }

  if (summary.running > 0) {
    startPulseAnimation(view, slot);
    return Promise.resolve();
  }

  stopAggregateAnimation(view);
  return slot.setImage("imgs/states/completed.svg");
}
