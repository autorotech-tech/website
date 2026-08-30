import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Autoro Blog',
  description: 'AI marketing, ads, automation and implementation notes from Autoro.tech',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
