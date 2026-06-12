# Stage 1: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Build-time variables (Vite bakes VITE_* into the JS bundle)
ARG VITE_DOCUWARE_CLIENT_ID
ARG VITE_DOCUWARE_CLIENT_SECRET
ARG VITE_DOCUWARE_WORKFLOW_API_KEY
ARG VITE_DOCUWARE_WORKFLOW_URL

ENV VITE_DOCUWARE_CLIENT_ID=$VITE_DOCUWARE_CLIENT_ID
ENV VITE_DOCUWARE_CLIENT_SECRET=$VITE_DOCUWARE_CLIENT_SECRET
ENV VITE_DOCUWARE_WORKFLOW_API_KEY=$VITE_DOCUWARE_WORKFLOW_API_KEY
ENV VITE_DOCUWARE_WORKFLOW_URL=$VITE_DOCUWARE_WORKFLOW_URL

# Copy the rest of the application source code
COPY . .

# Build the Vite application (outputs to /dist)
RUN npm run build

# Stage 2: Serve the application with the Node.js proxy
FROM node:20-alpine

WORKDIR /app

# Copy package files again for production dependencies
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the build output from the builder stage
COPY --from=builder /app/dist ./dist

# Copy the server files
COPY proxy-server.js ./
COPY docker-server.js ./
COPY scheduler.js ./
COPY tokenManager.js ./

# Copy data files if they exist and create placeholders if they do not
COPY schedules.json* history.json* tokens.json* ./
RUN [ -f schedules.json ] || echo "[]" > schedules.json
RUN [ -f history.json ] || echo "[]" > history.json
RUN [ -f tokens.json ] || echo "{}" > tokens.json
RUN mkdir -p exports

# Runtime variables (used by proxy-server.js, tokenManager.js, scheduler.js)
ARG VITE_DOCUWARE_CLIENT_ID
ARG VITE_DOCUWARE_CLIENT_SECRET
ARG DOCUWARE_USERNAME
ARG DOCUWARE_PASSWORD
ARG DOCUWARE_ORG_ID

ENV VITE_DOCUWARE_CLIENT_ID=$VITE_DOCUWARE_CLIENT_ID
ENV VITE_DOCUWARE_CLIENT_SECRET=$VITE_DOCUWARE_CLIENT_SECRET
ENV DOCUWARE_USERNAME=$DOCUWARE_USERNAME
ENV DOCUWARE_PASSWORD=$DOCUWARE_PASSWORD
ENV DOCUWARE_ORG_ID=$DOCUWARE_ORG_ID
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 5173

# Command to run the application
CMD ["node", "docker-server.js"]
