const fs = require('fs');
const path = require('path');

// .env 파일에서 환경변수 읽기
const envPath = path.join(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      envVars[key.trim()] = valueParts.join('=').trim();
    }
  });
}

module.exports = {
  apps: [
    {
      name: 'webtoon-monitor',
      script: 'npx',
      args: 'tsx src/server.ts',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        ...envVars
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
