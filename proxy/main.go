package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"daedalus-proxy/internal/config"
	"daedalus-proxy/internal/handlers"
	"daedalus-proxy/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	cfg := config.Load()

	// Initialize MinIO client
	minioClient, err := storage.NewMinIOClient(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize MinIO client: %v", err)
	}

	// Create handlers
	catalogHandler := handlers.NewCatalogHandler(minioClient)
	historyHandler := handlers.NewHistoryHandler(minioClient)
	conversationsHandler := handlers.NewConversationsHandler(minioClient)

	// Setup router
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)
	r.Use(middleware.SetHeader("Content-Type", "application/json"))

	// Routes
	r.Get("/api/health", handlers.HealthHandler)
	r.Get("/api/catalog", catalogHandler.GetCatalog)
	r.Get("/api/users/{tgUserId}/vin-history", historyHandler.GetHistory)
	r.Post("/api/users/{tgUserId}/vin-history", historyHandler.PostHistory)

	// Conversation history routes
	r.Get("/api/users/{tgUserId}/sessions", conversationsHandler.ListSessions)
	r.Post("/api/users/{tgUserId}/sessions", conversationsHandler.CreateSession)
	r.Get("/api/users/{tgUserId}/sessions/{sessionKey}", conversationsHandler.GetSession)
	r.Delete("/api/users/{tgUserId}/sessions/{sessionKey}", conversationsHandler.DeleteSession)
	r.Get("/api/users/{tgUserId}/sessions/{sessionKey}/messages", conversationsHandler.GetMessages)
	r.Post("/api/users/{tgUserId}/sessions/{sessionKey}/messages", conversationsHandler.AppendMessages)

	// Start server
	log.Printf("Server starting on port %s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		
		// Check allowed origins
		allowed := false
		allowedOrigins := []string{
			"https://daedalus.wheelbase.io",
		}
		
		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				allowed = true
				break
			}
		}
		
		// Allow localhost for development
		if strings.HasPrefix(origin, "http://localhost:") {
			allowed = true
		}

		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}