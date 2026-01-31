'use client'

import { useEffect, useState } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, duration?: number) => void
  removeToast: (id: string) => void
}

// 전역 토스트 상태
let toastListeners: ((toasts: Toast[]) => void)[] = []
let currentToasts: Toast[] = []

const notifyListeners = () => {
  toastListeners.forEach((listener) => listener([...currentToasts]))
}

export const toast = {
  show: (message: string, type: ToastType = 'info', duration = 3000) => {
    const id = Math.random().toString(36).substr(2, 9)
    currentToasts = [...currentToasts, { id, message, type, duration }]
    notifyListeners()
    
    if (duration > 0) {
      setTimeout(() => {
        currentToasts = currentToasts.filter((t) => t.id !== id)
        notifyListeners()
      }, duration)
    }
  },
  success: (message: string, duration?: number) => toast.show(message, 'success', duration),
  error: (message: string, duration?: number) => toast.show(message, 'error', duration),
  info: (message: string, duration?: number) => toast.show(message, 'info', duration),
  warning: (message: string, duration?: number) => toast.show(message, 'warning', duration),
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const styles = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
}

// useToast 훅 - 컴포넌트에서 사용
export function useToast() {
  return {
    toast: (message: string, type: ToastType = 'info') => toast.show(message, type),
    showToast: (message: string, type: ToastType = 'info', duration?: number) => toast.show(message, type, duration),
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    info: (message: string) => toast.info(message),
    warning: (message: string) => toast.warning(message),
  }
}

// ToastProvider - providers.tsx에서 사용
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastContainer />
    </>
  )
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const listener = (newToasts: Toast[]) => setToasts(newToasts)
    toastListeners.push(listener)
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener)
    }
  }, [])

  const removeToast = (id: string) => {
    currentToasts = currentToasts.filter((t) => t.id !== id)
    notifyListeners()
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.type]
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
              'animate-in slide-in-from-right-5',
              styles[t.type]
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-medium">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="ml-2 rounded-full p-1 hover:bg-black/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
