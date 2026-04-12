# Use the official Node.js 20 image as the base
FROM node:20-slim

# Install dependencies for better-sqlite3 (native build tools)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Ensure the data directory exists
RUN mkdir -p data

# Define the command to start the bot
CMD [ "npm", "start" ]
