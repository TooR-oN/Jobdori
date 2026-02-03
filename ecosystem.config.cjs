module.exports = {
  apps: [
    {
      name: 'frontend',
      cwd: '/home/user/webapp/frontend',
      script: 'npx',
      args: 'next dev -p 3001',
      env: {
        NODE_ENV: 'development',
        NEXT_PUBLIC_API_URL: 'https://jobdori.vercel.app',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
