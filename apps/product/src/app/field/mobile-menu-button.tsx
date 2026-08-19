'use client';

import { useState, useCallback } from 'react';
import styles from './field.module.css';

export function MobileMenuButton() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      const nav = document.querySelector(`.${styles.nav}`);
      if (nav) {
        if (next) {
          nav.classList.add(styles.open);
        } else {
          nav.classList.remove(styles.open);
        }
      }
      return next;
    });
  }, []);

  return (
    <button
      className={styles.hamburger}
      onClick={toggleMenu}
      aria-label="Toggle navigation menu"
      aria-expanded={isOpen}
    >
      {isOpen ? '✕' : '☰'}
    </button>
  );
}
