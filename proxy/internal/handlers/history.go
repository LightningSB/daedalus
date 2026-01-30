package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"daedalus-proxy/internal/parquet"
	"daedalus-proxy/internal/storage"
	"github.com/go-chi/chi/v5"
)

type HistoryHandler struct {
	minioClient *storage.MinIOClient
}

type VINHistoryRequest struct {
	VIN       string          `json:"vin"`
	Make      string          `json:"make"`
	Model     string          `json:"model"`
	Year      int32           `json:"year"`
	Thumbnail string          `json:"thumbnail"`
	Data      json.RawMessage `json:"data"`
}

type VINHistoryResponse struct {
	Success bool `json:"success"`
	Count   int  `json:"count"`
}

func NewHistoryHandler(minioClient *storage.MinIOClient) *HistoryHandler {
	return &HistoryHandler{
		minioClient: minioClient,
	}
}

func (h *HistoryHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	if tgUserID == "" {
		http.Error(w, `{"error": "Missing user ID"}`, http.StatusBadRequest)
		return
	}

	records, err := parquet.ReadVINHistory(r.Context(), h.minioClient, tgUserID)
	if err != nil {
		log.Printf("Error reading VIN history for user %s: %v", tgUserID, err)
		http.Error(w, `{"error": "Failed to read history"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}

func (h *HistoryHandler) PostHistory(w http.ResponseWriter, r *http.Request) {
	tgUserID := chi.URLParam(r, "tgUserId")
	if tgUserID == "" {
		http.Error(w, `{"error": "Missing user ID"}`, http.StatusBadRequest)
		return
	}

	var req VINHistoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.VIN == "" {
		http.Error(w, `{"error": "VIN is required"}`, http.StatusBadRequest)
		return
	}

	record := parquet.VINHistoryRecord{
		VIN:       req.VIN,
		DecodedAt: time.Now().UnixMilli(),
		Make:      req.Make,
		Model:     req.Model,
		Year:      req.Year,
		Thumbnail: req.Thumbnail,
		DataJSON:  string(req.Data),
	}

	if err := parquet.AppendVINHistory(r.Context(), h.minioClient, tgUserID, record); err != nil {
		log.Printf("Error appending VIN history for user %s: %v", tgUserID, err)
		http.Error(w, `{"error": "Failed to save history"}`, http.StatusInternalServerError)
		return
	}

	// Get count after append
	records, err := parquet.ReadVINHistory(r.Context(), h.minioClient, tgUserID)
	if err != nil {
		log.Printf("Error reading history count for user %s: %v", tgUserID, err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(VINHistoryResponse{
		Success: true,
		Count:   len(records),
	})
}