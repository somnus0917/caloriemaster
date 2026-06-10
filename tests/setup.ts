import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom 25's localStorage is broken in the test environment, and we want
 * tests to be hermetic anyway. Install a simple in-memory polyfill on the
 * global object before each test.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function installLocalStorage(): void {
  const g = globalThis as unknown as { localStorage?: Storage };
  if (!g.localStorage || typeof g.localStorage.setItem !== "function") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: new MemoryStorage(),
    });
  }
}

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  cleanup();
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    try {
      (globalThis as { localStorage?: Storage }).localStorage?.clear();
    } catch {
      // ignore
    }
  }
});
