// Focus containment for modal surfaces (the SOS dialog and the incoming-alert
// sheet). `App.svelte` makes everything behind the dialog `inert`, so the only
// reachable controls are inside this node; the action moves focus to the first
// useful control, keeps Tab inside, and restores the previously focused control
// when the dialog is destroyed.
//
//   <div role="dialog" aria-modal="true" tabindex="-1" use:trap={{ initial: '[data-autofocus]' }}>
const SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function visible(el) {
  return el.offsetParent !== null || el.getClientRects().length > 0
}

export function trap(node, { initial } = {}) {
  const previous = typeof document !== 'undefined' ? document.activeElement : null

  const focusables = () => [...node.querySelectorAll(SELECTOR)].filter(visible)

  function onKeydown(event) {
    if (event.key !== 'Tab') return
    const items = focusables()
    if (!items.length) {
      event.preventDefault()
      node.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === node || !node.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !node.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  node.addEventListener('keydown', onKeydown)

  const preferred = initial ? node.querySelector(initial) : null
  const target = preferred || focusables()[0] || node
  // A dialog that opens without moving focus leaves a screen-reader and
  // keyboard user on the button that opened it, behind the overlay.
  requestAnimationFrame(() => target.focus?.())

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown)
      // Return focus to what opened the dialog; a destroyed opener is a no-op.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus?.()
    },
  }
}
