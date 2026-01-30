package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"daedalus-proxy/internal/parquet"
	"daedalus-proxy/internal/storage"
)

type CatalogHandler struct {
	minioClient *storage.MinIOClient
}

func NewCatalogHandler(minioClient *storage.MinIOClient) *CatalogHandler {
	return &CatalogHandler{
		minioClient: minioClient,
	}
}

func (h *CatalogHandler) GetCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := parquet.ReadCatalog(r.Context(), h.minioClient)
	if err != nil {
		log.Printf("Error reading catalog: %v", err)
		http.Error(w, `{"error": "Failed to read catalog"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}