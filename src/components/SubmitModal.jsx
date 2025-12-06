import { useState } from 'react'

/**
 * Submit Modal Component
 * Allows users to submit daily work records
 */
export default function SubmitModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  dailyInstalled,
  totalCompleted,
  totalBoxes
}) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [subcontractor, setSubcontractor] = useState('')
  const [workers, setWorkers] = useState('')
  const [customPanels, setCustomPanels] = useState('')
  const [useCustomPanels, setUseCustomPanels] = useState(false)

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    
    const record = {
      date,
      installed_panels: useCustomPanels ? parseInt(customPanels) || 0 : dailyInstalled,
      subcontractor: subcontractor.trim(),
      workers: parseInt(workers) || 0
    }

    onSubmit(record)
    
    // Reset form
    setSubcontractor('')
    setWorkers('')
    setCustomPanels('')
    setUseCustomPanels(false)
    onClose()
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div 
      className="modal-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
      }}
    >
      <div 
        className="modal-content"
        style={{
          background: 'linear-gradient(180deg, #1f2937, #111827)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 24,
          minWidth: 380,
          maxWidth: 450,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        <h2 style={{ 
          color: '#f8fafc', 
          marginBottom: 20, 
          fontSize: 20,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          📋 Submit Daily Work
        </h2>

        {/* Stats Display */}
        <div style={{
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 20
        }}>
          <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
            Today's Progress
          </div>
          <div style={{ 
            color: '#22c55e', 
            fontSize: 28, 
            fontWeight: 700,
            display: 'flex',
            alignItems: 'baseline',
            gap: 8
          }}>
            {dailyInstalled}
            <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 400 }}>
              boxes completed
            </span>
          </div>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
            Total: {totalCompleted} / {totalBoxes}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Date */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              display: 'block', 
              color: '#9ca3af', 
              fontSize: 13, 
              marginBottom: 6 
            }}>
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#f8fafc',
                fontSize: 14
              }}
            />
          </div>

          {/* Subcontractor */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              display: 'block', 
              color: '#9ca3af', 
              fontSize: 13, 
              marginBottom: 6 
            }}>
              Subcontractor
            </label>
            <input
              type="text"
              value={subcontractor}
              onChange={(e) => setSubcontractor(e.target.value)}
              placeholder="Enter subcontractor name"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#f8fafc',
                fontSize: 14
              }}
            />
          </div>

          {/* Workers */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              display: 'block', 
              color: '#9ca3af', 
              fontSize: 13, 
              marginBottom: 6 
            }}>
              Number of Workers
            </label>
            <input
              type="number"
              value={workers}
              onChange={(e) => setWorkers(e.target.value)}
              placeholder="Enter worker count"
              min="0"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#f8fafc',
                fontSize: 14
              }}
            />
          </div>

          {/* Custom Panels Toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8,
              color: '#9ca3af', 
              fontSize: 13,
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={useCustomPanels}
                onChange={(e) => setUseCustomPanels(e.target.checked)}
                style={{ accentColor: '#22c55e' }}
              />
              Override panel count manually
            </label>
            
            {useCustomPanels && (
              <input
                type="number"
                value={customPanels}
                onChange={(e) => setCustomPanels(e.target.value)}
                placeholder="Enter custom panel count"
                min="0"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  marginTop: 8,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 8,
                  color: '#f8fafc',
                  fontSize: 14
                }}
              />
            )}
          </div>

          {/* Buttons */}
          <div style={{ 
            display: 'flex', 
            gap: 10, 
            marginTop: 24 
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px 20px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#e5e7eb',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                border: 'none',
                borderRadius: 8,
                color: '#0b1220',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
