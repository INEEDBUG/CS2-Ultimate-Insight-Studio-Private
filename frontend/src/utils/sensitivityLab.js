export const SENSITIVITY_TRIAL_SCHEDULE = [
  { kind: "flick", multiplier: 0.8 },
  { kind: "tracking", multiplier: 0.8 },
  { kind: "flick", multiplier: 1.0 },
  { kind: "tracking", multiplier: 1.0 },
  { kind: "flick", multiplier: 1.2 },
  { kind: "tracking", multiplier: 1.2 },
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function makeFlickTrialResult({ multiplier, durationMs, reactions, efficiencies, overshoots }) {
  const hits = reactions.length;
  return {
    kind: "flick",
    multiplier,
    duration_ms: Math.round(durationMs),
    hits,
    targets: hits + 1,
    average_reaction_ms: hits ? reactions.reduce((sum, value) => sum + value, 0) / hits : 0,
    path_efficiency: efficiencies.length
      ? efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length
      : 0,
    overshoots,
    on_target_ratio: 0,
  };
}

export function makeTrackingTrialResult({ multiplier, durationMs, onTargetMs, distanceSamples, overshoots }) {
  const averageDistanceRatio = distanceSamples.length
    ? distanceSamples.reduce((sum, value) => sum + value, 0) / distanceSamples.length
    : 1;
  return {
    kind: "tracking",
    multiplier,
    duration_ms: Math.round(durationMs),
    hits: 0,
    targets: distanceSamples.length,
    average_reaction_ms: 0,
    path_efficiency: clamp(1 - averageDistanceRatio, 0, 1),
    overshoots,
    on_target_ratio: clamp(onTargetMs / Math.max(1, durationMs), 0, 1),
  };
}
