import { useCallback } from 'react'
import Chart from 'chart.js/auto'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import ExcelJS from 'exceljs'

// Register the datalabels plugin
Chart.register(ChartDataLabels)

/**
 * Custom hook for exporting daily log data to Excel with chart
 */
export default function useChartExport() {
  
  const exportToExcel = useCallback(async (dailyLog, projectName = 'LV-INV Installation') => {
    if (!dailyLog || dailyLog.length === 0) {
      alert('No data to export!')
      return
    }

    // 1. Aggregate data by date
    const aggregated = aggregateByDate(dailyLog)
    
    // 2. Sort by date
    aggregated.sort((a, b) => new Date(a.date) - new Date(b.date))

    // 3. Create chart and get PNG
    const chartPng = await createChartPng(aggregated)

    // 4. Create Excel workbook
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'LV-INV Installation Tracker'
    workbook.created = new Date()

    // Sheet 1: Raw Data
    const dataSheet = workbook.addWorksheet('Daily Log')
    
    // Header styling
    dataSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Installed Panels', key: 'installed_panels', width: 18 },
      { header: 'Workers', key: 'workers', width: 12 },
      { header: 'Subcontractor', key: 'subcontractor', width: 20 },
      { header: 'Cumulative', key: 'cumulative', width: 15 }
    ]

    // Style header row
    dataSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    dataSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' }
    }
    dataSheet.getRow(1).alignment = { horizontal: 'center' }

    // Add data with cumulative calculation
    let cumulative = 0
    aggregated.forEach(row => {
      cumulative += row.installed_panels
      dataSheet.addRow({
        date: row.date,
        installed_panels: row.installed_panels,
        workers: row.workers,
        subcontractor: row.subcontractor,
        cumulative: cumulative
      })
    })

    // Add totals row
    const totalRow = dataSheet.addRow({
      date: 'TOTAL',
      installed_panels: aggregated.reduce((sum, r) => sum + r.installed_panels, 0),
      workers: Math.round(aggregated.reduce((sum, r) => sum + r.workers, 0) / aggregated.length),
      subcontractor: '',
      cumulative: cumulative
    })
    totalRow.font = { bold: true }
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE5E7EB' }
    }

    // Sheet 2: Chart
    const chartSheet = workbook.addWorksheet('Progress Chart')
    
    if (chartPng) {
      const imageId = workbook.addImage({
        base64: chartPng.split(',')[1],
        extension: 'png'
      })
      
      chartSheet.addImage(imageId, {
        tl: { col: 0.5, row: 1 },
        ext: { width: 800, height: 400 }
      })
    }

    // Add title to chart sheet
    chartSheet.getCell('A1').value = `${projectName} - Daily Installation Progress`
    chartSheet.getCell('A1').font = { bold: true, size: 14 }

    // 5. Download file
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    })
    
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${projectName.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

  }, [])

  return { exportToExcel }
}

/**
 * Aggregate daily log records by date
 */
function aggregateByDate(dailyLog) {
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

  return Object.values(grouped).map(g => ({
    date: g.date,
    installed_panels: g.installed_panels,
    workers: g.workers,
    subcontractor: Array.from(g.subcontractors).join(', ')
  }))
}

/**
 * Create chart on hidden canvas and return as PNG base64
 */
async function createChartPng(data) {
  // Create hidden canvas
  let canvas = document.getElementById('dailyChart')
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.id = 'dailyChart'
    canvas.style.display = 'none'
    canvas.width = 800
    canvas.height = 400
    document.body.appendChild(canvas)
  }

  const ctx = canvas.getContext('2d')
  
  // Destroy existing chart if any
  const existingChart = Chart.getChart(canvas)
  if (existingChart) {
    existingChart.destroy()
  }

  // Prepare data
  const labels = data.map(d => formatDate(d.date))
  const panelData = data.map(d => d.installed_panels)
  const workerData = data.map(d => d.workers)
  const subData = data.map(d => d.subcontractor ? d.subcontractor.slice(0, 3).toUpperCase() : '')

  // Create chart
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Installed Panels',
          data: panelData,
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderColor: 'rgb(22, 163, 74)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Workers',
          data: workerData,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderColor: 'rgb(37, 99, 235)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: 'Daily Installation Progress',
          font: { size: 16, weight: 'bold' }
        },
        legend: {
          position: 'top'
        },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'top',
          formatter: (value, context) => {
            const idx = context.dataIndex
            if (context.datasetIndex === 0) {
              // Show workers count and subcontractor abbreviation on panel bars
              return `${workerData[idx]}\n${subData[idx]}`
            }
            return ''
          },
          font: {
            size: 10,
            weight: 'bold'
          },
          color: '#374151'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Count'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  })

  // Wait for chart to render
  await new Promise(resolve => setTimeout(resolve, 100))

  // Get PNG
  const png = canvas.toDataURL('image/png')

  // Cleanup
  chart.destroy()

  return png
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
