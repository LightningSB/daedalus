package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"daedalus-proxy/internal/parquet"
	"daedalus-proxy/internal/storage"
	"github.com/go-chi/chi/v5"
)

type ConversationsHandler struct {
	minioClient *storage.MinIOClient
}

// Message represents a single conversation message
type Message struct {
	Role      string `json:"role"`      // "user" or "assistant"
	Content   string `json:"content"`   // Message text
	Timestamp int64  `json:"timestamp"` // Unix milliseconds
}

// AppendMessagesRequest is the request body for POST /conversations
type AppendMessagesRequest struct {
	SessionKey string    `json:"session_key"`
	Messages   []Message `json:"messages"`
}

// GetSessionResponse returns metadata about a session
type GetSessionResponse struct {
	SessionKey   string `json:"session_key"`
	TgUserID     string `json:"tg_user_id"`
	AppID        string `json:"app_id"`
	MessageCount int    `json:"message_count"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

// CreateSessionRequest creates a new session
type CreateSessionRequest struct {
	AppID string `json:"app_id"` // Optional: associate with an app
}

// CreateSessionResponse returns the new session key
type CreateSessionResponse struct {
	SessionKey string `json:"session_key"`
}

func NewConversationsHandler(minioClient *storage.MinIOClient) *ConversationsHandler {
	return &ConversationsHandler{
		minioClient: minioClient,
	}
}

// GET /api/users/{tgUserId}/sessions
// List all conversation sessions for a user
func (h *ConversationsHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	if tgUserID == "" {
		http.Error(w, `{"error": "Missing user ID"}`, http.StatusBadRequest)
		return
	}

	sessions, err := parquet.ListConversationSessions(r.Context(), h.minioClient, tgUserID)
	if err != nil {
		log.Printf("Error listing sessions for user %s: %v", tgUserID, err)
		http.Error(w, `{"error": "Failed to list sessions"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// POST /api/users/{tgUserId}/sessions
// Create a new conversation session, returns session key
func (h *ConversationsHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	if tgUserID == "" {
		http.Error(w, `{"error": "Missing user ID"}`, http.StatusBadRequest)
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Empty body is OK - appID is optional
		req = CreateSessionRequest{}
	}

	sessionKey, err := parquet.CreateConversationSession(r.Context(), h.minioClient, tgUserID, req.AppID)
	if err != nil {
		log.Printf("Error creating session for user %s: %v", tgUserID, err)
		http.Error(w, `{"error": "Failed to create session"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(CreateSessionResponse{
		SessionKey: sessionKey,
	})
}

// GET /api/users/{tgUserId}/sessions/{sessionKey}
// Get session metadata
func (h *ConversationsHandler) GetSession(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	sessionKey := chi.URLParam(r, "sessionKey")

	if tgUserID == "" || sessionKey == "" {
		http.Error(w, `{"error": "Missing user ID or session key"}`, http.StatusBadRequest)
		return
	}

	session, err := parquet.GetConversationSession(r.Context(), h.minioClient, tgUserID, sessionKey)
	if err != nil {
		log.Printf("Error getting session %s for user %s: %v", sessionKey, tgUserID, err)
		http.Error(w, `{"error": "Session not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

// DELETE /api/users/{tgUserId}/sessions/{sessionKey}
// Delete a conversation session
func (h *ConversationsHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	sessionKey := chi.URLParam(r, "sessionKey")

	if tgUserID == "" || sessionKey == "" {
		http.Error(w, `{"error": "Missing user ID or session key"}`, http.StatusBadRequest)
		return
	}

	if err := parquet.DeleteConversationSession(r.Context(), h.minioClient, tgUserID, sessionKey); err != nil {
		log.Printf("Error deleting session %s for user %s: %v", sessionKey, tgUserID, err)
		http.Error(w, `{"error": "Failed to delete session"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GET /api/users/{tgUserId}/sessions/{sessionKey}/messages
// Get conversation messages with optional pagination
func (h *ConversationsHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	sessionKey := chi.URLParam(r, "sessionKey")

	if tgUserID == "" || sessionKey == "" {
		http.Error(w, `{"error": "Missing user ID or session key"}`, http.StatusBadRequest)
		return
	}

	// Optional pagination
	limit := 100
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	messages, err := parquet.ReadConversationMessages(r.Context(), h.minioClient, tgUserID, sessionKey, limit, offset)
	if err != nil {
		log.Printf("Error reading messages for session %s: %v", sessionKey, err)
		http.Error(w, `{"error": "Failed to read messages"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

// POST /api/users/{tgUserId}/sessions/{sessionKey}/messages
// Append messages to a conversation
func (h *ConversationsHandler) AppendMessages(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	sessionKey := chi.URLParam(r, "sessionKey")

	if tgUserID == "" || sessionKey == "" {
		http.Error(w, `{"error": "Missing user ID or session key"}`, http.StatusBadRequest)
		return
	}

	var req AppendMessagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.Messages) == 0 {
		http.Error(w, `{"error": "No messages provided"}`, http.StatusBadRequest)
		return
	}

	// Convert to parquet records
	records := make([]parquet.ConversationMessage, len(req.Messages))
	now := time.Now().UnixMilli()
	for i, msg := range req.Messages {
		ts := msg.Timestamp
		if ts == 0 {
			ts = now
		}
		records[i] = parquet.ConversationMessage{
			Role:      msg.Role,
			Content:   msg.Content,
			Timestamp: ts,
		}
	}

	if err := parquet.AppendConversationMessages(r.Context(), h.minioClient, tgUserID, sessionKey, records); err != nil {
		log.Printf("Error appending messages to session %s: %v", sessionKey, err)
		http.Error(w, `{"error": "Failed to append messages"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"count":   len(records),
	})
}
