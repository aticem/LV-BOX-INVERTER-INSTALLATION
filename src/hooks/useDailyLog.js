import { useState, useEffect } from 'react'

/**
 * Custom hook for managing daily work log in LocalStorage
 * Handles persistence of daily installation records
 */
export default function useDailyLog() {
  const [dailyLog, setDailyLog] = useState([])

  // Load from LocalStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('dailyLog')
    if (stored) {
      try {
        setDailyLog(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to parse dailyLog from localStorage:', e)
        setDailyLog([])
      }
    }
  }, [])

  // Add a new record to the log
  const addRecord = (record) => {
    const newRecord = {
      ...record,
      id: Date.now(),
      timestamp: new Date().toISOString()
    }
    const updated = [...dailyLog, newRecord]
    setDailyLog(updated)
    localStorage.setItem('dailyLog', JSON.stringify(updated))
    return newRecord
  }

  // Update an existing record
  const updateRecord = (id, updates) => {
    const updated = dailyLog.map(record => 
      record.id === id ? { ...record, ...updates } : record
    )
    setDailyLog(updated)
    localStorage.setItem('dailyLog', JSON.stringify(updated))
  }

  // Delete a record
  const deleteRecord = (id) => {
    const updated = dailyLog.filter(record => record.id !== id)
    setDailyLog(updated)
    localStorage.setItem('dailyLog', JSON.stringify(updated))
  }

  // Reset entire log
  const resetLog = () => {
    localStorage.removeItem('dailyLog')
    setDailyLog([])
  }

  // Get aggregated data by date
  const getAggregatedByDate = () => {
    const grouped = {}
    
    dailyLog.forEach(record => {
      const date = record.date
      if (!grouped[date]) {
        grouped[date] = {
          date,
          installed_panels: 0,
          workers: 0,
          subcontractors: new Set()
        }
      }
      grouped[date].installed_panels += record.installed_panels || 0
      grouped[date].workers += record.workers || 0
      if (record.subcontractor) {
        grouped[date].subcontractors.add(record.subcontractor)
      }
    })

    // Convert to array and sort by date
    return Object.values(grouped)
      .map(g => ({
        ...g,
        subcontractor: Array.from(g.subcontractors).join(', '),
        subcontractors: undefined
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }

  return {
    dailyLog,
    addRecord,
    updateRecord,
    deleteRecord,
    resetLog,
    getAggregatedByDate
  }
}
