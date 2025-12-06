import { useState, useEffect, useRef, useCallback } from 'react'

// Pure Canvas-based GeoJSON viewer
// Text scales proportionally with geometry (like CAD/GIS)

function App() {
  const canvasRef = useRef(null)
  const [layers, setLayers] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    baseScale: 1
  })
  const [bounds, setBounds] = useState(null)
  const [inverterLabels, setInverterLabels] = useState([])
  
  // Pan state
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // Load GeoJSON data
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
        if (data && data.features) {
          layerData[name] = data
          
          data.features.forEach(f => {
            const coords = extractCoords(f.geometry)
            allCoords = allCoords.concat(coords)

            // Process Inverters for Labels
            if (name === 'lv-inverter-bx') {
              const info = getBoundsAndCenter(f.geometry)
              if (info) {
                inverterAreas.push(info.area)
                f._analysis = info
              }
            }
          })
        }
      })

      // Determine threshold for Big vs Small inverters
      if (inverterAreas.length > 0) {
        const avgArea = inverterAreas.reduce((a, b) => a + b, 0) / inverterAreas.length
        
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
      
      // Calculate bounds
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0])
        const lats = allCoords.map(c => c[1])
        const b = {
          minLng: Math.min(...lngs),
          maxLng: Math.max(...lngs),
          minLat: Math.min(...lats),
          maxLat: Math.max(...lats)
        }
        b.width = b.maxLng - b.minLng
        b.height = b.maxLat - b.minLat
        b.centerLng = (b.minLng + b.maxLng) / 2
        b.centerLat = (b.minLat + b.maxLat) / 2
        setBounds(b)
      }
      
      setLoading(false)
    })
  }, [])

  // Initialize view when bounds are set
  useEffect(() => {
    if (!bounds || !canvasRef.current) return
    
    const canvas = canvasRef.current
    const padding = 50
    const availableWidth = canvas.width - padding * 2
    const availableHeight = canvas.height - padding * 2
    
    const scaleX = availableWidth / bounds.width
    const scaleY = availableHeight / bounds.height
    const baseScale = Math.min(scaleX, scaleY)
    
    setViewState({
      offsetX: canvas.width / 2,
      offsetY: canvas.height / 2,
      scale: baseScale,
      baseScale: baseScale
    })
  }, [bounds])

  // Extract coordinates helper
  const extractCoords = (geometry) => {
    if (!geometry) return []
    const { type, coordinates } = geometry
    if (type === 'Point') return [coordinates]
    if (type === 'LineString' || type === 'MultiPoint') return coordinates
    if (type === 'Polygon' || type === 'MultiLineString') return coordinates.flat()
    if (type === 'MultiPolygon') return coordinates.flat(2)
    return []
  }

  // Get bounds and center of geometry
  const getBoundsAndCenter = (geometry) => {
    let coords = []
    if (geometry.type === 'LineString') coords = geometry.coordinates
    else if (geometry.type === 'Polygon') coords = geometry.coordinates[0]
    
    if (coords.length === 0) return null

    const lats = coords.map(c => c[1])
    const lngs = coords.map(c => c[0])
    
    return {
      center: [(lngs.reduce((a,b) => a+b, 0) / lngs.length), (lats.reduce((a,b) => a+b, 0) / lats.length)],
      area: (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs))
    }
  }

  // Transform world coordinates to screen coordinates
  const worldToScreen = useCallback((lng, lat) => {
    if (!bounds) return { x: 0, y: 0 }
    const x = (lng - bounds.centerLng) * viewState.scale + viewState.offsetX
    const y = (bounds.centerLat - lat) * viewState.scale + viewState.offsetY // Y is flipped
    return { x, y }
  }, [bounds, viewState])

  // Render everything
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !bounds) return
    
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    
    // Clear
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    
    // Calculate zoom level for text visibility
    const zoomRatio = viewState.scale / viewState.baseScale
    const showDetailedText = zoomRatio > 0.5 // Hide detailed text when zoomed out too much
    const showInverterLabels = zoomRatio > 0.3
    
    // Draw Poly Layer (background)
    if (layers.poly && layers.poly.features) {
      ctx.strokeStyle = '#2ecc71'
      ctx.lineWidth = 1
      ctx.fillStyle = 'rgba(46, 204, 113, 0.1)'
      
      layers.poly.features.forEach(feature => {
        drawGeometry(ctx, feature.geometry, true)
      })
    }
    
    // Draw Inverter Boxes
    if (layers['lv-inverter-bx'] && layers['lv-inverter-bx'].features) {
      ctx.strokeStyle = '#8e44ad'
      ctx.lineWidth = 2
      ctx.fillStyle = 'rgba(155, 89, 182, 0.4)'
      
      layers['lv-inverter-bx'].features.forEach(feature => {
        drawGeometry(ctx, feature.geometry, true)
      })
    }
    
    // Draw Inverter Labels (INV / LV) - scale with zoom
    if (showInverterLabels && inverterLabels.length > 0) {
      // Font size scales with zoom
      const baseFontSize = 0.00003 // World units
      const fontSize = Math.max(6, Math.min(14, baseFontSize * viewState.scale))
      
      ctx.font = `bold ${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#8e44ad'
      ctx.lineWidth = 2
      
      inverterLabels.forEach(label => {
        const { x, y } = worldToScreen(label.position[0], label.position[1])
        
        // Draw text with stroke for visibility
        ctx.strokeText(label.text, x, y)
        ctx.fillText(label.text, x, y)
      })
    }
    
    // Draw Text Labels - scale with zoom (CAD-like behavior)
    if (showDetailedText && layers.text && layers.text.features) {
      // Font size scales proportionally with zoom
      const baseFontSize = 0.00004 // World units - adjust based on your data scale
      const fontSize = Math.max(4, Math.min(16, baseFontSize * viewState.scale))
      
      // Don't draw if text would be too small
      if (fontSize >= 4) {
        ctx.font = `bold ${fontSize}px Arial`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#e74c3c'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        
        layers.text.features.forEach(feature => {
          if (feature.geometry && feature.geometry.type === 'Point') {
            const coords = feature.geometry.coordinates
            const text = feature.properties?.text || ''
            const { x, y } = worldToScreen(coords[0], coords[1])
            
            // Draw text with white outline for readability
            ctx.strokeText(text, x, y)
            ctx.fillText(text, x, y)
          }
        })
      }
    }
    
  }, [layers, bounds, viewState, inverterLabels, worldToScreen])

  // Draw geometry helper
  const drawGeometry = useCallback((ctx, geometry, fill = false) => {
    if (!geometry) return
    
    const drawPath = (coords) => {
      if (coords.length === 0) return
      ctx.beginPath()
      const start = worldToScreen(coords[0][0], coords[0][1])
      ctx.moveTo(start.x, start.y)
      for (let i = 1; i < coords.length; i++) {
        const pt = worldToScreen(coords[i][0], coords[i][1])
        ctx.lineTo(pt.x, pt.y)
      }
      if (fill) {
        ctx.closePath()
        ctx.fill()
      }
      ctx.stroke()
    }
    
    switch (geometry.type) {
      case 'LineString':
        drawPath(geometry.coordinates)
        break
      case 'Polygon':
        geometry.coordinates.forEach(ring => drawPath(ring))
        break
      case 'MultiLineString':
        geometry.coordinates.forEach(line => drawPath(line))
        break
      case 'MultiPolygon':
        geometry.coordinates.forEach(poly => poly.forEach(ring => drawPath(ring)))
        break
    }
  }, [worldToScreen])

  // Re-render when state changes
  useEffect(() => {
    render()
  }, [render])

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        render()
      }
    }
    
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [render])

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = viewState.scale * zoomFactor
    
    // Zoom toward mouse position
    const newOffsetX = mouseX - (mouseX - viewState.offsetX) * zoomFactor
    const newOffsetY = mouseY - (mouseY - viewState.offsetY) * zoomFactor
    
    setViewState(prev => ({
      ...prev,
      scale: newScale,
      offsetX: newOffsetX,
      offsetY: newOffsetY
    }))
  }, [viewState])

  // Pan handlers
  const handleMouseDown = useCallback((e) => {
    isPanning.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return
    
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    
    setViewState(prev => ({
      ...prev,
      offsetX: prev.offsetX + dx,
      offsetY: prev.offsetY + dy
    }))
  }, [])

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
  }, [])

  // Touch support for mobile
  const lastTouch = useRef({ x: 0, y: 0 })
  const lastPinchDist = useRef(0)

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX
      const dy = e.touches[1].clientY - e.touches[0].clientY
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const handleTouchMove = useCallback((e) => {
    e.preventDefault()
    
    if (e.touches.length === 1) {
      // Pan
      const dx = e.touches[0].clientX - lastTouch.current.x
      const dy = e.touches[0].clientY - lastTouch.current.y
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      
      setViewState(prev => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy
      }))
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[1].clientX - e.touches[0].clientX
      const dy = e.touches[1].clientY - e.touches[0].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      
      if (lastPinchDist.current > 0) {
        const zoomFactor = dist / lastPinchDist.current
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        
        const newScale = viewState.scale * zoomFactor
        const newOffsetX = centerX - (centerX - viewState.offsetX) * zoomFactor
        const newOffsetY = centerY - (centerY - viewState.offsetY) * zoomFactor
        
        setViewState(prev => ({
          ...prev,
          scale: newScale,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        }))
      }
      lastPinchDist.current = dist
    }
  }, [viewState])

  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', background: '#fff' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: '24px',
          color: '#666',
          zIndex: 1001
        }}>
          Yükleniyor...
        </div>
      )}
      
      <canvas
        ref={canvasRef}
        style={{ 
          display: 'block',
          cursor: isPanning.current ? 'grabbing' : 'grab'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { lastPinchDist.current = 0 }}
      />
      
      {/* Zoom info overlay */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        background: 'rgba(255,255,255,0.9)',
        padding: '10px 15px',
        borderRadius: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12
      }}>
        <div>Zoom: {(viewState.scale / viewState.baseScale * 100).toFixed(0)}%</div>
        <div style={{ marginTop: 5, color: '#666', fontSize: 10 }}>
          Scroll: Zoom | Drag: Pan
        </div>
      </div>
    </div>
  )
}

export default App
