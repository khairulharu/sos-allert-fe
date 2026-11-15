// The app is mobile-first, and since the desktop showcase landed (PR #21) the
// mobile shell — auth screen included — is `lg:hidden`, i.e. hidden from 1024 px
// up. Playwright's default context is 1280×720, so every locator still resolved
// but was reported "element is not visible" and the regression scripts failed on
// the first `fill()`. Drive them at a phone-sized viewport instead: that is the
// surface the tests actually assert on.
export const MOBILE_VIEWPORT = { width: 390, height: 844 }

// Shared context options for the regression scripts.
export const MOBILE_CONTEXT = { viewport: MOBILE_VIEWPORT }
