import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/i18n'
import type { Room } from '@/types'
import { cn } from '@/lib/utils'

interface RoomInfoCardProps {
  room: Room
  className?: string
}

export function RoomInfoCard({ room, className }: RoomInfoCardProps) {
  const t = useTranslations()
  const [copied, setCopied] = useState(false)

  const publicUrl = `${window.location.origin}/room/${room.publicId}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle>{room.name}</CardTitle>
        <CardDescription>ID: {room.publicId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t.room.created.publicLink}</p>
          <div className="flex gap-2">
            <Input
              value={publicUrl}
              readOnly
              className="flex-1 text-sm"
            />
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
            >
              {copied ? t.common.success : t.room.created.copyLink}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t.room.created.qrCode}</p>
          <div className="flex justify-center p-4 bg-white rounded-lg">
            <QRCodeSVG
              value={publicUrl}
              size={200}
              level="M"
              includeMargin
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
