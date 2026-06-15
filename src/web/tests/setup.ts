import "@testing-library/jest-dom";

// Mock ResizeObserver (not available in JSDOM)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock scrollIntoView (not available in JSDOM)
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function() {};
