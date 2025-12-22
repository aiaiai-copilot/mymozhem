---
name: react-components
description: React component patterns and shadcn/ui usage for MyMozhem. Use when creating components, forms, modals, lists, or working with UI elements. Includes accessibility and responsive design patterns.
---

# React Components Skill

Patterns and conventions for React components in MyMozhem.

## shadcn/ui Components

Available in `src/components/ui/`:

```typescript
// Buttons
import { Button } from '@/components/ui/button'
<Button variant="default|destructive|outline|secondary|ghost|link" size="default|sm|lg|icon">

// Forms
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Feedback
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// Layout
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

// Data Display
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
```

## Component Patterns

### Form with Validation

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/i18n'

interface FormData {
  name: string
}

interface NameFormProps {
  onSubmit: (data: FormData) => Promise<void>
  disabled?: boolean
}

export function NameForm({ onSubmit, disabled }: NameFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!name.trim()) {
      setError(t('common.required'))
      return
    }
    
    setIsLoading(true)
    try {
      await onSubmit({ name: name.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t('lottery.enterName')}</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isLoading || disabled}
          aria-invalid={!!error}
          aria-describedby={error ? 'name-error' : undefined}
        />
        {error && (
          <p id="name-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={isLoading || disabled}>
        {isLoading ? t('common.loading') : t('common.submit')}
      </Button>
    </form>
  )
}
```

### List with Loading State

```typescript
import { Skeleton } from '@/components/ui/skeleton'

interface ListProps<T> {
  items: T[] | undefined
  isLoading: boolean
  renderItem: (item: T) => React.ReactNode
  emptyMessage: string
  keyExtractor: (item: T) => string
}

export function List<T>({ 
  items, 
  isLoading, 
  renderItem, 
  emptyMessage,
  keyExtractor,
}: ListProps<T>) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (!items?.length) {
    return (
      <p className="text-muted-foreground text-center py-8">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  )
}
```

### Confirmation Dialog

```typescript
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useTranslation } from '@/i18n'

interface ConfirmDialogProps {
  trigger: React.ReactNode
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
}

export function ConfirmDialog({ 
  trigger, 
  title, 
  description, 
  confirmLabel, 
  onConfirm,
  destructive = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            className={destructive ? 'bg-destructive hover:bg-destructive/90' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

## Responsive Patterns

```typescript
// Mobile-first with breakpoints
<div className="
  flex flex-col gap-4        {/* Mobile: stack vertically */}
  md:flex-row md:gap-6       {/* Tablet+: horizontal */}
  lg:gap-8                   {/* Desktop: more spacing */}
">

// Hide/show by breakpoint
<div className="hidden md:block">Desktop only</div>
<div className="md:hidden">Mobile only</div>

// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

// Responsive text
<h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">
```

## Accessibility Checklist

- [ ] Interactive elements have accessible names (`aria-label` or visible text)
- [ ] Form inputs have associated `<Label>` elements
- [ ] Error messages linked with `aria-describedby`
- [ ] Loading states use `aria-busy="true"`
- [ ] Focus management for modals/dialogs (handled by shadcn)
- [ ] Sufficient color contrast (use theme colors)
- [ ] Keyboard navigation works
