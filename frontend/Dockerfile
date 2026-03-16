# Development image for frontendv6
# Runs Vite dev server with HMR, proxying API calls to the backend.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source (volume-mounted in dev, so this is mainly for ci/build)
COPY . .

EXPOSE 5173

# --host exposes the dev server outside the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
