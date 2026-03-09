module.exports = {
  apps: [{
    name: 'ball-accounting',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      JWT_SECRET: 'your-super-secret-key-change-this',  // ← 改成隨機字串
      DB_PATH: '/home/your-user/ball-app/data/ball.db'  // ← 改成你的路徑
    }
  }]
};
