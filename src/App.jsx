import { useState, useEffect, useRef } from 'react'
import { MapContainer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Helper to calculate bounding box and center of a geometry
const getBoundsAndCenter = (geometry) => {
  let coords = []
  if (geometry.type === 'LineString') coords = geometry.coordinates
  else if (geometry.type === 'Polygon') coords = geometry.coordinates[0]
  
  if (coords.length === 0) return null

  const lats = coords.map(c => c[1])
  const lngs = coords.map(c => c[0])
  
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  return {
    center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
    area: (maxLat - minLat) * (maxLng - minLng) // Approximate area
  }
}

function FitBounds({ bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 22 })
    }
  }, [bounds, map])
  return null
}

// SVG Text Layer - Same transform matrix as geometries
function SVGTextLayer({ textData, inverterLabels }) {
  const map = useMap()
  const svgRef = useRef(null)

  useEffect(() => {
    if (!map) return

    // Create SVG overlay
    const svg = L.svg({ interactive: false })
    svg.addTo(map)
    svgRef.current = svg

    const svgRoot = svg._rootGroup

    // Add text elements
    const textElements = []
    const inverterElements = []

    // Render text geojson data
    if (textData && textData.features) {
      textData.features.forEach((feature, idx) => {
        if (feature.geometry && feature.geometry.type === 'Point') {
          const coords = feature.geometry.coordinates
          const text = feature.properties?.text || ''
          
          const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          textEl.setAttribute('class', 'svg-text-label')
          textEl.setAttribute('text-anchor', 'middle')
          textEl.setAttribute('dominant-baseline', 'middle')
          textEl.textContent = text
          
          svgRoot.appendChild(textEl)
          textElements.push({ el: textEl, latlng: L.latLng(coords[1], coords[0]) })
        }
      })
    }

    // Render inverter labels
    if (inverterLabels) {
      inverterLabels.forEach((label, idx) => {
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        textEl.setAttribute('class', label.isBig ? 'svg-inv-label big' : 'svg-inv-label small')
        textEl.setAttribute('text-anchor', 'middle')
        textEl.setAttribute('dominant-baseline', 'middle')
        textEl.textContent = label.text
        
        svgRoot.appendChild(textEl)
        inverterElements.push({ el: textEl, latlng: L.latLng(label.position[0], label.position[1]) })
      })
    }

    // Update positions function
    const updatePositions = () => {
      textElements.forEach(({ el, latlng }) => {
        const point = map.latLngToLayerPoint(latlng)
        el.setAttribute('x', point.x)
        el.setAttribute('y', point.y)
      })
      inverterElements.forEach(({ el, latlng }) => {
        const point = map.latLngToLayerPoint(latlng)
        el.setAttribute('x', point.x)
        el.setAttribute('y', point.y)
      })
    }

    // Initial position
    updatePositions()

    // Update on zoom/move - sync with map's internal updates
    map.on('zoomend moveend viewreset', updatePositions)

    return () => {
      map.off('zoomend moveend viewreset', updatePositions)
      if (svgRef.current) {
        map.removeLayer(svgRef.current)
      }
    }
  }, [map, textData, inverterLabels])

  return null
}

function App() {
  const [layers, setLayers] = useState({})
  const [inverterLabels, setInverterLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [bounds, setBounds] = useState(null)

  useEffect(() => {
    const files = ['text', 'lv-inverter-bx', 'poly']
    
    Promise.all(
      files.map(name => 
        fetch(`/${name}.geojson`)
          .then(res => res.json())
          .then(data => ({ name, data }))
          .catch(err => {
            console.warn(`${name}.geojson yüklenemedi:`, err)
            return { name, data: null }
          })
      )
    ).then(results => {
      const layerData = {}
      let allCoords = []
      let inverterAreas = []
      let tempInverterLabels = []

      results.forEach(({ name, data }) => {
        if (data) {
          layerData[name] = data
          
          // Collect coords for bounds
          if (data.features) {
            data.features.forEach(f => {
              const coords = extractCoords(f.geometry)
              allCoords = allCoords.concat(coords)

              // Process Inverters for Labels
              if (name === 'lv-inverter-bx') {
                const info = getBoundsAndCenter(f.geometry)
                if (info) {
                  inverterAreas.push(info.area)
                  f._analysis = info // Store for later
                }
              }
            })
          }
        }
      })

      // Determine threshold for Big vs Small inverters
      if (inverterAreas.length > 0) {
        const avgArea = inverterAreas.reduce((a, b) => a + b, 0) / inverterAreas.length
        
        // Create labels based on threshold
        if (layerData['lv-inverter-bx']) {
          layerData['lv-inverter-bx'].features.forEach(f => {
            if (f._analysis) {
              const isBig = f._analysis.area > avgArea
              tempInverterLabels.push({
                position: f._analysis.center,
                text: isBig ? 'INV' : 'LV',
                isBig
              })
            }
          })
        }
      }

      setLayers(layerData)
      setInverterLabels(tempInverterLabels)
      
      if (allCoords.length > 0) {
        const lats = allCoords.map(c => c[1])
        const lngs = allCoords.map(c => c[0])
        setBounds([
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        ])
      }
      
      setLoading(false)
    })
  }, [])

  const extractCoords = (geometry) => {
    if (!geometry) return []
    const { type, coordinates } = geometry
    if (type === 'Point') return [coordinates]
    if (type === 'LineString' || type === 'MultiPoint') return coordinates
    if (type === 'Polygon' || type === 'MultiLineString') return coordinates.flat()
    if (type === 'MultiPolygon') return coordinates.flat(2)
    return []
  }

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: '#f0f0f0' }}>
      {loading && <div className="loading">Yükleniyor...</div>}
      
      <MapContainer
        center={[0, 0]}
        zoom={18}
        maxZoom={24} // Increased max zoom
        className="map-container"
        style={{ width: '100%', height: '100%', background: '#fff' }} // White background, no tiles
        attributionControl={false}
      >
        {/* No TileLayer */}
        
        {bounds && <FitBounds bounds={bounds} />}
        
        {/* Poly Layer */}
        {layers.poly && (
          <GeoJSON 
            data={layers.poly} 
            style={{
              color: '#2ecc71',
              weight: 1,
              fillColor: '#2ecc71',
              fillOpacity: 0.1
            }} 
          />
        )}

        {/* Inverter Boxes Layer */}
        {layers['lv-inverter-bx'] && (
          <GeoJSON 
            data={layers['lv-inverter-bx']} 
            style={{
              color: '#8e44ad',
              weight: 2,
              fillColor: '#9b59b6',
              fillOpacity: 0.4
            }} 
          />
        )}

        {/* SVG Text Layer - Same transform as geometries */}
        <SVGTextLayer 
          textData={layers.text} 
          inverterLabels={inverterLabels} 
        />

      </MapContainer>
    </div>
  )
}

export default App
