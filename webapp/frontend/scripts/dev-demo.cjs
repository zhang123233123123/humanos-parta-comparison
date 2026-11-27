const { spawn } = require('node:child_process')
const path = require('node:path')

// This command launches only Next.js. No backend, database or AI process.
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3100'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, HUMANOS_DEMO_MODE: '1', NEXT_PUBLIC_HUMANOS_DEMO_MODE: '1' },
})
child.on('exit', code => { process.exitCode = code ?? 0 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
