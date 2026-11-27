// Explicit build/start flag only. Never enabled by an API error or URL parameter.
export const DEMO_MODE = process.env.NEXT_PUBLIC_HUMANOS_DEMO_MODE === '1'
export const DEMO_USER = 'humanos-browser-demo'
export const demoSession = {
  user: { id: DEMO_USER, name: 'HumanOS 演示账号', email: 'preview@example.test', image: null },
  expires: '2099-01-01T00:00:00.000Z',
}
