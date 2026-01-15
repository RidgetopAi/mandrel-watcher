/**
 * Debounce utility for handling rapid git events
 */

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Debounce that also tracks the last processed value to avoid duplicates
 */
export function debounceWithDedup<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  getKey: (...args: Parameters<T>) => string
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastKey: string | null = null;

  return (...args: Parameters<T>) => {
    const key = getKey(...args);
    
    if (key === lastKey) {
      return; // Skip duplicate
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      lastKey = key;
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}
