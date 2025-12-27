module.exports = {
  apps: [
    {
      name: 'pcru-backend',
      script: 'server.js',
      cwd: '/Users/kriangkrai/pcru-chatbot-backend-1',
      watch: true,
      ignore_watch: ['node_modules', 'logs', '.git', 'uploads'],
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'pcru-frontend',
      // Run the frontend dev server via a shell so `npm` is executed correctly
      script: '/bin/bash',
      args: '-lc "cd /Users/kriangkrai/PCRU-CHATBOT-FRONTEND-1 && npm run dev"',
      cwd: '/Users/kriangkrai/PCRU-CHATBOT-FRONTEND-1',
      watch: false,
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'pcru-tokenizer',
      // Use the uvicorn binary inside the project's .venv for a reliable interpreter
      script: '/Users/kriangkrai/pcru-chatbot-backend-1/.venv/bin/uvicorn',
      args: 'scripts.pythainlp_tokenizer_service:app --host 127.0.0.1 --port 36146',
      cwd: '/Users/kriangkrai/pcru-chatbot-backend-1',
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1'
      }
    }
  ]
};
