import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { LOCALES } from './lib/i18n'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/blog' || pathname === '/blog/') {
    const url = request.nextUrl.clone()
    url.pathname = '/en/blog'
    return NextResponse.redirect(url)
  }
  const first = pathname.split('/').filter(Boolean)[0]
  if (first && LOCALES.includes(first as (typeof LOCALES)[number])) {
    return NextResponse.next()
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/blog', '/blog/:path*', '/:locale/blog/:path*'],
}
