import React from 'react';
import { motion } from 'motion/react';
import { pageEnter } from '../motion/variants';

/**
 * MotionPage component
 * Provides a standardized entrance animation for views and pages
 * adhering to the NEXORA cyber-intelligence motion foundation.
 */
export default function MotionPage({ children, className = '', ...props }) {
  return (
    <motion.div
      variants={pageEnter}
      initial="initial"
      animate="animate"
      exit="exit"
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
