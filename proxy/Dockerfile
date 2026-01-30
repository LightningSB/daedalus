# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install git and ca-certificates
RUN apk add --no-cache git ca-certificates

# Copy go mod file
COPY go.mod ./

# Download dependencies and generate go.sum
RUN go mod download

# Copy source code
COPY . .

# Tidy modules
RUN go mod tidy

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o daedalus-proxy .

# Runtime stage
FROM alpine:latest

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from builder
COPY --from=builder /app/daedalus-proxy .

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./daedalus-proxy"]
