import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's class combiner, kept local so this product owns its own components
 * rather than resolving them from a shared runtime package.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
