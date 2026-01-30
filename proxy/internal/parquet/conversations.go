package parquet

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"time"

	"daedalus-proxy/internal/storage"
)

// ConversationSession represents a chat session
type ConversationSession struct {
	SessionKey   string `json:"session_key"`
	TgUserID     string `json:"tg_user_id"`
	AppID        string `json:"app_id,omitempty"`
	MessageCount int    `json:"message_count"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

// ConversationMessage represents a single message in a conversation
type ConversationMessage struct {
	Role      string `json:"role"`      // "user" or "assistant"
	Content   string `json:"content"`   // Message text
	Timestamp int64  `json:"timestamp"` // Unix milliseconds
}

// conversationData is the full conversation stored in MinIO
type conversationData struct {
	Session  ConversationSession   `json:"session"`
	Messages []ConversationMessage `json:"messages"`
}

// generateSessionKey creates a random session key
func generateSessionKey() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// getSessionsIndexPath returns the path to user's sessions index
func getSessionsIndexPath(tgUserID string) string {
	return fmt.Sprintf("users/%s/conversations/index.json", tgUserID)
}

// getConversationPath returns the path to a specific conversation
func getConversationPath(tgUserID, sessionKey string) string {
	return fmt.Sprintf("users/%s/conversations/%s.json", tgUserID, sessionKey)
}

// ListConversationSessions returns all sessions for a user
func ListConversationSessions(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string) ([]ConversationSession, error) {
	indexPath := getSessionsIndexPath(tgUserID)

	exists, err := minioClient.ObjectExists(ctx, indexPath)
	if err != nil {
		return nil, fmt.Errorf("failed to check sessions index: %w", err)
	}

	if !exists {
		return []ConversationSession{}, nil
	}

	reader, err := minioClient.GetObject(ctx, indexPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get sessions index: %w", err)
	}
	defer func() {
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read sessions index: %w", err)
	}

	var sessions []ConversationSession
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, fmt.Errorf("failed to parse sessions index: %w", err)
	}

	// Sort by updated_at descending (most recent first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})

	return sessions, nil
}

// updateSessionsIndex updates the sessions index with a session
func updateSessionsIndex(ctx context.Context, minioClient *storage.MinIOClient, tgUserID string, session ConversationSession) error {
	sessions, err := ListConversationSessions(ctx, minioClient, tgUserID)
	if err != nil {
		sessions = []ConversationSession{}
	}

	// Find and update existing, or append new
	found := false
	for i, s := range sessions {
		if s.SessionKey == session.SessionKey {
			sessions[i] = session
			found = true
			break
		}
	}
	if !found {
		sessions = append(sessions, session)
	}

	// Sort by updated_at descending
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})

	// Keep only last 100 sessions
	if len(sessions) > 100 {
		sessions = sessions[:100]
	}

	data, err := json.Marshal(sessions)
	if err != nil {
		return fmt.Errorf("failed to marshal sessions index: %w", err)
	}

	return minioClient.PutObject(ctx, getSessionsIndexPath(tgUserID), bytes.NewReader(data), int64(len(data)))
}

// removeFromSessionsIndex removes a session from the index
func removeFromSessionsIndex(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, sessionKey string) error {
	sessions, err := ListConversationSessions(ctx, minioClient, tgUserID)
	if err != nil {
		return nil // Nothing to remove
	}

	filtered := make([]ConversationSession, 0, len(sessions))
	for _, s := range sessions {
		if s.SessionKey != sessionKey {
			filtered = append(filtered, s)
		}
	}

	if len(filtered) == len(sessions) {
		return nil // Nothing removed
	}

	data, err := json.Marshal(filtered)
	if err != nil {
		return fmt.Errorf("failed to marshal sessions index: %w", err)
	}

	return minioClient.PutObject(ctx, getSessionsIndexPath(tgUserID), bytes.NewReader(data), int64(len(data)))
}

// CreateConversationSession creates a new conversation session
func CreateConversationSession(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, appID string) (string, error) {
	sessionKey := generateSessionKey()
	now := time.Now().UnixMilli()

	session := ConversationSession{
		SessionKey:   sessionKey,
		TgUserID:     tgUserID,
		AppID:        appID,
		MessageCount: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	convData := conversationData{
		Session:  session,
		Messages: []ConversationMessage{},
	}

	data, err := json.Marshal(convData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal conversation: %w", err)
	}

	// Write conversation file
	if err := minioClient.PutObject(ctx, getConversationPath(tgUserID, sessionKey), bytes.NewReader(data), int64(len(data))); err != nil {
		return "", fmt.Errorf("failed to write conversation: %w", err)
	}

	// Update index
	if err := updateSessionsIndex(ctx, minioClient, tgUserID, session); err != nil {
		return "", fmt.Errorf("failed to update sessions index: %w", err)
	}

	return sessionKey, nil
}

// GetConversationSession returns metadata about a session
func GetConversationSession(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, sessionKey string) (*ConversationSession, error) {
	convPath := getConversationPath(tgUserID, sessionKey)

	exists, err := minioClient.ObjectExists(ctx, convPath)
	if err != nil {
		return nil, fmt.Errorf("failed to check conversation existence: %w", err)
	}

	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	reader, err := minioClient.GetObject(ctx, convPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}
	defer func() {
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read conversation: %w", err)
	}

	var convData conversationData
	if err := json.Unmarshal(data, &convData); err != nil {
		return nil, fmt.Errorf("failed to parse conversation: %w", err)
	}

	return &convData.Session, nil
}

// DeleteConversationSession deletes a conversation session
func DeleteConversationSession(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, sessionKey string) error {
	convPath := getConversationPath(tgUserID, sessionKey)

	// Delete conversation file
	if err := minioClient.DeleteObject(ctx, convPath); err != nil {
		// Ignore not found errors
	}

	// Remove from index
	return removeFromSessionsIndex(ctx, minioClient, tgUserID, sessionKey)
}

// ReadConversationMessages reads messages from a conversation with pagination
func ReadConversationMessages(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, sessionKey string, limit, offset int) ([]ConversationMessage, error) {
	convPath := getConversationPath(tgUserID, sessionKey)

	exists, err := minioClient.ObjectExists(ctx, convPath)
	if err != nil {
		return nil, fmt.Errorf("failed to check conversation existence: %w", err)
	}

	if !exists {
		return []ConversationMessage{}, nil
	}

	reader, err := minioClient.GetObject(ctx, convPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}
	defer func() {
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read conversation: %w", err)
	}

	var convData conversationData
	if err := json.Unmarshal(data, &convData); err != nil {
		return nil, fmt.Errorf("failed to parse conversation: %w", err)
	}

	messages := convData.Messages

	// Apply pagination
	if offset > len(messages) {
		return []ConversationMessage{}, nil
	}
	messages = messages[offset:]
	if len(messages) > limit {
		messages = messages[:limit]
	}

	return messages, nil
}

// AppendConversationMessages appends messages to a conversation
func AppendConversationMessages(ctx context.Context, minioClient *storage.MinIOClient, tgUserID, sessionKey string, newMessages []ConversationMessage) error {
	convPath := getConversationPath(tgUserID, sessionKey)

	// Read existing conversation
	var convData conversationData

	exists, err := minioClient.ObjectExists(ctx, convPath)
	if err != nil {
		return fmt.Errorf("failed to check conversation existence: %w", err)
	}

	if exists {
		reader, err := minioClient.GetObject(ctx, convPath)
		if err != nil {
			return fmt.Errorf("failed to get conversation: %w", err)
		}

		data, err := io.ReadAll(reader)
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
		if err != nil {
			return fmt.Errorf("failed to read conversation: %w", err)
		}

		if err := json.Unmarshal(data, &convData); err != nil {
			return fmt.Errorf("failed to parse conversation: %w", err)
		}
	} else {
		// Create new conversation if it doesn't exist
		now := time.Now().UnixMilli()
		convData = conversationData{
			Session: ConversationSession{
				SessionKey:   sessionKey,
				TgUserID:     tgUserID,
				MessageCount: 0,
				CreatedAt:    now,
				UpdatedAt:    now,
			},
			Messages: []ConversationMessage{},
		}
	}

	// Append messages
	convData.Messages = append(convData.Messages, newMessages...)
	convData.Session.MessageCount = len(convData.Messages)
	convData.Session.UpdatedAt = time.Now().UnixMilli()

	// Limit total messages to prevent unbounded growth (keep last 1000)
	if len(convData.Messages) > 1000 {
		convData.Messages = convData.Messages[len(convData.Messages)-1000:]
		convData.Session.MessageCount = len(convData.Messages)
	}

	// Write back
	data, err := json.Marshal(convData)
	if err != nil {
		return fmt.Errorf("failed to marshal conversation: %w", err)
	}

	if err := minioClient.PutObject(ctx, convPath, bytes.NewReader(data), int64(len(data))); err != nil {
		return fmt.Errorf("failed to write conversation: %w", err)
	}

	// Update sessions index
	return updateSessionsIndex(ctx, minioClient, tgUserID, convData.Session)
}
