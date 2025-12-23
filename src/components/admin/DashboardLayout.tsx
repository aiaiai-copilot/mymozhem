import { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
  roomName: string
  children: ReactNode
  className?: string
}

export function DashboardLayout({ roomName, children, className }: DashboardLayoutProps) {
  return (
    <div className={cn('min-h-screen bg-background', className)}>
      <header className="border-b">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">{roomName}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:gap-8">
          {children}
        </div>
      </main>
    </div>
  )
}

interface DashboardSectionProps {
  title: string
  children: ReactNode
  className?: string
}

export function DashboardSection({ title, children, className }: DashboardSectionProps) {
  return (
    <section className={cn('space-y-4', className)}>
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Separator className="mt-2" />
      </div>
      <div>{children}</div>
    </section>
  )
}
