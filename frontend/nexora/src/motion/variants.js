import { easings, durations, springs, pageTransition, panelTransition, itemTransition } from './transitions';

/**
 * NEXORA Motion System - Variants
 * Calibrated animation variants for cyber-intelligence command interface.
 */

// 1. Page-level entrance animation
export const pageEnter = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: pageTransition,
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 2. Glass panel entrance animation
export const panelEnter = {
  initial: {
    opacity: 0,
    y: 10,
    scale: 0.995,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: panelTransition,
  },
  exit: {
    opacity: 0,
    scale: 0.99,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 3. Simple fade in/out
export const fadeIn = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: {
      duration: durations.base,
      ease: easings.smooth,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 4. Subtle slide up (for telemetry, cards, status alerts)
export const slideUp = {
  initial: {
    opacity: 0,
    y: 12,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: durations.base,
      ease: easings.technical,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 5. Subtle slide right (for notifications, drawer entries, hud items)
export const slideRight = {
  initial: {
    opacity: 0,
    x: -12,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      duration: durations.base,
      ease: easings.technical,
    },
  },
  exit: {
    opacity: 0,
    x: 8,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 6. Stagger container for sequential module/item reveals
export const staggerContainer = (staggerTime = 0.05, delayTime = 0.04) => ({
  initial: {},
  animate: {
    transition: {
      staggerChildren: staggerTime,
      delayChildren: delayTime,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
});

// 7. Child item within a stagger container
export const staggerItem = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: itemTransition,
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: durations.fast,
      ease: easings.easeIn,
    },
  },
};

// 8. Subtle scale for interactive cards / focus areas
export const subtleScale = {
  initial: {
    opacity: 0,
    scale: 0.985,
  },
  animate: {
    opacity: 1,
    scale: 1,
    transition: itemTransition,
  },
  hover: {
    scale: 1.01,
    transition: springs.subtle,
  },
};

// 9. Tactile robotic button press
export const buttonPress = {
  hover: {
    scale: 1.012,
    y: -1,
    transition: springs.tactile,
  },
  tap: {
    scale: 0.985,
    y: 0,
    transition: springs.tactile,
  },
};
