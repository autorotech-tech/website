export default function robots() {
  const app = process.env.NEXT_PUBLIC_APP_URL || 'https://autoro.tech'
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${app}/sitemap.xml`,
    host: app,
  }
}
