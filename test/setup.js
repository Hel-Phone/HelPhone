// HelPhone Test Environment Setup & Cross-Realm Polyfills

if (typeof Symbol !== 'undefined' && Symbol.hasInstance && typeof Uint8Array !== 'undefined') {
  try {
    Object.defineProperty(Uint8Array, Symbol.hasInstance, {
      value(instance) {
        return (
          instance !== null &&
          typeof instance === 'object' &&
          (ArrayBuffer.isView(instance) ||
            instance.constructor?.name === 'Uint8Array' ||
            instance.constructor?.name === 'Buffer' ||
            Object.prototype.toString.call(instance) === '[object Uint8Array]')
        )
      },
      configurable: true,
    })
  } catch (e) {
    // Ignore if non-configurable
  }
}

// Attempt to load jest-dom matchers
try {
  await import("@testing-library/jest-dom")
} catch {
  // @testing-library/dom peer not installed
}
