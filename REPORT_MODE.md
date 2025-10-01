# Report Mode & Log Monitor Implementation Guide

A comprehensive user feedback and log monitoring system that allows users to report bugs, suggestions, issues, and general feedback by clicking on any HTML element on the page, plus a floating log monitor window for real-time log management. Both systems integrate with the same logsink server infrastructure.

## Rules
- Its not required to implement the same icons, visual styles, layouting. The implementation should fit to the embedding application.
- Keep the API calls and their parameters as they are.

## Variables
- **APPLICATION_ID**: the name of the application including environment, e.g. my-app-dev
- **LOG_ENDPOINT**: the URL of the logsink server, e.g. https://logsink.drydev.de/log
- **LOG_API_KEY**: the API key for the logsink server, e.g. my-super-secret-key
- **NODE_ENV**: set to 'development' to enable component path tracking via `data-component-path` attributes

## Features

### Report Mode
- **Keyboard Activation**: `Ctrl+Alt` to toggle report mode on/off
- **Element Highlighting**: Blue border highlights elements on hover
- **Click Suppression**: All default mouse clicks are suppressed during report mode
- **Modal Dialog**: Report submission with type selection cards
- **Screenshot Support**: Drag & drop, paste (Ctrl+V), or file upload for images
- **Image Compression**: Automatic JPEG compression (40% quality) to reduce file size
- **Element Metadata**: Captures detailed information about clicked elements
- **Component Path Tracking**: In dev mode, captures `data-component-path` attribute for precise component identification
- **Logsink Integration**: Sends reports to external logging server with full component path
- **Visual Indicators**: Shows when report mode is active
- **Auto-deactivation**: Report mode ends when dialog opens

### Log Monitor Window
- **Floating Window**: Resizable, minimizable floating window for log management
- **Real-time Updates**: Polls logsink server every 10 seconds for new logs
- **Enhanced State Management**: Handles open, in_progress, done, and revert log states
- **Issue Management Fields**: Supports type (bugfix/feature/documentation), effort levels, implementation plans, and LLM analysis
- **Interactive Actions**: Complete workflow management with state transitions
  - **Open**: Delete
  - **In-Progress**: Mark done, revert to open, delete
  - **Done**: Accept (close), revert with reason, delete
  - **Revert**: Delete
- **Expandable Content**: Click to expand/collapse with scrollable sections for messages, plans, LLM analysis, and revert reasons
- **Auto-collapse**: Automatically minimizes when no logs are present
- **Visual Indicators**: Color-coded states and badges for log counts with proper button layout
- **Statistics Display**: Shows duration, time to resolve, cost, tokens, lines changed, and git commit links

## Dependencies

```bash
# Required UI components (shadcn/ui or similar)
npm install lucide-react

# Required peer dependencies
npm install react react-dom
```

## Required UI Components

This implementation assumes you have these shadcn/ui components available:
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`
- `Button`
- `Textarea`
- `Card`, `CardContent`
- `Badge`

## File Structure

```
src/
├── components/
│   ├── report-mode/
│   │   ├── index.ts
│   │   ├── report-mode-provider.tsx
│   │   └── report-dialog.tsx
│   ├── providers/
│   │   └── log-monitor-provider.tsx
│   └── ui/
│       └── floating-log-window.tsx
└── lib/
    ├── logger.ts
    └── console-override.ts (optional)
```

## Implementation

### 1. Logger Service (`src/lib/logger.ts`)

```typescript
/**
 * Simple HTTP logger - sends logs to external endpoint
 */

const LOG_ENDPOINT = process.env.NEXT_PUBLIC_LOG_ENDPOINT || '<LOG_ENDPOINT>';
const API_KEY = process.env.NEXT_PUBLIC_LOG_API_KEY || '<LOG_API_KEY>';

async function sendLog(message: string, context: any = {}) {
  try {
    await fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({
        applicationId: 'your-app-id', // Change this to your app identifier
        message,
        context: {
          timestamp: new Date().toISOString(),
          url: typeof window !== 'undefined' ? window.location.href : 'server',
          userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'server',
          ...context
        }
      })
    });
  } catch (error) {
    // Fail silently to avoid logging loops
    console.error('Failed to send log:', error);
  }
}

export { sendLog };
```

### 2. Report Dialog Component (`src/components/report-mode/report-dialog.tsx`)

```typescript
"use client"

import React, { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bug, Lightbulb, AlertTriangle, MessageSquare, Send, Loader2, Upload, Image, X } from 'lucide-react'
import { sendLog } from '@/lib/logger'

interface ReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetElement: HTMLElement | null
}

type ReportType = 'bug' | 'suggestion' | 'issue' | 'feedback'

const reportTypes = [
  {
    id: 'bug' as ReportType,
    title: 'Bug Report',
    description: 'Report a problem or error',
    icon: Bug,
    color: 'bg-red-50 border-red-200 text-red-700',
    iconColor: 'text-red-500'
  },
  {
    id: 'suggestion' as ReportType,
    title: 'Suggestion',
    description: 'Suggest an improvement',
    icon: Lightbulb,
    color: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    iconColor: 'text-yellow-500'
  },
  {
    id: 'issue' as ReportType,
    title: 'Issue',
    description: 'Report a general issue',
    icon: AlertTriangle,
    color: 'bg-orange-50 border-orange-200 text-orange-700',
    iconColor: 'text-orange-500'
  },
  {
    id: 'feedback' as ReportType,
    title: 'Feedback',
    description: 'General feedback or comment',
    icon: MessageSquare,
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    iconColor: 'text-blue-500'
  }
]

