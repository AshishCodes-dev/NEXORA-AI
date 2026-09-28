/**
 * NEXORA Motion System - Transitions
 * Precision, robotic, calibrated cubic-bezier easings and spring definitions.
 */

export const easings = {
  // Precision robotic deceleration
  technical: [0.22, 1, 0.36, 1],
  // Smooth atmospheric reveal
  smooth: [0.16, 1, 0.3, 1],
  // Standard linear-out
  easeOut: [0.0, 0.0, 0.2, 1],
  // Standard linear-in
  easeIn: [0.4, 0.0, 1, 1],
};

export const durations = {
  instant: 0.15,
  fast: 0.25,
  base: 0.38,
  panel: 0.48,
  page: 0.55,
  ambient: 0.7,
};

export const springs = {
  // Tactile micro-click with high damping (no loose bouncing)
  tactile: {
    type: 'spring',
    stiffness: 500,
    damping: 30,
    mass: 0.8,
  },
  // Responsive UI element hover feedback
  subtle: {
    type: 'spring',
    stiffness: 400,
    damping: 28,
  },
  // Controlled module activation
  module: {
    type: 'spring',
    stiffness: 350,
    damping: 32,
  },
};

export const pageTransition = {
  duration: durations.page,
  ease: easings.smooth,
};

export const panelTransition = {
  duration: durations.panel,
  ease: easings.technical,
};

export const itemTransition = {
  duration: durations.base,
  ease: easings.technical,
};
