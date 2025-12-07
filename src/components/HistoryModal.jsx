import { useState } from 'react'

/**
 * History Modal Component
 * Shows submission history from daily log
 */
export default function HistoryModal({ 
  isOpen, 
  onClose, 
  dailyLog,
  onDeleteRecord 
}) {
  const [sortBy, setSortBy] = useState('date')
  const [sortOrder, setSortOrder] = useState('desc')

  if (!isOpen) return null

  // Sort records
  const sortedLog = [...dailyLog].sort((a, b) => {
    let comparison = 0
    if (sortBy === 'date') {
      comparison = new Date(a.date) - new Date(b.date)
    } else if (sortBy === 'box installation') {
      comparison = a.installed_panels - b.installed_panels
    } else if (sortBy === 'workers') {
      comparison = a.workers - b.workers
    }
    return sortOrder === 'desc' ? -comparison : comparison
  })

  // Calculate totals
  const totals = dailyLog.reduce((acc, record) => ({
    panels: acc.panels + (record.installed_panels || 0),
    workers: acc.workers + (record.workers || 0)
  }), { panels: 0, workers: 0 })

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
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
          minWidth: 500,
          maxWidth: 700,
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 20
        }}>
          <h2 style={{ 
            color: '#f8fafc', 
            fontSize: 20,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            🗒️ Submission History
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: 24,
              cursor: 'pointer',
              padding: 4
            }}
          >
            ×
          </button>
        </div>

        {/* Summary Cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: 12,
          marginBottom: 20
        }}>
          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: 10,
            padding: 12,
            textAlign: 'center'
          }}>
            <div style={{ color: '#9ca3af', fontSize: 11 }}>Total Installed</div>
            <div style={{ color: '#22c55e', fontSize: 24, fontWeight: 700 }}>
              {totals.panels}
            </div>
          </div>
          <div style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 10,
            padding: 12,
            textAlign: 'center'
          }}>
            <div style={{ color: '#9ca3af', fontSize: 11 }}>Total Workers</div>
            <div style={{ color: '#3b82f6', fontSize: 24, fontWeight: 700 }}>
              {totals.workers}
            </div>
          </div>
          <div style={{
            background: 'rgba(168, 85, 247, 0.1)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            borderRadius: 10,
            padding: 12,
            textAlign: 'center'
          }}>
            <div style={{ color: '#9ca3af', fontSize: 11 }}>Records</div>
            <div style={{ color: '#a855f7', fontSize: 24, fontWeight: 700 }}>
              {dailyLog.length}
            </div>
          </div>
        </div>

        {/* Sort Controls */}
        <div style={{ 
          display: 'flex', 
          gap: 10, 
          marginBottom: 12,
          fontSize: 12
        }}>
          <span style={{ color: '#9ca3af' }}>Sort by:</span>
          {['date', 'box installation', 'workers'].map(field => (
            <button
              key={field}
              onClick={() => {
                if (sortBy === field) {
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                } else {
                  setSortBy(field)
                  setSortOrder('desc')
                }
              }}
              style={{
                background: sortBy === field ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                border: '1px solid',
                borderColor: sortBy === field ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255,255,255,0.1)',
                borderRadius: 4,
                padding: '4px 8px',
                color: sortBy === field ? '#3b82f6' : '#9ca3af',
                cursor: 'pointer',
                fontSize: 11
              }}
            >
              {field.charAt(0).toUpperCase() + field.slice(1)}
              {sortBy === field && (sortOrder === 'asc' ? ' ↑' : ' ↓')}
            </button>
          ))}
        </div>

        {/* Records List */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          {sortedLog.length === 0 ? (
            <div style={{ 
              padding: 40, 
              textAlign: 'center', 
              color: '#6b7280' 
            }}>
              No records yet. Submit your first daily work!
            </div>
          ) : (
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse',
              fontSize: 13
            }}>
              <thead>
                <tr style={{ 
                  background: 'rgba(255,255,255,0.05)',
                  position: 'sticky',
                  top: 0
                }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#9ca3af', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#9ca3af', fontWeight: 500 }}>Boxes</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#9ca3af', fontWeight: 500 }}>Workers</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#9ca3af', fontWeight: 500 }}>Subcontractor</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#9ca3af', fontWeight: 500 }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedLog.map((record, index) => (
                  <tr 
                    key={record.id || index}
                    style={{ 
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'
                    }}
                  >
                    <td style={{ padding: '10px 12px', color: '#e5e7eb' }}>
                      {formatDate(record.date)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#22c55e', fontWeight: 600 }}>
                      {record.installed_panels}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#3b82f6', fontWeight: 600 }}>
                      {record.workers}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#9ca3af' }}>
                      {record.subcontractor || '-'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {onDeleteRecord && (
                        <button
                          onClick={() => onDeleteRecord(record.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            opacity: 0.6,
                            fontSize: 14
                          }}
                          title="Delete record"
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            marginTop: 16,
            padding: '12px 20px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            color: '#e5e7eb',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}
