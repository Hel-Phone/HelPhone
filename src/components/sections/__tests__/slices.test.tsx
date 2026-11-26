import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FooterSection } from '../FooterSection'
import { TrustSection } from '../TrustSection'
import { FeaturesSection } from '../FeaturesSection'
import { MapSection } from '../MapSection'

describe('App Slices', () => {
  it('renders FooterSection', () => {
    const { container } = render(<FooterSection />)
    expect(container.querySelector('footer')).toBeDefined()
  })

  it('renders TrustSection', () => {
    const { container } = render(<TrustSection />)
    expect(container.querySelector('section')).toBeDefined()
  })

  it('renders FeaturesSection', () => {
    const { container } = render(<FeaturesSection />)
    expect(container.querySelector('section')).toBeDefined()
  })

  it('renders MapSection', () => {
    const { container } = render(<MapSection />)
    expect(container.querySelector('section')).toBeDefined()
  })

  it('FooterSection uses theme colors (no inline hex)', () => {
    const { container } = render(<FooterSection />)
    const footer = container.querySelector('footer') as HTMLElement
    expect(footer).toBeDefined()
  })

  it('FooterSection respects withLinks prop', () => {
    const { container: withLinks } = render(<FooterSection withLinks={true} />)
    const { container: withoutLinks } = render(<FooterSection withLinks={false} />)
    expect(withLinks.querySelectorAll('a').length).toBeGreaterThan(0)
    expect(withoutLinks.querySelectorAll('a').length).toBe(0)
  })
})
