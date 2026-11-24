import React from 'react'

export interface HelpMapSectionProps {
  location: [number, number] | null
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchSuggestions: any[]
  isOffline: boolean
  hasOfflineMatch: boolean
  searchError: string | null
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  selectSearchSuggestion: (suggestion: any) => void
}

/**
 * Decomposed Help Feature Module: Location & Map Search (#900).
 * Handles hybrid Mapbox offline geocoder, autocomplete, and coordinate feedback.
 */
export function HelpMapSection({
  location,
  searchQuery,
  setSearchQuery,
  searchSuggestions,
  isOffline,
  hasOfflineMatch,
  searchError,
  handleSearchKeyDown,
  selectSearchSuggestion,
}: HelpMapSectionProps) {
  return (
    <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
      <label
        htmlFor="emergency-location-search"
        style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}
      >
        Your location (city)
      </label>
      <input
        id="emergency-location-search"
        type="text"
        role="combobox"
        aria-expanded={searchSuggestions.length > 0}
        aria-controls="emergency-location-suggestions"
        aria-autocomplete="list"
        placeholder={isOffline ? 'Search offline city list…' : 'Search city…'}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        style={{
          width: '100%',
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid rgba(255,255,255,0.25)',
          background: '#1c2c24',
          color: '#ECE0CC',
        }}
      />
      {isOffline && (
        <p style={{ fontSize: '0.8rem', color: '#FF7A6B', margin: '0.3rem 0 0' }}>
          Offline — using bundled city search.
        </p>
      )}
      {hasOfflineMatch && (
        <p style={{ fontSize: '0.8rem', color: '#a2a586', margin: '0.3rem 0 0' }}>
          Matched offline from the bundled dataset.
        </p>
      )}
      {searchError && (
        <p role="alert" style={{ fontSize: '0.85rem', color: '#FF7A6B', margin: '0.3rem 0 0' }}>
          {searchError}
        </p>
      )}
      {location && (
        <p style={{ fontSize: '0.85rem', color: '#3F8487', margin: '0.3rem 0 0' }}>
          Selected location: {location[0].toFixed(4)}, {location[1].toFixed(4)}
        </p>
      )}
      {searchSuggestions.length > 0 && (
        <ul
          id="emergency-location-suggestions"
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 5,
            left: 0,
            right: 0,
            top: '100%',
            listStyle: 'none',
            margin: '0.3rem 0 0',
            padding: '0.25rem 0',
            background: '#234B4E',
            borderRadius: '0.5rem',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {searchSuggestions.map((suggestion: any, index: number) => (
            <li key={suggestion.id ?? index}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => selectSearchSuggestion(suggestion)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: '#ECE0CC',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {suggestion.text}
                <span style={{ color: '#a2a586', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                  {suggestion.place_name?.split(', ').slice(1).join(', ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default HelpMapSection
