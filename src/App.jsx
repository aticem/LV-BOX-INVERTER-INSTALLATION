import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import useDailyLog from './hooks/useDailyLog'
import useChartExport from './hooks/useChartExport'
import SubmitModal from './components/SubmitModal'
import HistoryModal from './components/HistoryModal'

// Pure Canvas-based GeoJSON viewer
// Text scales proportionally with geometry (like CAD/GIS)

function App() {
  const canvasRef = useRef(null)
  const [layers, setLayers] = useState({})
  const [loading, setLoading] = useState(true)
  
  // Modal states
  const [submitModalOpen, setSubmitModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  
  // Daily log hook
  const { dailyLog, addRecord, deleteRecord, resetLog } = useDailyLog()
  const { exportToExcel } = useChartExport()
  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    baseScale: 1
  })
  const [bounds, setBounds] = useState(null)
  const [inverterLabels, setInverterLabels] = useState([])
  const [totalBoxCount, setTotalBoxCount] = useState(0) // Actual GeoJSON feature count
  const [hoveredText, setHoveredText] = useState(null)
  const [completedBoxes, setCompletedBoxes] = useState(new Set())
  const [noteMode, setNoteMode] = useState(false)
  const [selectionBox, setSelectionBox] = useState(null) // New: Selection Box Coords
  const [notes, setNotes] = useState([])
  const [selectedNote, setSelectedNote] = useState(null)
  const [noteEditor, setNoteEditor] = useState(null)
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  // Pan state
  const isPanning = useRef(false)
  const hasMoved = useRef(false) // Track if actual movement occurred
  const lastMouse = useRef({ x: 0, y: 0 })

  // Quick lookup for box features by id
  const boxFeatureMap = useMemo(() => {
    const map = new Map()
    const layer = layers['lv-inverter-bx']
    if (layer && layer.features) {
      layer.features.forEach((feature, index) => {
        const boxId = feature.properties?.id || index
        map.set(boxId, feature)
      })
    }
    return map
  }, [layers])

  // Load GeoJSON data
  useEffect(() => {
    const files = ['text', 'lv-inverter-bx', 'poly']
    
    Promise.all(
      files.map(name => 
        fetch(`/${name}.geojson`)
          .then(res => res.json())
          .then(data => ({ name, data }))
          .catch(err => {
            console.warn(`Failed to load ${name}.geojson:`, err)
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
          layerData['lv-inverter-bx'].features.forEach((f, index) => {
            if (f._analysis) {
              const isBig = f._analysis.area > avgArea
              const boxId = f.properties?.id || index
              tempInverterLabels.push({
                position: f._analysis.center,
                area: f._analysis.area,
                text: isBig ? 'INV' : 'LV',
                isBig,
                boxId // Include box ID for completion check
              })
            }
          })
        }
      }

      setLayers(layerData)
      setInverterLabels(tempInverterLabels)
      // Set total box count from actual GeoJSON features
      setTotalBoxCount(layerData['lv-inverter-bx']?.features?.length || 0)
      
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

  // Scale geometry from center point
  const scaleGeometryFromCenter = (geometry, center, scaleFactor) => {
    const scaleCoord = (coord) => {
      const [lng, lat] = coord
      const [centerLng, centerLat] = center
      return [
        centerLng + (lng - centerLng) * scaleFactor,
        centerLat + (lat - centerLat) * scaleFactor
      ]
    }

    const scaleCoords = (coords) => coords.map(scaleCoord)

    switch (geometry.type) {
      case 'Polygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(ring => scaleCoords(ring))
        }
      case 'MultiPolygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(poly => 
            poly.map(ring => scaleCoords(ring))
          )
        }
      case 'LineString':
        return {
          ...geometry,
          coordinates: scaleCoords(geometry.coordinates)
        }
      case 'MultiLineString':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(line => scaleCoords(line))
        }
      default:
        return geometry
    }
  }

  // Transform world coordinates to screen coordinates
  const worldToScreen = useCallback((lng, lat) => {
    if (!bounds) return { x: 0, y: 0 }
    const x = (lng - bounds.centerLng) * viewState.scale + viewState.offsetX
    const y = (bounds.centerLat - lat) * viewState.scale + viewState.offsetY // Y is flipped
    return { x, y }
  }, [bounds, viewState])

  // Screen to world coordinates
  const screenToWorld = useCallback((screenX, screenY) => {
    if (!bounds) return [0, 0]
    const lng = (screenX - viewState.offsetX) / viewState.scale + bounds.centerLng
    const lat = bounds.centerLat - (screenY - viewState.offsetY) / viewState.scale
    return [lng, lat]
  }, [bounds, viewState])

  // Translate geometry by offsets
  const translateGeometry = useCallback((geometry, offsetLng, offsetLat) => {
    const shiftCoord = ([lng, lat]) => [lng + offsetLng, lat + offsetLat]

    const shiftCoords = (coords) => coords.map(shiftCoord)

    switch (geometry.type) {
      case 'Polygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(ring => shiftCoords(ring))
        }
      case 'MultiPolygon':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(poly =>
            poly.map(ring => shiftCoords(ring))
          )
        }
      case 'LineString':
        return { ...geometry, coordinates: shiftCoords(geometry.coordinates) }
      case 'MultiLineString':
        return {
          ...geometry,
          coordinates: geometry.coordinates.map(line => shiftCoords(line))
        }
      default:
        return geometry
    }
  }, [])

  // Compute outward offset to increase spacing between boxes
  const getBoxOffset = useCallback((center, area) => {
    if (!bounds || !center || !area) return { dx: 0, dy: 0 }
    const dx = center[0] - bounds.centerLng
    const dy = center[1] - bounds.centerLat
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const approxWidth = Math.sqrt(area) || 0
    const spread = approxWidth * 2.0 // about two box widths
    return {
      dx: (dx / dist) * spread,
      dy: (dy / dist) * spread
    }
  }, [bounds])

  const pointInPolygon = useCallback((point, polygon) => {
    const [px, py] = point
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]
      const [xj, yj] = polygon[j]
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi + 0.0000001) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }, [])

  const isPointInGeometry = useCallback((geometry, lng, lat) => {
    if (!geometry) return false
    const pt = [lng, lat]
    if (geometry.type === 'Polygon') {
      return pointInPolygon(pt, geometry.coordinates[0])
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some(poly => pointInPolygon(pt, poly[0]))
    }
    return false
  }, [pointInPolygon])

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
      ctx.strokeStyle = '#1a1a1a' // Black stroke
      ctx.lineWidth = 1
      ctx.fillStyle = 'rgba(30, 30, 30, 0.15)' // Dark fill
      
      layers.poly.features.forEach(feature => {
        drawGeometry(ctx, feature.geometry, true)
      })
    }
    
    // Draw Inverter Boxes
    if (layers['lv-inverter-bx'] && layers['lv-inverter-bx'].features) {
      layers['lv-inverter-bx'].features.forEach((feature, index) => {
        const boxId = feature.properties?.id || index
        const isCompleted = completedBoxes.has(boxId)
        
        // Bright green for completed, orange for pending
        ctx.strokeStyle = isCompleted ? '#22c55e' : '#e67e22'
        ctx.lineWidth = isCompleted ? 3 : 2
        ctx.fillStyle = isCompleted ? 'rgba(34, 197, 94, 0.5)' : 'rgba(230, 126, 34, 0.4)'
        
        // Scale box geometry ~3x area and then spread outward to increase gaps
        if (feature._analysis && feature._analysis.center) {
          const center = feature._analysis.center
          const scaledGeometry = scaleGeometryFromCenter(feature.geometry, center, 1.75)
          const { dx: offsetLng, dy: offsetLat } = getBoxOffset(center, feature._analysis.area)
          const translated = translateGeometry(scaledGeometry, offsetLng, offsetLat)
          drawGeometry(ctx, translated, true)
        } else {
          drawGeometry(ctx, feature.geometry, true)
        }
      })
    }
    
    // Draw Notes
    if (notes.length > 0) {
      notes.forEach(note => {
        const { x, y } = worldToScreen(note.position[0], note.position[1])
        const radius = Math.max(4, Math.min(8, 6 * (viewState.scale / viewState.baseScale)))
        const scaledRadius = note.selected ? radius * 1.4 : radius
        
        ctx.beginPath()
        ctx.arc(x, y, scaledRadius, 0, 2 * Math.PI)
        ctx.fillStyle = note.selected ? '#9b59b6' : '#e74c3c'
        ctx.strokeStyle = note.selected ? '#8e44ad' : '#c0392b'
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
        
        // Inner dot
        ctx.beginPath()
        ctx.arc(x, y, scaledRadius * 0.3, 0, 2 * Math.PI)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
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
      ctx.lineWidth = 2
      
      inverterLabels.forEach(label => {
        const feature = boxFeatureMap.get(label.boxId)
        if (!feature || !feature._analysis) return
        
        // Label position = box center + spacing offset (same as box itself)
        const offset = getBoxOffset(label.position, label.area)
        const shiftedLng = label.position[0] + offset.dx
        const shiftedLat = label.position[1] + offset.dy

        const { x, y } = worldToScreen(shiftedLng, shiftedLat)
        const isCompleted = completedBoxes.has(label.boxId)
        
        // Green stroke for completed, orange for pending
        ctx.strokeStyle = isCompleted ? '#22c55e' : '#e67e22'
        ctx.fillStyle = '#ffffff'
        
        // Draw text with stroke for visibility
        ctx.strokeText(label.text, x, y)
        ctx.fillText(label.text, x, y)
      })
    }
    
    // Draw Text Labels - ONLY ON HOVER
    if (hoveredText) {
      // Font size scales proportionally with zoom
      const baseFontSize = 0.00004 // World units
      const fontSize = Math.max(10, Math.min(16, baseFontSize * viewState.scale))
      
      ctx.font = `${fontSize}px "Segoe UI Light", "Helvetica Neue", Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#e8e8e8' // Soft white - easy on eyes
      ctx.strokeStyle = '#333333' // Dark stroke for contrast
      ctx.lineWidth = 2
      
      const { x, y } = worldToScreen(hoveredText.coords[0], hoveredText.coords[1])
      
      // Draw text with dark outline for readability
      ctx.strokeText(hoveredText.text, x, y)
      ctx.fillText(hoveredText.text, x, y)
    }

    // Draw Selection Box
    if (selectionBox) {
      const { startX, startY, endX, endY, action } = selectionBox
      const width = endX - startX
      const height = endY - startY
      const isRemove = action === 'remove'
      
      ctx.strokeStyle = isRemove ? '#ef4444' : '#3b82f6'
      ctx.lineWidth = 1
      ctx.fillStyle = isRemove ? 'rgba(239, 68, 68, 0.18)' : 'rgba(59, 130, 246, 0.2)'
      
      ctx.fillRect(startX, startY, width, height)
      ctx.strokeRect(startX, startY, width, height)
    }
    
  }, [layers, bounds, viewState, inverterLabels, worldToScreen, hoveredText, completedBoxes, notes, selectionBox, translateGeometry, getBoxOffset, boxFeatureMap, isPointInGeometry])

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1)
      const state = history[historyIndex - 1]
      setCompletedBoxes(new Set(state.completedBoxes))
      setNotes([...state.notes])
    }
  }, [history, historyIndex])
  
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1)
      const state = history[historyIndex + 1]
      setCompletedBoxes(new Set(state.completedBoxes))
      setNotes([...state.notes])
    }
  }, [history, historyIndex])

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

  // Re-render when state changes
  useEffect(() => {
    render()
  }, [render, notes, completedBoxes, viewState, hoveredText])

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

  // Pan/Select handlers
  const handleMouseDown = useCallback((e) => {
    hasMoved.current = false // Reset movement tracker

    // Middle Mouse Button (1) -> Pan
    if (e.button === 1) {
      e.preventDefault()
      isPanning.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      return
    }

    // Right Mouse Button (2) -> Selection Box for Unselect (if not in note mode)
    if (e.button === 2 && !noteMode) {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      setSelectionBox({ startX: x, startY: y, endX: x, endY: y, action: 'remove' })
      return
    }

    // Left Mouse Button (0) -> Selection Box for Select (if not in note mode)
    if (e.button === 0 && !noteMode) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      setSelectionBox({ startX: x, startY: y, endX: x, endY: y, action: 'add' })
    }
  }, [noteMode])

  const handleCanvasClick = useCallback((e) => {
    // Skip if actual panning occurred
    if (hasMoved.current) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // Only allow clicking on notes when in note mode
    if (noteMode) {
      // First check if clicked on an existing note marker
      for (const note of notes) {
        const { x, y } = worldToScreen(note.position[0], note.position[1])
        const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2))
        if (dist < 15) {
          // Open editor for this note immediately
          flushSync(() => {
            setNoteEditor({ noteId: note.id, x: mouseX, y: mouseY })
          })
          return
        }
      }
      
      // Check if there's already a note nearby (prevent duplicates)
      const worldPos = screenToWorld(mouseX, mouseY)
      const minDistance = 0.00005 // Minimum distance between notes in world units
      
      for (const note of notes) {
        const dx = note.position[0] - worldPos[0]
        const dy = note.position[1] - worldPos[1]
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDistance) {
          // Too close to existing note, don't create new one
          return
        }
      }
      
      // Add new note immediately (just the marker, no popup)
      const newNote = {
        id: Date.now(),
        position: worldPos,
        text: '',
        selected: false
      }
      flushSync(() => {
        setNotes(prev => [...prev, newNote])
      })
    } else {
      // Check if clicked on a box
      if (layers['lv-inverter-bx'] && layers['lv-inverter-bx'].features) {
        for (let i = 0; i < layers['lv-inverter-bx'].features.length; i++) {
          const feature = layers['lv-inverter-bx'].features[i]
          if (feature._analysis) {
            const offset = getBoxOffset(feature._analysis.center, feature._analysis.area)
            const { x, y } = worldToScreen(
              feature._analysis.center[0] + offset.dx,
              feature._analysis.center[1] + offset.dy
            )
            const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2))
            if (dist < 30) { // Click radius
              const boxId = feature.properties?.id || i
              setCompletedBoxes(prev => {
                const newSet = new Set(prev)
                if (newSet.has(boxId)) {
                  newSet.delete(boxId)
                } else {
                  newSet.add(boxId)
                }
                return newSet
              })
              break
            }
          }
        }
      }
    }
  }, [noteMode, layers, notes, worldToScreen, screenToWorld, getBoxOffset, boxFeatureMap, isPointInGeometry, translateGeometry])

  const handleMouseMove = useCallback((e) => {
    // Handle Selection (Left Drag)
    if (selectionBox) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      setSelectionBox(prev => ({ ...prev, endX: x, endY: y }))
      
      // Mark as moved if box has size
      if (Math.abs(x - selectionBox.startX) > 5 || Math.abs(y - selectionBox.startY) > 5) {
        hasMoved.current = true
      }
      return
    }

    // Handle Pan (Middle Drag)
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      
      // Mark as moved if there's any significant movement
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMoved.current = true
      }
      
      lastMouse.current = { x: e.clientX, y: e.clientY }
      
      setViewState(prev => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy
      }))
      return
    }

    // Handle Hover for Text IDs
    if (layers.text && layers.text.features && bounds) {
      const canvas = canvasRef.current
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      // Find closest text feature
      let closest = null
      let minDist = 20 // Detection radius in pixels

      for (const feature of layers.text.features) {
        if (feature.geometry && feature.geometry.type === 'Point') {
          const coords = feature.geometry.coordinates
          const { x, y } = worldToScreen(coords[0], coords[1])
          
          const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2))
          if (dist < minDist) {
            minDist = dist
            closest = {
              text: feature.properties?.text || '',
              coords: coords
            }
          }
        }
      }
      
      setHoveredText(closest)
    }
  }, [layers, bounds, viewState, worldToScreen, selectionBox])

  const handleMouseUp = useCallback(() => {
    if (selectionBox) {
      // Finalize selection only if we actually dragged (hasMoved is true)
      if (hasMoved.current) {
        const { startX, startY, endX, endY, action } = selectionBox
        const minX = Math.min(startX, endX)
        const maxX = Math.max(startX, endX)
        const minY = Math.min(startY, endY)
        const maxY = Math.max(startY, endY)
        
        const selectedIds = []
        
        inverterLabels.forEach(label => {
          const feature = boxFeatureMap.get(label.boxId)
          if (!feature || !feature._analysis) return
          
          const offset = getBoxOffset(label.position, label.area)
          const shiftedLng = label.position[0] + offset.dx
          const shiftedLat = label.position[1] + offset.dy

          const { x, y } = worldToScreen(shiftedLng, shiftedLat)
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            selectedIds.push(label.boxId)
          }
        })
        
        if (selectedIds.length > 0) {
          setCompletedBoxes(prev => {
            const newSet = new Set(prev)
            if (action === 'remove') {
              selectedIds.forEach(id => newSet.delete(id))
            } else {
              selectedIds.forEach(id => newSet.add(id))
            }
            return newSet
          })
        }
      }
      
      setSelectionBox(null)
    }
    isPanning.current = false
  }, [selectionBox, inverterLabels, worldToScreen])

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
    <div className="map-container" style={{ width: '100%', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div className="top-panel">
        <div className="counters">
          <div className="counter-row">
            <span className="counter-label">LV Box Total: {inverterLabels.filter(l => !l.isBig).length}</span>
            <span className="counter-item completed">Done <strong>{inverterLabels.filter(l => !l.isBig && completedBoxes.has(l.boxId)).length}</strong></span>
            <span className="counter-item remaining">Remain <strong>{inverterLabels.filter(l => !l.isBig && !completedBoxes.has(l.boxId)).length}</strong></span>
          </div>
          <div className="counter-row">
            <span className="counter-label">INVERTER Total: {inverterLabels.filter(l => l.isBig).length}</span>
            <span className="counter-item completed">Done <strong>{inverterLabels.filter(l => l.isBig && completedBoxes.has(l.boxId)).length}</strong></span>
            <span className="counter-item remaining">Remain <strong>{inverterLabels.filter(l => l.isBig && !completedBoxes.has(l.boxId)).length}</strong></span>
          </div>
        </div>

        <div className="toolbar">
          <button 
            className="tool-btn" 
            title="Submit Daily Work"
            onClick={() => setSubmitModalOpen(true)}
          >📋</button>
          <button 
            className="tool-btn" 
            title="View Submission History"
            onClick={() => setHistoryModalOpen(true)}
          >🗒️</button>
          <button 
            className="tool-btn" 
            title="Export to Excel"
            onClick={() => exportToExcel(dailyLog)}
          >📊</button>
          <div className="toolbar-divider"></div>
          <button 
            className={`tool-btn ${noteMode ? 'active' : ''}`} 
            title="Toggle Note Mode"
            onClick={() => setNoteMode(!noteMode)}
          >📝</button>
          <button 
            className="tool-btn" 
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={historyIndex <= 0}
          >↩️</button>
          <button 
            className="tool-btn" 
            title="Redo (Ctrl+Y)"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
          >↪️</button>
        </div>
      </div>

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
          Loading...
        </div>
      )}
      
      <canvas
        ref={canvasRef}
        style={{ 
          display: 'block',
          cursor: isPanning.current ? 'grabbing' : (noteMode ? 'crosshair' : 'default')
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { lastPinchDist.current = 0 }}
      />
      
      {/* NOTE MODE indicator */}
      {noteMode && (
        <div style={{
          position: 'absolute',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: 20,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: 1,
          boxShadow: '0 4px 15px rgba(37, 99, 235, 0.4)',
          zIndex: 1001,
          fontFamily: 'Arial, sans-serif'
        }}>
          📝 NOTE MODE
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute',
        top: 80,
        right: 20,
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '12px 16px',
        borderRadius: 10,
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        color: '#e5e7eb',
        zIndex: 1000
      }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: '#fff' }}>Legend</div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'rgba(34, 197, 94, 0.5)',
            border: '2px solid #22c55e',
            marginRight: 10
          }}></div>
          <span>Installation Done</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'rgba(230, 126, 34, 0.4)',
            border: '2px solid #e67e22',
            marginRight: 10
          }}></div>
          <span>Not Installed</span>
        </div>
      </div>

      {/* Zoom info overlay */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '10px 15px',
        borderRadius: 8,
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        color: '#e5e7eb'
      }}>
        <div>Zoom: {(viewState.scale / viewState.baseScale * 100).toFixed(0)}%</div>
        <div style={{ marginTop: 5, color: '#9ca3af', fontSize: 10 }}>
          Scroll: Zoom | Middle Drag: Pan | Left Drag: Select | Right Drag: Unselect
        </div>
      </div>

      {/* Note Editor Popup */}
      {noteEditor && (
        <div 
          className="note-editor"
          style={{
            left: noteEditor.x,
            top: noteEditor.y - 10
          }}
        >
          <textarea
            placeholder="Enter your note..."
            autoFocus
            value={notes.find(n => n.id === noteEditor.noteId)?.text || ''}
            onChange={(e) => {
              const text = e.target.value
              setNotes(prev => prev.map(n => 
                n.id === noteEditor.noteId ? { ...n, text } : n
              ))
            }}
          />
          <div className="note-actions">
            <button onClick={() => setNoteEditor(null)}>Save</button>
            <button onClick={() => {
              setNotes(prev => prev.filter(n => n.id !== noteEditor.noteId))
              setNoteEditor(null)
            }}>Delete</button>
            <button onClick={() => setNoteEditor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Submit Modal */}
      <SubmitModal
        isOpen={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        onSubmit={addRecord}
        dailyInstalled={completedBoxes.size}
        totalCompleted={completedBoxes.size}
        totalBoxes={inverterLabels.length}
      />

      {/* History Modal */}
      <HistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        dailyLog={dailyLog}
        onDeleteRecord={deleteRecord}
      />

      {/* Hidden canvas for chart export */}
      <canvas id="dailyChart" style={{ display: 'none' }} width="800" height="400" />
    </div>
  )
}

export default App