export function ReportDialog({ open, onOpenChange, targetElement }: ReportDialogProps) {
  const [selectedType, setSelectedType] = useState<ReportType>('bug')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadedImage, setUploadedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // Process and compress image files
  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      console.error('File is not an image')
      return
    }

    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      console.error('Could not get canvas context')
      return
    }

    img.onload = () => {
      // Set canvas dimensions (you can also resize here if needed)
      canvas.width = img.width
      canvas.height = img.height

      // Draw the image on canvas
      ctx.drawImage(img, 0, 0)

      // Convert to compressed JPEG with 40% quality
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.4)

      // Create a new file object with the compressed data
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now()
          })
          setUploadedImage(compressedFile)
        }
      }, 'image/jpeg', 0.4)

      // Set preview
      setImagePreview(compressedDataUrl)
    }

    img.onerror = () => {
      console.error('Failed to load image')
    }

    // Load the image
    const reader = new FileReader()
    reader.onload = (e) => {
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  // Handle clipboard paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!open) return

      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) {
            processImageFile(file)
          }
          break
        }
      }
    }

    if (open) {
      document.addEventListener('paste', handlePaste)
    }

    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [open])

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      processImageFile(files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      processImageFile(files[0])
    }
  }

  const removeImage = () => {
    setUploadedImage(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = async () => {
    if (!message.trim()) return

    setIsSubmitting(true)

    try {
      // Convert image to base64 if present
      let imageData: string | null = null
      if (uploadedImage) {
        const reader = new FileReader()
        imageData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string
            // Remove data URL prefix to get just the base64 data
            const base64Data = result.split(',')[1]
            resolve(base64Data)
          }
          reader.onerror = reject
          reader.readAsDataURL(uploadedImage)
        })
      }

      // Get element information
      const elementInfo = targetElement ? {
        tagName: targetElement.tagName,
        id: targetElement.id,
        className: targetElement.className,
        textContent: targetElement.textContent?.substring(0, 200),
        innerHTML: targetElement.innerHTML?.substring(0, 500),
        componentPath: targetElement.getAttribute('data-component-path') || null,
        attributes: Array.from(targetElement.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value
          return acc
        }, {} as Record<string, string>),
        boundingRect: {
          x: targetElement.getBoundingClientRect().x,
          y: targetElement.getBoundingClientRect().y,
          width: targetElement.getBoundingClientRect().width,
          height: targetElement.getBoundingClientRect().height
        },
        location: {
          href: window.location.href,
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash
        }
      } : null

      // Send report to logsink server
      await sendLog(`User report: ${selectedType}`, {
        reportType: selectedType,
        message: message.trim(),
        elementInfo,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        screenshot: imageData ? {
          data: imageData,
          filename: uploadedImage?.name || 'screenshot.png',
          size: uploadedImage?.size || 0,
          type: uploadedImage?.type || 'image/png'
        } : null
      })

      // Reset form
      setMessage('')
      setSelectedType('bug')
      removeImage()

      // Close dialog (report mode is already deactivated)
      onOpenChange(false)

    } catch (error) {
      console.error('Failed to submit report:', error)
      // You might want to show an error message to the user here
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto" 
        data-report-mode-ui
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Submit Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Report Type Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Report Type</h3>
            <div className="grid grid-cols-2 gap-3">
              {reportTypes.map((type) => {
                const Icon = type.icon
                return (
                  <Card
                    key={type.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedType === type.id 
                        ? 'ring-2 ring-primary ring-offset-2' 
                        : ''
                    }`}
                    onClick={() => setSelectedType(type.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${type.color}`}>
                          <Icon className={`h-4 w-4 ${type.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm">{type.title}</h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            {type.description}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <label htmlFor="message" className="text-sm font-medium">
              Message *
            </label>
            <Textarea
              id="message"
              placeholder="Describe the issue, suggestion, or feedback in detail..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Screenshot (Optional)
            </label>
            <p className="text-xs text-muted-foreground">
              Take a screenshot with your snipping tool, then paste it here with Ctrl+V or drag and drop. Images will be compressed to JPEG (40% quality) to reduce size.
            </p>
            {!uploadedImage ? (
              <div
                ref={dropZoneRef}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop an image here, paste with Ctrl+V, or click to browse
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <img
                    src={imagePreview}
                    alt="Screenshot preview"
                    className="max-w-full max-h-48 rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={removeImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Image className="h-4 w-4" />
                  <span>{uploadedImage?.name}</span>
                  <span>({Math.round((uploadedImage?.size || 0) / 1024)} KB)</span>
                </div>
              </div>
            )}
          </div>

          {/* Element Info */}
          {targetElement && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Selected Element</h3>
              <div className="p-3 bg-muted rounded-lg space-y-3">
                {/* Component Path (Dev Mode) */}
                {targetElement.getAttribute('data-component-path') && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Component Path:</p>
                    <p className="text-xs font-mono text-primary bg-background p-2 rounded border">
                      {targetElement.getAttribute('data-component-path')}
                    </p>
                  </div>
                )}

                {/* Element Tags and Identifiers */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{targetElement.tagName.toLowerCase()}</Badge>
                  {targetElement.id && (
                    <Badge variant="secondary">#{targetElement.id}</Badge>
                  )}
                  {targetElement.className && (
                    <Badge variant="outline" className="text-xs">
                      .{targetElement.className.split(' ').slice(0, 2).join(' .')}
                      {targetElement.className.split(' ').length > 2 && '...'}
                    </Badge>
                  )}
                </div>

                {/* Element Text Content */}
                {targetElement.textContent?.trim() && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Text Content:</p>
                    <p className="text-xs text-muted-foreground bg-background p-2 rounded border">
                      "{targetElement.textContent.trim().substring(0, 150)}"
                      {targetElement.textContent.trim().length > 150 && '...'}
                    </p>
                  </div>
                )}

                {/* Element Attributes */}
                {(() => {
                  const importantAttrs = ['type', 'role', 'aria-label', 'placeholder', 'title', 'href', 'src']
                  const attrs = Array.from(targetElement.attributes)
                    .filter(attr => importantAttrs.includes(attr.name) && attr.value)
                    .slice(0, 3)

                  if (attrs.length > 0) {
                    return (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Attributes:</p>
                        <div className="space-y-1">
                          {attrs.map(attr => (
                            <div key={attr.name} className="text-xs text-muted-foreground">
                              <span className="font-mono bg-background px-1 rounded">{attr.name}</span>
                              <span className="mx-1">=</span>
                              <span className="bg-background px-1 rounded">
                                "{attr.value.substring(0, 30)}{attr.value.length > 30 ? '...' : ''}"
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}

                {/* Element Position */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Position:</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    x: {Math.round(targetElement.getBoundingClientRect().x)},
                    y: {Math.round(targetElement.getBoundingClientRect().y)},
                    w: {Math.round(targetElement.getBoundingClientRect().width)},
                    h: {Math.round(targetElement.getBoundingClientRect().height)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!message.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit Report
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

### 3. Report Mode Provider (`src/components/report-mode/report-mode-provider.tsx`)

```typescript
"use client"

import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { ReportDialog } from './report-dialog'

interface ReportModeContextType {
  isReportMode: boolean
  activateReportMode: () => void
  deactivateReportMode: () => void
  highlightedElement: HTMLElement | null
  setHighlightedElement: (element: HTMLElement | null) => void
}

const ReportModeContext = createContext<ReportModeContextType | undefined>(undefined)

export function useReportMode() {
  const context = useContext(ReportModeContext)
  if (context === undefined) {
    throw new Error('useReportMode must be used within a ReportModeProvider')
  }
  return context
}

interface ReportModeProviderProps {
  children: React.ReactNode
}

export function ReportModeProvider({ children }: ReportModeProviderProps) {
  const [isReportMode, setIsReportMode] = useState(false)
  const [highlightedElement, setHighlightedElement] = useState<HTMLElement | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [clickedElement, setClickedElement] = useState<HTMLElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  const activateReportMode = () => {
    setIsReportMode(true)
    document.body.style.cursor = 'crosshair'
  }

  const deactivateReportMode = () => {
    setIsReportMode(false)
    setHighlightedElement(null)
    document.body.style.cursor = ''
  }

  // Handle CTRL+ALT keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && !event.repeat) {
        event.preventDefault()
        if (isReportMode) {
          deactivateReportMode()
        } else {
          activateReportMode()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isReportMode])

  // Handle mouse movement for element highlighting
  useEffect(() => {
    if (!isReportMode) return

    const handleMouseMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement
      if (element && element !== overlayRef.current && !element.closest('[data-report-mode-ui]')) {
        setHighlightedElement(element)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [isReportMode])

  // Handle click events in report mode
  useEffect(() => {
    if (!isReportMode) return

    const handleClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const element = event.target as HTMLElement
      if (element && !element.closest('[data-report-mode-ui]')) {
        setClickedElement(element)
        setIsDialogOpen(true)
        // Deactivate report mode when dialog opens
        deactivateReportMode()
      }
    }

    // Capture clicks during capture phase to prevent default behavior
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [isReportMode])

  // Handle dialog close
  const handleDialogClose = () => {
    setIsDialogOpen(false)
    setClickedElement(null)
    // Report mode is already deactivated when dialog opens
  }

  return (
    <ReportModeContext.Provider
      value={{
        isReportMode,
        activateReportMode,
        deactivateReportMode,
        highlightedElement,
        setHighlightedElement,
      }}
    >
      {children}

      {/* Report Mode Indicator */}
      {isReportMode && (
        <div
          data-report-mode-ui
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[10000] bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 pointer-events-none"
        >
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Report Mode Active - Click on any element to report an issue
          <kbd className="bg-blue-700 px-2 py-1 rounded text-xs">Ctrl+Alt</kbd>
          <span className="text-xs">to exit</span>
        </div>
      )}

      {/* Highlight overlay */}
      {isReportMode && highlightedElement && (
        <div
          ref={overlayRef}
          data-report-mode-ui
          className="fixed pointer-events-none z-[9999] border-2 border-blue-500 bg-blue-500/10 transition-all duration-150"
          style={{
            left: highlightedElement.getBoundingClientRect().left + window.scrollX,
            top: highlightedElement.getBoundingClientRect().top + window.scrollY,
            width: highlightedElement.getBoundingClientRect().width,
            height: highlightedElement.getBoundingClientRect().height,
          }}
        />
      )}

      {/* Report Dialog */}
      <ReportDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        targetElement={clickedElement}
      />
    </ReportModeContext.Provider>
  )
}
```

### 4. Index File (`src/components/report-mode/index.ts`)

```typescript
export { ReportModeProvider, useReportMode } from './report-mode-provider'
export { ReportDialog } from './report-dialog'
```

## Log Monitor Implementation

### 5. Log Monitor Provider (`src/components/providers/log-monitor-provider.tsx`)

```typescript
"use client"

import * as React from "react"
import { createContext, useContext, useState } from "react"
import { FloatingLogWindow } from "@/components/ui/floating-log-window"

interface LogMonitorContextType {
  isVisible: boolean
  setIsVisible: (visible: boolean) => void
  toggleVisibility: () => void
}

const LogMonitorContext = createContext<LogMonitorContextType | undefined>(undefined)

export function useLogMonitor() {
  const context = useContext(LogMonitorContext)
  if (context === undefined) {
    throw new Error('useLogMonitor must be used within a LogMonitorProvider')
  }
  return context
}

interface LogMonitorProviderProps {
  children: React.ReactNode
}

export function LogMonitorProvider({ children }: LogMonitorProviderProps) {
  const [isVisible, setIsVisible] = useState(true)

  const toggleVisibility = () => {
    setIsVisible(prev => !prev)
  }

  const value = {
    isVisible,
    setIsVisible,
    toggleVisibility,
  }

  return (
    <LogMonitorContext.Provider value={value}>
      {children}
      {isVisible && <FloatingLogWindow onClose={() => setIsVisible(false)} />}
    </LogMonitorContext.Provider>
  )
}
```

### 6. Floating Log Window (`src/components/ui/floating-log-window.tsx`)

```typescript
"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  X,
  Minimize2,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2
} from "lucide-react"
import { cn } from "@/lib/utils"

// Types based on the logsink API schema with issue management fields
interface LogEntry {
  id: string
  timestamp: string
  message: string
  state: 'open' | 'in_progress' | 'done' | 'revert'
  type?: 'bugfix' | 'feature' | 'documentation' | 'error' | 'warning' | 'info' | 'success' | 'debug'
  severity?: 'low' | 'medium' | 'high' | 'critical'
  effort?: 'low' | 'medium' | 'high' | 'critical'
  plan?: string
  llmOutput?: string
  revertReason?: string
  git_commit?: string
  statistics?: {
    duration?: number
    cost?: number
    tokens_in?: number
    tokens_out?: number
    total_tokens?: number
    timeToResolve?: number
    linesChanged?: number
  }
  context?: {
    message?: string
    url?: string
    level?: string
    source?: string
    type?: string
    severity?: string
    [key: string]: unknown
  }
}

interface FloatingLogWindowProps {
  className?: string
  onClose?: () => void
}

const API_BASE_URL = '<LOG_ENDPOINT>/<APPLICATION_ID>'
const API_KEY = '<LOG_API_KEY>'

export function FloatingLogWindow({ className, onClose }: FloatingLogWindowProps) {
  const [isMinimized, setIsMinimized] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [allLogs, setAllLogs] = useState<LogEntry[]>([])
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<{ [key: string]: string }>({})
  const [showRejectInput, setShowRejectInput] = useState<{ [key: string]: boolean }>({})

  // Polling function to fetch logs from logsink server
  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(API_BASE_URL, {
        headers: {
          'X-API-Key': API_KEY,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch logs: ${response.status}`)
      }

      const data = await response.json()
      const fetchedLogs = data.logs || []
      setAllLogs(fetchedLogs)

      // Filter for open and done logs (exclude closed)
      const openAndDoneLogs = fetchedLogs.filter((log: LogEntry) => log.state === 'open' || log.state === 'done')
      setLogs(openAndDoneLogs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
      console.error('Error fetching logs:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Poll every 10 seconds and auto-collapse when no items
  useEffect(() => {
    fetchLogs() // Initial fetch
    const interval = setInterval(fetchLogs, 10000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  // Auto-collapse when no items, but don't auto-open
  useEffect(() => {
    if (logs.length === 0 && !isMinimized) {
      setIsMinimized(true)
    }
  }, [logs.length, isMinimized])

  // Handle accept action - removes log from server
  const handleAccept = async (logId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${logId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': API_KEY,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to accept log: ${response.status}`)
      }

      // Remove from local state
      setLogs(prev => prev.filter(log => log.id !== logId))
    } catch (err) {
      console.error('Error accepting log:', err)
      setError(err instanceof Error ? err.message : 'Failed to accept log')
    }
  }

  // Handle reject action - sends rejection reason to server
  const handleReject = async (logId: string) => {
    const reason = rejectReason[logId]
    if (!reason?.trim()) {
      setError('Please provide a reason for rejection')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/${logId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        body: JSON.stringify({
          rejectReason: reason.trim()
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to reject log: ${response.status}`)
      }

      // Remove from local state and clear reject input
      setLogs(prev => prev.filter(log => log.id !== logId))
      setRejectReason(prev => ({ ...prev, [logId]: '' }))
      setShowRejectInput(prev => ({ ...prev, [logId]: false }))
    } catch (err) {
      console.error('Error rejecting log:', err)
      setError(err instanceof Error ? err.message : 'Failed to reject log')
    }
  }

  // Handle delete action
  const handleDelete = async (logId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${logId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': API_KEY,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to delete log: ${response.status}`)
      }

      // Remove from local state
      setLogs(prev => prev.filter(log => log.id !== logId))
    } catch (err) {
      console.error('Error deleting log:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete log')
    }
  }

  // Toggle expanded state for logs with long content
  const toggleExpanded = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(logId)) {
        newSet.delete(logId)
      } else {
        newSet.add(logId)
      }
      return newSet
    })
  }

  // Get state icon based on log state
  const getStateIcon = (state: string) => {
    switch (state) {
      case 'open':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'done':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'closed':
        return <XCircle className="h-4 w-4 text-gray-500" />
      default:
        return <AlertTriangle className="h-4 w-4 text-orange-500" />
    }
  }

  // Get display title from log message or context
  const getDisplayTitle = (log: LogEntry) => {
    return log.context?.message || log.message || 'No message'
  }

  return (
    <div
      className={cn(
        "fixed z-50 bg-background border rounded-lg shadow-lg transition-all duration-200 overflow-hidden",
        isMinimized
          ? "bottom-4 right-4 w-96 h-12"
          : "bottom-4 right-4 w-96 h-[400px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {getStateIcon('open')}
            <span className="font-medium text-sm">Log Monitor</span>
          </div>
          <div className="flex items-center gap-1">
            {logs.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {logs.length} open
              </Badge>
            )}
            {allLogs.filter(log => log.state === 'closed').length > 0 && (
              <Badge variant="outline" className="text-xs">
                {allLogs.filter(log => log.state === 'closed').length} closed
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLogs}
            disabled={isLoading}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-6 w-6 p-0"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!isMinimized && (
        <div className="flex flex-col h-full">
          {error && (
            <div className="p-3 bg-destructive/10 border-b">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {logs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No open logs</p>
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={cn(
                  "border rounded-lg p-3 space-y-2 border-l-4",
                  log.state === 'done' ? "border-l-green-500" : "border-l-yellow-500"
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {getStateIcon(log.state)}
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => toggleExpanded(log.id)}
                          className="flex items-center gap-1 text-left hover:text-primary transition-colors w-full"
                        >
                          {expandedLogs.has(log.id) ? (
                            <ChevronDown className="h-3 w-3 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">
                            {getDisplayTitle(log)}
                          </span>
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons for open logs */}
                    {log.state === 'open' && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAccept(log.id)}
                          className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                        >
                          <CheckCircle className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowRejectInput(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                        >
                          <XCircle className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(log.id)}
                          className="h-6 w-6 p-0 text-gray-600 hover:text-gray-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Reject reason input */}
                  {showRejectInput[log.id] && (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Reason for rejection..."
                        value={rejectReason[log.id] || ''}
                        onChange={(e) => setRejectReason(prev => ({ ...prev, [log.id]: e.target.value }))}
                        className="text-xs"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleReject(log.id)}
                          className="h-6 text-xs"
                        >
                          Submit Rejection
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowRejectInput(prev => ({ ...prev, [log.id]: false }))}
                          className="h-6 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Expanded content with scrollable areas */}
                  {expandedLogs.has(log.id) && (
                    <div className="space-y-3 pt-2">
                      {/* Complete message text */}
                      <div className="bg-muted/50 rounded p-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">Complete Message:</h4>
                        <div className="max-h-32 overflow-y-auto">
                          <p className="text-sm whitespace-pre-wrap">{getDisplayTitle(log)}</p>
                        </div>
                      </div>

                      {/* LLM response for done logs */}
                      {log.state === 'done' && log.llmMessage && (
                        <div className="bg-green-50 dark:bg-green-950/20 rounded p-3">
                          <h4 className="text-xs font-medium text-green-700 dark:text-green-400 mb-2">LLM Response:</h4>
                          <div className="max-h-32 overflow-y-auto">
                            <p className="text-sm whitespace-pre-wrap text-green-900 dark:text-green-100">{log.llmMessage}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

## Setup Instructions

### 1. Environment Variables

Add to your `.env.local`:

```env
NEXT_PUBLIC_LOG_ENDPOINT=<LOG_ENDPOINT>
NEXT_PUBLIC_LOG_API_KEY=your-api-key
```

### 2. Wrap Your App

In your main layout or app component, wrap with both providers:

```typescript
import { ReportModeProvider } from '@/components/report-mode'
import { LogMonitorProvider } from '@/components/providers/log-monitor-provider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ReportModeProvider>
          <LogMonitorProvider>
            {children}
          </LogMonitorProvider>
        </ReportModeProvider>
      </body>
    </html>
  )
}
```

### 3. Optional: Programmatic Access

Use the hooks in any component:

```typescript
import { useReportMode } from '@/components/report-mode'
import { useLogMonitor } from '@/components/providers/log-monitor-provider'

function MyComponent() {
  const { isReportMode, activateReportMode, deactivateReportMode } = useReportMode()
  const { isVisible, toggleVisibility } = useLogMonitor()

  return (
    <div>
      <button onClick={activateReportMode}>
        Start Report Mode
      </button>
      <button onClick={toggleVisibility}>
        {isVisible ? 'Hide' : 'Show'} Log Monitor
      </button>
    </div>
  )
}
```

## Component Path Tracking (Development Mode)

To enable precise component identification for better issue resolution, add `data-component-path` attributes to your React components in development mode:

### Automatic Component Path Injection

```typescript
// Example: Babel plugin or custom wrapper for development
// Add to your component wrapper or use a Babel plugin

// Manual approach for critical components:
export function MyButton({ children, ...props }) {
  const componentPath = process.env.NODE_ENV === 'development'
    ? 'src/components/buttons/MyButton.tsx'
    : undefined;

  return (
    <button
      {...props}
      data-component-path={componentPath}
    >
      {children}
    </button>
  );
}
```

### Benefits
- **Precise Issue Location**: LLM agents can immediately identify which component file to analyze
- **Faster Resolution**: No need to search through codebase to find the problematic component
- **Better Context**: Component path is included in the issue report sent to logsink
- **Dev-Only**: Attribute is only added in development mode to avoid bloating production HTML

### Best Practices
1. Add `data-component-path` to root elements of reusable components
2. Use relative paths from project root (e.g., `src/components/MyComponent.tsx`)
3. Only enable in development mode (`process.env.NODE_ENV === 'development'`)
4. Consider using a Babel plugin or build-time transformation for automatic injection

### Advanced: Automatic Injection with Babel Plugin

For automatic component path injection across your entire codebase, you can create a custom Babel plugin:

```javascript
// babel-plugin-component-path.js
module.exports = function({ types: t }) {
  return {
    visitor: {
      JSXOpeningElement(path, state) {
        // Only in development
        if (process.env.NODE_ENV !== 'development') return;

        // Get the component file path
        const filename = state.file.opts.filename;
        if (!filename) return;

        // Create relative path from project root
        const relativePath = filename.replace(process.cwd() + '/', '');

        // Add data-component-path attribute
        const attribute = t.jSXAttribute(
          t.jSXIdentifier('data-component-path'),
          t.stringLiteral(relativePath)
        );

        // Only add to component root elements (not nested JSX)
        if (path.parent.type === 'ReturnStatement' ||
            path.parent.type === 'ArrowFunctionExpression') {
          path.node.attributes.push(attribute);
        }
      }
    }
  };
};
```

Add to your `.babelrc` or `babel.config.js`:

```json
{
  "plugins": [
    "./babel-plugin-component-path.js"
  ]
}
```

### Alternative: Next.js Custom Webpack Loader

For Next.js projects, you can use a custom webpack loader:

```javascript
// next.config.js
module.exports = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.module.rules.push({
        test: /\.(tsx|jsx)$/,
        use: [
          {
            loader: 'component-path-loader',
            options: {
              rootDir: __dirname
            }
          }
        ]
      });
    }
    return config;
  }
};
```

## Usage

### Report Mode
1. **Activate**: Press `Ctrl+Alt` anywhere on the page
2. **Navigate**: Move mouse to highlight elements with blue border
3. **Report**: Click on any element to open the report dialog
4. **Add Screenshot** (Optional):
   - **Paste**: Take a screenshot with your snipping tool and paste with `Ctrl+V`
   - **Drag & Drop**: Drag an image file directly into the upload area
   - **Browse**: Click "Browse Files" to select an image from your computer
   - **Auto-compression**: Images are automatically compressed to JPEG (40% quality)
5. **Submit**: Select report type, write message, optionally add screenshot, and submit
6. **Deactivate**: Report mode automatically ends when dialog opens

### Log Monitor Window
1. **Automatic Display**: Window appears automatically when logs are available
2. **Minimize/Restore**: Click minimize button to collapse/expand window
3. **Refresh**: Click refresh button to manually fetch latest logs
4. **Expand Logs**: Click on log entries to view complete message, implementation plan, LLM analysis, and revert reasons
5. **Manage Logs** - State-based actions:
   - **Open State**:
     - Delete: Permanently delete the log entry
   - **In-Progress State**:
     - Done: Mark as completed (requires completion message)
     - Revert Icon: Revert back to open state
     - Delete: Permanently delete the log entry
   - **Done State**:
     - Accept: Close the log as accepted (removes from view)
     - Revert: Revert with reason (requires revert reason explanation)
     - Delete: Permanently delete the log entry
   - **Revert State**:
     - Delete: Permanently delete the log entry
6. **Issue Fields**: View type (bugfix/feature/documentation), effort level, implementation plan, and LLM analysis in expanded view
7. **Statistics**: View duration, time to resolve, cost, token usage, lines changed, and git commit links
8. **Auto-collapse**: Window automatically minimizes when no logs are present

## LLM Agent Installation Package

This implementation provides a complete, unified package that can be installed by any LLM agent into React applications. The package includes:

### Complete Feature Set
- **Report Mode**: User feedback collection with element targeting
- **Log Monitor**: Real-time log management and monitoring
- **Logsink Integration**: Unified backend communication
- **Auto-configuration**: Minimal setup required

### Installation Commands for LLM Agents

```bash
# Install required dependencies
npm install lucide-react

# Ensure shadcn/ui components are available
npx shadcn-ui@latest add dialog button textarea card badge

# Set environment variables
echo "NEXT_PUBLIC_LOG_ENDPOINT=<LOG_ENDPOINT>" >> .env.local
echo "NEXT_PUBLIC_LOG_API_KEY=<LOG_API_KEY>" >> .env.local
```

### Screenshot Feature Requirements

The screenshot functionality requires these additional Lucide React icons:
- `Upload` - For the file upload area
- `Image` - For image preview information
- `X` - For removing uploaded images

These are already included in the lucide-react package installation above.

### Single Integration Point

LLM agents can integrate both systems with a single provider wrapper:

```typescript
// Add to your app's root layout
import { ReportModeProvider } from '@/components/report-mode'
import { LogMonitorProvider } from '@/components/providers/log-monitor-provider'

// Wrap your entire app
<ReportModeProvider>
  <LogMonitorProvider>
    {children}
  </LogMonitorProvider>
</ReportModeProvider>
```

### Unified API

Both systems share the same logsink server infrastructure:
- **Report submissions** → Sent to logsink as user feedback
- **Log monitoring** → Fetches from logsink for management
- **State management** → Unified accept/reject/delete operations

## Data Structure

### Report Mode Data

Only actual user report submissions are sent to the logging endpoint. Report mode activation, deactivation, and element clicks are not logged to avoid clutter.

Reports are sent to the logging endpoint with this structure:

```json
{
  "applicationId": "your-app-id",
  "message": "User report: bug",
  "context": {
    "timestamp": "2025-09-13T16:27:02.956Z",
    "url": "http://localhost:3001/test-report/",
    "userAgent": "Mozilla/5.0...",
    "reportType": "bug",
    "message": "The button doesn't work",
    "elementInfo": {
      "tagName": "BUTTON",
      "id": "submit-btn",
      "className": "btn btn-primary",
      "textContent": "Submit",
      "innerHTML": "<span>Submit</span>",
      "componentPath": "src/components/forms/SubmitButton.tsx",
      "attributes": {
        "type": "button",
        "class": "btn btn-primary",
        "data-component-path": "src/components/forms/SubmitButton.tsx"
      },
      "boundingRect": {
        "x": 100,
        "y": 200,
        "width": 80,
        "height": 32
      }
    },
    "viewport": {
      "width": 1920,
      "height": 1080
    },
    "screenshot": {
      "data": "base64-encoded-image-data",
      "filename": "screenshot.jpg",
      "size": 45678,
      "type": "image/jpeg"
    }
  }
}
```

### Log Monitor Data

The log monitor fetches and manages logs from the logsink server. Log entries have this structure:

```json
{
  "id": "unique-log-id",
  "timestamp": "2025-09-14T10:30:00.000Z",
  "message": "Error occurred in component",
  "state": "done",
  "type": "bugfix",
  "severity": "high",
  "effort": "medium",
  "plan": "# Implementation Plan\n\n1. Investigate root cause\n2. Fix handler logic\n3. Add tests",
  "llmOutput": "This error was resolved by updating the component props and adding proper error handling",
  "git_commit": "abc123def",
  "statistics": {
    "duration": 3600,
    "timeToResolve": 2700,
    "cost": 0.05,
    "tokens_in": 1000,
    "tokens_out": 500,
    "total_tokens": 1500,
    "linesChanged": 23
  },
  "context": {
    "message": "Button click handler failed",
    "url": "http://localhost:3000/dashboard",
    "level": "error",
    "source": "console.error",
    "type": "bugfix",
    "severity": "high",
    "elementInfo": {
      "tagName": "BUTTON",
      "id": "action-btn"
    }
  }
}
```

### Log States and Lifecycle

The log lifecycle follows this workflow:

```
create → (pending - embedding) → open → in_progress → done
                                   ↓         ↓          ↓
                                 delete   revert    accept/revert
                                                       ↓
                                                    closed
```

**State Descriptions:**
- **pending**: Initial state for embedding processing ONLY (automatic background process, not shown in UI)
- **open**: Issue is ready for development work (automatically set after embedding completes)
- **in_progress**: Issue is actively being worked on
- **done**: Issue has been completed
- **revert**: Issue was completed but reverted due to problems, or reset from in_progress
- **closed**: Issue has been accepted and archived (not shown in UI)

**Key Transitions:**
- All issues start in `pending` state for embedding processing
- Background processor automatically moves from `pending` → `open` after embedding is complete
- Agents should fetch from `/open` endpoint, not `/pending`
- If an open issue has no plan, create one using PATCH `/plan` endpoint
- Can only move to `in_progress` from `open` or `revert` states

### API Operations

**Fetching Logs:**
- **GET** `{baseUrl}` - Fetch all logs for the application

**State Transitions:**
- **PATCH** `{baseUrl}/{logId}/in-progress` - Start progress (open → in_progress)
- **PUT** `{baseUrl}/{logId}` - Mark as done (in_progress → done)
  - Body: `{ message, git_commit, statistics }`
- **PATCH** `{baseUrl}/{logId}/revert` - Revert with reason (done → revert OR in_progress → open)
  - Body: `{ revertReason }`
- **POST** `{baseUrl}/{logId}` - Reopen with rejection reason (done → open)
  - Body: `{ rejectReason }`
- **DELETE** `{baseUrl}/{logId}` - Accept/delete log (done → closed OR any state → deleted)

**Issue Management:**
- **PATCH** `{baseUrl}/{logId}/plan` - Set/update implementation plan
  - Body: `{ plan }`
- **PATCH** `{baseUrl}/{logId}/issue-fields` - Update issue fields
  - Body: `{ type, effort, plan, llmOutput }`

**Bulk Operations:**
- **DELETE** `{baseUrl}` - Delete all logs
- **DELETE** `{baseUrl}/closed` - Delete closed logs only

**Note:** `{baseUrl}` = `{LOG_ENDPOINT}/{APPLICATION_ID}` (e.g., `http://localhost:3000/log/my-app`)

### Issue Management Fields

The LogMonitor now supports comprehensive issue tracking fields:

**Issue Type:**
- `bugfix` - Bug fixes and error corrections
- `feature` - New features and enhancements
- `documentation` - Documentation updates and improvements

**Effort Levels:**
- `low` - Simple changes, minimal impact
- `medium` - Standard development work
- `high` - Complex changes requiring significant effort
- `critical` - Urgent, high-priority work

**Implementation Plan (`plan`):**
- Markdown-formatted text describing the implementation approach
- Displayed in blue section with mono-spaced font
- Scrollable for long plans

**LLM Analysis (`llmOutput`):**
- Complete AI analysis results and recommendations
- Displayed in green section
- Available for in_progress, done, and revert states

**Revert Reason (`revertReason`):**
- Required when reverting a done log
- Explains why the completed work was reverted
- Displayed in orange section for revert state logs

**Statistics:**
- `duration` - Total time spent (seconds)
- `timeToResolve` - Time from open to done (seconds)
- `cost` - Associated cost (dollars)
- `tokens_in` - Input tokens used
- `tokens_out` - Output tokens used
- `total_tokens` - Combined token count
- `linesChanged` - Number of code lines changed

**Git Integration:**
- `git_commit` - Commit hash for completed work
- Displayed as clickable link (requires `NEXT_PUBLIC_GIT_COMMIT_URL` env var)
- URL template format: `https://github.com/org/repo/commit/%COMMIT%`

## Customization

### Report Types

Modify the `reportTypes` array in `report-dialog.tsx` to add/remove/change report categories.

### Styling

All components use Tailwind CSS classes. Customize colors, spacing, and animations by modifying the className props.

### Logging Endpoint

Change the `LOG_ENDPOINT` and `API_KEY` in the logger service to use your own logging infrastructure.

### Element Information

Modify the `elementInfo` object in `handleSubmit` to capture additional or different element properties.

### Screenshot Configuration

Customize the image compression and handling:

```typescript
// In report-dialog.tsx processImageFile function
// Adjust compression quality (0.1 = 10%, 1.0 = 100%)
const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.4)

// Change maximum preview height
className="max-w-full max-h-48 rounded-lg border" // Change max-h-48 to desired height

// Modify accepted file types
accept="image/*" // Change to specific types like "image/png,image/jpeg"

// Customize drag & drop area styling
className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
  isDragOver
    ? 'border-primary bg-primary/5'  // Active drag state
    : 'border-muted-foreground/25 hover:border-muted-foreground/50' // Default state
}`}
```

### Log Monitor Configuration

Customize the log monitor behavior:

```typescript
// In floating-log-window.tsx
const API_BASE_URL = 'http://your-logsink-server.com/log/your-app-id'
const API_KEY = 'your-api-key'

// Polling interval (default: 10 seconds)
const interval = setInterval(fetchLogs, 10000)

// Window dimensions
const windowConfig = {
  minimized: "w-96 h-12",
  expanded: "w-96 h-[400px]",
  position: "bottom-4 right-4"
}

// Auto-collapse behavior
const autoCollapseEnabled = true
```

### Log Display Options

Modify log display and filtering:

```typescript
// Filter logs by state
const visibleStates = ['open', 'done'] // exclude 'closed'

// Expandable content max height
const maxContentHeight = "max-h-32" // 8rem

// Log entry colors
const stateColors = {
  open: "border-l-yellow-500",
  done: "border-l-green-500",
  closed: "border-l-gray-500"
}
```

## Browser Compatibility

- Modern browsers with ES6+ support
- Requires `fetch` API support
- Uses `getBoundingClientRect()` for element positioning
- Keyboard event handling with `ctrlKey` and `altKey`

## Security Considerations

- API keys should be properly secured
- Consider rate limiting on the logging endpoint
- Sanitize user input before storing
- Element information may contain sensitive data - review what's captured

## Troubleshooting

### Common Issues

1. **UI components not found**: Ensure shadcn/ui components are installed
2. **Styles not applied**: Verify Tailwind CSS is configured
3. **Reports not sending**: Check network tab and logging endpoint
4. **Keyboard shortcut conflicts**: May conflict with browser/OS shortcuts
5. **Log monitor not fetching**: Verify API endpoint and key configuration (use `NEXT_PUBLIC_LOG_ENDPOINT` and `NEXT_PUBLIC_LOG_API_KEY`)
6. **Logs not updating**: Check polling interval and server connectivity
7. **Scrolling issues in expanded content**: Ensure max-height and overflow styles are applied
8. **Screenshot paste not working**: Ensure the dialog is open and focused when pasting
9. **Image compression failing**: Check browser console for canvas/image processing errors
10. **Large file uploads**: Images are automatically compressed, but very large files may still cause issues
11. **Buttons appearing under text**: Fixed - buttons now use `flex-shrink-0` to stay beside content
12. **State transition failures**: Ensure the log is in the correct state before attempting transitions (e.g., can't mark done from open, must be in_progress first)
13. **Missing issue fields**: Type, effort, plan, and llmOutput are optional - they won't display if not present
14. **Git commit links not working**: Set `NEXT_PUBLIC_GIT_COMMIT_URL` environment variable with `%COMMIT%` placeholder
15. **Delete not working**: Fixed - simplified URL construction now properly handles base URLs with protocols
16. **Component path not captured**: Ensure `data-component-path` attribute is added to components in development mode
17. **Component path showing in production**: Only add `data-component-path` when `NODE_ENV === 'development'`

### Debug Mode

Add console logging to track both systems:

```typescript
// In report-mode-provider.tsx
console.log('Report mode:', isReportMode)
console.log('Highlighted element:', highlightedElement)

// In floating-log-window.tsx
console.log('Fetched logs:', logs)
console.log('API response:', data)
console.log('Expanded logs:', expandedLogs)
```

### Testing the Integration

Verify both systems work correctly:

```typescript
// Test report mode
// 1. Press Ctrl+Alt to activate
// 2. Click any element
// 3. Submit a test report

// Test screenshot functionality
// 1. Open report dialog
// 2. Test paste: Take a screenshot and paste with Ctrl+V
// 3. Test drag & drop: Drag an image file into the upload area
// 4. Test file browse: Click "Browse Files" and select an image
// 5. Verify image preview appears and shows compressed size
// 6. Submit report and check that screenshot data is included

// Test log monitor state transitions
// 1. Check if window appears with open logs
// 2. Verify logs are fetched and display correct state badges
// 3. Test Open state: Delete button
// 4. Test In-Progress state:
//    - Click Done button and provide completion message
//    - Click Revert icon to move back to open
//    - Click Delete button
// 5. Test Done state:
//    - Click Accept to close
//    - Click Revert and provide revert reason
//    - Click Delete button
// 6. Test Revert state: Delete button
// 7. Verify expanded content shows:
//    - Complete message text
//    - Implementation plan (if present)
//    - LLM analysis (if present)
//    - Revert reason (if in revert state)
//    - Statistics (duration, tokens, lines changed, etc.)
//    - Git commit link (if present and env var configured)
// 8. Verify buttons stay beside text content, not below
// 9. Test issue fields display (type, effort) in timestamp line
```

## Recent Updates (2025-09-30)

### Major Changes to LogMonitor

**1. Enhanced State Lifecycle**
- Added `in_progress` and `revert` states to the workflow
- Removed `closed` state from UI display (handled server-side)
- Implemented proper state transition workflow with `pending` → `open` → `in_progress` → `done`
- Added revert capability from both `done` and `in_progress` states

**2. Issue Management Fields**
- **Type**: bugfix, feature, documentation (plus log types: error, warning, info, success, debug)
- **Severity**: low, medium, high, critical
- **Effort**: low, medium, high, critical
- **Plan**: Markdown implementation plan with scrollable display
- **LLM Output**: Complete AI analysis (renamed from `llmMessage`)
- **Revert Reason**: Required explanation when reverting completed work

**3. Enhanced Statistics**
- Added `timeToResolve` - time from open to completion
- Added `linesChanged` - number of code lines modified
- Existing: duration, cost, tokens (in/out/total)
- Git commit integration with clickable links

**4. UI/UX Improvements**
- **Fixed Button Layout**: Buttons now stay beside content using `flex-shrink-0`, not below
- **Removed Start Button**: Simplified workflow - logs move from open directly to in_progress via server API
- **State-Specific Actions**: Each state shows only relevant action buttons
- **Enhanced Expandable Content**: Separate sections for plan, LLM analysis, revert reason
- **Visual Indicators**: Color-coded borders for each state (yellow=open, blue=in_progress, green=done, orange=revert)
- **Badge System**: Shows counts for open, in_progress, done, and reverted logs

**5. API Changes**
- **Simplified URL Construction**: Fixed delete issues by removing complex URL parsing
- **New Endpoints**:
  - `PATCH /:applicationId/:logId/in-progress` - Start progress
  - `PUT /:applicationId/:logId` - Mark as done with completion message
  - `PATCH /:applicationId/:logId/revert` - Revert with reason
  - `PATCH /:applicationId/:logId/plan` - Set implementation plan
  - `PATCH /:applicationId/:logId/issue-fields` - Update issue fields
- **Updated Endpoints**:
  - `POST /:applicationId/:logId` - Reopen with rejection reason
  - `DELETE /:applicationId/:logId` - Accept/delete (simplified)

**6. Configuration**
- Added `NEXT_PUBLIC_GIT_COMMIT_URL` for git commit link template
- Format: `https://github.com/org/repo/commit/%COMMIT%`

### Breaking Changes
- `state` enum changed from `'open' | 'done' | 'closed'` to `'open' | 'in_progress' | 'done' | 'revert'`
- `llmMessage` field renamed to `llmOutput` for consistency
- Reject action now uses POST with `rejectReason` body (reopens log)
- Reset action removed - replaced with revert (PATCH with `revertReason`)

### Migration Notes
- Update all references from `llmMessage` to `llmOutput`
- Update state checks to include `in_progress` and `revert` states
- Remove references to `closed` state from client-side code
- Update API calls to use new simplified URL construction

This implementation provides a complete, production-ready user feedback and log monitoring system that can be easily integrated into any React/Next.js application by LLM agents.

## Enhanced Features Summary (Latest Update)

### Component Path Tracking
The report mode now supports precise component identification through `data-component-path` attributes:

**Key Benefits:**
- ✅ **Faster Issue Resolution**: LLM agents can immediately identify which component file to fix
- ✅ **No Guesswork**: Direct path to the problematic component eliminates codebase searching
- ✅ **Better Context**: Full component path included in every issue report
- ✅ **Dev-Only**: Attributes only added in development mode to keep production HTML clean

**Implementation:**
1. Add `data-component-path` attributes to your React components in development mode
2. The report mode automatically captures this path when users click on elements
3. The path is included in the `elementInfo.componentPath` field of the issue
4. The `/fix-from-sink` command recognizes and uses this path for targeted analysis

**Example Flow:**
1. User clicks on a broken button in dev mode
2. Report mode captures: `componentPath: "src/components/forms/SubmitButton.tsx"`
3. Issue is sent to logsink with full component path
4. LLM agent reads the issue and immediately opens `src/components/forms/SubmitButton.tsx`
5. Agent analyzes the specific component and implements the fix
6. No time wasted searching through the codebase

**Integration with fix-from-sink:**
The `/fix-from-sink` command now checks for `context.elementInfo.componentPath` and uses it to:
- Directly identify which file to analyze
- Skip codebase search steps
- Provide more accurate fixes faster
- Reduce token usage by focusing on the right component
