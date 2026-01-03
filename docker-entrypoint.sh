#!/bin/sh

# Inject environment variables into runtime config
cat > /usr/share/nginx/html/assets/js/runtime-config.js << EOF
window.__ADAMUS_CONFIG__ = {
  GEMINI_API_KEY: "${GEMINI_API_KEY:-}"
};
EOF

# Start nginx
exec nginx -g 'daemon off;'
