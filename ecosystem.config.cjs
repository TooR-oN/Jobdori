module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: '/home/user/webapp/backend',
      script: 'npx',
      args: 'tsx watch api/index.ts',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    },
    {
      name: 'frontend',
      cwd: '/home/user/webapp/frontend',
      script: 'npx',
      args: 'next dev -p 3001 -H 0.0.0.0',
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
