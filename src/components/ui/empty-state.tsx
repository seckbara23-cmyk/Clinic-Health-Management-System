import { cn } from '@/lib/utils'
import { Button } from './button'

interface EmptyStateProps {
  icon?: React.ElementType
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center px-4', className)}>
      {Icon && <Icon className="h-12 w-12 text-gray-200 mb-4" strokeWidth={1.5} />}
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {description && (
        <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && (
        <Button variant="outline" size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
