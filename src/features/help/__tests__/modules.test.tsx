import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RequestFormModule } from '../RequestFormModule'
import { ResponderTrackerModule } from '../ResponderTrackerModule'
import { HistoryModule } from '../HistoryModule'

describe('Help Feature Modules', () => {
  it('renders RequestFormModule', () => {
    const { container } = render(
      <RequestFormModule onSubmit={async () => {}} />
    )
    expect(container.querySelector('form')).toBeDefined()
  })

  it('renders ResponderTrackerModule', () => {
    const { container } = render(
      <ResponderTrackerModule requestId="test" />
    )
    expect(container.querySelector('h3')).toBeDefined()
  })

  it('renders HistoryModule', () => {
    const { container } = render(
      <HistoryModule userId="test" />
    )
    expect(container.querySelector('h3')).toBeDefined()
  })
})
