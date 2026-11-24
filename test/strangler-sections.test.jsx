import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  SLICE_ORDER,
  NavSection,
  HeroSection,
  FooterSection,
  TrustSection,
  FeaturesSection,
  MapSection,
} from '../src/components/sections/index.ts'
import { colors, motion } from '../src/theme/tokens.ts'

describe('Issue #899: Complete src/App.tsx strangler slices', () => {
  it('marks slices 1 through 6 as extracted and keeps help planned-last', () => {
    const extractedIds = ['nav', 'hero', 'footer', 'trust', 'features', 'map']
    for (const id of extractedIds) {
      const slice = SLICE_ORDER.find((s) => s.id === id)
      expect(slice, `Slice ${id} should exist`).toBeDefined()
      expect(slice?.status).toBe('extracted')
    }

    const helpSlice = SLICE_ORDER.find((s) => s.id === 'help')
    expect(helpSlice).toBeDefined()
    expect(helpSlice?.status).toBe('planned-last')
    expect(SLICE_ORDER.at(-1)?.id).toBe('help')
  })

  it('keeps brand tokens centralised with no inline hex in src/components/sections/', () => {
    expect(colors.coral).toBe('#FF7A6B')
    expect(colors.cream).toBe('#ECE0CC')
    expect(colors.background).toBe('#1c2c24')
    expect(colors.purple).toBe('#7357FF')
    expect(colors.teal).toBe('#3F8487')
    expect(motion.revealFallbackMs).toBe(4500)

    const sectionsDir = join(process.cwd(), 'src', 'components', 'sections')
    const files = readdirSync(sectionsDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))

    const hexColorRegex = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

    for (const file of files) {
      const content = readFileSync(join(sectionsDir, file), 'utf8')
      const matches = content.match(hexColorRegex) || []
      expect(
        matches,
        `File src/components/sections/${file} contains hardcoded hex colors: ${matches.join(', ')}`
      ).toEqual([])
    }
  })

  it('exports all 6 section components as valid React components', () => {
    expect(typeof NavSection).toBe('function')
    expect(typeof HeroSection).toBe('function')
    expect(typeof FooterSection).toBe('function')
    expect(typeof TrustSection).toBe('function')
    expect(typeof FeaturesSection).toBe('function')
    expect(typeof MapSection).toBe('function')
  })
})
