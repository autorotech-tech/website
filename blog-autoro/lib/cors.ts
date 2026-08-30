const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_URL || 'https://swoop.autoro.tech'

export function corsHeaders(request?: Request) {
  const origin = request?.headers.get('origin') || ADMIN_ORIGIN
  const allow = origin.endsWith('autoro.tech') || origin.includes('localhost') ? origin : ADMIN_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  }
}

export function json(data: unknown, init: ResponseInit = {}, request?: Request) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders(request),
      ...(init.headers || {}),
    },
  })
}

export function options(request?: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
