FROM node:22-alpine

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN chown node:node /app

COPY frontend/package.json frontend/package-lock.json ./
USER node
RUN npm ci
COPY --chown=node:node frontend/ ./
ARG BACKEND_API_ORIGIN=http://127.0.0.1:8000
ENV BACKEND_API_ORIGIN=$BACKEND_API_ORIGIN
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
