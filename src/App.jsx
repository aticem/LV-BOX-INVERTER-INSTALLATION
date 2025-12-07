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
  
  // Mode switching: 'test' = LV Cable Test Results, 'termination' = LV Cable Termination Progress
  const [activeMode, setActiveMode] = useState('test')
  
  // Termination tracking state - load from localStorage
  const [terminationProgress, setTerminationProgress] = useState(() => {
    try {
      const saved = localStorage.getItem('terminationProgress')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [selectedInverter, setSelectedInverter] = useState(null) // For editing termination progress
  const [editingTerminated, setEditingTerminated] = useState('')
  const [notes, setNotes] = useState([])
  const [selectedNote, setSelectedNote] = useState(null)
  const [noteEditor, setNoteEditor] = useState(null)
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  
  // Pan state
  const isPanning = useRef(false)
  const hasMoved = useRef(false) // Track if actual movement occurred
  const lastMouse = useRef({ x: 0, y: 0 })
  const selectionBoxRef = useRef(null) // Use ref for selection box during drag
  const rafId = useRef(null) // For requestAnimationFrame

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

  // Extract inverter IDs and circuit counts from table_id layer using regex
  const inverterCircuitData = useMemo(() => {
    const circuitCounts = {} // { inverterId: count }
    const inverterPositions = {} // { inverterId: { position, text } }
    
    // Process table_id to count circuits per inverter
    if (layers.table_id && layers.table_id.features) {
      layers.table_id.features.forEach(feature => {
        const text = feature.properties?.text
        if (text) {
          // Extract inverter ID using regex: TX[0-9]+-INV[0-9]+
          const match = text.match(/^(TX\d+-INV\d+)/i)
          if (match) {
            const inverterId = match[1].toUpperCase()
            circuitCounts[inverterId] = (circuitCounts[inverterId] || 0) + 1
          }
        }
      })
    }
    
    // Get positions from inv_id layer
    if (layers.inv_id && layers.inv_id.features) {
      layers.inv_id.features.forEach(feature => {
        const text = feature.properties?.text
        if (text && feature.geometry.type === 'Point') {
          // Normalize the inverter ID
          const match = text.match(/^(TX\d+-INV\s*\d+)/i)
          if (match) {
            const normalizedId = match[1].replace(/\s+/g, '').toUpperCase()
            inverterPositions[normalizedId] = {
              position: feature.geometry.coordinates,
              text: text
            }
          }
        }
      })
    }
    
    return { circuitCounts, inverterPositions }
  }, [layers])

  // Calculate termination summary stats
  const terminationStats = useMemo(() => {
    const { circuitCounts } = inverterCircuitData
    const inverterIds = Object.keys(circuitCounts)
    
    let totalCircuits = 0
    let terminated = 0
    
    inverterIds.forEach(inverterId => {
      const total = circuitCounts[inverterId] || 0
      const done = terminationProgress[inverterId] || 0
      totalCircuits += total
      terminated += Math.min(done, total) // Cap at total
    })
    
    const remaining = totalCircuits - terminated
    const percentage = totalCircuits > 0 ? Math.round((terminated / totalCircuits) * 100) : 0
    
    return { totalCircuits, terminated, remaining, percentage, inverterCount: inverterIds.length }
  }, [inverterCircuitData, terminationProgress])

  // Save termination progress to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('terminationProgress', JSON.stringify(terminationProgress))
    } catch (e) {
      console.warn('Failed to save termination progress:', e)
    }
  }, [terminationProgress])

  // Load GeoJSON data
  useEffect(() => {
    const files = ['inv_id', 'table_id', 'poly', 'boudnry_line']
    
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
      let tempInverterLabels = []

      results.forEach(({ name, data }) => {
        if (data && data.features) {
          layerData[name] = data
          
          data.features.forEach(f => {
            const coords = extractCoords(f.geometry)
            allCoords = allCoords.concat(coords)
          })
        }
      })

      // Process inv_id layer for clickable inverter points
      if (layerData['inv_id']) {
        layerData['inv_id'].features.forEach((f, index) => {
          if (f.geometry.type === 'Point' && f.properties?.text) {
            const coords = f.geometry.coordinates
            const boxId = f.properties.text // Use the text property as boxId
            tempInverterLabels.push({
              position: [coords[0], coords[1]],
              text: f.properties.text,
              boxId
            })
          }
        })
      }

      setLayers(layerData)
      setInverterLabels(tempInverterLabels)
      // Set total box count from inv_id features
      setTotalBoxCount(layerData['inv_id']?.features?.length || 0)
      
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
    
    // Draw Poly Layer (background - display only)
    if (layers.poly && layers.poly.features) {
      ctx.strokeStyle = '#1a1a1a' // Black stroke
      ctx.lineWidth = 1
      ctx.fillStyle = 'rgba(30, 30, 30, 0.15)' // Dark fill
      
      layers.poly.features.forEach(feature => {
        drawGeometry(ctx, feature.geometry, true)
      })
    }

    // Draw Boundary Line (display only)
    if (layers.boudnry_line && layers.boudnry_line.features) {
      ctx.strokeStyle = '#0066cc' // Blue stroke for boundary
      ctx.lineWidth = 2
      
      layers.boudnry_line.features.forEach(feature => {
        drawGeometry(ctx, feature.geometry, false)
      })
    }
    
    // Draw Inverter clickable points from inv_id
    if (inverterLabels.length > 0) {
      // Font size scales with zoom
      const baseFontSize = 0.00003 // World units
      const fontSize = Math.max(8, Math.min(14, baseFontSize * viewState.scale))
      const pointRadius = Math.max(8, Math.min(16, 10 * zoomRatio))
      
      ctx.font = `bold ${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 2
      
      if (activeMode === 'test') {
        // Test mode: draw inverter points with completed/not completed status
        inverterLabels.forEach(label => {
          const { x, y } = worldToScreen(label.position[0], label.position[1])
          const isCompleted = completedBoxes.has(label.boxId)
          
          // Draw clickable point circle
          ctx.beginPath()
          ctx.arc(x, y, pointRadius, 0, 2 * Math.PI)
          ctx.fillStyle = isCompleted ? 'rgba(34, 197, 94, 0.7)' : 'rgba(230, 126, 34, 0.6)'
          ctx.strokeStyle = isCompleted ? '#22c55e' : '#e67e22'
          ctx.lineWidth = isCompleted ? 3 : 2
          ctx.fill()
          ctx.stroke()
          
          // Draw label text on the point if zoomed in enough
          if (showDetailedText) {
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = isCompleted ? '#166534' : '#9a3412'
            ctx.lineWidth = 2
            ctx.strokeText(label.text, x, y)
            ctx.fillText(label.text, x, y)
          }
        })
      } else {
        // Termination mode: draw inverters with progress (terminated/total)
        const { circuitCounts, inverterPositions } = inverterCircuitData
        
        Object.keys(circuitCounts).forEach(inverterId => {
          const posData = inverterPositions[inverterId]
          if (!posData) return
          
          const { x, y } = worldToScreen(posData.position[0], posData.position[1])
          const total = circuitCounts[inverterId]
          const terminated = terminationProgress[inverterId] || 0
          const isCompleted = terminated >= total
          const hasProgress = terminated > 0
          
          // Draw larger clickable rectangle for termination mode
          const boxWidth = Math.max(40, Math.min(80, 50 * zoomRatio))
          const boxHeight = Math.max(25, Math.min(45, 30 * zoomRatio))
          
          ctx.beginPath()
          ctx.roundRect(x - boxWidth/2, y - boxHeight/2, boxWidth, boxHeight, 6)
          
          if (isCompleted) {
            ctx.fillStyle = 'rgba(34, 197, 94, 0.8)'
            ctx.strokeStyle = '#22c55e'
          } else if (hasProgress) {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.7)'
            ctx.strokeStyle = '#f59e0b'
          } else {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.6)'
            ctx.strokeStyle = '#ef4444'
          }
          ctx.lineWidth = isCompleted ? 3 : 2
          ctx.fill()
          ctx.stroke()
          
          // Draw progress text
          if (showDetailedText || zoomRatio > 0.3) {
            const progressText = `${terminated}/${total}`
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = isCompleted ? '#166534' : (hasProgress ? '#92400e' : '#991b1b')
            ctx.lineWidth = 2
            ctx.strokeText(progressText, x, y)
            ctx.fillText(progressText, x, y)
            
            // Draw inverter label above the box
            if (showDetailedText) {
              const labelY = y - boxHeight/2 - 8
              ctx.font = `bold ${Math.max(6, fontSize - 2)}px Arial`
              ctx.strokeText(inverterId, x, labelY)
              ctx.fillText(inverterId, x, labelY)
            }
          }
        })
      }
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
    
    // Draw Text Labels - ONLY ON HOVER (from table_id layer)
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
    
  }, [layers, bounds, viewState, inverterLabels, worldToScreen, hoveredText, completedBoxes, notes, selectionBox, activeMode, inverterCircuitData, terminationProgress])

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

  // Undo/Redo functions
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
  }, [undo, redo])

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

  // Save state changes to history for undo/redo
  useEffect(() => {
    const newState = {
      completedBoxes: Array.from(completedBoxes),
      notes: notes.map(n => ({ ...n }))
    }
    
    // Don't save if it's the same as current history state
    if (historyIndex >= 0 && history[historyIndex]) {
      const current = history[historyIndex]
      const sameBoxes = newState.completedBoxes.length === current.completedBoxes.length &&
        newState.completedBoxes.every(id => current.completedBoxes.includes(id))
      const sameNotes = newState.notes.length === current.notes.length
      if (sameBoxes && sameNotes) return
    }
    
    // Remove any future history if we're in the middle
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(newState)
    
    // Keep only last 50 states
    if (newHistory.length > 50) newHistory.shift()
    
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }, [completedBoxes, notes])

  // Re-render when state changes - use RAF for smooth animation
  useEffect(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(render)
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [render, notes, completedBoxes, viewState])

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
      
      const box = { startX: x, startY: y, endX: x, endY: y, action: 'remove' }
      selectionBoxRef.current = box
      setSelectionBox(box)
      return
    }

    // Left Mouse Button (0) -> Selection Box for Select (if not in note mode)
    if (e.button === 0 && !noteMode) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      const box = { startX: x, startY: y, endX: x, endY: y, action: 'add' }
      selectionBoxRef.current = box
      setSelectionBox(box)
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
    } else if (activeMode === 'test') {
      // Test mode: Check if clicked on an inverter point from inv_id layer
      for (const label of inverterLabels) {
        const { x, y } = worldToScreen(label.position[0], label.position[1])
        const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2))
        if (dist < 30) { // Click radius
          setCompletedBoxes(prev => {
            const newSet = new Set(prev)
            if (newSet.has(label.boxId)) {
              newSet.delete(label.boxId)
            } else {
              newSet.add(label.boxId)
            }
            return newSet
          })
          break
        }
      }
    } else {
      // Termination mode: Check if clicked on an inverter box
      const { circuitCounts, inverterPositions } = inverterCircuitData
      const zoomRatio = viewState.scale / viewState.baseScale
      const boxWidth = Math.max(40, Math.min(80, 50 * zoomRatio))
      const boxHeight = Math.max(25, Math.min(45, 30 * zoomRatio))
      
      for (const inverterId of Object.keys(circuitCounts)) {
        const posData = inverterPositions[inverterId]
        if (!posData) continue
        
        const { x, y } = worldToScreen(posData.position[0], posData.position[1])
        
        // Check if click is within the box
        if (mouseX >= x - boxWidth/2 && mouseX <= x + boxWidth/2 &&
            mouseY >= y - boxHeight/2 && mouseY <= y + boxHeight/2) {
          // Open editor for this inverter
          const total = circuitCounts[inverterId]
          const currentTerminated = terminationProgress[inverterId] || 0
          setSelectedInverter({ id: inverterId, total, x: mouseX, y: mouseY })
          setEditingTerminated(String(currentTerminated))
          break
        }
      }
    }
  }, [noteMode, notes, worldToScreen, screenToWorld, inverterLabels, activeMode, inverterCircuitData, viewState, terminationProgress])

  const handleMouseMove = useCallback((e) => {
    // Handle Selection (Left Drag) - use ref for smooth updates
    if (selectionBoxRef.current) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      selectionBoxRef.current.endX = x
      selectionBoxRef.current.endY = y
      setSelectionBox({ ...selectionBoxRef.current })
      
      // Mark as moved if box has size
      if (Math.abs(x - selectionBoxRef.current.startX) > 5 || Math.abs(y - selectionBoxRef.current.startY) > 5) {
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

    // Handle Hover for Table IDs (from table_id layer)
    if (layers.table_id && layers.table_id.features && bounds) {
      const canvas = canvasRef.current
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      // Find closest text feature
      let closest = null
      let minDist = 20 // Detection radius in pixels

      for (const feature of layers.table_id.features) {
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
    if (selectionBoxRef.current) {
      // Finalize selection only if we actually dragged (hasMoved is true)
      if (hasMoved.current) {
        const { startX, startY, endX, endY, action } = selectionBoxRef.current
        const minX = Math.min(startX, endX)
        const maxX = Math.max(startX, endX)
        const minY = Math.min(startY, endY)
        const maxY = Math.max(startY, endY)
        
        const selectedIds = []
        
        // Use inverter labels for selection (from inv_id layer)
        inverterLabels.forEach(label => {
          const { x, y } = worldToScreen(label.position[0], label.position[1])
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
      
      selectionBoxRef.current = null
      setSelectionBox(null)
    }
    isPanning.current = false
  }, [inverterLabels, worldToScreen])

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
        {/* Mode Switch Buttons */}
        <div className="mode-switcher">
          <button 
            className={`mode-btn ${activeMode === 'test' ? 'active' : ''}`}
            onClick={() => setActiveMode('test')}
          >
            🔌 LV Cable Test
          </button>
          <button 
            className={`mode-btn ${activeMode === 'termination' ? 'active' : ''}`}
            onClick={() => setActiveMode('termination')}
          >
            🔗 Cable Termination
          </button>
        </div>

        {/* Counters - different for each mode */}
        <div className="counters">
          {activeMode === 'test' ? (
            <>
              <div className="counter-row">
                <span className="counter-label">Total Inverters: {inverterLabels.length}</span>
                <span className="counter-item completed">Done <strong>{completedBoxes.size}</strong></span>
                <span className="counter-item remaining">Remain <strong>{inverterLabels.length - completedBoxes.size}</strong></span>
              </div>
            </>
          ) : (
            <>
              <div className="counter-row">
                <span className="counter-label">Total Circuits: {terminationStats.totalCircuits}</span>
                <span className="counter-item completed">Terminated <strong>{terminationStats.terminated}</strong></span>
                <span className="counter-item remaining">Remain <strong>{terminationStats.remaining}</strong></span>
                <span className="counter-item" style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}>
                  <strong>{terminationStats.percentage}%</strong>
                </span>
              </div>
            </>
          )}
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

      {/* Legend - changes based on active mode */}
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
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: '#fff' }}>
          {activeMode === 'test' ? 'Test Results' : 'Termination Progress'}
        </div>
        {activeMode === 'test' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'rgba(34, 197, 94, 0.5)',
                border: '2px solid #22c55e',
                marginRight: 10
              }}></div>
              <span>Test Passed</span>
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
              <span>Not Tested</span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'rgba(34, 197, 94, 0.7)',
                border: '2px solid #22c55e',
                marginRight: 10
              }}></div>
              <span>100% Complete</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'rgba(251, 191, 36, 0.6)',
                border: '2px solid #f59e0b',
                marginRight: 10
              }}></div>
              <span>In Progress</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.5)',
                border: '2px solid #ef4444',
                marginRight: 10
              }}></div>
              <span>Not Started</span>
            </div>
          </>
        )}
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

      {/* Termination Progress Editor Popup */}
      {selectedInverter && (
        <div 
          className="termination-editor"
          style={{
            position: 'absolute',
            left: selectedInverter.x,
            top: selectedInverter.y - 10,
            transform: 'translate(-50%, -100%)',
            background: '#0f172a',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            padding: '16px',
            color: '#e5e7eb',
            minWidth: 220,
            zIndex: 1100,
            fontFamily: 'Arial, sans-serif'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#fff', textAlign: 'center' }}>
            {selectedInverter.id}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
            <input
              type="number"
              min="0"
              max={selectedInverter.total}
              value={editingTerminated}
              onChange={(e) => setEditingTerminated(e.target.value)}
              autoFocus
              style={{
                width: 60,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                fontSize: 16,
                fontWeight: 700,
                textAlign: 'center'
              }}
            />
            <span style={{ fontSize: 18, fontWeight: 700, color: '#9ca3af' }}>/</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{selectedInverter.total}</span>
          </div>
          <div style={{ 
            background: 'rgba(255,255,255,0.1)', 
            borderRadius: 6, 
            height: 8, 
            marginBottom: 12,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${Math.min(100, (parseInt(editingTerminated) || 0) / selectedInverter.total * 100)}%`,
              height: '100%',
              background: parseInt(editingTerminated) >= selectedInverter.total 
                ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                : 'linear-gradient(90deg, #f59e0b, #d97706)',
              transition: 'width 0.2s'
            }}></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              onClick={() => {
                const value = Math.max(0, Math.min(selectedInverter.total, parseInt(editingTerminated) || 0))
                setTerminationProgress(prev => ({ ...prev, [selectedInverter.id]: value }))
                setSelectedInverter(null)
              }}
              style={{
                flex: 1,
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Save
            </button>
            <button 
              onClick={() => setSelectedInverter(null)}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.15)',
                color: '#e5e7eb',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
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
