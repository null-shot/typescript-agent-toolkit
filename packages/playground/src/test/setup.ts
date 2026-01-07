import "@testing-library/jest-dom";
import { vi, type MockedFunction, beforeEach } from "vitest";

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn() as MockedFunction<(key: string) => string | null>,
  setItem: vi.fn() as MockedFunction<(key: string, value: string) => void>,
  removeItem: vi.fn() as MockedFunction<(key: string) => void>,
  clear: vi.fn() as MockedFunction<() => void>,
  length: 0,
  key: vi.fn() as MockedFunction<(index: number) => string | null>,
};

// Mock window.localStorage
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.getItem.mockReturnValue(null);
});
