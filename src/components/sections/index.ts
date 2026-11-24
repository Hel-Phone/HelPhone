export { NavSection } from './NavSection'
export type { NavSectionProps } from './NavSection'
export { HeroSection } from './HeroSection'
export type { HeroSectionProps } from './HeroSection'
export { FooterSection } from './FooterSection'
export type { FooterSectionProps } from './FooterSection'
export { TrustSection } from './TrustSection'
export type { TrustSectionProps } from './TrustSection'
export { FeaturesSection } from './FeaturesSection'
export type { FeaturesSectionProps } from './FeaturesSection'
export { MapSection } from './MapSection'
export type { MapSectionProps } from './MapSection'

/** Ordered strangler slices for the landing shell (#770 / #899 / ISP-100). */
export const SLICE_ORDER = [
  { id: 'nav', blast: 'low', status: 'extracted' },
  { id: 'hero', blast: 'low', status: 'extracted' },
  { id: 'footer', blast: 'low', status: 'extracted' },
  { id: 'trust', blast: 'low', status: 'extracted' },
  { id: 'features', blast: 'medium', status: 'extracted' },
  { id: 'map', blast: 'high', status: 'extracted' },
  { id: 'help', blast: 'critical', status: 'planned-last' },
] as const
