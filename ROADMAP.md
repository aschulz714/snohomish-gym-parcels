# Snohomish County Gym Sites — Roadmap

## Current State
- 204K+ gym-friendly parcels displayed on an interactive MapLibre GL JS map
- 558 existing gyms from Overture Maps shown as red dots
- Filters: zoning category, acreage, market value, city, address/gym search
- Satellite/street basemap toggle
- Mobile responsive layout
- Deployed at https://aschulz714.github.io/snohomish-gym-parcels/

## Data Overlays

### Population Density Heatmap
- Source: US Census ACS block group data (free, via Census API or TIGER/Line shapefiles)
- Shade areas by population within surrounding area
- Gyms need sufficient population nearby to sustain membership
- Could use census block groups or tracts as the geographic unit

### Household Income Layer
- Source: ACS median household income by census tract
- CrossFit-style gyms typically need $75K+ median household income nearby
- Color-code tracts: green ($75K+), yellow ($50-75K), red (under $50K)
- Toggle on/off like the existing gym layer

### Age Demographics
- Source: ACS age cohort data by tract
- 25-44 age group is the primary gym membership demographic
- Show concentration of this cohort as a heatmap or choropleth

### Flood Zone Overlay
- Source: FEMA National Flood Hazard Layer (free GeoJSON/shapefile)
- Cheap parcels in floodplains aren't actually deals — higher insurance, permitting restrictions
- Show flood zones as semi-transparent overlay, toggle on/off

### Utility/Sewer Availability
- Source: Snohomish County GIS (often published as open data)
- Parcels on septic vs. municipal sewer have very different buildout costs
- Important for large parcels in rural areas (Undeveloped, Residential SFR)

## Analysis Features

### Competition Buffer Rings
- Draw 3-mile and 5-mile radius circles around each existing gym
- Parcels outside all rings are underserved areas — prime opportunities
- Could color parcels by "nearest gym distance" (green = far from competition)
- Implementation: Turf.js buffer/distance calculations client-side

### Drive-Time Isochrones
- Click any parcel to see 5/10/15-minute drive-time polygons
- Uses free routing API: OSRM (self-hosted) or Valhalla (Mapzen, free tier)
- Shows real catchment area accounting for road network, not just straight-line distance
- More accurate than simple radius circles

### Site Scoring / Ranking
- Composite score for each parcel based on weighted factors:
  - Population within 10-min drive
  - Distance from nearest competitor gym
  - Median household income in surrounding area
  - Lot size relative to need
  - Price (lower = better)
  - Age demographic fit (25-44 concentration)
- Surface top 20 parcels in a sidebar list, clickable to fly to each
- Allow adjusting weights via sliders

### Cost Per Square Foot
- Derive from existing data: MKTTL / GIS_SQ_FT
- Add to parcel popup and as a filter slider
- Quick way to compare land value across parcels

### Export to CSV
- Button to export currently filtered parcels to CSV/spreadsheet
- Include all properties: address, parcel ID, acres, zoning, market value, city, ZIP
- Useful for sharing with a realtor or building a financial pro forma

## Practical Additions

### County Zoning/Permit Links
- Each city has different conditional use permit (CUP) requirements
- Add links to relevant municipal code from the parcel popup based on SITUSCITY
- Key cities: Lake Stevens, Everett, Marysville, Snohomish, Arlington, Monroe

### Parcel Detail Links
- Link from popup to Snohomish County Assessor's parcel detail page
- URL pattern: typically based on PARCEL_ID
- Gives access to full property history, tax info, permits

## Priority Order (Suggested)
1. Competition buffer rings (quick win with Turf.js, high insight value)
2. Household income layer (answers "can people here afford a gym?")
3. Export to CSV (practical, helps friend take action)
4. Cost per square foot (derived from existing data, no new sources needed)
5. Flood zone overlay (FEMA data is free and easy to add)
6. Population density (Census API requires some setup)
7. Drive-time isochrones (needs routing API integration)
8. Site scoring (depends on having the other data layers first)
9. Age demographics (nice to have, Census API)
10. Zoning/permit links (research-heavy, city by city)
