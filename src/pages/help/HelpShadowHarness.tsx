import React, { useEffect, useState } from 'react'

export interface HelpShadowHarnessProps {
  legacyComponent: React.ReactNode
  modernComponent: React.ReactNode
  enableShadowComparison?: boolean
  onDriftDetected?: (diff: { legacyText: string; modernText: string }) => void
}

/**
 * Shadow-Render Comparison Harness for Help Page Decomposition (#900).
 * Runs the modern decomposed feature module hierarchy in parallel with
 * the legacy component to verify contract alignment and DOM parity without regressions.
 */
export function HelpShadowHarness({
  legacyComponent,
  modernComponent,
  enableShadowComparison = false,
  onDriftDetected,
}: HelpShadowHarnessProps) {
  const [drift, setDrift] = useState<boolean>(false)

  useEffect(() => {
    if (!enableShadowComparison) return

    try {
      // In shadow mode, compare rendered text content
      const legacyEl = document.getElementById('hp-help-shadow-legacy')
      const modernEl = document.getElementById('hp-help-shadow-modern')

      if (legacyEl && modernEl) {
        const legacyText = legacyEl.innerText.trim()
        const modernText = modernEl.innerText.trim()

        if (legacyText !== modernText) {
          setDrift(true)
          onDriftDetected?.({ legacyText, modernText })
        }
      }
    } catch {
      // Shadow comparison is observational only and must never crash the UI
    }
  }, [enableShadowComparison, onDriftDetected])

  if (!enableShadowComparison) {
    return <>{modernComponent}</>
  }

  return (
    <>
      <div id="hp-help-shadow-modern">{modernComponent}</div>
      <div
        id="hp-help-shadow-legacy"
        aria-hidden="true"
        data-testid="help-shadow-legacy-container"
        style={{ display: 'none', visibility: 'hidden' }}
      >
        {legacyComponent}
      </div>
      {drift && (
        <div data-testid="help-shadow-drift-indicator" style={{ display: 'none' }}>
          DRIFT_DETECTED
        </div>
      )}
    </>
  )
}

export default HelpShadowHarness
